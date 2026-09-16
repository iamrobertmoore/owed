import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { EMBEDDING_MODEL, usdFor } from "./pricing";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * A claim is a thing you are owed, and the ledger is the list of them.
 *
 * The rule that keeps this honest: a claim is only ever settled by a
 * `concession` from the counterparty, and the number the ledger reports at the
 * top is money actually recovered. Nothing here counts a promise.
 */

const STAGE = v.union(
  v.literal("detected"),
  v.literal("drafting"),
  v.literal("awaiting_approval"),
  v.literal("sent"),
  v.literal("negotiating"),
  v.literal("escalated"),
  v.literal("settled"),
  v.literal("exhausted"),
);

/** Append a note to a claim's timeline. Used for anything worth reading back. */
export const note = internalMutation({
  args: { claimId: v.id("claims"), detail: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("events", {
      claimId: args.claimId,
      at: Date.now(),
      kind: "note",
      detail: args.detail,
    });
  },
});

/**
 * Record what a model call cost, on the claim it was for. The event row carries
 * the model id and the token counts so the ledger can show its own running
 * spend rather than asserting that it is cheap.
 */
export const logModelUse = internalMutation({
  args: {
    claimId: v.id("claims"),
    operation: v.string(),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("events", {
      claimId: args.claimId,
      at: Date.now(),
      kind: "note",
      detail: `Model call: ${args.operation}`,
      model: args.model,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
    });
  },
});

export const create = internalMutation({
  args: {
    userId: v.id("users"),
    counterpartyId: v.id("counterparties"),
    recordId: v.optional(v.id("records")),
    provisionId: v.optional(v.id("provisions")),
    title: v.string(),
    basis: v.string(),
    amountClaimed: v.optional(v.number()),
    currency: v.string(),
    detectedBy: v.union(v.literal("agent"), v.literal("user")),
    deadlineBasis: v.optional(v.string()),
    nextActionAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"claims">> => {
    const now = Date.now();
    const claimId = await ctx.db.insert("claims", {
      ...args,
      stage: "detected",
      rung: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      claimId,
      at: now,
      kind: "detected",
      detail:
        args.detectedBy === "agent"
          ? `Found from the paper trail: ${args.basis}`
          : `Brought by the owner: ${args.basis}`,
    });
    return claimId;
  },
});

/** Move a claim to a new stage and write the transition to its timeline. */
export const advance = internalMutation({
  args: {
    claimId: v.id("claims"),
    stage: STAGE,
    detail: v.string(),
    kind: v.optional(
      v.union(
        v.literal("detected"),
        v.literal("policy_read"),
        v.literal("drafted"),
        v.literal("approved"),
        v.literal("sent"),
        v.literal("replied"),
        v.literal("classified"),
        v.literal("escalated"),
        v.literal("settled"),
        v.literal("exhausted"),
        v.literal("note"),
      ),
    ),
    nextActionAt: v.optional(v.number()),
    /** Increment the ladder rung. Only escalation does this. */
    bumpRung: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const claim = await ctx.db.get(args.claimId);
    if (!claim) throw new Error(`No claim ${args.claimId}`);
    const now = Date.now();
    await ctx.db.patch(args.claimId, {
      stage: args.stage,
      updatedAt: now,
      ...(args.nextActionAt !== undefined ? { nextActionAt: args.nextActionAt } : {}),
      ...(args.bumpRung ? { rung: claim.rung + 1 } : {}),
      ...(args.stage === "settled" ? { settledAt: now } : {}),
    });
    await ctx.db.insert("events", {
      claimId: args.claimId,
      at: now,
      kind: args.kind ?? "note",
      detail: args.detail,
    });
  },
});

/**
 * Record a recovery. Only called when the counterparty has actually conceded,
 * and the amount is what they committed to in writing.
 */
export const recordRecovery = internalMutation({
  args: {
    claimId: v.id("claims"),
    amount: v.number(),
    evidence: v.string(),
  },
  handler: async (ctx, args) => {
    const claim = await ctx.db.get(args.claimId);
    if (!claim) throw new Error(`No claim ${args.claimId}`);
    const now = Date.now();
    await ctx.db.patch(args.claimId, {
      amountRecovered: args.amount,
      stage: "settled",
      settledAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      claimId: args.claimId,
      at: now,
      kind: "settled",
      detail: `Recovered ${claim.currency} ${args.amount.toFixed(2)}. Their words: "${args.evidence}"`,
    });
  },
});

export const getInternal = internalQuery({
  args: { claimId: v.id("claims") },
  handler: async (ctx, args) => await ctx.db.get(args.claimId),
});

/** Claims whose next action has come due. Drives the sweep. */
export const due = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("claims")
      .withIndex("by_next_action", (q) => q.lte("nextActionAt", args.now))
      .take(args.limit);
  },
});

// ---------------------------------------------------------------------------
// Reads for the UI
// ---------------------------------------------------------------------------

async function requireUser(ctx: { db: any }): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx as any);
  if (userId === null) throw new Error("Not signed in");
  return userId;
}

