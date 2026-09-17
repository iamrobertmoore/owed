# Hackathon log

- **Project:** Owed
- **Event:** Convex All Gas Hackathon
- **What it does:** An agent that holds a person's paper trail, finds what they are owed against the counterparty's own published terms, and pursues it.
- **Live app:** https://fantastic-hamster-482.convex.site
- **Repo:** private
- **Frontend:** Convex static hosting
- **Convex deployment:** https://fantastic-hamster-482.convex.cloud
- **Components:** @agentmail/convex, @firecrawl/firecrawl-convex, @convex-dev/static-hosting
- **Convex features:** schema, tables, indexes, vector search, queries, mutations, actions, HTTP actions, crons, scheduled functions, realtime queries
- **Auth:** Convex Auth
- **AI models:** gpt-4o-mini, text-embedding-3-small
- **Started:** 2026-09-16T07:50:55Z
- **Last updated:** 2026-09-17T18:54:53Z

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

### 2026-09-16 - 4b1d8ee

A real account can now load the worked example, which makes the product
recordable as well as legible. A guest shares one address and has no inbound
routing, so the panel showing the agent's address could not be shown honestly
and a reply could not arrive at all. A real account has both, and had nothing
to look at until somebody forwarded an email and waited weeks.

The seed guard moved rather than disappeared. `seedForUser` no longer refuses a
user with an email, because seeding the content and deciding who may ask for it
are different questions, and holding both in one function is what made the
first one untestable without a session. `seedExample` stays guest-only, so it
remains the only path that runs without being asked and content still cannot
appear in a real ledger uninvited. `loadExample` is the deliberate path. Both
obey the rule that matters: the example lands only on an empty ledger, so it can
never sit beside a claim the owner did not create (`convex/example.ts`).

The totals block now names the example when the figures cover it. Those figures
are honest arithmetic over whatever is in the ledger, which is exactly why a
block reading "Recovered GBP 349" has to say when part of that is
reconstructed. A headline number is the easiest thing on the page to read as a
claim about the reader, and this product's argument is that nothing here
overclaims (`src/App.tsx`, `src/index.css`).

Verified with 60 assertions against the self-hosted backend: both guards, each
of the four slugs, the money, the stages, the timelines, and a control proving
the send guard fires on the demo branch rather than returning early for some
other reason. Two first-pass failures were the harness and not the code. A
Convex `first()` returns null rather than undefined, so an `=== undefined`
assertion was false whether or not a row existed and could never have passed.
An expected stage map was written in a different key order to the actual one,
so identical content compared unequal. Both are the same mistake in different
clothes, and it is the one this project keeps making: an assertion that cannot
fail for the reason it claims.

Rendering then checked what assertions cannot. The empty state, the invite and
the loaded ledger were built through the real components against fixtures and
looked at. The button was pressed and the ledger filled while the address stayed
the account's own, which is the property the recording depends on. The harness
touched no source file and was deleted afterwards.

### 2026-09-16 - 2cbc1db

Checked the AgentMail allowance against the live account rather than against the
pricing page, and the two did not agree. The page says the free plan allows
three inboxes. `GET /v0/organizations` returned `inbox_limit: 1` and
`daily_send_limit: 10`, and an attempt to create a second inbox was refused with
HTTP 403:

> This organization is not verified yet, so its limits are the pre-verification
> defaults. Ask the human for the verification code emailed at sign-up and call
> `POST /v0/agent/verify` with it. Verification raises these limits at no cost.

Both numbers are right and the difference is verification. That is worth more
than a corrected comment: the design assumes three addresses, and until the
account is verified it can hold one, which the shared inbox already is.
Verification is not only what lifts the send restriction, it is what grants the
allowance the rest of this was built on. Two comments in `convex/inboxes.ts` had
stated the three as though it were unconditional, and a number in a comment that
the provider's own API contradicts is worse than no number, so both now say
which applies when (`convex/inboxes.ts`).

The failure that mattered was the one past the last address. `createInbox`
throws, and that was reaching the owner as an error trace on the one screen a
judge is most likely to be looking at. It now returns a sentence naming the
cause. Convex does not promise to carry custom properties on an error across a
component boundary, so the message and the body are both read. An unrecognised
failure is reported as itself rather than assumed to be a limit: guessing the
cause of an unknown error would be the same mistake this log keeps recording, a
claim that cannot be false.

