// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/// @notice Minimal Safe-shaped call executor for local integration tests only.
/// @dev This is not a replacement for Safe and must never be deployed as a treasury.
contract MockSafe {
  error OnlyOwner(address caller);
  error ExecutionFailed(bytes returnData);

  address public immutable owner;

  constructor(address owner_) {
    owner = owner_;
  }

  function execute(address target, bytes calldata data) external returns (bytes memory result) {
    if (msg.sender != owner) revert OnlyOwner(msg.sender);
    (bool success, bytes memory returnData) = target.call(data);
    if (!success) revert ExecutionFailed(returnData);
    return returnData;
  }
}
