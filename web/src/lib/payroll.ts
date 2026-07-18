import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  parseEventLogs,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { arbitrumSepolia, sepolia } from "viem/chains";

const payrollAbi = parseAbi([
  "function safe() view returns (address)",
  "function confidentialToken() view returns (address)",
  "function payrollManager() view returns (address)",
  "function paymentCount() view returns (uint256)",
  "function getPayment(uint256 paymentId) view returns ((bytes32 recipientCommitment, bytes32 memoHash, bytes32 requestedAmount, bytes32 settledAmount, uint48 validUntil, uint8 status))",
  "function submitPayment(bytes32 recipientCommitment, bytes32 encryptedAmount, bytes inputProof, bytes32 memoHash, uint48 validUntil) returns (uint256)",
  "function approvePayment(uint256 paymentId)",
  "function cancelPayment(uint256 paymentId)",
  "function claimPayment(uint256 paymentId, bytes32 secretSalt)",
  "function grantAuditor(uint256 paymentId, address auditor)",
  "event PaymentSubmitted(uint256 indexed paymentId, bytes32 indexed recipientCommitment, bytes32 indexed memoHash, uint48 validUntil)",
]);

const configuredChain = import.meta.env.VITE_CHAIN ?? "sepolia";
if (configuredChain !== "arbitrumSepolia" && configuredChain !== "sepolia") {
  throw new Error(`Unsupported VITE_CHAIN: ${configuredChain}`);
}
const selectedChain = configuredChain === "sepolia" ? sepolia : arbitrumSepolia;
const publicClient = createPublicClient({ chain: selectedChain, transport: http() });
const configuredPayrollAddress = import.meta.env.VITE_PAYROLL_ADDRESS;
if (configuredPayrollAddress && !isAddress(configuredPayrollAddress)) {
  throw new Error("VITE_PAYROLL_ADDRESS must be a valid deployed contract address.");
}
export const payrollAddress = configuredPayrollAddress
  ? getAddress(configuredPayrollAddress)
  : undefined;
export const isLive = Boolean(payrollAddress);
export const networkLabel = selectedChain.name;

export type Payment = {
  id: bigint;
  commitment: Hex;
  memoHash: Hex;
  requestedAmount: Hex;
  settledAmount: Hex;
  validUntil: number;
  status: number;
};

export type TreasuryConfig = {
  safe: Address;
  token: Address;
  manager: Address;
  paymentCount: bigint;
};

function requireEthereum() {
  if (!window.ethereum) throw new Error("Install or unlock an EVM wallet to continue.");
  return window.ethereum;
}

export async function connectWallet(): Promise<{ account: Address; wallet: WalletClient }> {
  const provider = requireEthereum();
  const wallet = createWalletClient({ chain: selectedChain, transport: custom(provider) });
  const [account] = await wallet.requestAddresses();
  if (!account) throw new Error("The wallet did not return an account.");
  const currentChainId = await wallet.getChainId();
  if (currentChainId !== selectedChain.id) {
    try {
      await wallet.switchChain({ id: selectedChain.id });
    } catch {
      throw new Error(`Switch your wallet to ${selectedChain.name} and connect again.`);
    }
  }
  return { account: getAddress(account), wallet };
}

export async function readTreasury(): Promise<TreasuryConfig> {
  if (!payrollAddress) throw new Error("Set VITE_PAYROLL_ADDRESS to enable live mode.");
  const common = { address: payrollAddress, abi: payrollAbi } as const;
  const [safe, token, manager, paymentCount] = await Promise.all([
    publicClient.readContract({ ...common, functionName: "safe" }),
    publicClient.readContract({ ...common, functionName: "confidentialToken" }),
    publicClient.readContract({ ...common, functionName: "payrollManager" }),
    publicClient.readContract({ ...common, functionName: "paymentCount" }),
  ]);
  return { safe, token, manager, paymentCount };
}

export async function readPayment(id: bigint): Promise<Payment> {
  if (!payrollAddress) throw new Error("Set VITE_PAYROLL_ADDRESS to enable live mode.");
  const record = await publicClient.readContract({
    address: payrollAddress,
    abi: payrollAbi,
    functionName: "getPayment",
    args: [id],
  });
  return {
    id,
    commitment: record.recipientCommitment,
    memoHash: record.memoHash,
    requestedAmount: record.requestedAmount,
    settledAmount: record.settledAmount,
    validUntil: record.validUntil,
    status: record.status,
  };
}

