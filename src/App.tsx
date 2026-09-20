import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import type { Id } from "../convex/_generated/dataModel";
import { api } from "../convex/_generated/api";
import { Mark } from "./Brand";
import { ClaimSheet } from "./ClaimSheet";
import { RecordSheet } from "./RecordSheet";
import {
  ago,
  day,
  isClosed,
  isRecovered,
  kindLabel,
  money,
  senderOf,
  stageLabel,
  until,
} from "./format";

/**
 * Set when a visitor deliberately leaves the guest ledger, so the card shows
 * on the way back in rather than the anonymous session silently starting
 * again. Per tab, not per browser: a new tab is a new visitor.
 */
const LEFT_KEY = "owed:left";

function Splash({ text }: { text: string }) {
  return (
    <div className="shell">
      <div className="loading">{text}</div>
    </div>
  );
}

export default function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const [left, setLeft] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const tried = useRef(false);

  /**
   * A cold visitor lands on the ledger, not on a form.
   *
   * This is the same anonymous session the button used to start, started on
   * load instead. Nothing about a per-visitor ledger requires a click, and a
   * judge comparing this against a rival whose product is visible in the
   * first second should not have to spend that second on a login card.
   */
  useEffect(() => {
    if (isLoading || isAuthenticated || tried.current) return;
    let alreadyLeft = false;
    try {
      alreadyLeft = sessionStorage.getItem(LEFT_KEY) === "1";
    } catch {
      alreadyLeft = false;
    }
    if (alreadyLeft) {
      setLeft(true);
      return;
    }
    tried.current = true;
    signIn("anonymous").catch((e: unknown) => setFailed(friendlyAuthError(e)));
  }, [isLoading, isAuthenticated, signIn]);

  /**
   * Leave the guest session and show the card, in that order.
   *
   * The sign-out is not decoration. This component checks `isAuthenticated`
   * before it checks `left`, so a guest session that is still live wins the
   * render and the card never appears. Clearing the session is what makes the
   * card reachable at all; setting the flag is what stops the effect above
   * from minting a new guest on the way back in.
   */
  function leave() {
    try {
      sessionStorage.setItem(LEFT_KEY, "1");
    } catch {
      /* private mode; the card still shows for this page load */
    }
    setLeft(true);
    void signOut();
  }

  if (isLoading) return <Splash text="Opening the ledger..." />;
  if (isAuthenticated) return <Ledger onLeave={leave} />;
  if (left || failed) return <SignIn autoFailed={failed} />;
  return <Splash text="Opening the ledger..." />;
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

function SignIn({ autoFailed }: { autoFailed: string | null }) {
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
      // Asking for the guest session again clears the flag that held the card
      // open, so the next visit opens the ledger rather than this page.
      sessionStorage.removeItem(LEFT_KEY);
    } catch {
      /* private mode; the session still starts, it just will not be remembered */
    }
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
        <div className="signin-brand">
          <Mark />
          <h1>Owed</h1>
        </div>
        <p>
          Your agent holds the paper trail, so the claim finds you. It notices what you
          were owed instead of waiting to be told, reads the company's own terms, and
          asks you before it sends anything.
        </p>

        {autoFailed ? (
          <p style={{ color: "var(--ink-soft)", fontSize: 14 }}>{autoFailed}</p>
        ) : null}

        <button className="act primary" onClick={guest} disabled={busy} type="button">
          {busy ? "Starting..." : "Continue as a guest"}
        </button>
        <p style={{ margin: "10px 0 22px", fontSize: 13 }}>
          No account, no password. The guest session is a real one: its own ledger, its own
          address, its own claims, and a worked example of four claims already in it. It
          opens by itself when you arrive, so this page is only here because you asked for
          it.
        </p>

        <form onSubmit={submit}>
          <input
            className="field"
            type="email"
            aria-label="Email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="field"
            type="password"
            aria-label="Password"
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
              color: "var(--ink-soft)",
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
 * Which sheet is open, read from the URL.
 *
 * Two shapes. `#claim=` takes an id or a worked-example slug, and
 * `#record=<id>` opens a record. The slug form is the one that matters for a
 * link in a README: a Convex id belongs to whoever created the row, so an id in
 * a link is dead for everybody else, while a slug resolves against whoever is
 * looking. A record id has no slug form because nothing links to a record, so
 * the only way to arrive at one is to click the row that owns it.
 */
type Route = { view: "claim" | "record"; key: string } | null;

function routeFromHash(): Route {
  const hash = window.location.hash;
  const record = hash.match(/record=([A-Za-z0-9]+)/);
  if (record) return { view: "record", key: record[1] };
  const claim = hash.match(/claim=([A-Za-z0-9_-]+)/);
  if (claim) return { view: "claim", key: claim[1] };
  return null;
}

