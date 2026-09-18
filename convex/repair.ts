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
