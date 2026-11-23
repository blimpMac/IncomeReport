create or replace function public.income_monthly_project_summary(p_month date)
returns table(
  division text,
  project_group text,
  sof_key text,
  sof_base text,
  sof_label text,
  transaction_count bigint,
  revenue numeric,
  total_cost numeric,
  gross_profit numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(nullif(trim(t.division), ''), 'Uncategorized') as division,
    coalesce(nullif(trim(t.project_group), ''), 'Unassigned project') as project_group,
    coalesce(nullif(trim(t.sof_key), ''), 'UNASSIGNED') as sof_key,
    nullif(trim(t.sof_base), '') as sof_base,
    coalesce(max(nullif(trim(t.sof_label), '')), 'Unassigned') as sof_label,
    count(*)::bigint as transaction_count,
    round(coalesce(sum(case when t.category = 'Revenue' then t.credit - t.debit else 0 end), 0), 2) as revenue,
    round(coalesce(sum(case when t.category <> 'Revenue' then t.debit - t.credit else 0 end), 0), 2) as total_cost,
    round(coalesce(sum(t.credit - t.debit), 0), 2) as gross_profit
  from public.income_transactions_ready t
  where t.transaction_date >= date_trunc('month', p_month)::date
    and t.transaction_date < (date_trunc('month', p_month) + interval '1 month')::date
  group by
    coalesce(nullif(trim(t.division), ''), 'Uncategorized'),
    coalesce(nullif(trim(t.project_group), ''), 'Unassigned project'),
    coalesce(nullif(trim(t.sof_key), ''), 'UNASSIGNED'),
    nullif(trim(t.sof_base), '')
  order by division, project_group, sof_base nulls last, sof_key;
$$;

revoke all on function public.income_monthly_project_summary(date) from public;
grant execute on function public.income_monthly_project_summary(date) to anon, authenticated;
