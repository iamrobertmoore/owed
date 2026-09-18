/**
 * Which of a company's published pages are worth reading.
 *
 * This is the step that decides whether a claim is possible at all, and every
 * way it has been wrong is recorded beside the code that answers it, because
 * the reasoning is the only thing that keeps a later change from reintroducing
 * one.
 *
 * The module has no Convex import on purpose. `policies.ts` cannot be imported
 * outside the Convex runtime because it constructs a component client at the
 * top level, and a harness that cannot import the shipped code ends up
 * restating it, which is a copy rather than a check. Everything here is plain
 * JavaScript so a script can run the real thing against a real site.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The concepts a claim is argued from, most useful first.
 *
 * The score is `length - index`, so a concept early in this list is worth more.
 * **The contract markers lead**, because the question this answers is "where
 * does this company state its commitments to this customer", and the document
 * that does that is its terms or its user agreement. Topic words follow: a
 * refunds page is more useful than a delivery page, but neither is the contract.
 *
 * **Singular only.** The plurals are mapped in `SYNONYMS` rather than listed,
 * which is the fix for a measured defect: `return` and `returns` were both
 * tokens, so a URL containing both was scored twice and Evri's
 * `/return-a-parcel/argos-returns` reached **27** against the **17** of Evri's
 * own `/terms-and-conditions`. The crawl read six per-retailer guides to sending
 * goods back and never opened the terms, which is why an Evri forward could not
 * produce a claim however good the paper was. Both figures are printed by the
 * check that covers this file, from the retired scorer itself, so they can be
 * re-run rather than taken from here.
 *
 * `agreement` is here for the same class of defect in the other direction. It
 * was absent entirely, so `end-user-agreement` scored **zero** and was filtered
 * out: Spotify's legal sitemap holds 292 of them, one per locale, and the
 * company's actual consumer contract was invisible to the crawl. What was read
 * instead was its creator terms, its artist terms, two audiobook refund
 * policies and a Korea-market cancellation policy, for a UK subscription.
 */
const POLICY_CONCEPTS = [
  "terms",
  "conditions",
  "agreement",
  "refund",
  "return",
  "cancellation",
  "warranty",
  "guarantee",
  "complaint",
  "policy",
  "delivery",
  "shipping",
  "service",
  "charter",
  "compensation",
];

/** Surface forms that mean the same concept, so neither is counted twice. */
const SYNONYMS: Record<string, string> = {
  refunds: "refund",
  returns: "return",
  cancellations: "cancellation",
  warranties: "warranty",
  guarantees: "guarantee",
  complaints: "complaint",
  policies: "policy",
  agreements: "agreement",
  deliveries: "delivery",
  services: "service",
  charters: "charter",
};

/**
 * Commerce noise, and the boilerplate that is never a commitment to a customer.
 *
 * A privacy policy commits the company to nothing a person can claim on, but
 * `privacy_policy.jsp` scored 7 because `policy` is a concept. DPD's crawl read
 * it and kept 7 provisions from it, which spent a slot that belonged to a
 * document a claim could be argued from. These are excluded outright rather
 * than ranked down: no amount of ranking makes a privacy notice citable.
 *
 * `item` and `guides` are here from a measurement rather than a guess, and the
 * measurement is the one that follows from comparing score before depth.
 * Measured on Sigma Sports, whose product URLs are `/item/<brand>/<product>/<id>`:
 * `/item/CeramicSpeed/UFO-Drip-All-Conditions-Chain-Treatment/10TEY` scores 14,
 * because `All Conditions` is the word `conditions` and the tokeniser is right
 * to match it. Six of those reached the pick and crowded out the company's
 * warranty and delivery pages. The same site's `/hub/guides/...` is an editorial
 * article that scores 14 off the word in its slug and yields nothing citable.
 *
 * **`item` and `guides` are whole tokens, and the singular `guide` is not one
 * of them.** Measured: `guides` is the name of an editorial section, and the
 * only other URLs it matches on any of the eleven sites are two Evri packaging
 * articles that never scored high enough to be picked. `guide` is the last word
 * of Argos' `/help/delivery-&-collection-guide`, which is a real page, so it
 * stays a candidate. The tokeniser splits on `-`, so `items` in
 * `/help/refunds-&-returns/my-items-faulty-what-should-i-do` is a different
 * token again and is unaffected.
 */
