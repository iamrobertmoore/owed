import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { registrableDomain } from "./domains";

/**
 * Repairs for defects that shipped.
 *
 * Each one names the defect it repairs, so a reader can tell a repair from a
 * routine job, and each is safe to run twice. These are not schema migrations:
 * the shape of the data is unchanged.
 */

/**
 * Point every counterparty at the company's own site.
 *
 * The crawler used to be pointed at whatever domain the reader reported, which
 * is the sender's address. `legal.spotify.com` and `mail.ring.com` serve no
 * sitemap and no policy page, so both crawls were marked `skipped` and the two
 * price-rise emails on this deployment produced no claim while the terms sat on
 * `spotify.com` and `ring.com`.
 *
 * Measured on this deployment before this was written: of 163 counterparties,
 * exactly two carry a domain that is not already the registrable one, and
 * reducing them collides with nothing. The collision check stays in anyway,
 * because "the data happens to be safe" is not a property the code should rely
 * on: a row whose reduced domain is already taken by the same user is left
 * alone and reported, rather than merged into a row that has its own records
 * and provisions hanging off it.
 */
export const normaliseDomains = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("counterparties").collect();
    const changed: string[] = [];
    const collisions: string[] = [];

    for (const row of rows) {
      const domain = registrableDomain(row.domain);
      if (!domain || domain === row.domain) continue;

      const taken = await ctx.db
        .query("counterparties")
        .withIndex("by_user_and_domain", (q) =>
          q.eq("userId", row.userId).eq("domain", domain),
        )
        .unique();
      if (taken) {
        collisions.push(`${row.domain} -> ${domain} (already exists)`);
        continue;
      }

      await ctx.db.patch(row._id, {
        domain,
        policyUrls: [`https://${domain}`],
        crawlStatus: "pending",
      });
      changed.push(`${row.domain} -> ${domain}`);
    }

    return { changed, collisions, scanned: rows.length };
  },
});

/** Counterparties whose terms were never successfully read. */
export const staleCounterparties = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"counterparties">[]> => {
    const rows = await ctx.db.query("counterparties").collect();
    return rows.filter((r) => r.crawlStatus !== "crawled").map((r) => r._id);
  },
});

/**
 * Read the terms for counterparties whose crawl did not succeed.
 *
 * One at a time and in series: each crawl is a handful of provider calls and
 * the point of running this by hand is to read the notes afterwards, which is
 * easier when the run is short and its order is known.
 */
export const recrawl = internalAction({
  args: { counterpartyIds: v.optional(v.array(v.id("counterparties"))) },
  handler: async (ctx, args) => {
    const ids =
      args.counterpartyIds ?? (await ctx.runQuery(internal.repair.staleCounterparties, {}));

    const results: Array<{
      counterpartyId: string;
      documents: number;
      provisions: number;
      note: string;
    }> = [];

    for (const counterpartyId of ids) {
      try {
        const read = await ctx.runAction(internal.policies.readCounterparty, { counterpartyId });
        results.push({
          counterpartyId,
          documents: read.documents,
          provisions: read.provisions,
          note: read.note,
        });
      } catch (err) {
        results.push({
          counterpartyId,
          documents: 0,
          provisions: 0,
          note: `Crawl threw: ${String(err).slice(0, 200)}`,
        });
      }
    }

    return results;
  },
});

/**
 * Records that no claim has been argued from yet.
 *
 * The worked example's rows are excluded: they carry their own claims and
 * re-running the detector over them would argue the same entitlement twice.
 */
export const unclaimedRecords = internalQuery({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<Id<"records">[]> => {
    const records = args.userId
      ? await ctx.db
          .query("records")
          .withIndex("by_user", (q) => q.eq("userId", args.userId!))
          .collect()
      : await ctx.db.query("records").collect();

    const claims = await ctx.db.query("claims").collect();
    const claimed = new Set(claims.map((c) => c.recordId).filter(Boolean));

    return records.filter((r) => !r.demoKey && !claimed.has(r._id)).map((r) => r._id);
  },
});