That last sentence was not true of the code until 17 September. The first
version tested for the 403 status alongside the code, and every 403 body carries
`"code": 403`, so a refused credential matched the limit branch as readily as a
spent allowance. The owner was told the addresses had run out when the real
fault was the key, which is the exact false statement the paragraph above
promises to avoid. It was found by measuring rather than reading: `POST
/v0/inboxes` with the deployment's key answers `missing_permission`, and that
body matches the old regex. The code now branches on the provider's stable code
alone, which is what AgentMail's own schema asks for ("Branch on this rather
than the message text"), and a refused credential gets its own sentence instead
of borrowing the capacity one.

Checked that the component throws before writing the catch rather than after.
`agentmailFetch` raises `AgentMailApiError` on any non-2xx
(`node_modules/@agentmail/convex/dist/component/utils.js`), and 403 is absent
from that file's `PERMANENT_STATUSES`, so the provider's limit refusal is
treated as retryable by the component and still arrives here as a throw.

`README.md` now states the ceiling out loud: one of the three inboxes is the
shared guest address, so two accounts can hold one of their own.

### 2026-09-16 - ef53087

The AgentMail account is verified, which unblocks the half of the product that
could not previously run at all. Before verification the account held exactly one
inbox and the shared inbox already occupied it, so `inboxes.provision` would
have failed for the first real account to sign in. Read from
`GET /v0/organizations` either side of the verify call: `inbox_limit` went 1 to
3, `daily_send_limit` 10 to 100, and `agent_verified` false to true.

Verifying also revealed three fields that were absent from the response before:

```
first_hour_recipient_limit: 5
first_day_recipient_limit:  20
first_week_recipient_limit: 50
```

That is a deliverability warm-up ramp. A new sending domain is not trusted, so
recipients are capped at 5 in the first hour, 20 in the first day and 50 in the
first week, before settling at 100 a day. Nothing here sends to that many
addresses, so it is a constraint worth knowing rather than one to design around.

**The real-account path was proved without spending anything.** A second inbox was
created, which took `inbox_count` from 1 to 2 of 3, and then deleted, which
returned it to 1 of 3. The allowance is real and the slot is reclaimable, and the
account is back to holding only the shared inbox.

**A wrong diagnosis, recorded because the reasoning is the reusable part.** For
most of an afternoon I treated the missing verification code as a delivery
failure. It was not. The code carried a **24-hour** expiry, so the second sign-up
five hours later did not trigger the documented "resend the OTP if expired", which
is exactly why the organisation's `updated_at` never moved. Every measurement I
took was correct. The conclusion I drew from them was wrong, and I stated it with
more confidence than the evidence carried.

The question that would have caught it is one I never asked: how long ago was the
code sent? The answer was in the email, not in the API. An absent OTP in an API is
not evidence about an email, and I let a pile of consistent measurements stand in
for the one I had not taken.

### 2026-09-16 - ab256f5
**A guest's address now works.** Until today a guest was shown the shared address
and told, in the panel and in the README, that mail sent to it was deliberately
dropped. That was an honest description of a product that could not attribute one
shared address to one of many visitors, and it left the front door openable but not
usable: the loop the whole thesis rests on could not be run by the person most
likely to arrive, who is the one who presses the guest button. The sign-in screen
had been promising "its own ledger, its own address, its own claims" the whole
time, so the copy and the product disagreed, and the copy was the aspirational one.

**The measurement that made it fixable.** The provider delivers a plus-addressed
message to the shared inbox while keeping the tag in the envelope. Sent from a
second inbox to a plus address on the shared inbox, the message arrived in
the shared inbox carrying `inbox_id` set to the shared inbox and `to` set to the
tagged address. Both fields, in one object, read off the live
API. `onMessageReceived` already reads `to` first and looks it up in `inboxes`, so
the whole change is one row per guest. **The inbound router is not modified**, and
that is the reason to believe it works: the code that routes mail is code that
already routes mail.

Two earlier attempts had suggested the opposite and both were weak tests. Sending
from the inbox to its own plus address produced only an outbound record, because
mail systems treat self-delivery specially. The documentation never mentions
plus-addressing at all. A negative result from a test that cannot work is not
evidence, and I had been treating it as if it were.

