import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { ladderFor } from "./letters";
import { CLASSIFICATION, CLASSIFICATIONS } from "./schema";

/**
 * Reading a reply for what it commits to, not for how it sounds.
 *
 * The distinction that matters, and the one most chasers get wrong: an apology
 * carrying no decision is an acknowledgement, not a concession. Treating the
 * two as the same thing is how a tool declares victory on a polite nothing.
 *
 * Only `concession` settles a claim. Everything else keeps it open.
 */

/** The classification set is defined once, in the schema. */
type Classification = (typeof CLASSIFICATIONS)[number];

export const classify = internalAction({
  args: { claimId: v.id("claims"), messageId: v.id("messages") },
  handler: async (ctx, args): Promise<string> => {
    const message = await ctx.runQuery(internal.triage.getMessage, { messageId: args.messageId });
    if (!message) throw new Error("No such message");

    const system = [
      "You read a reply from a company to a customer's claim and decide what it",
      "actually commits the company to.",
      "",
      "Return JSON: {\"classification\": string, \"commitment\": string, \"reason\": string}",
      "",
      "classification is exactly one of:",
      "- \"concession\": they agree to pay, refund, replace, repair or compensate,",
      "  unconditionally and specifically. A promise to 'look into it' is not this.",
      "  An apology with no decision behind it is not this.",
      "- \"acknowledgement\": they have received it and said nothing that decides",
      "  anything. Includes auto-replies and apologies with no offer.",
      "- \"refusal\": they have declined, with or without a reason.",
      "- \"stall\": they are asking for more time, more information, or have set a",
      "  deadline of their own without deciding.",
      "- \"question\": they are asking the customer something before deciding.",
      "- \"unreadable\": not a reply to the claim at all, or empty.",
      "",
      "commitment: if and only if the classification is \"concession\", quote the",
      "exact words that concede, verbatim. Otherwise return an empty string. Do not",
      "paraphrase, and do not treat a vague assurance as a commitment.",
      "",
      "reason: one sentence, plain.",
    ].join("\n");

    const raw = await ctx.runAction(internal.ai.complete, {
      operation: "classify-reply",
      system,
      user: `Subject: ${message.subject}\n\n${message.text.slice(0, 12_000)}`,
      json: true,
      maxTokens: 500,
      claimId: args.claimId,
    });

    let parsed: { classification?: string; commitment?: string; reason?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { classification: "unreadable", commitment: "", reason: "Model reply was not JSON." };
    }

    // The model's answer is checked against the schema's own set rather than
    // trusted, and anything unrecognised reads as unreadable rather than
    // settling or escalating a claim on a guess.
    const classification: Classification = CLASSIFICATIONS.includes(
      (parsed.classification ?? "") as Classification,
    )
      ? (parsed.classification as Classification)
      : "unreadable";

    await ctx.runMutation(internal.triage.record, {
      claimId: args.claimId,
      messageId: args.messageId,
      classification,
      commitment: parsed.commitment ?? "",
      reason: parsed.reason ?? "",
    });

    return classification;
  },
});

/**
 * Apply a classification to the claim.
 *
 * A concession settles and records the money. Anything else keeps the claim
 * open and schedules the next step. A refusal does not close the claim, it
 * moves it up a rung, because a refusal at rung 0 is an invitation to rung 1.
 */
export const record = internalMutation({
  args: {
    claimId: v.id("claims"),
    messageId: v.id("messages"),
    classification: CLASSIFICATION,
    commitment: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const claim = await ctx.db.get(args.claimId);
    if (!claim) throw new Error(`No claim ${args.claimId}`);
    const now = Date.now();

    await ctx.db.patch(args.messageId, {
      classification: args.classification,
      commitment: args.commitment || undefined,
    });

    await ctx.db.insert("events", {
      claimId: args.claimId,
      at: now,
      kind: "classified",
      detail: `Reply read as ${args.classification}. ${args.reason}`,
    });

    if (args.classification === "concession") {
      // The amount is what they said, not what we asked for. If the claim has
      // no amount, the concession is recorded without one rather than guessed.
      const amount = claim.amountClaimed;
      if (amount !== undefined) {
        await ctx.runMutation(internal.claims.recordRecovery, {
          claimId: args.claimId,
          amount,
          evidence: args.commitment || args.reason,
        });
      } else {
        await ctx.runMutation(internal.claims.advance, {
          claimId: args.claimId,
          stage: "settled",
          kind: "settled",
          detail: `Conceded. Their words: "${args.commitment || args.reason}"`,
        });
      }
      return;
    }

    // Nothing else settles anything. A refusal or a stall moves the claim up
    // the ladder once the wait for this rung has elapsed.
    const nextRung = claim.rung + 1;
    if (nextRung > 2) {
      await ctx.runMutation(internal.claims.advance, {
        claimId: args.claimId,
        stage: "exhausted",
        kind: "exhausted",
        detail:
          "The ladder is finished. The next step is the owner's decision, not the agent's.",
        nextActionAt: undefined,
      });
      return;
    }

    // A reply pauses the chase while the other end is talking, but it does not
    // pause it forever. If they go quiet again, the published window for this
    // rung is what decides when the next letter is written.
    await ctx.runMutation(internal.claims.advance, {
      claimId: args.claimId,
      stage: "negotiating",
      kind: "replied",
      detail: `Reply is a ${args.classification}. Staying open.`,
      nextActionAt: now + ladderFor(claim.rung).waitDays * 24 * 60 * 60 * 1000,
    });
  },
});

export const getMessage = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => await ctx.db.get(args.messageId),
});
