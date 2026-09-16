import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * The paper trail.
 *
 * This is the part the rest of the field does not have. Every other entry waits
 * for a person to describe a dispute. Owed holds the record of what was bought,
 * from whom, on what terms and when it was due, which means it can notice that
 * something went wrong without being told.
 *
 * A record is only ever created from a real message that arrived at the
 * agent's address. Nothing here invents a purchase.
 */

export const create = internalMutation({
  args: {
    userId: v.id("users"),
    counterpartyId: v.id("counterparties"),
    kind: v.union(
      v.literal("order"),
      v.literal("booking"),
      v.literal("subscription"),
      v.literal("service"),
      v.literal("other"),
    ),
    reference: v.string(),
    description: v.string(),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    occurredAt: v.number(),
    sourceMessageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args): Promise<Id<"records">> => {
    return await ctx.db.insert("records", args);
  },
});

/** Find or create the counterparty a domain belongs to. */
export const upsertCounterparty = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    domain: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"counterparties">> => {
    const existing = await ctx.db
      .query("counterparties")
      .withIndex("by_user_and_domain", (q) =>
        q.eq("userId", args.userId).eq("domain", args.domain),
      )
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("counterparties", {
      userId: args.userId,
      name: args.name,
      domain: args.domain,
      policyUrls: [`https://${args.domain}`],
      crawlStatus: "pending",
    });
  },
});

/**
 * Read a message that arrived at the agent's address and decide whether it is
 * a piece of paper worth keeping.
 *
 * Order confirmations, booking confirmations, renewal notices and delivery
 * promises are. Newsletters and marketing are not, and the model is told so
 * explicitly rather than being asked to judge everything.
 */
export const ingestFromMessage = internalAction({
  args: { messageId: v.id("messages"), userId: v.id("users") },
  handler: async (ctx, args): Promise<{ kept: boolean; reason: string }> => {
    const message = await ctx.runQuery(internal.triage.getMessage, { messageId: args.messageId });
    if (!message) return { kept: false, reason: "No such message" };

    const system = [
      "You read an email that arrived at someone's agent address and decide whether",
      "it is a record of a transaction or commitment worth keeping.",
      "",
      "Worth keeping: order confirmations, booking confirmations, delivery promises,",
      "subscription and renewal notices, service appointments, quotes that were",
      "accepted, and anything stating a price, a date or a deadline.",
      "",
      "Not worth keeping: marketing, newsletters, receipts for things already",
      "resolved and refunded, social notifications, and anything with no price and",
      "no date.",
      "",
      "Return JSON:",
      "{\"keep\": boolean, \"reason\": string, \"kind\": \"order\"|\"booking\"|\"subscription\"|\"service\"|\"other\",",
      " \"counterpartyName\": string, \"counterpartyDomain\": string, \"reference\": string,",
      " \"description\": string, \"amount\": number|null, \"currency\": string|null, \"dueAt\": string|null}",
      "",
      "Rules:",
      "- `counterpartyDomain` must be the sender's domain, without a scheme.",
      "- `dueAt` must be an ISO 8601 date if the message states one, else null. Do",
      "  not infer a date that is not written down.",
      "- `amount` must be a number if the message states one, else null. Never guess.",
      "- `reference` is the order, booking or account number if there is one, else \"\".",
      "- If you are not sure, set keep to false and say why.",
    ].join("\n");

    const raw = await ctx.runAction(internal.ai.complete, {
      operation: "ingest-paper-trail",
      system,
      user: `From: ${message.fromAddress}\nSubject: ${message.subject}\n\n${message.text.slice(0, 12_000)}`,
      json: true,
      maxTokens: 600,
    });

    let parsed: {
      keep?: boolean;
      reason?: string;
      kind?: string;
      counterpartyName?: string;
      counterpartyDomain?: string;
      reference?: string;
      description?: string;
      amount?: number | null;
      currency?: string | null;
      dueAt?: string | null;
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kept: false, reason: "Model reply was not JSON" };
    }

    if (!parsed.keep || !parsed.counterpartyDomain) {
      return { kept: false, reason: parsed.reason ?? "Not a record" };
    }

    const kinds = ["order", "booking", "subscription", "service", "other"] as const;
    const kind = kinds.includes(parsed.kind as (typeof kinds)[number])
      ? (parsed.kind as (typeof kinds)[number])
      : "other";

    const counterpartyId = await ctx.runMutation(internal.records.upsertCounterparty, {
      userId: args.userId,
      name: parsed.counterpartyName || parsed.counterpartyDomain,
      domain: parsed.counterpartyDomain,
    });

    const dueAt = parsed.dueAt ? Date.parse(parsed.dueAt) : undefined;

    const recordId = await ctx.runMutation(internal.records.create, {
      userId: args.userId,
      counterpartyId,
      kind,
      reference: parsed.reference ?? "",
      description: parsed.description ?? message.subject,
      amount: typeof parsed.amount === "number" ? parsed.amount : undefined,
      currency: parsed.currency ?? undefined,
      dueAt: Number.isFinite(dueAt) ? dueAt : undefined,
      occurredAt: message.at,
      sourceMessageId: args.messageId,
    });

    // Now go and look for an entitlement in the gap between what was promised
    // and what the terms say.
    await ctx.scheduler.runAfter(0, internal.records.detect, { recordId });

    return { kept: true, reason: parsed.reason ?? "Kept" };
  },
});

