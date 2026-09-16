# SamoraCare — handover

Everything needed to take over `samoracare.com`. The site is a small React app,
but the parts that matter at handover are the **eight external accounts** it
depends on. Code without those accounts is not a working site.

Work top to bottom. Section 1 is the access transfer, section 2 proves it
worked, sections 3–6 are the day-to-day runbook.

> Fill in the `owner:` blanks as you go — this file is the only place the whole
> picture is written down, and it is worth keeping accurate after the handover.

---

## 1. Accounts to transfer

### 1.1 GitHub — the code

| | |
|---|---|
| What | `github.com/sahilgarg101020-pixel/samoracare` |
| Current owner | _______________ |
| Needed by | Anyone deploying or changing the site |

The repo currently sits under a **personal account**, not an organisation. If
that account goes away, the Cloudflare build disconnects with it.

1. Add the new owner: **Settings → Collaborators → Add people** → role **Admin**.
2. Longer term, move it into an org: **Settings → General → Transfer
   ownership**. Cloudflare Pages follows a transfer, but re-check the build
   connection afterwards (§1.2).

### 1.2 Cloudflare — hosting, DNS, the lead store

| | |
|---|---|
| What | Pages project `samora-care`, DNS for both domains, the `LEADS` KV namespace |
| Current owner | _______________ |
| Needed by | Anyone deploying, changing DNS, or recovering a lost lead |

This is the single most important account. It holds three separate things:

- **Pages project `samora-care`** — builds `main` on every push, serves the site.
- **DNS** for `samoracare.com` and `samora.health`, plus the redirect rule that
  301s `www.samoracare.com` to the apex.
- **KV namespace `LEADS`** (id `c879fa3a5a32405093ae64d1ead422e3`) — every form
  submission is written here before the visitor is told it went through. This
  is the backstop that makes lost leads recoverable. Do not delete it.

Transfer by inviting the new owner as an account member:
**Manage Account → Members → Invite** → role **Administrator** (Super
Administrator if they are to become the sole owner).

⚠️ **Do not configure this project from the Cloudflare dashboard.** Because the
repo contains a `wrangler.toml`, that file is the source of truth for build
output, vars and bindings. The dashboard still *displays* its own fields, but
they are ignored at runtime. A binding added in the dashboard will silently not
exist. Add it to `wrangler.toml` and push.

### 1.3 Domain registrar

| | |
|---|---|
| What | `samoracare.com` and `samora.health` |
| Registrar | _______________ |
| Current owner | _______________ |

Separate from Cloudflare unless the domains were bought through Cloudflare
Registrar — check. Transfer the registrar login or move the domains to an
account the team controls. Note the renewal dates while you are in there.

### 1.4 Google account — the leads Sheet and Apps Script

| | |
|---|---|
| What | The leads spreadsheet + the bound Apps Script web app |
| Current owner | _______________ |
| Needed by | Anyone reading leads or changing where they go |

**This is the one that has already bitten this project.** The original script
and sheet were deployed from an account nobody on the team could sign into,
which is why `apps-script/` exists in the repo at all. Do not repeat it.

The chain is: form → `samoracare.com/api/lead` (Cloudflare) → Apps Script
`/exec` URL → spreadsheet row + notification email.

1. The spreadsheet and the script must live on an account **the team owns** —
   ideally a shared Workspace account, not an individual's.
2. Share the spreadsheet with the new owner as **Editor** (or transfer
   ownership outright: **Share → ⋮ next to their name → Transfer ownership**).
3. The Apps Script project is bound to the sheet, so sheet access carries it.
   Confirm at **Extensions → Apps Script**.
4. The live `/exec` URL is in `wrangler.toml` as `LEAD_ENDPOINT`. If the script
   is ever redeployed from a different account, that URL changes and must be
   updated there — see `apps-script/README.md` for the full redeploy procedure.

**`NOTIFY_EMAIL` in `apps-script/Code.gs` is currently `kartik@samora.ai`.**
Change it at handover, or lead notifications keep going to the old team. It
accepts a comma-separated list. Editing the file is not enough — Apps Script
keeps serving the old version until you publish a new one (**Deploy → Manage
deployments → edit → Version: New version → Deploy**).

### 1.5 Google Analytics 4

| | |
|---|---|
| What | Property `G-CCCXDFBT68` (hardcoded in `index.html`) |
| Current owner | _______________ |

**Admin → Property access management → +** → grant **Administrator**.

### 1.6 Meta — Pixel and Business Manager

| | |
|---|---|
| What | Pixel `1588645902901825` (hardcoded in `index.html`) |
| Domain verification | `4hslu5zuqi7g1pcn7a13ygl6yvkknu` (meta tag in `index.html`) |
| Current owner | _______________ |

Transfer via **Business Settings → Data sources → Pixels → Assign people**, and
add the new owner to the Business Manager itself. The domain-verification meta
tag belongs to that Business Manager — if the site moves to a different one,
that tag has to be reissued or Meta stops attributing conversions.

### 1.7 Cal.com — the booking link

| | |
|---|---|
| What | `cal.com/kartiksawhney/quick-chat-benefits` |
| Current owner | _______________ |

This is a **personal Cal.com handle** linked from the "Talk to someone" page. It
will keep pointing at that individual's calendar after handover. Either move it
to a team link or update the two references in `src/pages/TalkToSomeone.tsx`.

### 1.8 Email — the addresses on the site

| | |
|---|---|
| What | `team@samoracare.com`, `hello@samoracare.com` |
| Provider | _______________ |
| Current owner | _______________ |

