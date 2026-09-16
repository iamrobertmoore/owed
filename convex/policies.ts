import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Reading the counterparty's own published terms.
 *
 * This is the difference between a letter that says "this is unfair" and one
 * that says "clause 9.2 of your own returns policy says otherwise". A claim
 * argued from a company's own words gets routed to someone who can settle it;
 * a claim argued from principle gets a form response.
 *
 * Everything here is kept verbatim with the document's own reference so a
 * reader can go and check it. Nothing is paraphrased into a citation.
 */

const firecrawl = new FirecrawlClient(components.firecrawl);

/**
 * Paths a claim is actually argued from, most useful first. Matching is on
 * whole hyphen-separated tokens so a slug like `noise-cancelling-headphones`
 * does not register as a cancellation policy.
 */
const POLICY_TOKENS = [
  "refund",
  "refunds",
  "returns",
  "return",
  "cancellation",
  "cancellations",
  "warranty",
  "guarantee",
  "complaints",
  "complaint",
  "terms",
  "conditions",
  "policy",
  "policies",
  "delivery",
  "shipping",
  "service",
  "charter",
  "compensation",
];

/** Commerce noise. These are never policy documents. */
const REJECT_TOKENS = ["product", "products", "shop", "store", "cart", "checkout", "sku"];

function scoreUrl(url: string): number {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return -1;
  }
  const tokens = path.split(/[/_\-.]+/).filter(Boolean);
  if (tokens.some((t) => REJECT_TOKENS.includes(t))) return -1;
  let score = 0;
  for (const token of tokens) {
    const i = POLICY_TOKENS.indexOf(token);
    if (i >= 0) score += POLICY_TOKENS.length - i;
  }
  return score;
}

