import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../convex/_generated/dataModel";
import { api } from "../convex/_generated/api";
import { day, eventLabel, money, moment, stageLabel } from "./format";

/**
 * The claim sheet.
 *
 * Everything a reader needs to check the claim rather than take its word for
 * it: the provision it is argued from, quoted verbatim with the document's own
 * reference and a link to the source; the letter that quotes it; and the
 * timeline of what actually happened. The approve button is the only thing in
 * the product that can put a letter on the wire.
 */
export function ClaimSheet({
  claimId,
  onClose,
}: {
  claimId: Id<"claims">;
  onClose: () => void;
}) {
  const detail = useQuery(api.claims.detail, { claimId });
  const approve = useMutation(api.letters.approve);
  const dismiss = useMutation(api.claims.dismiss);
  const [busy, setBusy] = useState<"approve" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const claim = detail?.claim;
  const awaiting = claim?.stage === "awaiting_approval";
  const draft = [...(detail?.messages ?? [])].reverse().find((m) => m.direction === "outbound");
  const correspondence = (detail?.messages ?? []).filter((m) => m.direction === "inbound");

  async function onApprove() {
    setBusy("approve");
    setError(null);
    try {
      await approve({ claimId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send");
    } finally {
      setBusy(null);
    }
  }

  async function onDismiss() {
    setBusy("dismiss");
    setError(null);
    try {
      await dismiss({ claimId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <aside className="sheet" role="dialog" aria-modal="true" aria-label="Claim">
        {!detail || !claim ? (
          <div className="loading">Reading the file...</div>
        ) : (
          <>
            <div className="section-head">
              <span className="pill owed">{stageLabel(claim.stage)}</span>
              {/*
                The sheet is what every README link opens directly into, so it
                is the one screen a visitor can reach without passing the ledger
                and its note. It has to carry the label itself: a reconstructed
                claim read on its own is indistinguishable from a real one, and
                the difference is the whole basis on which a judge should read
                the rest of the page.
              */}
              {claim.demoKey ? <span className="chip">worked example</span> : null}
              <button className="act ghost" onClick={onClose} type="button">
                Close
              </button>
            </div>

            <h2>{claim.title}</h2>
            <p className="basis">{claim.basis}</p>

            <div className="block">
              <div className="label">
                {claim.amountRecovered !== undefined
                  ? "Recovered"
                  : claim.amountClaimed !== undefined
                    ? "Claimed"
                    : "Amount"}
              </div>
              <div
                className="value"
                style={{
                  fontFamily: "var(--serif)",
                  fontSize: 34,
                  fontWeight: 700,
                  letterSpacing: "-1px",
                  fontVariantNumeric: "tabular-nums",
                  color:
                    claim.amountRecovered !== undefined ? "var(--recovered)" : "var(--owed)",
                }}
              >
                {money(claim.amountRecovered ?? claim.amountClaimed, claim.currency)}
              </div>
              <div className="sub" style={{ marginTop: 8, fontSize: 13.5, color: "var(--muted)" }}>
                {claim.detectedBy === "agent"
                  ? "Found by the agent from the paper trail."
                  : "Brought by you."}
                {claim.deadlineBasis ? ` ${claim.deadlineBasis}` : ""}
              </div>
            </div>

            {detail.provision && (
              <div className="block">
                <div className="label">Their own words</div>
                <div className="quote">
                  <span className="ref">{detail.provision.reference}</span>
                  {detail.provision.text}
                </div>
                <div
                  style={{ marginTop: 12, fontSize: 13, color: "var(--muted)" }}
                >
                  {detail.provision.documentTitle},{" "}
                  <a
                    href={detail.provision.documentUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--recovered)" }}
                  >
                    read it at the source
                  </a>
                  .
                </div>
              </div>
            )}

            {draft && (
              <div className="block">
                <div className="label">
                  {awaiting
                    ? "Ready to send"
                    : draft.at
                      ? `Sent ${moment(draft.at)}`
                      : "Letter"}
                </div>
                <div style={{ fontWeight: 600, marginBottom: 10 }}>{draft.subject}</div>
                <div className="letter">{draft.text}</div>
              </div>
            )}

            {awaiting && (
              <>
                <div className="actions">
                  <button
                    className="act primary"
                    onClick={onApprove}
                    disabled={busy !== null}
                    type="button"
                  >
                    {busy === "approve" ? "Sending..." : "Send it"}
                  </button>
                  <button
                    className="act ghost"
                    onClick={onDismiss}
                    disabled={busy !== null}
                    type="button"
                  >
                    Not this one
                  </button>
                </div>
                <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "0 0 22px" }}>
                  Nothing leaves the outbox until you press that. The agent writes, you
                  decide.
                </p>
              </>
            )}

            {error && <div className="error">{error}</div>}

            {correspondence.length > 0 && (
              <div className="block">
                <div className="label">What came back</div>
                {correspondence.map((m) => (
                  <div key={m._id} style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
                      {m.subject} · {day(m.at)}
                      {m.classification ? ` · read as ${m.classification}` : ""}
                    </div>
                    {m.commitment ? (
                      <div className="quote">{m.commitment}</div>
                    ) : (
                      <div style={{ fontSize: 14.5, color: "var(--ink-soft)" }}>
                        {m.text.slice(0, 600)}
                        {m.text.length > 600 ? "..." : ""}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="block">
              <div className="label">What happened</div>
              <ul className="timeline">
                {detail.events.map((e) => (
                  <li key={e._id} className={e.kind === "settled" ? "settled" : undefined}>
                    <time>{moment(e.at)}</time>
                    <strong style={{ fontWeight: 600 }}>{eventLabel(e.kind)}.</strong>{" "}
                    {e.detail}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
