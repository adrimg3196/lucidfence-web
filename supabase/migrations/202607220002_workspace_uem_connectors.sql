begin;

create table public.workspace_uem_connectors (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('fleetdm', 'applivery', 'intune', 'jamf', 'custom-gateway')),
  sealed_config text not null check (char_length(sealed_config) between 10000 and 12000),
  config_hint text not null check (char_length(config_hint) between 1 and 120),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, provider)
);

alter table public.workspace_uem_connectors enable row level security;
alter table public.workspace_uem_connectors force row level security;

-- No direct table privileges: every operation passes an explicit membership/role gate below.
revoke all on public.workspace_uem_connectors from anon;
revoke all on public.workspace_uem_connectors from authenticated;

create or replace function public.list_workspace_uem_connectors(target_workspace_id uuid)
returns table (provider text, config_hint text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_workspace_member(target_workspace_id) then
    raise exception 'workspace connector read denied' using errcode = '42501';
  end if;
  return query
    select c.provider, c.config_hint, c.updated_at
    from public.workspace_uem_connectors c
    where c.workspace_id = target_workspace_id
    order by c.provider;
end;
$$;

create or replace function public.load_workspace_uem_connector(target_workspace_id uuid, connector_provider text)
returns table (provider text, sealed_config text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.can_write_workspace(target_workspace_id) then
    raise exception 'workspace connector use denied' using errcode = '42501';
  end if;
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

create or replace function public.upsert_workspace_uem_connector(
  target_workspace_id uuid,
  connector_provider text,
  connector_sealed_config text,
  connector_config_hint text
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

create or replace function public.delete_workspace_uem_connector(target_workspace_id uuid, connector_provider text)
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
  delete from public.workspace_uem_connectors
  where workspace_id = target_workspace_id and provider = connector_provider;
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

revoke all on function public.list_workspace_uem_connectors(uuid) from public;
revoke all on function public.load_workspace_uem_connector(uuid, text) from public;
revoke all on function public.upsert_workspace_uem_connector(uuid, text, text, text) from public;
revoke all on function public.delete_workspace_uem_connector(uuid, text) from public;
grant execute on function public.list_workspace_uem_connectors(uuid) to authenticated;
grant execute on function public.load_workspace_uem_connector(uuid, text) to authenticated;
grant execute on function public.upsert_workspace_uem_connector(uuid, text, text, text) to authenticated;
grant execute on function public.delete_workspace_uem_connector(uuid, text) to authenticated;

commit;
