import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, parseAbiParameters } from "viem";

const require = createRequire(import.meta.url);
const toolboxEntry = require.resolve("@nomicfoundation/hardhat-toolbox-viem");
const verifyEntry = require.resolve("@nomicfoundation/hardhat-verify", {
  paths: [dirname(toolboxEntry)],
});
const verifyRequire = createRequire(verifyEntry);
const { Interface, version } = verifyRequire("@ethersproject/abi");

assert.match(version, /^6\./, "Hardhat Verify must resolve its ABI implementation to ethers v6");

const address = "0x1111111111111111111111111111111111111111";
const abi = [
  {
    type: "constructor",
    inputs: [
      { name: "safe_", type: "address" },
      { name: "token_", type: "address" },
      { name: "manager_", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
];
const actual = new Interface(abi).encodeDeploy([address, address, address]);
const expected = encodeAbiParameters(parseAbiParameters("address, address, address"), [
  address,
  address,
  address,
]);
assert.equal(actual, expected, "Hardhat Verify constructor encoding must remain ABI-compatible");

console.log(
  `Security overrides verified from ${fileURLToPath(import.meta.url)} (ethers ${version}).`,
);
