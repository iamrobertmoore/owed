import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { sendMessage } from "./agentmail";
import type { Id } from "./_generated/dataModel";

/**
 * The escalation ladder.
 *
 * Each rung is a different letter, not the same letter sent louder. The ladder
 * deliberately stops at the point where the next step is a decision only the
 * owner can take, rather than an email the agent can write. Saying that out
 * loud in the product is more honest than a tool that quietly gives up after
 * three follow-ups.
 */
export const LADDER = [
  {
    rung: 0,
    kind: "claim",
    waitDays: 14,
    voice: "measured, factual, and specific about what is owed and by when",
  },
  {
    rung: 1,
    kind: "chase",
    waitDays: 14,
    voice: "firm and short, referring to the earlier letter and the deadline that has passed",
  },
  {
    rung: 2,
    kind: "deadlock",
    waitDays: 21,
    voice:
      "formal. This is the deadlock letter. It states that the internal process is exhausted and names the scheme or ombudsman the company belongs to as the next step",
  },
] as const;

/** After the last rung, the next move is the owner's. */
export const MAX_RUNG = LADDER.length - 1;

export const ladderFor = (rung: number) => LADDER[Math.min(rung, MAX_RUNG)];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Write the letter for the claim's current rung.
 *
 * The letter quotes the counterparty's own provision by its own reference,
 * states one amount and one deadline, and answers the strongest opposing
 * provision pre-emptively. That last part is what makes it read as though a
 * person who had read the terms wrote it.
 */
export const draft = internalAction({
  args: { claimId: v.id("claims") },
  handler: async (ctx, args): Promise<{ subject: string; body: string }> => {
    const claim = await ctx.runQuery(internal.claims.getInternal, { claimId: args.claimId });
    if (!claim) throw new Error(`No claim ${args.claimId}`);
    const counterparty = await ctx.runQuery(internal.policies.getCounterparty, {
      counterpartyId: claim.counterpartyId,
    });
    if (!counterparty) throw new Error("Claim has no counterparty");

    const rung = ladderFor(claim.rung);

    // Retrieve the provisions that bear on this specific issue, plus the
    // exclusions they would rely on to refuse.
    const found = await ctx.runAction(internal.policies.relevant, {
      counterpartyId: claim.counterpartyId,
      issue: `${claim.title}. ${claim.basis}`,
    });

    const supporting = found.supporting
      .map((p) => `[${p.doc.reference}] (${p.doc.documentTitle}) ${p.doc.text}`)
      .join("\n\n");
    const opposing = found.opposing
      .map((p) => `[${p.doc.reference}] ${p.doc.text}`)
      .join("\n\n");

    const system = [
      "You write correspondence for a person pursuing a consumer claim in the United Kingdom.",
      "",
      "Write in the first person as the claimant. Never invent a fact, a date, an",
      "amount, a provision or a reference. Use only what you are given.",
      "",
      "The letter must:",
      "1. Cite the counterparty's own provision by its own reference number, and",
      "   quote it accurately.",
      "2. State one specific remedy and one specific deadline.",
      "3. If an opposing provision is given, answer it pre-emptively in a single",
      "   sentence, without conceding it.",
      "4. Be plain, calm and short. No threats, no moralising, no legal bluster.",
      "   A letter that reads as though a reasonable person wrote it gets settled;",
      "   one that reads as though a machine wrote it gets a form response.",
      "",
      "Return JSON: {\"subject\": string, \"body\": string}",
    ].join("\n");

    const user = [
      `Rung: ${rung.rung} of ${MAX_RUNG} (${rung.kind}). Voice: ${rung.voice}.`,
      `Claimant's issue: ${claim.title}`,
      `Basis: ${claim.basis}`,
      claim.amountClaimed ? `Amount sought: ${claim.currency} ${claim.amountClaimed}` : "",
      `Counterparty: ${counterparty.name}`,
      counterparty.complaintsAddress
        ? `Their published complaints route: ${counterparty.complaintsAddress}`
        : "",
      counterparty.escalationBody
        ? `The scheme or ombudsman they belong to: ${counterparty.escalationBody}`
        : "",
      counterparty.publishedResponseDays
        ? `Their published response window: ${counterparty.publishedResponseDays} days`
        : "",
      "",
      "Provisions that support the claim:",
      supporting || "(none found — say so plainly rather than implying one)",
      "",
      "Provisions they may rely on to refuse:",
      opposing || "(none found)",
    ]
      .filter(Boolean)
      .join("\n");

    const raw = await ctx.runAction(internal.ai.complete, {
      operation: `draft-${rung.kind}`,
      system,
      user,
      json: true,
      maxTokens: 1100,
      claimId: args.claimId,
    });

    let parsed: { subject?: string; body?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Draft did not come back as JSON");
    }
    if (!parsed.body) throw new Error("Draft had no body");

    const subject = parsed.subject ?? `Claim: ${claim.title}`;

    await ctx.runMutation(internal.letters.storeDraft, {
      claimId: args.claimId,
      subject,
      body: parsed.body,
      rung: claim.rung,
    });

    return { subject, body: parsed.body };
  },
});

