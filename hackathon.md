# Hackathon log

- **Project:** Owed
- **Event:** Convex All Gas Hackathon
- **What it does:** An agent with its own email address that holds a person's paper trail, finds what they are owed against the counterparty's own published terms, and pursues it.
- **Live app:** not deployed
- **Repo:** none
- **Frontend:** Convex static hosting
- **Convex deployment:** not deployed
- **Components:** @agentmail/convex, @firecrawl/firecrawl-convex, @convex-dev/static-hosting, @convex-dev/auth
- **Convex features:** schema, tables, indexes, vector search, queries, mutations, actions, HTTP actions, crons, scheduled functions, file storage, realtime queries
- **Auth:** Convex Auth
- **AI models:** gpt-4o-mini, text-embedding-3-small
- **Started:** 2026-09-15T17:01:13Z
- **Last updated:** 2026-09-15T18:31:02Z

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