const REJECT_TOKENS = [
  // Commerce noise.
  "product", "products", "shop", "store", "cart", "checkout", "sku", "item",
  // Data and corporate boilerplate.
  "privacy", "cookie", "cookies", "accessibility", "security", "tax",
  "modern-slavery", "sustainability", "governance", "esg", "gdpr",
  // Editorial sections, which state nothing a claim can be argued from.
  "guides",
];

/**
 * Documents that belong to someone else, or to a scheme rather than a purchase.
 *
 * These are ranked down rather than excluded, and the difference matters. A
 * company that publishes only creator terms has still published something, and
 * reporting "no page that looks like their terms" would be false about it.
 *
 * **Ranked down by class, not by subtracting a number.** The first version of
 * this took a penalty off the score, and the penalty was larger than the score,
 * so a creator-terms page came out at -15 and the `score > 0` filter dropped it
 * entirely: the outcome was exclusion dressed up as ranking, and the false
 * sentence above was reachable. A number that is only *probably* bigger than
 * every genuine score is a magnitude, and a magnitude has to be re-checked
 * whenever the vocabulary changes. Whether a document is deprioritised is a
 * fact about the document, so it is carried as one and sorted on first.
 *
 * `programme` and `discount` are here from a measurement rather than a theory:
 * Sigma Sports' `/industry-discount-programme-terms-conditions` scored as high
 * as its main terms, so a claim about a faulty product could have been argued
 * from the terms of a trade discount scheme.
 */
const DEPRIORITISE_TOKENS = [
  "creator", "creators", "artist", "artists", "developer", "developers",
  "partner", "partners", "affiliate", "affiliates", "referral",
  "business", "corporate", "enterprise", "seller", "sellers", "merchant",
  "merchants", "supplier", "suppliers", "vendor", "vendors",
  "press", "newsroom", "careers", "jobs", "recruitment", "investor", "investors",
  "promotion", "promotional", "promotions", "competition", "competitions",
  "discount", "discounts", "loyalty", "rewards", "programme", "program",
  "voucher", "gift",
];

// ---------------------------------------------------------------------------
// Locale variants
// ---------------------------------------------------------------------------

/**
 * A path segment that is a market or language marker: two letters, optionally
 * a dash and two or three more, as in `uk`, `kr-en`, `za-zu`, `us-es`.
 */
const LOCALE_SEGMENT = /^[a-z]{2}(-[a-z]{2,3})?$/;

/**
 * Which locale variant to read when a site publishes one document per market.
 *
 * This is a product assumption and it is written down rather than hidden: the
 * reader, the letters and the claims are English, and the market the product
 * argues in is the UK, which is where its figures, its currency and the
 * ombudsmen it escalates to come from. A UK-first English preference is the
 * honest default.
 *
 * Without any preference the choice is whatever order the sitemap happens to
 * list, which for Spotify means Andorra's agreement for a UK subscription. The
 * clause text is substantially the same across markets and the local-law
 * carve-outs are not, so the difference is real and it is worth ordering.
 */
const LOCALE_PREFERENCE = ["uk", "gb", "en", "ie", "us", "au", "nz", "ca"];

/**
 * Lower is better. No locale marker at all is best, because it is the site
 * telling us the document is not market-specific.
 */
function localeRank(locale: string | null): number {
  if (locale === null) return 0;
  const exact = LOCALE_PREFERENCE.indexOf(locale);
  if (exact >= 0) return 1 + exact;
  const bare = locale.split("-")[0];
  const asLanguage = LOCALE_PREFERENCE.indexOf(bare);
  if (asLanguage >= 0) return 20 + asLanguage;
  if (locale.endsWith("-en")) return 40;
  return 60;
}