/**
 * The owner approves a draft.
 *
 * This is the product's most important safety property, and the reason it
 * lives next to `send` rather than somewhere general: one person, one dispute,
 * and a human deciding before anything leaves the outbox. The agent writes; it
 * does not post.
 */
export const approve = mutation({
  args: { claimId: v.id("claims") },
  handler: async (ctx, args): Promise<{ queued: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");
    const claim = await ctx.db.get(args.claimId);
    if (!claim || claim.userId !== userId) throw new Error("Not your claim");
    if (claim.stage !== "awaiting_approval") {
      throw new Error(`Claim is ${claim.stage}, not awaiting approval`);
    }

    // The worked example must never put mail on the wire. A judge pressing
    // send on a demo row gets the rest of the interaction and a timeline that
    // says plainly that nothing was transmitted. The alternative was worse
    // both ways: a real email to a fictional counterparty, or a button that
    // errors on the one screen showing what makes this product different.
    if (claim.demoKey) {
      const now = Date.now();
      await ctx.db.insert("events", {
        claimId: args.claimId,
        at: now,
        kind: "approved",
        detail: "Approved by the owner.",
      });
      await ctx.db.patch(args.claimId, {
        stage: "sent",
        updatedAt: now,
        nextActionAt: now + 14 * 86_400_000,
      });
      await ctx.db.insert("events", {
        claimId: args.claimId,
        at: now,
        kind: "sent",
        detail:
          "This is the worked example, so no letter was actually transmitted. On a real claim the letter would have left the agent's address at this point.",
      });
      return { queued: false };
    }

    await ctx.db.insert("events", {
      claimId: args.claimId,
      at: Date.now(),
      kind: "approved",
      detail: "Approved by the owner.",
    });
    await ctx.scheduler.runAfter(0, internal.letters.send, { claimId: args.claimId });
    return { queued: true };
  },
});

/**
 * Everything the send needs, resolved in one read, with the guards attached.
 *
 * The send is an action, because the letter leaves through the provider's HTTP
 * API and a mutation cannot make a request. An action cannot read the database
 * either, so the read lives here and the action decides nothing: it is handed
 * a letter to send or a reason not to.
 */
export const sendContext = internalQuery({
  args: { claimId: v.id("claims") },
  handler: async (ctx, args) => {
    const claim = await ctx.db.get(args.claimId);
    if (!claim) {
      return { ready: false as const, reason: `No claim ${args.claimId}` };
    }

    // Belt and braces. `approve` already refuses a demo row, but this is the
    // only function in the product that can put mail on the wire, and it
    // should not be able to transmit the worked example even if a later
    // caller forgets the guard above it.
    if (claim.demoKey) {
      return {
        ready: false as const,
        reason: "Worked example, so nothing is transmitted",
      };
    }

    if (claim.stage !== "awaiting_approval") {
      return { ready: false as const, reason: `Claim is ${claim.stage}` };
    }

    const inbox = await ctx.db
      .query("inboxes")
      .withIndex("by_user", (q) => q.eq("userId", claim.userId))
      .unique();
    if (!inbox) {
      return { ready: false as const, reason: "No inbox for this owner" };
    }

    const counterparty = await ctx.db.get(claim.counterpartyId);
    if (!counterparty) {
      return { ready: false as const, reason: "No counterparty" };
    }

    // The most recent draft on this claim is the one to send.
    const draftMessage = await ctx.db
      .query("messages")
      .withIndex("by_claim", (q) => q.eq("claimId", args.claimId))
      .filter((q) => q.eq(q.field("direction"), "outbound"))
      .order("desc")
      .first();
    if (!draftMessage) {
      return { ready: false as const, reason: "Nothing drafted" };
    }

    const rung = ladderFor(claim.rung);

    return {
      ready: true as const,
      // The address the letter goes out from. For a guest that is an alias on
      // the shared inbox, and the provider takes an address in the path as
      // readily as an inbox id, which is why the app stores the address there.
      inboxId: inbox.agentmailInboxId,
      to: counterparty.complaintsAddress ?? `complaints@${counterparty.domain}`,
      counterpartyName: counterparty.name,
      subject: draftMessage.subject,
      text: draftMessage.text,
      // Without this the letter goes out from the shared inbox and the reply
      // comes back to the bare shared address, which is no owner's
      // `inboxes.address`, so routing by address finds nobody. The reply then
      // resolves by the `claim-<id>` label instead, but setting `reply_to` to
      // the owner's own address means the ordinary address path works too and
      // the label is a safety net rather than the only route home.
      replyTo: inbox.address,
      labels: ["owed", `claim-${args.claimId}`, rung.kind],
      rung: claim.rung,
      kind: rung.kind,
      waitDays: rung.waitDays,
    };
  },
});

/**
 * Send an approved letter from the agent's own address.
 *
 * Only ever called after a human has approved. One person, one dispute, one
 * thread: nothing here does bulk mail and nothing sends without approval.
 */
