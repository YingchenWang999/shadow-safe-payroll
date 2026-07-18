// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
  Nox,
  euint256,
  externalEuint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {IConfidentialToken} from "./interfaces/IConfidentialToken.sol";

/// @title ShadowSafePayroll
/// @notice Safe-controlled confidential payroll for an ERC-7984 treasury.
/// @dev The Safe keeps custody of the token and grants this contract a time-bounded
///      ERC-7984 operator permission. A payroll manager submits an encrypted amount
///      and a recipient commitment. The Safe must approve each payment before the
///      committed recipient can claim it.
///
/// Privacy boundary:
/// - the amount is a Nox encrypted handle and is never emitted as plaintext;
/// - the recipient is represented by a commitment until claim;
/// - claim reveals a payout address, so a fresh stealth-style address is recommended;
/// - payment timing, Safe address, module address, token address, and claim address
///   remain public blockchain metadata.
contract ShadowSafePayroll is ReentrancyGuard {
  enum PaymentStatus {
    None,
    Pending,
    Approved,
    Claimed,
    Cancelled
  }

  struct Payment {
    bytes32 recipientCommitment;
    bytes32 memoHash;
    euint256 requestedAmount;
    euint256 settledAmount;
    uint48 validUntil;
    PaymentStatus status;
  }

  error OnlySafe(address caller);
  error OnlyPayrollManager(address caller);
  error InvalidAddress();
  error InvalidCommitment();
  error InvalidExpiry(uint48 validUntil);
  error InvalidStatus(uint256 paymentId, PaymentStatus expected, PaymentStatus actual);
  error PaymentExpired(uint256 paymentId, uint48 validUntil);
  error CommitmentMismatch(uint256 paymentId);
  error ModuleNotTokenOperator();

  event PayrollManagerUpdated(address indexed previousManager, address indexed newManager);
  event PaymentSubmitted(
    uint256 indexed paymentId,
    bytes32 indexed recipientCommitment,
    bytes32 indexed memoHash,
    uint48 validUntil
  );
  event PaymentApproved(uint256 indexed paymentId);
  event PaymentCancelled(uint256 indexed paymentId);
  event PaymentClaimed(uint256 indexed paymentId, address indexed payoutAddress);
  event AuditorGranted(uint256 indexed paymentId, address indexed auditor);

  address public immutable safe;
  IConfidentialToken public immutable confidentialToken;
  address public payrollManager;
  uint256 public paymentCount;

  mapping(uint256 paymentId => Payment) private _payments;

  modifier onlySafe() {
    if (msg.sender != safe) revert OnlySafe(msg.sender);
    _;
  }

  modifier onlyPayrollManager() {
    if (msg.sender != payrollManager) revert OnlyPayrollManager(msg.sender);
    _;
  }

  constructor(address safe_, address confidentialToken_, address payrollManager_) {
    if (safe_ == address(0) || confidentialToken_ == address(0) || payrollManager_ == address(0)) {
      revert InvalidAddress();
    }
    safe = safe_;
    confidentialToken = IConfidentialToken(confidentialToken_);
    payrollManager = payrollManager_;
  }

  /// @notice Commits an encrypted payment for later Safe approval.
  /// @param recipientCommitment keccak256(abi.encode(payoutAddress, secretSalt)).
  /// @param encryptedAmount Nox handle encrypted for this module by the payroll manager.
  /// @param inputProof Gateway proof paired with encryptedAmount.
  /// @param memoHash Public hash of an off-chain invoice or payroll memo.
  /// @param validUntil Final timestamp at which the recipient may claim.
  function submitPayment(
    bytes32 recipientCommitment,
    externalEuint256 encryptedAmount,
    bytes calldata inputProof,
    bytes32 memoHash,
    uint48 validUntil
  ) external onlyPayrollManager returns (uint256 paymentId) {
    if (recipientCommitment == bytes32(0)) revert InvalidCommitment();
    if (validUntil <= block.timestamp) revert InvalidExpiry(validUntil);

    euint256 amount = Nox.fromExternal(encryptedAmount, inputProof);
    Nox.allowThis(amount);

    paymentId = paymentCount++;
    _payments[paymentId] = Payment({
      recipientCommitment: recipientCommitment,
      memoHash: memoHash,
      requestedAmount: amount,
      settledAmount: euint256.wrap(bytes32(0)),
      validUntil: validUntil,
      status: PaymentStatus.Pending
    });

    emit PaymentSubmitted(paymentId, recipientCommitment, memoHash, validUntil);
  }

  /// @notice Approves a pending payment. Must be executed by the Safe.
  function approvePayment(uint256 paymentId) external onlySafe {
    Payment storage payment = _payments[paymentId];
    _requireStatus(paymentId, payment.status, PaymentStatus.Pending);
    if (block.timestamp > payment.validUntil) {
      revert PaymentExpired(paymentId, payment.validUntil);
    }
    if (!confidentialToken.isOperator(safe, address(this))) {
      revert ModuleNotTokenOperator();
    }

    payment.status = PaymentStatus.Approved;
    emit PaymentApproved(paymentId);
  }

  /// @notice Cancels a pending or approved payment. Must be executed by the Safe.
  function cancelPayment(uint256 paymentId) external onlySafe {
    Payment storage payment = _payments[paymentId];
    if (payment.status != PaymentStatus.Pending && payment.status != PaymentStatus.Approved) {
      revert InvalidStatus(paymentId, PaymentStatus.Pending, payment.status);
    }
    payment.status = PaymentStatus.Cancelled;
    emit PaymentCancelled(paymentId);
  }

  /// @notice Claims an approved payment into the caller's confidential token balance.
  /// @dev Use a fresh payout address if unlinkability from the employee's public wallet matters.
  function claimPayment(uint256 paymentId, bytes32 secretSalt) external nonReentrant {
    Payment storage payment = _payments[paymentId];
    _requireStatus(paymentId, payment.status, PaymentStatus.Approved);
    if (block.timestamp > payment.validUntil) {
      revert PaymentExpired(paymentId, payment.validUntil);
    }
    if (keccak256(abi.encode(msg.sender, secretSalt)) != payment.recipientCommitment) {
      revert CommitmentMismatch(paymentId);
    }
    if (!confidentialToken.isOperator(safe, address(this))) {
      revert ModuleNotTokenOperator();
    }

    // Effects precede the token call. A revert restores the Approved status.
    payment.status = PaymentStatus.Claimed;

    // The module owns persistent ACL permission for the submitted amount. The
    // token needs permission only for this transaction to perform its TEE update.
    Nox.allowTransient(payment.requestedAmount, address(confidentialToken));
    euint256 transferred = confidentialToken.confidentialTransferFrom(
      safe,
      msg.sender,
      payment.requestedAmount
    );

    payment.settledAmount = transferred;
    Nox.allowThis(transferred);
    Nox.allow(transferred, msg.sender);

    emit PaymentClaimed(paymentId, msg.sender);
  }

  /// @notice Grants an auditor permission to decrypt one payment only.
  /// @dev Nox currently exposes additive persistent ACL grants. Treat this as irreversible.
  function grantAuditor(uint256 paymentId, address auditor) external onlySafe {
    if (auditor == address(0)) revert InvalidAddress();
    Payment storage payment = _payments[paymentId];
    if (payment.status == PaymentStatus.None) {
      revert InvalidStatus(paymentId, PaymentStatus.Pending, payment.status);
    }

    Nox.allow(payment.requestedAmount, auditor);
    if (Nox.isInitialized(payment.settledAmount)) {
      Nox.allow(payment.settledAmount, auditor);
    }
    emit AuditorGranted(paymentId, auditor);
  }

  /// @notice Changes the operational payroll manager. Must be executed by the Safe.
  function setPayrollManager(address newManager) external onlySafe {
    if (newManager == address(0)) revert InvalidAddress();
    address previousManager = payrollManager;
    payrollManager = newManager;
    emit PayrollManagerUpdated(previousManager, newManager);
  }

  function getPayment(uint256 paymentId) external view returns (Payment memory) {
    return _payments[paymentId];
  }

  function canDecryptRequestedAmount(
    uint256 paymentId,
    address account
  ) external view returns (bool) {
    return Nox.isAllowed(_payments[paymentId].requestedAmount, account);
  }

  function canDecryptSettledAmount(
    uint256 paymentId,
    address account
  ) external view returns (bool) {
    Payment storage record = _payments[paymentId];
    return Nox.isInitialized(record.settledAmount) && Nox.isAllowed(record.settledAmount, account);
  }

  function computeRecipientCommitment(
    address payoutAddress,
    bytes32 secretSalt
  ) external pure returns (bytes32) {
    return keccak256(abi.encode(payoutAddress, secretSalt));
  }

  function _requireStatus(
    uint256 paymentId,
    PaymentStatus actual,
    PaymentStatus expected
  ) private pure {
    if (actual != expected) revert InvalidStatus(paymentId, expected, actual);
  }
}
