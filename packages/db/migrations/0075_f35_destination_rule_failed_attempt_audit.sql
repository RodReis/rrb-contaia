ALTER TABLE app.tax_st_destination_rule_event
  DROP CONSTRAINT tax_st_destination_rule_event_action_check;

ALTER TABLE app.tax_st_destination_rule_event
  ADD CONSTRAINT tax_st_destination_rule_event_action_check
  CHECK (action IN ('IMPORTED','APPROVED','REJECTED','SUPERSEDED','FAILED'));
