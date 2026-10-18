-- SPEC-025/F25: registro local de procurações RFB/e-CAC. Não há conexão oficial.

-- A evidência usa o armazenamento e o versionamento documental da F4.
ALTER TABLE app.empresa_exigencia_documental
  DROP CONSTRAINT empresa_exigencia_documental_codigo_check;
ALTER TABLE app.empresa_exigencia_documental
  ADD CONSTRAINT empresa_exigencia_documental_codigo_check CHECK (codigo IN (
    'CONTRATO_SOCIAL', 'CARTAO_CNPJ', 'INSCRICAO_ESTADUAL', 'INSCRICAO_MUNICIPAL',
    'ALVARA_DE_FUNCIONAMENTO', 'DOCUMENTO_DO_RESPONSAVEL', 'COMPROVANTE_DE_ENDERECO',
    'PROCURACAO_RFB'
  ));

ALTER TABLE app.empresa_documento_versao
  ADD COLUMN sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE app.empresa_documento_versao
  ADD CONSTRAINT empresa_documento_versao_identidade_escopo UNIQUE (id, tenant_id, empresa_id);

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE app.empresa_documento_versao
  DROP CONSTRAINT empresa_documento_versao_tipo_conteudo_check;
ALTER TABLE app.empresa_documento_versao
  ADD CONSTRAINT empresa_documento_versao_tipo_conteudo_check
  CHECK (tipo_conteudo IN ('application/pdf','image/png','image/jpeg'));

CREATE TABLE app.rfb_procuracao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  outorgante_cnpj text NOT NULL CHECK (outorgante_cnpj ~ '^[0-9A-Z]{14}$'),
  outorgado_cnpj text NOT NULL CHECK (outorgado_cnpj ~ '^[0-9A-Z]{14}$'),
  valid_from date NOT NULL,
  valid_until date NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'REVOKED')),
  catalog_version integer NOT NULL DEFAULT 1 CHECK (catalog_version = 1),
  powers jsonb NOT NULL CHECK (
    jsonb_typeof(powers) = 'array' AND jsonb_array_length(powers) BETWEEN 1 AND 3
    AND powers <@ '["RFB_CNPJ_STATUS_READ","RFB_TAX_CLEARANCE_CERTIFICATE_READ","RFB_TAX_CLEARANCE_CERTIFICATE_ISSUE"]'::jsonb
  ),
  evidence_document_id uuid,
  declaration_by uuid,
  declaration_at timestamptz,
  confirmed_by uuid,
  confirmed_at timestamptz,
  local_test_power text CHECK (local_test_power IS NULL OR local_test_power IN (
    'RFB_CNPJ_STATUS_READ','RFB_TAX_CLEARANCE_CERTIFICATE_READ','RFB_TAX_CLEARANCE_CERTIFICATE_ISSUE'
  )),
  local_test_result text CHECK (local_test_result IS NULL OR local_test_result IN ('SUCCESS', 'FAILURE')),
  local_test_correlation_id text,
  local_tested_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  revoked_reason text CHECK (revoked_reason IS NULL OR length(btrim(revoked_reason)) BETWEEN 5 AND 500),
  archived_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CONSTRAINT rfb_procuracao_dates CHECK (valid_until >= valid_from),
  CONSTRAINT rfb_procuracao_confirmed_evidence CHECK (
    status = 'DRAFT' OR (evidence_document_id IS NOT NULL AND declaration_by IS NOT NULL AND declaration_at IS NOT NULL
      AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND local_test_result = 'SUCCESS')
  ),
  CONSTRAINT rfb_procuracao_revocation CHECK (
    (status = 'REVOKED' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND revoked_reason IS NOT NULL)
    OR (status <> 'REVOKED' AND revoked_by IS NULL AND revoked_at IS NULL AND revoked_reason IS NULL)
  ),
  CONSTRAINT rfb_procuracao_company_scope FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa(id, tenant_id),
  CONSTRAINT rfb_procuracao_created_actor FOREIGN KEY (created_by, tenant_id) REFERENCES app.usuario(id, tenant_id),
  CONSTRAINT rfb_procuracao_declaration_actor FOREIGN KEY (declaration_by, tenant_id) REFERENCES app.usuario(id, tenant_id),
  CONSTRAINT rfb_procuracao_confirmed_actor FOREIGN KEY (confirmed_by, tenant_id) REFERENCES app.usuario(id, tenant_id),
  CONSTRAINT rfb_procuracao_revoked_actor FOREIGN KEY (revoked_by, tenant_id) REFERENCES app.usuario(id, tenant_id),
  CONSTRAINT rfb_procuracao_identity_scope UNIQUE (id, tenant_id, empresa_id),
  CONSTRAINT rfb_procuracao_version_unique UNIQUE (tenant_id, empresa_id, version_number),
  CONSTRAINT rfb_procuracao_evidence_scope FOREIGN KEY (evidence_document_id, tenant_id, empresa_id)
    REFERENCES app.empresa_documento_versao(id, tenant_id, empresa_id)
);

