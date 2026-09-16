import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { EMBEDDING_DIMENSIONS } from "./pricing";

/**
 * Owed keeps a ledger of what a person is owed.
 *
 * The shape follows the product: an agent holds an address, a paper trail
 * arrives at that address, the counterparty's own published terms are read,
 * and an entitlement is found in the gap between the two. Everything else
 * exists to prove or pursue that entitlement.
 *
 * The embedding width comes from `pricing.ts` so the vector index and the
 * model call that fills it can never disagree about it.
 */

/** Where a claim sits in its life. Ordered. */
export const STAGES = [
  "detected", // found, not yet checked by a human
  "drafting", // the letter is being written
  "awaiting_approval", // written, waiting on the owner to send it
  "sent", // out of the door, waiting on the counterparty
  "negotiating", // they replied with something that is not a resolution
  "escalated", // moved up a rung
  "settled", // they paid, replaced or fixed it
  "exhausted", // no further step is ours to take
] as const;

export const STAGE = v.union(
  v.literal("detected"),
  v.literal("drafting"),
  v.literal("awaiting_approval"),
  v.literal("sent"),
  v.literal("negotiating"),
  v.literal("escalated"),
  v.literal("settled"),
  v.literal("exhausted"),
);

/**
 * How a reply is read. `concession` is the only one that settles anything.
 * An apology with no decision behind it is an acknowledgement, not a
 * concession, and treating those as the same thing is how a chase gives up
 * early.
 */
export const CLASSIFICATIONS = [
  "concession",
  "acknowledgement",
  "refusal",
  "stall",
  "question",
  "unreadable",
] as const;

export const CLASSIFICATION = v.union(
  v.literal("concession"),
  v.literal("acknowledgement"),
  v.literal("refusal"),
  v.literal("stall"),
  v.literal("question"),
  v.literal("unreadable"),
);

export default defineSchema({
  ...authTables,

  /** One address per person. This is the product's front door. */
  inboxes: defineTable({
    userId: v.id("users"),
    address: v.string(),
    agentmailInboxId: v.string(),
    displayName: v.string(),
    /** Set once the first real message round trip has been proven. */
    verifiedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_address", ["address"]),

  /** Someone we are owed something by. */
  counterparties: defineTable({
    userId: v.id("users"),
    name: v.string(),
    domain: v.string(),
    /** Where the terms live. Read by Firecrawl, not guessed. */
    policyUrls: v.array(v.string()),
    crawlStatus: v.union(
      v.literal("pending"),
      v.literal("crawled"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    crawlNote: v.optional(v.string()),
    crawledAt: v.optional(v.number()),
    /** Their actual complaints route, not the generic contact address. */
    complaintsAddress: v.optional(v.string()),
    /** The ombudsman or ADR scheme they belong to, if they say. */
    escalationBody: v.optional(v.string()),
    /** The response window they publish, in days. */
    publishedResponseDays: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_domain", ["userId", "domain"]),

  /**
   * A single citable provision, kept verbatim with the document's own
   * reference so a letter can cite it by number and a reader can check it.
   */
  provisions: defineTable({
    counterpartyId: v.id("counterparties"),
    documentUrl: v.string(),
    documentTitle: v.string(),
    reference: v.string(),
    text: v.string(),
    /** `opposes` is the clause they will quote back at us. Worth knowing early. */
    stance: v.union(v.literal("supports"), v.literal("opposes")),
    embedding: v.array(v.float64()),
  })
    .index("by_counterparty", ["counterpartyId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIMENSIONS,
      filterFields: ["counterpartyId"],
    }),

  /**
   * The paper trail. What was bought, from whom, on what terms, and when it
   * was due. This is the part the field's other entries do not hold, and it
   * is the reason this agent can find a claim rather than wait to be told.
   */
  records: defineTable({
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
    /** When the thing was supposed to happen. */
    dueAt: v.optional(v.number()),
    occurredAt: v.number(),
    /** Where the record came from, so a judge can see it is not invented. */
    sourceMessageId: v.optional(v.id("messages")),
  })
    .index("by_user", ["userId"])
    .index("by_counterparty", ["counterpartyId"])
    .index("by_user_and_due", ["userId", "dueAt"]),

  /** Something the agent believes you are owed. */
  claims: defineTable({
    userId: v.id("users"),
    counterpartyId: v.id("counterparties"),
    recordId: v.optional(v.id("records")),
    /** The provision the claim is argued from. */
    provisionId: v.optional(v.id("provisions")),
    title: v.string(),
    /** One line: what entitles you to this. */
    basis: v.string(),
    amountClaimed: v.optional(v.number()),
    amountRecovered: v.optional(v.number()),
    currency: v.string(),
    stage: STAGE,
    /** `agent` if found from the paper trail, `user` if the owner brought it. */
    detectedBy: v.union(v.literal("agent"), v.literal("user")),
    /** What published deadline drives the next step, in the company's words. */
    deadlineBasis: v.optional(v.string()),
    /** The next moment this claim needs something to happen. */
    nextActionAt: v.optional(v.number()),
    /** How far up the ladder we are. Each rung is a different letter. */
    rung: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    settledAt: v.optional(v.number()),
    /**
     * Set only on the worked example that a guest's ledger is seeded with.
     *
     * The slug is what makes `#claim=demo-found` resolve for any visitor. A
     * Convex id is owned by the person who created the row, so a link built
     * from one is dead for everybody else. A slug is stable and portable.
     */
    demoKey: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_stage", ["userId", "stage"])
    .index("by_next_action", ["nextActionAt"])
    .index("by_counterparty", ["counterpartyId"])
    .index("by_user_and_demo_key", ["userId", "demoKey"]),

  /**
   * Every email in and out. A message can arrive before it belongs to a claim:
   * a confirmation lands, becomes a record, and only later does it support a
   * claim. So `claimId` is optional and the owner is always known.
   */
  messages: defineTable({
    userId: v.id("users"),
    claimId: v.optional(v.id("claims")),
    /**
     * The address it arrived at, or left from. Optional because the worked
     * example is reconstructed content rather than a delivery: it has no
     * inbox row to point at, and inventing one would put an address in the
     * table that no mail could ever reach.
     */
    inboxId: v.optional(v.id("inboxes")),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    fromAddress: v.string(),
    toAddress: v.string(),
    subject: v.string(),
    text: v.string(),
    /** The provider's id, for deduplicating webhook redeliveries. */
    providerMessageId: v.string(),
    providerThreadId: v.optional(v.string()),
    classification: v.optional(CLASSIFICATION),
    /** What the counterparty actually committed to, quoted. */
    commitment: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_claim", ["claimId"])
    .index("by_provider_message", ["providerMessageId"]),

  /** The timeline. Append only, so the ledger can be read back honestly. */
  events: defineTable({
    claimId: v.id("claims"),
    at: v.number(),
    kind: v.union(
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
    detail: v.string(),
    /** Model id and token counts, so the OpenAI spend is visible not assumed. */
    model: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  }).index("by_claim", ["claimId"]),

  /** Files the owner attaches to a claim. Receipts, photos, screenshots. */
  evidence: defineTable({
    claimId: v.id("claims"),
    storageId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
    addedAt: v.number(),
  }).index("by_claim", ["claimId"]),

  /**
   * Every OpenAI call is cached by content hash and logged. No call runs on a
   * page load, and the spend is a number rather than a hope.
   */
  aiCache: defineTable({
    key: v.string(),
    operation: v.string(),
    model: v.string(),
    response: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    createdAt: v.number(),
  }).index("by_key", ["key"]),
});
