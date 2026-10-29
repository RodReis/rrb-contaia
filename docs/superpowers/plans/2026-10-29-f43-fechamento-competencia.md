# Plano F43 — Fechamento e reabertura de competência

**Objetivo:** entregar ciclos mensais versionados, snapshots reproduzíveis e bloqueios de lançamentos conforme SPEC-043.

**Arquitetura:** funções puras de validação/canonicalização/hash no domínio; migration append-only com RLS para ciclos, snapshots e eventos; serviço de fechamento reutilizado pelo razão e por F40 na transação do caso de uso. Rotas e telas de razão integram consulta e comandos.

**Stack:** TypeScript, NestJS, PostgreSQL, React, Vitest, Playwright.

## Sequência

- [x] Domínio: validação de competência, sequência, gates, snapshot canônico SHA-256, limites de inteiros e testes.
- [x] Banco: migration 0088, ciclos/fechamentos/linhas/eventos, idempotência, RLS, privilégios e triggers imutáveis; catálogo anti-drift reconhece `company_id` do esquema F43.
- [x] API: consulta e comandos fechar/reabrir com transação, advisory lock, eventos de sucesso/recusa, autorização e carteira.
- [x] F40: impedir criar/editar/efetivar/cancelar lançamento na competência fechada; manter estorno permitido. Serializar gravações e fechamento pela mesma chave da empresa.
- [x] Permissões: catálogo e matriz padrão conforme SPEC-043; admin fecha/reabre, contador fecha, auxiliares/auditor consultam.
- [x] UI: painel Fechamentos integrado ao razão, com estados, snapshots/histórico e confirmações de fechamento/reabertura.
- [x] Testes focados: domínio 10, integração API F42/F43 1, integração DB F42/F43 3, matriz RLS 5 e anti-drift 17; UI focal 3.
- [x] Lint, typecheck, build, regras completas e telas completas passaram. `test:banco` amplo teve 4 suítes antigas falhando no banco persistente compartilhado por dados fixos; 37 suítes passaram, incluindo as novas provas focadas.
- [ ] E2E autenticada e provas visuais da tela F43: runner local expirou aguardando servidores; login seed retorna a `/acesso` porque o sujeito não corresponde à fixture do banco. Validar no CI com ambiente efêmero.
- [ ] Revisão final, PR `refs #57`, CI verde e fluxo de encerramento.
