begin;

-- Rotate the RPC verifier to a dedicated deployment secret. The preimage lives only in Vercel.
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
        <> 'afe834574a582b578a3e58748b28e45ec8531933aeaf76100cd5fae6fd9ca971' then
    raise exception 'workspace connector server proof denied' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.verify_uem_connector_server_proof(text) from public;

commit;
