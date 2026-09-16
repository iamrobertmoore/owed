---
name: firecrawl-firecrawl-convex
description: Firecrawl for Convex lets you scrape, map, and search the web from Convex actions and run durable site crawls tracked in your Convex database with reactive queries. Use this skill whenever the user mentions ai, search, web search. Also trigger when discussing content extraction, url fetching, scrape a webpage from a convex action, even if they don't explicitly ask for firecrawl.
version: 0.1.1
---

> Agents: read this skill fully before writing code that uses firecrawl. Follow the installation and configuration steps exactly.

# firecrawl

## Instructions

Use firecrawl to firecrawl for convex lets you scrape, map, and search the web from convex actions and run durable site crawls tracked in your convex database with reactive queries. This Convex component integrates directly with your backend.

### Installation

```bash
npm install @firecrawl/firecrawl-convex
```

Current npm version: `@firecrawl/firecrawl-convex@0.1.1`

### Capabilities

- Run durable multi-page crawls that survive action timeouts, with progress and pages streamed into your Convex database and subscribed to by your UI in real time
- Call scrape, map, and search directly from Convex actions with TypeScript types over the Firecrawl v2 REST API, no Node.js runtime or bundled SDK required
- Receive crawl completion via an internal mutation callback with user-supplied context, enabling reliable post-crawl pipelines like RAG indexing without polling
- Handle webhook delivery verification, poll fallback for local development, document size budgeting, and transient error retries without writing infrastructure code

## Examples

### how to scrape a webpage from a Convex action

The firecrawl-convex component exposes a FirecrawlClient with a scrape method you call directly from a Convex action. It accepts a URL and options like formats, onlyMainContent, and maxAge, and returns markdown, HTML, screenshots, or structured JSON extracted via a prompt. No Node.js runtime is needed since everything runs in the standard Convex runtime against the Firecrawl v2 REST API.

### how to crawl an entire website durably in Convex

The firecrawl-convex component provides a startCrawl method that registers a crawl with Firecrawl, stores a crawls row and a pages table in your Convex database, and advances them via webhooks or polling. Your client subscribes to live crawl progress using useQuery and usePaginatedQuery against plain Convex queries, so no polling is needed in your frontend. When the crawl finishes, an internal mutation you provide is called exactly once with the final status and any context you passed at start time.

### web search from Convex function with scraped results

The firecrawl-convex search method runs a web search from any Convex action and optionally scrapes each result page in the same call using scrapeOptions. Results are returned as-is from the Firecrawl v2 API with TypeScript types, so new response fields are available as soon as Firecrawl ships them without waiting for a package update.

### how to index crawled pages into a vector database from Convex

Pass an onComplete internal mutation to startCrawl and include a context payload such as a userId or document ID. When the crawl reaches a terminal state, the mutation runs exactly once and receives the crawlId, final status, page count, and your context. From there you can schedule further work such as calling an embedding pipeline using ctx.scheduler.runAfter, and you can read the stored pages using firecrawl.listPages inside that pipeline.

## When NOT to use

- When a simpler built-in solution exists for your specific use case
- If you are not using Convex as your backend
- When the functionality provided by firecrawl is not needed

## Troubleshooting

**Does the firecrawl-convex component work during local Convex development?**

Yes. Because a local Convex deployment is not reachable from Firecrawl's servers, you pass mode: 'poll' to startCrawl so the component polls the Firecrawl status endpoint instead of waiting for webhooks. The component also ships a mock Firecrawl server in the example directory that delivers signed webhook events to a local deployment so you can test full crawl flows without spending API credits.

**What happens when a crawled page is too large to store in Convex?**

The firecrawl-convex component budgets each page document in UTF-8 bytes against Convex's 1MB document limit. Text and link lists are truncated to fit, while a screenshot, extracted JSON blob, or changeTracking data that does not fit is dropped entirely. Any truncation sets a truncated flag on the page document. Pages that still cannot be stored are counted in an unstored field on the crawl row and in the onComplete callback payload, so the situation is never silent. For very large crawls, you can pass storeContent: false to record only URLs and metadata.

**How does firecrawl-convex secure incoming webhook deliveries?**

The component validates each incoming webhook delivery using two checks: an HMAC signature verified against the FIRECRAWL_WEBHOOK_SECRET environment variable when it is set, and a per-crawl token the component generates and passes to Firecrawl when registering the webhook. A delivery that fails either check is rejected with a 401 response and nothing is written to the database.

**How do I handle Firecrawl API errors like rate limits or credit exhaustion in Convex?**

The firecrawl-convex component throws ConvexErrors carrying a structured payload with code, status, path, and message fields. You can branch on error.data.status to handle specific cases such as 402 for out of credits or 429 for rate limiting. Transient failures including 408, 425, 429, and 5xx responses are retried automatically up to three times with backoff, and the component respects the Retry-After header when present.

**Can I use firecrawl-convex with a self-hosted Firecrawl instance?**

Yes. Set the FIRECRAWL_API_URL environment variable in the component configuration and point it at your self-hosted Firecrawl instance. The component will direct all API requests there instead of the default Firecrawl cloud endpoint. Everything else including webhook validation, polling, and the TypeScript client API works the same way.

## Resources

- [npm package](https://www.npmjs.com/package/%40firecrawl%2Ffirecrawl-convex)
- [GitHub repository](https://github.com/firecrawl/firecrawl-convex)
- [Live demo](https://github.com/firecrawl/firecrawl-convex/tree/main/example)
- [Convex Components Directory](https://www.convex.dev/components/firecrawl/firecrawl-convex)
- [Convex documentation](https://docs.convex.dev)