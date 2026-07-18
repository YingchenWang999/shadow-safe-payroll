import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createViemHandleClient, type Handle } from "@iexec-nox/handle";
import { handleGatewayUrl, NOX_COMPUTE_ADDRESS, nox, RPC_URL } from "@iexec-nox/nox-hardhat-plugin";
import {
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  maxUint48,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

type PaymentRecord = {
  recipientCommitment: Hex;
  memoHash: Hex;
  requestedAmount: Handle<"uint256">;
  settledAmount: Handle<"uint256">;
  validUntil: number;
  status: number;
};

const tokenAbi = parseAbi(["function setOperator(address operator, uint48 until)"]);

const payrollAbi = parseAbi([
  "function approvePayment(uint256 paymentId)",
  "function cancelPayment(uint256 paymentId)",
  "function grantAuditor(uint256 paymentId, address auditor)",
  "function setPayrollManager(address newManager)",
]);

const INITIAL_SUPPLY = 10_000n;
const SALARY = 1_250n;
const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";
const localChain = defineChain({
  id: 31_337,
  name: "Nox local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

function localWallet(addressIndex: number) {
  return createWalletClient({
    account: mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex }),
    chain: localChain,
    transport: http(RPC_URL),
  });
}

async function decryptWithRetry(
  client: Awaited<ReturnType<typeof createViemHandleClient>>,
  handle: Handle<"uint256">,
): Promise<bigint> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const result = await client.decrypt(handle);
      return result.value as bigint;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw lastError;
}

function recipientCommitment(recipient: Address, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("address payoutAddress, bytes32 secretSalt"), [
      recipient,
      salt,
    ]),
  );
}