/** A claim with the counterparty's name attached, for the ledger. */
export type LedgerRow = Doc<"claims"> & {
  counterpartyName: string;
  counterpartyDomain: string;
};

export type Ledger = {
  claims: LedgerRow[];
  totals: {
    count: number;
    open: number;
    settled: number;
    claimed: number;
    recovered: number;
    currency: string;
  };
};

/** One claim with everything a reader needs to check it. */
export type ClaimDetail = {
  claim: Doc<"claims">;
  counterparty: Doc<"counterparties"> | null;
  provision: Doc<"provisions"> | null;
  events: Doc<"events">[];
  messages: Doc<"messages">[];
  evidence: Doc<"evidence">[];
};

export type SpendSummary = {
  distinctCalls: number;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
  usd: number;
  note: string;
};

/** The ledger: everything held, with its stage and its money. */
export const ledger = query({
  args: {},
  handler: async (ctx): Promise<Ledger | null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const claims = await ctx.db
      .query("claims")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const rows = await Promise.all(
      claims.map(async (claim) => {
        const counterparty = await ctx.db.get(claim.counterpartyId);
        return {
          ...claim,
          counterpartyName: counterparty?.name ?? "Unknown",
          counterpartyDomain: counterparty?.domain ?? "",
        };
      }),
    );

    const settled = rows.filter((r) => r.stage === "settled");
    const recovered = settled.reduce((sum, r) => sum + (r.amountRecovered ?? 0), 0);
    const claimed = rows.reduce((sum, r) => sum + (r.amountClaimed ?? 0), 0);
    const open = rows.filter(
      (r) => r.stage !== "settled" && r.stage !== "exhausted",
    ).length;

    // Sorted by what needs attention first, then by what is worth most.
    const order: Record<string, number> = {
      awaiting_approval: 0,
      detected: 1,
      negotiating: 2,
      escalated: 3,
      sent: 4,
      drafting: 5,
      settled: 6,
      exhausted: 7,
    };
    rows.sort(
      (a, b) =>
        (order[a.stage] ?? 9) - (order[b.stage] ?? 9) ||
        (b.amountClaimed ?? 0) - (a.amountClaimed ?? 0),
    );

    return {
      claims: rows,
      totals: {
        count: rows.length,
        open,
        settled: settled.length,
        claimed,
        recovered,
        currency: rows[0]?.currency ?? "GBP",
      },
    };
  },
});

/** One claim, with everything a reader needs to check it. */
export const detail = query({
  args: { claimId: v.id("claims") },
  handler: async (ctx, args): Promise<ClaimDetail | null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const claim = await ctx.db.get(args.claimId);
    if (!claim || claim.userId !== userId) return null;

    const [counterparty, provision, events, messages, evidence] = await Promise.all([
      ctx.db.get(claim.counterpartyId),
      claim.provisionId ? ctx.db.get(claim.provisionId) : Promise.resolve(null),
      ctx.db
        .query("events")
        .withIndex("by_claim", (q) => q.eq("claimId", args.claimId))
        .collect(),
      ctx.db
        .query("messages")
        .withIndex("by_claim", (q) => q.eq("claimId", args.claimId))
        .collect(),
      ctx.db
        .query("evidence")
        .withIndex("by_claim", (q) => q.eq("claimId", args.claimId))
        .collect(),
    ]);

    return {
      claim,
      counterparty,
      provision,
      events: events.sort((a, b) => a.at - b.at),
      messages: messages.sort((a, b) => a.at - b.at),
      evidence,
    };
  },
});

/**
 * The owner declines a draft. The claim stops rather than being chased.
 */
export const dismiss = mutation({
  args: { claimId: v.id("claims"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const claim = await ctx.db.get(args.claimId);
    if (!claim || claim.userId !== userId) throw new Error("Not your claim");
    await ctx.db.insert("events", {
      claimId: args.claimId,
      at: Date.now(),
      kind: "exhausted",
      detail: args.reason ? `Closed by the owner: ${args.reason}` : "Closed by the owner.",
    });
    await ctx.db.patch(args.claimId, {
      stage: "exhausted",
      nextActionAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * What this deployment has spent on models, in dollars.
 *
 * Read straight off the cache log rather than estimated, and priced at the
 * rates in `pricing.ts`. A repeated input is served from cache and costs
 * nothing, so this counts distinct work only.
 */
export const spend = query({
  args: {},
  handler: async (ctx): Promise<SpendSummary | null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const rows = await ctx.db.query("aiCache").collect();
    let inputTokens = 0;
    let outputTokens = 0;
    let embeddingTokens = 0;
    for (const row of rows) {
      if (row.model === EMBEDDING_MODEL) embeddingTokens += row.inputTokens;
      else {
        inputTokens += row.inputTokens;
        outputTokens += row.outputTokens;
      }
    }
    return {
      distinctCalls: rows.length,
      inputTokens,
      outputTokens,
      embeddingTokens,
      usd: Number(usdFor({ inputTokens, outputTokens, embeddingTokens }).toFixed(6)),
      note: "A repeated input is served from cache and costs nothing, so this is an upper bound on distinct work done.",
    };
  },
});

export type Claim = Doc<"claims">;
