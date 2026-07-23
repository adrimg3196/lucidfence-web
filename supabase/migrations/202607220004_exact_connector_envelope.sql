begin;

alter table public.workspace_uem_connectors
  drop constraint workspace_uem_connectors_sealed_config_check;

alter table public.workspace_uem_connectors
  add constraint workspace_uem_connectors_sealed_config_check
  check (char_length(sealed_config) = 10966);

commit;
