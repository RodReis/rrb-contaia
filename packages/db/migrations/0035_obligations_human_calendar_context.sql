-- As funções de leitura do calendário também precisam aceitar a origem humana
-- gravada pelo domínio; o agendador técnico segue limitado ao tenant/empresa.
CREATE OR REPLACE FUNCTION app.obligation_holiday_list(p_inicio date, p_fim date)
RETURNS SETOF app.obligation_holiday
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app AS $$
BEGIN
  IF NOT (app.contexto_do_catalogo_tributario()
      OR (app.origem_atual() = 'HUMANA' AND app.tenant_atual() IS NOT NULL)
      OR (app.origem_atual() = 'TECNICA' AND app.finalidade_atual() = 'PROCESSAMENTO_DE_EMPRESA'
          AND app.tenant_atual() IS NOT NULL AND app.empresa_tecnica_atual() IS NOT NULL)) THEN
    RAISE EXCEPTION 'contexto inválido para leitura do calendário de feriados' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT h.* FROM app.obligation_holiday h
   WHERE h.data BETWEEN p_inicio AND p_fim AND h.vigente_de <= p_inicio AND (h.vigente_ate IS NULL OR h.vigente_ate >= p_inicio)
   ORDER BY h.data, h.abrangencia, h.versao DESC;
END $$;

CREATE OR REPLACE FUNCTION app.obligation_calendar_has_coverage(p_abrangencia text,p_uf text,p_municipio text,p_competencia date) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app AS $$
DECLARE v_fim date;
BEGIN
  IF NOT (app.contexto_do_catalogo_tributario()
      OR (app.origem_atual() = 'HUMANA' AND app.tenant_atual() IS NOT NULL)
      OR (app.origem_atual() = 'TECNICA' AND app.finalidade_atual() = 'PROCESSAMENTO_DE_EMPRESA'
          AND app.tenant_atual() IS NOT NULL AND app.empresa_tecnica_atual() IS NOT NULL)) THEN
    RAISE EXCEPTION 'contexto inválido para consulta de cobertura do calendário' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_fim := (date_trunc('month',p_competencia)::date + interval '1 month - 1 day')::date;
  RETURN EXISTS (SELECT 1 FROM app.obligation_calendar_coverage c
    WHERE c.abrangencia=p_abrangencia AND c.uf=p_uf
      AND COALESCE(c.municipio,'')=COALESCE(p_municipio,'')
      AND c.coberto_de <= date_trunc('month',p_competencia)::date AND c.coberto_ate >= v_fim);
END $$;
