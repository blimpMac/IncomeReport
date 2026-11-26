-- Financial monitor filters, date-unbounded project analysis, and budget dashboard.
-- This migration is committed for review only. It is NOT applied to production by this task.

create or replace function public.income_financial_monitor_month(
  p_month date,
  p_company text default 'Greenlight Power Inc.',
  p_category text default 'all'
) returns jsonb
language sql stable
set search_path = public
as $$
with bounds as (
  select date_trunc('month', p_month)::date as start_date,
         (date_trunc('month', p_month) + interval '1 month')::date as end_date
), filtered as (
  select t.*,
    case
      when upper(coalesce(t.division,'')) like '%EWOR%' then 'Eworks'
      when upper(coalesce(t.division,'')) like '%SUPPLY%' then 'Supply'
      when upper(coalesce(t.division,'')) like '%SERVIC%' then 'Service'
      when upper(coalesce(t.division,'')) like '%CIVIL%' then 'Civil'
      else 'Uncategorized'
    end as monitor_category
  from public.income_all_transactions t, bounds b
  where t.company = p_company
    and t.transaction_date >= b.start_date
    and t.transaction_date < b.end_date
    and (lower(coalesce(p_category,'all')) = 'all' or
      case
        when upper(coalesce(t.division,'')) like '%EWOR%' then 'Eworks'
        when upper(coalesce(t.division,'')) like '%SUPPLY%' then 'Supply'
        when upper(coalesce(t.division,'')) like '%SERVIC%' then 'Service'
        when upper(coalesce(t.division,'')) like '%CIVIL%' then 'Civil'
        else 'Uncategorized'
      end = p_category)
), agg as (
  select count(*)::bigint transaction_count,
    count(distinct nullif(trim(sof_base),''))::bigint unique_sof,
    count(*) filter (where nullif(trim(sof_base),'') is null)::bigint unassigned_count,
    round(coalesce(sum(case when category='Revenue' then credit-debit else 0 end),0),2) revenue,
    round(coalesce(sum(case when category='Materials' then debit-credit else 0 end),0),2) materials,
    round(coalesce(sum(case when category='Labor' then debit-credit else 0 end),0),2) labor,
    round(coalesce(sum(case when category='Overhead' then debit-credit else 0 end),0),2) overhead,
    round(coalesce(sum(case when category='Other' then debit-credit else 0 end),0),2) other_cost
  from filtered
), sof as (
  select coalesce(nullif(trim(sof_base),''),'UNASSIGNED') sof_base,
    coalesce(max(nullif(sof_label,'')),'Unassigned') sof_label,
    count(*)::bigint transaction_count,
    round(sum(case when category='Revenue' then credit-debit else 0 end),2) revenue,
    round(sum(case when category='Materials' then debit-credit else 0 end),2) materials,
    round(sum(case when category='Labor' then debit-credit else 0 end),2) labor,
    round(sum(case when category='Overhead' then debit-credit else 0 end),2) overhead,
    round(sum(case when category='Other' then debit-credit else 0 end),2) other_cost
  from filtered group by coalesce(nullif(trim(sof_base),''),'UNASSIGNED')
), accounts as (
  select category, coalesce(account,'Unspecified') account,
    round(sum(debit-credit),2) net_cost, count(*)::bigint transaction_count
  from filtered where category <> 'Revenue'
  group by category, coalesce(account,'Unspecified')
)
select jsonb_build_object(
  'report', (select to_jsonb(a) || jsonb_build_object(
    'total_cost', round(a.materials+a.labor+a.overhead+a.other_cost,2),
    'gross_profit', round(a.revenue-(a.materials+a.labor+a.overhead+a.other_cost),2),
    'margin_pct', case when a.revenue<>0 then round((a.revenue-(a.materials+a.labor+a.overhead+a.other_cost))/a.revenue*100,2) end
  ) from agg a),
  'sof_rows', coalesce((select jsonb_agg(to_jsonb(s) order by abs(s.revenue)+abs(s.materials+s.labor+s.overhead+s.other_cost) desc) from sof s),'[]'::jsonb),
  'cost_accounts', coalesce((select jsonb_agg(to_jsonb(a) order by abs(a.net_cost) desc) from accounts a),'[]'::jsonb)
);
$$;