/**
 * Look for a claim in a record.
 *
 * The question is deliberately narrow: given what this record says was
 * promised, and given what the counterparty's own published terms commit them
 * to, is there something owed here? The model is required to point at a
 * provision, so a claim can never be invented from nothing.
 */
export const detect = internalAction({
  args: { recordId: v.id("records") },
  handler: async (ctx, args): Promise<{ found: boolean; claimId?: Id<"claims">; reason: string }> => {
    const record = await ctx.runQuery(internal.records.get, { recordId: args.recordId });
    if (!record) return { found: false, reason: "No such record" };
    const counterparty = await ctx.runQuery(internal.policies.getCounterparty, {
      counterpartyId: record.counterpartyId,
    });
    if (!counterparty) return { found: false, reason: "No counterparty" };

    // The terms have to be read before a claim can be argued from them.
    if (counterparty.crawlStatus !== "crawled") {
      await ctx.runAction(internal.policies.readCounterparty, {
        counterpartyId: record.counterpartyId,
      });
    }

    const found = await ctx.runAction(internal.policies.relevant, {
      counterpartyId: record.counterpartyId,
      issue: record.description,
    });
    if (found.supporting.length === 0) {
      return { found: false, reason: "Their published terms commit them to nothing here." };
    }

    const provisions = found.supporting
      .map((p) => `[${p.doc.reference}] ${p.doc.text}`)
      .join("\n\n");

    const system = [
      "You decide whether a customer is owed something by a company, using only the",
      "company's own published provisions and the record of the transaction.",
      "",
      "Be strict. A claim only exists when a specific provision commits the company",
      "to a specific remedy and the record shows the condition for it was met.",
      "Do not invent facts, amounts or dates. If the record does not show that",
      "something went wrong, there is no claim.",
      "",
      "Return JSON: {\"claim\": boolean, \"title\": string, \"basis\": string,",
      " \"provisionReference\": string, \"amount\": number|null, \"currency\": string|null,",
      " \"deadlineBasis\": string, \"reason\": string}",
      "",
      "`basis` is one sentence: what entitles them. `deadlineBasis` is what the",
      "company's own terms say about how long they have to put it right.",
    ].join("\n");

    const user = [
      `Counterparty: ${counterparty.name} (${counterparty.domain})`,
      `Transaction: ${record.description}`,
      record.reference ? `Reference: ${record.reference}` : "",
      record.amount ? `Amount: ${record.currency ?? "GBP"} ${record.amount}` : "",
      record.dueAt ? `Promised for: ${new Date(record.dueAt).toISOString().slice(0, 10)}` : "",
      "",
      "Their published provisions:",
      provisions,
      "",
      "What the record shows happened:",
      record.description,
    ]
      .filter(Boolean)
      .join("\n");

    const raw = await ctx.runAction(internal.ai.complete, {
      operation: "detect-claim",
      system,
      user,
      json: true,
      maxTokens: 700,
    });

    let parsed: {
      claim?: boolean;
      title?: string;
      basis?: string;
      provisionReference?: string;
      amount?: number | null;
      currency?: string | null;
      deadlineBasis?: string;
      reason?: string;
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { found: false, reason: "Model reply was not JSON" };
    }

    if (!parsed.claim || !parsed.basis) {
      return { found: false, reason: parsed.reason ?? "Nothing owed on their own terms." };
    }

    // Bind the claim back to the provision it is argued from, so the letter can
    // cite it by reference and a reader can go and check it.
    const matched = found.supporting.find(
      (p) => p.doc.reference === parsed.provisionReference,
    );

    const claimId = await ctx.runMutation(internal.claims.create, {
      userId: record.userId,
      counterpartyId: record.counterpartyId,
      recordId: args.recordId,
      provisionId: matched?.doc._id,
      title: parsed.title || record.description,
      basis: parsed.basis,
      amountClaimed: typeof parsed.amount === "number" ? parsed.amount : undefined,
      currency: parsed.currency || record.currency || "GBP",
      detectedBy: "agent",
      deadlineBasis: parsed.deadlineBasis || undefined,
      nextActionAt: undefined,
    });

    // Move it on immediately rather than waiting for the half-hourly sweep, so
    // the chain from "a confirmation landed at your agent's address" to "here
    // is the letter, approve it" completes in seconds. Drafting is internal and
    // reversible; the send still waits for the owner.
    await ctx.scheduler.runAfter(0, internal.sweep.runOne, { claimId });

    return { found: true, claimId, reason: parsed.basis };
  },
});

export const get = internalQuery({
  args: { recordId: v.id("records") },
  handler: async (ctx, args) => await ctx.db.get(args.recordId),
});

/** The paper trail, newest first, for the UI. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("records")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const withNames = await Promise.all(
      rows.map(async (record) => {
        const counterparty = await ctx.db.get(record.counterpartyId);
        return { ...record, counterpartyName: counterparty?.name ?? "Unknown" };
      }),
    );
    return withNames.sort((a, b) => b.occurredAt - a.occurredAt);
  },
});
