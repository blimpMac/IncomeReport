# E-WORKS Income Report

Lightweight React + Vite + Tailwind finance dashboard built around only the **REFERENCE DATA** and **QB FILE** structures from the E-WORKS reference workbook.

## Features

- QuickBooks CSV/XLS/XLSX import with automatic header and hierarchy detection.
- Date-based QB batches named `QB M/D/YYYY`; re-uploading the same date replaces the batch.
- Monthly end-of-month report with revenue, materials, labor, overhead, gross profit, margin, SOF breakdown, and review remarks.
- SOF-level lifetime computations matched to Reference Data budgets.
- All-transactions page and Reference Data page with 10-row pagination.
- Separate pages for Dashboard, QB Upload, Monthly Report, SOF Analysis, Transactions, Reference Data, and QB Worksheets.
- Supabase Auth + RLS. Finance objects are intended for authenticated users only.
- Minimal UI: restrained cards, compact tables, responsive sidebar, no decorative chart clutter.

## Stack

- React 19 + Vite 8
- Tailwind CSS 4
- Supabase JS
- Papa Parse for CSV
- SheetJS CE for Excel imports
- Vercel-ready frontend

## Environment

Copy `.env.example` to `.env.local` for local development. Do not commit the real `.env`. Configure the same variables in Vercel when the project is linked.

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_APP_NAME=E-WORKS Income Report
```

## Local development

```bash
npm install
npm run dev
```

## Database

Apply `supabase/migrations/20261029_income_report.sql` to the intended Supabase project. It creates only `income_*` objects and is designed not to modify the existing RFP tables.

After applying the migration, load the current E-WORKS `REFERENCE DATA` rows into `income_reference_projects` before using budget/reference comparisons.

## Reference workbook integration

The application data model is based on the connected **E-WORKS REFERENCE DATA** workbook's `REFERENCE DATA` and `QB FILE` sheets only. QB uploads are stored in Supabase as date-named virtual worksheets/batches.

A Vercel-hosted browser cannot reuse ChatGPT's private Google Drive connector session. Direct write-back to the original Google Sheet therefore requires a Google service-account or OAuth integration. Until that credential is configured, `QB M/D/YYYY` means the Supabase batch/worksheet used by the website rather than a newly created physical tab in the source Google Sheet.

## UI/UX Pro Max

The design review is documented in `docs/ui-ux-pro-max-design.md`: financial data first, restrained visuals, task-based pages, consistent controls, responsive tables, and semantic status color only.