/**
 * The document a URL is a variant of, with the market markers removed.
 *
 * `spotify.com/uk/legal/end-user-agreement` and its 291 siblings are one
 * document in 292 markets, and treating them as 292 candidates spends every
 * slot the crawl has on the same page. Collapsing them is what makes room for
 * the rest of a company's policies.
 *
 * **Two leading markers, not one.** Measured on Ring, which writes a market and
 * then a language: `ring.com/eu/en/terms`, `ring.com/fr/fr/terms` and
 * `ring.com/ca/fr/terms` are the same document as `ring.com/terms`. Stripping
 * one segment left the shape as `ring.com/en/terms`, which is different from
 * `ring.com/terms`, so the variants stayed three separate candidates. With the
 * order that shipped that cost nothing visible, because all three sat at depth
 * three and the eight slots were already spent; comparing score first is what
 * exposed it, and reading three other markets' pages for a UK customer is the
 * same error as reading Ireland's Spotify agreement for a UK subscription,
 * which is the defect this function was written for.
 *
 * A second segment is only stripped when it is itself a market marker, so
 * `spotify.com/uk/legal/end-user-agreement` keeps `legal` and the document does
 * not collapse into a different one.
 */
function documentShape(url: string): { shape: string; locale: string | null } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const first = (segments[0] ?? "").toLowerCase();
  if (first && LOCALE_SEGMENT.test(first)) {
    let rest = segments.slice(1);
    const second = (rest[0] ?? "").toLowerCase();
    if (second && LOCALE_SEGMENT.test(second)) rest = rest.slice(1);
    return { shape: `${parsed.host}/${rest.join("/")}`, locale: first };
  }
  return { shape: `${parsed.host}/${segments.join("/")}`, locale: null };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * What a URL is, before anything is done with it.
 *
 * The three parts are carried separately because they answer different
 * questions and are not interchangeable: `deprioritised` says whether the
 * document belongs to someone else, `score` says how much of a policy document
 * it is, and `depth` says how far under the root it sits. Which of them is
 * compared first is decided in `selectPolicyUrls`, where the measurements that
 * decide it are recorded.
 *
 * **None of them is subtracted from another.** The first version folded depth
 * and the deprioritise penalty into the score, and both could drive a real
 * document to zero or below, where the caller's `score > 0` test silently
 * dropped it. Measured: Spotify's `/uk/legal/end-user-agreement` came out at
 * **1**, so one more path segment would have made the consumer contract of a
 * judged counterparty invisible to the crawl. A preference that can exclude is
 * not a preference.
 */
function classify(url: string): { score: number; deprioritised: boolean; depth: number } {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return { score: -1, deprioritised: false, depth: 0 };
  }
  const segments = path.split("/").filter(Boolean);
  const tokens = path.split(/[/_\-.]+/).filter(Boolean);
  if (tokens.some((t) => REJECT_TOKENS.includes(t))) {
    return { score: -1, deprioritised: false, depth: segments.length };
  }

  // Each concept counts once, however many of its spellings the path uses.
  const matched = new Set<string>();
  let deprioritised = false;
  for (const token of tokens) {
    if (DEPRIORITISE_TOKENS.includes(token)) deprioritised = true;
    const concept = SYNONYMS[token] ?? token;
    if (POLICY_CONCEPTS.includes(concept)) matched.add(concept);
  }
  if (matched.size === 0) return { score: -1, deprioritised, depth: segments.length };

  let score = 0;
  for (const concept of matched) score += POLICY_CONCEPTS.length - POLICY_CONCEPTS.indexOf(concept);
  return { score, deprioritised, depth: segments.length };
}

/**
 * How much a URL looks like a document a claim is argued from.
 *
 * Negative means "not a candidate at all". The path is split on `/`, `_`, `-`
 * and `.` so matching is on whole words: a slug like
 * `noise-cancelling-headphones` must not register as a cancellation policy.
 *
 * This is the score only, and it is deliberately positive for every document
 * that is a candidate, however deeply nested and whoever it belongs to. A
 * caller that ranks documents has to apply `classify`'s other two parts or it
 * will put a creator agreement above a consumer one, and a caller that treats a
 * low score as "not a candidate" will lose the contract it most needs.
 */
export function scoreUrl(url: string): number {
  return classify(url).score;
}

/**
 * The score of a document that matches both `terms` and `conditions`.
 *
 * Derived from `POLICY_CONCEPTS` rather than written as a number, so a change
 * to the vocabulary cannot leave the cap behind. It is the canonical English
 * name for the document this product reads, which is why it is the value at
 * which "more words" stops meaning "more of a contract".
 */
const CONTRACT_SCORE =
  POLICY_CONCEPTS.length - POLICY_CONCEPTS.indexOf("terms") +
  POLICY_CONCEPTS.length - POLICY_CONCEPTS.indexOf("conditions");

