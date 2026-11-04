-- Fix Reference Data Master Workbook Sync failing with:
--   DELETE requires a WHERE clause
--
-- pg_safeupdate rejects the unqualified full-table DELETE in the previously
-- deployed income_replace_reference_projects RPC. The existing RPC already
-- validates its upload payload and executes the replacement transactionally.
--
-- Update only that SQL fragment, preserving the currently deployed function
-- arguments, permissions, transaction behavior, and import audit logging.
-- This migration does not delete or import any production data.
do $repair$
declare
  original_definition text;
  old_statement constant text := 'delete from public.income_reference_projects;';
  fixed_statement constant text := 'delete from public.income_reference_projects where id is not null;';
begin
  select pg_get_functiondef(
    'public.income_replace_reference_projects(jsonb,text,text,timestamptz,text)'::regprocedure
  ) into original_definition;

  if position(old_statement in original_definition) = 0 then
    if position(fixed_statement in original_definition) > 0 then
      return; -- Already applied.
    end if;
    raise exception 'Unexpected reference sync RPC definition; manual review required.';
  end if;

  execute replace(original_definition, old_statement, fixed_statement);
end
$repair$;
