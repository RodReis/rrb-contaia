# F44 Saldos de abertura — Plano de implementação

> **Para execução:** manter escopo integral da SPEC-044 em uma única entrega vertical.

**Objetivo:** permitir preparar saldos de abertura manualmente ou por CSV, revisar e aprovar uma versão balanceada por empresa, preservando histórico e integrando o movimento `OPENING` ao razão F42.

**Arquitetura:** regras, validação do CSV e hash ficam em funções puras no domínio; migration aditiva persiste rascunhos, prévias, versões, linhas, movimento e eventos sob RLS; API coordena transações e reconstrução F42; interfaces compartilham a mesma API nas rotas da empresa e Contábil. Aprovação e substituição usam bloqueio por empresa, compare-and-swap e idempotência.

**Stack:** TypeScript, NestJS, PostgreSQL, React/Next.js, Zod, csv-parse, Vitest e Playwright.

---

## Estrutura e responsabilidades

- `packages/domain/src/saldos-abertura.ts`: tipos, data-base, centavos, validação de linhas, equilíbrio, parsing pt-BR, canonicalização e hash.
- `packages/domain/src/saldos-abertura.test.ts`: limites e invariantes das regras puras.
- `packages/db/migrations/0089_f44_saldos_abertura.sql`: rascunhos, prévias, versões, linhas, evento, RLS, índices, privilégios e triggers.
- `packages/db/src/rls/classificacao.ts`, `anti-drift.ts`, fixtures/matriz: reconhecer e provar isolamento de cada tabela F44.
- `apps/api/src/saldos-abertura/*`: DTOs, controller, serviço transacional, parser CSV, integração e testes HTTP.
- `apps/api/src/app.module.ts`: registrar módulo F44.
- `apps/api/src/razao-contabil/razao-contabil.service.ts`: incluir origem `OPENING` na consulta, balancete e reconstrução sem numerar lançamento F40.
- `packages/domain/src/razao-contabil.ts`: tratar movimento de abertura sem perder soma dobrada e marco inicial civil.
- `apps/web/src/features/saldos-abertura/*`: API, página/componente, editor manual, upload/prévia, histórico e confirmações.
- `apps/web/src/features/empresa/manutencao-da-empresa.tsx` e rotas `/contabil/saldos-abertura`: integrar as duas entradas aprovadas pela SPEC.
- Catálogo de ações/papéis e respectivos testes: consultar, preparar e aprovar conforme SPEC-044.
- `tests/e2e/spec-044-saldos-abertura.spec.ts`: jornada manual/CSV, aprovação, razão e substituição no Compose de CI.
- `docs/DEVELOPMENT.md` e este plano: registrar progresso, comandos, evidência e limitações; sem alterar documentos reservados ao Cowork.

## Execução

### 1. Regras puras e regressões

- [ ] Escrever testes RED para data-base anterior a movimentos, linha de débito/crédito exclusiva e positiva, chave `(conta, centro)` duplicada, conta/centro inválido, diferença de um centavo, parser pt-BR, limite 10 MB/10.000 linhas, canonicalização estável e inteiros seguros.
- [ ] Implementar as funções em `saldos-abertura.ts`; reutilizar `decodificarCsv` do domínio e `csv-parse` de `@contaia/shared`, coletando todos os erros por linha.
- [ ] Confirmar GREEN da suíte focada e piso de cobertura ADR-008 para regras desta feature.

### 2. Persistência e isolamento

- [ ] Criar migration 0089 para ciclo por empresa, rascunho versionado, prévia CSV, versões imutáveis aprovadas, linhas, movimento `OPENING`, idempotência e eventos append-only; FKs incluem tenant e empresa.
- [ ] Usar privilégio mínimo: RLS SELECT/INSERT e UPDATE somente na tabela editável de rascunho; negar UPDATE/DELETE das versões aprovadas, movimentos e eventos; proibir TRUNCATE.
- [ ] Registrar as tabelas no catálogo anti-drift e adicionar fixtures para admin do tenant, empresa da carteira, outro tenant e usuário sem alçada.
- [ ] Testar a migration no Compose `contaia`, a matriz RLS e os invariantes de unicidade, chaves cruzadas, transições e imutabilidade.

### 3. Serviço e API

- [ ] Criar RED de integração para salvar rascunho desbalanceado sem efeito, validar integralmente ao submeter, aprovar balanceado e repetir por mesma chave sem duplicar movimento/versão.
- [ ] Implementar comandos de criação/edição de rascunho manual, upload+prévia CSV atômica, confirmação por hashes/versões, aprovação e substituição com motivo.
- [ ] Serializar aprovações por tenant/empresa; revalidar carteira, catálogo, data-base anterior aos movimentos e ausência de fechamento F43 afetado; confirmar versão esperada no UPDATE condicional.
- [ ] Integrar a aprovação a uma fonte `OPENING` append-only, sem número F40, e reconstruir F42 na mesma transação; falha não deixa projeção parcial.
- [ ] Adicionar origem `OPENING` à leitura e reconstrução F42; excluir versões `SUPERSEDED` da projeção ativa e comprovar determinismo/idempotência.
- [ ] Rodar testes focados RED/GREEN para duas aprovações concorrentes, aprovação contra edição, RLS, CSV inválido atomicamente recusado, substituição bloqueada por fechamento e rollback por falha de reconstrução.

### 4. Interface final

- [ ] Integrar em `Empresa → Razão contábil → Saldo de abertura` e `/contabil/saldos-abertura`, com mesma autorização e fonte.
- [ ] Construir grade manual com saldo por conta/centro, total devedor/credor/diferença fixa, impedimentos por linha, origem e estado; CSV mostra amostra, erros completos e hash antes de substituir o rascunho.
- [ ] Mostrar versão ativa, data-base, origem, autor, hash e histórico; confirmar aprovação e substituição em AlertDialog com empresa, data-base, totais e motivo.
- [ ] Preservar tokens CLARO/ESCURO e composições aprovadas. Operação de tabela documenta comportamento abaixo de 768px conforme P-02, com foco e teclado completos.
- [ ] Testar estados carregando/vazio/erro/sucesso, permissões por papel e fluxo de preview; aplicar `frontend-design` e passe final `impeccable`.
- [ ] Executar detector Impeccable uma vez depois das alterações, screenshot comparativo CLARO/ESCURO em 768/1024/1440 e smoke Playwright autenticado.

### 5. Cobertura integrada e entrega

- [ ] Adicionar E2E autenticado: preparar manualmente, importar CSV com prévia, aprovar, conferir movimento no razão e substituir com nova versão.
- [ ] Executar `pnpm lint`, `pnpm typecheck`, `pnpm test:regras`, `pnpm test:banco`, `pnpm test:tela`, `pnpm test:e2e`, `pnpm build`, `pnpm docker:up` e `pnpm docker:ps`.
- [ ] Autorrevisar o diff contra `origin/main`, corrigir P0/P1, preencher PR com `refs #58`, SPEC, provas por categoria e `not_run` fiel.
- [ ] Acompanhar todos os checks até verde no HEAD atual, corrigir no mesmo PR, fazer squash, confirmar `mergedAt`/`mergeSha`, publicar encerramento com três seções e só então aplicar `proplan:done`; deixar a issue aberta para PI.
