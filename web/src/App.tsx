import { useState, useTransition, type FormEvent } from "react";
import { getAddress, isAddress, isHex, type Address, type Hex, type WalletClient } from "viem";
import {
  auditorCall,
  claimPayment,
  connectWallet,
  createSalt,
  isLive,
  networkLabel,
  proposeSafeCall,
  safeCall,
  submitEncryptedPayment,
} from "./lib/payroll";

type Role = "manager" | "safe" | "recipient" | "auditor";
type DemoStatus = "sealed" | "approved" | "claimed" | "audited";

const roles: Array<{ id: Role; label: string; caption: string }> = [
  { id: "manager", label: "Payroll", caption: "Seal a salary" },
  { id: "safe", label: "Safe", caption: "Approve intent" },
  { id: "recipient", label: "Recipient", caption: "Claim privately" },
  { id: "auditor", label: "Auditor", caption: "Open one record" },
];

const statusIndex: Record<DemoStatus, number> = { sealed: 0, approved: 1, claimed: 2, audited: 3 };

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Not connected";
}

function App() {
  const [role, setRole] = useState<Role>("manager");
  const [demoStatus, setDemoStatus] = useState<DemoStatus>("sealed");
  const [account, setAccount] = useState<Address>();
  const [wallet, setWallet] = useState<WalletClient>();
  const [recipient, setRecipient] = useState("");
  const [salary, setSalary] = useState("4200");
  const [memo, setMemo] = useState("Core contributor · July");
  const [paymentId, setPaymentId] = useState("0");
  const [draftSalt, setDraftSalt] = useState<Hex>(() => createSalt());
  const [claimSalt, setClaimSalt] = useState("");
  const [auditor, setAuditor] = useState("");
  const [notice, setNotice] = useState(
    isLive
      ? "Ethereum Sepolia live mode is ready. Connect the wallet for the selected role."
      : "Guided demo is ready. No wallet or funds required.",
  );
  const [isPending, startTransition] = useTransition();

  const run = (task: () => Promise<string> | string) => {
    startTransition(async () => {
      try {
        setNotice(await task());
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "The action could not be completed.");
      }
    });
  };

  const connect = () =>
    run(async () => {
      const connected = await connectWallet();
      setAccount(connected.account);
      setWallet(connected.wallet);
      return `Connected ${shortAddress(connected.account)}.`;
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    run(async () => {
      if (!isLive) {
        setClaimSalt(draftSalt);
        setDemoStatus("sealed");
        setRole("safe");
        return "Salary sealed. The Safe sees a commitment and encrypted handle only.";
      }
      if (!wallet || !account) throw new Error("Connect the payroll-manager wallet first.");
      if (!isAddress(recipient)) throw new Error("Enter a valid one-time payout address.");
      const result = await submitEncryptedPayment({
        wallet,
        account,
        recipient: getAddress(recipient),
        salary,
        memo,
        validUntil: Math.floor(Date.now() / 1000) + 86_400,
        salt: draftSalt,
      });
      setClaimSalt(draftSalt);
      setPaymentId(result.paymentId.toString());
      setRole("safe");
      return `Payment ${result.paymentId} confirmed: ${result.hash.slice(0, 10)}… Copy and save the claim secret now.`;
    });
  };

  const approve = () =>
    run(async () => {
      if (!isLive) {
        setDemoStatus("approved");
        setRole("recipient");
        return "Safe threshold reached. The committed payout address may now claim.";
      }
      const message = await proposeSafeCall(safeCall("approvePayment", BigInt(paymentId)));
      return message;
    });

  const claim = () =>
    run(async () => {
      if (!isLive) {
        setDemoStatus("claimed");
        setRole("auditor");
        return "Claim settled into a confidential ERC-7984 balance. Amount remains sealed.";
      }
      if (!wallet || !account) throw new Error("Connect the committed payout wallet first.");
      if (!isHex(claimSalt) || claimSalt.length !== 66) {
        throw new Error("Paste the 32-byte claim secret saved when the payment was created.");
      }
      const hash = await claimPayment({
        wallet,
        account,
        paymentId: BigInt(paymentId),
        salt: claimSalt,
      });
      return `Claim sent: ${hash.slice(0, 10)}…`;
    });

  const grantAudit = () =>
    run(async () => {
      if (!isLive) {
        setDemoStatus("audited");
        return "One-record access granted. Other payroll entries remain sealed.";
      }
      if (!isAddress(auditor)) throw new Error("Enter a valid auditor address.");
      return proposeSafeCall(auditorCall(BigInt(paymentId), getAddress(auditor)));
    });

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ShadowSafe home">
          <span className="brand-mark" aria-hidden="true">
            SS
          </span>
          <span>ShadowSafe</span>
        </a>
        <div className="network-state">
          <span className={`network-dot ${isLive ? "live" : "demo"}`} />
          {isLive ? networkLabel : "Guided demo"}
        </div>
        <button className="wallet-button" type="button" onClick={connect} disabled={isPending}>
          {shortAddress(account)}
        </button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Safe custody · Nox confidentiality</p>
          <h1>Payroll that signs in public and pays in confidence.</h1>
          <p className="hero-deck">
            Safe owners approve a sealed payment intent. The recipient and salary stay out of the
            approval trail; only the committed payout wallet can settle it.
          </p>
        </div>

        <article className="sealed-slip" aria-label="Sealed payroll record">
          <div className="slip-topline">
            <span>PAY / 0007</span>
            <span className="seal">NOX SEALED</span>
          </div>
          <div className="slip-row">
            <span>Recipient</span>
            <strong className="redacted">0x••••••••••••1F6A</strong>
          </div>
          <div className="slip-row salary-row">
            <span>Net salary</span>
            <strong className={demoStatus === "audited" ? "revealed" : "ciphertext"}>
              {demoStatus === "audited" ? "$4,200.00" : "E3·94·A7·1C"}
            </strong>
          </div>
          <div className="slip-footer">
            <span>Handle</span>
            <code>0x0000007a…b425e0</code>
          </div>
        </article>
      </section>

      <section className="control-room" aria-labelledby="workflow-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">One payment, four permissions</p>
            <h2 id="workflow-heading">Walk the private path</h2>
          </div>
          <p>Switch roles to see exactly what each participant controls—and what they never see.</p>
        </div>

        <div className="role-rail" role="tablist" aria-label="Payroll roles">
          {roles.map((item, index) => (
            <button
              key={item.id}
              className={role === item.id ? "role active" : "role"}
              type="button"
              role="tab"
              aria-selected={role === item.id}
              onClick={() => setRole(item.id)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.label}</strong>
              <small>{item.caption}</small>
            </button>
          ))}
        </div>

        <div className="workspace">
          <aside className="visibility-card">
            <p className="utility-label">VISIBLE TO THIS ROLE</p>
            <Visibility role={role} audited={demoStatus === "audited"} />
            <div className="permission-note">
              <span className="keyhole" aria-hidden="true" />
              Plaintext never enters the Safe transaction.
            </div>
          </aside>

          <div className="action-panel" role="tabpanel">
            {role === "manager" ? (
              <form onSubmit={submit}>
                <PanelTitle label="Prepare payment" detail="Encrypt for the payroll module" />
                <label>
                  One-time payout address
                  <input
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                    placeholder="0x…"
                    autoComplete="off"
                  />
                </label>
                <div className="field-grid">
                  <label>
                    Salary
                    <div className="money-input">
                      <span>$</span>
                      <input
                        value={salary}
                        onChange={(event) => setSalary(event.target.value)}
                        inputMode="decimal"
                      />
                    </div>
                  </label>
                  <label>
                    Payment memo
                    <input value={memo} onChange={(event) => setMemo(event.target.value)} />
                  </label>
                </div>
                <SecretField salt={draftSalt} onRotate={() => setDraftSalt(createSalt())} />
                <button className="primary-action" disabled={isPending} type="submit">
                  Seal salary request
                </button>
              </form>
            ) : null}

            {role === "safe" ? (
              <div>
                <PanelTitle label="Approve intent" detail="Safe threshold required" />
                <RecordSummary
                  paymentId={paymentId}
                  setPaymentId={setPaymentId}
                  status="Awaiting owners"
                />
                <div className="safe-callout">
                  <strong>What owners approve</strong>
                  <span>Recipient commitment</span>
                  <code>0x9c21…d81a</code>
                  <span>Encrypted amount handle</span>
                  <code>0x0000007a…b425e0</code>
                </div>
                <button
                  className="primary-action"
                  disabled={isPending}
                  type="button"
                  onClick={approve}
                >
                  Propose Safe approval
                </button>
              </div>
            ) : null}

            {role === "recipient" ? (
              <div>
                <PanelTitle label="Claim salary" detail="Only the committed address succeeds" />
                <RecordSummary
                  paymentId={paymentId}
                  setPaymentId={setPaymentId}
                  status={demoStatus === "approved" ? "Ready to claim" : "Check approval"}
                />
                <ClaimSecretField value={claimSalt} onChange={setClaimSalt} />
                <p className="form-help">
                  Connect the one-time payout wallet. The claim address becomes public; the amount
                  does not.
                </p>
                <button
                  className="primary-action"
                  disabled={isPending}
                  type="button"
                  onClick={claim}
                >
                  Claim confidential balance
                </button>
              </div>
            ) : null}

            {role === "auditor" ? (
              <div>
                <PanelTitle label="Open one record" detail="Safe-controlled disclosure" />
                <RecordSummary
                  paymentId={paymentId}
                  setPaymentId={setPaymentId}
                  status="Claimed · sealed"
                />
                <label>
                  Auditor address
                  <input
                    value={auditor}
                    onChange={(event) => setAuditor(event.target.value)}
                    placeholder="0x…"
                  />
                </label>
                <p className="form-help">
                  The grant is scoped to this payment handle. Nox grants are additive and should be
                  treated as irreversible.
                </p>
                <button
                  className="primary-action"
                  disabled={isPending}
                  type="button"
                  onClick={grantAudit}
                >
                  Grant record access
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="notice" aria-live="polite">
          <span>{isPending ? "WORKING" : "STATUS"}</span>
          {notice}
        </div>
      </section>

      <section className="proof-strip" aria-label="Privacy guarantees">
        <div>
          <strong>Safe retains custody</strong>
          <span>Operator access expires</span>
        </div>
        <div>
          <strong>Amount stays encrypted</strong>
          <span>Nox euint256 handle</span>
        </div>
        <div>
          <strong>Recipient commits first</strong>
          <span>Address revealed at claim</span>
        </div>
        <div>
          <strong>Audit is selective</strong>
          <span>One handle, one permission</span>
        </div>
      </section>

      <footer>
        <span>ShadowSafe Payroll · Hackathon software, not audited</span>
        <a href="https://docs.iex.ec" target="_blank" rel="noreferrer">
          Built with iExec Nox ↗
        </a>
      </footer>
    </main>
  );
}

function PanelTitle({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="panel-title">
      <div>
        <p className="utility-label">CURRENT ACTION</p>
        <h3>{label}</h3>
      </div>
      <span>{detail}</span>
    </div>
  );
}

function RecordSummary({
  paymentId,
  setPaymentId,
  status,
}: {
  paymentId: string;
  setPaymentId: (value: string) => void;
  status: string;
}) {
  return (
    <div className="record-summary">
      <label>
        Payment ID
        <input
          value={paymentId}
          onChange={(event) => setPaymentId(event.target.value)}
          inputMode="numeric"
        />
      </label>
      <div>
        <span>Status</span>
        <strong>{status}</strong>
      </div>
    </div>
  );
}

function SecretField({ salt, onRotate }: { salt: Hex; onRotate: () => void }) {
  const copy = async () => navigator.clipboard.writeText(salt);

  return (
    <div className="secret-field">
      <div>
        <span>Claim secret</span>
        <code>
          {salt.slice(0, 18)}…{salt.slice(-8)}
        </code>
      </div>
      <div className="secret-actions">
        <button type="button" onClick={copy}>
          Copy
        </button>
        <button type="button" onClick={onRotate}>
          Rotate
        </button>
      </div>
    </div>
  );
}

function ClaimSecretField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="claim-secret-field">
      Claim secret
      <input
        value={value}
        onChange={(event) => onChange(event.target.value.trim())}
        placeholder="0x + 64 hexadecimal characters"
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}

function Visibility({ role, audited }: { role: Role; audited: boolean }) {
  const items = {
    manager: [
      ["Salary input", "plaintext"],
      ["Recipient", "plaintext"],
      ["Safe balance", "sealed"],
    ],
    safe: [
      ["Salary", "sealed"],
      ["Recipient", "commitment"],
      ["Approval", "public"],
    ],
    recipient: [
      ["Own salary", "decryptable"],
      ["Other salaries", "sealed"],
      ["Safe policy", "public"],
    ],
    auditor: [
      ["Selected salary", audited ? "decryptable" : "sealed"],
      ["Other records", "sealed"],
      ["Grant event", "public"],
    ],
  }[role];
  return (
    <ul className="visibility-list">
      {items.map(([label, state]) => (
        <li key={label}>
          <span>{label}</span>
          <strong className={`state-${state}`}>{state}</strong>
        </li>
      ))}
    </ul>
  );
}

export default App;
