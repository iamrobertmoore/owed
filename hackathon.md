# Hackathon log

- **Project:** Owed
- **Event:** Convex All Gas Hackathon
- **What it does:** An agent that holds a person's paper trail, finds what they are owed against the counterparty's own published terms, and pursues it.
- **Live app:** not deployed
- **Repo:** private
- **Frontend:** Convex static hosting
- **Convex deployment:** not deployed
- **Components:** @agentmail/convex, @firecrawl/firecrawl-convex, @convex-dev/static-hosting, @convex-dev/auth
- **Convex features:** schema, tables, indexes, vector search, queries, mutations, actions, HTTP actions, crons, scheduled functions, file storage, realtime queries
- **Auth:** Convex Auth
- **AI models:** gpt-4o-mini, text-embedding-3-small
- **Started:** 2026-09-15T17:01:13Z
- **Last updated:** 2026-09-16T11:47:00Z

## Log

### 2026-09-15 - working tree
Started the project and wrote the domain model. Nine tables: an inbox per
person, counterparties, verbatim citable provisions with a 1024-dimension
vector index over them, the paper trail of orders and bookings and
subscriptions, claims, messages, an append-only event timeline, evidence files,
and a content-hash cache for model calls. The claim lifecycle and the reply
classifications are defined as validators in the schema so the state machine is
checkable rather than described (`convex/schema.ts`).

Built the claim lifecycle on top of it. A forwarded mail is routed by the
address it arrives at and the claim label in the subject, turned into a record,
and matched against the counterparty's stored provisions. Detection is strict:
a claim only exists when a provision commits them to a specific remedy and the
record shows the condition was met. Detecting one schedules an immediate draft
rather than waiting for the cron (`convex/records.ts`, `convex/sweep.ts`).

The escalation ladder is four rungs and each rung is a different letter, not
the same letter sent louder. Only a `concession` settles a claim, so an apology
with no decision behind it is filed as an acknowledgement and the claim stays
open. A refusal sets the next action from the ladder's own wait time instead of
pausing the chase forever (`convex/triage.ts`, `convex/letters.ts`).

The terms reader maps the counterparty's site with Firecrawl, extracts the
provisions that commit them to something, keeps each verbatim with the
document's own reference number, and embeds them into the filtered vector
index. Retrieval runs in an action, because `ctx.vectorSearch` is not available
in a query context on this backend build (`convex/policies.ts`).

Consolidated every model id and rate into one module so the cost of a call is
computed in one place, and cached every call by a content hash of its exact
inputs so a repeated input costs nothing (`convex/pricing.ts`,
`convex/aiCache.ts`).

Built the front end: a ledger with the recovered total at the top, a claim
detail sheet that quotes the provision by reference next to the letter that
cites it, an approval gate before anything is sent, and a spend footer read out
of the cache table rather than estimated (`src/App.tsx`, `src/ClaimSheet.tsx`).

Verified the whole thing against a self-hosted Convex backend with no API keys
present, which is the only way to prove the schema, the index and the state
machine without a live deployment. The check confirmed the 1024-dimension
vector index returns the right provision and no hit for a different
counterparty, that a draft lands in `awaiting_approval`, that a concession
settles at the claimed amount, that a refusal settles nothing and still sets a
next action, and that the event timeline reads detected, drafted, sent,
classified, settled.

Two rules the code enforces rather than describes: the sweep never sends, only
drafts, and a claim is only ever settled by a `concession`.

### 2026-09-16 - aaad7c2

Found a defect that only appears on the judged URL. Every read is scoped to the
user who owns the row, and the anonymous provider mints a fresh user on each
arrival, so a visitor pressing "Continue as a guest" got an empty ledger and the
three claim links in the README resolved to nothing. The worse half was the
address: `inboxes.provision` called `agentmail.createInbox` once per person, the
free tier allows three inboxes, and one was already taken, so the third visitor
got an error where an address should be (`convex/inboxes.ts`).

Guests now share one address and create nothing, and their ledger arrives seeded
with a four-case worked example. The claims carry a stable slug (`demoKey`) so
`#claim=demo-found` resolves against whoever is looking, which a Convex id can
never do. Four cases: one found from a forwarded confirmation and settled in
writing, one where an apology with no decision behind it is read as an
acknowledgement and the claim stays open, one that escalated on silence, and one
sitting at the approval gate with a letter drafted (`convex/example.ts`,
`convex/claims.ts`, `src/App.tsx`).

The example is marked rather than disguised. Every row carries a worked example
chip, the counterparties are fictional businesses on `.example` domains that RFC
2606 reserves so they can never resolve, and the letters are never transmitted:
`approve` advances a demo row and writes to its timeline that nothing left the
address, with a second guard in `send`, which is the only function in the
product that can put mail on the wire (`convex/letters.ts`).

Also made `messages.inboxId` optional. The example is reconstructed content
rather than a delivery, and inventing an inbox row to satisfy the reference
would have put an address in the table that no mail could reach
(`convex/schema.ts`).

Verified on the self-hosted backend with 26 assertions covering both guards, the
slug index, the money, the stages and the timelines. Two first-pass failures
were the test's fault and not the seed's: a global `collect()` counted rows an
earlier session had left in the dev database, so the checks were scoped to the
seeded guest. Rendering the ledger and the slug deep link through the real
components then caught a copy bug the assertions could not, where the paper
trail claimed "all from real mail" over records that come from the example.
