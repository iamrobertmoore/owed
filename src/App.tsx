import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import type { Id } from "../convex/_generated/dataModel";
import { api } from "../convex/_generated/api";
import { Mark } from "./Brand";
import { ClaimSheet } from "./ClaimSheet";
import {
  ago,
  day,
  isClosed,
  isRecovered,
  kindLabel,
  money,
  stageLabel,
  until,
} from "./format";

export default function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) {
    return (
      <div className="shell">
        <div className="loading">Opening the ledger...</div>
      </div>
    );
  }
  if (!isAuthenticated) return <SignIn />;
  return <Ledger />;
}

/* ------------------------------------------------------------------ gate -- */

/**
 * Turn whatever Convex Auth throws into something a person can act on.
 *
 * The raw messages are stack-trace shaped, and a deployment missing its auth
 * keys should say so rather than showing a jose import error to a visitor.
 */
function friendlyAuthError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/pkcs8|JWKS|JWT_PRIVATE_KEY|jose/i.test(raw)) {
    return "This deployment has not been finished: its auth signing keys are missing. Run npx @convex-dev/auth against it.";
  }
  if (/already exists|already registered|already in use/i.test(raw)) {
    return "That email already has an account. Sign in instead.";
  }
  if (/InvalidSecret|InvalidAccountId|invalid password|Invalid password/i.test(raw)) {
    return "That email and password did not match.";
  }
  if (/Password|password/i.test(raw) && /length|short|weak/i.test(raw)) {
    return "That password is too short.";
  }
  return "Could not start a session. Please try again.";
}

