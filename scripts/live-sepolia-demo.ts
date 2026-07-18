import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createViemHandleClient, type Handle } from "@iexec-nox/handle";
import "dotenv/config";
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  http,
  keccak256,
  padHex,
  parseAbi,
  parseAbiParameters,
  parseEventLogs,
  parseUnits,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

type Deployment = {
  safe: Address;
  confidentialToken: Address;
  payroll: Address;
};

const rpcUrl = process.env.SEPOLIA_RPC_URL;
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
const claimantKey = process.env.CLAIMANT_PRIVATE_KEY as Hex | undefined;
if (!rpcUrl || !deployerKey || !claimantKey) {
  throw new Error("SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, and CLAIMANT_PRIVATE_KEY are required");
}

const deployment = JSON.parse(await readFile("deployment.json", "utf8")) as Deployment;
const safe = getAddress(deployment.safe);
const token = getAddress(deployment.confidentialToken);
const payroll = getAddress(deployment.payroll);
const deployer = privateKeyToAccount(deployerKey);
const claimant = privateKeyToAccount(claimantKey);
const transport = http(rpcUrl);
const publicClient = createPublicClient({ chain: sepolia, transport });
const deployerWallet = createWalletClient({ account: deployer, chain: sepolia, transport });
const claimantWallet = createWalletClient({ account: claimant, chain: sepolia, transport });

const payrollAbi = parseAbi([
  "function submitPayment(bytes32 recipientCommitment,bytes32 encryptedAmount,bytes inputProof,bytes32 memoHash,uint48 validUntil) returns (uint256)",
  "function approvePayment(uint256 paymentId)",
  "function claimPayment(uint256 paymentId,bytes32 secretSalt)",
  "function grantAuditor(uint256 paymentId,address auditor)",
  "function getPayment(uint256 paymentId) view returns ((bytes32 recipientCommitment,bytes32 memoHash,bytes32 requestedAmount,bytes32 settledAmount,uint48 validUntil,uint8 status))",
  "event PaymentSubmitted(uint256 indexed paymentId,bytes32 indexed recipientCommitment,bytes32 indexed memoHash,uint48 validUntil)",
]);
const safeAbi = parseAbi([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address payable refundReceiver,bytes signatures) returns (bool success)",
  "event ExecutionSuccess(bytes32 txHash,uint256 payment)",
  "event ExecutionFailure(bytes32 txHash,uint256 payment)",
]);

async function waitForSuccess(hash: Hex, label: string) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  return receipt;
}

async function decryptWithGatewayRetry(
  client: Awaited<ReturnType<typeof createViemHandleClient>>,
  handle: Handle<"uint256">,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      return (await client.decrypt(handle)).value as bigint;
    } catch (error) {
      lastError = error;
      if (attempt < 30) {
        console.log(`Handle Gateway has not indexed the viewer grant yet (${attempt}/30)...`);
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  }
  throw lastError;
}

async function executeSafe(data: Hex, label: string) {
  const prevalidatedSignature = concatHex([
    padHex(deployer.address, { size: 32 }),
    padHex("0x00", { size: 32 }),
    "0x01",
  ]);
  const hash = await deployerWallet.writeContract({
    address: safe,
    abi: safeAbi,
    functionName: "execTransaction",
    args: [payroll, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, prevalidatedSignature],
  });
  const receipt = await waitForSuccess(hash, label);
  const success = parseEventLogs({
    abi: safeAbi,
    logs: receipt.logs,
    eventName: "ExecutionSuccess",
  });
  if (success.length !== 1) throw new Error(`${label} failed inside the Safe: ${hash}`);
  return hash;
}

let claimantFunding: Hex | undefined;
const claimantBalance = await publicClient.getBalance({ address: claimant.address });
if (claimantBalance < parseUnits("0.002", 18)) {
  claimantFunding = await deployerWallet.sendTransaction({
    to: claimant.address,
    value: parseUnits("0.003", 18),
  });
  await waitForSuccess(claimantFunding, "claimant funding");
}

