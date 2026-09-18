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
- **Last updated:** 2026-09-18T19:32:45Z

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

Verified on the self-hosted backend, covering both guards, the
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

Verified against the self-hosted backend, covering both guards, each
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

**Verified twice, differently.** On the local backend, and the
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


### 2026-09-17 - ff8a832

**An adversarial review was run against this entry with winning as its target,
and four of what it found were fatal.** Every finding was reproduced before
anything changed, and the four have one shape: a claim on a judged surface that
the artefact behind it did not support. What is new is that the entry's own
argument made it findable.

**The judged URL was serving the personal address this log said had been
caught.** `vite.config.ts` had `sourcemap: true`, and a Vite sourcemap carries
`sourcesContent`, which is the whole of `src/` as text, served from the same
public root as the app. It was built from the tree before the commit that
removed the address, so the log and the artefact disagreed. `sourcemap` is off
and no build ships a map. The old asset is gone from the **origin**; any CDN
edge that cached it may still serve it, for up to a year, because nothing purges
an edge and a redeploy does not ask one to. The map itself was never cached,
which is why the address was never exposed (`42b1fb4`).

**Three of the four worked-example claims showed a detection the code cannot
make.** `detect` reads a record and the counterparty's provisions and nothing
else, and is told not to invent a fact, so three cases asserted something no
message carried and the timeline then answered "how did it know?" over a ledger
that never said it. Each now carries the second arrival that states the problem
in the shape post takes, and the fourth keeps none because its first arrival
already carries the condition.

**The two real emails were on two ledgers and reachable by nobody.** Three
surfaces said both decisions could be checked on the ledger. They cannot: both
went to guest aliases, and a guest is a fresh anonymous user on each press.
Measured, not assumed: a new guest's arrivals list returned five rows, all of
them the worked example. Those surfaces now say where the emails are and why
nobody else can read them. That scoping is the rule the product runs on, and the
review tried to break it from a second guest session and could not.

**The 25% cited the wrong figure and carried the wrong caveat, and that was this
log's own doing.** It is Figure 24, not Figure 25, and the exclusion attached to
it belongs to Figure 25's base. The caveat the source makes for Figure 24 is the
opposite kind, that the figure includes incidents the consumer never raised, so
dropping it made a narrower claim read stronger. Both surfaces carry the
source's caveat now.

**Five smaller findings, each fixed rather than argued.** `letters.send` set no
`replyTo`, so every reply this product was ever sent came back to the bare
shared address and was dropped before the letter's own `claim-<id>` label was
checked; the label resolves first now. `policies:forCounterparty` returned
another user's provisions with no auth check and is internal now. A raw `To`
field cast with `String()` made a two-recipient forward match no inbox.
`records.list` returned an empty array for a signed-out caller where every other
read returns null. And the claim sheet never read `demoKey`, so the one screen
every README link opens carried no worked-example label. Three log fields
disagreed with the repository and are real commits now, and two comparative
sentences about other products are named here rather than pointed at, because a
pointer sends a reader to a commit that is public either way.

**The fix for one finding had the same defect in the other direction, and the
second pass found it.** `records.demoKey` did not exist before the provenance
work and the seed is idempotent, so every ledger seeded earlier kept records
with no marker, and a count from the field alone announced "all from real mail"
over fictional `.example` orders, including this session's own recording ledger.
Reproduced on the deployment first: 33 of 69 records carry no `demoKey`, and 32
of those 33 are linked to a claim that does. `records.list` derives provenance
from the record **or** the linked claim now, so no ledger needs a backfill
(`a4b5902`).

**A consistency sweep found the survivors nobody had listed, twice.** Its scope
read `git ls-files`, so the notes directory was never read and four stale
sentences survived in documents that ship. Widening scope from eleven files to
fifty-two found five more, including the index count in the shipped architecture
diagram, which had been in the sweep's file list the whole time and passed.
**The file list decides which files are read; only the string list decides what
is found in them**, so adding a file to scope without adding its string changes
nothing (`ecc4ef1`, `687c170`, `f25b2f2`).

**What the review could not break.** The scoping, the approval gate, the webhook
signature check and the arithmetic all held under a second session. The four
fatal findings were all in the seam between what the product does and what the
entry said about it.

### 2026-09-18 - 36f610d

