// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {ERC7984} from "@iexec-nox/nox-confidential-contracts/contracts/token/ERC7984.sol";
import {Nox} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

/// @notice Test-only confidential asset used by the local and testnet demo.
contract DemoConfidentialUSD is ERC7984 {
  constructor(
    address initialHolder,
    uint256 initialSupply
  ) ERC7984("Demo Confidential USD", "dcUSD", "ipfs://shadow-safe-payroll/demo-token") {
    _mint(initialHolder, Nox.toEuint256(initialSupply));
    Nox.allowPublicDecryption(confidentialTotalSupply());
  }
}
