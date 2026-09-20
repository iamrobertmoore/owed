# Hackathon log

- **Project:** Owed
- **Event:** Convex All Gas Hackathon
- **What it does:** An agent that holds a person's paper trail, finds what they are owed against the counterparty's own published terms, and pursues it.
- **Live app:** https://fantastic-hamster-482.convex.site
- **Repo:** https://github.com/iamrobertmoore/owed
- **Frontend:** Convex static hosting
- **Convex deployment:** https://fantastic-hamster-482.convex.cloud
- **Components:** @agentmail/convex, @firecrawl/firecrawl-convex, @convex-dev/static-hosting
- **Convex features:** schema, tables, indexes, vector search, queries, mutations, actions, HTTP actions, crons, scheduled functions, realtime queries
- **Auth:** Convex Auth
- **AI models:** gpt-4o-mini, text-embedding-3-small
- **Started:** 2026-09-16T07:50:55Z
- **Last updated:** 2026-09-20T06:35:48Z

## Log

### 2026-09-16 - 07823cd
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

The escalation ladder is four rungs and each rung is a different letter. Only a
`concession` settles a claim, so an apology with no decision behind it is filed
as an acknowledgement and the claim stays open. The terms reader maps the
counterparty's site with Firecrawl, keeps each provision verbatim with its own
reference number, and embeds them into the filtered vector index; retrieval
runs in an action because `ctx.vectorSearch` is not available in a query
context on this backend build. Every model call is cached by a content hash of
its inputs, so a repeated input costs nothing, and the spend footer is read out
of the cache table rather than estimated (`convex/policies.ts`,
`convex/pricing.ts`, `src/App.tsx`).

Verified against a self-hosted Convex backend with no API keys present: the
vector index returns the right provision and no hit for a different
counterparty, a draft lands in `awaiting_approval`, a concession settles at the
claimed amount, a refusal settles nothing and still sets a next action, and the
timeline reads detected, drafted, sent, classified, settled. Two rules the code
enforces rather than describes: the sweep never sends, only drafts, and a claim
is only ever settled by a `concession`.

### 2026-09-16 - ab256f5

**The worked example, and a guest address that actually reaches a ledger.** A
visitor pressing "Continue as a guest" is a fresh anonymous user with an empty
ledger, so the deployed app had nothing to show. It now seeds four reconstructed
cases into a guest's ledger on arrival: one found from a forwarded confirmation
and settled in writing, one where an apology with no decision behind it is read
as an acknowledgement, one that escalated on silence, and one at the approval
gate with a letter drafted. The example is marked rather than disguised: every
row carries a worked-example chip, the counterparties are fictional businesses
on `.example` domains that RFC 2606 reserves so they can never resolve, and the
letter is never transmitted (`approve` advances a demo row and writes to its
timeline that nothing left the address, with a second guard in `send`, the only
function that can put mail on the wire).

**The address itself was the harder half.** `inboxes.provision` called
`createInbox` once per person, and the AgentMail free tier allows three inboxes
only once verified (one before), so the third visitor got an error where an
address should be. A guest now gets an alias on one shared inbox,
`owed+<token>@…`, measured against the live API to confirm the provider delivers
a plus-addressed message to the shared inbox while keeping the tag in the
envelope. `onMessageReceived` reads that tag and routes to the one guest, so
nothing is provisioned per visitor and the three-inbox ceiling stops being a cap
on how many people can use the product. Verified on the self-hosted backend with
a control: a message to one guest's alias left another guest's ledger empty
through the same code path. A real account still gets an inbox of its own and
can load the same example on request from the empty state, so the product is
recordable as well as legible (`convex/inboxes.ts`, `convex/example.ts`).

### 2026-09-17 - 646a4b3