**The claim sheet could not show the document the claim was found from, so the
detection event was asking a question the screen did not answer.** A claim's
timeline opens with "Found from the paper trail: a price rise notice arrived on
a contract that has not expired", and the sheet under it listed the
correspondence on the claim, which is a different set of messages from the
arrivals the claim was found from. The two were being conflated on one screen,
and that screen is the one every README link opens.

`claims.detail` now returns `paper`: the inbound messages that became the claim's
record, walked off `claim.recordId` the way `messages.list` already walks it to
answer "did this arrival become anything". The sheet prints the sender and the
subject of each above the clause, and states what the block is evidence of, that
the agent read this and nothing else about what happened and did not need to be
told there was a dispute. That sentence is the product's whole argument, and it
was the one claim on the sheet with nothing behind it.

**It is filtered in memory rather than given an index, and that is deliberate.**
The schema's index count is a published figure in the README, the architecture
diagram and the submission, so a new index would make four artefacts wrong to
save one pass over one person's own messages. The set is bounded by a single
paper trail.

`senderOf` moved from `App.tsx` to `format.ts` in the same change. Two surfaces
print a sender now, and two copies of that rule would be two answers to "who sent
this" the moment one of them changed. Checked on the deployment rather than
locally: a fresh guest session seeds eight arrivals, and the worked example's
price-rise claim renders the block with the sender and the notice's subject
above the clause (`convex/claims.ts`, `src/ClaimSheet.tsx`, `src/format.ts`).

### 2026-09-18 - d5f6684

**Three commits. The first two were not written down when they landed, and the
third changed what a judge sees before reading anything.**

`012a869` rewrote the landing tagline. It had led with the mechanism, that the
agent gets its own email address. The inversion, that the agent holds the paper so
the claim finds the user, is the product's whole argument, and it was in paragraph
three of the README and nowhere on the landing page. It is the first sentence now,
because the first sentence is the only one a visitor who does not click will read.

`c6e2698` gave the last unsourced number in the statistics section a source. The
sentence sitting under six properly cited figures said the amount was usually £40
and named no source, and the survey contains no £40 anywhere: its medians are £32
per incident overall, £41 for services and £15 for items. It carries the survey's
own median and its own framing now. Every figure in that section has since been
checked back against the primary source, and `d5f6684` added the seventh: the
median value of the product was £60 where no action was taken against £100 where
it was, read from Table 10 rather than off a chart.

**The tagline was the right sentence on the wrong screen, and that is `d5f6684`.**
The landing page opened on a sign-in card, so the product's own argument was read
by nobody who did not click. A cold visitor is now signed in as a guest from an
effect on load, so the judged URL lands on the ledger: four labelled cases, the
recovered total, the arrivals list, and the visitor's own forward address.

**Nothing about a per-visitor ledger required the click, and that was the
rationalisation to let go of.** It is the same
anonymous session the button started, started on load. The ledger stays per-user,
seeded per-user and scoped. The card survives behind a header action and after a
deliberate sign-out, recorded per tab in `sessionStorage` under `owed:left`, so a
sign-out shows the card rather than looping back into a new guest session. The
card's sub-line changed with it, because it had been selling a click that no
longer exists.

**Four surfaces carried the retired instruction and every one was false
afterwards:** the README, `DEPLOY.md`, `YOUTUBE.md` and `SUBMISSION.md`. All four
say the ledger opens on arrival, and all four are guarded so the sentence cannot
come back without the sweep failing. Two more sat inside a verification table in
the deployment notes, and those are marked superseded rather than quietly
rewritten.

**Checked in a browser rather than from the source, because the claim is about
what a cold visitor sees.** A fresh context loading the root renders the ledger
and not the card, with a guest alias provisioned on arrival. A fresh context
loading `#claim=demo-gate` renders the ledger **and opens the sheet**: clause 11.3
quoted by its own reference, the block naming the paper it was found from, the
drafted letter and the approval gate. That path used to stop at the sign-in
screen, which is the reason the README's four links are worth reading again. The
served bundle carries the new landing sentence and the new card sub-line, and the
retired tagline is absent from it (`src/App.tsx`, `src/index.css`, `README.md`).

### 2026-09-18 - 7d12547

**The entry above claimed the card survives behind a header action, and in the build it
described it did not.** Clicking "Create an account" on the deployed URL did nothing at
all. `isAuthenticated` is checked before `left` when this app picks a screen, so the
guest session the change had just started on load won the render and the card was never
reached. Setting the flag changes nothing while the session is live, and clearing the
session is what makes the card reachable in the first place.

