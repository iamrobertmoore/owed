import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { EMBEDDING_DIMENSIONS } from "./pricing";
import { GUEST_ADDRESS } from "./inboxes";

/**
 * The worked example.
 *
 * A guest arriving at the deployed app has an empty ledger, because every
 * claim is scoped to the person who owns it. An empty ledger is a bad first
 * impression and a worse demo: the product's whole argument is that a claim
 * can be found rather than described, and there is nothing to look at until
 * somebody forwards an email and waits.
 *
 * So a guest's ledger is seeded with four claims that have already lived.
 * They are reconstructed content, not deliveries: no mail was sent, no model
 * was called, and nothing here costs anything to look at.
 *
 * Three rules keep this honest.
 *
 * The counterparties are fictional and their domains sit under `.example`,
 * which is reserved by RFC 2606 and can never resolve. Publishing a claim
 * asserting that a real named business stonewalled me would be a false
 * statement about a real company, and a product whose argument is that
 * nothing gets overclaimed cannot open by overclaiming.
 *
 * Only guests get it. `seedExample` refuses a user who has an email, so
 * somebody who made a real account never finds content in their ledger that
 * they did not create.
 *
 * The claims are marked. Every row carries a `demoKey`, the ledger shows a
 * worked example chip against them, and the letter is never transmitted: see
 * `letters.approve`, which advances a demo row and says so in the timeline
 * rather than putting mail on the wire.
 */

type DemoLetter = {
  subject: string;
  text: string;
  /** Days before now. */
  daysAgo: number;
};

type DemoReply = {
  subject: string;
  text: string;
  classification: "concession" | "acknowledgement" | "refusal" | "stall" | "question" | "unreadable";
  commitment?: string;
  daysAgo: number;
};

type DemoCase = {
  key: string;
  counterparty: {
    name: string;
    domain: string;
    policyUrls: string[];
    complaintsAddress: string;
    escalationBody?: string;
    publishedResponseDays?: number;
  };
  /** The clause the claim is argued from. */
  provision: {
    documentUrl: string;
    documentTitle: string;
    reference: string;
    text: string;
  };
  /** The clause they will quote back. Stored so the letter can pre-empt it. */
  opposing?: {
    documentUrl: string;
    documentTitle: string;
    reference: string;
    text: string;
  };
  record: {
    kind: "order" | "booking" | "subscription" | "service" | "other";
    reference: string;
    description: string;
    amount: number;
    daysAgo: number;
    /** Days before now that it was due. */
    dueInDays?: number;
  };
  claim: {
    title: string;
    basis: string;
    amountClaimed: number;
    amountRecovered?: number;
    stage:
      | "detected"
      | "drafting"
      | "awaiting_approval"
      | "sent"
      | "negotiating"
      | "escalated"
      | "settled"
      | "exhausted";
    rung: number;
    deadlineBasis: string;
    /** Days from now until the next step, if one is scheduled. */
    nextActionInDays?: number;
    settledDaysAgo?: number;
  };
  letters: DemoLetter[];
  replies?: DemoReply[];
  events: { kind: "detected" | "policy_read" | "drafted" | "approved" | "sent" | "replied" | "classified" | "escalated" | "settled" | "exhausted" | "note"; detail: string; daysAgo: number }[];
};

