# Captura DF-e por NSU — Plano de implementação

> **Para agentes de implementação:** executar tarefa por tarefa com TDD. Em UI, usar `frontend-design`, revisão visual equivalente a `gstack:design-review` e `impeccable`. A SPEC-017 e os contratos de arquitetura vencem este material de apoio.

**Objetivo:** entregar captura observável de NF-e modelo 55 e CT-e por estado de NSU, automática e sob demanda, sem antecipar `tempoMedio`, duplicar itens ou avançar cursor sem staging durável.

**Arquitetura:** domínio puro decide elegibilidade, cursores, bloqueio 656 e falhas. PostgreSQL mantém estado, execução, staging opaco, incidentes e trilha append-only sob RLS. API apenas autoriza, consulta e enfileira; worker possui a orquestração e chama uma porta DF-e tipada do Signer, que termina o mTLS no dublê local.

**Stack:** Node 24, TypeScript strict, NestJS 11, Next.js 16, React 19, PostgreSQL, BullMQ/Redis, Signer mTLS, Zod, Vitest e Playwright.

---

## 1. Mapa de responsabilidades

```text
packages/domain/src/dfe-capture/        políticas puras de estado, tempo e lote
packages/shared/src/dfe-capture.ts      contratos públicos e internos versionados
packages/db/migrations/0020_dfe_capture.sql
packages/db/src/repositorios/dfe-capture.ts
apps/signer/src/dfe/                    porta tipada e tradução segura do dublê
packages/signer-client/src/cliente.ts   cliente mTLS sem URL ou segredo livres
apps/workers/src/dfe-capture/           scheduler, consumidor, retry e DLQ
apps/api/src/dfe-capture/               autorização, consulta e enfileiramento
apps/web/src/features/dfe-capture/      estado operacional e histórico
tests/e2e/spec-017/                      jornada real e contrafactuais
```

O domínio não importa banco, fila, rede ou relógio. API não chama Signer. Worker não recebe certificado. Conteúdo bruto permanece opaco; nenhum XML chega a log, métrica, resposta HTTP ou navegador.

---

### Tarefa 1: Fixar contratos e políticas puras

**Arquivos:**

- Criar: `packages/domain/src/dfe-capture/model.ts`
- Criar: `packages/domain/src/dfe-capture/policy.ts`
- Criar: `packages/domain/src/dfe-capture/policy.test.ts`
- Criar: `packages/shared/src/dfe-capture.ts`
- Modificar: `packages/domain/src/index.ts`
- Modificar: `packages/shared/src/index.ts`

- [ ] Escrever testes vermelhos para elegibilidade, `nextAllowedAt`, monotonicidade, lote máximo 50, espécies aceitas, conflito NSU/chave, classificação 656 e falhas transitórias/definitivas.
- [ ] Executar `pnpm --filter @contaia/domain test:regras -- dfe-capture`; esperado: FAIL por módulo ausente.
- [ ] Implementar uniões fechadas, funções puras com `agora` por parâmetro e schemas Zod `.strict()`; nenhum float de duração ou cursor.
- [ ] Executar testes e typecheck dos pacotes; esperado: PASS.
- [ ] Commit: `feat: define dominio da captura dfe`.

### Tarefa 2: Persistir estado, staging e trilha atômicos

**Arquivos:**

- Criar: `packages/db/migrations/0020_dfe_capture.sql`
- Criar: `packages/db/src/repositorios/dfe-capture.ts`
- Criar: `packages/db/src/dfe-capture.integration.test.ts`
- Modificar: `packages/db/src/index.ts`
- Modificar: `packages/db/src/rls/classificacao.ts`

