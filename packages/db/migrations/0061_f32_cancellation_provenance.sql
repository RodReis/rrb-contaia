-- Only the verified fiscal-event trigger may create authorized cancellations.
ALTER TABLE app.fiscal_document_event
  ADD CONSTRAINT fiscal_document_event_id_scope_key UNIQUE(id,tenant_id,empresa_id);
ALTER TABLE app.tax_st_authorized_cancellation
  ADD CONSTRAINT tax_st_authorized_cancellation_source_event_scope_fk
  FOREIGN KEY(source_event_id,tenant_id,empresa_id)
  REFERENCES app.fiscal_document_event(id,tenant_id,empresa_id);
REVOKE INSERT ON app.tax_st_authorized_cancellation FROM contaia_app;