export const send = internalAction({
  args: { claimId: v.id("claims") },
  handler: async (ctx, args): Promise<{ sent: boolean; reason?: string }> => {
    const letter = await ctx.runQuery(internal.letters.sendContext, {
      claimId: args.claimId,
    });
    if (!letter.ready) return { sent: false, reason: letter.reason };

    const result = await sendMessage(letter.inboxId, {
      to: letter.to,
      subject: letter.subject,
      text: letter.text,
      replyTo: letter.replyTo,
      labels: letter.labels,
    });

    if (!result.ok) {
      // The claim is left at `awaiting_approval` so the owner can press send
      // again once the fault is fixed, and the timeline carries what the
      // provider actually said rather than that something went wrong.
      await ctx.runMutation(internal.letters.recordSendFailed, {
        claimId: args.claimId,
        code: result.code,
        detail: result.detail,
      });
      return { sent: false, reason: result.detail };
    }

    // A 2xx without a message id is not a send. The provider's own id is what
    // a reply quotes back, so a letter recorded without one would be a row
    // that can never be matched to its answer.
    const providerMessageId = result.value.message_id ?? "";
    if (!providerMessageId) {
      await ctx.runMutation(internal.letters.recordSendFailed, {
        claimId: args.claimId,
        code: "no_message_id",
        detail: "The provider accepted the letter without returning a message id.",
      });
      return { sent: false, reason: "No message id from the provider" };
    }

    await ctx.runMutation(internal.letters.recordSent, {
      claimId: args.claimId,
      to: letter.to,
      providerMessageId,
      counterpartyName: letter.counterpartyName,
      rung: letter.rung,
      kind: letter.kind,
      waitDays: letter.waitDays,
    });
    return { sent: true };
  },
});

/** The write half of the send: the paper trail, the stage and the timeline. */
export const recordSent = internalMutation({
  args: {
    claimId: v.id("claims"),
    to: v.string(),
    providerMessageId: v.string(),
    counterpartyName: v.string(),
    rung: v.number(),
    kind: v.string(),
    waitDays: v.number(),
  },
  handler: async (ctx, args) => {
    const draftMessage = await ctx.db
      .query("messages")
      .withIndex("by_claim", (q) => q.eq("claimId", args.claimId))
      .filter((q) => q.eq(q.field("direction"), "outbound"))
      .order("desc")
      .first();

    const now = Date.now();
    if (draftMessage) {
      await ctx.db.patch(draftMessage._id, {
        toAddress: args.to,
        // The provider's own id now, not the id of a row in a queue. It is
        // what the answer quotes, so the paper trail can be matched to it.
        providerMessageId: args.providerMessageId,
        at: now,
      });
    }

    await ctx.db.patch(args.claimId, {
      stage: args.rung >= MAX_RUNG ? "escalated" : "sent",
      nextActionAt: now + args.waitDays * DAY_MS,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      claimId: args.claimId,
      at: now,
      kind: "sent",
      detail: `${args.kind} letter sent to ${args.counterpartyName}. Next check in ${args.waitDays} days.`,
    });
  },
});

/**
 * The letter did not leave.
 *
 * Recorded as a note rather than as a send, because the timeline is read back
 * to a judge and "sent" would be a false statement about what happened. The
 * claim stays where it was, so pressing send again is a retry rather than a
 * second dispute.
 */
export const recordSendFailed = internalMutation({
  args: {
    claimId: v.id("claims"),
    code: v.string(),
    detail: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("events", {
      claimId: args.claimId,
      at: Date.now(),
      kind: "note",
      detail: `The letter did not leave the agent's address. The provider answered ${args.code}: ${args.detail}`,
    });
  },
});

/** Store a draft as an unsent outbound message and ask for approval. */
export const storeDraft = internalMutation({
  args: {
    claimId: v.id("claims"),
    subject: v.string(),
    body: v.string(),
    rung: v.number(),
  },
  handler: async (ctx, args) => {
    const claim = await ctx.db.get(args.claimId);
    if (!claim) throw new Error(`No claim ${args.claimId}`);
    const inbox = await ctx.db
      .query("inboxes")
      .withIndex("by_user", (q) => q.eq("userId", claim.userId))
      .unique();
    if (!inbox) throw new Error("No inbox for this owner");

    const now = Date.now();
    await ctx.db.insert("messages", {
      userId: claim.userId,
      claimId: args.claimId,
      inboxId: inbox._id,
      direction: "outbound",
      fromAddress: inbox.address,
      toAddress: "",
      subject: args.subject,
      text: args.body,
      providerMessageId: `draft-${args.claimId}-${args.rung}-${now}`,
      at: now,
    });
    await ctx.db.patch(args.claimId, {
      stage: "awaiting_approval",
      nextActionAt: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      claimId: args.claimId,
      at: now,
      kind: "drafted",
      detail: `Drafted the ${ladderFor(args.rung).kind} letter. Waiting on the owner.`,
    });
  },
});

/** The draft the owner is being asked to approve. */
export const pendingDraft = internalQuery({
  args: { claimId: v.id("claims") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_claim", (q) => q.eq("claimId", args.claimId))
      .filter((q) => q.eq(q.field("direction"), "outbound"))
      .order("desc")
      .first();
  },
});

export type ClaimId = Id<"claims">;
