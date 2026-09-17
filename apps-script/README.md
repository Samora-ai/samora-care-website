# Lead intake Apps Script

Receives Register-form leads from `samoracare.com/api/lead`, writes them to the
spreadsheet, and emails the team. The eligibility screener now writes directly
to `ssdi.leads` through the Samora backend and does not call this script.

`Code.gs` is the source of truth. Edit it here, then paste into the Apps Script
editor, so the deployed script and the repo do not drift.

## Check it before deploying

```
node apps-script/test-local.mjs
```

Runs `Code.gs` under Node with the Google globals stubbed, so the retained
Register flow goes through the real routing, column mapping, duplicate check
and email builder without a sheet or an inbox. Faster than deploying to find a
typo.

## Deploy

Do this on an account the team actually controls. The original script and sheet
were deployed from an account no one here can sign into, which is why this
exists.

1. Create a new Google Sheet to hold the leads. Copy its id from the URL:
   `docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`
2. **Extensions → Apps Script** from inside that sheet. Doing it this way binds
   the script to the sheet and step 4 becomes optional
3. Replace everything in `Code.gs` with this file's contents → save
4. **Project Settings → Script properties → Add**: `SPREADSHEET_ID` = the id
   from step 1. Required if the script is standalone rather than bound; harmless
   if it is bound, and it removes any doubt about which sheet is written
5. Run `selfTest` from the editor. It asks for permission to use the sheet and to
   send mail as you — that prompt is expected, and is why step 7 runs as *Me*
6. Check a row appeared and the email arrived
7. **Deploy → New deployment → Web app**
   - Description: `lead intake`
   - Execute as: **Me**
   - Who has access: **Anyone**
8. Copy the `/exec` URL

"Anyone" is required because Cloudflare calls this without a Google identity.
Set a shared token so public does not also mean open.

### If selfTest fails with "Cannot read properties of null (reading 'getSheetByName')"

The script is standalone, so there is no active spreadsheet. Do step 4.

## Point the site at it

Put the `/exec` URL in `wrangler.toml` as `LEAD_ENDPOINT`, commit, and the next
deploy uses it. Nothing else in the site changes.

## Shared token (recommended)

Without one, anyone who learns the URL can post fake leads and trigger emails.

1. Apps Script → **Project Settings → Script properties → Add**
   `SHARED_TOKEN` = a long random string
2. Add the same value to `wrangler.toml` as `LEAD_TOKEN`
3. The Worker sends it with every payload; the script rejects anything without it

Until `SHARED_TOKEN` exists the script accepts unauthenticated posts, so these
two steps can be done in either order without dropping leads.

## Re-deploying after an edit

Apps Script keeps serving the old version until you publish a new one:
**Deploy → Manage deployments → edit → Version: New version → Deploy.** The URL
stays the same. Editing the code alone changes nothing that is live.

## Things worth knowing

- **Register leads** are created automatically on first submission. The old
  `Screener leads` tab is historical and should receive no new browser traffic.
- **Add columns at the end only.** Rows are written by column order.
- **Duplicate protection** is by `lead_id`. The Worker retries three times, so
  without it a lost response would mean a second row and a second email.
- **Acknowledgement emails to claimants are off.** `SEND_ACKNOWLEDGEMENT` at the
  top of `Code.gs` turns them on — read the wording first, since it goes to real
  people.
- **Mail quota** is 100 recipients/day on a consumer Gmail account, 1,500 on
  Workspace. Turning acknowledgements on doubles the usage per lead.
- **Failures are safe.** A non-ok response makes the Worker retry, and the lead
  stays flagged `delivered: false` in the `LEADS` KV namespace either way, so
  nothing is lost even if this script is broken.
- **Leads already taken are recoverable.** Every submission is written to KV
  before the sheet is ever contacted, so anything that went to the old
  inaccessible sheet still exists:

  ```
  npx wrangler kv key list --namespace-id c879fa3a5a32405093ae64d1ead422e3
  npx wrangler kv key get "<key>" --namespace-id c879fa3a5a32405093ae64d1ead422e3
  ```
