-- Unicidade global do CNPJ do escritorio (SPEC-001 secao 4.2 e secao 6).
--
-- A constraint UNIQUE ja impede o duplicado, mas o erro so aparece no INSERT e
-- a RLS esconde o tenant alheio: a aplicacao nao consegue checar antes nem
-- distinguir "duplicado" de "erro de banco". Esta funcao responde apenas
-- "em uso: sim/nao", sem devolver id, razao social ou qualquer dado do outro
-- tenant — o 409 nao pode revelar a existencia de outro escritorio.

CREATE OR REPLACE FUNCTION app.cnpj_de_escritorio_em_uso(p_cnpj text, p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.tenant
     WHERE cnpj = upper(p_cnpj)
       AND id IS DISTINCT FROM p_tenant_id
  );
$$;

REVOKE ALL ON FUNCTION app.cnpj_de_escritorio_em_uso(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.cnpj_de_escritorio_em_uso(text, uuid) TO contaia_app;