/**
 * Run the claim detector over records that have none.
 *
 * `detect` creates a claim whenever the model finds one, so it is not
 * idempotent: running it twice on one record would produce two claims for one
 * grievance. Restricting it to records with no claim is what makes this safe to
 * run after a crawl repair.
 */
export const redetect = internalAction({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const ids = await ctx.runQuery(internal.repair.unclaimedRecords, {
      userId: args.userId,
    });

    const results: Array<{ recordId: string; found: boolean; reason: string }> = [];
    for (const recordId of ids) {
      const result = await ctx.runAction(internal.records.detect, { recordId });
      results.push({ recordId, found: result.found, reason: result.reason });
    }
    return results;
  },
});

/**
 * Name a counterparty's own site by hand, for the rows the reader wrote before
 * it could name one.
 *
 * The case this exists for is measured: Sky writes from `contact.sky` and
 * publishes on `sky.com`, so the reduction in `domains.ts` cannot reach the
 * terms and the crawl reported, correctly and uselessly, that `contact.sky`
 * has none. New forwards get the site from the reader. A row that predates
 * that gets it here, and then `recrawl` and `redetect` do the rest. The value
 * is reduced and checked the same way `upsertCounterparty` checks the reader's,
 * and a site already on the row is left alone: this is a repair for an empty
 * field, not a way to overwrite one.
 */
export const setSiteDomain = internalMutation({
  args: { counterpartyId: v.id("counterparties"), siteDomain: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.counterpartyId);
    if (!row) return { set: false, reason: "No such counterparty" };
    if (row.siteDomain) return { set: false, reason: `Already ${row.siteDomain}` };
    const site = registrableDomain(args.siteDomain);
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(site)) {
      return { set: false, reason: `Not a domain: ${args.siteDomain}` };
    }
    await ctx.db.patch(args.counterpartyId, { siteDomain: site });
    return { set: true, siteDomain: site };
  },
});

/**
 * Find the counterparties a domain belongs to, across every user.
 *
 * Used by `fixSky` so the repair can be run with no argument: the operator
 * should not have to open the dashboard, find a row id and paste it, because a
 * pasted-in id is one more thing to get wrong under deadline.
 */
export const counterpartiesByDomain = internalQuery({
  args: { domain: v.string() },
  handler: async (ctx, args): Promise<Array<{ _id: Id<"counterparties">; userId: Id<"users"> }>> => {
    const want = registrableDomain(args.domain);
    const rows = await ctx.db.query("counterparties").collect();
    return rows
      .filter((r) => registrableDomain(r.domain) === want)
      .map((r) => ({ _id: r._id, userId: r.userId }));
  },
});

/** Set a site domain unconditionally. `fixSky` needs this to be idempotent. */
export const forceSiteDomain = internalMutation({
  args: { counterpartyId: v.id("counterparties"), siteDomain: v.string() },
  handler: async (ctx, args) => {
    const site = registrableDomain(args.siteDomain);
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(site)) {
      return { set: false, reason: `Not a domain: ${args.siteDomain}` };
    }
    await ctx.db.patch(args.counterpartyId, { siteDomain: site });
    return { set: true, siteDomain: site };
  },
});

/** Unclaimed records belonging to one counterparty. */
export const unclaimedRecordsForCounterparty = internalQuery({
  args: { counterpartyId: v.id("counterparties") },
  handler: async (ctx, args): Promise<Id<"records">[]> => {
    const records = await ctx.db
      .query("records")
      .withIndex("by_counterparty", (q) => q.eq("counterpartyId", args.counterpartyId))
      .collect();
    const claims = await ctx.db.query("claims").collect();
    const claimed = new Set(claims.map((c) => c.recordId).filter(Boolean));
    return records.filter((r) => !r.demoKey && !claimed.has(r._id)).map((r) => r._id);
  },
});

/**
 * The whole Sky repair, in one call with no arguments.
 *
 * Sky writes from `contact.sky` and publishes its terms on `sky.com`, which no
 * reduction of the sending host reaches, so the crawl found nothing and the
 * record produced no claim. This points every `contact.sky` counterparty at
 * `sky.com`, re-reads the terms from there, and re-runs detection over that
 * counterparty's records that have no claim yet. Safe to run twice: the site is
 * set unconditionally, and detection is restricted to unclaimed records.
 *
 * Returns a per-counterparty report — the crawl note, the provisions kept, and
 * whether a claim was found — which is exactly the evidence the next log entry
 * needs, so read it and keep it.
 */