`leave()` now sets the flag and signs out, and both header actions call it. The labels
differ because the visitor does: a guest is creating an account, and an account holder
is signing out of one.

**Found by clicking the button rather than by reading the code.** That is the same
instrument the gate change was verified with, and it was pointed at the first screen and
not at the second. **Three documents already said the card was behind a header action
and all three were wrong when they were written**, including the one that tells the
operator to press it before recording. The sweep now requires `void signOut();` in
`src/App.tsx`, so the sign-out cannot come out of `leave` without a check failing.

**Checked on the deployment, all four states:** a cold load renders the ledger; the
header action shows the card; the card's guest button returns to a seeded ledger with
four claims and its own address; and a reload with the flag set shows the card rather
than minting a new guest. Served bundle `index-DGyWe2Zm.js`, 326,484 bytes
(`src/App.tsx`).

### 2026-09-18 - f99edd9

**The agent had never been given an address on the judged deployment, and the letter could never have left
it.** Both were defects in `@agentmail/convex`, and both were measured rather than reasoned about.

The first is at the environment boundary. A Convex component runs isolated from the app's environment, and
this one declares no environment variables of its own, so there is no way to hand it the credential:
pushing `app.use(agentmail, { env: { AGENTMAIL_API_KEY } })` is refused with "Component agentmail has no
env var named AGENTMAIL_API_KEY". Every call it made to the provider came back "AGENTMAIL_API_KEY is not
set on this Convex deployment". A send enqueued through the component's own public mutation came back
`status: "failed"` with that message, which is how the send path turned out to be dead rather than merely
untested.

The second is at the function boundary. `createInbox` is an `internalAction`, and Convex exposes only a
component's public functions to the parent app, so the reference never resolves. **The component's cached
inbox table on production held zero rows**, which is what that looks like from outside: no real account had
ever been given an address. The panel said "Could not create an address. Couldn't resolve
agentmail.lib.createInbox", and every document that described the real-account path as proven was
describing a path that had never run.

**Both are fixed in the app, not in the component.** `convex/agentmail.ts` makes the two calls itself with
the credential the app does hold. The component keeps the half that needs none: verifying the webhook
signature, deduplicating by event id, mirroring the message and dispatching the callback. The send became
an action, because a mutation cannot make an HTTP request: the read is `sendContext`, the writes are
`recordSent`, and the message row carries the provider's own message id rather than the id of a row in a
queue.

