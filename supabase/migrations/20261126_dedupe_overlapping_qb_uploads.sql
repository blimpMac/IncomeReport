-- Keep one canonical copy of QB rows across overlapping ready uploads.
-- Preserve repeated identical transaction lines within each upload by matching
-- occurrence numbers, and prefer the newest upload for each occurrence.
create or replace view public.income_transactions_ready
with (security_invoker = true) as
with source_rows as (
  select
    t.*,
    u.sheet_name,
    u.report_date,
    u.file_name,
    u.created_at as upload_created_at,
    md5(jsonb_build_array(
      t.division, t.project_group, t.sof_label, t.sof_key, t.sof_base,
      t.type, t.transaction_date, t.num, t.name, t.memo, t.account,
      t.debit, t.credit, t.balance
    )::text) as row_signature,
    row_number() over (
      partition by u.id, md5(jsonb_build_array(
        t.division, t.project_group, t.sof_label, t.sof_key, t.sof_base,
        t.type, t.transaction_date, t.num, t.name, t.memo, t.account,
        t.debit, t.credit, t.balance
      )::text)
      order by t.source_row, t.id
    ) as occurrence_number
  from public.income_qb_transactions t
  join public.income_qb_uploads u on u.id = t.upload_id
  where u.status = 'ready'
),
preferred_rows as (
  select *,
    row_number() over (
      partition by row_signature, occurrence_number
      order by upload_created_at desc, upload_id desc
    ) as upload_preference
  from source_rows
)
select
  id, upload_id, source_row, division, project_group, sof_label, sof_key,
  sof_base, type, transaction_date, num, name, memo, account, debit, credit,
  balance, category, created_at, sheet_name, report_date, file_name
from preferred_rows
where upload_preference = 1;

revoke all on table public.income_transactions_ready from anon;
grant select on table public.income_transactions_ready to authenticated;
