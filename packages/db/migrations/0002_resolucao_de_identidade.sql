-- Resolucao da identidade OIDC -> usuario/tenant (SPEC-001 secao 3.1).
--
-- Problema: `app.usuario` esta sob RLS por `tenant_id`, mas no login ainda nao
-- se sabe qual e o tenant — e justamente o que se quer descobrir. Dar
-- BYPASSRLS a aplicacao resolveria e abriria o banco inteiro.
--
-- Caminho estreito: uma funcao SECURITY DEFINER que aceita um `sub` e devolve
-- exclusivamente o par (usuario, tenant, papel, status) daquele `sub`. Nao
-- aceita filtro livre, nao lista usuarios e nao expoe outra coluna.

CREATE OR REPLACE FUNCTION app.resolver_identidade(p_sub text)
RETURNS TABLE (
  usuario_id uuid,
  tenant_id uuid,
  papel text,
  usuario_situacao text,
  tenant_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- `search_path` fixo: sem isso um schema no caminho do chamador poderia
-- sequestrar a resolucao de nome dentro de uma funcao com privilegio elevado.
SET search_path = app, pg_catalog
AS $$
  SELECT u.id, u.tenant_id, u.papel, u.situacao, t.status
    FROM app.usuario u
    JOIN app.tenant t ON t.id = u.tenant_id
   WHERE u.sub_oidc = p_sub
     AND u.situacao = 'ativo';
$$;

REVOKE ALL ON FUNCTION app.resolver_identidade(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolver_identidade(text) TO contaia_app;
