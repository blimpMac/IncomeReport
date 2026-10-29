# E-WORKS Income Report

Lightweight React + Vite + Tailwind finance dashboard using the **E-WORKS REFERENCE DATA** Google workbook as the live source of truth.

## Live data model

The website reads these Google Sheets tabs directly at runtime:

- `REFERENCE DATA` — project/SOF master data, contract values, status, and budgets.
- `QB FILE` — the current QuickBooks transaction dataset used by Dashboard, Monthly Report, SOF Analysis, and Transactions.

The app no longer depends on Supabase for finance data. Changes made directly in the Google workbook are picked up by the website on refresh (with a short server cache to avoid excessive Google API requests).

## Upload behavior

CSV/XLS/XLSX QuickBooks exports are parsed in the browser, then written to the same Google workbook through the server-side Google Sheets API integration.

Each successful website upload:

1. Replaces the contents of `QB FILE`, making the uploaded export the new live transaction source.
2. Creates or replaces a physical dated worksheet named `QB M/D/YYYY` using the report date detected from the QuickBooks export.
3. Refreshes the website from the Google Sheet after the write completes.

The dated worksheet is an archive snapshot. Reports intentionally calculate from `QB FILE` only so cumulative QuickBooks exports are not double-counted across multiple dated worksheets.

## Features

- Live Google Sheets-backed Dashboard.
- QuickBooks CSV/XLS/XLSX import with automatic header, hierarchy, and SOF detection.
- Physical Google worksheets for dated upload history.
- Monthly end-of-month report with revenue, materials, labor, overhead, gross profit, margin, SOF breakdown, and review remarks.
- SOF-level lifetime computations matched against `REFERENCE DATA` budgets.
- Transactions and Reference Data pages with 10-row pagination.
- Separate pages for Dashboard, QB Upload, Monthly Report, SOF Analysis, Transactions, Reference Data, and QB Worksheets.
- No application login screen.
- Minimal responsive UI with compact tables and restrained financial cards.

## Stack

- React 19 + Vite 8
- Tailwind CSS 4
- Vercel Functions (`api/sheets.js`)
- Google Sheets API
- Papa Parse for CSV
- SheetJS CE for Excel imports

## Google authorization

The deployed Vercel function needs a Google service account that can read and edit the source workbook. The service-account email must be shared on the **E-WORKS REFERENCE DATA** workbook with **Editor** permission.

The server environment expects:

```env
GOOGLE_SHEETS_SPREADSHEET_ID=1FBsSwS7EAvRCYyBhSm0y9YqZL2NLaG25fODy4Ri-lVc
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@your-project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Alternatively, `GOOGLE_SERVICE_ACCOUNT_JSON` may contain the complete service-account JSON object instead of the email/private-key pair.

These are server-only values. Do **not** prefix the service-account credentials with `VITE_`, and never commit the real key to GitHub.

## Local development

The real environment file remains gitignored. On a machine authorized for the Vercel project:

```bash
npm install
npx vercel link --yes
npm run env:pull
npm run dev
```

## Source workbook

Spreadsheet ID: `1FBsSwS7EAvRCYyBhSm0y9YqZL2NLaG25fODy4Ri-lVc`

The application intentionally uses only the `REFERENCE DATA` and `QB FILE` structures for calculations. Other workbook tabs are not included in finance reporting, except physical `QB M/D/YYYY` tabs created by website uploads for archive/history.

## Legacy Supabase files

The repository still contains the earlier `supabase/` migration for historical reference, but the current website finance data path reads and writes Google Sheets directly.

## UI/UX Pro Max

The design review is documented in `docs/ui-ux-pro-max-design.md`: financial data first, restrained visuals, task-based pages, consistent controls, responsive tables, and semantic status color only.