**Measured after the fix, on the judged deployment.** `inboxes:provision` for a real account returned
`owed-fwz3ythw47@agentmail.to` with `shared: false`; the provider lists that inbox against
`client_id owed-m17d27n0dg1zp67jbhde31d6498em3wr`, and the app's row matches it. The send endpoint answered
200 with a `message_id`, and the probe mail was delivered to the shared inbox. The inbound half was already
live and had been since the day before: the real forward is in the app's `messages` table as `direction:
inbound`, addressed to `owed+pa37n5u6f6@agentmail.to`.

**What is not yet measured, and the entry says so rather than rounding up.** `recordSent` has not run on
production, because no real claim has ever reached the approval gate: all 132 claims on the deployment are
the worked example, and the worked example is refused before the wire by design. The send resolves and
holds that guard, which is as far as a demonstration goes without sending a letter to a real business.

**Three documents changed with it.** The README said an owner past the plan's allowance gets "a sentence
explaining why rather than an error trace", which the fallback made false. The round-trip sheet was
rewritten as a numbered list, because I could not follow its prose and said so. And
`convex/convex.config.ts` carries the measurement, so the next person to reach for
`app.use(agentmail, { env })` finds out why it is not there without repeating it.

### 2026-09-18 - f7487c1

**The correction in the entry above reached one file and left two.** The fallback that hands a refused
owner the guest alias made one claim false: that an owner past the plan's allowance is given a sentence
about the refusal. I corrected the README and recorded that above, and the same sentence was still
standing in `convex/inboxes.ts`, three lines above the comment that contradicts it, and in the submission
copy, which is the text that goes into the form.

**Nothing was reading either of them for it, and that is the finding.** Neither phrasing was in the
sweep's `stale` list, so the sweep reported `PASS: no stale claims, all required claims present` over two
live contradictions. This is the defect class the spec exists for, arriving in the one way the spec cannot
see it: scope decides which files are read and the string list decides what is found in them, and the
string was absent. A clean sweep is evidence about the strings it holds and nothing more.

**Both now say what the code does, and both are guarded from both directions.** `provision`'s docstring
says the owner is handed the alias a guest would have got. The submission copy says the same in its own
words. Each file gained a `required` string for the new wording and the retired wording went on `stale`, so
the claim cannot be deleted and cannot come back. `repo/convex/inboxes.ts` is the second source file in
scope, for the same reason as the first: a docstring stating current behaviour belongs next to the code
that decides it. Four controls went in, each watched failing for the named reason, and the suite is
**21/21**.

**The judged bundle was checked against a fresh build rather than assumed.** The fix touched only `convex/`
and documentation, so the frontend should not have moved, and a build with `VITE_CONVEX_URL` set to the
production host reproduces `index-DGyWe2Zm.js` and `index-BXlwFeM6.css`, which are the two assets the live
site serves. The deployed frontend is this tree, which is a measurement rather than an expectation.

**The fallback is confirmed on production, both branches.** The deployment holds one inbox of its own,
`owed-fwz3ythw47@agentmail.to`, created at 11:28:53 UTC, and twenty-two guest aliases on the shared inbox.
The branch the fix added works and the branch it left alone still does.

**The first count I took was truncated and I reported it as if it were whole.** A read at `--limit 20`
returned twenty rows and I had written "nineteen guest aliases" from it. The table holds twenty-three rows.
Nothing in the output says it stopped early, which is why the limit has to exceed the expected count or the
count has to come from the whole table.

**The sponsor's own check was run, and it is clean of anything that needs fixing.** `npx convex insights
--prod` reports four warnings over 72 hours, each a single OCC retry on a different table: `aiCache` on a
cache put, `runStatus` in the component's callback pool, `claims` while seeding the worked example, and
`inboxes` while writing a guest alias. One retry each, and Convex retries these itself, so every one is a
concurrent write the platform resolved rather than a failure. `storeAlias` is the one worth naming because
it sits on the path a visitor takes: it reads `by_user` and inserts only if nothing is there, so two
concurrent calls for one guest both find nothing and one aborts and retries, at which point it finds the
row and returns it. The correct outcome rests on the platform's serializable isolation rather than on
anything in the function, which is why the right result here is a retry and not a second row.

**What is still not measured.** `recordSent` has not run: all 132 claims are the worked example, and the
worked example is refused before the wire by design. The outbound half is proven at the provider and
unproven end to end from the app. The round-trip sheet is what closes it.

### 2026-09-18 - 71af0ff

**The record that could not be opened, reported from the round trip rather than found by me.** The runbook
asks whether a forward became a record. It did, the row said so, and the row could not be opened. Other rows
in the same list opened fine, which is the detail that makes this a rendering defect rather than a data one.

**Diagnosed at three layers before anything changed.** The production message row carries a `recordId`; the
record it points at exists, with the amount, the kind and the reference read out of the paper, under the
owner's own `userId`; and it has no claim, correctly. The rendering was at fault. The arrivals row was a
button only where a `claimId` existed and a plain div otherwise, the Records rows were plain divs with a
default cursor, and the app had no record sheet at all, so a kept message that produced a record and no
claim had nowhere to go.

**That branch is ordinary rather than rare, and the worked example cannot show it.** A bare order
confirmation states a price and a date and nothing else, so the reader keeps it as a record and finds no
claim, which is the designed outcome. Two of the deployment's 142 records are in that state and both are
real mail; all 108 worked-example records have claims. The sheet now exists and explains the outcome rather
than leaving the row as a promise with nothing behind it.

**The paper block was empty for the example a judge reads first, because of the link direction.** All 108
worked-example records carry no `sourceMessageId`: the seed writes message to record rather than record to
message, so reading the record's own field found nothing. `records.one` now resolves the paper from both
directions, and the block prints the messages with a note that every one of them is shown, so the reading
can be checked against them.

**Two more false statements came out of the same pass, both found by measuring the data rather than reading
the code.** The sheet told every record built from more than one message that it was "Two messages became
this one record: what was bought, and what went wrong with it", which the component cannot know: 81 records
carry two messages, and that sentence was a narrative borrowed from the example. It now states the count and
that all of them are printed. And the crawl status has four values while the sheet had three branches, so
`skipped` fell into the branch for `pending` and was told "nobody has looked" while its own crawl note read
"Mapped 199 URLs, none looked like terms". `skipped` means the mapper walked the site and found no page that
looks like terms, which is a gap in the search rather than a finding about the company, and it is now its
own sentence instead of an absence the sheet described as `the company's terms have not been read for it`.

