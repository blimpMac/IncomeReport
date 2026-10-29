-- Sync REFERENCE DATA from a user-selected Excel workbook into Supabase.
-- The browser reads the local file. This function has no Google Drive integration.
create or replace function public.income_replace_reference_projects(
  p_rows jsonb,
  p_file_name text,
  p_source_file_id text,
  p_source_modified_at timestamptz,
  p_confirmation text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_confirmation is distinct from 'REPLACE_REFERENCE_DATA' then
    raise exception 'Reference sync confirmation is invalid.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Reference sync payload must be a JSON array.';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 5000 then
    raise exception 'Reference sync row count % is outside the allowed range.', v_count;
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where coalesce((r->>'source_row')::integer,0) < 1 or coalesce(r->>'source_sheet','') <> 'REFERENCE DATA' or jsonb_typeof(r->'source_cells') is distinct from 'array') then
    raise exception 'Reference sync payload contains an invalid source row.';
  end if;

  insert into public.income_source_imports(source_type,source_file_id,source_file_name,source_modified_at,excluded_sheets,imported_sheets,source_nonempty_rows,reference_rows,qb_transactions,status,notes,completed_at)
  values('excel_upload',coalesce(nullif(p_source_file_id,''),gen_random_uuid()::text),coalesce(nullif(p_file_name,''),'Uploaded workbook'),p_source_modified_at,array['FORMAT']::text[],array['REFERENCE DATA']::text[],v_count,v_count,0,'ready','Reference Data replaced from a user-selected Excel workbook. Google Drive was not accessed or modified.',now());

  delete from public.income_reference_projects;

  insert into public.income_reference_projects(source_row,project_name,sof_number,sof_key,sof_base,po_contract,project_location,client_name,project_owner,construction_classification,scope_of_works,pic,contact_no,date_of_award,start_date,target_completion_date,contract_value,planned_pct,actual_pct,remarks,project_status,actual_completion_date,final_contract_value,certificate_of_completion,project_code,cancelled_date,materials_budget,labor_budget,overhead_budget,tpc_budget,total_cost_budget,source_updated_at,source_sheet,source_cells,source_file_id,source_modified_at)
  select x.source_row,nullif(x.project_name,''),nullif(x.sof_number,''),nullif(x.sof_key,''),nullif(x.sof_base,''),nullif(x.po_contract,''),nullif(x.project_location,''),nullif(x.client_name,''),nullif(x.project_owner,''),nullif(x.construction_classification,''),nullif(x.scope_of_works,''),nullif(x.pic,''),nullif(x.contact_no,''),x.date_of_award,x.start_date,x.target_completion_date,coalesce(x.contract_value,0),coalesce(x.planned_pct,0),coalesce(x.actual_pct,0),nullif(x.remarks,''),nullif(x.project_status,''),x.actual_completion_date,coalesce(x.final_contract_value,0),nullif(x.certificate_of_completion,''),nullif(x.project_code,''),x.cancelled_date,coalesce(x.materials_budget,0),coalesce(x.labor_budget,0),coalesce(x.overhead_budget,0),coalesce(x.tpc_budget,0),coalesce(x.total_cost_budget,0),now(),'REFERENCE DATA',x.source_cells,coalesce(nullif(p_source_file_id,''),p_file_name),p_source_modified_at
  from jsonb_to_recordset(p_rows) as x(source_row integer,project_name text,sof_number text,sof_key text,sof_base text,po_contract text,project_location text,client_name text,project_owner text,construction_classification text,scope_of_works text,pic text,contact_no text,date_of_award date,start_date date,target_completion_date date,contract_value numeric,planned_pct numeric,actual_pct numeric,remarks text,project_status text,actual_completion_date date,final_contract_value numeric,certificate_of_completion text,project_code text,cancelled_date date,materials_budget numeric,labor_budget numeric,overhead_budget numeric,tpc_budget numeric,total_cost_budget numeric,source_sheet text,source_cells jsonb);
  return v_count;
end;
$$;

revoke execute on function public.income_replace_reference_projects(jsonb,text,text,timestamptz,text) from public, authenticated;
grant execute on function public.income_replace_reference_projects(jsonb,text,text,timestamptz,text) to anon;