type SkyReport = {
  counterparties: number;
  report: Array<{
    counterpartyId: string;
    userId: string;
    crawlNote: string;
    provisions: number;
    documents: number;
    detected: Array<{ recordId: string; found: boolean; reason: string }>;
  }>;
};

export const fixSky = internalAction({
  args: {},
  handler: async (ctx): Promise<SkyReport> => {
    const cps = await ctx.runQuery(internal.repair.counterpartiesByDomain, {
      domain: "contact.sky",
    });
    const report: Array<{
      counterpartyId: string;
      userId: string;
      crawlNote: string;
      provisions: number;
      documents: number;
      detected: Array<{ recordId: string; found: boolean; reason: string }>;
    }> = [];
    for (const cp of cps) {
      await ctx.runMutation(internal.repair.forceSiteDomain, {
        counterpartyId: cp._id,
        siteDomain: "sky.com",
      });
      const read = await ctx.runAction(internal.policies.readCounterparty, {
        counterpartyId: cp._id,
      });
      const recordIds = await ctx.runQuery(
        internal.repair.unclaimedRecordsForCounterparty,
        { counterpartyId: cp._id },
      );
      const detected: Array<{ recordId: string; found: boolean; reason: string }> = [];
      for (const recordId of recordIds) {
        const d = await ctx.runAction(internal.records.detect, { recordId });
        detected.push({ recordId, found: d.found, reason: d.reason });
      }
      report.push({
        counterpartyId: cp._id,
        userId: cp.userId,
        crawlNote: read.note,
        provisions: read.provisions,
        documents: read.documents,
        detected,
      });
    }
    return { counterparties: cps.length, report };
  },
});

/**
 * Put the worked example's approval gate back, so the demo can be recorded again.
 *
 * Beat 4 of the demo presses approve on `demo-gate`, which is the one claim the
 * example seeds at `awaiting_approval`. Approving it is not reversible from the
 * product, and it should not be: a person un-sending their own letter is not a
 * feature, it is a way to lose track of what was actually said to a company.
 *
 * On the worked example, though, nothing left the building. `letters.approve`
 * takes a separate branch for any claim carrying a `demoKey`: it writes an
 * `approved` event, moves the stage to `sent`, and writes a second event saying
 * in plain words that nothing was transmitted. No mail, no scheduler, no
 * outbound call. So the whole of what approving a demo claim does is three
 * database writes, and undoing it is deleting two rows and restoring one field.
 *
 * The seeded event list for `demo-gate` ends at `drafted`, so every `approved`
 * and `sent` event on that claim was written by a press of the button and can
 * go. `nextActionAt` returns to undefined because the seed never sets one for
 * this claim: it has no deadline until the letter is actually sent.
 *
 * Safe to run twice, and safe to run at all only because it refuses to touch
 * anything without a `demoKey`. A real claim that has been sent stays sent.
 */
export const resetDemoGate = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ reset: number; alreadyAtGate: number; events: number }> => {
    const claims = await ctx.db.query("claims").collect();
    let reset = 0;
    let alreadyAtGate = 0;
    let events = 0;

    for (const claim of claims) {
      if (claim.demoKey !== "demo-gate") continue;
      if (claim.stage === "awaiting_approval") {
        alreadyAtGate += 1;
        continue;
      }

      const onClaim = await ctx.db
        .query("events")
        .withIndex("by_claim", (q) => q.eq("claimId", claim._id))
        .collect();

      for (const event of onClaim) {
        if (event.kind === "approved" || event.kind === "sent") {
          await ctx.db.delete(event._id);
          events += 1;
        }
      }

      await ctx.db.patch(claim._id, {
        stage: "awaiting_approval",
        nextActionAt: undefined,
        updatedAt: Date.now(),
      });
      reset += 1;
    }

    return { reset, alreadyAtGate, events };
  },
});
