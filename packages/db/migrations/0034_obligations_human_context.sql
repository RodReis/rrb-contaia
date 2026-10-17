-- O domínio grava a origem humana como HUMANA (enum de origem do contexto).
-- Corrige as funções da agenda que comparavam com HUMANO e rejeitavam a API.
CREATE OR REPLACE FUNCTION app.obligation_rule_name(p_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app AS $$
DECLARE v_name text;
BEGIN
  IF NOT (app.contexto_do_catalogo_tributario()
      OR (app.origem_atual() = 'HUMANA' AND app.tenant_atual() IS NOT NULL)
      OR (app.origem_atual() = 'SERVICO' AND app.finalidade_atual() = 'PROCESSAMENTO_DE_EMPRESA' AND app.tenant_atual() IS NOT NULL)) THEN
    RAISE EXCEPTION 'contexto inválido para leitura de regra' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT nome INTO v_name FROM app.obligation_rule WHERE id=p_id AND estado IN ('PUBLICADA','ARQUIVADA');
  RETURN v_name;
END $$;

CREATE OR REPLACE FUNCTION app.obligation_published_rules(p_data date) RETURNS SETOF app.obligation_rule
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app AS $$
BEGIN
  IF NOT (app.contexto_do_catalogo_tributario()
      OR (app.origem_atual() = 'HUMANA' AND app.tenant_atual() IS NOT NULL)
      OR (app.origem_atual() = 'SERVICO' AND app.finalidade_atual() = 'PROCESSAMENTO_DE_EMPRESA'
          AND app.tenant_atual() IS NOT NULL AND app.empresa_tecnica_atual() IS NOT NULL)) THEN
    RAISE EXCEPTION 'contexto inválido para leitura de regras publicadas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT r.* FROM app.obligation_rule r
   WHERE r.estado = 'PUBLICADA' AND r.vigente_de <= p_data AND (r.vigente_ate IS NULL OR r.vigente_ate >= p_data)
   ORDER BY r.codigo, r.versao DESC;
END $$;

