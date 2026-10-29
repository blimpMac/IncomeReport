-- Explicitly deny browser reads of the raw migration archive and cover archive foreign keys.

create index if not exists income_source_rows_import_id_idx
  on public.income_source_rows(import_id);

create index if not exists income_qb_uploads_uploaded_by_idx
  on public.income_qb_uploads(uploaded_by);

drop policy if exists income_source_imports_browser_deny on public.income_source_imports;
create policy income_source_imports_browser_deny
  on public.income_source_imports for select
  to anon, authenticated
  using (false);

drop policy if exists income_source_rows_browser_deny on public.income_source_rows;
create policy income_source_rows_browser_deny
  on public.income_source_rows for select
  to anon, authenticated
  using (false);
