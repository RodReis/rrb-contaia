-- SPEC-038: avaliações tributárias são comandos humanos; jobs técnicos não podem
-- consultar nem gravar pacotes, declarações, evidências, revisões ou artefatos.
DO $$
DECLARE tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY[
    'corporate_tax_rule_package','corporate_tax_rule_package_event','corporate_tax_declaration',
    'corporate_tax_declaration_event','corporate_tax_evidence','corporate_tax_assessment',
    'corporate_tax_assessment_event','corporate_tax_artifact'
  ] LOOP
    EXECUTE format('DROP POLICY %I ON app.%I', tabela||'_select', tabela);
    EXECUTE format('DROP POLICY %I ON app.%I', tabela||'_insert', tabela);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.origem_atual()=''HUMANA'' AND app.empresa_autorizada(empresa_id))', tabela||'_select', tabela);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.origem_atual()=''HUMANA'' AND app.empresa_autorizada(empresa_id))', tabela||'_insert', tabela);
  END LOOP;
END $$;
