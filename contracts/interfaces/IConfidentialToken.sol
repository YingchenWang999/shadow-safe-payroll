// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

/// @notice Narrow ERC-7984 interface used by the payroll module.
interface IConfidentialToken {
  function isOperator(address holder, address operator) external view returns (bool);

  function confidentialTransferFrom(
    address from,
    address to,
    euint256 amount
  ) external returns (euint256 transferred);
}
