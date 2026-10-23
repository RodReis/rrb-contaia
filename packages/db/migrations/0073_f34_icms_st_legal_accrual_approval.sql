-- F34 aprova o pacote F33 de origem sem alterar os eventos históricos já gravados.
ALTER TABLE app.tax_st_history_package_event DROP CONSTRAINT tax_st_history_package_event_action_check;
ALTER TABLE app.tax_st_history_package_event ADD CONSTRAINT tax_st_history_package_event_action_check
  CHECK (action IN ('SELECTED','GENERATED','DOWNLOADED','REPRODUCED','SUPERSEDED','FAILED','APPROVED'));
CREATE UNIQUE INDEX tax_st_history_package_single_f34_approval_idx ON app.tax_st_history_package_event(package_id)
  WHERE action='APPROVED';
REVOKE UPDATE,DELETE,TRUNCATE ON app.tax_st_history_package_event FROM contaia_app;
GRANT SELECT,INSERT ON app.tax_st_history_package_event TO contaia_app;