/**
 * Rank a site's URLs down to the handful worth reading.
 *
 * One representative per document, so a site that publishes its agreement in
 * 292 markets contributes one candidate rather than 292.
 *
 * Order is by class (a document that belongs to someone else goes last,
 * however well it scores), then by how much of a contract it is, then by depth,
 * then by score, then by which market the variant belongs to, then by URL so
 * the result does not depend on the order the sitemap happened to list things
 * in.
 *
 * **Score is compared before depth, and it is capped at `CONTRACT_SCORE`. Both
 * halves of that sentence are measured, and both are needed.**
 *
 * Depth first was the order that shipped, and it fails on a large site.
 * Measured on John Lewis: 87 candidates, and the eight slots fill with pages at
 * depth 1 and 2, seven of which score 3, while the company's own terms page
 * scores 32 at depth 3 and is never reached. Measured on Trainline the same
 * way: its two highest-scoring documents, 15 and 11, land 7th and 8th of ten.
 *
 * Score first on its own does not dominate, and the reason is what the cap is
 * for. A page that extends a real terms page with an extra topic word outscores
 * the terms page itself: Argos' `/help/terms-and-conditions/black-friday-price-
 * guarantee` reaches 37 against the 29 of `/help/terms-and-conditions`, and
 * Evri's `/our-services/evri-video-terms-and-conditions` reaches 32 against the
 * 29 of `/terms-and-conditions`. Neither carries a deprioritise token, so the
 * class test does not separate them and neither does the reject list. Capping
 * at the contract value makes both pairs tie, and depth then puts the contract
 * itself first.
 *
 * The cap does not hide the score. It is still compared, after depth, so of two
 * documents at the same depth that both clear the cap, the one matching more
 * concepts still wins.
 *
 * Depth stays a key rather than a subtraction. Applying it as a subtraction
 * achieved the ordering below and also drove a deeply-nested contract to 1,
 * where the caller's `score > 0` test dropped it.
 *
 * **One recorded property does not survive this, and it was wrong before it
 * was overtaken.** An earlier version of this comment claimed that depth first
 * put a retailer's `/warranty` at 9 above its `/loyalty-scheme/terms-conditions`
 * and `/group-rides/terms-and-conditions` at 8. The first of those is a
 * deprioritise case, so depth was never what decided it, and the second figure
 * is simply wrong: `terms` and `conditions` are the top two concepts, so that
 * URL scores 29 and not 8. The check that guarded the claim passed because
 * depth was compared first, not because the arithmetic put the warranty above
 * the terms page, and it was carried with `mustFailOn: []`, so it was never
 * evidence of anything. Under this ordering a nested document that matches
 * `terms` and `conditions` outranks a root-level page that matches only
 * `warranty`, which is the same rule that puts John Lewis's terms page first.
 * The warranty page is still picked on every site measured; it is no longer
 * picked first. That is the deliberate change, and the check now states it.
 */
