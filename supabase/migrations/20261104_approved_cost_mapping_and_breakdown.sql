-- User-approved QB account reclassification. Only changes category, not money.
-- This migration is idempotent and checks transaction integrity before commit.
do $safe_change$
declare
  before_rows bigint;
  after_rows bigint;
  before_debits numeric;
  after_debits numeric;
  before_credits numeric;
  after_credits numeric;
  before_cost numeric;
  after_cost numeric;
  before_sales numeric;
  after_sales numeric;
  before_sof220_cost numeric;
  after_sof220_cost numeric;
  still_unmapped bigint;
begin
  select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0),
    coalesce(sum(case when category <> 'Revenue' then debit-credit else 0 end),0),
    coalesce(sum(case when category = 'Revenue' then credit-debit else 0 end),0),
    coalesce(sum(case when sof_base='220' and category <> 'Revenue' then debit-credit else 0 end),0)
  into before_rows,before_debits,before_credits,before_cost,before_sales,before_sof220_cost
  from public.income_qb_transactions;

  update public.income_qb_transactions
  set category=case
    when lower(btrim(account)) in (
      'subcontractors fee-cost','outsourcing services-cost',
      'allowance cost','work leave benefits-cost'
    ) then 'Labor'
    else 'Overhead'
  end
  where category='Other'
    and lower(btrim(account)) in (
      'subcontractors fee-cost','outsourcing services-cost',
      'allowance cost','work leave benefits-cost',
      'overhead cost','servicing cost','office&janitorial supplies cost',
      'repairs and maintenance cost','electricity-cost','water-cost',
      'uniform benefits-cost','health and medical-cost','representation cost'
    );

  select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0),
    coalesce(sum(case when category <> 'Revenue' then debit-credit else 0 end),0),
    coalesce(sum(case when category = 'Revenue' then credit-debit else 0 end),0),
    coalesce(sum(case when sof_base='220' and category <> 'Revenue' then debit-credit else 0 end),0)
  into after_rows,after_debits,after_credits,after_cost,after_sales,after_sof220_cost
  from public.income_qb_transactions;

  if (before_rows,before_debits,before_credits,before_cost,before_sales,before_sof220_cost)
       is distinct from
     (after_rows,after_debits,after_credits,after_cost,after_sales,after_sof220_cost)
  then
    raise exception 'Financial integrity check failed, rolling back category changes.';
  end if;

  select count(*) into still_unmapped from public.income_qb_transactions
  where category='Other'
    and lower(btrim(account)) in (
      'subcontractors fee-cost','outsourcing services-cost',
      'allowance cost','work leave benefits-cost','overhead cost',
      'servicing cost','office&janitorial supplies cost','repairs and maintenance cost',
      'electricity-cost','water-cost','uniform benefits-cost',
      'health and medical-cost','representation cost'
    );
  if still_unmapped <> 0 then
    raise exception 'Approved account mappings still have % Other rows. Rolling back.',still_unmapped;
  end if;
end $safe_change$;

-- Read-only, server-aggregated source for the Cost Comparison dropdown.
-- Uses the SAME ready transactions view as the financial summary to avoid
-- 1,000-row browser pagination limits or including superseded uploads.
create or replace function public.income_cost_account_breakdown(p_sof_base text default null)
returns table (
  category text,
  account text,
  transaction_count bigint,
  debit numeric,
  credit numeric,
  net_cost numeric
)
language sql stable security invoker
set search_path = ''
as $breakdown$
  select
    t.category,
    coalesce(nullif(btrim(t.account),''),'Unspecified') as account,
    count(*)::bigint as transaction_count,
    round(sum(t.debit),2) as debit,
    round(sum(t.credit),2) as credit,
    round(sum(t.debit-t.credit),2) as net_cost
  from public.income_transactions_ready t
  where t.category <> 'Revenue'
    and (p_sof_base is null or t.sof_base = p_sof_base)
  group by t.category,coalesce(nullif(btrim(t.account),''),'Unspecified')
  order by t.category,abs(sum(t.debit-t.credit)) desc,coalesce(nullif(btrim(t.account),''),'Unspecified');
$breakdown$;

revoke all on function public.income_cost_account_breakdown(text) from public;
grant execute on function public.income_cost_account_breakdown(text) to anon,authenticated;