Published in the structured data, the legal pages and the footer. Make sure
mail to both still reaches someone after the handover. Also listed publicly:
the phone number **+1-253-766-5260**.

### 1.9 Secrets to rotate

Nothing secret is committed to the repo, but two things should still change
hands deliberately:

- **`SHARED_TOKEN`** — set as a Script Property on the Apps Script project, and
  as `LEAD_TOKEN` in Cloudflare. It is what stops anyone who learns the `/exec`
  URL posting fake leads. Rotate it at handover: set the new value in both
  places. (Check whether it is set at all — the script is written to accept
  unauthenticated posts until it exists, so its absence is silent.)
- **`LEAD_ENDPOINT`** — not a secret exactly, but it is a world-reachable URL
  sitting in a public repo. Rotating the token is what protects it.

---

## 2. Verify the handover actually worked

Do not call it done until the new owner has personally, from their own login:

- [ ] Cloned the repo, run `npm install && npm run dev`, seen the site at
      `localhost:5173`
- [ ] Pushed a trivial commit to `main` and watched the Cloudflare build go green
- [ ] Submitted a real test lead through `/get-started` on the **live** site
- [ ] Seen that test row land in the spreadsheet
- [ ] Received the notification email at the **new** `NOTIFY_EMAIL`
- [ ] Opened the GA4 realtime report and seen their own visit
- [ ] Opened Meta Events Manager and seen the `Lead` event from the test
- [ ] Listed the `LEADS` KV namespace from their own machine (§4)
- [ ] Opened Cloudflare DNS for both domains
- [ ] Deleted the test row

The end-to-end lead test is the one that matters most — it exercises
Cloudflare, KV, Apps Script, the sheet and email in a single action. If a lead
submitted on the live site reaches the new owner's inbox, the handover is real.

---

## 3. Running and deploying

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc + vite build + prerender
npm run lint       # oxlint
```

`npm run build` also prerenders every route to static HTML and generates
`sitemap.xml` and `llms.txt` from the same route list in `src/prerender.tsx` —
so **a new page added there gets its SEO files for free**, and a page added only
to `src/App.tsx` does not. Add routes to both.

**Deployment is automatic**: pushing to `main` triggers a Cloudflare Pages
build. There is no manual deploy step and no staging environment — a push to
`main` is a push to production.

`public/_redirects` (`/*  /index.html  200`) is the SPA fallback that makes
direct loads of `/get-started` and friends work. `public/_headers` sets cache
lifetimes. Both must stay in `public/`.

## 4. Where the leads go, and how to recover one

```
visitor → /api/lead (Cloudflare Function) → KV write → response to visitor
                                              ↓ (after the response)
                                    Apps Script → Sheet row + email
```

The KV write happens **before** the visitor is told the form went through, and
the Apps Script call happens after, with three retries. A lead is therefore
never lost to a slow or broken Sheet — it is only ever *undelivered*.

Each record is stored under `lead:<timestamp>:<uuid>` with `delivered: false`,
rewritten to `delivered: true` once Apps Script accepts it. **Anything still
`false` is a lead that never reached the Sheet and needs chasing by hand:**

```bash
npx wrangler kv key list --namespace-id c879fa3a5a32405093ae64d1ead422e3
npx wrangler kv key get "<key>" --namespace-id c879fa3a5a32405093ae64d1ead422e3
```

This is also how leads from before the current Sheet existed are recovered —
they are all still in KV.

## 5. Things that will break if you don't know them

- **`wrangler.toml` beats the Cloudflare dashboard.** Bindings and vars added in
  the dashboard are ignored. (§1.2)
- **Saving the Apps Script editor does not deploy it.** You must publish a new
  version. `curl <exec url>` returns the `VERSION` string from `Code.gs` — that
  is how you check what is actually live.
- **Screener option `value`s are a data contract.** Each option in
  `src/pages/GetStarted.tsx` carries an explicit value (`first_time`, `never`,
  …). The Sheet columns key off those slugs. **Edit the labels freely; do not
  change the values** without updating the Apps Script column mapping.
- **Sheet columns are written by position.** Add new columns at the end only,
  never reorder an existing tab. Two tabs exist: `Screener leads` and
  `Register leads`.
- **Claimant acknowledgement emails are off** (`SEND_ACKNOWLEDGEMENT` in
  `Code.gs`). Read the wording before turning it on — it goes to real people.
- **Gmail send quota** is 100 recipients/day on a consumer account, 1,500 on
  Workspace. Acknowledgements double the usage per lead.
- **Analytics must never carry answers.** `src/lib/analytics.ts` deliberately
  sends only which question was on screen and which button was pressed. The
  screener collects health conditions and contact details, and none of that may
  reach an ad network. Keep it that way when adding events.
- **Test Apps Script changes locally first**: `node apps-script/test-local.mjs`
  runs `Code.gs` under Node with the Google globals stubbed.

## 6. Layout

```
src/pages/          One file per route (Landing, GetStarted, Register, …)
src/data/           Blog posts, US states
src/lib/analytics.ts  GA4 + Meta Pixel wrappers, all failure-guarded
src/prerender.tsx   The route list — drives prerender, sitemap.xml, llms.txt
functions/api/lead.ts  The Cloudflare Function that receives both forms
apps-script/Code.gs    Source of truth for the deployed Apps Script
public/             Static assets, _redirects, _headers, robots.txt
wrangler.toml       Build output, vars, KV bindings — beats the dashboard
```

Routes: `/`, `/get-started`, `/register`, `/connect`, `/talk-to-someone`,
`/blog`, `/blog/:slug`, `/privacy-policy`, `/terms-and-conditions`,
`/accessibility-statement`.
