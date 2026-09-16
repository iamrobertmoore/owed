<!--
  FILL IN BEFORE SUBMITTING. Every {{...}} below is a real value that does not
  exist until the app is deployed and the demo cases are in the ledger.
  {{LIVE}}          the deployment URL, e.g. https://<deployment>.convex.site
  {{CLAIM_FOUND}}   the id of the claim the agent found from a forwarded mail
  {{CLAIM_POLITE}}  the id of the claim where an apology settled nothing
  {{CLAIM_SILENT}}  the id of the claim that escalated on silence
  Grep for "{{" before pushing. There must be nothing left.
-->

<p align="center"><img src="docs/brand/readme-banner.svg" alt="Owed. Give your agent an address, and it goes and gets what you are owed." width="1000"></p>

<p align="center"><strong>Your agent holds the paper trail, so it finds what you are owed instead of waiting to be told.</strong></p>

<p align="center"><a href="{{LIVE}}">Open the ledger</a> · <a href="{{LIVE}}#claim={{CLAIM_FOUND}}">Read a claim it found</a> · <a href="{{LIVE}}#claim={{CLAIM_POLITE}}">See an apology settle nothing</a></p>

Every other tool waits for you to describe a dispute. Owed is holding the paper trail, so it notices one.

You forward what already lands in your inbox anyway: order confirmations, bookings, renewal notices. Owed reads the company's own published terms, works out what you are owed, writes the letter that cites the clause by its reference, and asks you before it sends anything.

That is the difference that matters. Nobody has to remember that a lens arrived cracked six weeks ago, or that a hotel took a deposit it said it would return. The agent is holding the receipt, so the claim finds you rather than the other way round.

I am the user. My paper trail is the usual mess: a lens, two hotel bookings, three subscriptions I meant to cancel, train tickets. The refunds I never chased are the ones too small to be worth an evening and too annoying to let go. Owed is for the person who is not going to spend that evening, and should not have to.

Built with **Convex**, **AgentMail**, **Firecrawl** and **OpenAI**, for the **Convex All Gas Hackathon**.

## A minute inside the product