**The header offered a signed-in account a button to create an account it already had**, reported in the
same message. `inboxes.viewer` answers whether the reader is a guest, and the header renders one action:
`Create an account` for a guest, `Sign out` for an account holder, and nothing until the answer arrives, so
the label cannot change under a finger already moving toward it. A shared alias is not the same fact as a
guest, which is why the client cannot infer it from the address.

**Verified on the judged deployment, not in the worktree.** The live bundle is `index-CN9j_fE_.js`, which is
what a fresh build produces from this tree. In a browser on that bundle the record sheet opens from the
Records list and from the arrivals row, `Open the claim` reaches the claim sheet, Escape closes and clears
the hash, and the one arrival that was not kept is still a plain div that opens nothing. The guest header
shows one label.

**What is not measured.** The no-claim branch has not been seen rendering in a browser, because the only two
records in that state belong to real accounts and a guest's worked example is four records that all have
claims. It is evidenced by the data and by the branch's strings being present in the shipped bundle, and the
round trip is what closes it.

### 2026-09-18 - 617b34d

**The crawler was reading the wrong host, and it had cost two real claims.** The reader is asked for the
sender's domain, and that domain was what the crawl was pointed at. Companies send from subdomains that
publish nothing: Spotify's price-change notice arrives from `legal.spotify.com` and Ring's from
`mail.ring.com`, and neither host serves a sitemap or a policy page. Both crawls were marked `skipped`,
which was correct about the host and useless about the company, while the terms sat on `spotify.com` and
`ring.com` the whole time.

**Found by measuring the deployment rather than by reading the code.** Production holds 163 counterparties
across 39 users and 156 claims, and the owner's 4 claims are the four worked-example ones. Not one of the
eight real forwards had ever produced a claim, and two of them are textbook mid-contract price rises,
which is the exact shape the worked example's own price-rise claim is built from, so a shape mismatch was
not the explanation. The two rows were `legal.spotify.com` and `mail.ring.com`, both `skipped`, with a
note reading `Looked at 6 URLs (sitemap 0, mapper 1), none looked like terms`. Confirmed in the code
afterwards: the ingest prompt asks for the sender's domain, and `readCounterparty` took its origin from
that row.

**The fix tries the company's own site first and the sending host second.** `domains.ts` reduces a host to
its registrable domain, tolerating a scheme, a path, a port and a userinfo prefix because the value
arrives from a language model rather than a URL parser. `readCounterparty` walks those origins in turn and
stops at the first that yields a policy-shaped URL, so the extra map call is only ever spent on an address
that previously returned nothing at all. `upsertCounterparty` now keys the counterparty on the registrable
domain, so one company is one row rather than one row per subdomain it happens to send from.

**The rows the bug had already written were repaired rather than left to age.** Before changing anything,
the scale was measured: of 163 counterparties exactly two carry a domain that is not already its
registrable form, and reducing them collides with nothing. `normaliseDomains` rewrites those two and leaves
a row alone if the reduced domain is already taken by the same user, because "the data happens to be safe"
is not a property the code should rely on. `recrawl` then re-read the three counterparties whose crawl had
never succeeded, and `redetect` ran the detector over records with no claim. `detect` is not idempotent, so
restricting it to unclaimed records is what makes running it twice impossible.

**Verified on the judged deployment.** Spotify yielded **29** provisions read from `spotify.com` and Ring
**27** from `ring.com`, both from the company's own site. The third stale row, an older account's
`sigmasports.com`, went from `skipped` to 35 provisions. `domains.ts` is checked by a harness that imports
the shipped module rather than restating it, which is the difference between a test and a copy, and it
passes 20 cases including all seven domains this deployment holds.

**Six of the eight forwards are refused correctly and the reasons are worth recording**, because they are
about the paper rather than the product. An order confirmation, a missed-delivery notice and two
cancellation requests each state no failure the company's own terms commit them to remedy. The two price
rises now read the right terms and still produce no claim, for a reason that is correct: a price rise on a
rolling monthly subscription has no exit charge to be released from, which is exactly what makes the
worked example's price-rise claim work, since that one is a 24-month contract.

