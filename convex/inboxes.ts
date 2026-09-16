import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";
import type { Id } from "./_generated/dataModel";

/**
 * The agent's own address.
 *
 * This is the product's front door and the reason the thesis is not the one
 * everyone else built. The owner routes the paper trail to an address the
 * agent holds, so the agent sees what it needs and nothing else. It never asks
 * for a password to a personal mailbox and never reads a life.
 */
const agentmail = new AgentMail(components.agentmail, {
  onMessageReceived: internal.inboxes.onMessageReceived,
});

/** Actions cannot read the auth session directly, so ask a query. */
export const currentUser = internalQuery({
  args: {},
  handler: async (ctx) => await getAuthUserId(ctx),
});

/**
 * Create the owner's inbox on first use. Free tier allows three inboxes, so
 * this is called once per person and the result is stored.
 */
export const provision = action({
  args: {},
  handler: async (ctx): Promise<{ address: string } | { error: string }> => {
    const userId = await ctx.runQuery(internal.inboxes.currentUser, {});
    if (userId === null) return { error: "Not signed in" };

    const existing = await ctx.runQuery(internal.inboxes.forUser, { userId });
    if (existing) return { address: existing.address };

    // A short, readable, unguessable local part. The address is shown to the
    // owner and handed out, so it should be sayable out loud.
    const local = `owed-${randomToken(10)}`;

    const inbox = await agentmail.createInbox(ctx, {
      username: local,
      displayName: "Owed",
      // Idempotent: a retry returns the same inbox rather than creating a
      // second one and burning a free-tier slot.
      clientId: `owed-${userId}`,
    });

    const address: string = inbox?.address ?? `${local}@agentmail.to`;
    const inboxId: string = inbox?.inbox_id ?? inbox?.id ?? "";

    await ctx.runMutation(internal.inboxes.store, {
      userId,
      address,
      agentmailInboxId: inboxId,
      displayName: "Owed",
    });

    return { address };
  },
});

function randomToken(length: number): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export const store = internalMutation({
  args: {
    userId: v.id("users"),
    address: v.string(),
    agentmailInboxId: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"inboxes">> => {
    const existing = await ctx.db
      .query("inboxes")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("inboxes", { ...args, createdAt: Date.now() });
  },
});

export const forUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("inboxes")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
  },
});

/** The owner's address, for the UI to show and hand out. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const inbox = await ctx.db
      .query("inboxes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!inbox) return null;
    return { address: inbox.address, createdAt: inbox.createdAt };
  },
});

/** Copy the address to the clipboard. A mutation keeps the UI honest. */
export const touch = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const inbox = await ctx.db
      .query("inboxes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return inbox?.address ?? null;
  },
});

/**
 * A reply has arrived at the agent's address.
 *
 * Route it to the claim it belongs to, store it, and schedule the read. The
 * component has already verified the signature and deduplicated by event id,
 * so anything arriving here is a genuine, once-only delivery.
 */
export const onMessageReceived = internalMutation({
  args: {
    message: v.any(),
    thread: v.any(),
    eventId: v.string(),
  },
  handler: async (ctx, args) => {
    const inboxAddress: string = args.message?.inbox_id ?? args.message?.inboxId ?? "";
    const threadId: string = args.message?.thread_id ?? args.message?.threadId ?? "";
    const toAddress: string = String(
      args.message?.to ?? args.message?.to_address ?? inboxAddress,
    );

    // Which owner does this address belong to?
    const inbox = await ctx.db
      .query("inboxes")
      .withIndex("by_address", (q) => q.eq("address", toAddress))
      .unique();
    if (!inbox) return;

    const providerMessageId: string =
      args.message?.message_id ?? args.message?.messageId ?? args.eventId;

    // Belt and braces against a redelivery that slips past the component.
    const already = await ctx.db
      .query("messages")
      .withIndex("by_provider_message", (q) => q.eq("providerMessageId", providerMessageId))
      .unique();
    if (already) return;

    // The outbound letter carried `claim-<id>` as a label, so a reply on that
    // thread already knows which claim it belongs to. Mail that carries no such
    // label is not a reply: it is a new piece of paper.
    const labels: string[] = [
      ...(args.thread?.labels ?? []),
      ...(args.message?.labels ?? []),
    ].map((l: unknown) => String(l));
    const claimLabel = labels.find((l) => l.startsWith("claim-"));

    let claimId: Id<"claims"> | undefined;
    if (claimLabel) {
      const candidate = claimLabel.slice("claim-".length) as Id<"claims">;
      const claim = await ctx.db.get(candidate);
      if (claim && claim.userId === inbox.userId) claimId = candidate;
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      userId: inbox.userId,
      claimId,
      inboxId: inbox._id,
      direction: "inbound",
      fromAddress: String(args.message?.from ?? args.message?.from_address ?? ""),
      toAddress,
      subject: String(args.message?.subject ?? "(no subject)"),
      // `extracted_text` strips the quoted history, which is what we want to
      // read. Fall back to the raw body.
      text: String(args.message?.extracted_text ?? args.message?.text ?? ""),
      providerMessageId,
      providerThreadId: threadId || undefined,
      at: now,
    });

    if (claimId) {
      // A reply pauses the chase. Nothing goes out while a human at the other
      // end is talking.
      await ctx.db.patch(claimId, {
        stage: "negotiating",
        nextActionAt: undefined,
        updatedAt: now,
      });
      await ctx.db.insert("events", {
        claimId,
        at: now,
        kind: "replied",
        detail: "A reply arrived at the agent's address.",
      });
      await ctx.scheduler.runAfter(0, internal.triage.classify, { claimId, messageId });
      return;
    }

    // No claim label. This may be the paper trail arriving on its own: an order
    // confirmation, a booking, a renewal notice. Read it and see.
    await ctx.scheduler.runAfter(0, internal.records.ingestFromMessage, {
      messageId,
      userId: inbox.userId,
    });
  },
});
