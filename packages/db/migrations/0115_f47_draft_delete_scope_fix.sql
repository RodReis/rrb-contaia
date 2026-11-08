DROP POLICY company_reference_mapping_entry_draft_delete ON app.company_reference_mapping_entry;
CREATE POLICY company_reference_mapping_entry_draft_delete ON app.company_reference_mapping_entry FOR DELETE
USING (tenant_id=app.tenant_atual() AND app.contexto_humano() AND app.empresa_autorizada(company_id)
  AND EXISTS (SELECT 1 FROM app.company_reference_mapping m WHERE m.id=company_reference_mapping_entry.mapping_id
    AND m.tenant_id=company_reference_mapping_entry.tenant_id AND m.company_id=company_reference_mapping_entry.company_id AND m.status='DRAFT'));
DROP POLICY company_reference_mapping_center_snapshot_draft_delete ON app.company_reference_mapping_center_snapshot;
CREATE POLICY company_reference_mapping_center_snapshot_draft_delete ON app.company_reference_mapping_center_snapshot FOR DELETE
USING (tenant_id=app.tenant_atual() AND app.contexto_humano() AND app.empresa_autorizada(company_id)
  AND EXISTS (SELECT 1 FROM app.company_reference_mapping m WHERE m.id=company_reference_mapping_center_snapshot.mapping_id
    AND m.tenant_id=company_reference_mapping_center_snapshot.tenant_id AND m.company_id=company_reference_mapping_center_snapshot.company_id AND m.status='DRAFT'));
