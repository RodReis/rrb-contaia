-- Reserva durável do rate limit tenant/órgão. A mesma trilha STARTED serve de
-- fonte temporal; advisory lock serializa empresas concorrentes do escritório.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contaia_dfe_rate_owner') THEN
    CREATE ROLE contaia_dfe_rate_owner NOLOGIN BYPASSRLS NOSUPERUSER NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA app TO contaia_dfe_rate_owner;
GRANT SELECT ON app.dfe_capture_run, app.dfe_capture_event TO contaia_dfe_rate_owner;
GRANT INSERT ON app.dfe_capture_event TO contaia_dfe_rate_owner;

CREATE FUNCTION app.reservar_janela_dfe_tenant(p_run_id uuid)
RETURNS TABLE (reservado boolean, proxima_janela timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
DECLARE
  tenant uuid := app.tenant_atual();
  empresa uuid := app.empresa_tecnica_atual();
  execucao app.dfe_capture_run%ROWTYPE;
  ultima_chamada timestamptz;
  agora timestamptz := clock_timestamp();
  disponivel_em timestamptz;
BEGIN
  IF NOT app.contexto_tecnico()
     OR current_setting('app.identidade_tecnica', true) <> 'workers-dfe-capture'
     OR tenant IS NULL OR empresa IS NULL THEN
    RAISE EXCEPTION 'contexto invalido para rate limit DF-e' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO execucao FROM app.dfe_capture_run r
   WHERE r.id=p_run_id AND r.tenant_id=tenant AND r.empresa_id=empresa AND r.estado='RUNNING';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'execucao DF-e nao pertence ao contexto' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text || ':DFE_TESTE', 0));
  SELECT max(e.ocorrido_em) INTO ultima_chamada FROM app.dfe_capture_event e
   WHERE e.tenant_id=tenant AND e.tipo='STARTED';
  disponivel_em := coalesce(ultima_chamada + interval '60 seconds', agora);

  IF disponivel_em > agora THEN
    RETURN QUERY SELECT false, disponivel_em;
    RETURN;
  END IF;

  INSERT INTO app.dfe_capture_event
    (tenant_id, empresa_id, run_id, cnpj, tipo, tentativa, correlation_id, ocorrido_em)
  VALUES (tenant, empresa, execucao.id, execucao.cnpj, 'STARTED', execucao.tentativa,
          execucao.correlation_id, agora);
  RETURN QUERY SELECT true, agora + interval '60 seconds';
END
$$;

ALTER FUNCTION app.reservar_janela_dfe_tenant(uuid) OWNER TO contaia_dfe_rate_owner;
REVOKE ALL ON FUNCTION app.reservar_janela_dfe_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reservar_janela_dfe_tenant(uuid) TO contaia_app;