/** Rank a site's URLs down to the handful worth reading. */
export function selectPolicyUrls(urls: string[], limit = 4): string[] {
  return urls
    .map((url) => ({ url, score: scoreUrl(url) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.url);
}

/**
 * Map the counterparty's site, pick the documents a claim is argued from, read
 * them, and mine them for individually citable provisions.
 */
export const readCounterparty = internalAction({
  args: { counterpartyId: v.id("counterparties") },
  handler: async (ctx, args): Promise<{ provisions: number; documents: number; note: string }> => {
    const cp = await ctx.runQuery(internal.policies.getCounterparty, {
      counterpartyId: args.counterpartyId,
    });
    if (!cp) throw new Error(`No counterparty ${args.counterpartyId}`);

    const origin = cp.policyUrls[0] ?? `https://${cp.domain}`;

    // 1. Find the candidate documents. `map` returns the site's URLs without
    //    paginating through it ourselves.
    let candidates: string[] = [];
    try {
      const mapped = await firecrawl.map(ctx, origin, { limit: 200 });
      candidates = (mapped?.links ?? [])
        .map((l) => (typeof l === "string" ? l : l?.url ?? ""))
        .filter((u) => u.length > 0);
    } catch (err) {
      await ctx.runMutation(internal.policies.markCrawl, {
        counterpartyId: args.counterpartyId,
        status: "failed",
        note: `map failed: ${String(err).slice(0, 200)}`,
      });
      return { provisions: 0, documents: 0, note: "Could not map the site." };
    }

    const chosen = selectPolicyUrls(candidates);
    if (chosen.length === 0) {
      await ctx.runMutation(internal.policies.markCrawl, {
        counterpartyId: args.counterpartyId,
        status: "skipped",
        note: `Mapped ${candidates.length} URLs, none looked like terms.`,
      });
      return { provisions: 0, documents: 0, note: "No terms document found." };
    }

    // 2. Read each one. A scrape failure on one document should not lose the
    //    others, so each is caught separately.
    const documents: Array<{ url: string; markdown: string }> = [];
    for (const url of chosen) {
      try {
        const page = await firecrawl.scrape(ctx, url, {
          formats: ["markdown"],
          onlyMainContent: true,
        });
        const markdown: string = page?.markdown ?? "";
        if (markdown.length > 400) documents.push({ url, markdown });
      } catch {
        // Skip this document and keep going.
      }
    }

    if (documents.length === 0) {
      await ctx.runMutation(internal.policies.markCrawl, {
        counterpartyId: args.counterpartyId,
        status: "failed",
        note: `Selected ${chosen.length} documents but read none.`,
      });
      return { provisions: 0, documents: 0, note: "Selected documents could not be read." };
    }

    await ctx.runMutation(internal.policies.clearProvisions, {
      counterpartyId: args.counterpartyId,
    });

    let total = 0;
    for (const doc of documents) {
      const extracted = await ctx.runAction(internal.policies.mineProvisions, {
        counterpartyId: args.counterpartyId,
        documentUrl: doc.url,
        markdown: doc.markdown,
      });
      total += extracted;
    }

    await ctx.runMutation(internal.policies.markCrawl, {
      counterpartyId: args.counterpartyId,
      status: "crawled",
      note: `Read ${documents.length} documents, kept ${total} citable provisions.`,
    });

    return {
      provisions: total,
      documents: documents.length,
      note: `Read ${documents.length} documents from ${new URL(origin).host}.`,
    };
  },
});

/**
 * Mine one document for provisions worth citing.
 *
 * Both directions are extracted. The clause they will quote back at us is
 * worth knowing before the letter goes out rather than after, because a draft
 * that answers it pre-emptively reads as though a person wrote it.
 */
export const mineProvisions = internalAction({
  args: {
    counterpartyId: v.id("counterparties"),
    documentUrl: v.string(),
    markdown: v.string(),
  },
  handler: async (ctx, args): Promise<number> => {
    const system = [
      "You extract citable provisions from a company's published terms.",
      "",
      "A provision is citable when it states a specific commitment, deadline, fee,",
      "remedy or obligation that a customer could hold the company to, or a specific",
      "exclusion the company could hold against a customer.",
      "",
      "Return JSON: {\"provisions\":[{\"reference\":string,\"text\":string,\"stance\":\"supports\"|\"opposes\"}]}",
      "",
      "Rules:",
      "- `reference` must be the document's own numbering if it has one, e.g. \"9.2\",",
      "  \"Section 4\", \"Clause 12(a)\". If the document has no numbering, use a short",
      "  heading label, e.g. \"Returns and refunds\".",
      "- `text` must be verbatim. Do not paraphrase, shorten or tidy. Copy the",
      "  sentence or sentences exactly as published.",
      "- `stance` is from the point of view of a customer pursuing a claim:",
      "  \"supports\" if it commits the company to something, \"opposes\" if it is an",
      "  exclusion, condition or limit they would rely on to refuse.",
      "- Keep between 3 and 12 provisions. Prefer ones carrying a number, a",
      "  deadline or a named remedy.",
      "- If the document contains no such provisions, return an empty list.",
    ].join("\n");

    const raw = await ctx.runAction(internal.ai.complete, {
      operation: "mine-provisions",
      system,
      user: `Document: ${args.documentUrl}\n\n---\n\n${args.markdown.slice(0, 60_000)}`,
      json: true,
      maxTokens: 2400,
    });

    let parsed: { provisions?: Array<{ reference: string; text: string; stance: string }> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return 0;
    }

    const provisions = parsed.provisions ?? [];
    let kept = 0;
    for (const p of provisions) {
      if (!p?.text || p.text.length < 20) continue;
      // The embedding is what lets a claim retrieve the provisions that bear on
      // it rather than reading all of them.
      const embedding = await ctx.runAction(internal.ai.embed, { text: p.text });
      await ctx.runMutation(internal.policies.addProvision, {
        counterpartyId: args.counterpartyId,
        documentUrl: args.documentUrl,
        documentTitle: titleFor(args.documentUrl),
        reference: p.reference || "unreferenced",
        text: p.text,
        stance: p.stance === "opposes" ? "opposes" : "supports",
        embedding,
      });
      kept++;
    }
    return kept;
  },
});

function titleFor(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? u.host : `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

/** A provision with the similarity that retrieved it. */
export type RetrievedProvision = { score: number; doc: Doc<"provisions"> };

export type RelevantProvisions = {
  supporting: RetrievedProvision[];
  opposing: RetrievedProvision[];
};

/**
 * Retrieve the provisions that bear on a description of what went wrong, by
 * vector similarity. Returns the supporting provisions and, separately, the
 * strongest opposing ones, because a good letter answers the exclusion before
 * it is raised.
 */
export const relevant = internalAction({
  args: { counterpartyId: v.id("counterparties"), issue: v.string() },
  handler: async (ctx, args): Promise<RelevantProvisions> => {
    const vector: number[] = await ctx.runAction(internal.ai.embed, { text: args.issue });
    const results = await ctx.vectorSearch("provisions", "by_embedding", {
      vector,
      limit: 12,
      filter: (q) => q.eq("counterpartyId", args.counterpartyId),
    });

    // A missing row is skipped rather than asserted away, so a provision
    // deleted between the search and the read cannot crash a claim.
    const found: RetrievedProvision[] = [];
    for (const result of results) {
      const doc = await ctx.runQuery(internal.policies.getProvision, { id: result._id });
      if (doc) found.push({ score: result._score, doc });
    }

    return {
      supporting: found.filter((p) => p.doc.stance === "supports").slice(0, 5),
      opposing: found.filter((p) => p.doc.stance === "opposes").slice(0, 2),
    };
  },
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export const getCounterparty = internalQuery({
  args: { counterpartyId: v.id("counterparties") },
  handler: async (ctx, args) => await ctx.db.get(args.counterpartyId),
});

export const getProvision = internalQuery({
  args: { id: v.id("provisions") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

export const markCrawl = internalMutation({
  args: {
    counterpartyId: v.id("counterparties"),
    status: v.union(
      v.literal("pending"),
      v.literal("crawled"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.counterpartyId, {
      crawlStatus: args.status,
      crawlNote: args.note,
      crawledAt: Date.now(),
    });
  },
});

export const clearProvisions = internalMutation({
  args: { counterpartyId: v.id("counterparties") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("provisions")
      .withIndex("by_counterparty", (q) => q.eq("counterpartyId", args.counterpartyId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
  },
});

export const addProvision = internalMutation({
  args: {
    counterpartyId: v.id("counterparties"),
    documentUrl: v.string(),
    documentTitle: v.string(),
    reference: v.string(),
    text: v.string(),
    stance: v.union(v.literal("supports"), v.literal("opposes")),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => await ctx.db.insert("provisions", args),
});

/** What was read from a counterparty, for the UI. */
export const forCounterparty = query({
  args: { counterpartyId: v.id("counterparties") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("provisions")
      .withIndex("by_counterparty", (q) => q.eq("counterpartyId", args.counterpartyId))
      .collect();
    return rows.sort((a, b) => (a.stance === b.stance ? 0 : a.stance === "supports" ? -1 : 1));
  },
});

export type ProvisionId = Id<"provisions">;
