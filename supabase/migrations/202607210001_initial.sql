begin;

create extension if not exists pgcrypto;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'operator', 'auditor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.workspace_state (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_members force row level security;
alter table public.workspace_state enable row level security;
alter table public.workspace_state force row level security;

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
  );
$$;

create or replace function public.can_write_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
      and membership.role in ('owner', 'admin', 'operator')
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.can_write_workspace(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.can_write_workspace(uuid) to authenticated;

create policy workspaces_select_member
on public.workspaces for select
to authenticated
using (public.is_workspace_member(id));

create policy members_select_member
on public.workspace_members for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy state_select_member
on public.workspace_state for select
to authenticated
using (public.is_workspace_member(workspace_id));

create or replace function public.create_workspace(workspace_name text)
returns public.workspaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  normalized_name text := btrim(workspace_name);
  generated_slug text;
  new_workspace public.workspaces;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(normalized_name) < 2 or char_length(normalized_name) > 120 then
    raise exception 'workspace name must contain 2 to 120 characters' using errcode = '22023';
  end if;
  if (
    select count(*)
    from public.workspace_members membership
    where membership.user_id = actor and membership.role = 'owner'
  ) >= 20 then
    raise exception 'workspace ownership limit reached' using errcode = '54000';
  end if;

  generated_slug := trim(both '-' from regexp_replace(lower(normalized_name), '[^a-z0-9]+', '-', 'g'));
  generated_slug := left(coalesce(nullif(generated_slug, ''), 'workspace'), 54) || '-' || substr(gen_random_uuid()::text, 1, 8);

  insert into public.workspaces (name, slug, created_by)
  values (normalized_name, generated_slug, auth.uid())
  returning * into new_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace.id, auth.uid(), 'owner');

  insert into public.workspace_state (workspace_id, payload, revision, updated_by)
  values (new_workspace.id, '{}'::jsonb, 1, auth.uid());

  return new_workspace;
end;
$$;

revoke all on public.workspaces from anon;
revoke all on public.workspace_members from anon;
revoke all on public.workspace_state from anon;
revoke all on public.workspaces from authenticated;
revoke all on public.workspace_members from authenticated;
revoke all on public.workspace_state from authenticated;
grant select on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select on public.workspace_state to authenticated;

revoke all on function public.create_workspace(text) from public;
grant execute on function public.create_workspace(text) to authenticated;

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
    raise exception 'workspace revision conflict' using errcode = '40001';
  end if;
  return saved_state;
end;
$$;

revoke all on function public.save_workspace_state(uuid, bigint, jsonb) from public;
grant execute on function public.save_workspace_state(uuid, bigint, jsonb) to authenticated;

commit;