- [ ] Escrever integrações vermelhas para RLS, unicidade de CNPJ/NSU/chave, cursor monotônico, versão concorrente, commit conjunto, staging opaco e eventos append-only.
- [ ] Executar teste de banco focado; esperado: FAIL por tabelas/funções ausentes.
- [ ] Criar tabelas `dfe_capture_state`, `dfe_capture_run`, `dfe_capture_staging`, `dfe_capture_event` e `dfe_capture_incident`, todas com `tenant_id` e `empresa_id`, índices e RLS.
- [ ] Implementar repositório com transação controlada pelo caso de uso e compare-and-swap na versão; nenhuma atualização em trilha.
- [ ] Executar migration, teste focado e anti-drift; esperado: PASS.
- [ ] Commit: `feat: persiste captura dfe atomica`.

### Tarefa 3: Criar porta DF-e tipada no Signer

**Arquivos:**

- Criar: `apps/signer/src/dfe/distribuicao.ts`
- Criar: `apps/signer/src/dfe/distribuicao.test.ts`
- Modificar: `packages/shared/src/signer.ts`
- Modificar: `packages/signer-client/src/cliente.ts`
- Modificar: `apps/signer/src/alcada.ts`
- Modificar: `apps/signer/src/server.ts`
- Modificar: `apps/signer/src/servicos.ts`
- Modificar: `apps/signer/src/caso-de-uso.ts`
- Modificar: `apps/signer/src/destino.ts`

- [ ] Escrever testes vermelhos do contrato: CNPJ, `ultNSU`, limite fixo 50 e correlação; resposta sanitizada com cursores, `tempoMedio`, código e itens opacos.
- [ ] Provar que identidade API é recusada e identidade workers aceita; campos extras, URL livre e segredo são recusados.
- [ ] Implementar `POST /v1/dfe/distribuicao`; reutilizar cofre, certificado e mTLS existentes, retornando somente envelope validado.
- [ ] Validar Signer, signer-client e testes mTLS; esperado: PASS.
- [ ] Commit: `feat: adiciona porta dfe ao signer`.

### Tarefa 4: Orquestrar scheduler, worker, retry e DLQ

**Arquivos:**

- Criar: `apps/workers/src/dfe-capture/processador.ts`
- Criar: `apps/workers/src/dfe-capture/processador.test.ts`
- Criar: `apps/workers/src/dfe-capture/consumidor.ts`
- Criar: `apps/workers/src/dfe-capture/consumidor.integration.test.ts`
- Modificar: `apps/workers/src/main.ts`
- Modificar: `apps/workers/src/config.ts`

- [ ] Escrever testes vermelhos para exclusão por CNPJ, reutilização de comando, três tentativas totais com backoff/jitter, DLQ, alerta único, retomada e bloqueio 656 isolado.
- [ ] Implementar scheduler por estado e processador que chama apenas `cliente.consultarDfe`.
- [ ] Persistir lote e cursor numa transação; conflito ou resposta inválida não avança cursor.
- [ ] Validar testes de regras, integração Redis/PostgreSQL e typecheck; esperado: PASS.
- [ ] Commit: `feat: processa captura dfe por fila`.

### Tarefa 5: Expor consulta e comando na API

**Arquivos:**

- Criar: `apps/api/src/dfe-capture/dfe-capture.dto.ts`
- Criar: `apps/api/src/dfe-capture/dfe-capture.fila.ts`
- Criar: `apps/api/src/dfe-capture/dfe-capture.service.ts`
- Criar: `apps/api/src/dfe-capture/dfe-capture.controller.ts`
- Criar: `apps/api/src/dfe-capture/dfe-capture.controller.spec.ts`
- Modificar: `apps/api/src/app.module.ts`
- Modificar: `packages/domain/src/papeis/catalogo.ts`

- [ ] Escrever testes vermelhos de autorização: admin do tenant e contador/auxiliar da carteira enfileiram; auditor só consulta; cruzamento de tenant/empresa é negado.
- [ ] Implementar GET de estado, POST assíncrono idempotente e GET paginado de execuções em `application/problem+json`.
- [ ] Provar que POST nunca chama conector e respeita espera, bloqueio e comando pendente.
- [ ] Validar API e catálogo de permissões; esperado: PASS.
- [ ] Commit: `feat: expoe captura dfe na api`.

