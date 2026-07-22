begin;

create extension if not exists pgcrypto with schema extensions;

-- The preimage is derived from Vercel's encrypted vault key and never stored in PostgreSQL.
-- This verifier is safe to keep in source control and prevents JWT-only direct RPC access.
create or replace function public.verify_uem_connector_server_proof(connector_server_proof text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if connector_server_proof is null
     or char_length(connector_server_proof) <> 43
     or encode(extensions.digest(pg_catalog.convert_to(connector_server_proof, 'UTF8'), 'sha256'), 'hex')
        <> 'dfe2b84ad33efeb464e5f3b84fab3bddff7f38c3f3dad0cdbdbab89e5f6dd2b4' then
    raise exception 'workspace connector server proof denied' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.verify_uem_connector_server_proof(text) from public;

-- Remove every JWT-only signature before publishing proof-gated replacements.
revoke all on function public.load_workspace_uem_connector(uuid, text) from authenticated;
revoke all on function public.upsert_workspace_uem_connector(uuid, text, text, text) from authenticated;
revoke all on function public.delete_workspace_uem_connector(uuid, text) from authenticated;
drop function public.load_workspace_uem_connector(uuid, text);
drop function public.upsert_workspace_uem_connector(uuid, text, text, text);
drop function public.delete_workspace_uem_connector(uuid, text);

create function public.load_workspace_uem_connector(
  target_workspace_id uuid,
  connector_provider text,
  connector_server_proof text
)
returns table (provider text, sealed_config text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.can_write_workspace(target_workspace_id) then
    raise exception 'workspace connector use denied' using errcode = '42501';
  end if;
  perform public.verify_uem_connector_server_proof(connector_server_proof);
  if connector_provider not in ('all', 'fleetdm', 'applivery', 'intune', 'jamf', 'custom-gateway') then
    raise exception 'unsupported connector provider' using errcode = '22023';
  end if;
  return query
    select c.provider, c.sealed_config
    from public.workspace_uem_connectors c
    where c.workspace_id = target_workspace_id
      and (connector_provider = 'all' or c.provider = connector_provider)
    order by c.provider;
end;
$$;

create function public.upsert_workspace_uem_connector(
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
  if char_length(connector_sealed_config) not between 10000 and 12000
     or char_length(connector_config_hint) not between 1 and 120 then
    raise exception 'invalid connector envelope' using errcode = '22023';
  end if;

  insert into public.workspace_uem_connectors (workspace_id, provider, sealed_config, config_hint, updated_by, updated_at)
  values (target_workspace_id, connector_provider, connector_sealed_config, connector_config_hint, auth.uid(), now())
  on conflict (workspace_id, provider) do update
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

create function public.delete_workspace_uem_connector(
  target_workspace_id uuid,
  connector_provider text,
  connector_server_proof text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
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
  delete from public.workspace_uem_connectors
  where workspace_id = target_workspace_id and provider = connector_provider;
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

revoke all on function public.load_workspace_uem_connector(uuid, text, text) from public;
revoke all on function public.upsert_workspace_uem_connector(uuid, text, text, text, text) from public;
revoke all on function public.delete_workspace_uem_connector(uuid, text, text) from public;
grant execute on function public.load_workspace_uem_connector(uuid, text, text) to authenticated;
grant execute on function public.upsert_workspace_uem_connector(uuid, text, text, text, text) to authenticated;
grant execute on function public.delete_workspace_uem_connector(uuid, text, text) to authenticated;

commit;
