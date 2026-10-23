-- SPEC-032/F32: a captura automática é autoria técnica, sem usuário humano atribuído.
ALTER TABLE app.tax_st_authorized_cancellation ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE app.tax_st_settlement_event ALTER COLUMN actor_id DROP NOT NULL;