**A second defect was found on the way and is not fixed.** Evri's crawl reports success and keeps nothing,
and the note could not say why, so the note now names the host it read and gives a provision count per
document. Re-run, the six documents were `/return-a-parcel/argos-returns` and four more of Evri's
per-retailer guides to sending goods back, and `/terms-and-conditions` was never opened. The document
picker scores a URL by counting policy-ish words in its path, and `return-a-parcel/argos-returns` contains
both `return` and `returns`, which scored it 22 against the 17 of the real terms page. The same picker read
Spotify's creator terms, two audiobook refund policies and a Korea-market cancellation policy for a UK
subscription, because `agreement` is not in its vocabulary at all and `end-user-agreement` therefore
scores zero. That is a live defect and the next thing to fix.

**What is not measured.** No real forward has produced a claim, so the claim path on real mail is still
unexercised, and the entry that will record it does not exist yet. The Evri and document-picker findings
are measured from production crawl notes and the companies' own sitemaps rather than from a fix, so they
are evidence of the defect and not evidence of a cure.

### 2026-09-18 - 0532d43

**The record sheet said the agent had read "this company's published terms", and the crawl cannot promise
that.** It picks documents by the shape of their URL. Measured on this deployment, Evri's crawl carries the
status `crawled` and the six documents it read were `/return-a-parcel/argos-returns` and four more of Evri's
per-retailer guides to sending goods back, with Evri's own terms page never opened. The sentence was
therefore false about a record a reader can open from the ledger, not about a hypothetical one.

**It now says the agent found the pages that look like their terms and read them.** The crawl note printed
directly beneath it lists the documents and the provisions each yielded, so the two can be read against
each other: a reader who sees six per-retailer guides can tell for themselves that the terms were not among
them, which is the opposite of what the old sentence invited.

**This is the third sentence in this sheet found describing a state the data does not support**, after the
two-message narrative and the `skipped` branch that stood in for `pending`, and the fix is the same each
time: say what the status means rather than what it was hoped to mean. All three were found by measuring the
deployment. None was visible by reading the component, because the component was consistent with itself.

**Verified on the judged deployment.** The live bundle is `index-C18N7m9H.js`, served from
`fantastic-hamster-482.convex.site`, and it carries the corrected clause and no longer carries the old one.
The gates are green on the same tree: the claim-consistency sweep passes with the new clause guarded as a
required string, the hygiene sweep is empty across 145 files, and the controls suite is 32 of 32, the new
control proving the guard fails when the clause is removed.

### 2026-09-18 - 554ab91

**The crawl was reading six guides to sending goods back instead of the terms page, and there were four
separate reasons plus a bound that cut a sitemap in half.** Evri's crawl carried the status `crawled` and
kept nothing, which reads as a company with nothing to say. It had read `/return-a-parcel/argos-returns` and
four more of Evri's per-retailer returns guides, and never opened `/terms-and-conditions`. `return` and
`returns` were both vocabulary tokens, so a URL containing both was scored twice and the guide reached **27**
against the terms page's **17**.

**Three more, all measured rather than argued.** `agreement` was absent from the vocabulary entirely, so
Spotify's `end-user-agreement` scored zero and its **292** locale variants were filtered out, and the crawl
read creator terms, artist terms, two audiobook refund policies and a Korea-market cancellation policy for a
UK subscription. `privacy` was present as a concept, so `privacy_policy.jsp` scored 7 and took a slot a claim
could have used: this deployment holds **7** provisions from that document against **6** from the site's own
terms page. And two preferences were applied as magnitudes rather than as orderings, so both could exclude
rather than reorder: depth and the deprioritise penalty were subtracted from the score, which put a
deeply-nested contract at **1** and a creator-terms page at **-15**, where a `score > 0` test dropped it
silently. They are now facts about the document and are sorted on instead.

**A silent truncation was the fifth, and it produced a confident wrong answer rather than a gap.** The bound
on a fetched body was 8,000,000 bytes. Spotify's `/legal/sitemap.xml` is **9,211,047** bytes and lists 292
URLs, one per market, and the UK agreement sits at index **273**. So the walk returned 254 URLs, and 254 reads
like a field rather than a cut, and the crawl picked **Ireland's** agreement for a UK subscription. The bound
is now 32MB and a body that reaches it is refused rather than parsed as a prefix, so a partial document falls
through to the next candidate. The walk's budget also counts distinct documents rather than URLs now, so 292
variants of one agreement occupy one slot.

