-- SPEC-022/F22 — regras, calendário, ocorrências, alertas e canais locais.
CREATE TABLE app.obligation_rule (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  codigo text NOT NULL CHECK (codigo ~ '^[A-Z0-9_]{2,80}$'), versao integer NOT NULL CHECK (versao > 0),
  nome text NOT NULL, regimes text[] NOT NULL, ufs text[] NOT NULL DEFAULT '{}', cnaes text[] NOT NULL DEFAULT '{}',
  periodicidade text NOT NULL CHECK (periodicidade = 'MENSAL'), dia_nominal smallint NOT NULL CHECK (dia_nominal BETWEEN 1 AND 31),
  ajustar_dia_util text NOT NULL CHECK (ajustar_dia_util IN ('ANTECEDENTE', 'NENHUM')),
  exige_feriado_estadual boolean NOT NULL DEFAULT false, exige_feriado_municipal boolean NOT NULL DEFAULT false,
  dependencias text[] NOT NULL DEFAULT '{}', prioridade_base text NOT NULL DEFAULT 'NORMAL' CHECK (prioridade_base IN ('NORMAL', 'ALTA', 'CRITICA')),
  penalidade jsonb, vigente_de date NOT NULL, vigente_ate date, estado text NOT NULL DEFAULT 'RASCUNHO' CHECK (estado IN ('RASCUNHO', 'PUBLICADA', 'ARQUIVADA')),
  conteudo_hash text, criado_por uuid, criado_em timestamptz NOT NULL DEFAULT now(), publicado_por uuid, publicado_em timestamptz,
  CONSTRAINT obligation_rule_version UNIQUE (codigo, versao),
  CONSTRAINT obligation_rule_range CHECK (vigente_ate IS NULL OR vigente_ate >= vigente_de),
  CONSTRAINT obligation_rule_published_shape CHECK ((estado = 'RASCUNHO' AND publicado_em IS NULL) OR (estado <> 'RASCUNHO' AND publicado_em IS NOT NULL))
);
CREATE INDEX obligation_rule_lookup_idx ON app.obligation_rule (codigo, vigente_de, vigente_ate);
CREATE TABLE app.obligation_catalog_audit (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), regra_id uuid NOT NULL REFERENCES app.obligation_rule(id),
  acao text NOT NULL CHECK (acao IN ('CRIADA','EDITADA','PUBLICADA','ARQUIVADA')),
  ator_id uuid, ocorreu_em timestamptz NOT NULL DEFAULT now(), versao_esperada integer,
  correlation_id text NOT NULL, conteudo jsonb NOT NULL
);
CREATE INDEX obligation_catalog_audit_rule_idx ON app.obligation_catalog_audit (regra_id, ocorreu_em, id);

CREATE TABLE app.obligation_holiday (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), data date NOT NULL,
  abrangencia text NOT NULL CHECK (abrangencia IN ('NACIONAL', 'ESTADUAL', 'MUNICIPAL')),
  uf text, municipio text, nome text NOT NULL, fonte text NOT NULL, vigente_de date NOT NULL, vigente_ate date,
  versao integer NOT NULL CHECK (versao > 0), criado_por uuid, criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT obligation_holiday_scope CHECK ((abrangencia = 'NACIONAL' AND uf IS NULL AND municipio IS NULL) OR (abrangencia = 'ESTADUAL' AND uf IS NOT NULL AND municipio IS NULL) OR (abrangencia = 'MUNICIPAL' AND uf IS NOT NULL AND municipio IS NOT NULL)),
  CONSTRAINT obligation_holiday_range CHECK (vigente_ate IS NULL OR vigente_ate >= vigente_de),
  CONSTRAINT obligation_holiday_version_fields CHECK (versao > 0)
);
CREATE UNIQUE INDEX obligation_holiday_version_idx ON app.obligation_holiday
  (data, abrangencia, (coalesce(uf, '')), (coalesce(municipio, '')), versao);
