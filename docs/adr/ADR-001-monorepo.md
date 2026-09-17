# ADR-001 — Monorepo pnpm + Turborepo

- **Status:** Aceita · **Data:** 17/09/2026 · **Decisor:** PI

## Contexto
O produto tem cinco executáveis (web Next.js, API NestJS, workers, Signer, serviço Python de IA) que compartilham contratos, schemas e tipos. A unidade de trabalho do projeto é **card = fatia** (`CLAUDE.md`), e uma fatia costuma atravessar tela e API. O teto de 15 min do gate de PR ([`CI-PR.md`](../CI-PR.md)) exige rodar só o que foi afetado.

## Decisão
Monorepo único com **pnpm workspaces + Turborepo**: `apps/{web,api,workers,signer}`, `services/ai`, `packages/{shared,domain,config}`, `infra/`.

## Consequências
- Uma fatia = uma PR = um gate, mesmo cruzando front e back.
- Contrato compartilhado (`packages/shared`) elimina divergência de schema entre cliente e servidor.
- `turbo run --filter=...[origin/main]` dá a base do CI condicional por mudança.
- Exige disciplina de fronteira: `packages/domain` não importa framework.

## Riscos
- Filtro de afetados mal configurado gera PASS falso — mitigado pela regra de forçar a matriz inteira em mudança de migration, schema compartilhado, build ou CI ([`CI-PR.md`](../CI-PR.md) §3.2).
- Repositório único com o Signer dentro: o **isolamento do Signer é de rede e de segredo em runtime**, não de repositório.

## Alternativas descartadas
- Repositórios separados: quebraria card = fatia (dois PRs sem gate comum).
- Monorepo sem Turborepo: orquestração e cache manuais em YAML, CI mais lenta.