const DEMO_CASES: DemoCase[] = [
  {
    key: "demo-found",
    counterparty: {
      name: "Halden Optics",
      domain: "haldenoptics.example",
      policyUrls: ["https://haldenoptics.example/returns-and-refunds"],
      complaintsAddress: "refunds@haldenoptics.example",
      escalationBody: "Retail ADR Scheme",
      publishedResponseDays: 14,
    },
    provision: {
      documentUrl: "https://haldenoptics.example/returns-and-refunds",
      documentTitle: "Returns and refunds",
      reference: "Clause 4.2",
      text: "Where goods arrive damaged, we will refund the full purchase price including the original delivery charge, provided we are told within 60 days of delivery.",
    },
    record: {
      kind: "order",
      reference: "HO-4482",
      description: "35mm f/1.8 lens, arrived with a cracked front element",
      amount: 349,
      daysAgo: 46,
      dueInDays: -44,
    },
    claim: {
      title: "Damaged lens, refund owed under their own returns policy",
      basis:
        "Their returns policy promises a full refund on goods that arrive damaged if they are told within 60 days, and the delivery was reported the day it landed.",
      amountClaimed: 349,
      amountRecovered: 349,
      stage: "settled",
      rung: 1,
      deadlineBasis: "They publish 14 days to answer a refund request.",
      settledDaysAgo: 12,
    },
    letters: [
      {
        subject: "Damaged 35mm lens, order HO-4482: refund under clause 4.2",
        daysAgo: 42,
        text: `Hello,

On the order below I bought a 35mm f/1.8 lens, order HO-4482, for £349.00. It arrived with a crack across the front element and I reported it the day it landed.

Your Returns and refunds policy, clause 4.2, says:

"Where goods arrive damaged, we will refund the full purchase price including the original delivery charge, provided we are told within 60 days of delivery."

I told you within three days, so the condition in 4.2 is met. Please refund £349.00 to the card used for the order.

To be clear about what I am asking for: clause 4.2 gives me a refund, not a repair and not a replacement. I am asking for the refund.

Robert`,
      },
    ],
    events: [
      { kind: "detected", daysAgo: 43, detail: "Found from the paper trail: the order confirmation showed a lens delivered, and no refund followed." },
      { kind: "policy_read", daysAgo: 43, detail: "Read Returns and refunds. Clause 4.2 supports the claim, so it was quoted by reference." },
      { kind: "drafted", daysAgo: 42, detail: "Drafted a first letter citing clause 4.2." },
      { kind: "approved", daysAgo: 42, detail: "Approved by the owner." },
      { kind: "sent", daysAgo: 42, detail: "Sent from the agent's address." },
      { kind: "settled", daysAgo: 12, detail: "Recovered GBP 349.00. Their words: \"We have refunded the full amount to the original card, please allow three working days.\"" },
    ],
  },
  {
    key: "demo-polite",
    counterparty: {
      name: "Bramble Court Hotel",
      domain: "bramblecourt.example",
      policyUrls: ["https://bramblecourt.example/booking-terms"],
      complaintsAddress: "reservations@bramblecourt.example",
      publishedResponseDays: 10,
    },
    provision: {
      documentUrl: "https://bramblecourt.example/booking-terms",
      documentTitle: "Booking terms",
      reference: "Clause 6.1",
      text: "A deposit taken at check-in will be returned to the card used within ten working days of checkout, less any charges for damage or incidentals.",
    },
    record: {
      kind: "booking",
      reference: "BC-9931",
      description: "Two nights, £180.00 deposit taken at check-in",
      amount: 180,
      daysAgo: 34,
      dueInDays: -32,
    },
    claim: {
      title: "Deposit promised back in ten working days, still held",
      basis:
        "Their booking terms commit them to returning the deposit within ten working days of checkout, and no charge was made against the room.",
      amountClaimed: 180,
      stage: "negotiating",
      rung: 1,
      deadlineBasis: "They publish 10 days to answer.",
    },
    letters: [
      {
        subject: "Deposit not returned, booking BC-9931",
        daysAgo: 20,
        text: `Hello,

I stayed two nights from the booking below, reference BC-9931, and paid a £180.00 deposit at check-in. I made no charges against the room and left it in the condition I found it.

Your Booking terms, clause 6.1, says:

"A deposit taken at check-in will be returned to the card used within ten working days of checkout, less any charges for damage or incidentals."

It is now well past ten working days and the deposit has not come back. There were no damage or incidental charges for you to deduct.

Please return £180.00 to the card used at check-in.

Robert`,
      },
    ],
    replies: [
      {
        subject: "Re: Deposit not returned, booking BC-9931",
        daysAgo: 6,
        classification: "acknowledgement",
        text: `Thank you for your email, and I am very sorry about the delay. I have passed this to the reservations team, who will look into it and come back to you.

Kind regards,
Front of House`,
      },
    ],
    events: [
      { kind: "detected", daysAgo: 26, detail: "Found from the paper trail: the booking confirmation showed a deposit taken, and no refund followed." },
      { kind: "policy_read", daysAgo: 26, detail: "Read Booking terms. Clause 6.1 supports the claim." },
      { kind: "drafted", daysAgo: 20, detail: "Drafted a first letter citing clause 6.1." },
      { kind: "approved", daysAgo: 20, detail: "Approved by the owner." },
      { kind: "sent", daysAgo: 20, detail: "Sent from the agent's address." },
      { kind: "replied", daysAgo: 6, detail: "A reply arrived at the agent's address." },
      { kind: "classified", daysAgo: 6, detail: "Read as an acknowledgement, not a concession. An apology with no decision behind it does not settle anything, so the claim stays open." },
    ],
  },
  {
    key: "demo-silent",
    counterparty: {
      name: "Tessellate Rail",
      domain: "tessellaterail.example",
      policyUrls: ["https://tessellaterail.example/conditions-of-carriage"],
      complaintsAddress: "customer.relations@tessellaterail.example",
      escalationBody: "Rail Ombudsman",
      publishedResponseDays: 14,
    },
    provision: {
      documentUrl: "https://tessellaterail.example/conditions-of-carriage",
      documentTitle: "Conditions of carriage",
      reference: "Clause 9.4",
      text: "If a booked service is cancelled, a full refund will be issued on request without an administration fee.",
    },
    opposing: {
      documentUrl: "https://tessellaterail.example/conditions-of-carriage",
      documentTitle: "Conditions of carriage",
      reference: "Clause 9.5",
      text: "The refund in clause 9.4 does not apply where a replacement service was offered within 60 minutes of the booked departure.",
    },
    record: {
      kind: "service",
      reference: "TR-2210",
      description: "Advance ticket, 07:12 service cancelled with no replacement",
      amount: 128.4,
      daysAgo: 22,
      dueInDays: -22,
    },
    claim: {
      title: "Cancelled service, refund owed without an administration fee",
      basis:
        "Their conditions of carriage give a full refund on a cancelled service, and the exclusion they would rely on does not apply because the next usable train was over two hours later.",
      amountClaimed: 128.4,
      stage: "escalated",
      rung: 2,
      deadlineBasis: "They publish 14 days to answer a complaint.",
      nextActionInDays: 14,
    },
    letters: [
      {
        subject: "Cancelled 07:12 service, booking TR-2210: refund under clause 9.4",
        daysAgo: 18,
        text: `Hello,

I held an advance ticket on the 07:12 service on 3 September, booking TR-2210, which I paid £128.40 for. The service was cancelled and nothing was put in its place that morning.

Your Conditions of carriage, clause 9.4, says:

"If a booked service is cancelled, a full refund will be issued on request without an administration fee."

I am aware clause 9.5 says the refund in 9.4 does not apply where a replacement was offered within 60 minutes of the booked departure. The next service I could actually use departed at 09:40, more than two hours later, so 9.5 does not apply here.

Please refund £128.40.

Robert`,
      },
      {
        subject: "Second request: cancelled 07:12 service, booking TR-2210",
        daysAgo: 3,
        text: `Hello,

I wrote to you on the matter below and have had no reply. Your Conditions of carriage promise a refund on a cancelled service without an administration fee, and clause 9.5 does not apply because the next usable service was over two hours later.

Your own published response time is 14 days. That has now passed.

If I do not hear from you within 14 days of this letter I will take the complaint to the Rail Ombudsman and include this correspondence.

Please refund £128.40.

Robert`,
      },
    ],
    events: [
      { kind: "detected", daysAgo: 21, detail: "Found from the paper trail: the ticket was booked and the service never ran, and no refund followed." },
      { kind: "policy_read", daysAgo: 21, detail: "Read Conditions of carriage. Clause 9.4 supports the claim and clause 9.5 is the exclusion they would rely on." },
      { kind: "drafted", daysAgo: 20, detail: "Drafted a first letter citing clause 9.4 and answering clause 9.5 before they raised it." },
      { kind: "approved", daysAgo: 20, detail: "Approved by the owner." },
      { kind: "sent", daysAgo: 18, detail: "Sent from the agent's address." },
      { kind: "escalated", daysAgo: 3, detail: "No reply inside the 14 days they publish. Moved up a rung and drafted a second letter." },
    ],
  },
  {
    key: "demo-gate",
    counterparty: {
      name: "Ashgrove Broadband",
      domain: "ashgrovebroadband.example",
      policyUrls: ["https://ashgrovebroadband.example/terms"],
      complaintsAddress: "contracts@ashgrovebroadband.example",
      escalationBody: "Communications Ombudsman",
      publishedResponseDays: 14,
    },
    provision: {
      documentUrl: "https://ashgrovebroadband.example/terms",
      documentTitle: "Terms",
      reference: "Clause 11.3",
      text: "If we increase your monthly charges during your minimum term, you may end your contract within 30 days of being told, without an early termination charge.",
    },
    opposing: {
      documentUrl: "https://ashgrovebroadband.example/terms",
      documentTitle: "Terms",
      reference: "Clause 11.4",
      text: "Clause 11.3 does not apply where the increase is required by law or by our regulator.",
    },
    record: {
      kind: "subscription",
      reference: "AB-7741",
      description: "24 month contract, price rising £6.50 a month mid-term",
      amount: 78,
      daysAgo: 4,
      dueInDays: 22,
    },
    claim: {
      title: "Mid-contract price rise, right to leave without a charge",
      basis:
        "Their terms allow a contract to be ended without an early termination charge after a mid-term price rise, and the increase is not a regulatory one, so the exclusion does not bite.",
      amountClaimed: 78,
      stage: "awaiting_approval",
      rung: 1,
      deadlineBasis: "They give 30 days from the notice to end the contract.",
    },
    letters: [
      {
        subject: "Price rise mid-contract, account AB-7741: notice under clause 11.3",
        daysAgo: 0,
        text: `Hello,

I am in a 24 month contract with you, account AB-7741, which runs to 14 March. On 1 September I was told my monthly price is going up by £6.50 from October.

Your Terms, clause 11.3, says:

"If we increase your monthly charges during your minimum term, you may end your contract within 30 days of being told, without an early termination charge."

Clause 11.4 excludes this where the increase is required by law or by our regulator. This one is not: your own notice says the increase is to fund network investment.

Your early termination charge on this account is £78.00, which is what I should not have to pay.

I am giving notice under 11.3 and asking you to confirm that the account closes with no early termination charge.

Robert`,
      },
    ],
    events: [
      { kind: "detected", daysAgo: 3, detail: "Found from the paper trail: a price rise notice arrived on a contract that has not expired." },
      { kind: "policy_read", daysAgo: 3, detail: "Read Terms. Clause 11.3 supports the claim and clause 11.4 is the exclusion they would rely on." },
      { kind: "drafted", daysAgo: 0, detail: "Drafted a letter citing clause 11.3 and answering clause 11.4. Waiting on the owner to send it." },
    ],
  },
];

