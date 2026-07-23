begin;

create or replace function public.upsert_workspace_uem_connector(
  target_workspace_id uuid,
  connector_provider text,
  connector_sealed_config text,
  connector_config_hint text,
  connector_server_proof text
)
returns table (provider text, config_hint text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'workspace connector management denied' using errcode = '42501';
  end if;
  perform public.verify_uem_connector_server_proof(connector_server_proof);
  if connector_provider not in ('fleetdm', 'applivery', 'intune', 'jamf', 'custom-gateway') then
    raise exception 'unsupported connector provider' using errcode = '22023';
  end if;
  if char_length(connector_sealed_config) <> 10966
     or char_length(connector_config_hint) not between 1 and 120 then
    raise exception 'invalid connector envelope' using errcode = '22023';
  end if;

  insert into public.workspace_uem_connectors (workspace_id, provider, sealed_config, config_hint, updated_by, updated_at)
  values (target_workspace_id, connector_provider, connector_sealed_config, connector_config_hint, auth.uid(), now())
  on conflict on constraint workspace_uem_connectors_pkey do update
    set sealed_config = excluded.sealed_config,
        config_hint = excluded.config_hint,
        updated_by = auth.uid(),
        updated_at = now();

  return query
    select c.provider, c.config_hint, c.updated_at
    from public.workspace_uem_connectors c
    where c.workspace_id = target_workspace_id and c.provider = connector_provider;
end;
$$;

commit;