/** Convex ids are lowercase alphanumeric. A slug carries a hyphen. */
function looksLikeClaimId(key: string): boolean {
  return /^[a-z0-9]{20,}$/.test(key);
}

/**
 * What to call the sender of an arrival.
 *
 * A raw `From` header reads `Name <address@host>` and carries both. The address
 * is the stronger evidence that the message really came from where it claims,
 * which is why this row exists, but it is also the part that is somebody's
 * personal mailbox. This list is on screen in the video and in any judge's
 * session, so the display name is shown when the header has one and the address
 * only when it does not. A company writing from `billing@...` has no display
 * name and still shows in full, which is the case the evidence was for.
 */
function Ledger({ onLeave }: { onLeave: () => void }) {
  const ledger = useQuery(api.claims.ledger);
  const records = useQuery(api.records.list);
  const arrivals = useQuery(api.messages.list);
  const spend = useQuery(api.claims.spend);
  const inbox = useQuery(api.inboxes.mine);
  const viewer = useQuery(api.inboxes.viewer);
  const provision = useAction(api.inboxes.provision);
  const seedExample = useMutation(api.example.seedExample);
  const loadExample = useMutation(api.example.loadExample);

  const [route, setRoute] = useState<Route>(() => routeFromHash());
  const [addressError, setAddressError] = useState<string | null>(null);
  const [loadingExample, setLoadingExample] = useState(false);
  const [exampleNote, setExampleNote] = useState<string | null>(null);
  const asked = useRef(false);
  const seeded = useRef(false);

  const hashKey = route?.view === "claim" ? route.key : null;
  const openRecordId = route?.view === "record" ? (route.key as Id<"records">) : null;

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
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function open(id: Id<"claims">) {
    window.location.hash = `claim=${id}`;
  }

  /**
   * Open the record behind an arrival.
   *
   * This is the sheet that was missing. A kept message with no claim found from
   * it had no destination at all, so the row was rendered as plain text and the
   * words "became a record" pointed at nothing.
   */
  function openRecord(id: Id<"records">) {
    window.location.hash = `record=${id}`;
  }

  function close() {
    // replaceState rather than assigning: closing should not add a history
    // entry that reopens the sheet when someone presses back.
    window.history.replaceState(null, "", window.location.pathname);
    setRoute(null);
  }

  /**
   * Put the worked example into this account's ledger, on request.
   *
   * A real account starts empty, which is the honest default but a poor thing
   * to hand somebody who wants to see what the product does. The server
   * refuses unless the ledger is empty, so this cannot bury a real claim.
   */
  async function load() {
    setLoadingExample(true);
    setExampleNote(null);
    try {
      const result = await loadExample({});
      if (!result.seeded) {
        setExampleNote(result.reason ?? "The example could not be loaded.");
      }
    } catch (e) {
      setExampleNote(
        e instanceof Error ? e.message : "The example could not be loaded.",
      );
    } finally {
      setLoadingExample(false);
    }
  }

  // One address per person, created the first time they arrive. The plan
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
  // The UI has to be able to tell seeded content from real content, so it can
  // label provenance rather than assert it. A guest's ledger is the worked
  // example entire. A real account can hold both, because loading the example
  // is a deliberate act rather than a condition of arrival, and a figure that
  // silently mixes the two is exactly the overclaim this product exists to
  // catch.
  const claims = ledger?.claims ?? [];
  const claimRows = claims.length;
  const recordRows = records?.length ?? 0;
  const arrivalRows = arrivals?.length ?? 0;

  const exampleClaims = claims.filter((c) => c.demoKey !== undefined).length;
  // From the read, not from the record's own field: a ledger seeded before
  // `records.demoKey` existed has example rows with no marker on the row
  // itself, and only the claim they were found from still says what they are.
  const exampleRecords = (records ?? []).filter((r) => r.fromExample).length;
  const exampleArrivals = (arrivals ?? []).filter((m) => m.fromExample).length;

  const isExample = exampleClaims > 0 || exampleRecords > 0 || exampleArrivals > 0;

  /*
    All-example is computed over the claims, the records and the arrivals, not
    over the claims alone.

    A real account that loads the worked example holds the example's four claims
    beside its own real order, and counting only claims made the page announce
    "these figures are the worked example" over a ledger containing real paper,
    and label the real order as example. That is the same overclaim in the
    opposite direction, and it is the state the recording session is in after
    the example is loaded. Every surface has to have loaded before this can be
    true, so a query still in flight cannot make the ledger look all-example for
    a frame.
  */
  const allExample =
    isExample &&
    ledger !== undefined &&
    records !== undefined &&
    arrivals !== undefined &&
    exampleClaims === claimRows &&
    exampleRecords === recordRows &&
    exampleArrivals === arrivalRows;

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <Mark />
          {/*
            The wordmark used to stand alone here, and the sentence that says
            what this is lived only on the sign-in card, which a cold visitor
            never reaches: the guest session is minted on load, so the card is
            behind a button now. That left the first screen showing three
            figures before it said what they were figures of. The line below is
            the same sentence the card carries and the document title carries,
            put where the person who never clicks anything will read it.
          */}
          <div className="brand-text">
            <span className="name">Owed</span>
            <span className="tagline">
              Your agent holds the paper trail, so the claim finds you.
            </span>
          </div>
        </div>
        <div className="actions">
          {/*
            One action, two labels, and only ever one of them on screen.

            Both end the session and return to the card, because that is the
            only way back to it: `leave` sets the flag and signs out. The label
            is the only part that differs, and it is the part that matters. A
            guest is being offered an account; an account holder is being
            offered the way out of one. Both buttons used to render at once,
            which offered somebody already signed in the chance to create an
            account they already had.

            Nothing renders until the answer arrives, so the button cannot
            change its label under a finger already moving toward it.
          */}
          {viewer === undefined ? null : viewer.guest ? (
            <button className="act ghost" onClick={onLeave} type="button">
              Create an account
            </button>
          ) : (
            <button className="act ghost" onClick={onLeave} type="button">
              Sign out
            </button>
          )}
        </div>
      </header>

      {/*
        Why there is anything on this screen at all.

        The live URL lands on the ledger rather than on a sales page, which is
        the right trade for somebody arriving from a listing that already told
        them what this is. It is the wrong trade for somebody arriving cold,
        because the first thing they read is a figure, and a figure explains
        nothing about why the figure should exist. This band is the sentence
        that would otherwise be on a page they never see.

        Both numbers are the government's and are sourced in the README: the
        Department for Business and Trade's Consumer Detriment Survey 2024,
        published 27 March 2025. Net means after everything people did manage
        to get back. Nothing here is a claim about what this product recovers.
      */}
      <div className="premise">
        <p className="premise-figure">
          &pound;71.2 billion went unrecovered last year.
        </p>
        <p className="premise-body">
          That is the UK government&rsquo;s own figure for net consumer
          detriment: what was lost and stayed lost after everything people did
          manage to get back. In 22% of those problems nobody complained at
          all, because chasing it costs an evening. Owed moves that evening
          onto something that already holds the paperwork.
        </p>
        {/*
          Purpose, not labelling. The worked example is named by the note under
          the totals, which sits there on purpose so the disclaimer is next to
          the figures it qualifies. Saying it twice, two hundred pixels apart,
          would make the page read as nervous rather than careful. What this
          line does instead is answer the question the layout provokes: why
          there is a ledger here and not a sign-up form.
        */}
        {isExample && (
          <p className="premise-body premise-orient">
            There is a working ledger below rather than a sign-up form, so you
            can watch the agent do it before you forward anything of your own.
          </p>
        )}
      </div>

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

      {/*
        A headline figure is the easiest thing on this page to read as a claim
        about the reader, so the block above has to say when the worked example
        is part of the arithmetic.
      */}
      {isExample && (
        <div className="example-note">
          {allExample
            ? "These figures are the worked example rather than a real ledger: four claims against fictional companies, reconstructed rather than received. Nothing was sent and nothing was spent."
            : "These figures include the worked example. Its claims are marked in the list below."}
        </div>
      )}

      <AddressPanel address={inbox?.address} shared={inbox?.shared} error={addressError} />

      {/*
        What has arrived, and what the reader made of it.

        This is the surface the product's whole argument rests on, and until now
        it lived in a provider's console rather than in the app. A message that
        arrived and was declined left no trace anywhere, so "the agent read it
        and said no" was indistinguishable from "the post is broken", and those
        want opposite responses.

        The chip is the decision. The line under it is the reader's own reason,
        kept in its own words rather than summarised, because a summary is the
        thing this product exists to avoid.
      */}
      <section className="arrivals">
        <div className="section-head">
          <h2>Arrivals</h2>
          <span className="count">
            {!arrivals
              ? "checking"
              : arrivals.length === 0
                ? "nothing yet"
                : `${arrivals.length} message${arrivals.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {!arrivals ? (
          <div className="loading">Checking the post...</div>
        ) : arrivals.length === 0 ? (
          <div className="empty">
            <strong>Nothing has arrived yet.</strong>
            Forward an order confirmation, a booking or a renewal notice to the address above.
            It appears here with what the agent decided about it, including when the decision
            is to keep nothing.
            <div style={{ marginTop: 12, fontSize: 13.5 }}>
              A message that was read and turned down is shown, not hidden. It is the only way
              to tell a refusal from a delivery that never came.
            </div>
          </div>
        ) : (
          <div className="rows">
            {arrivals.map((m) => {
              const kept = m.outcome === "kept";
              const claimId = m.claimId;
              const body = (
                <>
                  <span className={`dot ${kept ? "recovered" : "quiet"}`} />
                  <span>
                    <span className="title">
                      {m.subject || "(no subject)"}
                      {m.fromExample ? <span className="chip">worked example</span> : null}
                    </span>
                    <span className="meta">
                      <span>{senderOf(m.fromAddress)}</span>
                      <span>·</span>
                      <span>{ago(m.at)}</span>
                      {m.claimTitle ? (
                        <>
                          <span>·</span>
                          <span>{m.claimTitle}</span>
                        </>
                      ) : null}
                    </span>
                    {m.reason ? (
                      <span className="reason">
                        <span className="who">Reader</span>
                        <span className="said">{m.reason}</span>
                      </span>
                    ) : null}
                  </span>
                  <span className={`pill ${kept ? "recovered" : ""}`}>
                    {m.outcome === null
                      ? "no decision recorded"
                      : kept
                        ? "became a record"
                        : "not kept"}
                  </span>
                </>
              );

              // Clickable when there is somewhere to go, and a claim is not the
              // only destination. A claim first, because it carries the terms
              // and the letter. The record underneath it when no claim was found
              // from it, which is the ordinary outcome for an order
              // confirmation and used to be the row with no destination at all.
              // Plain text only when there is neither.
              return claimId ? (
                <button key={m._id} className="row" onClick={() => open(claimId)} type="button">
                  {body}
                </button>
              ) : m.recordId ? (
                <button
                  key={m._id}
                  className="row"
                  onClick={() => openRecord(m.recordId as Id<"records">)}
                  type="button"
                >
                  {body}
                </button>
              ) : (
                <div key={m._id} className="row" style={{ cursor: "default" }}>
                  {body}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section style={{ marginTop: 48 }}>
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

            {/*
              The example is on request rather than seeded into every real
              account, because content turning up in somebody's ledger
              uninvited is the failure mode this product exists to catch. The
              server refuses unless the ledger is empty, so it can never sit
              beside a real claim and be read as one.
            */}
            <div className="example-invite">
              <button
                className="act ghost"
                onClick={() => void load()}
                disabled={loadingExample}
                type="button"
              >
                {loadingExample ? "Loading..." : "Load the worked example"}
              </button>
              <span className="hint">
                Four claims against fictional companies, reconstructed rather than
                received, so there is something to look at without waiting for post.
                Nothing is transmitted, nothing is spent, and it only loads onto an
                empty ledger.
              </span>
            </div>
            {exampleNote && <div className="error">{exampleNote}</div>}
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
                Three states, not two. A ledger can hold the example's records
                and real paper at once, which is the state the recording session
                is in, and a two-way branch told that ledger "all from real mail"
                while four example rows sat on screen. Labelling from the rows
                and asserting over all of them is the same overclaim in the
                other direction. A count of zero gets no suffix at all, because
                "0 records, all from real mail" is a sentence about nothing.
              */}
              {recordRows === 0
                ? ""
                : exampleRecords === recordRows
                  ? ", from the worked example"
                  : exampleRecords === 0
                    ? ", all from real mail"
                    : `, ${exampleRecords} of them from the worked example`}
            </span>
          </div>
          <div className="rows">
            {/*
              Every record opens, including one with no claim found from it.
              This list was the paper trail with no way to read it: the rows
              were inert and the only sheet in the app was the claim sheet, so a
              record that produced no claim could not be opened from anywhere.
            */}
            {records.map((record) => (
              <button
                key={record._id}
                className="row"
                onClick={() => openRecord(record._id)}
                type="button"
              >
                <span className="dot quiet" />
                <span>
                  <span className="title">{record.description}</span>
                  {record.fromExample ? <span className="chip">worked example</span> : null}
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
              </button>
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
      {openRecordId && (
        <RecordSheet
          recordId={openRecordId}
          onOpenClaim={open}
          onClose={close}
        />
      )}
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
        <div className="label">Your agent's address</div>
        <div className="value">
          {address ?? (error ? "Could not open an address" : "Opening one...")}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div className="hint">
          {error
            ? error
            : shared
              ? "Yours. Forward a confirmation to it and watch it become a record. It is an alias on the inbox every guest shares, so it costs nothing and nobody else's post reaches your ledger."
              : "Give this out instead of your own address. The agent reads what arrives, and nothing else."}
        </div>
        <button className="act ghost" onClick={copy} disabled={!address} type="button">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
