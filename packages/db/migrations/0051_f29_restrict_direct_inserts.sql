-- SPEC-029/F29: mutações passam pelas funções SECURITY DEFINER, que validam papel,
-- transição e revisão. A role da aplicação mantém somente leitura direta.
REVOKE INSERT ON app.tax_st_settlement_snapshot, app.tax_st_settlement_line,
  app.tax_st_settlement_event FROM contaia_app;