export function selectPolicyUrls(urls: string[], limit = 8): string[] {
  const ranked = urls
    .map((url) => {
      const shape = documentShape(url);
      if (shape === null) return null;
      return { url, ...shape, ...classify(url) };
    })
    .filter(
      (
        x,
      ): x is {
        url: string;
        score: number;
        deprioritised: boolean;
        depth: number;
        shape: string;
        locale: string | null;
      } => x !== null && x.score > 0,
    )
    .sort(
      (a, b) =>
        Number(a.deprioritised) - Number(b.deprioritised) ||
        Math.min(b.score, CONTRACT_SCORE) - Math.min(a.score, CONTRACT_SCORE) ||
        a.depth - b.depth ||
        b.score - a.score ||
        localeRank(a.locale) - localeRank(b.locale) ||
        a.url.localeCompare(b.url),
    );

  const seen = new Set<string>();
  const chosen: string[] = [];
  for (const candidate of ranked) {
    if (seen.has(candidate.shape)) continue;
    seen.add(candidate.shape);
    chosen.push(candidate.url);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// The site's own sitemap
// ---------------------------------------------------------------------------

/**
 * A mapper is capped, and a shop has thousands of product URLs, so the handful
 * of documents a claim is argued from can sit past the cap and never be seen.
 * Measured on a real retailer on 17 September 2026: `map` returned 199 URLs
 * against a `limit` of 200 and **not one of them scored**, while the same
 * site's sitemap listed `returns-policy`, `terms-and-conditions` and
 * `warranty` on its first page.
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
 *
 * The URL cap counts distinct documents rather than URLs, for the reason
 * recorded at the `add` call below.
 */
const MAX_SITEMAP_REQUESTS = 20;
const MAX_SITEMAP_DEPTH = 3;
const MAX_POLICY_DOCUMENTS = 200;

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

/**
 * How much of a fetched document to keep.
 *
 * **This was 8,000,000, and it cut a real sitemap in half with a wrong answer
 * at the end of it.** Measured on Spotify: `/legal/sitemap.xml` is 9,211,047
 * bytes and lists 292 URLs, one per market. The slice dropped everything past
 * the cut, the UK agreement is at index 273 of 292, and the crawl therefore
 * read **Ireland's** agreement for a UK subscription. The crawl note said 254
 * URLs, which looks like a field and was a cut.
 *
 * Only one body is held at a time, so the bound costs a transient string rather
 * than the sum of the walk. A sitemap of nine megabytes is ordinary, so the
 * bound sits where only a pathological document reaches it, and reaching it is
 * treated as a failure rather than as a shorter list.
 */
const MAX_FETCH_BYTES = 32_000_000;

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Owed/1.0 (reads a company's published terms)" },
      signal: timeoutSignal(15_000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    return body.slice(0, MAX_FETCH_BYTES);
  } catch {
    return null;
  }
}

async function fetchXml(url: string): Promise<string | null> {
  const body = await fetchText(url);
  // A soft 404 answers 200 with a full HTML page, so only XML counts.
  if (!body || !body.includes("<loc>")) return null;
  // Refuse a document that was cut rather than parse a prefix of it. A partial
  // policy list is a field that looks exactly like the field: this one produced
  // a claim argued from another market's terms. Refusing costs the caller one
  // document and sends it to its next candidate, which is a smaller loss than a
  // confident wrong answer.
  if (body.length >= MAX_FETCH_BYTES) return null;
  return body;
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

/**
 * The document a URL is, if it is one a claim could be argued from.
 *
 * One rule, in one place, because two callers need it and a second copy of a
 * rule is how this module's first version drifted from the code it replaced.
 */
function policyDocument(url: string): string | null {
  if (scoreUrl(url) <= 0) return null;
  return documentShape(url)?.shape ?? null;
}

/**
 * How many distinct documents a list of URLs covers.
 *
 * The walk's budget counts documents rather than URLs, so a caller checking
 * whether that budget was reached has to count them the same way. Without this
 * the budget is invisible from outside, and a budget nobody can measure is a
 * budget that truncates silently.
 */
export function distinctDocuments(urls: string[]): number {
  const shapes = new Set<string>();
  for (const url of urls) {
    const doc = policyDocument(url);
    if (doc !== null) shapes.add(doc);
  }
  return shapes.size;
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
export async function sitemapUrls(origin: string): Promise<string[]> {
  let root: string;
  try {
    root = new URL(origin).origin;
  } catch {
    return [];
  }

  const keep: string[] = [];
  const shapes = new Set<string>();
  const add = (list: string[]) => {
    for (const u of list) {
      const doc = policyDocument(u);
      if (doc === null) continue;
      if (!shapes.has(doc)) {
        // The budget is spent on distinct documents, not on URLs. Measured:
        // Spotify's legal sitemap holds 292 locale variants of one agreement,
        // and a budget counted in URLs would have spent all of it on that one
        // document while later children holding the rest of the site's
        // policies were never fetched. A cap that can be consumed by copies of
        // a single page is a cap that silently truncates the field, which is
        // the failure this whole module exists to stop repeating.
        if (shapes.size >= MAX_POLICY_DOCUMENTS) return;
        shapes.add(doc);
      }
      keep.push(u);
    }
  };

  // The declared sitemaps are tried first, so on a site that publishes one the
  // guesses below never cost a request. Measured on a real retailer: robots.txt
  // named `https://www.sigmasports.com/sitemap.xml`, and the guesses then
  // re-fetched that same file under its bare host, which on a large site is not
  // a wasted request but a wasted megabyte.
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
      if (shapes.size >= MAX_POLICY_DOCUMENTS) break;
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
