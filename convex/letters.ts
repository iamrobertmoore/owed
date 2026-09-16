import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";
import type { Id } from "./_generated/dataModel";

const agentmail = new AgentMail(components.agentmail);

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
 * Send an approved letter from the agent's own address.
 *
 * Only ever called after a human has approved. One person, one dispute, one
 * thread: nothing here does bulk mail and nothing sends without approval.
 */
export const send = internalMutation({
  args: { claimId: v.id("claims") },
  handler: async (ctx, args): Promise<{ sent: boolean; reason?: string }> => {
    const claim = await ctx.db.get(args.claimId);
    if (!claim) throw new Error(`No claim ${args.claimId}`);
    if (claim.stage !== "awaiting_approval") {
      return { sent: false, reason: `Claim is ${claim.stage}` };
    }

    const inbox = await ctx.db
      .query("inboxes")
      .withIndex("by_user", (q) => q.eq("userId", claim.userId))
      .unique();
    if (!inbox) return { sent: false, reason: "No inbox for this owner" };

    const counterparty = await ctx.db.get(claim.counterpartyId);
    if (!counterparty) return { sent: false, reason: "No counterparty" };

    // The most recent draft on this claim is the one to send.
    const draftMessage = await ctx.db
      .query("messages")
      .withIndex("by_claim", (q) => q.eq("claimId", args.claimId))
      .filter((q) => q.eq(q.field("direction"), "outbound"))
      .order("desc")
      .first();
    if (!draftMessage) return { sent: false, reason: "Nothing drafted" };

    const to = counterparty.complaintsAddress ?? `complaints@${counterparty.domain}`;
    const rung = ladderFor(claim.rung);

    const outboundId = await agentmail.sendMessage(ctx, inbox.agentmailInboxId, {
      to,
      subject: draftMessage.subject,
      text: draftMessage.text,
      labels: ["owed", `claim-${args.claimId}`, rung.kind],
    });

    const now = Date.now();
    await ctx.db.patch(draftMessage._id, {
      toAddress: to,
      providerMessageId: String(outboundId),
      at: now,
    });

    const nextActionAt = now + rung.waitDays * DAY_MS;
    await ctx.db.patch(args.claimId, {
      stage: claim.rung >= MAX_RUNG ? "escalated" : "sent",
      nextActionAt,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      claimId: args.claimId,
      at: now,
      kind: "sent",
      detail: `${rung.kind} letter sent to ${counterparty.name}. Next check in ${rung.waitDays} days.`,
    });

    return { sent: true };
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