**The scorer and the walk moved to a module with no Convex import, because the check that covered them was
not checking them.** The harness carried its own copy of all three functions and passed every case while the
shipped scorer ranked the six guides above the terms page. A check that runs a copy of the logic is a check on
the copy, so the copy was deleted rather than kept as a green light. The replacement imports the shipped
module, runs 19 checks, and carries both retired versions as controls that each assertion has to fail on: an
assertion that passes on the shipped code and on every control is reported as a guard rather than counted as
evidence. Two of the controls earned that on the first run by catching a figure in a comment that was wrong,
`22` where the retired scorer gives `27`, and the harness now prints both values so the number has a source
that re-runs.

**Verified against the live sites, which is not yet the same as verified on the deployment.** Running the
shipped picker against four companies' own sitemaps: Evri returns `/terms-and-conditions` first out of 115
policy-shaped URLs, Spotify returns `/uk/legal/end-user-agreement`, and Ring and Sigma return their terms
pages. That is the picker measured on the real sites. It is not a measurement of the crawl, because the crawl
has not been re-run on this deployment since the change, so what the ledger will show is not yet known.

**What is not measured.** The fix changes which document is read, not whether a claim results. No real forward
has yet produced a claim, and the two that failed on this bug now read the right terms and still produce none,
for a reason that is correct: a price rise on a rolling subscription has no exit charge to be released from.
The claim path on real mail remains unexercised, and the effect of this change on a real claim is therefore
still unmeasured.

### 2026-09-18 - 4b54f48

**The deploy refused the extracted module, and nothing else would have caught it.** `policy-urls.js is not a
valid path to a Convex module. Path component policy-urls.js can only contain alphanumeric characters,
underscores, or periods.` The local build, the typecheck and a 19-check harness all passed on the file; the
constraint is Convex's and it is not visible from the repository. Every other module here is already
camelCase or underscore, so the convention was the answer and the new file was the only one breaking it. It
is now `policyUrls.ts`.

**Recorded rather than quietly renamed, because it is the same finding this module exists to serve.** A check
that runs locally cannot answer a question about the deployment, and the only surface that could was the
deploy itself.

### 2026-09-18 - 3c091b8

**The crawl was choosing documents and throwing away the ones it could not read, without saying so.** Ring's
crawl chose 8 documents and reported `Read 2 documents`. The other 6 were discarded and left no trace, so a
reader could not tell whether they had been chosen at all, which is the same shape as the note that hid
Evri's defect: a total that reads as a field.

**Making the discard visible named the cause, which is the whole reason for recording it.** The note now says
how many of the chosen documents were read, names the ones that were not, reports how many were recovered on
a second attempt, and carries the provider's own error once. That error is
`Firecrawl /v2/scrape failed (429): Rate limit exceeded. Consumed (req/min): 18, Remaining (req/min): 0.` A
crawl spends one request on the map and one per document, so eight documents arrive as a burst against an
18-per-minute limit and the tail is refused. It explains why the same eight Ring URLs read 2 documents in one
run and 8 in the next, and why retrying immediately cannot help, since the minute window is still full.

**Documents are now paced 5 seconds apart, and a refused scrape is attempted once more.** The gap is derived
from the limit rather than guessed: it holds a crawl of eight to about 13 requests a minute. Across the same
seven counterparties, **30 of 48 chosen documents were read before the change and 47 of 48 after**, and the
retry recovered a document on two of them, which is what makes it a measurement rather than a plausible fix.

**Verified on the judged deployment.** Evri's crawl now reads `/terms-and-conditions` and `/terms-of-use`
first and keeps **33** provisions, where before it read six per-retailer guides to sending goods back and kept
none. Ring's reads its own `/terms` and keeps 46. The picker fix and this one were both deployed and re-run
here rather than reasoned about.

**What is not measured.** The single document still unread is one 429 on the last of Evri's eight, so the
pacing reduces the failures rather than eliminating them, and the ledger is now honest about the gap instead
of silent. And the re-crawl of all seven real counterparties followed by the detector over the owner's seven
unclaimed records produced **no new claim**: every reason is about the paper, not the product. Six state that
nothing went wrong that the company's terms commit it to remedy, and the seventh is the price-change notice,
where the detector now reads the UK agreement and reports that no provision entitles a remedy for it. That is
the correct answer for a rolling subscription and it means the claim path on real mail is still unexercised.