**What it removes.** Nothing is provisioned for a guest, so the three-inbox
allowance stops being a cap on how many people can use this. The ceiling still
binds at the third real account, which is now a smaller claim than it was: the
default visitor no longer touches it. The alias token is random rather than derived
from the user id, because the address is the only thing deciding whose ledger an
arriving message lands in, and it is handed to the guest to give out.

`mine` now reads the row instead of branching on whether the user has an email,
which removes the second place that had to know what a guest is. `store` patches
rather than assuming there is no row, because `onMessageReceived` reads `by_user`
with `.unique()` and a second row for one person would throw rather than misbehave
quietly.

**Verified twice, differently.** Fifteen assertions on the local backend, and the
one that matters is a control: a message addressed to one guest's alias left the
other guest's ledger empty, through the same code path and the same payload. An
unknown alias and the bare shared address both route nowhere. A provisioned inbox
still routes, so the real-account path did not regress. Then the ledger was
rendered through the real components with the real seeded rows, because a guest's
address is now 28 characters where it was 16, and a wider string in a fixed panel
is exactly the kind of thing assertions do not catch. It fits on one line, with no
horizontal overflow.

**Two limits of the local environment, stated rather than implied.** The
self-hosted deployment has no auth signing keys, so the guest button could not be
pressed against it and the render used fixtures for the Convex layer rather than
the live backend. And those keys cannot be generated here at all: the sandbox
terminates any attempt to read private key material as text, by node or by `cat`,
while `openssl` runs. So deployment step 7, `npx @convex-dev/auth`, is unverified by
me and has to be run on a machine that is not sandboxed.

### 2026-09-17 - 646a4b3

**The app is live at the URL in the header, and getting it there found a bug that
a status code could not.** The build uploaded cleanly, all seven variables were
set on the production deployment, and every path still answered `404`. The body
was the whole diagnosis: `No matching routes found` is Convex's own router
speaking, not the file server, so the files were present and nothing was routing
to them. `convex.config.ts` mounts static hosting **without** an `httpPrefix`,
which puts the app in charge of HTTP and makes `registerStaticRoutes(http,
components.staticHosting)` the thing that actually serves the site. It had never
been called. The package's own docstring, its changelog and its INTEGRATION.md all
name this exact case, and none of them were read before the deploy rather than
after. `convex/http.ts` now calls it, with the reason recorded above the call.

It is safe next to the two routes that cannot move. The component's catch-all is
`GET` only, so the AgentMail webhook's `POST` cannot collide with it, and exact
app routes take precedence over a prefix route. The other option, letting the
component own the root, would have displaced `/agentmail/webhook`, which is
registered with the provider as the delivery URL, and Convex Auth's endpoints,
`/.well-known/jwks.json` among them, which are expected at the origin.

**A credential's scope is set by the route that creates it, and that cost an
afternoon.** AgentMail issues three kinds of key from three routes, and the key
this project had been given came from the inbox route, so it authenticated
perfectly and was entitled to nothing. `auth me` reports the difference in a field
(`scope_type`), which is the only place it is stated; every other call fails with a
permission name rather than a scope error, and the permission named differs by
endpoint. The replacement is organization-scoped, which is what a deployment needs,
because one key has to cover creating an address, sending, and reading.

**The webhook is verified by moving it from 500 to 401.** A registered endpoint
that returns 500 and one that returns `invalid signature` are very different
things: the first is a route that is not there, the second is the signature check
running and refusing. Set the secret on the deployment and the route answers the
second, which is the evidence that the inbound path is wired.

**The README now points at the live ledger**, and the four worked-example links use
stable slugs rather than row ids. A Convex id belongs to whoever created the row,
so a link built from one is dead for every other visitor, which is every judge. A
slug resolves against the caller's own seeded copy. The README also gained the
sentence it had been missing: a signed-out visitor hits the sign-in screen before
the ledger, so the deep links are described as the way in once you are in, rather
than as the way in.

