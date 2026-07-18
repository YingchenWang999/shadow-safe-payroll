import { writeFile } from "node:fs/promises";
import {
  getCompatibilityFallbackHandlerDeployment,
  getProxyFactoryDeployment,
  getSafeSingletonDeployment,
} from "@safe-global/safe-deployments";
import { artifacts, network } from "hardhat";
import {
  concatHex,
  encodeFunctionData,
  getAddress,
  padHex,
  parseAbi,
  parseEventLogs,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

const CHAIN_ID = 11_155_111;
const NOX_COMPUTE = getAddress("0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF");
const networkFilter = { network: String(CHAIN_ID) };

const factoryDeployment = getProxyFactoryDeployment(networkFilter);
const singletonDeployment = getSafeSingletonDeployment(networkFilter);
const handlerDeployment = getCompatibilityFallbackHandlerDeployment(networkFilter);
if (!factoryDeployment || !singletonDeployment || !handlerDeployment) {
  throw new Error("Safe deployments package does not contain Ethereum Sepolia addresses");
}

const factory = getAddress(factoryDeployment.defaultAddress);
const singleton = getAddress(singletonDeployment.defaultAddress);
const fallbackHandler = getAddress(handlerDeployment.defaultAddress);

const factoryAbi = parseAbi([
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "event ProxyCreation(address indexed proxy, address singleton)",
]);
const safeAbi = parseAbi([
  "function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address payable paymentReceiver)",
  "function VERSION() view returns (string)",
  "function nonce() view returns (uint256)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address payable refundReceiver,bytes signatures) returns (bool success)",
  "event ExecutionSuccess(bytes32 txHash,uint256 payment)",
  "event ExecutionFailure(bytes32 txHash,uint256 payment)",
]);
const tokenAbi = parseAbi(["function setOperator(address operator,uint48 until)"]);

const { viem } = await network.connect();
const publicClient = await viem.getPublicClient();
const [walletClient] = await viem.getWalletClients();
if (!walletClient?.account) throw new Error("No deployer wallet is configured");
const owner = getAddress(walletClient.account.address);

if ((await publicClient.getChainId()) !== CHAIN_ID) {
  throw new Error("bootstrap-sepolia.ts must run on Ethereum Sepolia");
}

for (const [label, address] of [
  ["NoxCompute", NOX_COMPUTE],
  ["Safe singleton", singleton],
  ["Safe proxy factory", factory],
  ["Safe fallback handler", fallbackHandler],
] as const) {
  if (!(await publicClient.getCode({ address }))) {
    throw new Error(`${label} has no bytecode at ${address}`);
  }
}

let safe: Address;
let safeHash: Hex;
if (process.env.RESUME_SAFE_ADDRESS && process.env.RESUME_SAFE_TX) {
  safe = getAddress(process.env.RESUME_SAFE_ADDRESS);
  safeHash = process.env.RESUME_SAFE_TX as Hex;
  if (!(await publicClient.getCode({ address: safe }))) {
    throw new Error(`RESUME_SAFE_ADDRESS has no bytecode at ${safe}`);
  }
} else {
  const initializer = encodeFunctionData({
    abi: safeAbi,
    functionName: "setup",
    args: [[owner], 1n, zeroAddress, "0x", fallbackHandler, zeroAddress, 0n, zeroAddress],
  });
  const saltNonce = BigInt(process.env.SAFE_SALT_NONCE ?? Date.now());
  safeHash = await walletClient.writeContract({
    account: walletClient.account,
    address: factory,
    abi: factoryAbi,
    functionName: "createProxyWithNonce",
    args: [singleton, initializer, saltNonce],
  });
  const safeReceipt = await publicClient.waitForTransactionReceipt({ hash: safeHash });
  const [proxyCreated] = parseEventLogs({
    abi: factoryAbi,
    logs: safeReceipt.logs,
    eventName: "ProxyCreation",
  });
  if (!proxyCreated) throw new Error("Safe ProxyCreation event was not found");
  safe = getAddress(proxyCreated.args.proxy);
}

let token: Address;
let tokenHash: Hex;
if (process.env.RESUME_TOKEN_ADDRESS && process.env.RESUME_TOKEN_TX) {
  token = getAddress(process.env.RESUME_TOKEN_ADDRESS);
  tokenHash = process.env.RESUME_TOKEN_TX as Hex;
  if (!(await publicClient.getCode({ address: token }))) {
    throw new Error(`RESUME_TOKEN_ADDRESS has no bytecode at ${token}`);
  }
} else {
  const tokenArtifact = await artifacts.readArtifact("DemoConfidentialUSD");
  tokenHash = await walletClient.deployContract({
    account: walletClient.account,
    abi: tokenArtifact.abi,
    bytecode: tokenArtifact.bytecode as Hex,
    args: [safe, parseUnits("1000000", 18)],
  });
  const tokenReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenHash });
  if (tokenReceipt.status !== "success" || !tokenReceipt.contractAddress) {
    throw new Error("DemoConfidentialUSD deployment reverted");
  }
  token = getAddress(tokenReceipt.contractAddress);
}

