-- Modelos pertencem ao escritório: RLS exige contexto humano válido no tenant.
CREATE OR REPLACE FUNCTION app.accounting_statement_template_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE chave text;
BEGIN
 FOREACH chave IN ARRAY ARRAY['id','tenant_id','template_id','version_id','company_id'] LOOP
  IF (to_jsonb(NEW)->>chave) IS DISTINCT FROM (to_jsonb(OLD)->>chave) THEN
   RAISE EXCEPTION 'ACCOUNTING_STATEMENT_TEMPLATE_SCOPE_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
 END LOOP;
 RETURN NEW;
END; $$;

CREATE TRIGGER accounting_statement_template_scope BEFORE UPDATE ON app.accounting_statement_template FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_template_scope_guard();
CREATE TRIGGER accounting_statement_template_version_scope BEFORE UPDATE ON app.accounting_statement_template_version FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_template_scope_guard();
CREATE TRIGGER accounting_statement_template_line_scope BEFORE UPDATE ON app.accounting_statement_template_line FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_template_scope_guard();
CREATE TRIGGER accounting_statement_template_component_scope BEFORE UPDATE ON app.accounting_statement_template_component FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_template_scope_guard();
CREATE TRIGGER accounting_statement_template_event_scope BEFORE UPDATE ON app.accounting_statement_template_event FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_template_scope_guard();
CREATE TRIGGER accounting_statement_template_source_scope BEFORE UPDATE ON app.accounting_statement_template_source FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_template_scope_guard();
CREATE TRIGGER accounting_statement_template_application_scope BEFORE UPDATE ON app.accounting_statement_template_application FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_template_scope_guard();

DROP POLICY accounting_statement_template_select ON app.accounting_statement_template;
DROP POLICY accounting_statement_template_insert ON app.accounting_statement_template;
DROP POLICY accounting_statement_template_update ON app.accounting_statement_template;
CREATE POLICY accounting_statement_template_select ON app.accounting_statement_template FOR SELECT USING (tenant_id=app.tenant_atual() AND app.contexto_humano());
CREATE POLICY accounting_statement_template_insert ON app.accounting_statement_template FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.contexto_humano());
CREATE POLICY accounting_statement_template_update ON app.accounting_statement_template FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.contexto_humano()) WITH CHECK (tenant_id=app.tenant_atual() AND app.contexto_humano());

DROP POLICY accounting_statement_template_version_select ON app.accounting_statement_template_version;
DROP POLICY accounting_statement_template_version_insert ON app.accounting_statement_template_version;
DROP POLICY accounting_statement_template_version_update ON app.accounting_statement_template_version;
CREATE POLICY accounting_statement_template_version_select ON app.accounting_statement_template_version FOR SELECT USING (tenant_id=app.tenant_atual() AND app.contexto_humano());
CREATE POLICY accounting_statement_template_version_insert ON app.accounting_statement_template_version FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.contexto_humano());
CREATE POLICY accounting_statement_template_version_update ON app.accounting_statement_template_version FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.contexto_humano()) WITH CHECK (tenant_id=app.tenant_atual() AND app.contexto_humano());

DROP POLICY accounting_statement_template_line_select ON app.accounting_statement_template_line;
DROP POLICY accounting_statement_template_line_insert ON app.accounting_statement_template_line;
DROP POLICY accounting_statement_template_line_update ON app.accounting_statement_template_line;
CREATE POLICY accounting_statement_template_line_select ON app.accounting_statement_template_line FOR SELECT USING (tenant_id=app.tenant_atual() AND app.contexto_humano());
CREATE POLICY accounting_statement_template_line_insert ON app.accounting_statement_template_line FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.contexto_humano());
CREATE POLICY accounting_statement_template_line_update ON app.accounting_statement_template_line FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.contexto_humano()) WITH CHECK (tenant_id=app.tenant_atual() AND app.contexto_humano());

DROP POLICY accounting_statement_template_component_select ON app.accounting_statement_template_component;
DROP POLICY accounting_statement_template_component_insert ON app.accounting_statement_template_component;
DROP POLICY accounting_statement_template_component_update ON app.accounting_statement_template_component;
CREATE POLICY accounting_statement_template_component_select ON app.accounting_statement_template_component FOR SELECT USING (tenant_id=app.tenant_atual() AND app.contexto_humano());
CREATE POLICY accounting_statement_template_component_insert ON app.accounting_statement_template_component FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.contexto_humano());
CREATE POLICY accounting_statement_template_component_update ON app.accounting_statement_template_component FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.contexto_humano()) WITH CHECK (tenant_id=app.tenant_atual() AND app.contexto_humano());

DROP POLICY accounting_statement_template_event_select ON app.accounting_statement_template_event;
DROP POLICY accounting_statement_template_event_insert ON app.accounting_statement_template_event;
CREATE POLICY accounting_statement_template_event_select ON app.accounting_statement_template_event FOR SELECT USING (tenant_id=app.tenant_atual() AND app.contexto_humano());
CREATE POLICY accounting_statement_template_event_insert ON app.accounting_statement_template_event FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.contexto_humano());

DROP POLICY accounting_statement_template_source_select ON app.accounting_statement_template_source;
DROP POLICY accounting_statement_template_source_insert ON app.accounting_statement_template_source;
CREATE POLICY accounting_statement_template_source_select ON app.accounting_statement_template_source FOR SELECT USING (tenant_id=app.tenant_atual() AND app.contexto_humano() AND app.empresa_autorizada(company_id));
CREATE POLICY accounting_statement_template_source_insert ON app.accounting_statement_template_source FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.contexto_humano() AND app.empresa_autorizada(company_id));

DROP POLICY accounting_statement_template_application_select ON app.accounting_statement_template_application;
DROP POLICY accounting_statement_template_application_insert ON app.accounting_statement_template_application;
CREATE POLICY accounting_statement_template_application_select ON app.accounting_statement_template_application FOR SELECT USING (tenant_id=app.tenant_atual() AND app.contexto_humano() AND app.empresa_autorizada(company_id));
CREATE POLICY accounting_statement_template_application_insert ON app.accounting_statement_template_application FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.contexto_humano() AND app.empresa_autorizada(company_id));

CREATE INDEX accounting_statement_template_source_company_idx ON app.accounting_statement_template_source(company_id);
CREATE INDEX accounting_statement_template_application_company_only_idx ON app.accounting_statement_template_application(company_id);