**The inbound path is proven from an outside domain, which was the last unproven
link.** A forwarded mail sent from an unrelated personal mail account to a guest's
alias arrived, was verified by the component, was routed by the alias onto that
guest's ledger and nobody else's, and was read four seconds later by
`ingest-paper-trail` on `gpt-4o-mini` for 2,088 input tokens and 92 out. Read off
the deployment rather than off the screen: one row in `messages` carrying the alias
as its `to` address and the guest's own inbox row, and one row in `aiCache`
carrying the verdict. The reader declined it, correctly and in a sentence, because
the mail was a refund confirmation and that is the "already resolved and refunded"
case its own instructions exclude. **The sending address is irrelevant, because
routing is by the recipient and nothing in `onMessageReceived` reads the sender.**
A guest alias spends no slot, so this is also the first evidence that the
three-inbox allowance is not a ceiling on how many people can use the product.

**One gap the test found, recorded rather than fixed.** The front end reads
claims, records, spend and the address, and reads the `messages` table nowhere, so
a message that arrives and is declined leaves no trace the owner can see.
`ingestFromMessage` computes a reason and returns it to a scheduler that discards
it. A judge who forwards something therefore cannot tell "read and declined" from
"never arrived", and those two want opposite responses. A product whose argument is
that it holds the paper trail should be able to show the paper it decided not to
keep.

### 2026-09-17 - fb1b206