CREATE INDEX rfb_procuracao_tenant_idx ON app.rfb_procuracao(tenant_id);
CREATE INDEX rfb_procuracao_empresa_idx ON app.rfb_procuracao(empresa_id);
CREATE INDEX rfb_procuracao_tenant_empresa_idx ON app.rfb_procuracao(tenant_id, empresa_id);
CREATE INDEX rfb_procuracao_due_idx ON app.rfb_procuracao(tenant_id, valid_until) WHERE status = 'CONFIRMED' AND archived_at IS NULL;
ALTER TABLE app.rfb_procuracao ADD CONSTRAINT rfb_procuracao_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, empresa_id WITH =,
    daterange(valid_from, valid_until, '[]') WITH &&)
  WHERE (status = 'CONFIRMED' AND revoked_at IS NULL AND archived_at IS NULL);

CREATE TABLE app.rfb_procuracao_evento (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  procuracao_id uuid NOT NULL,
  acao text NOT NULL CHECK (acao IN (
    'CRIADA','RASCUNHO_ALTERADO','EVIDENCIA_ENVIADA','EVIDENCIA_SUBSTITUIDA','DECLARACAO_REGISTRADA',
    'TESTE_LOCAL','CONFIRMADA','ATIVADA','RENOVADA','REVOGADA','EXPIRADA','ARQUIVADA',
    'ALERTA_D30','ALERTA_D7','ALERTA_VENCIMENTO','OPERACAO_RFB','EVIDENCIA_VISUALIZADA','EVIDENCIA_BAIXADA'
  )),
  estado_anterior text,
  estado_novo text,
  poder text CHECK (poder IS NULL OR poder IN (
    'RFB_CNPJ_STATUS_READ','RFB_TAX_CLEARANCE_CERTIFICATE_READ','RFB_TAX_CLEARANCE_CERTIFICATE_ISSUE'
  )),
  resultado text,
  motivo text,
  revisao integer NOT NULL DEFAULT 1 CHECK (revisao > 0),
  origem text NOT NULL DEFAULT 'HUMANA' CHECK (origem IN ('HUMANA','TECNICA','SISTEMA')),
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL,
  ator_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,
  CONSTRAINT rfb_procuracao_evento_scope FOREIGN KEY (procuracao_id, tenant_id, empresa_id)
    REFERENCES app.rfb_procuracao(id, tenant_id, empresa_id),
  CONSTRAINT rfb_procuracao_evento_actor FOREIGN KEY (ator_id, tenant_id) REFERENCES app.usuario(id, tenant_id)
  ,CONSTRAINT rfb_procuracao_evento_idempotency UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX rfb_procuracao_evento_tenant_idx ON app.rfb_procuracao_evento(tenant_id);
CREATE INDEX rfb_procuracao_evento_empresa_idx ON app.rfb_procuracao_evento(empresa_id);
CREATE INDEX rfb_procuracao_evento_timeline_idx ON app.rfb_procuracao_evento(empresa_id, procuracao_id, criado_em DESC, sequencia DESC);

CREATE TABLE app.rfb_procuracao_operacao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  procuracao_id uuid NOT NULL,
  poder text NOT NULL CHECK (poder IN (
    'RFB_CNPJ_STATUS_READ','RFB_TAX_CLEARANCE_CERTIFICATE_READ','RFB_TAX_CLEARANCE_CERTIFICATE_ISSUE'
  )),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  resultado_codigo text NOT NULL,
  resultado_resumo jsonb NOT NULL CHECK (jsonb_typeof(resultado_resumo) = 'object'),
  correlation_id text NOT NULL,
  ator_id uuid NOT NULL,
  executado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rfb_procuracao_operacao_scope FOREIGN KEY (procuracao_id, tenant_id, empresa_id)
    REFERENCES app.rfb_procuracao(id, tenant_id, empresa_id),
  CONSTRAINT rfb_procuracao_operacao_actor FOREIGN KEY (ator_id, tenant_id) REFERENCES app.usuario(id, tenant_id),
  CONSTRAINT rfb_procuracao_operacao_idempotency UNIQUE (tenant_id, empresa_id, idempotency_key)
);
CREATE INDEX rfb_procuracao_operacao_tenant_idx ON app.rfb_procuracao_operacao(tenant_id);
CREATE INDEX rfb_procuracao_operacao_empresa_idx ON app.rfb_procuracao_operacao(empresa_id);

