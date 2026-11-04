-- Account classification correction for the E-WORKS finance dashboard.
-- Reclassify only the literal QuickBooks account "Overhead Cost".
-- The client-side import classifier is updated separately in src/lib.js.
-- This is idempotent; re-applying it does not change already-corrected rows.
-- Never change debit, credit, SOF, upload, or historical transaction values.
do $reclassify$
declare
  old_count bigint;
  new_count bigint;
  old_debit numeric;
  new_debit numeric;
  old_credit numeric;
  new_credit numeric;
  old_total_cost numeric;
  new_total_cost numeric;
  old_revenue numeric;
  new_revenue numeric;
  old_sof220_cost numeric;
  new_sof220_cost numeric;
begin
  select
    count(*),
    coalesce(sum(debit),0), coalesce(sum(credit),0),
    coalesce(sum(case when category <> 'Revenue' then debit-credit else 0 end),0),
    coalesce(sum(case when category = 'Revenue' then credit-debit else 0 end),0),
    coalesce(sum(case when sof_base = '220' and category <> 'Revenue' then debit-credit else 0 end),0)
  into old_count,old_debit,old_credit,old_total_cost,old_revenue,old_sof220_cost
  from public.income_qb_transactions;

  update public.income_qb_transactions
  set category = 'Overhead'
  where category = 'Other'
    and lower(btrim(account)) = 'overhead cost';

  select
    count(*),
    coalesce(sum(debit),0), coalesce(sum(credit),0),
    coalesce(sum(case when category <> 'Revenue' then debit-credit else 0 end),0),
    coalesce(sum(case when category = 'Revenue' then credit-debit else 0 end),0),
    coalesce(sum(case when sof_base = '220' and category <> 'Revenue' then debit-credit else 0 end),0)
  into new_count,new_debit,new_credit,new_total_cost,new_revenue,new_sof220_cost
  from public.income_qb_transactions;

  if (old_count,old_debit,old_credit,old_total_cost,old_revenue,old_sof220_cost)
       is distinct from
     (new_count,new_debit,new_credit,new_total_cost,new_revenue,new_sof220_cost)
  then
    raise exception 'Account reclassification failed finance integrity checks; transaction rolled back.';
  end if;
end $reclassify$;
