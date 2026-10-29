# E-WORKS Income Report

Lightweight React + Vite + Tailwind finance dashboard with **Supabase as the permanent source of truth**.

## Data model

The website reads and writes the isolated `income_*` objects in Supabase. Google Sheets is no longer a runtime dependency.

The initial source workbook migration was completed on October 29, 2026 from the E-WORKS REFERENCE DATA workbook. The migration included:

- `REFERENCE DATA` — normalized into `income_reference_projects`.
- `QB FILE` — normalized into `income_qb_uploads` and `income_qb_transactions`.
- hidden `Sheet1` — preserved as raw legacy/source history in `income_source_rows`.
- `FORMAT` — intentionally excluded.

Migration totals:

- 195 structured reference/project rows.
- 15,277 structured QuickBooks transactions.
- 702 raw legacy/header/context rows preserved for audit/history.
- 16,174 included non-empty source rows in total.

The raw migration archive is internal and is not exposed to the browser client.

## Upload behavior

CSV/XLS/XLSX QuickBooks exports are parsed in the browser and written directly to Supabase.

Each upload is grouped by the detected report date using the logical batch name `QB M/D/YYYY`. Re-uploading the same report date replaces that Supabase batch through validated database RPCs so monthly reports do not double-count the same dated dataset.

## Features

- Dashboard backed by migrated Supabase data.
- QuickBooks CSV/XLS/XLSX import with automatic header, hierarchy, and SOF detection.
- Monthly end-of-month report with revenue, materials, labor, overhead, gross profit, margin, SOF breakdown, and review remarks.
- SOF-level lifetime computations matched against Reference Data budgets.
- Transactions and Reference Data pages with 10-row pagination.
- Separate pages for Dashboard, QB Upload, Monthly Report, SOF Analysis, Transactions, Reference Data, and QB Worksheets.
- No application login screen.
- Minimal responsive UI with compact tables and restrained financial cards.

## Access model

The site is intentionally login-free. Anyone who can reach the website can view the finance data exposed by its browser RLS policies and use the enabled QB upload workflow.

Supabase RLS remains enabled. Reference and reporting data are read-only from the browser. QB upload metadata replacement is handled through validated `SECURITY DEFINER` RPCs, while transaction rows are inserted in controlled browser-side chunks. No Supabase service-role key is stored in the frontend or repository.

## Stack

- React 19 + Vite 8
- Tailwind CSS 4
- Supabase JS / PostgreSQL
- Papa Parse for CSV
- SheetJS CE for Excel imports
- Vercel deployment

## Environment

The real local environment file is gitignored and is not stored in GitHub. Vercel holds the required values for Production, Preview, and Development.

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
VITE_APP_NAME=E-WORKS Income Report
```

After cloning or pulling the repo on a machine authorized for the Vercel project:

```bash
npm install
npx vercel link --yes
npm run env:pull
npm run dev
```

## Database migrations

The repository contains the isolated IncomeReport database migrations under `supabase/migrations/`:

- `20261029_income_report.sql` — base IncomeReport tables, views, reporting functions, and RLS.
- `20261029_source_archive.sql` — source migration/archive tables and source lineage columns.
- `20261029_secure_public_upload.sql` — validated login-free QB upload RPCs and browser permissions.
- `20261029_harden_source_archive.sql` — explicit browser denial and supporting archive indexes.

These migrations are designed around the `income_*` namespace and do not modify the existing RFP application tables.

## Google source workbook

The original E-WORKS workbook was used only for the completed one-time migration. Future website uploads land in Supabase and do not require Google service-account credentials.

## UI/UX Pro Max

The design review is documented in `docs/ui-ux-pro-max-design.md`: financial data first, restrained visuals, task-based pages, consistent controls, responsive tables, and semantic status color only.