CREATE TABLE app.rfb_procuracao_notificacao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  procuracao_id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  marco text NOT NULL CHECK (marco IN ('D30','D7','VENCIMENTO')),
  lida boolean NOT NULL DEFAULT false,
  lida_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,
  CONSTRAINT rfb_procuracao_notificacao_scope FOREIGN KEY (procuracao_id, tenant_id, empresa_id)
    REFERENCES app.rfb_procuracao(id, tenant_id, empresa_id),
  CONSTRAINT rfb_procuracao_notificacao_actor FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario(id, tenant_id),
  CONSTRAINT rfb_procuracao_notificacao_read CHECK ((lida = false AND lida_em IS NULL) OR (lida = true AND lida_em IS NOT NULL)),
  CONSTRAINT rfb_procuracao_notificacao_unique UNIQUE (procuracao_id, usuario_id, marco)
);
CREATE INDEX rfb_procuracao_notificacao_tenant_idx ON app.rfb_procuracao_notificacao(tenant_id);
CREATE INDEX rfb_procuracao_notificacao_empresa_idx ON app.rfb_procuracao_notificacao(empresa_id);

CREATE OR REPLACE FUNCTION app.rfb_procuracao_proteger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'procuração preservada; arquivamento lógico obrigatório' USING ERRCODE='restrict_violation';
  END IF;
  IF (NEW.id,NEW.tenant_id,NEW.empresa_id,NEW.version_number,NEW.created_by,NEW.created_at)
     IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.empresa_id,OLD.version_number,OLD.created_by,OLD.created_at) THEN
    RAISE EXCEPTION 'identidade e escopo da procuração são imutáveis' USING ERRCODE='restrict_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND
     (NEW.outorgante_cnpj,NEW.outorgado_cnpj,NEW.valid_from,NEW.valid_until,NEW.catalog_version,NEW.powers,
      NEW.evidence_document_id,NEW.declaration_by,NEW.declaration_at,NEW.confirmed_by,NEW.confirmed_at,
      NEW.local_test_power,NEW.local_test_result,NEW.local_test_correlation_id,NEW.local_tested_at)
     IS DISTINCT FROM
     (OLD.outorgante_cnpj,OLD.outorgado_cnpj,OLD.valid_from,OLD.valid_until,OLD.catalog_version,OLD.powers,
      OLD.evidence_document_id,OLD.declaration_by,OLD.declaration_at,OLD.confirmed_by,OLD.confirmed_at,
      OLD.local_test_power,OLD.local_test_result,OLD.local_test_correlation_id,OLD.local_tested_at) THEN
    RAISE EXCEPTION 'versão confirmada é imutável; correção exige nova versão' USING ERRCODE='restrict_violation';
  END IF;
  IF NOT ((OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT','CONFIRMED'))
       OR (OLD.status = 'CONFIRMED' AND NEW.status IN ('CONFIRMED','REVOKED'))
       OR (OLD.status = 'REVOKED' AND NEW.status = 'REVOKED')) THEN
    RAISE EXCEPTION 'transição de procuração inválida' USING ERRCODE='restrict_violation';
  END IF;
  IF OLD.status NOT IN ('CONFIRMED','REVOKED') AND NEW.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'só versão terminal pode ser arquivada' USING ERRCODE='restrict_violation';
  END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'arquivamento de procuração é irreversível' USING ERRCODE='restrict_violation';
  END IF;
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
     AND NOT (OLD.status='REVOKED' OR (OLD.status='CONFIRMED'
       AND OLD.valid_until < (now() AT TIME ZONE 'America/Sao_Paulo')::date)) THEN
    RAISE EXCEPTION 'só procuração vencida ou revogada pode ser arquivada' USING ERRCODE='restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.rfb_procuracao_admin_empresa(p_empresa uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
  SELECT app.contexto_humano() AND app.usuario_admin_atual()
    AND EXISTS (SELECT 1 FROM app.empresa e WHERE e.id=p_empresa AND e.tenant_id=app.tenant_atual());
$$;
REVOKE ALL ON FUNCTION app.rfb_procuracao_admin_empresa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.rfb_procuracao_admin_empresa(uuid) TO contaia_app;

CREATE OR REPLACE FUNCTION app.rfb_procuracao_empresa_info(p_empresa uuid)
RETURNS TABLE(empresa_id uuid, empresa_nome text, empresa_cnpj text, escritorio_cnpj text, empresa_ativa boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
  SELECT e.id, coalesce(e.nome_fantasia,e.razao_social,e.cnpj), e.cnpj, t.cnpj,
         e.status='ATIVA' AND e.situacao='ativo'
    FROM app.empresa e JOIN app.tenant t ON t.id=e.tenant_id
   WHERE e.id=p_empresa AND e.tenant_id=app.tenant_atual()
     AND app.contexto_humano()
     AND (app.usuario_admin_atual() OR app.empresa_na_carteira(e.id));
$$;
REVOKE ALL ON FUNCTION app.rfb_procuracao_empresa_info(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.rfb_procuracao_empresa_info(uuid) TO contaia_app;

CREATE OR REPLACE FUNCTION app.rfb_procuracao_evidencia_info(p_documento uuid, p_empresa uuid)
RETURNS TABLE(documento_id uuid,nome text,tipo text,tamanho bigint,sha256 text,chave_storage text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
  SELECT d.id,d.nome_original,d.tipo_conteudo,d.tamanho_bytes,d.sha256,d.chave_storage
    FROM app.empresa_documento_versao d
   WHERE d.id=p_documento AND d.tenant_id=app.tenant_atual() AND d.empresa_id=p_empresa
     AND app.contexto_humano()
     AND (app.rfb_procuracao_admin_empresa(p_empresa) OR app.empresa_na_carteira(p_empresa));
$$;
REVOKE ALL ON FUNCTION app.rfb_procuracao_evidencia_info(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.rfb_procuracao_evidencia_info(uuid,uuid) TO contaia_app;

CREATE OR REPLACE FUNCTION app.rfb_procuracao_anexar_evidencia(
  p_tenant uuid, p_empresa uuid, p_procuracao uuid, p_usuario uuid, p_revisao integer,
  p_chave text, p_nome text, p_tamanho bigint, p_sha256 text
) RETURNS TABLE(documento_id uuid, revisao integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE v_exigencia uuid; v_documento uuid; v_numero integer; v_antigo uuid;
BEGIN
  IF p_tenant IS DISTINCT FROM app.tenant_atual() OR p_usuario IS DISTINCT FROM app.usuario_atual()
     OR NOT app.rfb_procuracao_admin_empresa(p_empresa)
     OR p_chave !~ ('^'||p_tenant::text||'/documento_da_empresa/[0-9a-f-]{36}\.pdf$')
     OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_tamanho NOT BETWEEN 1 AND 20971520 THEN
    RAISE EXCEPTION 'contexto ou metadados de evidência inválidos' USING ERRCODE='42501';
  END IF;

  PERFORM 1 FROM app.rfb_procuracao p
   WHERE p.tenant_id=p_tenant AND p.empresa_id=p_empresa AND p.id=p_procuracao
     AND p.status='DRAFT' AND p.revision=p_revisao FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rascunho não encontrado ou revisão obsoleta' USING ERRCODE='40001'; END IF;

  INSERT INTO app.empresa_exigencia_documental(tenant_id,empresa_id,codigo,nome,descricao,estado,aplicavel,situacao)
  VALUES(p_tenant,p_empresa,'PROCURACAO_RFB','Procuração eletrônica RFB/e-CAC',
    'Evidência versionada e protegida da F25.','PENDENTE',true,'ativo')
  ON CONFLICT (empresa_id,codigo) WHERE codigo IS NOT NULL AND situacao='ativo' DO NOTHING;
  SELECT id INTO v_exigencia FROM app.empresa_exigencia_documental
   WHERE tenant_id=p_tenant AND empresa_id=p_empresa AND codigo='PROCURACAO_RFB' AND situacao='ativo'
   FOR UPDATE;
  SELECT id INTO v_antigo FROM app.empresa_documento_versao WHERE exigencia_id=v_exigencia AND vigente FOR UPDATE;
  IF v_antigo IS NOT NULL THEN
    UPDATE app.empresa_documento_versao SET vigente=false WHERE id=v_antigo;
  END IF;
  SELECT coalesce(max(numero),0)+1 INTO v_numero FROM app.empresa_documento_versao WHERE exigencia_id=v_exigencia;
  INSERT INTO app.empresa_documento_versao(tenant_id,empresa_id,exigencia_id,numero,chave_storage,nome_original,
    tipo_conteudo,tamanho_bytes,validade,vigente,enviado_por,sha256)
  VALUES(p_tenant,p_empresa,v_exigencia,v_numero,p_chave,p_nome,'application/pdf',p_tamanho,NULL,true,p_usuario,p_sha256)
  RETURNING id INTO v_documento;
  INSERT INTO app.empresa_evento_documental(tenant_id,empresa_id,exigencia_id,versao_id,acao,usuario_id)
  VALUES(p_tenant,p_empresa,v_exigencia,v_documento,CASE WHEN v_antigo IS NULL THEN 'ENVIO' ELSE 'SUBSTITUICAO' END,p_usuario);
  UPDATE app.rfb_procuracao SET evidence_document_id=v_documento,revision=revision+1,updated_at=now()
   WHERE id=p_procuracao AND tenant_id=p_tenant AND empresa_id=p_empresa AND status='DRAFT'
     AND revision=p_revisao
  RETURNING rfb_procuracao.revision INTO revisao;
  documento_id:=v_documento;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION app.rfb_procuracao_anexar_evidencia(uuid,uuid,uuid,uuid,integer,text,text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.rfb_procuracao_anexar_evidencia(uuid,uuid,uuid,uuid,integer,text,text,bigint,text) TO contaia_app;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['rfb_procuracao','rfb_procuracao_evento','rfb_procuracao_operacao'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND (app.empresa_autorizada(empresa_id) OR app.rfb_procuracao_admin_empresa(empresa_id) OR (app.contexto_tecnico() AND app.empresa_tecnica_atual()=empresa_id)))',t||'_select',t);
  END LOOP;
END $$;
ALTER TABLE app.rfb_procuracao_notificacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.rfb_procuracao_notificacao FORCE ROW LEVEL SECURITY;
CREATE POLICY rfb_procuracao_notificacao_select ON app.rfb_procuracao_notificacao FOR SELECT
  USING (tenant_id=app.tenant_atual() AND usuario_id=app.usuario_atual()
    AND (app.empresa_autorizada(empresa_id) OR app.rfb_procuracao_admin_empresa(empresa_id)
      OR (app.contexto_tecnico() AND app.empresa_tecnica_atual()=empresa_id)));
CREATE POLICY rfb_procuracao_insert ON app.rfb_procuracao FOR INSERT
  WITH CHECK (tenant_id=app.tenant_atual() AND app.rfb_procuracao_admin_empresa(empresa_id));
CREATE POLICY rfb_procuracao_update ON app.rfb_procuracao FOR UPDATE
  USING (tenant_id=app.tenant_atual() AND app.rfb_procuracao_admin_empresa(empresa_id))
  WITH CHECK (tenant_id=app.tenant_atual() AND app.rfb_procuracao_admin_empresa(empresa_id));
CREATE POLICY rfb_procuracao_evento_insert ON app.rfb_procuracao_evento FOR INSERT
  WITH CHECK (tenant_id=app.tenant_atual() AND (app.empresa_autorizada(empresa_id) OR app.rfb_procuracao_admin_empresa(empresa_id) OR (app.contexto_tecnico() AND app.empresa_tecnica_atual()=empresa_id)));
CREATE POLICY rfb_procuracao_operacao_insert ON app.rfb_procuracao_operacao FOR INSERT
  WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE POLICY rfb_procuracao_notificacao_update ON app.rfb_procuracao_notificacao FOR UPDATE
  USING (tenant_id=app.tenant_atual() AND usuario_id=app.usuario_atual() AND (app.empresa_autorizada(empresa_id) OR app.rfb_procuracao_admin_empresa(empresa_id)))
  WITH CHECK (tenant_id=app.tenant_atual() AND usuario_id=app.usuario_atual() AND (app.empresa_autorizada(empresa_id) OR app.rfb_procuracao_admin_empresa(empresa_id)));
CREATE POLICY rfb_procuracao_notificacao_insert ON app.rfb_procuracao_notificacao FOR INSERT
  WITH CHECK (tenant_id=app.tenant_atual() AND app.rfb_procuracao_admin_empresa(empresa_id));

CREATE TRIGGER rfb_procuracao_lifecycle BEFORE UPDATE OR DELETE ON app.rfb_procuracao
  FOR EACH ROW EXECUTE FUNCTION app.rfb_procuracao_proteger();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.rfb_procuracao
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER rfb_procuracao_evento_immutable BEFORE UPDATE OR DELETE ON app.rfb_procuracao_evento
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.rfb_procuracao_evento
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER rfb_procuracao_evento_audit AFTER INSERT ON app.rfb_procuracao_evento
  FOR EACH ROW EXECUTE FUNCTION app.audit_capture_source();
CREATE TRIGGER rfb_procuracao_operacao_immutable BEFORE UPDATE OR DELETE ON app.rfb_procuracao_operacao
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.rfb_procuracao_operacao
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER rfb_procuracao_operacao_audit AFTER INSERT ON app.rfb_procuracao_operacao
  FOR EACH ROW EXECUTE FUNCTION app.audit_capture_source();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.rfb_procuracao_notificacao
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();

-- Job diario sem acesso de leitura direto pelo worker. A funcao calcula o dia civil
-- em Sao Paulo, insere aviso para cada administrador ativo e deduplica por versao/marco.
GRANT SELECT ON app.rfb_procuracao,app.usuario,app.usuario_papel TO contaia_dfe_scheduler_owner;
GRANT SELECT,INSERT ON app.rfb_procuracao_evento,app.rfb_procuracao_notificacao TO contaia_dfe_scheduler_owner;
GRANT USAGE,SELECT ON SEQUENCE app.rfb_procuracao_evento_sequencia_seq,app.rfb_procuracao_notificacao_sequencia_seq TO contaia_dfe_scheduler_owner;
CREATE OR REPLACE FUNCTION app.rfb_procuracao_emitir_alertas()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE v record; v_notificacao uuid; v_marco text; v_acao text; v_total integer:=0; v_hoje date;
BEGIN
  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  FOR v IN
    SELECT p.id,p.tenant_id,p.empresa_id,
           CASE p.valid_until-v_hoje WHEN 30 THEN 'D30' WHEN 7 THEN 'D7' ELSE 'VENCIMENTO' END AS marco,
           up.usuario_id
      FROM app.rfb_procuracao p
      JOIN app.usuario_papel up ON up.tenant_id=p.tenant_id AND up.papel='admin_escritorio' AND up.removido_em IS NULL
      JOIN app.usuario u ON u.id=up.usuario_id AND u.tenant_id=up.tenant_id AND u.estado='ATIVO'
     WHERE p.status='CONFIRMED' AND p.archived_at IS NULL AND p.valid_until-v_hoje IN (30,7,0)
     ORDER BY p.tenant_id,p.empresa_id,p.id,up.usuario_id
  LOOP
    v_marco:=v.marco;
    v_acao:=CASE v_marco WHEN 'D30' THEN 'ALERTA_D30' WHEN 'D7' THEN 'ALERTA_D7' ELSE 'ALERTA_VENCIMENTO' END;
    INSERT INTO app.rfb_procuracao_notificacao(tenant_id,empresa_id,procuracao_id,usuario_id,marco)
    VALUES(v.tenant_id,v.empresa_id,v.id,v.usuario_id,v_marco)
    ON CONFLICT(procuracao_id,usuario_id,marco) DO NOTHING RETURNING id INTO v_notificacao;
    IF v_notificacao IS NOT NULL THEN
      INSERT INTO app.rfb_procuracao_evento(tenant_id,empresa_id,procuracao_id,acao,estado_novo,resultado,
        motivo,correlation_id,idempotency_key)
      VALUES(v.tenant_id,v.empresa_id,v.id,v_acao,'NOTIFICADA',v_marco,'Marco civil da procuração',
        'rfb-alert:'||v.id::text||':'||v_marco,'rfb-alert:'||v.id::text||':'||v_marco)
      ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;
      v_total:=v_total+1;
    END IF;
    v_notificacao:=NULL;
  END LOOP;
  RETURN v_total;
END $$;
ALTER FUNCTION app.rfb_procuracao_emitir_alertas() OWNER TO contaia_dfe_scheduler_owner;
REVOKE ALL ON FUNCTION app.rfb_procuracao_emitir_alertas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.rfb_procuracao_emitir_alertas() TO contaia_dashboard_scheduler;

GRANT SELECT, INSERT, UPDATE ON app.rfb_procuracao TO contaia_app;
GRANT SELECT, INSERT ON app.rfb_procuracao_evento, app.rfb_procuracao_operacao TO contaia_app;
GRANT SELECT ON app.rfb_procuracao_notificacao TO contaia_app;
GRANT UPDATE(lida,lida_em) ON app.rfb_procuracao_notificacao TO contaia_app;
REVOKE DELETE, TRUNCATE ON app.rfb_procuracao,app.rfb_procuracao_evento,app.rfb_procuracao_operacao,app.rfb_procuracao_notificacao FROM contaia_app;
REVOKE UPDATE ON app.rfb_procuracao_evento,app.rfb_procuracao_operacao FROM contaia_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