**The app went live, and getting it there found a routing bug a status code could
not.** The build uploaded, all seven variables were set, and every path answered
404 with the body `No matching routes found`, which is Convex's own router rather
than the file server: the files were present and nothing routed to them.
`convex.config.ts` mounts static hosting without an `httpPrefix`, so
`registerStaticRoutes(http, components.staticHosting)` is what serves the site,
and it had never been called. `convex/http.ts` now calls it, safe next to the two
routes that cannot move: the AgentMail webhook's `POST` cannot collide with a
`GET`-only catch-all, and Convex Auth's `/.well-known/*` endpoints are exact
routes that take precedence.

**The inbound path was proven from an outside domain, the last unproven link.** A
forwarded mail from an unrelated personal account arrived at a guest's alias, was
verified by the component, routed onto that guest's ledger and nobody else's, and
read four seconds later by the model. The reader declined it, correctly and in a
sentence, because it was a refund confirmation and that is the "already resolved
and refunded" case its instructions exclude. Read off the deployment rather than
the screen: one `messages` row carrying the alias, one `aiCache` row carrying the
verdict. That test also found the gap the next entry closes: a declined message
left no trace a person could see, because the front end read the `messages` table
nowhere.

### 2026-09-17 - fb1b206

**The terms reader could not read a real retailer's terms, and the cause was a cap
rather than a filter.** A forwarded order produced a counterparty whose crawl note
read `Mapped 199 URLs, none looked like terms` — the mapper returned 199 against a
limit of 200 and none scored, while the same site's sitemap listed
`returns-policy`, `terms-and-conditions` and `warranty` on its first page. A shop
has thousands of product URLs and the documents a claim is argued from sit past the
cap. That is the defect class this log keeps recording: a capped scan produces no
error and no gap, only a smaller field that looks exactly like the field.

**The fix is the site's own sitemap**, which is complete and costs no crawl credit.
Four further defects were found by measuring, three of them introduced by the fix
for the one before: XML entities decoded in one pass so `&amp;` cannot become a
dead path; the sitemap reader filtered at read time so a child of product URLs
cannot exhaust the budget before the terms pages; a breadth-first walk with a depth
cap, because a sitemap tree is not always one level deep; and gzipped child
sitemaps dropped at the queue rather than the fetch. Verified by extracting the
shipped crawler and refusing to run unless it carries every marker of the current
version: four of six live retailers return the right documents where two returned
none, and the remaining two answer 403 to the sitemap request, which is the case
the mapper fallback exists for.

### 2026-09-17 - 0fdd3c7

**A message that arrived and was declined left no trace, so "read and declined" and
"never arrived" looked identical.** There is now an arrivals list on the ledger:
the sender, when it arrived, the claim it became if it became one, a chip reading
`became a record` or `not kept`, and the reader's own reason underneath, kept in
its own words. It is scoped to the caller like every other read and is inbound
paper only, because replies already appear on the claim they belong to.

**The decision was never lost, only unlinked.** Every model call is cached by a
hash of its prompt, so the reply was still in `aiCache`; what was missing was the
field on the message. Three fields were added and written on all three exits,
including the branch where the reply was not JSON, and messages that predate the
field are backfilled by recomputing the same hash. The backfill was checked before
it was written: two keys read out of this deployment's cache had to be reproduced
exactly, which one changed character would fail. The worked example gained four
arrivals and one refusal, the refusal the more instructive: real post from a
company, carrying a price, still not a record because the refund it describes was
already made.

**And the deploy path nearly shipped a dev-pointing app.** `npm run build` on its
own bakes `VITE_CONVEX_URL` from `.env.local`, which is the dev deployment; only
the static-hosting CLI's build sets the production URL. Found by building both ways
and reading the host out of the output. The deployed bundle was then checked
directly, so the app on the judged URL is known to point at the judged backend. A
source comment that used a personal address as an example `From` header was caught
in the same pre-commit sweep and replaced with a generic form.

### 2026-09-17 - e8989fe