function SignIn() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<"signUp" | "signIn">("signUp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function guest() {
    setBusy(true);
    setError(null);
    try {
      await signIn("anonymous");
    } catch (e) {
      setError(friendlyAuthError(e));
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn("password", { email, password, flow: mode });
    } catch (err) {
      setError(friendlyAuthError(err));
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <div className="signin">
        <h1>Owed</h1>
        <p>
          Your agent gets its own email address. The paper trail goes there, and it goes
          and gets what you are owed.
        </p>

        <button className="act primary" onClick={guest} disabled={busy} type="button">
          {busy ? "Starting..." : "Continue as a guest"}
        </button>
        <p style={{ margin: "10px 0 22px", fontSize: 13 }}>
          No account, no password. The guest session is a real one: its own ledger, its own
          address, its own claims.
        </p>

        <form onSubmit={submit}>
          <input
            className="field"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="field"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button className="act ghost" type="submit" disabled={busy}>
            {mode === "signUp" ? "Create an account" : "Sign in"}
          </button>
        </form>

        <p style={{ margin: "14px 0 0", fontSize: 13 }}>
          <button
            type="button"
            onClick={() => setMode(mode === "signUp" ? "signIn" : "signUp")}
            style={{
              background: "none",
              border: 0,
              padding: 0,
              font: "inherit",
              color: "var(--recovered)",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {mode === "signUp" ? "I already have an account" : "Create one instead"}
          </button>
        </p>

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- ledger -- */

/**
 * A claim can be linked to directly, so a case can be handed to someone as a
 * URL rather than described.
 *
 * `#claim=<id>` opens a claim in this ledger. `#claim=demo-found` opens the
 * worked example. The slug form is the one that matters for a link in a
 * README: a Convex id belongs to whoever created the row, so an id in a link
 * is dead for everybody else, while a slug resolves against whoever is
 * looking.
 */
function claimKeyFromHash(): string | null {
  const match = window.location.hash.match(/claim=([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

/** Convex ids are lowercase alphanumeric. A slug carries a hyphen. */
function looksLikeClaimId(key: string): boolean {
  return /^[a-z0-9]{20,}$/.test(key);
}

function Ledger() {
  const { signOut } = useAuthActions();
  const ledger = useQuery(api.claims.ledger);
  const records = useQuery(api.records.list);
  const spend = useQuery(api.claims.spend);
  const inbox = useQuery(api.inboxes.mine);
  const provision = useAction(api.inboxes.provision);
  const seedExample = useMutation(api.example.seedExample);

  const [hashKey, setHashKey] = useState<string | null>(() => claimKeyFromHash());
  const [addressError, setAddressError] = useState<string | null>(null);
  const asked = useRef(false);
  const seeded = useRef(false);

  // A slug is resolved against this visitor's own copy of the worked example.
  const slug = hashKey !== null && !looksLikeClaimId(hashKey) ? hashKey : null;
  const resolvedDemo = useQuery(api.claims.byDemoKey, slug ? { demoKey: slug } : "skip");

  const selected: Id<"claims"> | null =
    hashKey === null
      ? null
      : looksLikeClaimId(hashKey)
        ? (hashKey as Id<"claims">)
        : resolvedDemo ?? null;

  // The URL is the source of truth for which sheet is open, so the back button
  // and a pasted link both behave.
  useEffect(() => {
    const onHash = () => setHashKey(claimKeyFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function open(id: Id<"claims">) {
    window.location.hash = `claim=${id}`;
  }

  function close() {
    // replaceState rather than assigning: closing should not add a history
    // entry that reopens the sheet when someone presses back.
    window.history.replaceState(null, "", window.location.pathname);
    setHashKey(null);
  }

  // One address per person, created the first time they arrive. The free tier
  // allows three, so this is guarded rather than called on every render.
  useEffect(() => {
    if (asked.current) return;
    if (inbox !== null) return;
    asked.current = true;
    provision()
      .then((r) => {
        if ("error" in r) setAddressError(r.error);
      })
      .catch((e: unknown) =>
        setAddressError(e instanceof Error ? e.message : "Could not open an address"),
      );
  }, [inbox, provision]);

  // A guest arrives to an empty ledger, because every claim is scoped to its
  // owner. Seed the worked example so there is something to look at. The
  // server refuses unless this is a guest with nothing in the ledger, so
  // calling it is safe, idempotent, and costs nothing.
  useEffect(() => {
    if (seeded.current) return;
    if (!ledger) return;
    if (ledger.claims.length > 0) return;
    seeded.current = true;
    void seedExample({});
  }, [ledger, seedExample]);

  const totals = ledger?.totals;
  // A guest's ledger is the seeded worked example. The UI has to be able to
  // tell, so it can label provenance rather than assert it.
  const isExample = (ledger?.claims ?? []).some((c) => c.demoKey !== undefined);

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <Mark />
          <span className="name">Owed</span>
        </div>
        <button className="act ghost" onClick={() => void signOut()} type="button">
          Sign out
        </button>
      </header>

      <div className="totals">
        <div>
          <div className="label">Recovered</div>
          <div className="value recovered">
            {money(totals?.recovered, totals?.currency)}
          </div>
          <div className="sub">
            {totals?.settled ?? 0} of {totals?.count ?? 0} claims settled in writing
          </div>
        </div>
        <div>
          <div className="label">Still owed</div>
          <div className="value" style={{ color: "var(--owed)" }}>
            {money(
              Math.max((totals?.claimed ?? 0) - (totals?.recovered ?? 0), 0),
              totals?.currency,
            )}
          </div>
          <div className="sub">{totals?.open ?? 0} claims open</div>
        </div>
        <div>
          <div className="label">Found</div>
          <div className="value">{totals?.count ?? 0}</div>
          <div className="sub">
            from {records?.length ?? 0} pieces of paper
          </div>
        </div>
      </div>

      <AddressPanel address={inbox?.address} shared={inbox?.shared} error={addressError} />

      <section>
        <div className="section-head">
          <h2>Claims</h2>
          <span className="count">
            {totals?.count ? `${totals.count} found` : "nothing yet"}
          </span>
        </div>

        {!ledger ? (
          <div className="loading">Reading the ledger...</div>
        ) : ledger.claims.length === 0 ? (
          <div className="empty">
            <strong>Nothing owed yet.</strong>
            Forward an order confirmation, a booking, a delivery promise or a renewal notice
            to the address above. The agent reads it, reads the company's own published terms,
            and tells you if something is owed.
            <div style={{ marginTop: 12, fontSize: 13.5 }}>
              It will not invent a claim to fill this space. A claim only exists when a
              specific clause commits them to a specific remedy.
            </div>
          </div>
        ) : (
          <div className="rows">
            {ledger.claims.map((claim) => {
              const recovered = isRecovered(claim.stage);
              const closed = isClosed(claim.stage);
              return (
                <button
                  key={claim._id}
                  className="row"
                  onClick={() => open(claim._id)}
                  type="button"
                >
                  <span
                    className={`dot ${recovered ? "recovered" : closed ? "quiet" : ""}`}
                  />
                  <span>
                    <span className="title">
                      {claim.title}
                      {claim.demoKey ? <span className="chip">worked example</span> : null}
                    </span>
                    <span className="meta">
                      <span>{claim.counterpartyName}</span>
                      <span>·</span>
                      <span>{stageLabel(claim.stage)}</span>
                      {claim.nextActionAt ? (
                        <>
                          <span>·</span>
                          <span>next step {until(claim.nextActionAt)}</span>
                        </>
                      ) : null}
                      {claim.settledAt ? (
                        <>
                          <span>·</span>
                          <span>settled {ago(claim.settledAt)}</span>
                        </>
                      ) : null}
                    </span>
                  </span>
                  <span
                    className={`amount ${recovered ? "recovered" : closed ? "" : "owed"}`}
                  >
                    {money(claim.amountRecovered ?? claim.amountClaimed, claim.currency)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {records && records.length > 0 && (
        <section style={{ marginTop: 48 }}>
          <div className="section-head">
            <h2>Paper trail</h2>
            <span className="count">
              {records.length} record{records.length === 1 ? "" : "s"}
              {/*
                "all from real mail" is true for a real account and false for
                the worked example, so it cannot be unconditional. Claiming a
                provenance the data does not have is the exact failure this
                product exists to catch.
              */}
              {isExample ? ", from the worked example" : ", all from real mail"}
            </span>
          </div>
          <div className="rows">
            {records.map((record) => (
              <div key={record._id} className="row" style={{ cursor: "default" }}>
                <span className="dot quiet" />
                <span>
                  <span className="title">{record.description}</span>
                  <span className="meta">
                    <span>{kindLabel(record.kind)}</span>
                    <span>·</span>
                    <span>{record.counterpartyName}</span>
                    {record.reference ? (
                      <>
                        <span>·</span>
                        <span>{record.reference}</span>
                      </>
                    ) : null}
                    {record.dueAt ? (
                      <>
                        <span>·</span>
                        <span>due {day(record.dueAt)}</span>
                      </>
                    ) : null}
                  </span>
                </span>
                <span className="amount">{money(record.amount, record.currency)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="spend">
        {spend
          ? `${spend.distinctCalls} distinct model calls, ${(
              spend.inputTokens + spend.outputTokens + spend.embeddingTokens
            ).toLocaleString("en-GB")} tokens, $${spend.usd.toFixed(4)} of OpenAI spend on this deployment. ${spend.note}`
          : "Counting what this has cost..."}
      </div>

      {selected && <ClaimSheet claimId={selected} onClose={close} />}
    </div>
  );
}

/* --------------------------------------------------------------- address -- */

function AddressPanel({
  address,
  shared,
  error,
}: {
  address?: string;
  shared?: boolean;
  error: string | null;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused. The address is on screen and
      // selectable either way, so there is nothing to recover from.
    }
  }

  return (
    <div className="address">
      <div>
        <div className="label">{shared ? "Example address" : "Your agent's address"}</div>
        <div className="value">
          {address ?? (error ? "Could not open an address" : "Opening one...")}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div className="hint">
          {error
            ? error
            : shared
              ? "This is the shared example address, shown so the panel is real and can be copied. Mail sent to it is not routed onto your ledger, because one address shared by every visitor cannot honestly be attributed to one of them. A real account gets its own."
              : "Give this out instead of your own address. The agent reads what arrives, and nothing else."}
        </div>
        <button className="act ghost" onClick={copy} disabled={!address} type="button">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
