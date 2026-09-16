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

/**
 * The shared inbox, and the base every guest alias is built on.
 *
 * One inbox, not one per visitor. The free plan allows three, and only once
 * the account is verified: before verification the limit is one, which is a
 * number read off the provider's own API rather than off the pricing page.
 * Creating an inbox per visitor spent that allowance within the first few
 * people to open the deployed app, and whoever arrived after the last slot
 * got an error where an address should be. That is a hard failure on the one
 * screen a judge is guaranteed to see.
 *
 * So a guest is given an alias on this inbox instead, `owed+<token>@…`. That
 * the provider delivers it here was measured against the live API on 16
 * September 2026 rather than assumed: a message sent to
 * `owed+probe@agentmail.to` arrived with `inbox_id: "owed@agentmail.to"` and
 * `to: ["owed+probe@agentmail.to"]`, so the tag survives in the envelope.
 * `onMessageReceived` reads `to` first and looks it up in `inboxes`, so one
 * row per guest is enough to route that guest's mail to that guest's ledger:
 * nothing extra is provisioned, no guest's post is dropped, and the
 * three-inbox allowance stops being a cap on how many people can use this.
 *
 * The bare address belongs to nobody, so mail sent to it is still not routed
 * onto any ledger.
 */
export const GUEST_ADDRESS = "owed@agentmail.to";

/** Actions cannot read the auth session directly, so ask a query. */
export const currentUser = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { userId: null, anonymous: false };
    const user = await ctx.db.get(userId);
    // The anonymous provider creates a user with no email. That is the only
    // thing distinguishing a guest from somebody who signed up, and it is
    // what keeps the worked example out of a real account's ledger.
    return { userId, anonymous: !user?.email };
  },
});

/**
 * Give the caller an address on first use, and store it so it is only ever
 * written once. A guest gets an alias on the shared inbox, which provisions
 * nothing; a real account gets an inbox of its own.
 *
 * The free plan allows three inboxes, so the third real account to sign in is
 * the last one who can be handed an inbox of their own. Past that the
 * provider refuses, and the refusal is returned as a sentence rather than
 * thrown: whoever arrives fourth should read why they have no address, not an
 * error trace. Guests are not subject to that ceiling, which is the point of
 * routing them through aliases.
 */
export const provision = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ address: string; shared: boolean } | { error: string }> => {
    const me = await ctx.runQuery(internal.inboxes.currentUser, {});
    if (me.userId === null) return { error: "Not signed in" };

    // A guest gets an alias on the shared inbox: an address of their own that
    // spends no slot. It is written once and kept, so the address a guest
    // copies today still resolves tomorrow.
    if (me.anonymous) {
      const alias = await ctx.runQuery(internal.inboxes.forUser, {
        userId: me.userId,
      });
      if (alias) return { address: alias.address, shared: true };
      return {
        address: await ctx.runMutation(internal.inboxes.storeAlias, {
          userId: me.userId,
        }),
        shared: true,
      };
    }

    const existing = await ctx.runQuery(internal.inboxes.forUser, {
      userId: me.userId,
    });
    // An alias is not an inbox of its own, so it does not answer a real
    // account's request for one. It falls through to provisioning below, and
    // `store` replaces it rather than leaving two rows for one person.
    if (existing && existing.onSharedInbox !== true) {
      return { address: existing.address, shared: false };
    }

    // A short, readable, unguessable local part. The address is shown to the
    // owner and handed out, so it should be sayable out loud.
    const local = `owed-${randomToken(10)}`;

    let created: { address?: string; inbox_id?: string; id?: string } | null =
      null;
    try {
      created = await agentmail.createInbox(ctx, {
        username: local,
        displayName: "Owed",
        // Idempotent: a retry returns the same inbox rather than creating a
        // second one and spending one of the three slots.
        clientId: `owed-${me.userId}`,
      });
    } catch (err) {
      // The provider answers a request past the allowance with HTTP 403 and a
      // body naming `limit_exceeded`. Convex does not promise to carry custom
      // properties on an error across a component boundary, so match on
      // everything that might survive rather than on `.body` alone. Anything
      // else is reported as itself: calling an unknown failure a limit would
      // be a false statement about the cause.
      const detail = [
        err instanceof Error ? err.message : String(err),
        (err as { body?: string } | null)?.body ?? "",
      ].join(" ");
      if (/limit_exceeded|Inbox limit|403/.test(detail)) {
        return {
          error:
            "This deployment has no email address left to hand out. The free plan caps how many inboxes one account can hold, and they are all in use. You can still load the worked example below, and every claim in it behaves the same way.",
        };
      }
      return { error: `Could not create an address. ${detail.slice(0, 160)}` };
    }

    const address: string = created?.address ?? `${local}@agentmail.to`;
    const inboxId: string = created?.inbox_id ?? created?.id ?? "";

    await ctx.runMutation(internal.inboxes.store, {
      userId: me.userId,
      address,
      agentmailInboxId: inboxId,
      displayName: "Owed",
    });

    return { address, shared: false };
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

/**
 * Write the guest's alias on the shared inbox, and return it.
 *
 * The token is random rather than derived from the user id, and that is the
 * one security property here: the address is the only thing that decides
 * whose ledger an arriving message lands in, and it is handed to the guest to
 * give out. A tag anyone could compute would let anyone address a message
 * into somebody else's ledger. Ten characters of a thirty-two symbol alphabet
 * is about 10^15.
 */
export const storeAlias = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<string> => {
    const existing = await ctx.db
      .query("inboxes")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) return existing.address;

    const address = GUEST_ADDRESS.replace("@", `+${randomToken(10)}@`);
    await ctx.db.insert("inboxes", {
      userId: args.userId,
      address,
      // The inbox underneath is the shared one. The provider uses the address
      // as the inbox id, so this is exactly what it reports for a delivery to
      // this alias.
      agentmailInboxId: GUEST_ADDRESS,
      displayName: "Owed",
      onSharedInbox: true,
      createdAt: Date.now(),
    });
    return address;
  },
});

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
    // One address row per person. `onMessageReceived` reads `by_user` with
    // `.unique()`, which throws on a second row, so a provisioned inbox
    // replaces whatever was there rather than sitting beside it.
    if (existing) {
      await ctx.db.patch(existing._id, {
        address: args.address,
        agentmailInboxId: args.agentmailInboxId,
        displayName: args.displayName,
        onSharedInbox: undefined,
      });
      return existing._id;
    }
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
    // `shared` marks an alias on the shared inbox. The address is still this
    // person's own, and mail to it still reaches their ledger, so the UI says
    // which it is rather than warning that it belongs to nobody.
    return { address: inbox.address, shared: inbox.onSharedInbox === true };
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