**Every problem statistic was re-derived from the source, and three were missing
their base.** The figures come from the Department for Business and Trade's Consumer
Detriment Survey 2024, carried in this log and the README from my own notes rather
than read out of the report. Read out of it they are still the government's numbers,
but against a narrower population than the sentence implied: 72% is of UK adults not
all consumers; 47% is of 18-to-29-year-olds who experienced detriment, not the age
band; and the refund figure is 15% of cases where a refund was requested, the
source's own wording. The argument did not change; it was resting on a base it had
not stated.

**A true claim can be made false by citing the right number from the wrong table.**
The claim that in 25% of incidents the seller did nothing reads 25% in two places.
In Figure 24 it is the bar labelled `None`, the share of incidents where the seller
took no action, which is what the sentence says. In Table 8 the same 25% is a
subgroup reporting a negative effect on mental health, nothing to do with the
seller. The citation is pinned to Figure 24, and the caveat corrected: the exclusion
the README had attached belongs to Figure 25's base, and the caveat the source makes
for Figure 24 is the opposite kind — the 25% "includes instances where consumers did
not act", so it counts incidents the seller never heard about.

**Two comparative sentences came out of the README, and the reason is not modesty.**
They were "Every other tool waits for you to describe a dispute" and "The paper trail
is the part nobody else keeps". A claim about someone else's product is the one claim
a judge can check without reading my code, a single counterexample makes it false,
and making it at all tells a judge I went through the other entrants. They are named
here rather than left as a pointer, because the commit that holds them is on the
public remote either way.

### 2026-09-17 - ff8a832

**An adversarial review was run against this entry with winning as its target, and
four of what it found were fatal.** Every finding was reproduced before anything
changed, and the four have one shape: a claim on a judged surface that the artefact
behind it did not support. What is new is that the entry's own argument made it
findable.

**The judged URL was serving the personal address this log said had been caught.**
`vite.config.ts` had `sourcemap: true`, and a Vite sourcemap carries
`sourcesContent`, the whole of `src/` as text, served from the same public root as
the app. It was built from the tree before the commit that removed the address, so
the log and the artefact disagreed. `sourcemap` is off now and no build ships a map;
the old asset is gone from the origin, though a CDN edge may serve a cached copy for
up to its TTL, so a redeploy is not a way to pull sensitive content.

**Three of the four worked-example claims showed a detection the code cannot make.**
`detect` reads a record and the counterparty's provisions and nothing else, so three
cases whose paper did not state the problem asserted a fact no message carried. Each
now carries the second arrival that states the condition — a damage report, a note
that a deposit is still held, a cancellation notice — so a visitor can follow the
claim back to the paper it came from.

**The two real emails were on two guest ledgers, reachable by nobody.** The
submission text and the video description said both could be checked on the ledger;
they cannot, because a guest is a fresh anonymous user and every read is scoped to
one. All surfaces now say where the emails are and why nobody else can read them,
and the scoping is the rule the product runs on rather than a gap: the review tried
to break it from a second guest session and could not.

**The 25% cited the wrong figure and carried the wrong caveat, corrected in the
statistics entry above.** Alongside these, a reply had never reached the claim it
belonged to and could not have (`letters.send` sent from the shared inbox with no
`replyTo`, so a reply came back to an address no `inboxes` row matched, and the
handler returned before checking the claim label); `policies.forCounterparty`
answered an unauthenticated caller with another user's provisions; and the claim
sheet had no worked-example label though every README link opens it. All fixed. The
review could not break the scoping, the approval gate, the webhook signature check
or the arithmetic, and those are where the findings were not.

### 2026-09-18 - d5f6684

**The landing page opened on a sign-in card, so the product's own argument was read
by nobody who did not click.** The tagline led with the mechanism, that the agent
gets its own email address; the inversion that is the product's whole argument — the
agent holds the paper, so the claim finds the user — was in paragraph three of the
README and nowhere on the first screen. A cold visitor is now signed in as a guest
from an effect on load, so the judged URL lands on the ledger: four labelled cases,
the recovered total, the arrivals list, and the visitor's own forward address.
Nothing about a per-user ledger required the click, which was the rationalisation to
let go of; it is the same anonymous session the button started, started on load. The
card survives behind a header action and after a deliberate sign-out, recorded per
tab in `sessionStorage` under `owed:left` so a sign-out shows the card rather than
looping. The first build of this claimed the card survived and it did not, because
`isAuthenticated` was checked before the flag; `leave()` now sets the flag and signs
out. Four documents carried the retired "opens on a sign-in card" instruction and
each is guarded so the sentence cannot return without the sweep failing
(`src/App.tsx`, `README.md`).

