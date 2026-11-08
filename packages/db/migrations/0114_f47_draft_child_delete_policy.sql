-- Exclusão somente durante edição do rascunho autorizado; o trigger também exige pai em DRAFT.
CREATE POLICY company_reference_mapping_entry_draft_delete ON app.company_reference_mapping_entry FOR DELETE
USING (tenant_id=app.tenant_atual() AND app.contexto_humano() AND app.empresa_autorizada(company_id)
  AND EXISTS (SELECT 1 FROM app.company_reference_mapping m WHERE m.id=mapping_id AND m.tenant_id=tenant_id AND m.company_id=company_id AND m.status='DRAFT'));
CREATE POLICY company_reference_mapping_center_snapshot_draft_delete ON app.company_reference_mapping_center_snapshot FOR DELETE
USING (tenant_id=app.tenant_atual() AND app.contexto_humano() AND app.empresa_autorizada(company_id)
  AND EXISTS (SELECT 1 FROM app.company_reference_mapping m WHERE m.id=mapping_id AND m.tenant_id=tenant_id AND m.company_id=company_id AND m.status='DRAFT'));
