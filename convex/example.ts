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
  /**
   * The message that arrived to start this case, and what the reader made of
   * it.
   *
   * The arrivals list is the screen the product's argument actually rests on:
   * post arrived, the agent read it, and the record came out of that reading.
   * Without an arrival the worked example shows a paper trail with no paper
   * behind it, which is the one thing a visitor cannot check for themselves.
   */
  paper: {
    fromAddress: string;
    subject: string;
    text: string;
    /** What the reader decided, in its own words. */
    reason: string;
    /** Days before now that it arrived. */
    daysAgo: number;
  };
  /**
   * The second arrival: the piece of paper that states what went wrong.
   *
   * `detect` reads the record and the counterparty's provisions and nothing
   * else, and it is instructed not to invent facts. So a case whose only paper
   * is a confirmation cannot support a claim about damage, a deposit that was
   * not returned, or a cancelled service: the record would be asserting
   * something no arrival ever said, and a visitor who reads the arrival and
   * then the sheet has no way to answer "how did it know that?".
   *
   * This is the message that carries the condition, and it is the kind of post
   * that arrives on its own: a damage report, a cancellation notice, a note
   * that a deposit is still held. The owner forwards paper; the owner does not
   * open a case. Omitted where the first arrival already carries the condition,
   * which is the price-change notice.
   */
  condition?: {
    fromAddress: string;
    subject: string;
    text: string;
    /** What the reader decided, in its own words. */
    reason: string;
    /** Days before now that it arrived. */
    daysAgo: number;
  };
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
    paper: {
      fromAddress: "orders@haldenoptics.example",
      subject: "Order HO-4482 confirmed",
      daysAgo: 46,
      text: `Hello,

Thank you for your order. Your 35mm f/1.8 lens has been packed and should reach you within three working days.

Order HO-4482
35mm f/1.8 lens, one off
Subtotal £290.83
VAT £58.17
Total paid £349.00 GBP
Card ending 4417

Halden Optics`,
      reason:
        "An order confirmation stating what was bought, from whom, and for how much, so it is the paper a claim about the order would be argued from.",
    },
    condition: {
      fromAddress: "support@haldenoptics.example",
      subject: "Re: Order HO-4482 arrived damaged",
      daysAgo: 44,
      text: `Hello,

Thank you for the photographs. I have attached them to the order.

Order HO-4482
Item: 35mm f/1.8 lens
Paid: £349.00
Delivered: 12 August

I can confirm the front element arrived cracked. I have logged it as damage in transit and passed it to our refunds team.

Halden Optics`,
      reason:
        "A damage report on order HO-4482 confirming the lens arrived with a cracked front element, so it is the paper that shows the condition the returns policy asks about.",
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
      { kind: "detected", daysAgo: 43, detail: "Found from the paper trail: the damage report confirmed the front element arrived cracked, and the returns policy promises a full refund for goods that arrive damaged." },
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
    paper: {
      fromAddress: "reservations@bramblecourt.example",
      subject: "Your booking BC-9931 is confirmed",
      daysAgo: 34,
      text: `Dear Mr Moore,

We look forward to welcoming you. Your booking is confirmed as follows.

Booking BC-9931
Two nights, room 214, arriving Friday
Rate £90.00 per night
A deposit of £180.00 will be taken at check-in and returned to the same card after your stay.

Bramble Court Hotel`,
      reason:
        "A booking confirmation with a date, a rate and a stated deposit, so it is the paper a claim about the deposit would be argued from.",
    },
    condition: {
      fromAddress: "reservations@bramblecourt.example",
      subject: "Re: Deposit on booking BC-9931",
      daysAgo: 30,
      text: `Hello,

Booking BC-9931
Two nights, room 214
Deposit taken at check-in: £180.00
Checked out: 3 August

I have looked at the booking. The £180.00 deposit has not been returned to your card, and there is no charge recorded against the room. It is still with our finance team.

Bramble Court Reservations`,
      reason:
        "A note on booking BC-9931 stating the deposit has not been returned and that nothing was charged against the room, so it is the paper that shows the condition the booking terms ask about.",
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
      { kind: "detected", daysAgo: 26, detail: "Found from the paper trail: the hotel confirmed the deposit had not been returned and that nothing was charged against the room, and their terms promise it back within ten working days of checkout." },
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
    paper: {
      fromAddress: "tickets@tessellaterail.example",
      subject: "Your tickets, booking TR-2210",
      daysAgo: 22,
      text: `Hello,

Your booking is confirmed. Please have this email with you.

Booking TR-2210
Outward: 07:12, Saturday, advance single
Seat reserved, coach C
Total paid £128.40 GBP

Tessellate Rail`,
      reason:
        "A ticket confirmation stating a departure time, a booking reference and a price, so it is the paper a claim about the journey would be argued from.",
    },
    condition: {
      fromAddress: "service.updates@tessellaterail.example",
      subject: "Service cancelled: 07:12, booking TR-2210",
      daysAgo: 22,
      text: `Hello,

The 07:12 service on the booking below has been cancelled. No replacement has been arranged for that departure.

Booking TR-2210
Outward: 07:12, Saturday, advance single
Total paid £128.40 GBP

The next departure we can offer on the same route is at 09:40.

Tessellate Rail`,
      reason:
        "A cancellation notice for booking TR-2210 stating that no replacement was offered and that the next departure was over two hours later, so it is the paper that shows the condition the conditions of carriage ask about.",
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
      { kind: "detected", daysAgo: 21, detail: "Found from the paper trail: the cancellation notice said the 07:12 had been cancelled with no replacement and the next departure was over two hours later, and the conditions of carriage promise a full refund for a cancelled service." },
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
    paper: {
      fromAddress: "billing@ashgrovebroadband.example",
      subject: "Your contract AB-7741 and what is changing in October",
      daysAgo: 4,
      text: `Hello,

Your account is in good standing and your contract runs to 14 March.

Account AB-7741
Monthly charge £34.00, rising to £40.50 from 1 October
Minimum term ends 14 March
Early termination charge if you leave before then £78.00

The increase is to fund network investment in your area.

Ashgrove Broadband`,
      reason:
        "A notice of a price change stating the account, the new charge and the early termination charge, so it is the paper a claim about the contract would be argued from.",
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

/**
 * One message that arrived and was turned down.
 *
 * The declined half of the reader's job is the more interesting one and the
 * harder to see, because the interesting thing about it is that it looks like
 * it should be kept. This is real post from a company, it carries a price, and
 * it is still not a record: the refund it describes has already been made, so
 * there is nothing left to hold anyone to. A reader that hoarded it would be
 * filling the ledger with settled business.
 *
 * Shown rather than hidden, because a message that was read and turned down
 * has to be distinguishable from one that never arrived.
 */
const DEMO_DECLINED = [
  {
    fromAddress: "notices@meridianhome.example",
    subject: "Your refund of £64.00 has been processed",
    daysAgo: 9,
    text: `Hello,

We have released the authorisation of £64.00 on order MH-2291 back to the card you paid with. It should show on your statement within five working days.

Nothing further is owed on this order and no action is needed from you.

Meridian Home`,
    reason:
      "A refund notification for something already resolved and refunded, so there is no outstanding commitment to hold them to.",
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
        demoKey: demo.key,
      });

      /*
        The message the record came out of.

        No `claimId`, which is what makes it paper rather than a reply: the
        live path draws the same distinction, and only paper is handed to the
        reader. It carries the reader's own reason and points at the record it
        became, so the arrivals list shows a decision and its consequence
        rather than a sentence with nothing behind it.
      */
      await ctx.db.insert("messages", {
        userId,
        direction: "inbound",
        fromAddress: demo.paper.fromAddress,
        toAddress: GUEST_ADDRESS,
        subject: demo.paper.subject,
        text: demo.paper.text,
        providerMessageId: `example-${userId}-${demo.key}-paper`,
        ingestOutcome: "kept",
        ingestReason: demo.paper.reason,
        recordId,
        demoKey: demo.key,
        at: now - demo.paper.daysAgo * DAY,
      });

      /*
        The arrival that states the condition.

        Same shape as the paper above and linked to the same record, because it
        is the second piece of the same paper trail rather than a different
        case. Without it the record asserts a fact no message carries, and the
        detector is told not to invent facts, so the claim on the sheet could
        not have come from the post shown beside it. Omitted for the case whose
        first arrival already carries the condition.
      */
      if (demo.condition) {
        await ctx.db.insert("messages", {
          userId,
          direction: "inbound",
          fromAddress: demo.condition.fromAddress,
          toAddress: GUEST_ADDRESS,
          subject: demo.condition.subject,
          text: demo.condition.text,
          providerMessageId: `example-${userId}-${demo.key}-condition`,
          ingestOutcome: "kept",
          ingestReason: demo.condition.reason,
          recordId,
          demoKey: demo.key,
          at: now - demo.condition.daysAgo * DAY,
        });
      }

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
          demoKey: demo.key,
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
          demoKey: demo.key,
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

    // Paper that was read and turned down. It belongs to no claim and no
    // record, which is exactly why it has to be listed somewhere: otherwise a
    // refusal is invisible and looks the same as a delivery that never came.
    for (const [index, declined] of DEMO_DECLINED.entries()) {
      await ctx.db.insert("messages", {
        userId,
        direction: "inbound",
        fromAddress: declined.fromAddress,
        toAddress: GUEST_ADDRESS,
        subject: declined.subject,
        text: declined.text,
        providerMessageId: `example-${userId}-declined-${index}`,
        ingestOutcome: "declined",
        ingestReason: declined.reason,
        demoKey: `demo-declined-${index}`,
        at: now - declined.daysAgo * DAY,
      });
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