### Tarefa 6: Entregar seção operacional final

**Arquivos:**

- Criar: `apps/web/src/features/dfe-capture/api.ts`
- Criar: `apps/web/src/features/dfe-capture/queries.ts`
- Criar: `apps/web/src/features/dfe-capture/painel-de-captura.tsx`
- Criar: `apps/web/src/features/dfe-capture/painel-de-captura.test.tsx`
- Modificar: `apps/web/src/features/empresa/manutencao-da-empresa.tsx`

- [ ] Ler `reference/craft-floor.md` imediatamente antes da primeira edição de UI.
- [ ] Escrever testes vermelhos para skeleton, nunca consultado, pronto, espera, fila, execução, lote, deduplicação, falha, DLQ, 656, conflito, vazio, indisponível e acesso negado.
- [ ] Implementar seção no contexto da empresa, preservando direção visual oficial, CLARO/ESCURO, teclado, foco, texto além da cor e horários em `America/Sao_Paulo`.
- [ ] Validar em 768/1024/1440, executar detector Impeccable uma vez e corrigir em lote; confirmar em uma segunda rodada no máximo.
- [ ] Commit: `feat: adiciona painel operacional dfe`.

### Tarefa 7: Evoluir dublê e provar jornada ponta a ponta

**Arquivos:**

- Modificar: `infra/docker/dubles/servidor-mtls.mjs`
- Modificar: `infra/docker/dubles/servidor-mtls.test.mjs`
- Criar: `tests/e2e/spec-017/captura-dfe.spec.ts`
- Criar: fixtures sintéticas em `tests/e2e/spec-017/fixtures/`

- [ ] Escrever testes vermelhos para lote vazio/parcial/50, múltiplos lotes, repetição, fora de ordem, conflito, 656 e indisponibilidade.
- [ ] Fazer dublê devolver envelope determinístico sem interpretar fiscalmente o conteúdo.
- [ ] Provar empresa A1 → fila → worker → Signer → mTLS → staging/cursor → repetição idempotente → `maxNSU`.
- [ ] Provar contrafactuais de tenant/CNPJ, antecipação temporal, concorrência, falha entre staging/cursor e segredo sentinela.
- [ ] Commit: `test: prova captura dfe ponta a ponta`.

### Tarefa 8: Fechar documentação, revisão e entrega

**Arquivos:**

- Modificar: `docs/DEVELOPMENT.md`
- Modificar: `docs/STATUS.md`
- Modificar: `docs/TESTING.md` se surgir comando/prova nova
- Modificar: `docs/CI-PR.md` somente se CI exceder 15 minutos

- [ ] Rodar `check:workspace`, lint, typecheck, build, regras, banco, tela, E2E e provas condicionais; ausência real vira `not_run`, nunca PASS.
- [ ] Revisar diff completo pelos cinco eixos de qualidade e por `docs/REVIEW.md`; P0/P1 bloqueiam.
- [ ] Rebasear sobre `origin/main`, reaplicar apenas progresso do Code em conflito documental e rerodar provas afetadas.
- [ ] Abrir PR com `refs #19`, acompanhar checks do SHA atual, corrigir, squash-merge e confirmar `mergedAt`/`mergeSha`.
- [ ] Publicar comentário de encerramento com Resumo, Aprendizado e Imprevistos; remover `doing`, aplicar `proplan:done`, manter issue aberta para aceite do PI.

---

## 2. Autorrevisão do plano

- Cobertura: SPEC §§3–8 mapeada nas tarefas 1–7; processo e evidência na tarefa 8.
- Fronteira: nenhum parse fiscal, hash definitivo, IBS/CBS, Ciência ou inbox.
- Segurança: nenhum XML/segredo em logs, API, fila ou navegador; saída externa apenas pelo Signer.
- Consistência: cursor e staging pertencem à mesma transação; relógio entra por parâmetro; toda tabela transacional possui tenant e empresa.
- Sem placeholders: cada etapa possui arquivo, comportamento, comando ou critério verificável.
