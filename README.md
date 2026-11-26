# E-WORKS Financial Monitoring & Project Management

A React 19 + Vite application for financial monitoring, QuickBooks transaction review, budget tracking, and project profitability analysis. Supabase/PostgreSQL is the application's source of truth, and Vercel is used for hosting.

## What the system provides

### Financial monitor
- Revenue, delivery cost, gross profit/loss, margin, and transaction-count KPIs.
- Year and month selectors, including all-years and year-total views.
- Category filtering and monthly revenue-versus-cost trends.
- Revenue breakdown by SOF and COGS/operating-cost breakdown by category and account.
- A review list for projects with negative gross profit.

### Project analysis
- Analyze projects over all available dates or a selected date range.
- Review project revenue, actual project cost, budget utilization, variance, and profitability.
- Expand project rows to inspect their underlying transaction breakdowns.
- Compare two projects side by side, including revenue, actual cost, allocated budget, budget remaining, gross profit, and profit margin.

### Budget dashboard
- Review budget-linked transactions and project spending.
- Filter by reporting period and available project/category dimensions.
- Identify budget overruns and compare actual costs against allocated amounts.
- Export budget transaction data to an Excel workbook.

### All transactions
- Search transaction records by client/entity, SOF reference, memo/description, account, and transaction type.
- Filter by company, division, category, and transaction coverage (year, month, or custom date range).
- Expand a transaction to inspect its full memo and available company, division, category, and record-ID details.
- Save and reuse named filter views in the current browser.
- Export matching transaction data to CSV. Search and filter criteria are applied to the export as well as the on-screen results.
- Transaction results are paginated; use the load-more control to retrieve subsequent pages.

### Reports and reference data
- Monthly financial reporting and SOF-level analysis.
- Project profitability reporting and comparison.
- QuickBooks upload history and worksheet views.
- Reference project/budget data used by project analysis and monitoring.

## Navigation

The application is organized into three navigation groups:

| Group | Pages |
| --- | --- |
| Overview | Financial monitor, Project analysis, Budget dashboard, All transactions |
| Reports | Monthly report, SOF analysis, Project profitability |
| Data | QuickBooks upload, Reference data, QB worksheets |

The navigation menu supports desktop hover/click and touch-friendly toggling on smaller screens. The workspace styling includes responsive layouts, accessible keyboard focus states, consistent form controls, and horizontally scrollable data tables where needed.

## Company-scoped data

QuickBooks uploads and transaction reporting are scoped by company. The database stores the company against each upload and its transactions, and the reporting queries apply the company filter so one company's imported records are not mixed into another company's results.

The current database has company-specific upload handling for Greenlight Power Inc. and Gemcor. Availability of records depends on the uploads that have actually been imported for each company; an empty company ledger is not populated with sample data.

## Data model and source of truth

The website reads and writes the isolated `income_*` objects in Supabase. Google Sheets is not a runtime dependency.

The original source workbook was used for a one-time migration:
- `REFERENCE DATA` was normalized into `income_reference_projects`.
- `QB FILE` data was normalized into `income_qb_uploads` and `income_qb_transactions`.
- The hidden `Sheet1` source/history rows were preserved in `income_source_rows`.
- `FORMAT` was intentionally excluded.

The raw migration archive is internal and is not exposed to the browser client.

### QuickBooks uploads
- CSV, XLS, and XLSX QuickBooks exports are parsed in the browser and written to Supabase.
- Upload batches are tracked with company and report metadata.
- Upload replacement and transaction ingestion use the database's validated upload workflow.
- Re-uploading an existing report batch is handled by the upload workflow to avoid duplicate reporting data.
- Google service-account credentials are not required for routine uploads.

## Access and security model

- The application currently has no application login screen.
- Supabase Row Level Security (RLS) is enabled for the database objects used by the app.
- Browser-side reference/reporting access is governed by the configured RLS policies and database grants.
- QuickBooks upload metadata operations use validated database RPCs; transaction rows are inserted in controlled chunks.
- Never put a Supabase service-role key or other server secret in frontend code, a committed environment file, or the public repository.
- Company filters in the interface are intended to scope reporting queries; they do not replace database authorization policies.