CREATE INDEX obligation_holiday_date_idx ON app.obligation_holiday (data, vigente_de, vigente_ate);
CREATE TABLE app.obligation_calendar_coverage (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), abrangencia text NOT NULL CHECK (abrangencia IN ('ESTADUAL','MUNICIPAL')),
  uf text NOT NULL, municipio text, coberto_de date NOT NULL, coberto_ate date NOT NULL,
  fonte text NOT NULL, versao integer NOT NULL CHECK (versao > 0), criado_por uuid, criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT obligation_calendar_coverage_shape CHECK ((abrangencia='ESTADUAL' AND municipio IS NULL) OR (abrangencia='MUNICIPAL' AND municipio IS NOT NULL)),
  CONSTRAINT obligation_calendar_coverage_range CHECK (coberto_ate >= coberto_de)
);
CREATE UNIQUE INDEX obligation_calendar_coverage_version_idx ON app.obligation_calendar_coverage
  (abrangencia,uf,COALESCE(municipio,''),coberto_de,coberto_ate,versao);
CREATE INDEX obligation_calendar_coverage_lookup_idx ON app.obligation_calendar_coverage
  (abrangencia,uf,municipio,coberto_de,coberto_ate,versao DESC);

CREATE TABLE app.obligation_occurrence (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  regra_id uuid NOT NULL REFERENCES app.obligation_rule(id), codigo text NOT NULL, competencia date NOT NULL,
  versao_regra integer NOT NULL, vencimento_nominal date, vencimento_ajustado date,
  estado text NOT NULL CHECK (estado IN ('PENDENTE', 'BLOQUEADA_POR_DEPENDENCIA', 'ENTREGUE', 'VENCIDA', 'NAO_EXIGIVEL', 'COBERTURA_INCOMPLETA')),
  motivo text, dependencias_pendentes text[] NOT NULL DEFAULT '{}', prioridade text NOT NULL DEFAULT 'NORMAL' CHECK (prioridade IN ('NORMAL', 'ALTA', 'CRITICA')),
  versao bigint NOT NULL DEFAULT 1 CHECK (versao > 0), criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT obligation_occurrence_empresa_tenant FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa(id, tenant_id),
  CONSTRAINT obligation_occurrence_identity UNIQUE (tenant_id, empresa_id, codigo, competencia, versao_regra),
  CONSTRAINT obligation_occurrence_dates CHECK (vencimento_ajustado IS NULL OR vencimento_nominal IS NOT NULL)
);
CREATE INDEX obligation_occurrence_tenant_idx ON app.obligation_occurrence (tenant_id);
CREATE INDEX obligation_occurrence_empresa_due_idx ON app.obligation_occurrence (tenant_id, empresa_id, vencimento_ajustado, estado);
CREATE INDEX obligation_occurrence_filter_idx ON app.obligation_occurrence (tenant_id, estado, prioridade, competencia);

CREATE TABLE app.obligation_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  occurrence_id uuid NOT NULL REFERENCES app.obligation_occurrence(id), sequencia integer NOT NULL,
  acao text NOT NULL CHECK (acao IN ('GERADA', 'REAVALIADA', 'BAIXA_REGISTRADA', 'REABERTA', 'ALERTA_ATUALIZADO')),
  estado_anterior text, estado_novo text, data_entrega date, referencia_evidencia text, motivo text,
  autor_id uuid, correlation_id text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT obligation_event_occurrence_seq UNIQUE (occurrence_id, sequencia),
  CONSTRAINT obligation_event_empresa_tenant FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa(id, tenant_id),
  CONSTRAINT obligation_event_autor_tenant FOREIGN KEY (autor_id, tenant_id) REFERENCES app.usuario(id, tenant_id),
  CONSTRAINT obligation_event_baixa CHECK (acao <> 'BAIXA_REGISTRADA' OR (data_entrega IS NOT NULL AND referencia_evidencia IS NOT NULL AND length(btrim(referencia_evidencia)) BETWEEN 1 AND 500)),
  CONSTRAINT obligation_event_reabertura CHECK (acao <> 'REABERTA' OR length(btrim(motivo)) BETWEEN 3 AND 500)
);
CREATE INDEX obligation_event_tenant_idx ON app.obligation_event (tenant_id);
CREATE INDEX obligation_event_occurrence_idx ON app.obligation_event (occurrence_id, sequencia);