**The claim sheet now shows the paper a claim was found from.** A claim's timeline
opens "Found from the paper trail…", and the sheet under it had listed the
correspondence on the claim, a different set from the arrivals the claim was found
from. `claims.detail` returns `paper`, the inbound messages that became the record,
and the sheet prints the sender and subject above the clause. It is filtered in
memory rather than given an index, deliberately: the index count is a published
figure, so a new index would make four artefacts wrong to save one pass over one
person's messages.

### 2026-09-18 - f99edd9

**The agent had never been given an address on the judged deployment, and the letter
could never have left it.** Both were defects in `@agentmail/convex`. A Convex
component runs isolated from the app's environment and this one declares no env vars,
so `app.use(agentmail, { env: { AGENTMAIL_API_KEY } })` is refused with "Component
agentmail has no env var named AGENTMAIL_API_KEY", and every call it made came back
"AGENTMAIL_API_KEY is not set". And `createInbox` is an `internalAction`, which
Convex does not expose to the parent app, so the reference never resolved and the
component's inbox table held zero rows. Both are fixed in the app rather than the
component: `convex/agentmail.ts` makes the two provider calls itself with the
credential the app holds, and the component keeps the half that needs none —
verifying the webhook signature, deduplicating by event id, dispatching the callback.

**Measured on the judged deployment.** `inboxes.provision` for a real account
returned an `owed-…@agentmail.to` inbox the provider lists against the app's own
client id; the send endpoint answered 200 with a message id and the probe mail was
delivered. Not yet measured: `recordSent` has not run on production, because no real
claim has reached the approval gate — every claim on the deployment is the worked
example, refused before the wire by design.

### 2026-09-18 - 617b34d

**The crawler was reading the host the mail came from, not the company's site, and it
had cost two real claims.** The ingest prompt asks for the sender's domain, and that
was what the crawl was pointed at. Companies send from subdomains that publish
nothing: Spotify's price-change notice from `legal.spotify.com`, Ring's from
`mail.ring.com`, neither serving a sitemap or policy page, both marked `skipped`
while the terms sat on `spotify.com` and `ring.com`. Found by measuring the
deployment: two of the real forwards were textbook mid-contract price rises, the
exact shape the worked example is built from, so a shape mismatch was not the
explanation. `domains.ts` reduces a host to its registrable domain and
`readCounterparty` tries the company's own site first, and `upsertCounterparty` keys
a counterparty on that domain so one company is one row. Spotify then yielded 29
provisions from `spotify.com`, Ring 27 from `ring.com`.

**The record sheet said more than the data, three times, and the document picker read
the wrong pages.** The sheet told a record built from more than one message that "two
messages became one record", a narrative borrowed from the example; it said the agent
had read "this company's published terms" when the crawl picks documents by the shape
of their URL; and its `skipped` branch fell through to "nobody has looked". Each now
says what the status means, and the four crawl states have four branches. Behind that
the picker itself was choosing Evri's per-retailer returns guides over its terms page
(`/return-a-parcel/argos-returns` scores 24 to the terms page's 17 because it carries
both `return` and `returns`), reading Spotify's creator terms over its
`end-user-agreement` (`agreement` was not in the vocabulary), and cut off by an
8 MB body cap that returned a prefix of Spotify's 9.2 MB sitemap and picked Ireland's
agreement for a UK subscription. The scorer moved to a module with no Convex import
and is checked by a harness that imports the shipped code rather than a copy of it;
the body cap is 32 MB and a body that reaches it is refused rather than parsed as a
prefix; the sort compares score capped at the value of a document matching both
`terms` and `conditions`, then depth, then the uncapped score, so a real terms page
is not outscored by a sub-page that adds one topic word (`ecc4ef1`, `687c170`,
`f25b2f2`, `554ab91`, `fe79311`). Re-crawling the six companies the owner has mail
from is what proved it, on the deployment rather than in the source.

