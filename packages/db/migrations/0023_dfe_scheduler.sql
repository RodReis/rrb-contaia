-- SPEC-017/F17: descoberta automatica limitada a empresas elegiveis.
-- O papel de login nao le tabelas. A funcao pertence a um papel sem login e
-- devolve apenas o recorte necessario para entrar de novo na RLS por empresa.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contaia_dfe_scheduler_owner') THEN
    CREATE ROLE contaia_dfe_scheduler_owner NOLOGIN BYPASSRLS NOSUPERUSER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contaia_dfe_scheduler') THEN
    CREATE ROLE contaia_dfe_scheduler LOGIN PASSWORD 'contaia_dfe_scheduler_local' NOBYPASSRLS NOSUPERUSER;
  END IF;
END $$;

ALTER ROLE contaia_dfe_scheduler_owner NOINHERIT;
ALTER ROLE contaia_dfe_scheduler NOINHERIT;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA app
  FROM contaia_dfe_scheduler_owner, contaia_dfe_scheduler;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app
  FROM contaia_dfe_scheduler_owner, contaia_dfe_scheduler;
REVOKE ALL ON FUNCTION app.dfe_capture_empresas_elegiveis(integer) FROM PUBLIC;

GRANT USAGE ON SCHEMA app TO contaia_dfe_scheduler, contaia_dfe_scheduler_owner;
GRANT SELECT ON app.empresa, app.empresa_certificado, app.dfe_capture_state,
  app.dfe_capture_run TO contaia_dfe_scheduler_owner;

CREATE FUNCTION app.dfe_capture_empresas_elegiveis(p_limite integer DEFAULT 100)
RETURNS TABLE (tenant_id uuid, empresa_id uuid, cnpj text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, pg_temp AS $$
  SELECT e.tenant_id, e.id, e.cnpj
    FROM app.empresa e
    LEFT JOIN app.dfe_capture_state s
      ON s.tenant_id = e.tenant_id AND s.empresa_id = e.id AND s.cnpj = e.cnpj
   WHERE e.status = 'ATIVA' AND e.situacao = 'ativo'
     AND EXISTS (
       SELECT 1 FROM app.empresa_certificado c
        WHERE c.tenant_id = e.tenant_id AND c.empresa_id = e.id
          AND c.estado = 'VIGENTE'
          AND c.valido_de <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
          AND c.valido_ate >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
     )
     AND (s.id IS NULL OR
       (s.proximo_instante_permitido <= now() AND
         (s.estado IN ('READY', 'WAITING') OR
          (s.estado = 'BLOCKED_656' AND s.bloqueado_ate <= now()) OR
          (s.estado = 'CAPTURING' AND EXISTS (
            SELECT 1 FROM app.dfe_capture_run rq
             WHERE rq.estado_id = s.id AND rq.estado = 'QUEUED'
          )))))
     AND NOT EXISTS (
       SELECT 1 FROM app.dfe_capture_run r
        WHERE r.tenant_id = e.tenant_id AND r.empresa_id = e.id AND r.cnpj = e.cnpj
          AND r.estado = 'RUNNING'
     )
   ORDER BY CASE WHEN EXISTS (
       SELECT 1 FROM app.dfe_capture_run rq
        WHERE rq.tenant_id = e.tenant_id AND rq.empresa_id = e.id
          AND rq.cnpj = e.cnpj AND rq.estado = 'QUEUED'
     ) THEN 1 ELSE 0 END,
     coalesce(s.proximo_instante_permitido, '-infinity'::timestamptz), e.id
   LIMIT least(greatest(p_limite, 1), 100);
$$;

ALTER FUNCTION app.dfe_capture_empresas_elegiveis(integer) OWNER TO contaia_dfe_scheduler_owner;
REVOKE ALL ON FUNCTION app.dfe_capture_empresas_elegiveis(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.dfe_capture_empresas_elegiveis(integer) TO contaia_dfe_scheduler;