const DAY = 86_400_000;

/**
 * A deterministic stand-in for an embedding.
 *
 * The worked example is seeded with no network call and no spend, so these are
 * not model output and nothing retrieves them. They are stored because the
 * vector index is part of the schema, and a real provision arriving through
 * `policies.ts` gets a real embedding. Saying so here rather than leaving a
 * reader to assume these came from `text-embedding-3-small`.
 */
function placeholderVector(seed: string): number[] {
  let h = 2166136261;
  const out: number[] = [];
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    h ^= seed.charCodeAt(i % seed.length) + i;
    h = Math.imul(h, 16777619);
    out.push(((h >>> 0) / 0xffffffff) * 2 - 1);
  }
  return out;
}

/**
 * Seed the worked example into one user's ledger.
 *
 * Idempotent, so a reload, a remount or a second tab cannot double it.
 *
 * The guard that matters lives here rather than behind `getAuthUserId`, because
 * a deployment cannot mint a JWT locally and anything behind a session is
 * unverifiable until the app is live. Keeping the decision separate from the
 * session lookup is what makes it testable.
 *
 * Whether a registered account is allowed to ask for the example is the
 * caller's business, not this function's. What this function refuses, always,
 * is adding to a ledger that already has something in it.
 */
export const seedForUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ seeded: boolean; reason?: string }> => {
    const userId = args.userId;

    const user = await ctx.db.get(userId);
    if (!user) return { seeded: false, reason: "No user" };

    const existing = await ctx.db
      .query("claims")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (existing) return { seeded: false, reason: "Already has claims" };

    const now = Date.now();

    for (const demo of DEMO_CASES) {
      const counterpartyId = await ctx.db.insert("counterparties", {
        userId,
        name: demo.counterparty.name,
        domain: demo.counterparty.domain,
        policyUrls: demo.counterparty.policyUrls,
        crawlStatus: "crawled",
        crawlNote: "Read for the worked example.",
        crawledAt: now - 43 * DAY,
        complaintsAddress: demo.counterparty.complaintsAddress,
        escalationBody: demo.counterparty.escalationBody,
        publishedResponseDays: demo.counterparty.publishedResponseDays,
      });

      const provisionId = await ctx.db.insert("provisions", {
        counterpartyId,
        documentUrl: demo.provision.documentUrl,
        documentTitle: demo.provision.documentTitle,
        reference: demo.provision.reference,
        text: demo.provision.text,
        stance: "supports",
        embedding: placeholderVector(demo.provision.reference),
      });

      if (demo.opposing) {
        await ctx.db.insert("provisions", {
          counterpartyId,
          documentUrl: demo.opposing.documentUrl,
          documentTitle: demo.opposing.documentTitle,
          reference: demo.opposing.reference,
          text: demo.opposing.text,
          stance: "opposes",
          embedding: placeholderVector(demo.opposing.reference),
        });
      }

      const recordId = await ctx.db.insert("records", {
        userId,
        counterpartyId,
        kind: demo.record.kind,
        reference: demo.record.reference,
        description: demo.record.description,
        amount: demo.record.amount,
        currency: "GBP",
        dueAt:
          demo.record.dueInDays !== undefined
            ? now + demo.record.dueInDays * DAY
            : undefined,
        occurredAt: now - demo.record.daysAgo * DAY,
      });

      const claimId = await ctx.db.insert("claims", {
        userId,
        counterpartyId,
        recordId,
        provisionId,
        title: demo.claim.title,
        basis: demo.claim.basis,
        amountClaimed: demo.claim.amountClaimed,
        amountRecovered: demo.claim.amountRecovered,
        currency: "GBP",
        stage: demo.claim.stage,
        detectedBy: "agent",
        deadlineBasis: demo.claim.deadlineBasis,
        nextActionAt:
          demo.claim.nextActionInDays !== undefined
            ? now + demo.claim.nextActionInDays * DAY
            : undefined,
        rung: demo.claim.rung,
        createdAt: now - 43 * DAY,
        updatedAt: now,
        settledAt:
          demo.claim.settledDaysAgo !== undefined
            ? now - demo.claim.settledDaysAgo * DAY
            : undefined,
        demoKey: demo.key,
      });

      for (const [index, letter] of demo.letters.entries()) {
        await ctx.db.insert("messages", {
          userId,
          claimId,
          direction: "outbound",
          fromAddress: GUEST_ADDRESS,
          toAddress: demo.counterparty.complaintsAddress,
          subject: letter.subject,
          text: letter.text,
          // Unique per guest, so this never collides with a real delivery.
          providerMessageId: `example-${userId}-${demo.key}-out-${index}`,
          at: now - letter.daysAgo * DAY,
        });
      }

      for (const [index, reply] of (demo.replies ?? []).entries()) {
        await ctx.db.insert("messages", {
          userId,
          claimId,
          direction: "inbound",
          fromAddress: demo.counterparty.complaintsAddress,
          toAddress: GUEST_ADDRESS,
          subject: reply.subject,
          text: reply.text,
          providerMessageId: `example-${userId}-${demo.key}-in-${index}`,
          classification: reply.classification,
          commitment: reply.commitment,
          at: now - reply.daysAgo * DAY,
        });
      }

      for (const event of demo.events) {
        await ctx.db.insert("events", {
          claimId,
          at: now - event.daysAgo * DAY,
          kind: event.kind,
          detail: event.detail,
        });
      }
    }

    return { seeded: true };
  },
});

