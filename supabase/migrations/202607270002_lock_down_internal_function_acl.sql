begin;

-- These helpers are implementation details invoked only by function owners or
-- platform automation. Signed-in users must not call them directly via RPC.
revoke execute on function public.verify_uem_connector_server_proof(text) from authenticated;
revoke execute on function public.rls_auto_enable() from authenticated;

commit;
