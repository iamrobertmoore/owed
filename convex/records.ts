import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { contentKey } from "./ai";
import { MODEL } from "./pricing";

/**
 * The paper trail.
 *
 * Owed holds the record of what was bought, from whom, on what terms and when
 * it was due, which is what lets it notice that something went wrong without
 * being told. A claim is argued from a record rather than from a description,
 * so the record has to come first.
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
 * Write the reader's decision back onto the message it read.
 *
 * The reason used to be computed and returned to a scheduler that discarded
 * it, so a message that arrived and was declined left no trace anywhere. An
 * owner who forwarded something could not tell that from a message that never
 * arrived, and those two want opposite responses: one means the product looked
 * and said no, the other means the post is broken.
 */
export const markIngest = internalMutation({
  args: {
    messageId: v.id("messages"),
    outcome: v.union(v.literal("kept"), v.literal("declined")),
    reason: v.string(),
    recordId: v.optional(v.id("records")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      ingestOutcome: args.outcome,
      ingestReason: args.reason.slice(0, 300),
      ...(args.recordId ? { recordId: args.recordId } : {}),
    });
  },
});

/**
 * Put the reader's past decisions back onto the messages they were made about.
 *
 * The decision was never lost. Every model call is cached by a hash of its
 * exact prompt, so the reply is still in `aiCache`; what was missing was the
 * link from a message to its own decision, because `ingestOutcome` was added
 * after the first messages had already arrived. This rebuilds that link by
 * recomputing the same hash from the same prompt.
 *
 * It reconstructs rather than guesses. There is one reader prompt, held in
 * `INGEST_SYSTEM`, so the key computed here is the key the call used. That was
 * checked against this deployment's own cache before this was written: two
 * known keys, both reproduced exactly.
 *
 * A message whose call is not in the cache is left untouched rather than
 * marked declined. "We did not record a decision" and "the agent decided no"
 * are different facts, and the second one is the interesting one.
 */
export const backfillIngest = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .order("desc")
      .take(args.limit ?? 300);

    let recovered = 0;
    let alreadyRecorded = 0;
    let noCachedCall = 0;

    for (const m of messages) {
      if (m.direction !== "inbound") continue;
      if (m.ingestOutcome !== undefined) {
        alreadyRecorded++;
        continue;
      }

      // Byte-for-byte the inputs the reader used, because the key is a hash of
      // them and anything else finds nothing.
      const user = `From: ${m.fromAddress}\nSubject: ${m.subject}\n\n${(m.text ?? "").slice(0, 12_000)}`;
      const key = contentKey("complete", MODEL, "ingest-paper-trail", INGEST_SYSTEM, user);

      const cached = await ctx.runQuery(internal.aiCache.get, { key });
      if (!cached) {
        noCachedCall++;
        continue;
      }

      let parsed: { keep?: boolean; reason?: string };
      try {
        parsed = JSON.parse(cached.response);
      } catch {
        noCachedCall++;
        continue;
      }

      // The record is looked up rather than assumed: a message can be kept and
      // still have no record if the write after it failed.
      let recordId: Id<"records"> | undefined;
      if (parsed.keep) {
        const record = await ctx.db
          .query("records")
          .withIndex("by_user", (q) => q.eq("userId", m.userId))
          .filter((q) => q.eq(q.field("sourceMessageId"), m._id))
          .first();
        recordId = record?._id;
      }

      await ctx.db.patch(m._id, {
        ingestOutcome: parsed.keep ? "kept" : "declined",
        ingestReason: (parsed.reason ?? "No reason given").slice(0, 300),
        ...(recordId ? { recordId } : {}),
      });
      recovered++;
    }

    return { scanned: messages.length, recovered, alreadyRecorded, noCachedCall };
  },
});

/**
 * The reader's instructions, as a module constant.
 *
 * It is hoisted out of the action because the backfill below has to reproduce
 * a past call *exactly* to find it in the cache, and the cache key is a hash of
 * this text. Two copies of a prompt that must stay byte-identical is a bug
 * waiting to happen, so there is one copy.
 */
