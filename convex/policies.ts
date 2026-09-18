import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { originsFor } from "./domains";
import { selectPolicyUrls, sitemapUrls } from "./policy-urls";
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
 * The scorer that decides which of a company's pages are worth reading, and the
 * sitemap walk that finds them, now live in `policy-urls.ts` and are imported
 * above.
 *
 * They moved for one reason. This file cannot be imported outside the Convex
 * runtime, because it builds a component client on the line above, so the check
 * that covers them carried its own copy of both instead. The copy passed while
 * the shipped scorer ranked six per-retailer returns guides above Evri's own
 * terms page, and a check that runs a copy of the logic is a check on the copy.
 * `policy-urls.ts` has no Convex import, so the check runs the shipped
 * functions against the real sites.
 */

/**
 * The mapper's own filter, used only when a site has no sitemap and the broad
 * map came back with nothing policy-shaped. This is the provider's semantic
 * search rather than our guess at a path, which is why it is a fallback and
 * not the first move.
 */
const POLICY_SEARCHES = [
  "returns and refunds policy",
  "terms and conditions",
  "warranty",
  "complaints",
  "delivery and cancellation",
];

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

    // 1. Which host to read. The company's own site, not the host it happens to
    //    send mail from. This is a measured defect rather than a precaution:
    //    Spotify's price-change notice arrives from `legal.spotify.com` and
    //    Ring's from `mail.ring.com`, and neither host serves a sitemap or a
    //    policy page, so both crawls were marked `skipped` while the terms sat
    //    on `spotify.com` and `ring.com` the whole time. Two of the eight real
    //    forwards on this deployment produced no claim for that reason alone.
    //    The registrable domain is tried first and the sending host second, so
    //    the extra map call is only ever spent on an address that today returns
    //    nothing at all.
    const origins = [...new Set([...originsFor(cp.domain), ...(cp.policyUrls ?? [])])];
    if (origins.length === 0) origins.push(`https://${cp.domain}`);

    // 2. Find the candidate documents. Two independent sources, because either
    //    can come up empty on a real site and the cost of missing the terms is
    //    the whole product. The sitemap is complete and costs no crawl credit;
    //    the mapper is capped, so on a large shop it can return nothing but
    //    product pages. Both are tried on each host in turn, and the walk stops
    //    at the first host that yields a policy-shaped URL.
    const candidates: string[] = [];
    const tried: string[] = [];
    let origin = origins[0];
    let chosen: string[] = [];
    let sources = "";
    let firstError: string | null = null;

    for (let i = 0; i < origins.length; i++) {
      const attempt = origins[i];
      const host = attempt.replace(/^https?:\/\//, "");
      const fromSitemap = await sitemapUrls(attempt);

      let fromMap: string[] = [];
      let attemptError: string | null = null;
      try {
        const mapped = await firecrawl.map(ctx, attempt, { limit: 200 });
        fromMap = (mapped?.links ?? [])
          .map((l) => (typeof l === "string" ? l : l?.url ?? ""))
          .filter((u) => u.length > 0);
      } catch (err) {
        attemptError = String(err).slice(0, 200);
      }
      // The status reported when nothing is found describes the first host
      // tried, which is the company's own site and therefore the attempt that
      // settles the question. A sending host that fails to map does not make
      // the crawl "failed": the company's own site was looked at, and it had
      // nothing.
      if (i === 0) firstError = attemptError;

      tried.push(`${host} (sitemap ${fromSitemap.length}, mapper ${fromMap.length})`);
      candidates.push(...fromSitemap, ...fromMap);
      chosen = selectPolicyUrls([...new Set(candidates)]);
      if (chosen.length > 0) {
        origin = attempt;
        sources = `sitemap ${fromSitemap.length}, mapper ${fromMap.length}`;
        break;
      }
    }

    // 3. Neither source turned up a policy-shaped URL on any host. Ask the
    //    mapper to search for the vocabulary directly, which is the provider's
    //    own filter rather than our guess at a path.
    if (chosen.length === 0) {
      for (const attempt of origins) {
        for (const term of POLICY_SEARCHES) {
          try {
            const found = await firecrawl.map(ctx, attempt, { search: term, limit: 10 });
            for (const l of found?.links ?? []) {
              const u = typeof l === "string" ? l : l?.url ?? "";
              if (u) candidates.push(u);
            }
          } catch {
            // One failed search is not a reason to stop looking.
          }
        }
        chosen = selectPolicyUrls([...new Set(candidates)]);
        if (chosen.length > 0) {
          origin = attempt;
          sources = "the mapper's own search";
          break;
        }
      }
    }

    if (chosen.length === 0) {
      await ctx.runMutation(internal.policies.markCrawl, {
        counterpartyId: args.counterpartyId,
        status: firstError ? "failed" : "skipped",
        note: firstError
          ? `Mapper failed on ${origins[0].replace(/^https?:\/\//, "")} (${firstError}); nothing on any host tried looked like terms.`
          : `Looked at ${candidates.length} URLs on ${tried.join("; ")}, none looked like terms.`,
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

    // Which document produced what is recorded rather than only the total.
    // Measured on this deployment: Evri's crawl reported `Read 6 documents,
    // kept 0 citable provisions`, and the note could not say whether the terms
    // page had been read and yielded nothing or had never been read at all.
    // Their terms page does carry the provisions (18 mentions of liability, 14
    // of compensation), so that note was hiding a real defect rather than
    // reporting a company that publishes nothing.
    let total = 0;
    const perDocument: string[] = [];
    for (const doc of documents) {
      const extracted = await ctx.runAction(internal.policies.mineProvisions, {
        counterpartyId: args.counterpartyId,
        documentUrl: doc.url,
        markdown: doc.markdown,
      });
      total += extracted;
      perDocument.push(`${shortPath(doc.url)} ${extracted}`);
    }

    await ctx.runMutation(internal.policies.markCrawl, {
      counterpartyId: args.counterpartyId,
      status: "crawled",
      note: `Read ${documents.length} documents from ${origin.replace(/^https?:\/\//, "")} (${perDocument.join(", ")}), kept ${total} citable provisions. Found via ${sources}.`,
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

/**
 * The path of a document, without its host.
 *
 * The crawl note already names the host it read from, so repeating it six times
 * in the list of documents would push the useful part off the end of a line.
 */
function shortPath(url: string): string {
  try {
    return new URL(url).pathname;
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

/**
 * What was read from a counterparty.
 *
 * Internal, not public. It takes a `counterpartyId` and returns that company's
 * provisions, so as a public query it answered an unauthenticated caller for a
 * counterparty it does not own, which is the one read in this app that did not
 * re-check the caller. Nothing calls it yet: the claim sheet reaches provisions
 * through `claims.detail`, which is scoped. Kept as an internal query so the
 * next caller has to be an action that has already established the owner.
 */
export const forCounterparty = internalQuery({
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
