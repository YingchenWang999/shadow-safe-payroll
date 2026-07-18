# ShadowSafe Payroll

Safe-controlled confidential payroll powered by iExec Nox.

ShadowSafe lets a payroll operator prepare an encrypted ERC-7984 salary without putting the amount or
employee payout address into the Safe approval transaction. Safe owners retain treasury custody and approve
each payment. The committed recipient later claims into a fresh address, and the Safe can selectively grant
one auditor access to a single payment.

## Why this improves Safe

Ordinary Safe payroll makes token amounts, recipients, and treasury history easy to inspect. Moving the
workflow to a spreadsheet hides it from the chain but loses programmable authorization and audit evidence.
ShadowSafe keeps Safe approval and settlement verifiable while Nox protects the numeric values.

The recipient address is hidden during submission and approval through a commitment. It becomes public when
claimed, so the intended workflow uses a fresh one-time address. This project does **not** claim full address
anonymity.

**Live demo:** https://web-three-inky-e6gbchzecf.vercel.app

**Demo video:** https://x.com/AOMG123123/status/2078521165006655546

**Ethereum Sepolia evidence:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## What is implemented

- `ShadowSafePayroll`: encrypted payment requests, Safe approval/cancellation, commitment claims, and scoped audit ACLs.
- `DemoConfidentialUSD`: ERC-7984 demo token based on the official Nox confidential-contract library.
- End-to-end tests using the official Nox Hardhat plugin and full local off-chain stack.
- Deployment validation that refuses missing or non-contract Safe/token addresses.
- Architecture, demo script, privacy boundary, and submission checklist.

## Requirements

- Node.js 24+
- pnpm 10+
- Docker Desktop (for the complete local Nox TEE-stack simulation)

## Run locally

```bash
pnpm install
pnpm check
```

The full check runs formatting, TypeScript, compilation, the Nox end-to-end suite, the production web build,
and a complete dependency audit. The Nox Hardhat plugin starts its Docker services, injects `NoxCompute` into
the local chain, runs the encrypted flows, and tears the stack down automatically. The first run downloads
several images and takes longer.

`pnpm-workspace.yaml` contains pinned security overrides for vulnerable transitive build/test dependencies.
`scripts/check-security-overrides.js` regression-tests the ethers-v6 ABI alias used by Hardhat Verify, while the
full audit and build/test suite verify the remaining overrides. Remove an override only after its direct parent
publishes and the complete `pnpm check` still passes.
The test launcher also detects Docker Desktop's per-user socket on macOS, which the upstream plugin does not
discover automatically.

Compile without Docker:

```bash
pnpm compile
```

Run the web interface in guided-demo mode:

```bash
pnpm web:dev
```

For live mode, copy `web/.env.example` to `web/.env`, set the deployed module address, and restart the
development server. The interface dynamically loads the Nox SDK only when encrypting or decrypting and loads
the Safe Apps SDK only when proposing a Safe transaction. In live mode it reads the selected token's decimals,
waits for transaction receipts, extracts the emitted payment ID, and requires the connected wallet to use the
configured chain.

## Testnet deployment

Use only a fresh test wallet funded with faucet ETH. Never paste a seed phrase into this project.

To create fresh, ignored test-only wallets and bootstrap the complete Safe/token/module stack:

```bash
pnpm wallets:testnet
# Fund the printed deployer address with Sepolia faucet ETH.
pnpm bootstrap:sepolia
pnpm demo:sepolia
```

The bootstrap script creates a real 1-of-1 Safe proxy, mints the demo ERC-7984 supply to it, deploys the payroll
module, and executes the time-bounded operator grant through the Safe. The live demo script then performs and
decrypts an actual end-to-end Sepolia payment. Generated keys and result files are ignored by Git.

To deploy only the module against existing testnet contracts:

```bash
cp .env.example .env
SAFE_ADDRESS=0x... \
CONFIDENTIAL_TOKEN_ADDRESS=0x... \
PAYROLL_MANAGER_ADDRESS=0x... \
pnpm deploy:sepolia
```

The deployment preflight requires Ethereum Sepolia, checks the official NoxCompute deployment, confirms the
Safe `VERSION()` interface, and probes the ERC-7984 token interface before deploying. These checks catch common
configuration mistakes but are not a substitute for verifying every address with the Safe UI and explorer.

After deployment, Safe owners must execute `setOperator(module, expiry)` on the selected ERC-7984 token. Use a
short, explicit expiry instead of unlimited authority. Each `approvePayment`, `cancelPayment`, auditor grant,
and manager change must also be sent through the Safe.

## Privacy and security

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before evaluating privacy claims. Important limitations:

- claim addresses and timing are public;
- a funded one-time address may still be linkable through its funding source;
- Nox persistent auditor grants are treated as irreversible;
- the 32-byte claim secret must be copied at submission and pasted by the claimant after a refresh;
- ERC-7984 reports an insufficient confidential balance as an encrypted zero settlement instead of a public
  revert; a claim is one-shot, so operators must fund the treasury and verify balances before approval;
- the contracts are unaudited hackathon software and must not hold real assets;
- `MockSafe` and `DemoConfidentialUSD` exist only for testing and demonstration.

## Hackathon status

Target: iExec WTF Hackathon Summer Edition. The official DoraHacks page shows the submission deadline as
2026-08-02 05:59 in the browser's displayed timezone and requires an Ethereum Sepolia deployment, a functional
front end, a public repository, `feedback.md`, and a demo video no longer than four minutes. Entry is free and
no mainnet spending is required by this repository. The page lists a 1,500 USD prize pool (750 / 500 / 250 USD)
but does not identify the payout asset or state KYC/tax requirements.

## License

MIT. Third-party Nox dependencies retain their own licenses.
