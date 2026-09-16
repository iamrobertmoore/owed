import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * The sweep. This is what makes the agent do work without being asked.
 *
 * It runs on a schedule, finds claims whose next action has come due, and moves
 * each one on. Two rules it will not break:
 *
 * 1. It never sends anything. Escalating means drafting the next rung and
 *    asking the owner. Nothing leaves the outbox without a human.
 * 2. It never treats silence as agreement. A claim that has gone quiet moves
 *    up the ladder; it does not settle.
 */

/** The ladder's last rung. Kept here so the sweep can stop without importing letters. */
const MAX_RUNG = 2;

/**
 * Move one claim on by one step.
 *
 * Returns what it did, so both the cron sweep and the immediate post-detection
 * call can report honestly.
 */
async function step(
  ctx: MutationCtx,
  claim: Doc<"claims">,
): Promise<"read" | "drafted" | "escalated" | "exhausted" | "skipped"> {
  const now = Date.now();
  if (claim.stage === "settled" || claim.stage === "exhausted") return "skipped";

  // A claim that has never had its counterparty's terms read cannot be argued
  // from them. Read first.
  if (claim.stage === "detected") {
    const counterparty = await ctx.db.get(claim.counterpartyId);
    if (counterparty && counterparty.crawlStatus !== "crawled") {
      await ctx.scheduler.runAfter(0, internal.policies.readCounterparty, {
        counterpartyId: claim.counterpartyId,
      });
      // Come back once the reading has had a chance to land.
      await ctx.db.patch(claim._id, { nextActionAt: now + 5 * 60 * 1000 });
      return "read";
    }
    // The terms are on file, so the letter can be argued from them. Drafting is
    // internal and reversible; sending is the step that needs the owner.
    await ctx.scheduler.runAfter(0, internal.letters.draft, { claimId: claim._id });
    return "drafted";
  }

  // Sent, and the wait for this rung has elapsed with no reply. That is
  // silence, and silence moves the claim up a rung rather than settling it.
  if (claim.stage === "sent" || claim.stage === "negotiating") {
    if (claim.rung >= MAX_RUNG) {
      await ctx.db.patch(claim._id, {
        stage: "exhausted",
        nextActionAt: undefined,
        updatedAt: now,
      });
      await ctx.db.insert("events", {
        claimId: claim._id,
        at: now,
        kind: "exhausted",
        detail:
          "Three rungs sent with no resolution. The next step is the owner's decision, not the agent's.",
      });
      return "exhausted";
    }
    await ctx.db.patch(claim._id, {
      rung: claim.rung + 1,
      stage: "drafting",
      nextActionAt: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      claimId: claim._id,
      at: now,
      kind: "escalated",
      detail: `No reply within the published window. Moving to rung ${claim.rung + 1}.`,
    });
    await ctx.scheduler.runAfter(0, internal.letters.draft, { claimId: claim._id });
    return "escalated";
  }

  return "skipped";
}

export const run = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ examined: number; escalated: number; read: number }> => {
    const due = await ctx.db
      .query("claims")
      .withIndex("by_next_action", (q) => q.lte("nextActionAt", Date.now()))
      .take(args.limit ?? 25);

    let escalated = 0;
    let read = 0;
    for (const claim of due) {
      const did = await step(ctx, claim);
      if (did === "escalated" || did === "drafted") escalated++;
      if (did === "read") read++;
    }
    return { examined: due.length, escalated, read };
  },
});

/**
 * Move one specific claim on, now.
 *
 * Called the moment a claim is found rather than waiting for the cron, so the
 * chain from "a confirmation landed at your agent's address" to "here is the
 * letter, approve it" completes in seconds instead of half an hour.
 */
export const runOne = internalMutation({
  args: { claimId: v.id("claims") },
  handler: async (ctx, args): Promise<string> => {
    const claim = await ctx.db.get(args.claimId);
    if (!claim) return "skipped";
    return await step(ctx, claim);
  },
});

export type SweptClaimId = Id<"claims">;
