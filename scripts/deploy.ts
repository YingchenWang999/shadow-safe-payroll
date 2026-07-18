import { network } from "hardhat";
import { getAddress, isAddress, parseAbi, type Address } from "viem";

const EXPECTED_CHAIN_ID = 11_155_111;
const NOX_COMPUTE_ADDRESS = getAddress("0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF");
const safeAbi = parseAbi(["function VERSION() view returns (string)"]);
const tokenAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function isOperator(address holder, address operator) view returns (bool)",
]);

function requiredAddress(name: string): Address {
  const value = process.env[name];
  if (!value || !isAddress(value)) {
    throw new Error(`${name} must be set to a valid address`);
  }
  return getAddress(value);
}

const safe = requiredAddress("SAFE_ADDRESS");
const confidentialToken = requiredAddress("CONFIDENTIAL_TOKEN_ADDRESS");
const payrollManager = requiredAddress("PAYROLL_MANAGER_ADDRESS");

const { viem } = await network.connect();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();

if (chainId !== EXPECTED_CHAIN_ID) {
  throw new Error(`Expected Ethereum Sepolia (${EXPECTED_CHAIN_ID}), connected to ${chainId}`);
}

for (const [label, address] of [
  ["Safe", safe],
  ["confidential token", confidentialToken],
] as const) {
  const bytecode = await publicClient.getCode({ address });
  if (!bytecode) throw new Error(`${label} has no deployed bytecode at ${address}`);
}

const noxBytecode = await publicClient.getCode({ address: NOX_COMPUTE_ADDRESS });
if (!noxBytecode) {
  throw new Error(`NoxCompute has no deployed bytecode at ${NOX_COMPUTE_ADDRESS}`);
}

try {
  await publicClient.readContract({ address: safe, abi: safeAbi, functionName: "VERSION" });
} catch {
  throw new Error(`SAFE_ADDRESS does not expose the expected Safe VERSION() interface: ${safe}`);
}

let tokenDecimals: number;
try {
  tokenDecimals = await publicClient.readContract({
    address: confidentialToken,
    abi: tokenAbi,
    functionName: "decimals",
  });
  await publicClient.readContract({
    address: confidentialToken,
    abi: tokenAbi,
    functionName: "isOperator",
    args: [safe, safe],
  });
} catch {
  throw new Error(
    `CONFIDENTIAL_TOKEN_ADDRESS does not expose the expected ERC-7984 interface: ${confidentialToken}`,
  );
}

const module = await viem.deployContract("ShadowSafePayroll", [
  safe,
  confidentialToken,
  payrollManager,
]);

console.log(
  JSON.stringify(
    {
      chainId,
      module: module.address,
      safe,
      confidentialToken,
      tokenDecimals,
      payrollManager,
      nextSafeAction: {
        target: confidentialToken,
        method: "setOperator(address,uint48)",
        args: [module.address, "<operator-expiry-timestamp>"],
      },
    },
    null,
    2,
  ),
);
