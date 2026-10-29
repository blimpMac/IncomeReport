-- Keep the site login-free while routing QB batch replacement through validated RPCs.

create or replace function public.income_begin_qb_upload(
  p_file_name text,
  p_file_type text,
  p_sheet_name text,
  p_report_date date,
  p_min_date date default null,
  p_max_date date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_upload_id uuid;
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

  select id into v_upload_id
  from public.income_qb_uploads
  where sheet_name = p_sheet_name
  for update;

  if v_upload_id is null then
    insert into public.income_qb_uploads
      (file_name,file_type,sheet_name,report_date,detected_min_date,detected_max_date,status,transaction_count,uploaded_by)
    values
      (left(coalesce(p_file_name,'QB upload'),500),lower(p_file_type),p_sheet_name,p_report_date,p_min_date,p_max_date,'processing',0,null)
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

create or replace function public.income_finalize_qb_upload(
  p_upload_id uuid,
  p_transaction_count integer,
  p_error_message text default null
) returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not exists (select 1 from public.income_qb_uploads where id=p_upload_id) then
    raise exception 'Upload not found';
  end if;
  update public.income_qb_uploads
  set status=case when p_error_message is null then 'ready' else 'failed' end,
      transaction_count=greatest(coalesce(p_transaction_count,0),0),
      error_message=case when p_error_message is null then null else left(p_error_message,1000) end,
      updated_at=now()
  where id=p_upload_id;
end;
$$;

revoke all on function public.income_begin_qb_upload(text,text,text,date,date,date) from public;
revoke all on function public.income_finalize_qb_upload(uuid,integer,text) from public;
grant execute on function public.income_begin_qb_upload(text,text,text,date,date,date) to anon, authenticated;
grant execute on function public.income_finalize_qb_upload(uuid,integer,text) to anon, authenticated;

-- Browser clients may list uploads, but mutations are performed by the validated RPCs.
drop policy if exists income_uploads_public_all on public.income_qb_uploads;
drop policy if exists income_uploads_public_read on public.income_qb_uploads;
create policy income_uploads_public_read
  on public.income_qb_uploads for select to anon using (true);
revoke insert, update, delete on table public.income_qb_uploads from anon;
grant select on table public.income_qb_uploads to anon;

-- Transaction rows are inserted in browser-side chunks after income_begin_qb_upload returns an upload id.
-- Existing SELECT/INSERT transaction RLS policies remain in force.

-- Ensure one-time migration permissions are absent on normal deployments.
drop policy if exists temp_income_reference_insert on public.income_reference_projects;
drop policy if exists temp_income_source_rows_insert on public.income_source_rows;
revoke insert on table public.income_reference_projects from anon;
revoke insert on table public.income_source_rows from anon;
revoke usage, select on sequence public.income_reference_projects_id_seq from anon;
revoke usage, select on sequence public.income_source_rows_id_seq from anon;
