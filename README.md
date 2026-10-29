# E-WORKS Income Report

Lightweight React + Vite + Tailwind finance dashboard built around only the **REFERENCE DATA** and **QB FILE** structures from the E-WORKS reference workbook.

## Features

- QuickBooks CSV/XLS/XLSX import with automatic header and hierarchy detection.
- Date-based QB batches named `QB M/D/YYYY`; re-uploading the same date replaces the batch.
- Monthly end-of-month report with revenue, materials, labor, overhead, gross profit, margin, SOF breakdown, and review remarks.
- SOF-level lifetime computations matched to Reference Data budgets.
- All-transactions page and Reference Data page with 10-row pagination.
- Separate pages for Dashboard, QB Upload, Monthly Report, SOF Analysis, Transactions, Reference Data, and QB Worksheets.
- No application login screen. The dashboard opens directly and uses the Supabase publishable browser client.
- Supabase RLS remains enabled on the IncomeReport tables, with browser permissions scoped to the operations required by the login-free app.
- Minimal UI: restrained cards, compact tables, responsive sidebar, no decorative chart clutter.

## Access model

This deployment is intentionally login-free. Anyone who can reach the website can view the IncomeReport data exposed to the browser and use the enabled QB import actions. Do not place a Supabase `service_role` or secret key in the frontend; only the publishable browser key belongs in `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Stack

- React 19 + Vite 8
- Tailwind CSS 4
- Supabase JS
- Papa Parse for CSV
- SheetJS CE for Excel imports
- Vercel-ready frontend

## Environment

The real local environment file is intentionally ignored by Git and is **not stored in GitHub**. Vercel holds the Supabase values for Production, Preview, and Development.

After cloning or pulling the repo on a machine that is authorized for the `income-report` Vercel project, run:

```bash
npm install
npx vercel link --yes
npm run env:pull
```

That creates `.env.local` on your machine from the project's Vercel environment while keeping it out of GitHub. `.gitignore` already excludes `.env`, `.env.local`, and `.vercel`.

The app expects:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_APP_NAME=E-WORKS Income Report
```

## Local development

```bash
npm install
npm run env:pull
npm run dev
```

## Database

The live Supabase project contains the isolated `income_*` objects used by this app. The repository also contains `supabase/migrations/20261029_income_report.sql` as the base schema definition; it is designed not to modify the existing RFP tables.

Load the current E-WORKS `REFERENCE DATA` rows into `income_reference_projects` before using budget/reference comparisons.

## Reference workbook integration

The application data model is based on the connected **E-WORKS REFERENCE DATA** workbook's `REFERENCE DATA` and `QB FILE` sheets only. QB uploads are stored in Supabase as date-named virtual worksheets/batches.

A Vercel-hosted browser cannot reuse ChatGPT's private Google Drive connector session. Direct write-back to the original Google Sheet therefore requires a Google service-account or OAuth integration. Until that credential is configured, `QB M/D/YYYY` means the Supabase batch/worksheet used by the website rather than a newly created physical tab in the source Google Sheet.

## UI/UX Pro Max

The design review is documented in `docs/ui-ux-pro-max-design.md`: financial data first, restrained visuals, task-based pages, consistent controls, responsive tables, and semantic status color only.
