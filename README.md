# E-WORKS Income Report

Lightweight React + Vite + Tailwind finance dashboard that uses only the **REFERENCE DATA** and **QB FILE** structures from the E-WORKS reference workbook.

## Features

- QuickBooks CSV/XLS/XLSX import with automatic header and hierarchy detection.
- Date-based QB batches named `QB M/D/YYYY`; re-uploading the same date replaces the batch.
- Monthly end-of-month report with revenue, materials, labor, overhead, gross profit, margin, SOF breakdown, and review remarks.
- SOF-level lifetime computations matched to Reference Data budgets.
- All-transactions page and Reference Data page with 10-row server-side pagination.
- Separate pages for Dashboard, QB Upload, Monthly Report, SOF Analysis, Transactions, Reference Data, and QB Worksheets.
- Supabase Auth + RLS. No finance tables are exposed to anonymous users.
- Minimal UI: restrained cards, compact tables, responsive sidebar, no decorative chart clutter.

## Stack

- React 19 + Vite 8
- Tailwind CSS 4
- Supabase JS
- Papa Parse for CSV
- SheetJS CE 0.20.3 for Excel imports
- Vercel hosting

## Environment

Copy `.env.example` to `.env.local` for local development. Production variables are configured in Vercel rather than committed to Git.

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

Apply `supabase/migrations/20261029_income_report.sql` to the connected Supabase project. The migration creates only `income_*` objects and leaves existing RFP objects unchanged.

## Reference workbook integration

The app's database is seeded from the connected **E-WORKS REFERENCE DATA** workbook's `REFERENCE DATA` sheet. QuickBooks uploads are stored in Supabase as virtual worksheets/batches. A Vercel-hosted browser cannot reuse ChatGPT's private Google Drive connector session, so direct write-back to the original Google Sheet requires a separate Google service-account/OAuth credential. The app intentionally keeps the working upload flow database-first rather than exposing Google credentials in the browser.