create or replace function public.income_project_analysis_summary_v2(
  p_start_date date default null,
  p_end_date date default null,
  p_company text default 'Greenlight Power Inc.',
  p_category text default 'all'
) returns table(
  project_key text, division text, project_group text, sof_label text, sof_key text, sof_base text,
  transaction_count bigint, revenue numeric, materials numeric, labor numeric, overhead numeric, other numeric, accounts jsonb
)
language sql stable
set search_path = public
as $$
with scoped as (
  select t.*,
    coalesce(nullif(t.sof_base,''),nullif(t.sof_key,''),nullif(t.project_group,''),'Unassigned') as pkey
  from public.income_all_transactions t
  where t.company = p_company
    and (p_start_date is null or t.transaction_date >= p_start_date)
    and (p_end_date is null or t.transaction_date <= p_end_date)
    and (lower(coalesce(p_category,'all'))='all' or
      case
        when upper(coalesce(t.division,'')) like '%EWOR%' then 'Eworks'
        when upper(coalesce(t.division,'')) like '%SUPPLY%' then 'Supply'
        when upper(coalesce(t.division,'')) like '%SERVIC%' then 'Service'
        when upper(coalesce(t.division,'')) like '%CIVIL%' then 'Civil'
        else 'Uncategorized'
      end = p_category)
), project_totals as (
  select pkey, max(division) division, max(project_group) project_group,
    max(sof_label) sof_label, max(sof_key) sof_key, max(sof_base) sof_base,
    count(*)::bigint transaction_count,
    round(sum(case when category='Revenue' then credit-debit else 0 end),2) revenue,
    round(sum(case when category='Materials' then debit-credit else 0 end),2) materials,
    round(sum(case when category='Labor' then debit-credit else 0 end),2) labor,
    round(sum(case when category='Overhead' then debit-credit else 0 end),2) overhead,
    round(sum(case when category not in ('Revenue','Materials','Labor','Overhead') then debit-credit else 0 end),2) other
  from scoped group by pkey
), account_totals as (
  select pkey, coalesce(nullif(account,''),'Unspecified') account,
    round(sum(debit-credit),2) value
  from scoped where category <> 'Revenue'
  group by pkey, coalesce(nullif(account,''),'Unspecified')
), account_json as (
  select pkey, jsonb_agg(jsonb_build_object('account',account,'value',value) order by abs(value) desc) accounts
  from account_totals group by pkey
)
select p.pkey,p.division,p.project_group,p.sof_label,p.sof_key,p.sof_base,
  p.transaction_count,p.revenue,p.materials,p.labor,p.overhead,p.other,
  coalesce(a.accounts,'[]'::jsonb)
from project_totals p left join account_json a using(pkey)
order by p.project_group nulls last,p.pkey;
$$;

create or replace function public.income_project_transaction_page_v2(
  p_start_date date,
  p_end_date date,
  p_project_key text,
  p_company text default 'Greenlight Power Inc.',
  p_category text default 'all',
  p_limit integer default 50,
  p_offset integer default 0
) returns table(
  id bigint, transaction_date date, num text, name text, memo text, account text, type text, category text,
  debit numeric, credit numeric, sof_label text, sof_key text, sof_base text, project_group text
)
language sql stable
set search_path = public
as $$
select t.id,t.transaction_date,t.num,t.name,t.memo,t.account,t.type,t.category,t.debit,t.credit,
  t.sof_label,t.sof_key,t.sof_base,t.project_group
from public.income_all_transactions t
where t.company=p_company
  and (p_start_date is null or t.transaction_date>=p_start_date)
  and (p_end_date is null or t.transaction_date<=p_end_date)
  and coalesce(nullif(t.sof_base,''),nullif(t.sof_key,''),nullif(t.project_group,''),'Unassigned')=p_project_key
  and (lower(coalesce(p_category,'all'))='all' or
    case
      when upper(coalesce(t.division,'')) like '%EWOR%' then 'Eworks'
      when upper(coalesce(t.division,'')) like '%SUPPLY%' then 'Supply'
      when upper(coalesce(t.division,'')) like '%SERVIC%' then 'Service'
      when upper(coalesce(t.division,'')) like '%CIVIL%' then 'Civil'
      else 'Uncategorized'
    end=p_category)
order by t.transaction_date desc,t.id desc
limit greatest(1,least(coalesce(p_limit,50),100))
offset greatest(0,coalesce(p_offset,0));
$$;

create or replace function public.income_budget_projects(p_company text default 'Greenlight Power Inc.')
returns table(
  project_key text, project_name text, sof_base text, division text, construction_classification text,
  contract_value numeric, materials_budget numeric, labor_budget numeric, overhead_budget numeric,
  allocated_budget numeric, actual_cost numeric, transaction_count bigint
)
language sql stable
set search_path = public
as $$
with refs as (
  select distinct on (coalesce(nullif(sof_base,''),nullif(sof_key,'')))
    coalesce(nullif(sof_base,''),nullif(sof_key,'')) as pkey,
    project_name, materials_budget, labor_budget, overhead_budget, total_cost_budget,
    contract_value, construction_classification
  from public.income_reference_projects
  where coalesce(nullif(sof_base,''),nullif(sof_key,'')) is not null
  order by coalesce(nullif(sof_base,''),nullif(sof_key,'')),source_updated_at desc,id desc
), actuals as (
  select coalesce(nullif(sof_base,''),nullif(sof_key,'')) pkey,
    max(division) division,
    round(sum(case when category<>'Revenue' then debit-credit else 0 end),2) actual_cost,
    count(*) filter(where category<>'Revenue')::bigint transaction_count
  from public.income_all_transactions
  where company=p_company and coalesce(nullif(sof_base,''),nullif(sof_key,'')) is not null
  group by coalesce(nullif(sof_base,''),nullif(sof_key,''))
)
select r.pkey,r.project_name,r.pkey,a.division,r.construction_classification,
  coalesce(r.contract_value,0),coalesce(r.materials_budget,0),coalesce(r.labor_budget,0),
  coalesce(r.overhead_budget,0),coalesce(r.total_cost_budget,0),coalesce(a.actual_cost,0),
  coalesce(a.transaction_count,0)
from refs r left join actuals a using(pkey)
where coalesce(r.total_cost_budget,0)>0
order by r.project_name nulls last,r.pkey;
$$;

grant execute on function public.income_financial_monitor_month(date,text,text) to anon, authenticated;
grant execute on function public.income_project_analysis_summary_v2(date,date,text,text) to anon, authenticated;
grant execute on function public.income_project_transaction_page_v2(date,date,text,text,text,integer,integer) to anon, authenticated;
grant execute on function public.income_budget_projects(text) to anon, authenticated;
notify pgrst, 'reload schema';
