-- SPEC-030/F30: abre o escopo técnico somente para worker-nfce e finalidade dedicada.
CREATE OR REPLACE FUNCTION app.contexto_tecnico() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.tenant_atual() IS NOT NULL
     AND app.empresa_tecnica_atual() IS NOT NULL
     AND app.origem_atual() = 'TECNICA'
     AND NULLIF(current_setting('app.identidade_tecnica', true), '') IS NOT NULL
     AND NULLIF(current_setting('app.correlation_id', true), '') IS NOT NULL
     AND (
       app.finalidade_atual() = 'PROCESSAMENTO_DE_EMPRESA'
       OR (app.finalidade_atual() = 'IMPORTACAO_NFCE'
         AND NULLIF(current_setting('app.identidade_tecnica', true), '') = 'worker-nfce')
     );
$$;
