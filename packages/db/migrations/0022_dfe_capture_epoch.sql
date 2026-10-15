-- Evita valores timestamptz -infinity que os clientes JS não conseguem serializar como ISO.
ALTER TABLE app.dfe_capture_state
  ALTER COLUMN proximo_instante_permitido SET DEFAULT '1970-01-01T00:00:00Z';

UPDATE app.dfe_capture_state
   SET proximo_instante_permitido = '1970-01-01T00:00:00Z'
 WHERE proximo_instante_permitido = '-infinity';