**And two smaller corrections in the same span.** The README banner added a settled
row and an owed row and called the sum recovered, where the app's ledger reads
`Recovered £349`; the settled row and total are now both £349, and the served copy
under `public/` is written from the source under `docs/brand/` so the two cannot
drift. And a schema comment on `inboxes.verifiedAt` described a value that would be
set once the round trip was proven, which nothing sets; the field stays with an
honest comment saying it is a placeholder (`50c2e3c`, `a05ff4b`).

### 2026-09-19 - 863629d

**The deployment passed the free plan's database I/O, and one query reading the whole
log was the cause.** Convex reported Database I/O at 2.41 GB against an included 1 GB,
2.39 GB of it reads, essentially all on 18 September. `claims.spend` was a public
reactive query doing `ctx.db.query("aiCache").collect()` over a 4.79 MB table (253 of
its rows are embedding responses of ~19 KB each, a 1024-float vector rendered as
text), and `App.tsx` subscribes to it in the ledger, so every write to the log re-ran
the query and every open session paid for the whole table. `spendTotals` is now one
row keyed on a scope string, written by `aiCache.put` in the same transaction as the
insert; `put` is the only writer, so no path adds a call without moving the total.
The bucket rule moved to `summarise` in `pricing.ts`, which has no Convex import, so
the check imports the shipped function rather than restating it.

**Proven on the deployment.** `rebuildTotals` returned exactly what the old query did
(336 calls, $0.046394); `verifyTotals` recounts independently and returns
`match: true`; `aiCache:selfTest` calls the real `put` with a reserved key, confirms
the totals moved by exactly one, and restores. The judged URL renders the figure from
that row. The schema now holds **ten tables and twenty indexes** rather than nine and
nineteen, and the README's schema row, the architecture footer and the submission
documents all say so; the opening entry keeps its nine, because that is what the
schema held at the commit it describes. Every other `.collect()` in `convex/` was
read: each on a request path reads through an index scoped to a person or company,
and `aiCache` was the only table read without a scope and the only one holding 19 KB
rows.

### 2026-09-19 - fab47cb

**The Sky miss is the third shape of one defect, and the reduction was never going to
reach it, so the reader is asked instead.** A real Sky notice states a broadband
price change on a contract with a term left to run, the shape that should produce a
claim, and it did not: Sky writes from `contact.sky`, whose registrable domain is
`contact.sky`, and Sky's terms are on `sky.com`, which no reduction of the sending
host reaches. The ingest prompt now also returns `siteDomain`, the company's own
website when the model can name it with confidence and null when it cannot; the value
is reduced and checked in code before it is trusted, written only when it differs from
the sender's domain, and tried first by the crawl. A counterparty written before the
reader could name a site gets one by hand through `repair.setSiteDomain`, after which
the existing `recrawl` and `redetect` do the rest (`convex/records.ts`,
`convex/domains.ts`, `convex/policies.ts`, `convex/repair.ts`).

**The detector's verdict was being discarded, which is the arrivals defect one table
over.** `detect` computed a reason on every exit and returned it to a scheduler that
threw it away, so a record with no claim could say only whether the terms had been
read, never what the detector made of them. The verdict is stored on the record now,
on all four exits, and the record sheet prints it above the crawl status. The README
described two real emails where there are nine; it now carries the nine, which six
produced no claim and why, the three price rises, and the honest position that no
claim has yet been found from real post on this deployment.

**Not measured.** This tree has not been redeployed, so the Sky row has not been
recrawled through its own site and no forward has been read with the new prompt. Both
typecheck configurations pass. The next entry should carry the recrawl's note and the
detector's sentence, whatever they say.

