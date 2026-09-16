# SamoraCare

Disability benefits marketing site and eligibility screener.

## Project structure

```
├── src/pages/Landing.tsx      # Marketing landing page ("/")
├── src/pages/GetStarted.tsx   # 8-step eligibility screener ("/get-started")
├── public/assets/             # Logo, photography
└── public/_redirects          # SPA fallback for Cloudflare Pages
```

## Tech stack

- React + TypeScript + Vite, client-side routed with React Router
- One Cloudflare Pages Function, `functions/api/lead.ts`, which receives the
  completed screener and forwards it to the Google Apps Script endpoint that
  feeds the leads Sheet and the n8n workflow. Analytics and CRM are still
  unwired.

### Screener option values

Each choice option in `src/pages/GetStarted.tsx` carries an explicit `value`
next to its label — `first_time`, `never`, and so on. The Sheet columns and
the n8n branching key off those slugs, so **edit the labels freely but do not
change the values** without updating the downstream workflow.

## Local development

```
npm install
npm run dev
```

## Deployment (Cloudflare Pages)

The `samora-care` Pages project builds `main` automatically. Because the repo
contains a `wrangler.toml`, that file — not the dashboard — is the source of
truth for build output, vars, and bindings; the dashboard's own fields are
displayed but ignored. Add any future binding to `wrangler.toml` or it will
silently not exist at runtime.

### Recovering a lead that never reached the Sheet

Every submission is written to the `LEADS` KV namespace under
`lead:<timestamp>:<uuid>` before the visitor is told the form went through, and
is rewritten with `delivered: true` once Apps Script accepts it. Anything left
with `delivered: false` is a lead that never made it to the Sheet and needs
chasing by hand:

```
npx wrangler kv key list --namespace-id c879fa3a5a32405093ae64d1ead422e3
npx wrangler kv key get "<key>" --namespace-id c879fa3a5a32405093ae64d1ead422e3
```

`public/_redirects` is included so client-side routes (e.g. `/get-started`)
resolve correctly on direct load/refresh.

Live at `samoracare.com` and `samora.health`; `www.samoracare.com` 301s to the
apex via a Cloudflare redirect rule.

## Handover / access

`HANDOVER.md` is the access inventory: every external account the site depends
on (Cloudflare, the Google Sheet and Apps Script, GA4, Meta, Cal.com, the
registrar), how to transfer each one, and the checks that prove the transfer
worked. Read it before granting or taking over access.

The integrations the earlier static site had — GA4, the Meta Pixel and its
`Lead` event, the Privacy/Terms/Accessibility pages, sitemap.xml, robots.txt,
llms.txt and JSON-LD — are all back in place. The sitemap and llms.txt are
generated at build time from the route list in `src/prerender.tsx`, so a new
page must be added there, not only to `src/App.tsx`.