**The terms reader could not read a real retailer's terms, and the cause was a cap
rather than a filter.** A forwarded order confirmation produced a record and a
counterparty, and the counterparty's crawl note read `Mapped 199 URLs, none looked
like terms.` The mapper had returned 199 URLs against a limit of 200 and not one of
them scored, while the same site's sitemap listed `returns-policy`,
`terms-and-conditions` and `warranty` on its first page. `returns-policy` scores 24
against the vocabulary, so the candidate filter was never the problem: a shop has
thousands of product URLs and the handful of documents a claim is argued from sit
past the cap. That is the defect class this log keeps recording. A capped scan
produces no error, no gap and no implausible number, only a smaller field that looks
exactly like the field.

**The fix is the site's own sitemap**, which is complete, costs no crawl credit, and
is the site telling us where its pages are rather than us guessing. Four further
defects were found by measuring, and three of them were introduced by the fix for
the one before.

A sitemap is XML, so a URL containing an ampersand arrives escaped. Every
help-centre URL on one retailer came back as `refunds-&amp;-returns`, and handing
that to a scraper asks for a path that does not exist. Entities are now decoded in a
single pass, so `&amp;lt;` cannot cascade into `<`.

The first version of the sitemap reader capped how many URLs it would gather. A
single child sitemap of products exhausted that cap before a later child holding the
terms pages was read, and it returned four thousand URLs and selected none, which is
the mapper's failure reintroduced inside the fix for it. Filtering with the scorer at
read time means the budget can only be spent on pages that were not wanted anyway.

The walk is breadth-first with a depth cap rather than one hop. A sitemap tree is not
always one level deep: one retailer's robots.txt points at a sitemap whose children
live on a different host again, and treating the second level as page URLs finds
nothing. Sitemaps a site declares in robots.txt are tried before any guessed path,
and the guesses are skipped once a declared one works, because otherwise the same
file is fetched twice under two hostnames. Gzipped child sitemaps are dropped at the
queue rather than at the fetch, because a plain text request returns binary for them:
ten of twenty requests went on gzipped product files before the site's own support
sitemap was reached, and the support sitemap is where the returns content lived.

The scorer gained a depth prior, found by measuring rather than reasoning. Before it,
a loyalty scheme's terms page and a group-rides terms page both outranked the
warranty, so a claim about a faulty product would have been argued from the terms of
a rewards programme.

**Verified by running the real source.** The harness extracts the crawler out of
`convex/policies.ts` rather than copying it, and refuses to run unless the extracted
text carries every marker of the current version. A hand-copied harness is a second
implementation, and it can pass while the file that deploys fails. Four of six live
retailers now return the right documents where two returned none. The remaining two
answer 403 to the sitemap request itself, one of them behind a bot challenge, which is
the case the mapper fallback exists for rather than a defect to fix.

### 2026-09-17 - 0fdd3c7

**The gap the inbound test found is closed.** The front end read claims, records,
spend and the address, and read the `messages` table nowhere, so a message that
arrived and was declined left no trace and could not be told from a delivery that
never came. There is now an arrivals list on the ledger: the sender, when it arrived,
the claim it became if it became one, a chip reading either `became a record` or
`not kept`, and the reader's own reason underneath, kept in its own words rather than
summarised. It is scoped to the caller like every other read, and it is inbound paper
only. `inboxes` writes a `claimId` when a message is a reply to a letter the agent
sent, and only post arriving without one is handed to the reader, so replies stay on
the claim they belong to rather than being given a decision they were never given.

**The decision was never lost, only unlinked.** Every model call is cached by a hash
of its exact prompt, so the reply was still in `aiCache`; what was missing was the
field on the message. `ingestFromMessage` computed a reason and returned it to a
scheduler that discarded it, so three fields were added to `messages` and written on
all three exits, including the branch where the reader's reply was not JSON. Messages
that predate the field are backfilled by recomputing the same hash from the same
prompt. The reader's instructions moved out of the action into a module constant,
because the cache key is a hash of that text and two copies of a prompt that must
stay byte-identical is a bug waiting to happen.

**The backfill was checked before it was written, not after.** Two keys were read out
of this deployment's own cache and the extraction had to reproduce both, which it
does. That check is capable of failing for the reason claimed: one character
different in the prompt and it matches nothing, which would have been
indistinguishable from there being no decision to recover. It recovered two real
messages, one kept and one declined. A message whose call is not in the cache is left
untouched rather than marked declined, because "we did not record a decision" and
"the agent decided no" are different facts, and only one of them is interesting.

**The worked example now demonstrates the surface**, with four arrivals and one
refusal. Each carries a `demoKey` on the message for the same reason `claims` does,
because a reconstructed message that was turned down looks exactly like a real one
that was, and only one of those is evidence. The refusal is the more instructive of
the two: it is real post from a company, it carries a price, and it is still not a
record, because the refund it describes has already been made.

**Verified in a browser against the deployed app**, not from the build. The five
seeded rows render with both chips and their reasons, the four kept rows open the
right claim, and the declined row is not clickable because there is nowhere for it to
go. Rendering caught a defect the typecheck could not, where a wrapped reason slid
back under its own label and lost the left edge of the paragraph.

**And the deploy path nearly shipped a dev-pointing app.** `npm run build` on its own
bakes `VITE_CONVEX_URL` from `.env.local` into the bundle, and that value is the dev
deployment. Only the static-hosting CLI's build sets the production URL. Found by
building both ways and reading the host out of the output rather than by reading the
docs, and the two builds differ in hash from identical source, which is the tell. The
deployed bundle was then checked directly, so the app on the judged URL is known to
point at the judged backend.

**A source comment nearly published a personal address.** The sweep for real-world
identifiers before committing caught the owner's own mail address, used as an example
of a raw `From` header in `src/App.tsx`, in a file that becomes public. Replaced with
a generic form.

### 2026-09-17 - e8989fe

**Every problem statistic was re-derived from the source, and three were missing
their base.** The figures come from the Department for Business and Trade's Consumer
Detriment Survey 2024, and they had been carried in this log and the README from my
own notes rather than read out of the report. Read out of the report they are still
the government's numbers, but three of them are measured against a narrower
population than the sentence implied. 72% is of UK adults, not of all consumers. 47%
is of 18 to 29 year olds who experienced detriment, not of the age band, and that
band is the one whose inaction is the reason this product exists, so the base matters
more there than anywhere else in the list. And the refund figure is 15% of cases
where a refund was requested, not 15% of refund requests, which is the source's own
wording and is now the README's. The argument did not change; it was resting on a
base it had not stated.

**A true claim can be made false by citing the right number from the wrong table.**
The claim that in 25% of incidents the seller did nothing at all reads 25% in two
places in the survey. In Figure 24 it is the bar labelled `None`, the share of
incidents where the seller took no action, and that is what the sentence says. In
Table 8 the same 25% is the share of one subgroup reporting a negative effect on
their mental health, which has nothing to do with the seller. Both numbers are real
and only one supports the sentence, so the citation is pinned to Figure 24.

The figure number and the caveat were both wrong until 17 September. The bar is
Figure 24, "Actions taken by sellers after detriment experience", and Figure 25
carries no 25% bar at all. The exclusion the README attached to it, "setting aside
those where an apology or an explanation was the whole of the response", belongs to
Figure 25's own base rather than to this number. The caveat the source makes for
Figure 24 is the opposite kind of qualification: the 25% "includes instances where
consumers did not act on their detriment experience", so it counts incidents the
seller never heard about. Dropping it made a narrower claim look stronger, and put
it directly above the 22% bullet the source says is partly the same set of incidents.

**Two comparative sentences came out of the README, and the reason is not modesty.**
They were "Every other tool waits for you to describe a dispute" and "The paper trail
is the part nobody else keeps". Both claimed what other products do. They are named
here rather than left as a pointer, because pointing at them without quoting them
sends a reader to the commit that holds them, and that commit is on the public remote
either way. A claim about someone else's product is the one claim a judge can check
without reading my code, a single counterexample makes it false, and making it at all
tells a judge I went through the other entrants. The replacements say what Owed does
instead: it holds the paper trail, so it notices a claim rather than waiting to be
told about one. The same claim in the submission form came out in the same pass.

**The statistics were checked before the review rather than by it.** An adversarial
review is about to run against this entry with winning as its target, and it should
spend its budget on things I cannot see rather than on figures I can check in an
afternoon. Every claim in the problem section now traces to a page of the report,
and the brief says which page and invites the reviewer to try to falsify the
tracing.


### 2026-09-17 - 42b1fb4

**An adversarial review was run against this entry with winning as its target, and four of what it
found were fatal.** Every finding was reproduced before anything was changed, and the four have one
shape between them: a claim on a judged surface that the artefact behind it did not support. This log
has recorded that failure before in other costumes. What is new is that the entry's own argument made
it findable.

**The judged URL was serving the personal address this log said had been caught.** `vite.config.ts`
had `sourcemap: true`, and a Vite sourcemap carries `sourcesContent`, which is the whole of `src/` as
text. Static hosting serves it from the same public root as the app, so the map was not a debugging
aid that happened to be reachable. It was the source, published, at a path guessable from the bundle's
own name. It had been built from the tree before the commit that removed a personal address from
`src/App.tsx`, and the entry for 0fdd3c7 records that removal as a sweep working. Both statements were
true and the artefact disagreed with the log, which is the same defect as a stale figure: one surface
current, another judged, and the judged one wrong. Reproduced by curl, which returned the address out
of a 1.3 MB map at HTTP 200. `sourcemap` is off, the build ships no map, and the deploy that published
this entry cleaned the old asset off the deployment. The same curl answers 404 now.

**Three of the four worked-example claims showed a detection the code cannot make.** `detect` reads a
record and the counterparty's provisions and nothing else, and it is instructed not to invent a fact.
Three cases had no arrival stating the condition, so the record asserted something no message carried,
and the timeline then answered "how did it know?" in the agent's own words over a ledger that never
said it. Each case now carries the second arrival that states the problem, in the shape that post
actually takes: a damage report on the order, a note that the deposit is still held, a cancellation
notice. The fourth keeps none because its first arrival already carries the condition. A visitor
reading the arrival and then the sheet can follow the claim back to the paper it came from, which is
the one thing the worked example exists to show.

**The two real emails were on two ledgers and reachable by nobody.** The submission text, the video
description and the correction box in my own notes all said both decisions could be checked on the
ledger. They cannot. Both were forwarded to guest aliases, and a guest is a fresh anonymous user
on each press, so every read is scoped to a user no judge can become. Measured rather than assumed: a
new guest's `messages:list` returned five rows and all five were the worked example, and the two real
messages sit under two different user ids, one holding the bike shop's order marked kept and the other
the booking platform's refund marked declined. All three surfaces now say where the two emails are and
why nobody else can read them, and the README gained the paragraph it was missing. The scoping is not
a gap to apologise for. It is the rule the product runs on, and the review tried to break it from a
second guest session and could not.

**The 25% cited the wrong figure and carried the wrong caveat, and that was this log's own doing.** The
claim that in 25% of incidents the seller did nothing reads 25% in two places in the survey, and the
pass recorded above pinned it to Figure 25. It is Figure 24. Worse than the wrong number was the
caveat. The exclusion attached to it, "setting aside those where an apology or an explanation was the
whole of the response", belongs to Figure 25's base, and the caveat the source actually makes for
Figure 24 is the opposite kind: the figure "includes instances where consumers did not act on their
detriment experience". The sentence dropped the qualification that mattered and borrowed one that did
not apply, which made a narrower claim read stronger and put it directly above the 22% bullet the
source says is partly the same set of incidents. My own notes had it right and the correction
pass replaced it with the wrong one. Both surfaces carry the source's own caveat now, and the entry
above says what it got wrong rather than being quietly rewritten.

**A reply had never reached the claim it belonged to, and could not have.** `letters.send` sent from
the shared inbox with no `replyTo`, so a counterparty's reply came back to the bare shared address.
`onMessageReceived` looked that address up in `inboxes`, found no row, and returned before it checked
the `claim-<id>` label the letter had carried out. Every reply this product was ever sent was dropped,
silently. That is why the inbound half looked proven for as long as it did: the inbound half is the
half that worked, and the outbound half had never had an answer to route. The label is resolved before
giving up now, `replyTo` is set so the ordinary address path works too, and the label is a safety net
rather than the only route home.

**A public query answered a caller with no identity.** `policies:forCounterparty` took a
`counterpartyId` and returned that company's provisions with no auth check, and nothing called it.
Called without a token it returned another user's provisions, which falsifies the sentence in the
submission that every read re-checks the caller. It is internal now, and the public path answers a
server error rather than data. Two smaller reads went the same way. The raw `To` field was cast with
`String()`, so a forward carrying two recipients produced a string that matched no inbox and was
dropped silently. And `records.list` returned an empty array for a signed-out caller where every other
read returns null. An empty array is not a neutral default: it tells a client that has not said who it
is that this person has no records.

**A judge could reach the claim sheet without passing the note that says what it is.** Every README
link opens the sheet directly, and the sheet never read `demoKey`, so the one screen a visitor lands on
had no worked-example label while the ledger behind it had four. One chip next to the stage pill. The
same pass found the reverse error: provenance was computed over the claims alone, so a real account
that loaded the example was told its figures were the worked example and its real order was labelled
as the example. Labelling from one surface and asserting it over three is the same mistake in both
directions.

**Three log fields disagreed with the repository, and two sentences pointed at themselves.** `Started`
was the date the working tree was made rather than the first commit, the first entry was labelled
`working tree` for work that was committed, and one entry was headed `verified`, which is not a commit.
They are real commits now, and `Components` no longer lists `@convex-dev/auth`, which is an auth
provider rather than a component this app mounts. Separately, two comparative sentences about other
products had come out of the README in the statistics pass, and this log pointed at them without
quoting them. A pointer sends a reader to the commit that holds them, and that commit is on the public
remote either way, so they are named above now with why they were wrong. A claim about somebody else's
product is the one claim a judge can check without reading this code, and a single counterexample
makes it false.

**What is still outstanding, and it is not all mine to do.** The demo state needs one real
problem-bearing forward from a second address, so the recording has an unlabelled row beside the
example, and the two real emails need forwarding once more to the account the video is recorded on so
that one screen holds both. The script now says which case is the worked example and which is live,
because the review found that its reply beat promised a received reply that cannot exist in a session:
the demo counterparty publishes no terms, so it cannot produce a claim for the agent to write to, and
a real reply takes weeks. The four fatal findings were all in the seam between what the product does
and what the entry said about it. The review could not break the scoping, the approval gate, the
webhook signature check or the arithmetic, and those are where the findings were not.

### 2026-09-17 - ecc4ef1

**The provenance fix had the same defect in the other direction, and the count is where it showed.**
`a5fe331` moved the paper-trail count onto the records and then branched two ways: all example, or
"all from real mail". A ledger holding the example and real paper at once took the second branch, so
four example rows carrying their chips sat under a line calling them all real mail. That is the item-5
error mirrored, and it is the state the recording session is in, because the example gets loaded beside
a real forward. There are three states now, and a count of zero gets no suffix at all, because "0
records, all from real mail" is a sentence about nothing.

**It was found by reading the replacement back, not by the review.** The review named the claims-only
count. The two-way branch underneath the replacement was mine, and it would have shipped. This log has
the rule already: a fix is a claim, and it gets the same reading as the thing it replaced. Reading the
rendered branch is what caught it, and that is the method that has worked every time here.