describe("ShadowSafePayroll end-to-end", () => {
  it(
    "requires Safe approval, hides the amount, pays the committed recipient, and grants scoped audit access",
    { timeout: 240_000 },
    async () => {
      const { viem } = await nox.connect();
      const [manager, recipient, auditor, outsider] = await viem.getWalletClients();
      const publicClient = await viem.getPublicClient();

      const safe = await viem.deployContract("MockSafe", [manager.account.address]);
      const token = await viem.deployContract("DemoConfidentialUSD", [
        safe.address,
        INITIAL_SUPPLY,
      ]);
      const payroll = await viem.deployContract("ShadowSafePayroll", [
        safe.address,
        token.address,
        manager.account.address,
      ]);

      const operatorData = encodeFunctionData({
        abi: tokenAbi,
        functionName: "setOperator",
        args: [payroll.address, Number(maxUint48)],
      });
      await safe.write.execute([token.address, operatorData]);
      assert.equal(
        await token.read.isOperator([safe.address, payroll.address]),
        true,
        "the Safe must explicitly delegate confidential-token spending",
      );

      const salt = keccak256(stringToHex("recipient-only-secret"));
      const commitment = recipientCommitment(recipient.account.address, salt);
      const latestBlock = await publicClient.getBlock();
      const validUntil = Number(latestBlock.timestamp + 86_400n);
      const memoHash = keccak256(stringToHex("July payroll batch / invoice #42"));
      const encrypted = await nox.encryptInput(SALARY, "uint256", payroll.address);

      await payroll.write.submitPayment([
        commitment,
        encrypted.handle,
        encrypted.handleProof,
        memoHash,
        validUntil,
      ]);

      const submitted = (await payroll.read.getPayment([0n])) as PaymentRecord;
      assert.equal(submitted.status, 1, "new payment should be Pending");
      assert.notEqual(
        submitted.requestedAmount,
        `0x${SALARY.toString(16).padStart(64, "0")}`,
        "storage exposes a handle rather than the plaintext salary",
      );
      assert.equal(
        await payroll.read.canDecryptRequestedAmount([0n, outsider.account.address]),
        false,
        "an unrelated account must not receive ACL access",
      );

      await assert.rejects(
        payroll.write.claimPayment([0n, salt], { account: recipient.account }),
        /revert|InvalidStatus/i,
        "the recipient cannot claim before Safe approval",
      );

      const approveData = encodeFunctionData({
        abi: payrollAbi,
        functionName: "approvePayment",
        args: [0n],
      });
      await safe.write.execute([payroll.address, approveData]);

      const revokeOperatorData = encodeFunctionData({
        abi: tokenAbi,
        functionName: "setOperator",
        args: [payroll.address, 0],
      });
      await safe.write.execute([token.address, revokeOperatorData]);
      await assert.rejects(
        payroll.write.claimPayment([0n, salt], { account: recipient.account }),
        /revert|ModuleNotTokenOperator/i,
        "claim must fail cleanly if the Safe's operator grant has expired or been revoked",
      );
      assert.equal(
        ((await payroll.read.getPayment([0n])) as PaymentRecord).status,
        2,
        "a failed claim must remain Approved",
      );
      await safe.write.execute([token.address, operatorData]);

      await assert.rejects(
        payroll.write.claimPayment([0n, salt], { account: outsider.account }),
        /revert|CommitmentMismatch/i,
        "knowing the salt is insufficient when the payout address does not match",
      );

      await payroll.write.claimPayment([0n, salt], { account: recipient.account });
      const claimed = (await payroll.read.getPayment([0n])) as PaymentRecord;
      assert.equal(claimed.status, 3, "payment should be Claimed");
      assert.equal(
        await payroll.read.canDecryptSettledAmount([0n, recipient.account.address]),
        true,
        "the committed recipient receives ACL access to the settled amount",
      );
      assert.equal(
        await payroll.read.canDecryptSettledAmount([0n, outsider.account.address]),
        false,
        "unrelated accounts remain unable to decrypt the settlement",
      );
      await assert.rejects(
        payroll.write.claimPayment([0n, salt], { account: recipient.account }),
        /revert|InvalidStatus/i,
        "a settled payment cannot be claimed twice",
      );

      const recipientSdkWallet = localWallet(1);
      assert.equal(
        recipientSdkWallet.account.address.toLowerCase(),
        recipient.account.address.toLowerCase(),
      );
      const recipientClient = await createViemHandleClient(recipientSdkWallet, {
        smartContractAddress: NOX_COMPUTE_ADDRESS,
        gatewayUrl: handleGatewayUrl(),
        subgraphUrl: "https://example.com/subgraphs/id/none",
      });
      const recipientBalance = (await token.read.confidentialBalanceOf([
        recipient.account.address,
      ])) as Handle<"uint256">;
      assert.equal(
        await decryptWithRetry(recipientClient, recipientBalance),
        SALARY,
        "the recipient's confidential token balance should equal the salary",
      );

      const grantData = encodeFunctionData({
        abi: payrollAbi,
        functionName: "grantAuditor",
        args: [0n, auditor.account.address],
      });
      await safe.write.execute([payroll.address, grantData]);
      assert.equal(
        await payroll.read.canDecryptSettledAmount([0n, auditor.account.address]),
        true,
        "the Safe can grant access to one selected auditor",
      );

      const auditorSdkWallet = localWallet(2);
      assert.equal(
        auditorSdkWallet.account.address.toLowerCase(),
        auditor.account.address.toLowerCase(),
      );
      const auditorClient = await createViemHandleClient(auditorSdkWallet, {
        smartContractAddress: NOX_COMPUTE_ADDRESS,
        gatewayUrl: handleGatewayUrl(),
        subgraphUrl: "https://example.com/subgraphs/id/none",
      });
      assert.equal(
        await decryptWithRetry(auditorClient, claimed.settledAmount as Handle<"uint256">),
        SALARY,
        "the designated auditor should decrypt exactly the settled payment",
      );
    },
  );

  it(
    "rejects manager bypasses and lets the Safe cancel an approved payment",
    { timeout: 180_000 },
    async () => {
      const { viem } = await nox.connect();
      const [manager, recipient, outsider] = await viem.getWalletClients();
      const publicClient = await viem.getPublicClient();
      const safe = await viem.deployContract("MockSafe", [manager.account.address]);
      const token = await viem.deployContract("DemoConfidentialUSD", [
        safe.address,
        INITIAL_SUPPLY,
      ]);
      const payroll = await viem.deployContract("ShadowSafePayroll", [
        safe.address,
        token.address,
        manager.account.address,
      ]);
      const encrypted = await nox.encryptInput(SALARY, "uint256", payroll.address);
      const salt = keccak256(stringToHex("cancelled-payment"));
      const block = await publicClient.getBlock();

      await assert.rejects(
        payroll.write.submitPayment([
          `0x${"00".repeat(32)}`,
          encrypted.handle,
          encrypted.handleProof,
          keccak256(stringToHex("invalid commitment")),
          Number(block.timestamp + 3_600n),
        ]),
        /revert|InvalidCommitment/i,
      );

      await assert.rejects(
        payroll.write.submitPayment([
          recipientCommitment(recipient.account.address, salt),
          encrypted.handle,
          encrypted.handleProof,
          keccak256(stringToHex("expired")),
          Number(block.timestamp),
        ]),
        /revert|InvalidExpiry/i,
      );

      await assert.rejects(
        payroll.write.submitPayment(
          [
            recipientCommitment(recipient.account.address, salt),
            encrypted.handle,
            encrypted.handleProof,
            keccak256(stringToHex("unauthorized")),
            Number(block.timestamp + 3_600n),
          ],
          { account: outsider.account },
        ),
        /revert|OnlyPayrollManager/i,
      );

      await payroll.write.submitPayment([
        recipientCommitment(recipient.account.address, salt),
        encrypted.handle,
        encrypted.handleProof,
        keccak256(stringToHex("cancel me")),
        Number(block.timestamp + 3_600n),
      ]);

      await assert.rejects(
        payroll.write.approvePayment([0n]),
        /revert|OnlySafe/i,
        "the payroll manager cannot approve directly",
      );

      await assert.rejects(
        payroll.write.cancelPayment([0n]),
        /revert|OnlySafe/i,
        "even the payroll manager cannot cancel without a Safe transaction",
      );

      const approveData = encodeFunctionData({
        abi: payrollAbi,
        functionName: "approvePayment",
        args: [0n],
      });
      await assert.rejects(
        safe.write.execute([payroll.address, approveData]),
        /revert|ExecutionFailed|ModuleNotTokenOperator/i,
        "approval must fail until the Safe explicitly grants token operator access",
      );

      const cancelData = encodeFunctionData({
        abi: payrollAbi,
        functionName: "cancelPayment",
        args: [0n],
      });
      await safe.write.execute([payroll.address, cancelData]);
      assert.equal(((await payroll.read.getPayment([0n])) as PaymentRecord).status, 4);

      await assert.rejects(
        payroll.write.claimPayment([0n, salt], { account: recipient.account }),
        /revert|InvalidStatus/i,
      );

      const managerData = encodeFunctionData({
        abi: payrollAbi,
        functionName: "setPayrollManager",
        args: [outsider.account.address],
      });
      await safe.write.execute([payroll.address, managerData]);
      assert.equal(
        ((await payroll.read.payrollManager()) as Address).toLowerCase(),
        outsider.account.address.toLowerCase(),
      );

      await assert.rejects(
        payroll.write.submitPayment([
          recipientCommitment(recipient.account.address, salt),
          encrypted.handle,
          encrypted.handleProof,
          keccak256(stringToHex("old manager")),
          Number(block.timestamp + 7_200n),
        ]),
        /revert|OnlyPayrollManager/i,
        "the previous manager loses submission authority immediately",
      );

      await assert.rejects(
        safe.write.execute([
          payroll.address,
          encodeFunctionData({
            abi: payrollAbi,
            functionName: "grantAuditor",
            args: [99n, outsider.account.address],
          }),
        ]),
        /revert|ExecutionFailed|InvalidStatus/i,
        "audit access cannot be granted for a nonexistent payment",
      );
    },
  );
});
