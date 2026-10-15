-- SPEC-017 §3.3: admin_escritorio pode operar a captura em qualquer empresa
-- ativa do próprio tenant. A exceção fica restrita às leituras necessárias e às
-- quatro tabelas da captura; não amplia a política geral de empresa/carteira.

CREATE FUNCTION app.dfe_capture_admin_autorizado(p_empresa uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp AS $$
  SELECT p_empresa IS NOT NULL
     AND app.contexto_humano()
     AND app.finalidade_atual() = 'COMUM'
     AND app.usuario_admin_atual()
     AND EXISTS (
       SELECT 1 FROM app.empresa e
        WHERE e.id = p_empresa AND e.tenant_id = app.tenant_atual()
          AND e.status = 'ATIVA' AND e.situacao = 'ativo'
     );
$$;

CREATE FUNCTION app.dfe_capture_empresa(p_empresa uuid)
RETURNS TABLE (id uuid, tenant_id uuid, cnpj text, status text, situacao text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp AS $$
  SELECT e.id, e.tenant_id, e.cnpj, e.status, e.situacao
    FROM app.empresa e
   WHERE e.id = p_empresa AND e.tenant_id = app.tenant_atual()
     AND (app.empresa_autorizada(e.id) OR app.dfe_capture_admin_autorizado(e.id));
$$;

CREATE FUNCTION app.dfe_capture_certificado_vigente(p_empresa uuid, p_instante timestamptz)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp AS $$
  SELECT (app.empresa_autorizada(p_empresa) OR app.dfe_capture_admin_autorizado(p_empresa))
     AND EXISTS (
       SELECT 1 FROM app.empresa_certificado c
        WHERE c.empresa_id = p_empresa AND c.tenant_id = app.tenant_atual()
          AND c.estado = 'VIGENTE'
          AND c.valido_de <= (p_instante AT TIME ZONE 'America/Sao_Paulo')::date
          AND c.valido_ate >= (p_instante AT TIME ZONE 'America/Sao_Paulo')::date
     );
$$;

REVOKE ALL ON FUNCTION app.dfe_capture_admin_autorizado(uuid),
  app.dfe_capture_empresa(uuid), app.dfe_capture_certificado_vigente(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.dfe_capture_admin_autorizado(uuid),
  app.dfe_capture_empresa(uuid), app.dfe_capture_certificado_vigente(uuid, timestamptz)
TO contaia_app;

DO $$
DECLARE alvo text;
BEGIN
  FOREACH alvo IN ARRAY ARRAY['dfe_capture_state', 'dfe_capture_run', 'dfe_capture_staging', 'dfe_capture_event', 'dfe_capture_alert_event'] LOOP
    EXECUTE format('DROP POLICY %I ON app.%I', alvo || '_select', alvo);
    EXECUTE format('DROP POLICY %I ON app.%I', alvo || '_insert', alvo);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id = app.tenant_atual() AND (app.empresa_autorizada(empresa_id) OR app.dfe_capture_admin_autorizado(empresa_id)))',
      alvo || '_select', alvo);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id = app.tenant_atual() AND (app.empresa_autorizada(empresa_id) OR app.dfe_capture_admin_autorizado(empresa_id)))',
      alvo || '_insert', alvo);
    IF alvo IN ('dfe_capture_state', 'dfe_capture_run') THEN
      EXECUTE format('DROP POLICY %I ON app.%I', alvo || '_update', alvo);
      EXECUTE format(
        'CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id = app.tenant_atual() AND (app.empresa_autorizada(empresa_id) OR app.dfe_capture_admin_autorizado(empresa_id))) WITH CHECK (tenant_id = app.tenant_atual() AND (app.empresa_autorizada(empresa_id) OR app.dfe_capture_admin_autorizado(empresa_id)))',
        alvo || '_update', alvo);
    END IF;
  END LOOP;
END
$$;