export function createSalt(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function computeCommitment(recipient: Address, salt: Hex): Hex {
  if (recipient === zeroAddress) throw new Error("The payout address cannot be the zero address.");
  return keccak256(
    encodeAbiParameters(parseAbiParameters("address payoutAddress, bytes32 secretSalt"), [
      recipient,
      salt,
    ]),
  );
}

export async function submitEncryptedPayment(input: {
  wallet: WalletClient;
  account: Address;
  recipient: Address;
  salary: string;
  memo: string;
  validUntil: number;
  salt: Hex;
}) {
  if (!payrollAddress) throw new Error("Live mode is not configured.");
  const salary = input.salary.trim();
  if (!salary) throw new Error("Enter a salary amount.");
  const commitment = computeCommitment(input.recipient, input.salt);
  const token = await publicClient.readContract({
    address: payrollAddress,
    abi: payrollAbi,
    functionName: "confidentialToken",
  });
  const decimals = await publicClient.readContract({
    address: token,
    abi: parseAbi(["function decimals() view returns (uint8)"]),
    functionName: "decimals",
  });
  const amount = parseUnits(salary, decimals);
  if (amount <= 0n) throw new Error("Salary must be greater than zero.");
  const { createViemHandleClient } = await import("@iexec-nox/handle");
  const handleClient = await createViemHandleClient(input.wallet);
  const encrypted = await handleClient.encryptInput(amount, "uint256", payrollAddress);
  const hash = await input.wallet.writeContract({
    account: input.account,
    chain: selectedChain,
    address: payrollAddress,
    abi: payrollAbi,
    functionName: "submitPayment",
    args: [
      commitment,
      encrypted.handle,
      encrypted.handleProof,
      keccak256(new TextEncoder().encode(input.memo)),
      input.validUntil,
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The payment transaction reverted.");
  const [submitted] = parseEventLogs({
    abi: payrollAbi,
    logs: receipt.logs,
    eventName: "PaymentSubmitted",
  });
  if (!submitted) throw new Error("PaymentSubmitted was not found in the transaction receipt.");
  return { hash, commitment, paymentId: submitted.args.paymentId };
}

export async function claimPayment(input: {
  wallet: WalletClient;
  account: Address;
  paymentId: bigint;
  salt: Hex;
}) {
  if (!payrollAddress) throw new Error("Live mode is not configured.");
  const hash = await input.wallet.writeContract({
    account: input.account,
    chain: selectedChain,
    address: payrollAddress,
    abi: payrollAbi,
    functionName: "claimPayment",
    args: [input.paymentId, input.salt],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The claim transaction reverted.");
  return hash;
}

export async function decryptAmount(wallet: WalletClient, handle: Hex): Promise<string> {
  if (!payrollAddress) throw new Error("Live mode is not configured.");
  const token = await publicClient.readContract({
    address: payrollAddress,
    abi: payrollAbi,
    functionName: "confidentialToken",
  });
  const decimals = await publicClient.readContract({
    address: token,
    abi: parseAbi(["function decimals() view returns (uint8)"]),
    functionName: "decimals",
  });
  const { createViemHandleClient } = await import("@iexec-nox/handle");
  const client = await createViemHandleClient(wallet);
  const result = await client.decrypt(handle);
  return formatUnits(result.value as bigint, decimals);
}

export function safeCall(method: "approvePayment" | "cancelPayment", paymentId: bigint) {
  if (!payrollAddress) throw new Error("Live mode is not configured.");
  return {
    to: payrollAddress,
    value: "0",
    data: encodeFunctionData({ abi: payrollAbi, functionName: method, args: [paymentId] }),
  };
}

export function auditorCall(paymentId: bigint, auditor: Address) {
  if (!payrollAddress) throw new Error("Live mode is not configured.");
  return {
    to: payrollAddress,
    value: "0",
    data: encodeFunctionData({
      abi: payrollAbi,
      functionName: "grantAuditor",
      args: [paymentId, auditor],
    }),
  };
}

export async function proposeSafeCall(transaction: { to: string; value: string; data: string }) {
  if (window.parent === window) {
    await navigator.clipboard.writeText(JSON.stringify(transaction, null, 2));
    return "Copied Safe transaction JSON. Open this app inside Safe to propose it directly.";
  }
  const { default: SafeAppsSDK } = await import("@safe-global/safe-apps-sdk");
  const sdk = new SafeAppsSDK();
  await sdk.txs.send({ txs: [transaction] });
  return "Transaction proposed to the connected Safe.";
}
