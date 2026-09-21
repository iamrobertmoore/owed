<!--
  The claim links below use stable slugs (demo-found, demo-polite, demo-silent,
  demo-gate) rather than row ids. A Convex id belongs to whoever created the row,
  so a link built from one is dead for every other visitor, which is every judge.
  A slug resolves against the caller's own seeded copy instead, which is the
  reason the worked example is seeded on arrival rather than only on request.
-->

<p align="center"><img src="docs/brand/readme-banner.svg" alt="Owed. Give your agent an address, and it goes and gets what you are owed." width="1000"></p>

<p align="center"><strong>Your agent holds the paper trail, so it finds what you are owed instead of waiting to be told.</strong></p>

<p align="center"><a href="https://fantastic-hamster-482.convex.site">Open the ledger</a> · <a href="https://fantastic-hamster-482.convex.site#claim=demo-found">Read a claim it found</a> · <a href="https://fantastic-hamster-482.convex.site#claim=demo-polite">See an apology settle nothing</a></p>

Owed does not wait for you to notice that something went wrong. It already has the paper.

You forward what lands in your inbox anyway: order confirmations, bookings, renewal notices. Owed gives your agent an email address of its own, reads the company's own published terms, works out what you are owed, writes the letter that cites the clause by its reference, and asks you before it sends anything. Then it runs the chase on the deadline the company itself published, and it only marks a claim settled when somebody actually concedes.

That inversion is the product. Nobody has to remember that a lens arrived cracked six weeks ago, or that a hotel took a deposit it said it would return. The agent is holding the receipt, so the claim finds you rather than the other way round.

I am the user. My paper trail is the usual mess: a lens, two hotel bookings, three subscriptions I meant to cancel, train tickets. The refunds I never chased are the ones too small to be worth an evening and too annoying to let go. Owed is for the person who is not going to spend that evening, and should not have to.

Built with **Convex**, **AgentMail**, **Firecrawl** and **OpenAI**, for the **Convex All Gas Hackathon**.

## A minute inside the product

Open the live URL and the ledger is already there. A cold visitor is signed in as a guest the moment the page loads, so the four cases are on screen without a click, and so is a working forward address that is yours for the session. The links below open straight into one of the four. The sign-in card still exists, behind **Create an account** in the header, and it is the only screen here that is not the product.

These four are a worked example, labelled as one on every row, so the whole product is legible in sixty seconds without anyone forwarding an email and waiting.