Because the app is login-free, anyone who can reach the public site may be able to access the data and operations allowed by the active Supabase policies. Review the RLS policies and upload permissions before exposing the site or changing its access model.

## Technology stack

- React 19
- Vite 8
- Tailwind CSS 4
- Supabase JS / PostgreSQL
- Papa Parse for CSV parsing
- SheetJS Community Edition for Excel import/export
- Vercel for hosting and deployments

## Requirements

- Node.js **22.12 or later**
- npm
- Access to the authorized Supabase project
- Access to the linked Vercel project for pulling environment variables and deployment

## Local development

1. Clone the repository.
2. Install dependencies.
3. Create a local environment file using the variables below.
4. Start the Vite development server.

```bash
git clone https://github.com/blimpMac/IncomeReport.git
cd IncomeReport
npm install
cp .env.example .env.local
npm run dev
```

The Vite development server prints the local URL (normally `http://localhost:5173`).

### Environment variables

Create `.env.local` locally. Do not commit real credentials.

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
VITE_APP_NAME=E-WORKS Income Report
```

The repository's `.env.example` contains placeholder values. In an authorized Vercel-linked environment, the development environment can be pulled with:

```bash
npx vercel link
npm run env:pull
```

## Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Vite development server |
| `npm run build` | Create the production build in `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run env:pull` | Pull Vercel Development environment variables into `.env.local` |

Before opening a pull request or deploying a code change, run:

```bash
npm run build
```

## Supabase migrations

Database migrations are stored in `supabase/migrations/`. The migrations are designed around the E-WORKS `income_*` namespace and are separate from the RFP application's tables.

| Migration | Purpose |
| --- | --- |
| `20261029_income_report.sql` | Base IncomeReport tables, views, reporting functions, and RLS |
| `20261029_source_archive.sql` | Source archive tables and source lineage |
| `20261029_secure_public_upload.sql` | Validated login-free QuickBooks upload RPCs and browser permissions |
| `20261029_harden_source_archive.sql` | Browser restrictions and supporting archive indexes |
| `20261029_master_workbook_reference_sync.sql` | Master workbook reference-data synchronization |
| `20261030_dashboard_month_sof_filters.sql` | Dashboard month and SOF filtering |
| `20261104_approved_cost_mapping_and_breakdown.sql` | Approved cost mapping and cost breakdown support |
| `20261104_fix_master_workbook_reference_delete.sql` | Reference-data delete handling |
| `20261104_reclassify_overhead_cost_account.sql` | Overhead account classification |
| `20261123_income_monthly_project_summary.sql` | Monthly project summary reporting |
| `20261126_company_scoped_qb_uploads.sql` | Company-scoped QuickBooks uploads and reporting |
| `20261126_dedupe_overlapping_qb_uploads.sql` | Deduplication support for overlapping QuickBooks imports |
| `20261126_financial_monitor_budget_project_enhancements.sql` | Financial monitor, budget, and project analysis enhancements |

Apply migrations only to the intended Supabase project and review the SQL before execution. Do not run these migrations against the RFP database or another unrelated project.

## Deployment

The production site is hosted on Vercel:

- Production URL: https://e-works-income-report.vercel.app/
- Git repository: https://github.com/blimpMac/IncomeReport
- Production branch: `main`

The Vercel project is connected to the repository. Commits pushed to `main` are eligible for production deployment when the Vercel project and deployment limits permit. Verify the deployment status and deployed commit in Vercel before treating a change as live.

## Operational notes

- Keep business logic and database access in the existing application modules; avoid duplicating query logic across pages.
- Use company-scoped queries for company-specific transaction and reporting data.
- Preserve existing `income_*` data and review migration effects before changing database objects.
- Do not use production data as test fixtures or upload dummy transactions to the live database.
- For UI changes, check desktop and narrow/mobile widths and confirm that tables and filters remain usable.
- A successful local build does not by itself prove that the production deployment completed successfully.
