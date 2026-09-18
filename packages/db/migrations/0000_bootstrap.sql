-- Bootstrap tecnico do banco local. Nenhuma entidade de produto entra aqui:
-- tabela de dominio chega com a fatia que a especifica.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE SCHEMA IF NOT EXISTS app;

-- Papel da aplicacao: sem BYPASSRLS e sem SUPERUSER por contrato
-- (ARCHITECTURE.md 5.1). Senha local, trocada por segredo do cofre fora do MVP.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contaia_app') THEN
    CREATE ROLE contaia_app LOGIN PASSWORD 'contaia_app_local' NOBYPASSRLS NOSUPERUSER;
  ELSE
    ALTER ROLE contaia_app NOBYPASSRLS NOSUPERUSER;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA app, public TO contaia_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO contaia_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO contaia_app;