const payrollArtifact = await artifacts.readArtifact("ShadowSafePayroll");
const payrollHash = await walletClient.deployContract({
  account: walletClient.account,
  abi: payrollArtifact.abi,
  bytecode: payrollArtifact.bytecode as Hex,
  args: [safe, token, owner],
});
const payrollReceipt = await publicClient.waitForTransactionReceipt({ hash: payrollHash });
if (payrollReceipt.status !== "success" || !payrollReceipt.contractAddress) {
  throw new Error("ShadowSafePayroll deployment reverted");
}
const payroll = getAddress(payrollReceipt.contractAddress);

// A one-owner demo Safe can use a prevalidated signature when the owner is also msg.sender.
const prevalidatedSignature = concatHex([
  padHex(owner, { size: 32 }),
  padHex("0x00", { size: 32 }),
  "0x01",
]) as Hex;

async function executeSafeTokenCall(data: Hex, label: string) {
  const hash = await walletClient.writeContract({
    account: walletClient.account,
    address: safe,
    abi: safeAbi,
    functionName: "execTransaction",
    args: [token, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, prevalidatedSignature],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const success = parseEventLogs({
    abi: safeAbi,
    logs: receipt.logs,
    eventName: "ExecutionSuccess",
  });
  if (receipt.status !== "success" || success.length !== 1) {
    throw new Error(`${label} failed inside the Safe: ${hash}`);
  }
  return hash;
}

let revokeOldOperatorHash: Hex | undefined;
if (process.env.REVOKE_OPERATOR_ADDRESS) {
  const oldOperator = getAddress(process.env.REVOKE_OPERATOR_ADDRESS);
  const revokeData = encodeFunctionData({
    abi: tokenAbi,
    functionName: "setOperator",
    args: [oldOperator, 0],
  });
  revokeOldOperatorHash = await executeSafeTokenCall(revokeData, "Old operator revocation");
}
const operatorExpiry = Number(
  process.env.OPERATOR_EXPIRY ?? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
);
if (!Number.isSafeInteger(operatorExpiry) || operatorExpiry <= Math.floor(Date.now() / 1000)) {
  throw new Error("OPERATOR_EXPIRY must be a future Unix timestamp");
}
const setOperatorData = encodeFunctionData({
  abi: tokenAbi,
  functionName: "setOperator",
  args: [payroll, operatorExpiry],
});
const operatorHash = await executeSafeTokenCall(setOperatorData, "Safe setOperator transaction");

const deployment = {
  chainId: CHAIN_ID,
  network: "Ethereum Sepolia",
  deployer: owner,
  safe,
  safeVersion: await publicClient.readContract({
    address: safe,
    abi: safeAbi,
    functionName: "VERSION",
  }),
  confidentialToken: token,
  payroll,
  noxCompute: NOX_COMPUTE,
  operatorExpiry,
  transactions: {
    safeCreation: safeHash,
    tokenDeployment: tokenHash,
    payrollDeployment: payrollHash,
    revokeOldOperator: revokeOldOperatorHash,
    setOperator: operatorHash,
  },
  explorer: {
    safe: `https://sepolia.etherscan.io/address/${safe}`,
    confidentialToken: `https://sepolia.etherscan.io/address/${token}`,
    payroll: `https://sepolia.etherscan.io/address/${payroll}`,
    setOperator: `https://sepolia.etherscan.io/tx/${operatorHash}`,
  },
};

await writeFile("deployment.json", `${JSON.stringify(deployment, null, 2)}\n`, "utf8");
console.log(JSON.stringify(deployment, null, 2));
