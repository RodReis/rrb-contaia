# DECISIONS.md — Índice de decisões arquiteturais

> **Ler antes de propor mudança estrutural.**
> Cada decisão tem um arquivo próprio em [`adr/`](adr/). Este documento é o índice e a regra do processo.

---

## 1. Índice

| ADR | Decisão | Status | Data |
|---|---|---|---|
| [ADR-001](adr/ADR-001-monorepo.md) | Monorepo pnpm + Turborepo | Aceita | 17/09/2026 |
| [ADR-002](adr/ADR-002-stack-frontend.md) | Next.js 16 · React 19 · Tailwind v4 · shadcn · TanStack · RHF+Zod · Zustand | Aceita | 17/09/2026 |
| [ADR-003](adr/ADR-003-hospedagem-e-deploy.md) | Vercel (web) + Railway (back) + Docker local | **Substituída por ADR-012** | 17/09/2026 |
| [ADR-004](adr/ADR-004-acesso-a-dados-e-rls.md) | Drizzle ORM + RLS de dois níveis por `SET LOCAL` | Aceita | 17/09/2026 |
| [ADR-005](adr/ADR-005-representacao-de-dinheiro.md) | Dinheiro em `BIGINT` de centavos | Aceita | 17/09/2026 |
| [ADR-006](adr/ADR-006-mascaras-e-validacao-br.md) | `react-imask` + validadores BR próprios em Zod | Aceita | 17/09/2026 |
| [ADR-007](adr/ADR-007-graficos.md) | Recharts via shadcn charts — **resolve P-01** | Aceita | 17/09/2026 |
| [ADR-008](adr/ADR-008-politica-de-cobertura.md) | Cobertura com piso por categoria de risco | Aceita | 17/09/2026 |
| [ADR-009](adr/ADR-009-ci-runner-e-merge-queue.md) | Runner GitHub-hosted, sem merge queue | Aceita | 17/09/2026 |
| [ADR-010](adr/ADR-010-vector-db.md) | pgvector no PostgreSQL do produto | Aceita | 17/09/2026 |
| [ADR-011](adr/ADR-011-autenticacao.md) | Keycloak self-hosted (OIDC); carteira é dado de produto | Aceita | 17/09/2026 |
| [ADR-012](adr/ADR-012-ambiente-local-ate-ultimo-mvp.md) | Docker local até o MVP-4; produção em etapa posterior | Aceita | 17/09/2026 |

---

## 2. Decisões que vêm do PRD e **não** são ADR

Estas não estão aqui para serem rediscutidas. São requisito, não escolha de engenharia:

- Determinismo fiscal — **LLM nunca calcula** (PRD §2).
- Isolamento em dois níveis por `tenant_id` e `empresa_id` (PRD §3).
- Signer isolado como único detentor da chave privada (PRD §4.5).
- HITL obrigatório, com a Ciência da Emissão como única exceção (PRD §5.2).
- Trilha append-only (PRD §12).
- Next.js + Tailwind + shadcn, sem componente nativo (PRD §14).
- Node/NestJS para API e filas; Python como serviço interno (PRD §2).

Divergir de qualquer uma delas é `[FIX]` ou emenda do PI no PRD — nunca ADR.

---

## 3. Quando escrever uma ADR

Escreve-se ADR quando a decisão:

- **muda uma fronteira** (novo serviço, nova camada, novo repositório);
- **troca uma tecnologia de base** (banco, ORM, framework, provedor de identidade, biblioteca estruturante do front);
- **altera o contrato de prova** (política de cobertura, forma do gate, categoria de teste);
- **cria um custo recorrente** (infraestrutura, serviço pago, operação nova);
- **é cara de reverter** — se corrigir no PR seguinte resolve, não é ADR: é decisão do Code, registrada no PR (`CLAUDE.md`).

**Não** vira ADR: nome de campo, estrutura de pasta dentro de um app, dublê de teste, ordem de implementação interna.

---

## 4. Processo

1. O **Code** propõe pela PR, com o arquivo em `adr/` marcado `Proposta`, quando a implementação exigir a decisão.
2. O **PI** aceita, recusa ou emenda. Só o PI aceita.
3. O **Cowork** registra a ADR aceita direto na `main` e atualiza este índice.
4. **ADR aceita não se edita para mudar de ideia:** decisão nova ganha número novo e marca a anterior como *Substituída por ADR-NNN*. Número não se reaproveita.
5. **Discordar de ADR aceita não é achado de revisão** ([`REVIEW.md`](REVIEW.md) §5) — é proposta de ADR nova.

---

## 5. Decisões com revisão marcada

| Assunto | Quando revisar | Gatilho |
|---|---|---|
| Hospedagem, KMS/HSM e operação produtiva ([ADR-012](adr/ADR-012-ambiente-local-ate-ultimo-mvp.md)) | **etapa de produção, após o MVP-4 e antes de qualquer piloto real** | decisão do PI; requisitos produtivos não foram descartados |
| Merge queue ([ADR-009](adr/ADR-009-ci-runner-e-merge-queue.md)) | quando houver autor concorrente | fila de PRs esperando gate |
| Vector DB dedicado ([ADR-010](adr/ADR-010-vector-db.md)) | quando a latência de busca vetorial competir com a carga transacional | medição, não impressão |
| Thresholds de score (0,50 / 0,60 / 0,85 / 0,90) | trimestralmente | PRD §10.1 — dado de produção |

---

## Referências

- [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`CONVENTION.md`](CONVENTION.md) · [`FRONTEND.md`](FRONTEND.md) · [`REVIEW.md`](REVIEW.md) · [`adr/README.md`](adr/README.md)
