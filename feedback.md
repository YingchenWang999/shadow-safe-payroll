# iExec Nox developer feedback

ShadowSafe Payroll was built with the Nox Solidity SDK, ERC-7984 implementation, JavaScript handle SDK, and
Hardhat plugin. The encrypted types and familiar Solidity API made the core privacy flow approachable, and the
local plugin stack made it possible to test encryption, ACLs, confidential transfers, and decryption without
publishing plaintext values.

## What worked well

- `Nox.fromExternal`, arithmetic helpers, and ACL methods map cleanly to normal Solidity workflows.
- The ERC-7984 operator model fits an existing Safe treasury without moving custody into the payroll module.
- The Hardhat plugin provides a realistic end-to-end local environment instead of requiring mocks for the
  confidential path.
- The handle SDK integrates directly with a viem wallet client and keeps the web flow compact.

## Friction encountered

- The Hardhat plugin did not automatically discover Docker Desktop's per-user socket on macOS. A small launcher
  was needed to detect the socket and expose it to the plugin.
- Computation ACLs (`allow`) and Handle Gateway viewer ACLs (`addViewer`) are separate. The local stack accepted
  an auditor with computation access, while the live gateway correctly returned `access_denied: not a viewer`.
  More explicit documentation and diagnostics around this distinction would shorten debugging.
- The handle SDK's optional `ethers` peer dependency produced a warning in an independently installed Vercel
  build even though this application uses viem. Declaring the peer directly removed the warning.
- Network addresses are embedded in the Solidity SDK while the documentation's Networks page renders them as
  dynamic cards. A versioned, machine-readable deployment manifest would make CI preflight checks safer.
- ERC-7984 insufficient-balance behavior returns an encrypted zero settlement rather than a public revert. This
  preserves privacy, but the pattern deserves a prominent integration note because a one-shot business workflow
  must verify treasury funding before it changes state.

## Suggestions

1. Publish a typed network manifest containing chain IDs, NoxCompute addresses, gateway endpoints, explorers,
   and faucet links.
2. Add a permission-debugging helper that explains whether the sender, contract, or target lacks persistent or
   transient access to a handle.
3. Document recommended application patterns for confidential transfer failure, retries, and idempotency.
4. Make Docker socket discovery configurable in the Hardhat plugin for common macOS Docker Desktop setups.
5. Add an official Safe integration example covering a time-bounded ERC-7984 operator and selective disclosure.