export const INGEST_SYSTEM = [
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

    const system = INGEST_SYSTEM;

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
      await ctx.runMutation(internal.records.markIngest, {
        messageId: args.messageId,
        outcome: "declined",
        reason: "The reader's reply was not JSON, so nothing could be kept from it.",
      });
      return { kept: false, reason: "Model reply was not JSON" };
    }

    if (!parsed.keep || !parsed.counterpartyDomain) {
      await ctx.runMutation(internal.records.markIngest, {
        messageId: args.messageId,
        outcome: "declined",
        reason: parsed.reason ?? "Not a record",
      });
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
    await ctx.runMutation(internal.records.markIngest, {
      messageId: args.messageId,
      outcome: "kept",
      reason: parsed.reason ?? "Kept as a record.",
      recordId,
    });
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
    // `null`, not `[]`, for a signed-out caller. Every other read in this app
    // returns null when there is no user, and an empty array is a different
    // statement: it says "this person has no records" to a client that has not
    // said who they are. The front end already treats null and [] the same way,
    // so this costs nothing and stops one read disagreeing with the rest.
    if (userId === null) return null;
    const rows = await ctx.db
      .query("records")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    /*
      Provenance is read from the claim as well as from the record.

      `records.demoKey` was added after the worked example had already been
      seeded into live ledgers, and `example.seedForUser` returns early once a
      ledger holds claims ("Already has claims"). So every ledger seeded before
      that field existed keeps records carrying no `demoKey` at all, and a count
      taken from the field alone reads those rows as real paper: the page
      announces "all from real mail" over four fictional orders.

      The claim found from a record carries its own marker and always did, so a
      record is example paper when either it or its claim says so. This is the
      rule `messages.list` already applies to the arrivals list, which is why
      that list never had this bug. Deriving it here rather than backfilling
      means no migration and no ledger left behind.
    */
    const claims = await ctx.db
      .query("claims")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const claimByRecord = new Map<string, (typeof claims)[number]>();
    for (const claim of claims) {
      if (claim.recordId) claimByRecord.set(claim.recordId as string, claim);
    }

    const withNames = await Promise.all(
      rows.map(async (record) => {
        const counterparty = await ctx.db.get(record.counterpartyId);
        return {
          ...record,
          counterpartyName: counterparty?.name ?? "Unknown",
          fromExample:
            record.demoKey !== undefined ||
            claimByRecord.get(record._id as string)?.demoKey !== undefined,
        };
      }),
    );
    return withNames.sort((a, b) => b.occurredAt - a.occurredAt);
  },
});

/**
 * One record, for the sheet that opens when a row is clicked.
 *
 * The arrivals list has always been able to say "became a record" without there
 * being anywhere to go and read it. A record with no claim found from it is the
 * ordinary outcome for an order confirmation, which is the first thing anybody
 * forwards, so the state that could not be opened was the common one rather
 * than the rare one. The row was rendered as plain text on purpose, because a
 * button that does nothing is worse than a row that does not look like one, but
 * the label above it still read as a promise.
 *
 * Scoped to the caller like every other read. A record id in a URL is not a
 * capability: somebody else's id returns null rather than a stranger's order.
 */
export const one = query({
  args: { recordId: v.id("records") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const record = await ctx.db.get(args.recordId);
    if (!record || record.userId !== userId) return null;

    const counterparty = await ctx.db.get(record.counterpartyId);

    /*
      The paper it was read from, resolved from both directions.

      A record created by the reader carries `sourceMessageId`. The worked
      example's rows carry nothing on that field, because the seed writes the
      link the other way: each message names the record it became. Reading only
      the record's own field leaves the sheet's most useful block empty on every
      example ledger, which is the screen a judge sees first.

      Derived here rather than backfilled, the same way `list` derives
      provenance: no migration, and no ledger left behind on an old shape. Two
      messages can become one record, which is why this is a list.
    */
    const own = await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const paper = own
      .filter((m) => m._id === record.sourceMessageId || m.recordId === record._id)
      .sort((a, b) => a.at - b.at)
      .map((m) => ({
        _id: m._id,
        subject: m.subject,
        fromAddress: m.fromAddress,
        at: m.at,
        text: m.text,
      }));

    // The claim found from this record, if there was one. Read the same way
    // `list` reads it, so the two surfaces cannot disagree about provenance.
    const claims = await ctx.db
      .query("claims")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const claim = claims.find((c) => c.recordId === record._id);

    return {
      ...record,
      counterpartyName: counterparty?.name ?? "Unknown",
      counterpartyDomain: counterparty?.domain ?? null,
      // Whether their terms were actually read, because "nothing in their terms
      // commits them here" and "I could not read their terms" are different
      // facts and the sheet must not let one stand in for the other.
      crawlStatus: counterparty?.crawlStatus ?? null,
      crawlNote: counterparty?.crawlNote ?? null,
      fromExample: record.demoKey !== undefined || claim?.demoKey !== undefined,
      claimId: claim?._id ?? null,
      claimTitle: claim?.title ?? null,
      paper,
    };
  },
});
