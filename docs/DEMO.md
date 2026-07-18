# Four-minute demo

1. Show a Safe holding the demo ERC-7984 confidential asset.
2. Show the Safe transaction that grants the module a short-lived operator permission.
3. As payroll manager, generate a fresh payout address and 32-byte secret, copy the secret to a secure handoff,
   then submit an encrypted salary.
4. Open the block explorer and show that the request contains a Nox handle and recipient commitment, not a plaintext salary or employee address.
5. Approve the request through the Safe.
6. Attempt a claim from the wrong address and show the revert.
7. Claim from the committed one-time payout address by pasting the saved secret.
8. Decrypt the recipient's confidential token balance and show the expected salary.
9. Show that an unrelated account cannot decrypt it.
10. Grant one auditor access through the Safe and decrypt only that payment as the auditor.

Do not describe the claim address as invisible. It is hidden during preparation and approval, then becomes
public at settlement. The one-time-address workflow reduces identity linkage but does not erase chain metadata.
Fund the confidential treasury before the demo: an insufficient encrypted balance produces an encrypted zero
settlement rather than a public insufficient-balance revert.