| Try this | Watch what happens |
|---|---|
| [The claim it found](https://fantastic-hamster-482.convex.site#claim=demo-found) | Two forwarded emails became one record: the order confirmation, and the damage report that followed it. The retailer's own returns page was read, the clause promising a full refund on damaged goods was found, and it was quoted back by its reference. Nobody had to know that clause was there, and it settled: the money at the top of the ledger is what came back in writing. |
| [The polite nothing](https://fantastic-hamster-482.convex.site#claim=demo-polite) | An apology arrives with no decision behind it. It is read as an acknowledgement, not a concession, so the claim stays open. The agent does not declare victory on a kind sentence. |
| [The silence that escalated](https://fantastic-hamster-482.convex.site#claim=demo-silent) | No reply inside the window the company itself publishes. The sweep moves the claim up a rung and drafts a different letter. Silence is not agreement, and the ledger says so. |
| [The letter waiting on you](https://fantastic-hamster-482.convex.site#claim=demo-gate) | A drafted letter that cites clause 11.3 and answers the clause 11.4 exclusion before they raise it. Nothing leaves the outbox until you press send. |

### It runs on real mail, against real companies

Forward something to the address on the ledger and the whole pipeline runs for real. I pointed it at my own inbox to prove it.

**Sky is the one to look at.** I forwarded a genuine Sky broadband price-rise notice. The agent kept it as a record, worked out that Sky writes from `contact.sky` but publishes its terms on `sky.com`, went to the right site on its own, **read eight documents and kept thirty-eight clauses verbatim with their own reference numbers**, and then made a call: a mid-contract price rise is a right to *leave*, not a sum the company *owes* you, so there is no claim to raise. It wrote that reasoning onto the record in its own words, and you can read it on the sheet.

That is the entire loop running end to end on a real company, and then declining to manufacture a claim the paper could not support. A detector that finds something every time is a detector you cannot trust with a letter that goes out over your name.

Nine real emails went through it in total: an order confirmation from a bike shop, a refund notification from a booking platform, a missed-delivery notice, two cancellation requests, and price-rise notices from Spotify, Ring and Sky. It read all nine and decided each one in a sentence of its own. Spotify and Ring were read from `spotify.com` and `ring.com` and correctly produced nothing, because a rolling monthly subscription has no exit charge to be released from. **No claim has yet been found from real post on this deployment**, and every one of those nine decisions is on my ledger with the agent's reasoning attached.

Those decisions are on my ledger and not on yours by design: every read in Owed re-checks the account that owns the row, so a visitor sees their own ledger and nobody else's. Sign in and you get your own copy of the four cases above, and your own address.

## £71.2 billion is not recovered

That is the UK government's own figure. The Department for Business and Trade published the **Consumer Detriment Survey 2024** on 27 March 2025: **£71.2 billion of net consumer detriment** in the twelve months to April and May 2024. Net means after everything people did manage to get back. It is what was lost and stayed lost.

Behind it, in the same survey:

- **38.5 million UK consumers affected, 72% of UK adults**, across 294.9 million problems.
- **22% of those problems saw no action taken at all**, roughly 65 million of them. Not a complaint that failed, no complaint.
- **In 15% of cases where a refund was requested, no refund was given at all.**
- **In 25% of incidents the seller took no action at all**, a figure that includes the incidents the consumer never raised.
- **47% of 18 to 29 year olds who experienced detriment** did not act on at least one incident, the highest of any age group.

The barrier is not that people do not know they were wronged. It is that pursuing it costs an evening. The survey puts the median net loss per incident, including the value of the time spent chasing it, at £32, and it finds that the things people leave alone are worth less than the ones they chase: a median of £60 where no action was taken, against £100 where it was. Owed moves that evening onto something that already has the paperwork and does not get bored.

## How it works

![Owed architecture: a forwarded confirmation becomes a record, the terms are read, a claim is found, you approve the letter, and only a concession settles](docs/architecture.svg)

**Your agent has an address, and it is a real one.** A real account gets an AgentMail inbox of its own, created on first use. A guest gets a plus-addressed alias on a shared inbox, so a visitor can forward something within seconds of landing and it still routes to that guest's ledger and nowhere else. Inbound mail arrives over a signed webhook, is verified and deduplicated by event id, and is routed to the claim it belongs to. The agent never asks for a password to your real mailbox and never reads your life. It reads what you forward.

**The paper trail comes first.** Order confirmations, bookings, delivery promises and renewal notices become records: what was bought, from whom, and when it was due. Everything downstream is built on that, which is what lets Owed find a claim instead of waiting for one.

**Claims are argued from the company's own words.** Firecrawl takes the counterparty's site sitemap-first, scores the candidate policy URLs and crawls the ones that will actually carry obligations, then the terms are mined for provisions kept **verbatim, with the document's own reference number**. Each provision is embedded and stored in a filtered Convex vector index, so a claim retrieves only the clauses that bear on it and on that counterparty. The letter cites the provision by reference and answers the exclusion they would rely on before they raise it. This is why the output is a letter a company has to engage with rather than a template with a company name dropped into it.

**Nothing is sent without you.** The agent drafts. You read the letter and press send. One person, one dispute, one thread: there is no bulk mail here and no sending without approval.

**Only a concession settles anything.** A reply is read for what it commits to. An apology with no decision behind it is an acknowledgement. A request for more time is a stall. Neither settles a claim, and neither closes it. Silence moves the claim up the ladder on a schedule, and after the last rung the next step is yours, which the product says out loud rather than quietly giving up.

## The Convex surface

| Area | What is used |
|---|---|
| Schema | Ten tables, twenty indexes and a vector index, with typed validators for the claim lifecycle and the reply classifications |
| Vector search | A 1024-dimension index over the provisions, filtered by counterparty, retrieved from an action |
| Functions | Queries, mutations and actions, with internal functions for everything the UI must not reach |
| HTTP | An HTTP action for the AgentMail webhook, mounted in `convex/http.ts`, verifying the signature before anything is written |
| Scheduling | A thirty-minute cron sweep that actually escalates live claims, plus scheduled functions for each next step and for drafting |
| Auth | Convex Auth, with a password provider and an anonymous one so the deployed app is usable with no clicks at all |
| Components | `@agentmail/convex` for the address, `@firecrawl/firecrawl-convex` for the terms, `@convex-dev/static-hosting` for this page |

Two rules the code enforces rather than describes. **The sweep never sends, only drafts.** And **a claim is only ever settled by a `concession`**, so the number at the top of the ledger is money that actually came back.

## What it costs to run

No OpenAI credits came with the event, so spend is real money and I treated it that way. **383 distinct model calls have cost five cents.**

- Every model call goes through one module and is cached by a content hash of its exact inputs. A repeated input costs nothing.
- `gpt-4o-mini` and `text-embedding-3-small`, nothing larger.
- No model call ever runs on a page load.
- The ledger footer reports this deployment's distinct calls, tokens and dollar spend, from a running total kept beside the call log rather than estimated. It is read out of the database, so it cannot drift from what actually happened.

## What it reads

The terms reader covers refunds, returns, cancellations, warranties, complaints, delivery and compensation pages, which is where consumer obligations actually live. A company that publishes its obligations only inside a PDF, or behind a login, is out of reach for now.

The detector is deliberately strict: a claim exists when a specific provision commits them to a specific remedy and the record shows the condition was met. That is the design, not a limitation to apologise for. The alternative is a product that drafts confident letters about entitlements that do not exist, over your name, to a company that will notice.

<details>
<summary><strong>Four bugs that changed the architecture</strong></summary>

- **The first architecture had a circular import and TypeScript hid it.** `ai.ts` logged model calls onto a claim, claims scheduled a letter, and letters called the model. The cycle made the inferred type of every public query `any`, which meant the front end was silently untyped. I moved approval into `letters.ts`, where the letter lifecycle lives, and the cycle went. `tsc` had been passing the whole time it was broken.
- **I called `readCache` with `runQuery` and it was declared an action.** It had never run. Reading the component type definitions rather than trusting my notes caught it, along with `map` being called with an object where the real signature is positional.
- **`ctx.vectorSearch` is not available in a query context.** I found this by running it rather than assuming it, which is why provision retrieval lives in an action.
- **The architecture diagram was invalid XML and rendered as an error page.** XML comments cannot contain a run of hyphens, and I had used dashes as separators. I only found it by rendering the file and looking at it.

</details>

<details>
<summary><strong>Why the address is created through AgentMail's API rather than the Convex component</strong></summary>

The address is created, and the letter sent, through AgentMail's own API rather than through the Convex component, because the component's inbox call is an internal action and Convex exposes only a component's public functions to the app, while its functions cannot read the deployment's credential. The component still does the half it can, which is verifying the webhook signature, deduplicating by event id, and dispatching the reply.

The plan allows three inboxes, which is why guests are routed through plus-addressed aliases rather than handed one each: provisioning one per visitor spent the allowance within the first few people to open the deployed app. One of the three is the shared inbox the aliases sit on, so two accounts can hold an inbox of their own; past that an owner is handed the same alias a guest gets rather than an error, so the panel always shows an address that works.

</details>

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

The worked example is reconstructed content, not a live mailbox, and it is labelled as the worked example on every row it appears on. Its counterparties are fictional businesses on `.example` domains, which RFC 2606 reserves so they can never resolve. It loads only onto an empty ledger, so it can never sit beside a claim the owner did not create, and pressing send on it writes to the timeline that nothing was transmitted. It exists so the product is legible in a minute rather than after a forward and a wait.

Real claims would run on real forwarded mail with the personal details removed; production has detected none yet, and the nine emails described above are the real paper in the product. The £71.2 billion figure is the government's, for the UK, and measures detriment rather than anything Owed recovers. The survey figures are cited above. The banner and the diagram are hand-authored SVG in `docs/`.

Built by [Robert Moore](https://github.com/iamrobertmoore). **MIT**. See [LICENSE](LICENSE).