### 2026-09-19 - f749f2c

**The Sky re-crawl ran, and the honest outcome is better than a manufactured claim would have been.**
`repair:fixSky` pointed the `contact.sky` counterparty at `sky.com`, re-read the terms from there and
re-ran detection, all in one call so no row id had to be pasted by hand. The crawl note reads `Read 8 of 8
chosen documents from sky.com`, kept 38 provisions, and the detector returned no claim with the reason:
*"The record does not show that anything went wrong according to the company's provisions."* That is the
agent reading a real company's real terms end to end and then declining to overreach: a mid-contract price
rise on its own is a right to leave rather than a sum the company owes, and the worked example's
price-rise claim works only because its record states an early-termination charge to be released from,
which the real Sky notice does not. The detector was not nudged toward a claim, because a claim the record
cannot support is the exact overclaim this entry is built to avoid. The reason is stored on the record and
shown on its sheet, so a judge can read the agent's own judgement on a real company. Nine real forwards
have now been read on production and none has produced a claim, each for a reason about the paper rather
than the product, which is the detector working as designed.

### 2026-09-20 - 8c37364

**A depth pass over the interface, and the sentence that was hiding behind a button.**
Opened cold against the rest of the field, the ledger read flat: `--paper` was `#faf8f5` against
`--card` at `#ffffff`, so the cards had nothing to sit on and the shadows had no work to do.
Paper is now `#f2efe9` and the shadows are three layers rather than two, the wide one on a
negative spread so it never shows as a band. The body carries two radial washes, green from the
recovered colour top right and amber from the owed colour bottom left, plus one very slow drifting
wash at 2.5% that reads as daylight rather than as motion. The masthead, totals, address panel and
sections arrive on a 460ms stagger in the same language the rows already used. No layout, no copy
and no colour meaning changed, and every animation added here is switched off under
`prefers-reduced-motion`. The second change is a correction rather than decoration: auto-guest had
moved the sign-in card behind a header button, and the card was the only surface carrying the line
*"Your agent holds the paper trail, so the claim finds you."* A cold visitor therefore met three
figures before anything on screen said what the figures were of. That line now sits under the
wordmark, in the same words the document title uses, and hides below 620px where there is no room
for it (`src/index.css`, `src/App.tsx`).

### 2026-09-20 - 9972c04

**The landing decision, argued properly and then half reversed.** The live URL lands on the ledger
rather than on a page that sells it, and the defence of that has been that a judge should not have
to forward an email to find out what this does. That defence is sound for somebody arriving from a
listing that already told them what this is, and it is not sound for anybody else: a stranger who
opens this URL cold reads a currency figure before anything on the page says why a currency figure
should exist. Landing on the product is a judging decision, not a product decision, and the two had
been quietly conflated. The zero-click landing stays, because the reader it is aimed at is the one
this entry is judged by. What changes is that the page now carries the sentence the sales page would
have carried. A short band above the totals states the government figure this whole product is an
argument about, £71.2 billion of net consumer detriment with the 22% of problems where nobody
complained at all, both already sourced in the README to the Department for Business and Trade's
Consumer Detriment Survey 2024, and neither a claim about what this product recovers. Under it, when
the worked example is on the ledger, one line says why there is a working ledger here instead of a
sign-up form. It deliberately does not repeat the worked-example label: that belongs in the note
under the totals, next to the figures it qualifies, and saying it twice two hundred pixels apart
would read as nervous rather than careful. The band is set as a standfirst, not a hero, because a
marketing banner here would undo the thing the zero-click landing is for. The two figures it shows
are the two figures beat 1 of the video speaks, so the words and the screen now agree. Guards moved
with it: `src/App.tsx` is a required-strings file in the sweep for the first time, on the principle
that a figure carried by more than one file needs a guard in each (`src/App.tsx`, `src/index.css`,
`working/RECORDING-RUNSHEET.md`, `working/sweep-spec.json`).