| Try this | Watch what happens |
|---|---|
| [The claim it found]({{LIVE}}#claim={{CLAIM_FOUND}}) | A forwarded confirmation became a record, the retailer's own returns page was read, and a clause promising a full refund on damaged goods was quoted back by its reference. Nobody described a dispute. |
| [The polite nothing]({{LIVE}}#claim={{CLAIM_POLITE}}) | An apology arrives with no decision behind it. It is read as an acknowledgement, not a concession, so the claim stays open. The agent does not declare victory on a kind sentence. |
| [The silence that escalated]({{LIVE}}#claim={{CLAIM_SILENT}}) | No reply inside the window the company itself publishes. The sweep moves the claim up a rung and drafts a different letter. Silence is not agreement, and the ledger says so. |

## £71.2 billion a year is not recovered

That is the UK government's own figure. The Department for Business and Trade published the **Consumer Detriment Survey 2024** on 27 March 2025: **£71.2 billion of net consumer detriment** in the twelve months to April and May 2024. Net means after everything people did manage to get back. It is what was lost and stayed lost.

Behind it, in the same survey:

- **38.5 million UK consumers affected, 72% of all consumers**, across 294.9 million problems.
- **22% of those problems saw no action taken at all**, roughly 65 million of them. Not a complaint that failed, no complaint.
- **15% of refund requests were never paid.**
- In 25% of the experiences reported, the seller did nothing at all.
- **47% of 18 to 29 year olds** did not act on at least one incident, the highest of any age group.

The barrier is not that people do not know they were wronged. It is that pursuing it costs an evening, and the amount is usually £40. Owed moves that evening onto something that already has the paperwork and does not get bored.

## How it works

![Owed architecture: a forwarded confirmation becomes a record, the terms are read, a claim is found, you approve the letter, and only a concession settles](docs/architecture.svg)

**Your agent has an address.** One per person, created on first use. Mail arriving at it is verified and deduplicated by event id, then routed to the claim it belongs to. The agent never asks for a password to your real mailbox and never reads your life. It reads what you forward.

**The paper trail is the part nobody else keeps.** Order confirmations, bookings, delivery promises and renewal notices become records: what was bought, from whom, and when it was due. This is what lets Owed find a claim instead of waiting for one.

**Claims are argued from the company's own words.** Firecrawl maps their site, picks out the terms, and mines them for provisions kept verbatim with the document's own reference number. Each one is embedded and stored in a filtered vector index, so a claim retrieves the clauses that bear on it. The letter cites the provision by reference and answers the exclusion they would rely on before they raise it.

**Nothing is sent without you.** The agent drafts. You read the letter and press send. One person, one dispute, one thread: there is no bulk mail here and no sending without approval.

**Only a concession settles anything.** A reply is read for what it commits to. An apology with no decision behind it is an acknowledgement. A request for more time is a stall. Neither settles a claim, and neither closes it. Silence moves the claim up the ladder on a schedule, and after the last rung the next step is yours, which the product says out loud rather than quietly giving up.

## What it costs to run

No OpenAI credits came with the event, so spend is real money and I treated it that way.

- Every model call goes through one module and is cached by a content hash of its exact inputs. A repeated input costs nothing.
- `gpt-4o-mini` and `text-embedding-3-small`, nothing larger.
- No model call ever runs on a page load.
- The ledger footer reports this deployment's distinct calls, tokens and dollar spend, read out of the cache table rather than estimated.

<details>
<summary><strong>The Convex surface</strong></summary>

| Area | What is used |
|---|---|
| Schema | Nine tables, twenty indexes, typed validators for the claim lifecycle and the reply classifications |
| Vector search | A 1024-dimension index over the provisions, filtered by counterparty, retrieved from an action |
| Functions | Queries, mutations and actions, with internal functions for everything the UI must not reach |
| HTTP | An HTTP action for the AgentMail webhook, mounted in `convex/http.ts` |
| Scheduling | A thirty-minute cron sweep, plus scheduled functions for each next step and for drafting |
| Auth | Convex Auth, with a password provider and an anonymous one so the deployed app is usable in one click |
| Components | `@agentmail/convex` for the address, `@firecrawl/firecrawl-convex` for the terms, `@convex-dev/static-hosting` for this page |
| Storage | File storage for evidence attached to a claim |

Two rules the code enforces rather than describes. The sweep never sends, only drafts. And a claim is only ever settled by a `concession`, so the number at the top of the ledger is money that actually came back.

</details>

## The failures that changed the code

- **The first architecture had a circular import and TypeScript hid it.** `ai.ts` logged model calls onto a claim, claims scheduled a letter, and letters called the model. The cycle made the inferred type of every public query `any`, which meant the front end was silently untyped. I moved approval into `letters.ts`, where the letter lifecycle lives, and the cycle went. `tsc` had been passing the whole time it was broken.
- **I called `readCache` with `runQuery` and it was declared an action.** It had never run. Reading the component type definitions rather than trusting my notes caught it, along with `map` being called with an object where the real signature is positional.
- **`ctx.vectorSearch` is not available in a query context.** I found this by running it rather than assuming it, which is why provision retrieval lives in an action.
- **The architecture diagram was invalid XML and rendered as an error page.** XML comments cannot contain a run of hyphens, and I had used dashes as separators. I only found it by rendering the file and looking at it.

## Honest limits

The terms reader covers refunds, returns, cancellations, warranties, complaints, delivery and compensation pages. A company that publishes its obligations only inside a PDF, or behind a login, will not be read. The detector is strict on purpose: a claim only exists when a specific provision commits them to a specific remedy and the record shows the condition was met, so it will miss real entitlements that no clause names.

The reply classifier is the weakest link. It is a single model call with a fixed set of labels, and a reply that concedes nothing but reads as though it might could be filed as an acknowledgement when it deserved a rung. The ladder stops after three letters by design, and says so in the product.

The £71.2 billion figure is the government's, for the UK, and measures detriment rather than anything Owed recovers. I make no claim about how much of it this product would return.

## Run it

```bash
npm install
npx convex dev
```

Then set the three keys on the deployment:

```bash
npx convex env set OPENAI_API_KEY <key>
npx convex env set AGENTMAIL_API_KEY <key>
npx convex env set AGENTMAIL_WEBHOOK_SECRET <whsec_...>
npx convex env set FIRECRAWL_API_KEY <fc-...>
npx @convex-dev/auth
```

`npx @convex-dev/auth` writes the JWT signing keys Convex Auth needs. Without it, sign-in fails with a jose import error rather than anything useful, so the app now says so on screen instead.

The front end is served from the deployment itself by static hosting:

```bash
npm run deploy
```

## Disclosure and licence

The demo cases run on real forwarded mail with the personal details removed. The survey figures are the UK government's own and are cited above. The banner and the diagram are hand-authored SVG in `docs/`.

Built by [Robert Moore](https://github.com/iamrobertmoore). **MIT**. See [LICENSE](LICENSE).
