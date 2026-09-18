import { useEffect } from "react";
import { useQuery } from "convex/react";
import type { Id } from "../convex/_generated/dataModel";
import { api } from "../convex/_generated/api";
import { day, kindLabel, money, senderOf } from "./format";

/**
 * The record sheet.
 *
 * What was bought, from whom, for how much, under which reference and when,
 * plus the paper the reader read to decide it was worth keeping.
 *
 * This is what the arrivals list opens for anything that became a record with
 * no claim found from it. That is the ordinary outcome for an order
 * confirmation rather than a rare one, because the reader is told not to invent
 * a fact the paper does not show: a confirmation says what was bought and stops.
 * The row used to be plain text with the words "became a record" above it,
 * which is a promise with nowhere to go.
 *
 * The email and the record are shown as two separate blocks on purpose. What
 * the message said and what the reader took from it are different claims, and
 * showing them apart is the only way a reader can check the second against the
 * first.
 */
export function RecordSheet({
  recordId,
  onOpenClaim,
  onClose,
}: {
  recordId: Id<"records">;
  onOpenClaim: (claimId: Id<"claims">) => void;
  onClose: () => void;
}) {
  const record = useQuery(api.records.one, { recordId });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <aside className="sheet" role="dialog" aria-modal="true" aria-label="Record">
        {record === undefined ? (
          <div className="loading">Reading the record...</div>
        ) : record === null ? (
          <div className="empty">
            <strong>That record is not in this ledger.</strong>
            Every read re-checks the account that owns the row, so a record that
            belongs to somebody else reads the same as one that is not there.
          </div>
        ) : (
          <>
            <div className="section-head">
              <span className="pill owed">{kindLabel(record.kind)}</span>
              {/* A seeded record read on its own is indistinguishable from a
                  real one, and the difference is the whole basis on which a
                  judge should read the rest of the page. */}
              {record.fromExample ? <span className="chip">worked example</span> : null}
              <button className="act ghost" onClick={onClose} type="button">
                Close
              </button>
            </div>

            <h2>{record.description}</h2>

            <div className="block">
              <div className="label">
                {record.amount === undefined ? "Amount" : "What it came to"}
              </div>
              <div
                className="value"
                style={{
                  fontFamily: "var(--serif)",
                  fontSize: 34,
                  fontWeight: 700,
                  letterSpacing: "-1px",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {money(record.amount, record.currency)}
              </div>
              <div
                style={{ marginTop: 8, fontSize: 13.5, color: "var(--muted)" }}
              >
                Kept as a record because it states a price, a date or a deadline.
                Nothing here was typed in by hand: it was read out of the email
                below.
              </div>
            </div>

            <div className="block">
              <div className="label">From</div>
              <div style={{ fontWeight: 600 }}>{record.counterpartyName}</div>
              {record.counterpartyDomain ? (
                <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 2 }}>
                  {record.counterpartyDomain}
                </div>
              ) : null}
            </div>

            <div className="block">
              <div className="label">The record</div>
              <ul className="timeline">
                {record.reference ? (
                  <li>
                    <time>Reference</time>
                    <strong style={{ fontWeight: 600 }}>{record.reference}</strong>
                  </li>
                ) : null}
                <li>
                  <time>{day(record.occurredAt)}</time>
                  <strong style={{ fontWeight: 600 }}>Read.</strong> The date on
                  the message it arrived on.
                </li>
                {record.dueAt ? (
                  <li>
                    <time>{day(record.dueAt)}</time>
                    <strong style={{ fontWeight: 600 }}>Promised for.</strong> The
                    message states this date, so it is the one the agent counts
                    from.
                  </li>
                ) : null}
              </ul>
            </div>

            {record.paper.length > 0 ? (
              <div className="block">
                <div className="label">The paper it was read from</div>
                {record.paper.map((m) => (
                  <div key={m._id} style={{ marginBottom: 16 }}>
                    <div
                      style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}
                    >
                      {senderOf(m.fromAddress)} · {day(m.at)}
                    </div>
                    <div style={{ fontWeight: 600, marginBottom: 10 }}>
                      {m.subject}
                    </div>
                    <div className="letter">
                      {m.text.slice(0, 1500)}
                      {m.text.length > 1500 ? "..." : ""}
                    </div>
                  </div>
                ))}
                {record.paper.length > 1 ? (
                  <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>
                    {record.paper.length} messages were read into this one record.
                    All of them are printed above, so what the agent took from
                    them can be checked against what they said.
                  </div>
                ) : null}
              </div>
            ) : null}

            {record.claimId ? (
              <div className="block">
                <div className="label">What it led to</div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                  {record.claimTitle}
                </div>
                <button
                  className="act primary"
                  onClick={() => onOpenClaim(record.claimId as Id<"claims">)}
                  type="button"
                >
                  Open the claim
                </button>
              </div>
            ) : (
              <div className="block">
                <div className="label">What it led to</div>
                <div style={{ fontSize: 14.5, color: "var(--ink-soft)" }}>
                  {/*
                    Four outcomes, and they are four different facts, so none of
                    them may stand in for another:
                      crawled - their terms were read and promise nothing here
                      skipped - we looked for their terms and found no such page
                      failed  - the attempt to reach their terms did not finish
                      pending - nobody has looked yet
                    `skipped` was the one that caught this out: it used to fall
                    into the last branch and be told "nobody has looked" while
                    its own note said the mapper had walked 199 URLs. If the
                    union in schema.ts grows a fifth value, this chain needs a
                    fifth branch rather than a wider fallback.
                  */}
                  {record.crawlStatus === "crawled" ? (
                    <>
                      Nothing yet. The agent read this company's published terms
                      and found no provision that commits them to a remedy for
                      this transaction, so there is no claim to make. A claim
                      only exists when a specific provision promises a specific
                      remedy and the record shows the condition for it was met.
                      {record.crawlNote ? (
                        <>
                          {" "}
                          The crawl note reads: {record.crawlNote}
                        </>
                      ) : null}
                    </>
                  ) : record.crawlStatus === "skipped" ? (
                    <>
                      Nothing yet, and not because their terms say no. The agent
                      looked for this company's terms and found no page that
                      looks like them, so there was nothing to read
                      {record.crawlNote ? ` (${record.crawlNote})` : ""}. That is
                      a gap in the search rather than a finding about the
                      company.
                    </>
                  ) : record.crawlStatus === "failed" ? (
                    <>
                      Nothing yet, and the reason is not the terms: the attempt
                      to reach this company's published terms did not finish
                      {record.crawlNote ? ` (${record.crawlNote})` : ""}. That is
                      a gap in the reading rather than a finding about the
                      company, and it is worth retrying.
                    </>
                  ) : (
                    <>
                      Nothing yet. This record is held and this company's terms
                      have not been looked for
                      {record.crawlNote ? ` (${record.crawlNote})` : ""}. The
                      absence of a claim here means nobody has looked, which is
                      not the same as their terms saying no.
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}
