-- Operações desta fatia são humanas; matriz de infraestrutura também prova o contexto técnico confiável.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['company_reference_mapping','company_reference_mapping_entry','company_reference_mapping_center_snapshot','company_reference_mapping_import','company_reference_mapping_event'] LOOP
  EXECUTE format('DROP POLICY %I ON app.%I',t||'_select',t);
  EXECUTE format('DROP POLICY %I ON app.%I',t||'_insert',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND (app.contexto_humano() OR app.contexto_tecnico()) AND app.empresa_autorizada(company_id))',t||'_select',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND (app.contexto_humano() OR app.contexto_tecnico()) AND app.empresa_autorizada(company_id))',t||'_insert',t);
  IF t IN ('company_reference_mapping','company_reference_mapping_entry','company_reference_mapping_center_snapshot','company_reference_mapping_import') THEN
   EXECUTE format('DROP POLICY %I ON app.%I',t||'_update',t);
   EXECUTE format('CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id=app.tenant_atual() AND (app.contexto_humano() OR app.contexto_tecnico()) AND app.empresa_autorizada(company_id)) WITH CHECK (tenant_id=app.tenant_atual() AND (app.contexto_humano() OR app.contexto_tecnico()) AND app.empresa_autorizada(company_id))',t||'_update',t);
  END IF;
 END LOOP;
END $$;
