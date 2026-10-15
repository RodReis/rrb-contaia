-- SPEC-017/F17: alerta operacional append-only. Abertura e resolucao sao eventos;
-- nao se altera nem remove um incidente para fechar o historico.

CREATE TABLE app.dfe_capture_alert_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  run_id uuid NOT NULL,
  cnpj text NOT NULL CHECK (cnpj ~ '^\d{14}$'),
  tipo text NOT NULL CHECK (tipo IN ('OPENED', 'RESOLVED')),
  causa text NOT NULL CHECK (causa IN ('DLQ', 'BLOCKED_656')),
  codigo text NOT NULL,
  correlation_id text NOT NULL,
  ocorrido_em timestamptz NOT NULL,
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,
  CONSTRAINT dfe_capture_alert_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT dfe_capture_alert_run_da_empresa
    FOREIGN KEY (run_id, empresa_id, tenant_id)
    REFERENCES app.dfe_capture_run (id, empresa_id, tenant_id)
);

CREATE INDEX dfe_capture_alert_event_tenant_id_idx ON app.dfe_capture_alert_event (tenant_id);
CREATE INDEX dfe_capture_alert_event_empresa_id_idx ON app.dfe_capture_alert_event (empresa_id);
CREATE INDEX dfe_capture_alert_event_latest_idx
  ON app.dfe_capture_alert_event (empresa_id, cnpj, sequencia DESC);

CREATE TRIGGER dfe_capture_alert_event_append_only
  BEFORE UPDATE OR DELETE ON app.dfe_capture_alert_event
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.dfe_capture_alert_event
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();

ALTER TABLE app.dfe_capture_alert_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.dfe_capture_alert_event FORCE ROW LEVEL SECURITY;
CREATE POLICY dfe_capture_alert_event_select ON app.dfe_capture_alert_event FOR SELECT
  USING (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE POLICY dfe_capture_alert_event_insert ON app.dfe_capture_alert_event FOR INSERT
  WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id));

GRANT SELECT, INSERT ON app.dfe_capture_alert_event TO contaia_app;
REVOKE UPDATE, DELETE ON app.dfe_capture_alert_event FROM contaia_app;