CREATE TABLE app.obligation_alert (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  occurrence_id uuid NOT NULL REFERENCES app.obligation_occurrence(id), identidade text NOT NULL,
  prioridade text NOT NULL CHECK (prioridade IN ('ALTA', 'CRITICA')), dias_restantes integer NOT NULL,
  ativo boolean NOT NULL DEFAULT true, criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now(), encerrado_em timestamptz,
  CONSTRAINT obligation_alert_identity UNIQUE (occurrence_id, identidade),
  CONSTRAINT obligation_alert_empresa_tenant FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa(id, tenant_id),
  CONSTRAINT obligation_alert_active_shape CHECK ((ativo AND encerrado_em IS NULL) OR (NOT ativo AND encerrado_em IS NOT NULL))
);
CREATE INDEX obligation_alert_tenant_idx ON app.obligation_alert (tenant_id);
CREATE INDEX obligation_alert_active_idx ON app.obligation_alert (tenant_id, ativo, prioridade);

CREATE TABLE app.obligation_alert_recipient (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  alert_id uuid NOT NULL REFERENCES app.obligation_alert(id), usuario_id uuid NOT NULL,
  papel_snapshot text NOT NULL, carteira_vinculo_id uuid, criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT obligation_alert_recipient_unique UNIQUE (alert_id, usuario_id),
  CONSTRAINT obligation_alert_recipient_empresa_tenant FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa(id, tenant_id),
  CONSTRAINT obligation_alert_recipient_usuario_tenant FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario(id, tenant_id)
);
CREATE INDEX obligation_alert_recipient_tenant_idx ON app.obligation_alert_recipient (tenant_id);
CREATE INDEX obligation_alert_recipient_user_idx ON app.obligation_alert_recipient (tenant_id, usuario_id, criado_em DESC);

CREATE TABLE app.obligation_in_app_notification (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  alert_id uuid NOT NULL REFERENCES app.obligation_alert(id), usuario_id uuid NOT NULL,
  lida boolean NOT NULL DEFAULT false, lida_em timestamptz, criado_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint GENERATED ALWAYS AS IDENTITY,
  CONSTRAINT obligation_in_app_unique UNIQUE (alert_id, usuario_id),
  CONSTRAINT obligation_in_app_empresa_tenant FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa(id, tenant_id),
  CONSTRAINT obligation_in_app_usuario_tenant FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario(id, tenant_id),
  CONSTRAINT obligation_in_app_read_shape CHECK ((NOT lida AND lida_em IS NULL) OR (lida AND lida_em IS NOT NULL))
);
CREATE INDEX obligation_in_app_tenant_idx ON app.obligation_in_app_notification (tenant_id);
CREATE INDEX obligation_in_app_user_idx ON app.obligation_in_app_notification (tenant_id, usuario_id, criado_em DESC);

CREATE TABLE app.obligation_channel_outbox (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  alert_id uuid NOT NULL REFERENCES app.obligation_alert(id), usuario_id uuid NOT NULL,
  canal text NOT NULL CHECK (canal IN ('EMAIL_LOCAL', 'WHATSAPP_LOCAL')), payload_versao integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL, idempotency_key text NOT NULL UNIQUE, estado text NOT NULL DEFAULT 'PENDENTE' CHECK (estado IN ('PENDENTE', 'PROCESSANDO', 'ENTREGUE_LOCAL', 'RETRY', 'ESGOTADO')),
  tentativas integer NOT NULL DEFAULT 0, proxima_tentativa_em timestamptz, erro_sanitizado text, correlation_id text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT obligation_outbox_recipient_channel UNIQUE (alert_id, usuario_id, canal),
  CONSTRAINT obligation_outbox_empresa_tenant FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa(id, tenant_id),
  CONSTRAINT obligation_outbox_usuario_tenant FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario(id, tenant_id)
);
CREATE INDEX obligation_channel_outbox_tenant_idx ON app.obligation_channel_outbox (tenant_id);
CREATE INDEX obligation_channel_outbox_pending_idx ON app.obligation_channel_outbox (estado, proxima_tentativa_em) WHERE estado IN ('PENDENTE', 'RETRY');

