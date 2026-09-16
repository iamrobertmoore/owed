import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * The model call log. One row per distinct input, because a repeated input is
 * served from here and costs nothing.
 *
 * This table is why the OpenAI bill for this project is a figure rather than
 * an assumption: `claims.spend` reads it back in dollars at the rates in
 * `pricing.ts`.
 */

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
    return await ctx.db.insert("aiCache", { ...args, createdAt: Date.now() });
  },
});
