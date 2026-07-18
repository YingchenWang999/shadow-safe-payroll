import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  parseAbiParameters,
  type Hex,
} from "viem";

const [, , payoutAddress, secretSalt] = process.argv;

if (!payoutAddress || !isAddress(payoutAddress)) {
  throw new Error("Usage: pnpm tsx scripts/commitment.ts <payout-address> <bytes32-salt>");
}
if (!secretSalt || !isHex(secretSalt) || secretSalt.length !== 66) {
  throw new Error("secretSalt must be a 32-byte 0x-prefixed hex value");
}

const commitment = keccak256(
  encodeAbiParameters(parseAbiParameters("address payoutAddress, bytes32 secretSalt"), [
    getAddress(payoutAddress),
    secretSalt as Hex,
  ]),
);

console.log(commitment);
