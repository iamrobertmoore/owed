import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * What has arrived at this person's address, and what the reader decided.
 *
 * The ledger shows claims, so until now a message that arrived and was
 * *declined* left no trace anywhere in the product. The owner could not tell
 * "the agent read it and said no" from "it never arrived", and those two want
 * opposite responses: one is the product working, the other is the post
 * broken.
 *
 * A product whose argument is that it holds the paper trail should be able to
 * show the paper it decided not to keep. This is that view.
 *
 * Inbound only, and only paper rather than replies. `inboxes` writes a
 * message with a `claimId` when it is a reply to a letter the agent sent, and
 * without one when it is post arriving on its own; only the second kind goes
 * to the reader. Replies already appear on the claim they belong to, and
 * showing them here as well would double-count the correspondence and give
 * them a decision they were never given.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const claims = await ctx.db
      .query("claims")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const claimById = new Map(claims.map((c) => [c._id as string, c]));
    const claimByRecord = new Map<string, (typeof claims)[number]>();
    for (const c of claims) {
      if (c.recordId) claimByRecord.set(c.recordId as string, c);
    }

    return messages
      .filter((m) => m.direction === "inbound" && m.claimId === undefined)
      .sort((a, b) => b.at - a.at)
      .slice(0, 40)
      .map((m) => {
        // A reply points at its claim directly. Forwarded paper points at a
        // record, and the claim found from that record points back at it.
        const linked =
          (m.claimId ? claimById.get(m.claimId as string) : undefined) ??
          (m.recordId ? claimByRecord.get(m.recordId as string) : undefined);

        return {
          _id: m._id,
          fromAddress: m.fromAddress,
          subject: m.subject,
          at: m.at,
          outcome: m.ingestOutcome ?? null,
          reason: m.ingestReason ?? null,
          claimId: linked?._id ?? null,
          claimTitle: linked?.title ?? null,
          claimStage: linked?.stage ?? null,
          // Rows the worked example seeded rather than a delivery. Labelled in
          // the UI for the same reason the ledger labels them: a reconstructed
          // message that was turned down looks exactly like a real one that
          // was, and only one of those is evidence.
          fromExample: m.demoKey !== undefined || Boolean(linked?.demoKey),
        };
      });
  },
});