/**
 * Called once on arrival. A guest's ledger would otherwise be empty, and an
 * empty ledger is a bad first impression and a worse demo: the product's whole
 * argument is that a claim can be found rather than described, and there is
 * nothing to look at until somebody forwards an email and waits.
 *
 * Guests only. Somebody who made a real account gets an empty ledger and can
 * ask for the example explicitly, because content appearing in a real ledger
 * uninvited is exactly the kind of thing this product is supposed to be careful
 * about.
 */
export const seedExample = mutation({
  args: {},
  handler: async (ctx): Promise<{ seeded: boolean; reason?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { seeded: false, reason: "Not signed in" };

    const user = await ctx.db.get(userId);
    if (user?.email) return { seeded: false, reason: "Not a guest" };

    return await ctx.runMutation(internal.example.seedForUser, { userId });
  },
});

/**
 * Load the worked example into a real account, on request.
 *
 * This exists so the product can be understood, and recorded, without
 * forwarding an email and waiting. It is the same content as the guest seed and
 * it obeys the same rule: nothing is added to a ledger that already holds
 * something, so the example can never mix with real claims.
 */
export const loadExample = mutation({
  args: {},
  handler: async (ctx): Promise<{ seeded: boolean; reason?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { seeded: false, reason: "Not signed in" };
    return await ctx.runMutation(internal.example.seedForUser, { userId });
  },
});
