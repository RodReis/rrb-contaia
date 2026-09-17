# STATUS-ARQUIVO.md — Histórico detalhado

> Complementa [`STATUS.md`](STATUS.md), que é curto por design. **Prosa longa mora aqui.**
> Ordem cronológica inversa: o mais recente em cima. Entrada não se apaga nem se reescreve — corrige-se com entrada nova.

---

## 17/09/2026 — Contratos de engenharia escritos

**O que aconteceu.** Com o PRD v3.0 aprovado e o design system já escrito, faltava toda a camada de contrato técnico: o repositório tinha PRD, design system e protótipo, mas nenhuma definição de arquitetura, domínio, frontend, git, CI, teste ou revisão. O `CLAUDE.md` listava esses documentos como se existissem.

**O que foi produzido.** `ARCHITECTURE.md`, `CONVENTION.md`, `DECISIONS.md` + `adr/ADR-001..011`, `FRONTEND.md`, `GITHUB.md`, `PRS.md` (reescrito), `CI-PR.md`, `TESTING.md`, `REVIEW.md`, `AUDIT.md`, `DEVELOPMENT.md`, `STATUS.md`, este arquivo, `APRENDIZADOS.md`, `FORA-DE-ESCOPO.md`, `LANDSCAPE.md`, `AGENTES-IA-AUTONOMOS.md`, `prd/mvp/README.md` e `prd/mvp/RASTREABILIDADE.md`.

**Decisões tomadas pelo PI nesta rodada.** Monorepo pnpm+Turborepo; Next.js **16** (a 15 sai de suporte em 21/10/2026, dentro da janela do próprio MVP); Drizzle + RLS por `SET LOCAL`; Vercel + Railway + Docker local; Keycloak self-hosted; pgvector; dinheiro em `BIGINT` de centavos; Recharts via shadcn charts; cobertura com piso por categoria; sem merge queue; `react-imask` + validadores próprios. Regras de domínio que faltavam no PRD: fechamento de competência por ação humana explícita, alçada de aprovação HITL por domínio com carteira, escalonamento de 24h para `admin_escritorio`, e correção contábil exclusivamente por estorno.

**O que ficou de fora, deliberadamente.** O fatiamento em MVP/SPEC (rodada seguinte do Cowork) e `docs/PRIVACIDADE.md` — que exigiria criar regra jurídica sem autorização e permanece apenas como o documento histórico em `prd/histórico/`.

**Risco aberto registrado.** Railway não oferece KMS/HSM gerenciado; o cofre do certificado A1 no MVP não cumpre integralmente o PRD §4.5 e é revisto na Fase 2 ([ADR-003](adr/ADR-003-hospedagem-e-deploy.md), R-01 em [`STATUS.md`](STATUS.md)).

---

## 16/09/2026 — PRD v3.0 aprovado

Consolidação do PRD como fonte única de verdade, com escrituração contábil completa (ECD) dentro do escopo, apenas a Ciência da Emissão como manifestação automática, billing na Fase 4 e onboarding com importação de plano de contas e empregados por CSV.
