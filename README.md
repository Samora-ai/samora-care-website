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
- One Cloudflare Pages Function, `functions/api/lead.ts`. The eligibility
  screener is saved through the public Samora backend API; the separate Register
  form continues to use the existing Apps Script/email path.

### Screener option values

Each choice option in `src/pages/GetStarted.tsx` carries an explicit `value`
next to its label — `first_time`, `never`, and so on. The backend validates and
stores these exact slugs under `ssdi.leads.metadata.ads_screener`, so **edit the
labels freely but do not change the values** without updating the backend
contract.

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

Set this deployment value before enabling the screener:

- `CARE_LEAD_ENDPOINT` is the public backend intake URL in `wrangler.toml`.

### Recovering a Register lead that never reached the Sheet

Only the Register form uses the `LEADS` KV namespace. It writes
`lead:<timestamp>:<uuid>` before the visitor is told the form went through and
rewrites it with `delivered: true` once Apps Script accepts it. Anything left
with `delivered: false` is a Register lead that needs chasing by hand:

```
npx wrangler kv key list --namespace-id c879fa3a5a32405093ae64d1ead422e3
npx wrangler kv key get "<key>" --namespace-id c879fa3a5a32405093ae64d1ead422e3
```

`public/_redirects` is included so client-side routes (e.g. `/get-started`)
resolve correctly on direct load/refresh.

Live at `samoracare.com` and `samora.health`; `www.samoracare.com` 301s to the
apex via a Cloudflare redirect rule.

## Known gaps vs. the previous production site

The previous version of this repo (static HTML) had integrations that this
rewrite does **not** carry over yet:

- Google Analytics (GA4) and Meta Pixel conversion tracking. The old site also
  fired a `get_started_lead` / `Lead` event on submit; that hook is gone.
- Privacy Policy, Terms and Conditions, Accessibility Statement pages
  (footer links to these were removed until the pages exist again)
- SEO infra: sitemap.xml, robots.txt, llms.txt, JSON-LD structured data

These need to be reconnected/rebuilt before this is a full replacement for
the previous production site.
