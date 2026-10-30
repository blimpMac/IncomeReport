create or replace function public.income_dashboard_filtered(
  p_month date default null,
  p_sof_base text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $function$
with filtered as (
  select t.*
  from public.income_transactions_ready t
  where (
    p_month is null
    or (
      t.transaction_date >= date_trunc('month', p_month)::date
      and t.transaction_date < (date_trunc('month', p_month) + interval '1 month')::date
    )
  )
  and (
    p_sof_base is null
    or nullif(trim(t.sof_base), '') = p_sof_base
  )
),
agg as (
  select
    count(*)::bigint transaction_count,
    count(distinct nullif(trim(sof_base), ''))::bigint unique_sof,
    count(*) filter (where sof_base is null or trim(sof_base) = '')::bigint unassigned_count,
    round(coalesce(sum(case when category = 'Revenue' then credit - debit else 0 end), 0), 2) revenue,
    round(coalesce(sum(case when category = 'Materials' then debit - credit else 0 end), 0), 2) materials,
    round(coalesce(sum(case when category = 'Labor' then debit - credit else 0 end), 0), 2) labor,
    round(coalesce(sum(case when category = 'Overhead' then debit - credit else 0 end), 0), 2) overhead,
    round(coalesce(sum(case when category = 'Other' then debit - credit else 0 end), 0), 2) other_cost
  from filtered
),
accounts as (
  select coalesce(account, 'Unspecified') account, round(sum(debit - credit), 2) net_cost
  from filtered
  where category <> 'Revenue'
  group by coalesce(account, 'Unspecified')
  order by abs(sum(debit - credit)) desc
  limit 5
),
sof_grouped as (
  select
    coalesce(nullif(trim(sof_base), ''), 'UNASSIGNED') sof_base,
    coalesce(max(nullif(sof_label, '')), 'Unassigned') sof_label,
    count(*)::bigint transaction_count,
    round(sum(case when category = 'Revenue' then credit - debit else 0 end), 2) revenue,
    round(sum(case when category = 'Materials' then debit - credit else 0 end), 2) materials,
    round(sum(case when category = 'Labor' then debit - credit else 0 end), 2) labor,
    round(sum(case when category = 'Overhead' then debit - credit else 0 end), 2) overhead,
    round(sum(case when category = 'Other' then debit - credit else 0 end), 2) other_cost
  from filtered
  group by coalesce(nullif(trim(sof_base), ''), 'UNASSIGNED')
),
sof_rows as (
  select
    sof_base,
    sof_label,
    transaction_count,
    revenue,
    materials,
    labor,
    overhead,
    other_cost,
    round(materials + labor + overhead + other_cost, 2) total_cost,
    round(revenue - (materials + labor + overhead + other_cost), 2) gross_profit,
    case when revenue <> 0 then round((revenue - (materials + labor + overhead + other_cost)) / revenue * 100, 2) end margin_pct
  from sof_grouped
),
months as (
  select distinct to_char(transaction_date, 'YYYY-MM') month_value
  from public.income_transactions_ready
  where transaction_date is not null
),
available_sofs as (
  select
    nullif(trim(sof_base), '') sof_base,
    max(nullif(sof_label, '')) sof_label
  from public.income_transactions_ready
  where nullif(trim(sof_base), '') is not null
  group by nullif(trim(sof_base), '')
)
select jsonb_build_object(
  'report', jsonb_build_object(
    'transaction_count', a.transaction_count,
    'unique_sof', a.unique_sof,
    'unassigned_count', a.unassigned_count,
    'revenue', a.revenue,
    'materials', a.materials,
    'labor', a.labor,
    'overhead', a.overhead,
    'other_cost', a.other_cost,
    'total_cost', round(a.materials + a.labor + a.overhead + a.other_cost, 2),
    'gross_profit', round(a.revenue - (a.materials + a.labor + a.overhead + a.other_cost), 2),
    'margin_pct', case when a.revenue <> 0 then round((a.revenue - (a.materials + a.labor + a.overhead + a.other_cost)) / a.revenue * 100, 2) end,
    'top_cost_accounts', coalesce((select jsonb_agg(jsonb_build_object('account', account, 'net_cost', net_cost)) from accounts), '[]'::jsonb)
  ),
  'sof_rows', coalesce((
    select jsonb_agg(to_jsonb(s) order by abs(s.revenue) + abs(s.total_cost) desc)
    from sof_rows s
  ), '[]'::jsonb),
  'months', coalesce((select jsonb_agg(month_value order by month_value desc) from months), '[]'::jsonb),
  'sofs', coalesce((
    select jsonb_agg(
      jsonb_build_object('sof_base', sof_base, 'sof_label', coalesce(sof_label, ''))
      order by case when sof_base ~ '^\d+$' then sof_base::int else 2147483647 end, sof_base
    )
    from available_sofs
  ), '[]'::jsonb)
)
from agg a;
$function$;

grant execute on function public.income_dashboard_filtered(date, text) to anon, authenticated;
