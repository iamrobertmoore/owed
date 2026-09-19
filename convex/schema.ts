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

  /**
   * One address per person. This is the product's front door.
   *
   * A row is either an inbox the provider provisioned or, for a guest, an
   * alias on the shared one. `onSharedInbox` tells them apart. `address` is
   * what the inbound router reads, and it is unique across both kinds.
   */
  inboxes: defineTable({
    userId: v.id("users"),
    address: v.string(),
    agentmailInboxId: v.string(),
    displayName: v.string(),
    /**
     * True when this address is an alias on the shared inbox rather than an
     * inbox of its own. A guest is given `owed+<token>@…`, which the provider
     * delivers to the shared inbox while keeping the tag in the envelope, so
     * one row is all the routing needs and no guest spends one of the three
     * provisioned inboxes.
     */
    onSharedInbox: v.optional(v.boolean()),
    /**
     * Reserved for the first proven message round trip, and a placeholder
     * rather than a feature. Measured 18 September 2026: no code outside this
     * line names `verifiedAt`, and no row in `inboxes` carries it, so nothing
     * writes it and nothing reads it. Wire it or remove it before the field is
     * read as a capability, because a schema field whose comment describes when
     * it is set is indistinguishable from one that is.
     */
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
   * was due. Holding this is what lets the agent find a claim rather than wait
   * to be told about one.
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
    /**
     * Set on the worked example's rows only, the same way `claims` and
     * `messages` mark theirs.
     *
     * Without it the ledger cannot tell a seeded record from one that came out
     * of a real delivery. The records count at the top of the page reads "from
     * the worked example", and it was reading that over a ledger holding a real
     * order. The headline figure is honest arithmetic over whatever is in the
     * ledger, so the one thing it must not do is misdescribe what is in it.
     */
    demoKey: v.optional(v.string()),
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
    /**
     * What the reader decided about this message, if it was handed to the
     * reader at all. Stored rather than returned, because the reason is the
     * only thing that lets an owner tell "read and declined" from "never
     * arrived", and those two want opposite responses.
     */
    ingestOutcome: v.optional(v.union(v.literal("kept"), v.literal("declined"))),
    ingestReason: v.optional(v.string()),
    /** The record this message became, when it became one. */
    recordId: v.optional(v.id("records")),
    /**
     * Set on the worked example's rows only, the same way `claims` marks its
     * own. The arrivals list has to be able to say which messages are
     * reconstructed, because a message that arrived and was turned down is
     * indistinguishable on screen from one that was turned down by the agent,
     * and the first is a demonstration while the second is a fact.
     */
    demoKey: v.optional(v.string()),
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

  /**
   * Running totals over `aiCache`, so that reporting the spend does not read it.
   *
   * One row, keyed on `scope`. It exists because `claims.spend` is a reactive
   * query the landing page subscribes to, and it read the whole log on every
   * re-run. Measured on the judged deployment, 19 September 2026: **336 rows
   * weighing 4.79 MB**, of which 253 embedding rows are 4.67 MB, because an
   * embedding is cached as its 1024 floats rendered as text at about 19 KB each.
   * Every write to the log therefore re-ran the query and every visitor paid the
   * 4.79 MB again, which on its own is enough to explain the deployment passing
   * the free plan's 1 GB of database I/O. These totals make it a one-row read.
   *
   * They are written in the same transaction as the insert, in `aiCache.put`,
   * which is the only writer of the log. A count maintained beside the rows it
   * counts can drift, and this one cannot: there is no path that inserts a call
   * without bumping it, so the two change together or not at all.
   */
  spendTotals: defineTable({
    scope: v.string(),
    distinctCalls: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    embeddingTokens: v.number(),
  }).index("by_scope", ["scope"]),
});