DO $$
DECLARE tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['obligation_occurrence','obligation_event','obligation_alert','obligation_alert_recipient','obligation_in_app_notification','obligation_channel_outbox'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', tabela);
    IF tabela = 'obligation_in_app_notification' THEN
      EXECUTE format('CREATE POLICY %I ON app.%I USING (tenant_id = app.tenant_atual() AND usuario_id = app.usuario_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id = app.tenant_atual() AND usuario_id = app.usuario_atual() AND app.empresa_autorizada(empresa_id))', tabela || '_recipient_isolation', tabela);
    ELSE
      EXECUTE format('CREATE POLICY %I ON app.%I USING (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id))', tabela || '_empresa_isolation', tabela);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON app.%I TO contaia_app', tabela);
    EXECUTE format('REVOKE DELETE ON app.%I FROM contaia_app', tabela);
    EXECUTE format('CREATE INDEX %I ON app.%I (empresa_id, tenant_id)', tabela || '_empresa_tenant_idx', tabela);
  END LOOP;
END $$;
REVOKE UPDATE ON app.obligation_event FROM contaia_app;

ALTER TABLE app.obligation_catalog_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.obligation_catalog_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.obligation_rule, app.obligation_holiday, app.obligation_calendar_coverage, app.obligation_catalog_audit FROM contaia_app;

CREATE OR REPLACE FUNCTION app.obligation_catalog_protect_rule() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'versão de regra não pode ser apagada'; END IF;
  IF OLD.estado = 'PUBLICADA' AND NOT (
    NEW.estado = 'ARQUIVADA' AND (to_jsonb(NEW) - 'estado') = (to_jsonb(OLD) - 'estado')
  ) THEN RAISE EXCEPTION 'regra publicada é imutável'; END IF;
  IF OLD.estado = 'ARQUIVADA' THEN RAISE EXCEPTION 'regra arquivada é imutável'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER obligation_rule_immutable BEFORE UPDATE OR DELETE ON app.obligation_rule
  FOR EACH ROW EXECUTE FUNCTION app.obligation_catalog_protect_rule();
CREATE FUNCTION app.obligation_reject_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'catálogo de obrigações é imutável'; END $$;
CREATE TRIGGER obligation_rule_no_truncate BEFORE TRUNCATE ON app.obligation_rule
  FOR EACH STATEMENT EXECUTE FUNCTION app.obligation_reject_truncate();
CREATE TRIGGER obligation_catalog_audit_append_only BEFORE UPDATE OR DELETE ON app.obligation_catalog_audit
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER obligation_catalog_audit_no_truncate BEFORE TRUNCATE ON app.obligation_catalog_audit
  FOR EACH STATEMENT EXECUTE FUNCTION app.obligation_reject_truncate();

CREATE OR REPLACE FUNCTION app.obligation_catalog_context() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.contexto_do_catalogo_tributario()
$$;

CREATE OR REPLACE FUNCTION app.obligation_rule_list() RETURNS SETOF app.obligation_rule
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app AS $$
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();
  RETURN QUERY SELECT r.* FROM app.obligation_rule r ORDER BY r.codigo, r.versao DESC;
END $$;

CREATE OR REPLACE FUNCTION app.obligation_rule_name(p_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app AS $$
DECLARE v_name text;
BEGIN
  IF NOT (app.contexto_do_catalogo_tributario() OR (app.origem_atual() = 'HUMANO' AND app.tenant_atual() IS NOT NULL)
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
      OR (app.origem_atual() = 'HUMANO' AND app.tenant_atual() IS NOT NULL)
      OR (app.origem_atual() = 'SERVICO' AND app.finalidade_atual() = 'PROCESSAMENTO_DE_EMPRESA'
          AND app.tenant_atual() IS NOT NULL AND app.empresa_tecnica_atual() IS NOT NULL)) THEN
    RAISE EXCEPTION 'contexto inválido para leitura de regras publicadas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT r.* FROM app.obligation_rule r
   WHERE r.estado = 'PUBLICADA' AND r.vigente_de <= p_data AND (r.vigente_ate IS NULL OR r.vigente_ate >= p_data)
   ORDER BY r.codigo, r.versao DESC;
END $$;

CREATE OR REPLACE FUNCTION app.obligation_holiday_list(p_inicio date, p_fim date)
RETURNS SETOF app.obligation_holiday
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app AS $$
BEGIN
  IF NOT (app.contexto_do_catalogo_tributario()
      OR (app.origem_atual() = 'HUMANO' AND app.tenant_atual() IS NOT NULL)
      OR (app.origem_atual() = 'SERVICO' AND app.finalidade_atual() = 'PROCESSAMENTO_DE_EMPRESA'
          AND app.tenant_atual() IS NOT NULL AND app.empresa_tecnica_atual() IS NOT NULL)) THEN
    RAISE EXCEPTION 'contexto inválido para leitura do calendário de feriados' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT h.* FROM app.obligation_holiday h
   WHERE h.data BETWEEN p_inicio AND p_fim AND h.vigente_de <= p_inicio AND (h.vigente_ate IS NULL OR h.vigente_ate >= p_inicio)
   ORDER BY h.data, h.abrangencia, h.versao DESC;
END $$;

CREATE OR REPLACE FUNCTION app.obligation_rule_create(p_doc jsonb, p_actor uuid, p_correlation text)
RETURNS app.obligation_rule
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app AS $$
DECLARE v_rule app.obligation_rule; v_version integer;
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();
  PERFORM pg_advisory_xact_lock(hashtextextended(p_doc->>'codigo', 22022));
  SELECT COALESCE(max(versao),0)+1 INTO v_version FROM app.obligation_rule WHERE codigo=p_doc->>'codigo';
  INSERT INTO app.obligation_rule (codigo,versao,nome,regimes,ufs,cnaes,periodicidade,dia_nominal,ajustar_dia_util,
    exige_feriado_estadual,exige_feriado_municipal,dependencias,prioridade_base,penalidade,vigente_de,vigente_ate,criado_por)
  VALUES (p_doc->>'codigo',v_version,p_doc->>'nome',ARRAY(SELECT jsonb_array_elements_text(p_doc->'regimes')),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_doc->'ufs','[]'::jsonb))),ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_doc->'cnaes','[]'::jsonb))),
    p_doc->>'periodicidade',(p_doc->>'diaNominal')::smallint,p_doc->>'ajustarDiaUtil',COALESCE((p_doc->>'exigeFeriadoEstadual')::boolean,false),
    COALESCE((p_doc->>'exigeFeriadoMunicipal')::boolean,false),ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_doc->'dependencias','[]'::jsonb))),
    COALESCE(p_doc->>'prioridadeBase','NORMAL'),p_doc->'penalidade',(p_doc->>'vigenteDe')::date,NULLIF(p_doc->>'vigenteAte','')::date,p_actor)
  RETURNING * INTO v_rule;
  INSERT INTO app.obligation_catalog_audit(regra_id,acao,ator_id,versao_esperada,correlation_id,conteudo)
  VALUES(v_rule.id,'CRIADA',p_actor,0,p_correlation,to_jsonb(v_rule));
  RETURN v_rule;
