-- SPEC-037/F37: habilita apuração cumulativa PIS/Cofins no contrato mensal append-only da F36.
ALTER TABLE app.tax_monthly_rule_package DROP CONSTRAINT tax_monthly_rule_package_kind_check;
ALTER TABLE app.tax_monthly_rule_package ADD CONSTRAINT tax_monthly_rule_package_kind_check CHECK(kind IN (
  'SIMPLES_NACIONAL_DAS','LUCRO_PRESUMIDO_ICMS_DARE','LUCRO_PRESUMIDO_PIS_COFINS','PIS_COFINS_TRANSITION_2026'));

ALTER TABLE app.tax_monthly_declaration DROP CONSTRAINT tax_monthly_declaration_kind_check;
ALTER TABLE app.tax_monthly_declaration ADD CONSTRAINT tax_monthly_declaration_kind_check CHECK(kind IN (
  'SIMPLES_NACIONAL_DAS','LUCRO_PRESUMIDO_ICMS_DARE','LUCRO_PRESUMIDO_PIS_COFINS'));

ALTER TABLE app.tax_monthly_assessment DROP CONSTRAINT tax_monthly_assessment_kind_check;
ALTER TABLE app.tax_monthly_assessment ADD CONSTRAINT tax_monthly_assessment_kind_check CHECK(kind IN (
  'SIMPLES_NACIONAL_DAS','LUCRO_PRESUMIDO_ICMS_DARE','LUCRO_PRESUMIDO_PIS_COFINS'));

ALTER TABLE app.tax_monthly_assessment
  ADD COLUMN transition_package_id uuid,
  ADD CONSTRAINT tax_monthly_assessment_transition_package_scope FOREIGN KEY(transition_package_id,tenant_id,empresa_id)
    REFERENCES app.tax_monthly_rule_package(id,tenant_id,empresa_id);
CREATE INDEX tax_monthly_assessment_transition_package_idx ON app.tax_monthly_assessment(transition_package_id,tenant_id,empresa_id)
  WHERE transition_package_id IS NOT NULL;

COMMENT ON COLUMN app.tax_monthly_assessment.transition_package_id IS
  'SPEC-037: pacote CBS/IBS aprovado que embasa transição; ausência mantém resultado indeterminado quando a trilha for aplicável.';
