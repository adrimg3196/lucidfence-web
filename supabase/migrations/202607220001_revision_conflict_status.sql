begin;

create or replace function public.save_workspace_state(target_workspace_id uuid, expected_revision bigint, new_payload jsonb)
returns public.workspace_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_state public.workspace_state;
begin
  if auth.uid() is null or not public.can_write_workspace(target_workspace_id) then
    raise exception 'workspace write denied' using errcode = '42501';
  end if;
  if jsonb_typeof(new_payload) <> 'object' then
    raise exception 'workspace state must be a JSON object' using errcode = '22023';
  end if;
  if octet_length(new_payload::text) > 1048576 then
    raise exception 'workspace state exceeds 1 MiB' using errcode = '22001';
  end if;
  if expected_revision < 1 then
    raise exception 'invalid expected revision' using errcode = '22023';
  end if;

  update public.workspace_state
  set payload = new_payload,
      revision = revision + 1,
      updated_by = auth.uid(),
      updated_at = now()
  where workspace_id = target_workspace_id
    and revision = expected_revision
  returning * into saved_state;

  if not found then
    raise sqlstate 'PT409' using message = 'workspace revision conflict';
  end if;
  return saved_state;
end;
$$;

revoke all on function public.save_workspace_state(uuid, bigint, jsonb) from public;
grant execute on function public.save_workspace_state(uuid, bigint, jsonb) to authenticated;

commit;
