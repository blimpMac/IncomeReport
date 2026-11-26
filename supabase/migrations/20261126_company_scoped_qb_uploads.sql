-- Separate QuickBooks transaction datasets by owning company.
-- Existing historical uploads are retained and assigned to Greenlight for continuity;
-- future Gemcor imports must explicitly choose Gemcor in the upload screen.

alter table public.income_qb_uploads
  add column if not exists company text not null default 'Greenlight Power Inc.';

update public.income_qb_uploads
set company = 'Greenlight Power Inc.'
where company is null or btrim(company) = '';

alter table public.income_qb_uploads
  drop constraint if exists income_qb_uploads_company_check;
alter table public.income_qb_uploads
  add constraint income_qb_uploads_company_check
  check (company in ('Greenlight Power Inc.','Gemcor (Greenmetal Electric)'));

alter table public.income_qb_uploads
  drop constraint if exists income_qb_uploads_sheet_name_key;
create unique index if not exists income_qb_uploads_company_sheet_name_key
  on public.income_qb_uploads(company, sheet_name);
create index if not exists income_qb_uploads_company_ready_created_idx
  on public.income_qb_uploads(company, created_at desc)
  where status = 'ready';

drop function if exists public.income_begin_qb_upload(text,text,text,date,date,date);
create or replace function public.income_begin_qb_upload(
  p_file_name text,
  p_file_type text,
  p_sheet_name text,
  p_report_date date,
  p_min_date date default null,
  p_max_date date default null,
  p_company text default 'Greenlight Power Inc.'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_upload_id uuid;
  v_company text := coalesce(nullif(btrim(p_company),''),'Greenlight Power Inc.');
begin
  if lower(coalesce(p_file_type,'')) not in ('csv','xlsx','xls') then
    raise exception 'Unsupported file type';
  end if;
  if coalesce(trim(p_sheet_name),'') !~ '^QB [0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' then
    raise exception 'Invalid QB worksheet name';
  end if;
  if p_report_date is null then
    raise exception 'Report date is required';
  end if;
  if v_company not in ('Greenlight Power Inc.','Gemcor (Greenmetal Electric)') then
    raise exception 'Choose a valid company for this QuickBooks upload';
  end if;

  select id into v_upload_id
  from public.income_qb_uploads
  where company = v_company and sheet_name = p_sheet_name
  for update;

  if v_upload_id is null then
    insert into public.income_qb_uploads
      (file_name,file_type,sheet_name,report_date,detected_min_date,detected_max_date,status,transaction_count,uploaded_by,company)
    values
      (left(coalesce(p_file_name,'QB upload'),500),lower(p_file_type),p_sheet_name,p_report_date,p_min_date,p_max_date,'processing',0,null,v_company)
    returning id into v_upload_id;
  else
    delete from public.income_qb_transactions where upload_id = v_upload_id;
    update public.income_qb_uploads
    set file_name=left(coalesce(p_file_name,'QB upload'),500),
        file_type=lower(p_file_type),
        report_date=p_report_date,
        detected_min_date=p_min_date,
        detected_max_date=p_max_date,
        status='processing',
        error_message=null,
        transaction_count=0,
        uploaded_by=null,
        updated_at=now()
    where id=v_upload_id;
  end if;
  return v_upload_id;
end;
$$;

revoke all on function public.income_begin_qb_upload(text,text,text,date,date,date,text) from public;
grant execute on function public.income_begin_qb_upload(text,text,text,date,date,date,text) to anon, authenticated;

create or replace view public.income_all_transactions with (security_invoker=true) as
select
  t.id,t.upload_id,t.source_row,t.division,t.project_group,t.sof_label,t.sof_key,t.sof_base,
  t.type,t.transaction_date,t.num,t.name,t.memo,t.account,t.debit,t.credit,t.balance,t.category,
  u.company
from public.income_qb_transactions t
join public.income_qb_uploads u on u.id = t.upload_id
where t.upload_id in (
  select distinct on (company) id
  from public.income_qb_uploads
  where status = 'ready'
  order by company, created_at desc
);

notify pgrst, 'reload schema';
