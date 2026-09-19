import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { MODEL, SPEND_SCOPE, summarise } from "./pricing";

/**
 * The model call log. One row per distinct input, because a repeated input is
 * served from here and costs nothing.
 *
 * This table is why the OpenAI bill for this project is a figure rather than
 * an assumption: `claims.spend` reports it back in dollars at the rates in
 * `pricing.ts`. It reports it from `spendTotals` rather than from these rows,
 * because counting them meant reading all of them. See the note on
 * `spendTotals` in `schema.ts` for the measurement that forced that.
 */

/** Read the single totals row. The one place every reader and writer agrees. */
async function readTotals(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query("spendTotals")
    .withIndex("by_scope", (q) => q.eq("scope", SPEND_SCOPE))
    .unique();
}

/** The single totals row, or null before anything has been logged. */
export const totals = internalQuery({
  args: {},
  handler: async (ctx) => await readTotals(ctx),
});

export const get = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
  },
});

export const put = internalMutation({
  args: {
    key: v.string(),
    operation: v.string(),
    model: v.string(),
    response: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
  },
  handler: async (ctx, args) => {
    // Idempotent: two concurrent identical calls should not both insert.
    const existing = await ctx.db
      .query("aiCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) return existing._id;
    const id = await ctx.db.insert("aiCache", { ...args, createdAt: Date.now() });
    // In the same transaction as the insert it counts, which is what stops the
    // two drifting apart. This is the only path that writes a logged call.
    await bumpTotals(ctx, args);
    return id;
  },
});

/**
 * Add one logged call to the running totals, creating the row on first use.
 *
 * The classification is not restated here: it asks `summarise` what a single
 * call contributes and adds that. The recount in `rebuildTotals` asks the same
 * function about every row, so the incremental total and the recount agree by
 * construction rather than by review.
 */
async function bumpTotals(
  ctx: MutationCtx,
  call: { model: string; inputTokens: number; outputTokens: number },
): Promise<void> {
  const delta = summarise([call]);
  const current = await readTotals(ctx);
  const next = {
    scope: SPEND_SCOPE,
    distinctCalls: (current?.distinctCalls ?? 0) + delta.distinctCalls,
    inputTokens: (current?.inputTokens ?? 0) + delta.inputTokens,
    outputTokens: (current?.outputTokens ?? 0) + delta.outputTokens,
    embeddingTokens: (current?.embeddingTokens ?? 0) + delta.embeddingTokens,
  };
  if (current) await ctx.db.patch(current._id, next);
  else await ctx.db.insert("spendTotals", next);
}

/**
 * Recompute the totals from the log.
 *
 * This is the backfill, run once when the totals are created, and it reads
 * every row, so it is not on any request path. It is also the repair: if the
 * totals are ever suspected of drift, this makes them agree with the rows.
 */
export const rebuildTotals = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("aiCache").collect();
    const next = { scope: SPEND_SCOPE, ...summarise(rows) };
    const current = await readTotals(ctx);
    if (current) await ctx.db.patch(current._id, next);
    else await ctx.db.insert("spendTotals", next);
    return next;
  },
});

/**
 * Compare the stored totals against a recount of the log.
 *
 * The control for the aggregate, and the reason it can be trusted rather than
 * merely asserted. It reads the whole log, so it is not on a request path: run
 * it after a backfill and after any change to the write path. `match: false` is
 * the failure, and `recounted` is what the totals should have said.
 */
export const verifyTotals = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("aiCache").collect();
    const recounted = summarise(rows);
    const stored = await readTotals(ctx);
    const match =
      stored !== null &&
      stored.distinctCalls === recounted.distinctCalls &&
      stored.inputTokens === recounted.inputTokens &&
      stored.outputTokens === recounted.outputTokens &&
      stored.embeddingTokens === recounted.embeddingTokens;
    return { match, stored, recounted };
  },
});

/**
 * Exercise the incremental write path on this deployment, leaving nothing behind.
 *
 * `rebuildTotals` proved the batch path when it backfilled the row, but the
 * path that runs in production is `put`, which adds one call at a time. Those
 * are different code, and this project has been caught before by an integration
 * that was green everywhere except the deployment, so the path that actually
 * runs is the one that has to be exercised rather than inferred.
 *
 * It calls the real `put` with a reserved key and zero tokens, so the row it
 * makes cannot be mistaken for billable work, reads the totals back to confirm
 * they moved by exactly one call, then deletes the row and restores the totals
 * exactly. All of it is one transaction, so a failure anywhere rolls back the
 * whole thing and cannot leave a synthetic call in the log.
 *
 *   npx convex run aiCache:selfTest --prod
 */
export const selfTest = internalMutation({
  args: {},
  handler: async (ctx) => {
    const KEY = "self-test:aiCache.put";
    const before = await readTotals(ctx);

    await ctx.runMutation(internal.aiCache.put, {
      key: KEY,
      operation: "self-test",
      model: MODEL,
      response: "A self-test row. It records no model call and carries no tokens.",
      inputTokens: 0,
      outputTokens: 0,
    });
    const after = await readTotals(ctx);

    const inserted = await ctx.db
      .query("aiCache")
      .withIndex("by_key", (q) => q.eq("key", KEY))
      .unique();
    if (inserted) await ctx.db.delete(inserted._id);
    if (after) {
      if (before) {
        await ctx.db.patch(after._id, {
          distinctCalls: before.distinctCalls,
          inputTokens: before.inputTokens,
          outputTokens: before.outputTokens,
          embeddingTokens: before.embeddingTokens,
        });
      } else {
        await ctx.db.delete(after._id);
      }
    }
    const restored = await readTotals(ctx);
    // Read the key again rather than trusting the value found before the
    // delete. The first version of this control asserted on that earlier value
    // and reported `clean: false` on a run that had cleaned up perfectly, which
    // is a check failing for a reason it does not have.
    const leftover = await ctx.db
      .query("aiCache")
      .withIndex("by_key", (q) => q.eq("key", KEY))
      .unique();

    // The two assertions this exists for, as values rather than as prose.
    const bumped =
      before !== null &&
      after !== null &&
      after.distinctCalls === before.distinctCalls + 1 &&
      after.inputTokens === before.inputTokens &&
      after.outputTokens === before.outputTokens &&
      after.embeddingTokens === before.embeddingTokens;
    const clean =
      inserted !== null &&
      leftover === null &&
      (before === null
        ? restored === null
        : restored !== null &&
          restored.distinctCalls === before.distinctCalls &&
          restored.inputTokens === before.inputTokens &&
          restored.outputTokens === before.outputTokens &&
          restored.embeddingTokens === before.embeddingTokens);

    return { bumped, clean, ok: bumped && clean, before, after, restored };
  },
});
