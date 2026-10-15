-- Reprocessamento autorizado precisa deixar identificado quem retomou a execução.
ALTER TABLE app.dfe_capture_event
  ADD COLUMN usuario_ator_id uuid;

ALTER TABLE app.dfe_capture_event
  ADD CONSTRAINT dfe_capture_event_ator_do_tenant
  FOREIGN KEY (usuario_ator_id, tenant_id) REFERENCES app.usuario (id, tenant_id);
