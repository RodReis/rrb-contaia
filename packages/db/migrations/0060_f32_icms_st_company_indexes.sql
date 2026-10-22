-- Anti-drift requires a standalone company index for every company-scoped table.
CREATE INDEX tax_st_authorized_cancellation_empresa_idx ON app.tax_st_authorized_cancellation(empresa_id);
CREATE INDEX tax_st_return_event_empresa_idx ON app.tax_st_return_event(empresa_id);
CREATE INDEX tax_st_return_reversal_empresa_idx ON app.tax_st_return_reversal(empresa_id);