const salary = "1250";
const tokenDecimals = 18;
const salt = toHex(randomBytes(32));
const recipientCommitment = keccak256(
  encodeAbiParameters(parseAbiParameters("address payoutAddress, bytes32 secretSalt"), [
    claimant.address,
    salt,
  ]),
);
const memoHash = keccak256(toHex("WTF Hackathon live payroll #1"));
const validUntil = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

console.log("Encrypting salary with the live Nox handle gateway...");
const managerHandleClient = await createViemHandleClient(deployerWallet);
const encrypted = await managerHandleClient.encryptInput(
  parseUnits(salary, tokenDecimals),
  "uint256",
  payroll,
);

const submitHash = await deployerWallet.writeContract({
  address: payroll,
  abi: payrollAbi,
  functionName: "submitPayment",
  args: [recipientCommitment, encrypted.handle, encrypted.handleProof, memoHash, validUntil],
});
const submitReceipt = await waitForSuccess(submitHash, "payment submission");
const [submitted] = parseEventLogs({
  abi: payrollAbi,
  logs: submitReceipt.logs,
  eventName: "PaymentSubmitted",
});
if (!submitted) throw new Error("PaymentSubmitted event was not found");
const paymentId = submitted.args.paymentId;

const approveHash = await executeSafe(
  encodeFunctionData({
    abi: payrollAbi,
    functionName: "approvePayment",
    args: [paymentId],
  }),
  "Safe approval",
);

const claimHash = await claimantWallet.writeContract({
  address: payroll,
  abi: payrollAbi,
  functionName: "claimPayment",
  args: [paymentId, salt],
});
await waitForSuccess(claimHash, "payment claim");

const auditorHash = await executeSafe(
  encodeFunctionData({
    abi: payrollAbi,
    functionName: "grantAuditor",
    args: [paymentId, claimant.address],
  }),
  "Safe auditor grant",
);

const payment = await publicClient.readContract({
  address: payroll,
  abi: payrollAbi,
  functionName: "getPayment",
  args: [paymentId],
});
if (payment.status !== 3) throw new Error(`Expected Claimed status (3), got ${payment.status}`);

console.log("Decrypting requested and settled amounts after the Safe audit grant...");
const claimantHandleClient = await createViemHandleClient(claimantWallet);
const [requested, settled] = await Promise.all([
  decryptWithGatewayRetry(claimantHandleClient, payment.requestedAmount as Handle<"uint256">),
  decryptWithGatewayRetry(claimantHandleClient, payment.settledAmount as Handle<"uint256">),
]);
const requestedAmount = formatUnits(requested, tokenDecimals);
const settledAmount = formatUnits(settled, tokenDecimals);
if (requestedAmount !== salary || settledAmount !== salary) {
  throw new Error(`Amount mismatch: requested=${requestedAmount}, settled=${settledAmount}`);
}

const result = {
  chainId: sepolia.id,
  safe,
  confidentialToken: token,
  payroll,
  paymentId: paymentId.toString(),
  claimant: claimant.address,
  status: "Claimed",
  decryptedRequestedAmount: requestedAmount,
  decryptedSettledAmount: settledAmount,
  claimantEthBalance: formatEther(await publicClient.getBalance({ address: claimant.address })),
  transactions: {
    claimantFunding,
    submitPayment: submitHash,
    safeApproval: approveHash,
    claimPayment: claimHash,
    auditorGrant: auditorHash,
  },
  explorer: Object.fromEntries(
    Object.entries({
      claimantFunding,
      submitPayment: submitHash,
      safeApproval: approveHash,
      claimPayment: claimHash,
      auditorGrant: auditorHash,
    })
      .filter((entry): entry is [string, Hex] => Boolean(entry[1]))
      .map(([label, hash]) => [label, `https://sepolia.etherscan.io/tx/${hash}`]),
  ),
};

await writeFile("live-demo.json", `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
