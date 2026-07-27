begin;

create table public.login_rate_limits (
  bucket_key text primary key check (bucket_key ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  failures integer not null check (failures between 1 and 5)
);

alter table public.login_rate_limits enable row level security;
alter table public.login_rate_limits force row level security;
revoke all on public.login_rate_limits from public, anon, authenticated;

create or replace function public.reserve_login_attempt(
  target_bucket_key text,
  connector_server_proof text
)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.login_rate_limits;
  now_at timestamptz := clock_timestamp();
  window_interval interval := interval '5 minutes';
begin
  perform public.verify_uem_connector_server_proof(connector_server_proof);
  if target_bucket_key is null or target_bucket_key !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid login bucket' using errcode = '22023';
  end if;

  -- Serialize only this opaque bucket across every Vercel instance/region.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_bucket_key, 0));
  delete from public.login_rate_limits where window_started_at + window_interval <= now_at;

  select * into current_row from public.login_rate_limits where bucket_key = target_bucket_key;
  if current_row.bucket_key is null then
    -- Never evict a live sanction: fail closed when the global bounded table is full.
    if (select count(*) from public.login_rate_limits) >= 4096 then
      return query select false, 300;
      return;
    end if;
    insert into public.login_rate_limits(bucket_key, window_started_at, failures)
    values (target_bucket_key, now_at, 1);
    return query select true, 0;
    return;
  end if;

  if current_row.failures >= 5 then
    return query select false, greatest(1, ceil(extract(epoch from (current_row.window_started_at + window_interval - now_at)))::integer);
    return;
  end if;

  update public.login_rate_limits set failures = failures + 1 where bucket_key = target_bucket_key;
  return query select true, 0;
end;
$$;

create or replace function public.finish_login_attempt(
  target_bucket_key text,
  outcome text,
  connector_server_proof text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.verify_uem_connector_server_proof(connector_server_proof);
  if target_bucket_key is null or target_bucket_key !~ '^[a-f0-9]{64}$' or outcome not in ('success', 'provider_error') then
    raise exception 'invalid login completion' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_bucket_key, 0));
  if outcome = 'success' then
    delete from public.login_rate_limits where bucket_key = target_bucket_key;
  else
    update public.login_rate_limits set failures = failures - 1
    where bucket_key = target_bucket_key and failures > 1;
    if not found then delete from public.login_rate_limits where bucket_key = target_bucket_key; end if;
  end if;
end;
$$;

revoke all on function public.reserve_login_attempt(text, text) from public, authenticated;
revoke all on function public.finish_login_attempt(text, text, text) from public, authenticated;
grant execute on function public.reserve_login_attempt(text, text) to anon;
grant execute on function public.finish_login_attempt(text, text, text) to anon;

commit;