END $$;

CREATE OR REPLACE FUNCTION app.obligation_rule_publish(p_id uuid, p_expected integer, p_actor uuid, p_correlation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app AS $$
DECLARE v_rule app.obligation_rule;
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();
  SELECT * INTO v_rule FROM app.obligation_rule WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_rule.versao <> p_expected THEN RAISE EXCEPTION 'VERSAO_DESATUALIZADA'; END IF;
  IF v_rule.estado <> 'RASCUNHO' THEN RAISE EXCEPTION 'REGRA_IMUTAVEL'; END IF;
  IF EXISTS (SELECT 1 FROM app.obligation_rule r WHERE r.codigo=v_rule.codigo AND r.estado='PUBLICADA'
     AND r.vigente_de <= COALESCE(v_rule.vigente_ate,'infinity'::date)
     AND COALESCE(r.vigente_ate,'infinity'::date) >= v_rule.vigente_de) THEN
    RAISE EXCEPTION 'VIGENCIA_SOBREPOSTA';
  END IF;
  UPDATE app.obligation_rule SET estado='PUBLICADA',publicado_por=p_actor,publicado_em=now(),conteudo_hash=md5(to_jsonb(v_rule)::text) WHERE id=p_id;
  SELECT * INTO v_rule FROM app.obligation_rule WHERE id=p_id;
  INSERT INTO app.obligation_catalog_audit(regra_id,acao,ator_id,versao_esperada,correlation_id,conteudo)
  VALUES(p_id,'PUBLICADA',p_actor,p_expected,p_correlation,to_jsonb(v_rule));
END $$;

CREATE OR REPLACE FUNCTION app.obligation_rule_archive(p_id uuid, p_expected integer, p_actor uuid, p_correlation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app AS $$
DECLARE v_rule app.obligation_rule;
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();
  SELECT * INTO v_rule FROM app.obligation_rule WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_rule.versao <> p_expected THEN RAISE EXCEPTION 'VERSAO_DESATUALIZADA'; END IF;
  IF v_rule.estado <> 'PUBLICADA' THEN RAISE EXCEPTION 'REGRA_IMUTAVEL'; END IF;
  UPDATE app.obligation_rule SET estado='ARQUIVADA' WHERE id=p_id;
  INSERT INTO app.obligation_catalog_audit(regra_id,acao,ator_id,versao_esperada,correlation_id,conteudo)
  VALUES(p_id,'ARQUIVADA',p_actor,p_expected,p_correlation,to_jsonb(v_rule));
END $$;

CREATE OR REPLACE FUNCTION app.obligation_holiday_save(p_doc jsonb, p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app AS $$
DECLARE v_version integer;
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',p_doc->>'data',p_doc->>'abrangencia',p_doc->>'uf',p_doc->>'municipio'), 22023));
  SELECT COALESCE(max(versao),0)+1 INTO v_version FROM app.obligation_holiday
   WHERE data=(p_doc->>'data')::date AND abrangencia=p_doc->>'abrangencia'
     AND COALESCE(uf,'')=COALESCE(p_doc->>'uf','') AND COALESCE(municipio,'')=COALESCE(p_doc->>'municipio','');
  INSERT INTO app.obligation_holiday(data,abrangencia,uf,municipio,nome,fonte,vigente_de,vigente_ate,versao,criado_por)
  VALUES((p_doc->>'data')::date,p_doc->>'abrangencia',NULLIF(p_doc->>'uf',''),NULLIF(p_doc->>'municipio',''),p_doc->>'nome',p_doc->>'fonte',(p_doc->>'vigenteDe')::date,NULLIF(p_doc->>'vigenteAte','')::date,v_version,p_actor);
END $$;

CREATE OR REPLACE FUNCTION app.obligation_calendar_save_coverage(p_doc jsonb,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app AS $$
DECLARE v_version integer;
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',p_doc->>'abrangencia',p_doc->>'uf',p_doc->>'municipio',p_doc->>'cobertoDe',p_doc->>'cobertoAte'),22024));
  SELECT COALESCE(max(versao),0)+1 INTO v_version FROM app.obligation_calendar_coverage
    WHERE abrangencia=p_doc->>'abrangencia' AND uf=p_doc->>'uf' AND COALESCE(municipio,'')=COALESCE(p_doc->>'municipio','')
      AND coberto_de=(p_doc->>'cobertoDe')::date AND coberto_ate=(p_doc->>'cobertoAte')::date;
  INSERT INTO app.obligation_calendar_coverage(abrangencia,uf,municipio,coberto_de,coberto_ate,fonte,versao,criado_por)
  VALUES(p_doc->>'abrangencia',p_doc->>'uf',NULLIF(p_doc->>'municipio',''),(p_doc->>'cobertoDe')::date,(p_doc->>'cobertoAte')::date,p_doc->>'fonte',v_version,p_actor);
END $$;

CREATE OR REPLACE FUNCTION app.obligation_calendar_has_coverage(p_abrangencia text,p_uf text,p_municipio text,p_competencia date) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, app AS $$
DECLARE v_fim date;
BEGIN
  IF NOT (app.contexto_do_catalogo_tributario()
      OR (app.origem_atual()='HUMANO' AND app.tenant_atual() IS NOT NULL)
      OR (app.origem_atual()='SERVICO' AND app.finalidade_atual()='PROCESSAMENTO_DE_EMPRESA' AND app.tenant_atual() IS NOT NULL AND app.empresa_tecnica_atual() IS NOT NULL)) THEN
    RAISE EXCEPTION 'contexto inválido para consulta de cobertura do calendário' USING ERRCODE='insufficient_privilege';
  END IF;
  v_fim := (date_trunc('month',p_competencia)::date + interval '1 month - 1 day')::date;
  RETURN EXISTS (SELECT 1 FROM app.obligation_calendar_coverage c
    WHERE c.abrangencia=p_abrangencia AND c.uf=p_uf
      AND COALESCE(c.municipio,'')=COALESCE(p_municipio,'')
      AND c.coberto_de <= date_trunc('month',p_competencia)::date AND c.coberto_ate >= v_fim);
END $$;

REVOKE ALL ON FUNCTION app.obligation_rule_list(), app.obligation_rule_name(uuid), app.obligation_published_rules(date), app.obligation_holiday_list(date,date), app.obligation_calendar_has_coverage(text,text,text,date), app.obligation_rule_create(jsonb,uuid,text), app.obligation_rule_publish(uuid,integer,uuid,text), app.obligation_rule_archive(uuid,integer,uuid,text), app.obligation_holiday_save(jsonb,uuid), app.obligation_calendar_save_coverage(jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.obligation_rule_list(), app.obligation_rule_name(uuid), app.obligation_published_rules(date), app.obligation_holiday_list(date,date), app.obligation_calendar_has_coverage(text,text,text,date), app.obligation_rule_create(jsonb,uuid,text), app.obligation_rule_publish(uuid,integer,uuid,text), app.obligation_rule_archive(uuid,integer,uuid,text), app.obligation_holiday_save(jsonb,uuid), app.obligation_calendar_save_coverage(jsonb,uuid) TO contaia_app;
GRANT EXECUTE ON FUNCTION app.obligation_published_rules(date), app.obligation_holiday_list(date,date), app.obligation_calendar_has_coverage(text,text,text,date) TO contaia_dfe_scheduler;
INSERT INTO app.obligation_rule (codigo,versao,nome,regimes,ufs,cnaes,periodicidade,dia_nominal,ajustar_dia_util,exige_feriado_estadual,exige_feriado_municipal,dependencias,prioridade_base,vigente_de,estado,conteudo_hash,publicado_em)
VALUES ('DAS_SIMPLES',1,'DAS do Simples Nacional',ARRAY['SIMPLES_NACIONAL'],'{}','{}','MENSAL',20,'ANTECEDENTE',true,true,'{}','NORMAL','2000-01-01','PUBLICADA',md5('DAS_SIMPLES:1'),now());

CREATE TRIGGER obligation_event_append_only BEFORE UPDATE OR DELETE ON app.obligation_event
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

CREATE OR REPLACE FUNCTION app.obligation_protect_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    RAISE EXCEPTION 'escopo da obrigação é imutável' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.obligation_occurrence FOR EACH ROW EXECUTE FUNCTION app.obligation_protect_scope();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.obligation_event FOR EACH ROW EXECUTE FUNCTION app.obligation_protect_scope();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.obligation_alert FOR EACH ROW EXECUTE FUNCTION app.obligation_protect_scope();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.obligation_alert_recipient FOR EACH ROW EXECUTE FUNCTION app.obligation_protect_scope();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.obligation_in_app_notification FOR EACH ROW EXECUTE FUNCTION app.obligation_protect_scope();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.obligation_channel_outbox FOR EACH ROW EXECUTE FUNCTION app.obligation_protect_scope();

CREATE OR REPLACE FUNCTION app.obligation_companies_pending(p_limite integer DEFAULT 200)
RETURNS TABLE(tenant_id uuid, empresa_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, app AS $$
  SELECT e.tenant_id, e.id FROM app.empresa e
   WHERE e.situacao = 'ativo' AND e.status = 'ATIVA'
   ORDER BY e.tenant_id, e.id LIMIT greatest(1, least(p_limite, 1000))
$$;
ALTER FUNCTION app.obligation_companies_pending(integer) OWNER TO contaia_dfe_scheduler_owner;
GRANT SELECT ON app.empresa TO contaia_dfe_scheduler_owner;
REVOKE ALL ON FUNCTION app.obligation_companies_pending(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.obligation_companies_pending(integer) TO contaia_dfe_scheduler;

CREATE OR REPLACE FUNCTION app.obligation_publishable_outbox(p_limite integer DEFAULT 100)
RETURNS TABLE(id uuid, tenant_id uuid, empresa_id uuid, alert_id uuid, usuario_id uuid, canal text, tentativas integer, correlation_id text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, app AS $$
  SELECT o.id,o.tenant_id,o.empresa_id,o.alert_id,o.usuario_id,o.canal,o.tentativas,o.correlation_id
    FROM app.obligation_channel_outbox o
   WHERE o.estado IN ('PENDENTE','RETRY') AND (o.proxima_tentativa_em IS NULL OR o.proxima_tentativa_em <= now())
   ORDER BY o.criado_em,o.id LIMIT greatest(1, least(p_limite, 500))
$$;
ALTER FUNCTION app.obligation_publishable_outbox(integer) OWNER TO contaia_dfe_scheduler_owner;
GRANT SELECT ON app.obligation_channel_outbox TO contaia_dfe_scheduler_owner;
REVOKE ALL ON FUNCTION app.obligation_publishable_outbox(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.obligation_publishable_outbox(integer) TO contaia_dfe_scheduler;

ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
