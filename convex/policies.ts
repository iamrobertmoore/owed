import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
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
  // The main published terms sit at the root of a site, and a programme's own
  // terms sit under it. Measured on a real retailer: without this, a loyalty
  // scheme's terms page and a group-rides terms page both outranked the
  // warranty, so a claim about a faulty product would have been argued from
  // the terms of a rewards programme.
  const segments = path.split("/").filter(Boolean).length;
  return score - Math.max(0, segments - 1) * 6;
}

/** Rank a site's URLs down to the handful worth reading. */
export function selectPolicyUrls(urls: string[], limit = 6): string[] {
  return urls
    .map((url) => ({ url, score: scoreUrl(url) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.url);
}

/**
 * The site's own sitemap.
 *
 * A mapper is capped, and a shop has thousands of product URLs, so the handful
 * of documents a claim is argued from can sit past the cap and never be seen.
 * Measured on a real retailer on 17 September 2026: `map` returned 199 URLs
 * against a `limit` of 200 and **not one of them scored**, while the same
 * site's sitemap listed `returns-policy`, `terms-and-conditions` and
 * `warranty` on its first page. The candidate filter was never the problem:
 * `returns-policy` scores 24 against the vocabulary below.
 *
 * A sitemap is one plain request, costs no crawl credit, and is the site
 * telling us where its pages are rather than us guessing.
 */
const SITEMAP_PATHS = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/sitemap-index.xml",
  "/siteindex.xml",
];
/**
 * Bounds on the walk. These are safety valves, not budgets: because only
 * policy-shaped URLs are kept, running out of requests can never be the reason
 * a terms page is missing from a site that published one. The request cap is
 * what stops a site with a pathological sitemap tree from stalling the crawl.
 */
const MAX_SITEMAP_REQUESTS = 20;
const MAX_SITEMAP_DEPTH = 3;
const MAX_POLICY_URLS = 200;

/**
 * A sitemap is XML, so a URL containing an ampersand arrives escaped. Measured
 * on a real retailer: every help-centre URL came back as `refunds-&amp;-returns`.
 * Handing that to a scraper asks for a path that does not exist. Decoding is
 * done in a single pass so `&amp;lt;` cannot cascade into `<`.
 */
function decodeXmlEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return s.replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return named[body.toLowerCase()] ?? whole;
  });
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeXmlEntities(m[1]));
}

/**
 * `AbortSignal.timeout` is not guaranteed to exist in every JS runtime, and a
 * crawl that throws a ReferenceError on a missing global is worse than a crawl
 * with no timeout at all. A host that hangs is bounded by the request cap and
 * the action's own limit; a missing global is not bounded by anything.
 */
function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(ms);
  } catch {
    return undefined;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Owed/1.0 (reads a company's published terms)" },
      signal: timeoutSignal(15_000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    return body.slice(0, 8_000_000);
  } catch {
    return null;
  }
}

async function fetchXml(url: string): Promise<string | null> {
  const body = await fetchText(url);
  // A soft 404 answers 200 with a full HTML page, so only XML counts.
  return body && body.includes("<loc>") ? body : null;
}

/**
 * The sitemaps a site declares in its own robots.txt.
 *
 * This is how the sitemap protocol says to find them, and it matters: measured
 * on a real retailer, `/sitemap.xml` answers 404 while robots.txt points at
 * `/siteindex.xml`. Guessing the path would have missed the entire site.
 */
async function declaredSitemaps(root: string): Promise<string[]> {
  const txt = await fetchText(`${root}/robots.txt`);
  if (!txt) return [];
  return [...txt.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)].map((m) => m[1]);
}

/**
 * Every policy-shaped URL a site's sitemap knows about.
 *
 * **Only matching URLs are collected, and that is the point.** The first
 * version of this capped how many URLs it would gather, and a single child
 * sitemap of products exhausted the cap before a later child holding the terms
 * pages was ever read. It returned four thousand URLs and selected none, which
 * is the same failure the mapper had: a capped scan produces no error, no gap
 * and no implausible number, only a smaller field that looks exactly like the
 * field. Filtering at read time means the budget can only ever be spent on
 * product pages, which we did not want anyway.
 */
/**
 * Which child sitemaps are worth a request, and in what order.
 *
 * Two measured defects live here. First, a sitemap may be served gzipped as a
 * file (`products-00.xml.gz`); a plain text fetch returns binary, so the
 * request is spent and nothing can come back by construction. Second, order
 * matters because the walk is capped: measured on a real retailer, a
 * `/sitemap/products/` child spent ten of twenty requests on gzipped product
 * files before the site's own support sitemap was reached, and the support
 * sitemap is where the returns content lived.
 *
 * `scoreUrl` already rejects commerce paths, so sorting by it puts the
 * commerce half of a site last and costs nothing.
 */
