import { chmod, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const output = ".env";
if (existsSync(output)) {
  throw new Error(".env already exists; refusing to overwrite local wallet secrets");
}

const deployerKey = generatePrivateKey();
const claimantKey = generatePrivateKey();
const deployer = privateKeyToAccount(deployerKey);
const claimant = privateKeyToAccount(claimantKey);

const env = `# Generated test-only wallets. Never use these keys on mainnet.\nSEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com\nDEPLOYER_PRIVATE_KEY=${deployerKey}\nCLAIMANT_PRIVATE_KEY=${claimantKey}\nPAYROLL_MANAGER_ADDRESS=${deployer.address}\n`;

await writeFile(output, env, { encoding: "utf8", mode: 0o600, flag: "wx" });
await chmod(output, 0o600);

console.log(
  JSON.stringify(
    {
      deployer: deployer.address,
      claimant: claimant.address,
      secretFile: output,
      warning: "Test-only wallets. Fund only with faucet ETH.",
    },
    null,
    2,
  ),
);
