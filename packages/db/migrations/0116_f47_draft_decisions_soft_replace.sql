-- Substituição de decisões usa UPDATE lógico; a aplicação continua sem privilégio DELETE.
ALTER TABLE app.company_reference_mapping_entry ADD COLUMN active boolean NOT NULL DEFAULT true;
DROP INDEX app.company_reference_mapping_entry_pair_idx;
CREATE UNIQUE INDEX company_reference_mapping_entry_pair_idx ON app.company_reference_mapping_entry
  (tenant_id,mapping_id,account_id,coalesce(center_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE active;
REVOKE DELETE ON app.company_reference_mapping_entry,app.company_reference_mapping_center_snapshot FROM contaia_app;
DROP POLICY company_reference_mapping_entry_draft_delete ON app.company_reference_mapping_entry;
DROP POLICY company_reference_mapping_center_snapshot_draft_delete ON app.company_reference_mapping_center_snapshot;