function childSitemaps(urls: string[]): string[] {
  return urls
    .filter((u) => !/\.(gz|zip|bz2|xz)$/i.test(u.split("?")[0]))
    .sort((a, b) => scoreUrl(b) - scoreUrl(a));
}

async function sitemapUrls(origin: string): Promise<string[]> {
  let root: string;
  try {
    root = new URL(origin).origin;
  } catch {
    return [];
  }

  const keep: string[] = [];
  const add = (list: string[]) => {
    for (const u of list) {
      if (keep.length >= MAX_POLICY_URLS) return;
      if (scoreUrl(u) > 0) keep.push(u);
    }
  };

  // The declared sitemaps are tried first, so on a site that publishes one the
  // guesses below never cost a request. Measured on a real retailer: robots.txt
  // named the sitemap under its `www` host, and the guesses then re-fetched that
  // same file under the bare host, which on a large site is not a wasted request
  // but a wasted megabyte.
  const declared = await declaredSitemaps(root);
  const seeds = [
    ...declared.map((url) => ({ url, depth: 0, guess: false })),
    ...SITEMAP_PATHS.map((p) => ({ url: `${root}${p}`, depth: 0, guess: true })),
  ];

  // A sitemap tree is not always one level deep. Measured on a real retailer:
  // robots.txt -> `/siteindex.xml` -> a child sitemap on a *different host* ->
  // thirteen more children. Treating the second level as page URLs finds
  // nothing, so the walk is breadth-first with a depth cap rather than a fixed
  // one-hop rule.
  const seen = new Set<string>();
  let frontier = seeds;
  let requests = 0;
  let declaredWorked = false;

  while (frontier.length > 0 && requests < MAX_SITEMAP_REQUESTS) {
    const next: Array<{ url: string; depth: number; guess: boolean }> = [];
    for (const item of frontier) {
      if (requests >= MAX_SITEMAP_REQUESTS) break;
      if (keep.length >= MAX_POLICY_URLS) break;
      // The site told us where its sitemaps are; do not go on guessing.
      if (item.guess && declaredWorked) continue;
      const key = item.url.split("#")[0];
      if (seen.has(key)) continue;
      seen.add(key);
      requests++;

      const xml = await fetchXml(item.url);
      if (!xml) continue;
      if (!item.guess) declaredWorked = true;

      if (/<sitemapindex/i.test(xml)) {
        if (item.depth + 1 > MAX_SITEMAP_DEPTH) continue;
        for (const child of childSitemaps(locs(xml))) {
          next.push({ url: child, depth: item.depth + 1, guess: false });
        }
      } else {
        add(locs(xml));
      }
    }
    frontier = next;
  }

  return keep;
}

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

    const origin = cp.policyUrls[0] ?? `https://${cp.domain}`;

    // 1. Find the candidate documents. Two independent sources, because either
    //    can come up empty on a real site and the cost of missing the terms is
    //    the whole product. The sitemap is complete and costs no crawl credit;
    //    the mapper is capped, so on a large shop it can return nothing but
    //    product pages.
    const fromSitemap = await sitemapUrls(origin);

    let fromMap: string[] = [];
    let mapError: string | null = null;
    try {
      const mapped = await firecrawl.map(ctx, origin, { limit: 200 });
      fromMap = (mapped?.links ?? [])
        .map((l) => (typeof l === "string" ? l : l?.url ?? ""))
        .filter((u) => u.length > 0);
    } catch (err) {
      mapError = String(err).slice(0, 200);
    }

    const candidates = [...new Set([...fromSitemap, ...fromMap])];
    const sources = `sitemap ${fromSitemap.length}, mapper ${fromMap.length}`;
    let chosen = selectPolicyUrls(candidates);

    // 2. Neither source turned up a policy-shaped URL. Ask the mapper to search
    //    for the vocabulary directly, which is the provider's own filter rather
    //    than our guess at a path.
    if (chosen.length === 0) {
      for (const term of POLICY_SEARCHES) {
        try {
          const found = await firecrawl.map(ctx, origin, { search: term, limit: 10 });
          for (const l of found?.links ?? []) {
            const u = typeof l === "string" ? l : l?.url ?? "";
            if (u) candidates.push(u);
          }
        } catch {
          // One failed search is not a reason to stop looking.
        }
      }
      chosen = selectPolicyUrls([...new Set(candidates)]);
    }

    if (chosen.length === 0) {
      await ctx.runMutation(internal.policies.markCrawl, {
        counterpartyId: args.counterpartyId,
        status: mapError ? "failed" : "skipped",
        note: mapError
          ? `Mapper failed (${mapError}); the sitemap listed ${fromSitemap.length} URLs and none looked like terms.`
          : `Looked at ${candidates.length} URLs (${sources}), none looked like terms.`,
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
      note: `Read ${documents.length} documents, kept ${total} citable provisions. Found via ${sources}.`,
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
