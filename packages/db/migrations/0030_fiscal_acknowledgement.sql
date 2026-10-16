-- SPEC-019/F19: Ciência automática, tentativas append-only e outbox retomável.
-- Nenhum XML, certificado, segredo ou chave privada é armazenado nestas tabelas.

ALTER TABLE app.dfe_capture_staging ADD COLUMN origem text NOT NULL DEFAULT 'DISTRIBUICAO'
  CHECK (origem IN ('DISTRIBUICAO','RECUPERACAO_CIENCIA'));
ALTER TABLE app.dfe_capture_staging ADD COLUMN origem_staging_id uuid;
ALTER TABLE app.dfe_capture_staging ADD CONSTRAINT dfe_capture_staging_recovery_origin
  FOREIGN KEY(origem_staging_id,empresa_id,tenant_id) REFERENCES app.dfe_capture_staging(id,empresa_id,tenant_id);
ALTER TABLE app.dfe_capture_staging ADD CONSTRAINT dfe_capture_staging_recovery_source_check
  CHECK ((origem='DISTRIBUICAO' AND origem_staging_id IS NULL) OR (origem='RECUPERACAO_CIENCIA' AND origem_staging_id IS NOT NULL));
ALTER TABLE app.dfe_capture_staging DROP CONSTRAINT dfe_capture_staging_nsu_unico;
DROP INDEX app.dfe_capture_staging_chave_unica;
CREATE UNIQUE INDEX dfe_capture_staging_nsu_original_idx
  ON app.dfe_capture_staging(tenant_id,empresa_id,cnpj,nsu) WHERE origem='DISTRIBUICAO';
CREATE UNIQUE INDEX dfe_capture_staging_chave_original_idx
  ON app.dfe_capture_staging(tenant_id,empresa_id,chave_acesso) WHERE origem='DISTRIBUICAO' AND chave_acesso IS NOT NULL;
CREATE UNIQUE INDEX dfe_capture_staging_recuperacao_idx
  ON app.dfe_capture_staging(tenant_id,empresa_id,chave_acesso) WHERE origem='RECUPERACAO_CIENCIA';
CREATE UNIQUE INDEX dfe_capture_staging_recovery_source_idx
  ON app.dfe_capture_staging(tenant_id,empresa_id,origem_staging_id) WHERE origem='RECUPERACAO_CIENCIA';

