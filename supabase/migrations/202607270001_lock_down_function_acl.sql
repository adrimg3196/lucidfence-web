begin;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Remove that
-- default for future migrations and explicitly close every current public RPC.
alter default privileges in schema public revoke execute on functions from public;
revoke execute on all functions in schema public from public, anon;

-- Browser-callable RPCs. Every function still performs its own auth.uid(), role,
-- revision, workspace-membership and/or deployment-proof checks.
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.save_workspace_state(uuid, bigint, jsonb) to authenticated;
grant execute on function public.list_workspace_uem_connectors(uuid) to authenticated;
grant execute on function public.load_workspace_uem_connector(uuid, text, text) to authenticated;
grant execute on function public.upsert_workspace_uem_connector(uuid, text, text, text, text) to authenticated;
grant execute on function public.delete_workspace_uem_connector(uuid, text, text) to authenticated;

-- Policy helpers must remain executable by authenticated because RLS policies
-- call them while evaluating the signed-in user's rows. They are boolean-only
-- and bind exclusively to auth.uid().
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.can_write_workspace(uuid) to authenticated;

-- Internal helpers deliberately receive no anon/authenticated grant:
-- public.verify_uem_connector_server_proof(text)
-- public.rls_auto_enable()

commit;