CREATE TABLE app.fiscal_acknowledgement (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL,
  staging_id uuid NOT NULL UNIQUE, chave_acesso text CHECK(chave_acesso IS NULL OR chave_acesso ~ '^\d{44}$'),
  tipo_evento text NOT NULL DEFAULT '210210' CHECK(tipo_evento='210210'),
  sequencia smallint NOT NULL DEFAULT 1 CHECK(sequencia=1),
  estado text NOT NULL CHECK(estado IN ('RESUMO_CAPTURADO','CIENCIA_PENDENTE','CIENCIA_EM_ENVIO','CIENCIA_REGISTRADA',
    'XML_COMPLETO_PENDENTE','XML_COMPLETO_OBTIDO','PARSEADO','JA_MANIFESTADO','XML_COMPLETO_JA_DISPONIVEL',
    'RESULTADO_INCERTO','RETRY_AGENDADO','REJEITADO','IMPEDIDO','DLQ')),
  tentativas smallint NOT NULL DEFAULT 0 CHECK(tentativas BETWEEN 0 AND 32767),
  tentativas_ciencia smallint NOT NULL DEFAULT 0 CHECK(tentativas_ciencia BETWEEN 0 AND 32767),
  tentativas_xml smallint NOT NULL DEFAULT 0 CHECK(tentativas_xml BETWEEN 0 AND 32767),
  tentativas_ciencia_ciclo smallint NOT NULL DEFAULT 0 CHECK(tentativas_ciencia_ciclo BETWEEN 0 AND 3),
  tentativas_xml_ciclo smallint NOT NULL DEFAULT 0 CHECK(tentativas_xml_ciclo BETWEEN 0 AND 3),
  protocolo text, ambiente text CHECK(ambiente IS NULL OR ambiente IN ('HOMOLOGACAO','PRODUCAO')),
  codigo text, motivo_sanitizado text, proxima_tentativa_em timestamptz,
  xml_staging_id uuid, correlation_id text NOT NULL,
  solicitada_em timestamptz NOT NULL DEFAULT now(),
  criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_ack_empresa FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT fiscal_ack_staging FOREIGN KEY(staging_id,empresa_id,tenant_id) REFERENCES app.dfe_capture_staging(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_ack_xml_staging FOREIGN KEY(xml_staging_id,empresa_id,tenant_id) REFERENCES app.dfe_capture_staging(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_ack_scope UNIQUE(id,empresa_id,tenant_id)
);
CREATE UNIQUE INDEX fiscal_ack_identity_idx ON app.fiscal_acknowledgement(tenant_id,empresa_id,chave_acesso,tipo_evento,sequencia) WHERE chave_acesso IS NOT NULL;
CREATE INDEX fiscal_ack_due_idx ON app.fiscal_acknowledgement(proxima_tentativa_em,criado_em) WHERE estado IN ('CIENCIA_PENDENTE','XML_COMPLETO_PENDENTE','RETRY_AGENDADO');
CREATE INDEX fiscal_ack_company_history_idx ON app.fiscal_acknowledgement(empresa_id,criado_em DESC,id);

CREATE TABLE app.fiscal_acknowledgement_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL,
  acknowledgement_id uuid NOT NULL, estado text NOT NULL, codigo text, detalhe_sanitizado text,
  protocolo text, ambiente text CHECK(ambiente IS NULL OR ambiente IN ('HOMOLOGACAO','PRODUCAO')),
  tentativa smallint NOT NULL CHECK(tentativa BETWEEN 0 AND 32767), correlation_id text NOT NULL,
  ocorrido_em timestamptz NOT NULL DEFAULT now(), sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,
  FOREIGN KEY(acknowledgement_id,empresa_id,tenant_id) REFERENCES app.fiscal_acknowledgement(id,empresa_id,tenant_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX fiscal_ack_event_history_idx ON app.fiscal_acknowledgement_event(acknowledgement_id,ocorrido_em DESC,sequencia DESC);
CREATE TRIGGER fiscal_ack_event_append_only BEFORE UPDATE OR DELETE ON app.fiscal_acknowledgement_event
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

CREATE TABLE app.fiscal_acknowledgement_attempt (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL,
  acknowledgement_id uuid NOT NULL, etapa text NOT NULL CHECK(etapa IN ('CIENCIA','RECUPERACAO_XML')),
  tentativa smallint NOT NULL CHECK(tentativa BETWEEN 1 AND 32767), resultado text NOT NULL CHECK(resultado IN
  ('ACEITO','DUPLICIDADE_CONCILIADA','JA_MANIFESTADO','REJEITADO','INCERTO','TRANSITORIO','XML_OBTIDO','XML_PENDENTE','DIVERGENTE')),
  codigo text, protocolo text, ambiente text CHECK(ambiente IS NULL OR ambiente IN ('HOMOLOGACAO','PRODUCAO')),
  correlation_id text NOT NULL, iniciada_em timestamptz NOT NULL DEFAULT now(), finalizada_em timestamptz,
  FOREIGN KEY(acknowledgement_id,empresa_id,tenant_id) REFERENCES app.fiscal_acknowledgement(id,empresa_id,tenant_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT fiscal_ack_attempt_once UNIQUE(acknowledgement_id,etapa,tentativa)
);
CREATE INDEX fiscal_ack_attempt_history_idx ON app.fiscal_acknowledgement_attempt(acknowledgement_id,iniciada_em DESC);
CREATE TRIGGER fiscal_ack_attempt_append_only BEFORE UPDATE OR DELETE ON app.fiscal_acknowledgement_attempt
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

CREATE TABLE app.fiscal_acknowledgement_outbox (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL,
  acknowledgement_id uuid NOT NULL UNIQUE, estado text NOT NULL DEFAULT 'PENDENTE' CHECK(estado IN ('PENDENTE','PUBLICADO','DLQ')),
  etapa text NOT NULL DEFAULT 'CIENCIA' CHECK(etapa IN ('CIENCIA','RECUPERACAO_XML')),
  tentativas integer NOT NULL DEFAULT 0 CHECK(tentativas>=0), disponivel_em timestamptz NOT NULL DEFAULT now(),
  criado_em timestamptz NOT NULL DEFAULT now(), publicado_em timestamptz,
  FOREIGN KEY(acknowledgement_id,empresa_id,tenant_id) REFERENCES app.fiscal_acknowledgement(id,empresa_id,tenant_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX fiscal_ack_outbox_due_idx ON app.fiscal_acknowledgement_outbox(disponivel_em,criado_em) WHERE estado='PENDENTE';

DO $$ DECLARE alvo text; BEGIN
  FOREACH alvo IN ARRAY ARRAY['fiscal_acknowledgement','fiscal_acknowledgement_event','fiscal_acknowledgement_attempt','fiscal_acknowledgement_outbox'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',alvo);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',alvo);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',alvo||'_select',alvo);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',alvo||'_insert',alvo);
  END LOOP;
END $$;
CREATE POLICY fiscal_ack_update ON app.fiscal_acknowledgement FOR UPDATE
  USING(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))
  WITH CHECK(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE POLICY fiscal_ack_outbox_update ON app.fiscal_acknowledgement_outbox FOR UPDATE
  USING(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))
  WITH CHECK(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));

CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.fiscal_acknowledgement FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.fiscal_acknowledgement_outbox FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
GRANT SELECT,INSERT ON app.fiscal_acknowledgement,app.fiscal_acknowledgement_event,app.fiscal_acknowledgement_attempt,app.fiscal_acknowledgement_outbox TO contaia_app;
GRANT UPDATE(estado,tentativas,tentativas_ciencia,tentativas_xml,tentativas_ciencia_ciclo,tentativas_xml_ciclo,protocolo,ambiente,codigo,motivo_sanitizado,proxima_tentativa_em,xml_staging_id,atualizado_em) ON app.fiscal_acknowledgement TO contaia_app;
GRANT UPDATE(estado,etapa,tentativas,disponivel_em,publicado_em) ON app.fiscal_acknowledgement_outbox TO contaia_app;
GRANT INSERT ON app.dfe_capture_staging TO contaia_app;
REVOKE UPDATE,DELETE ON app.fiscal_acknowledgement_event,app.fiscal_acknowledgement_attempt FROM contaia_app;
REVOKE DELETE ON app.fiscal_acknowledgement,app.fiscal_acknowledgement_outbox FROM contaia_app;

GRANT SELECT ON app.fiscal_acknowledgement_outbox,app.fiscal_acknowledgement TO contaia_dfe_scheduler_owner;
CREATE FUNCTION app.fiscal_ack_empresas_pendentes(p_limite integer DEFAULT 100)
RETURNS TABLE(tenant_id uuid,empresa_id uuid,cnpj text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
 SELECT DISTINCT o.tenant_id,o.empresa_id,s.cnpj FROM app.fiscal_acknowledgement_outbox o
 JOIN app.fiscal_acknowledgement a ON a.id=o.acknowledgement_id
 JOIN app.dfe_capture_staging s ON s.id=a.staging_id
 WHERE o.estado='PENDENTE' AND o.disponivel_em<=now()
 ORDER BY o.tenant_id,o.empresa_id,s.cnpj LIMIT least(greatest(p_limite,1),100)
$$;
ALTER FUNCTION app.fiscal_ack_empresas_pendentes(integer) OWNER TO contaia_dfe_scheduler_owner;
REVOKE ALL ON FUNCTION app.fiscal_ack_empresas_pendentes(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fiscal_ack_empresas_pendentes(integer) TO contaia_dfe_scheduler;
