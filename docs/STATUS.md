# STATUS.md — Kanban, roadmap e Índice Fatia ↔ SPEC

> **Prosa curta, sem detalhe.** Detalhe vai para [`STATUS-ARQUIVO.md`](STATUS-ARQUIVO.md).
> O **Índice Fatia ↔ SPEC** (§3) é **fonte única da numeração** e é mantido pelo **Cowork**. O **progresso** (§2) é mantido pelo **Code**, dentro da PR.
> Em conflito de merge neste arquivo: **a versão da `main` vence**; o Code reaplica só o próprio progresso (`CLAUDE.md`).

**Atualizado em:** 17/09/2026

---

## 1. Onde o projeto está

Fase de **documentação e contratos**. Não há código de aplicação no repositório.

| Frente | Situação |
|---|---|
| PRD v3.0 | aprovado para desenvolvimento |
| Design system | escrito (tokens, componentes, patterns, débito) |
| Contratos de engenharia | escritos: arquitetura, domínio, frontend, git, PR, CI, teste, revisão, auditoria |
| Decisões | ADR-001 a ADR-011 aceitas |
| Fatiamento MVP/SPEC | **não iniciado** — próxima rodada do Cowork |
| Código | não iniciado |

---

## 2. Kanban

| Coluna | Cards |
|---|---|
| `proplan:planejado` | — |
| `proplan:backlog` | — |
| `proplan:todo` | — |
| `proplan:doing` | — |
| `proplan:done` | — |
| `finalizado` | — |

Quem move o quê: `CLAUDE.md`, "Ciclo de vida do card".

---

## 3. Índice Fatia ↔ SPEC — fonte única da numeração

Cada fatia recebe um `F<n>` e um `SPEC-<nnn>` **iguais**, alocados **uma única vez** pelo Cowork. **Número nunca é reaproveitado.** Uma spec gera exatamente uma fatia.

| MVP | Fatia | SPEC | Slice do PRD | Título | Issue | Situação |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

**Próximo número livre: F1 / SPEC-001.**

---

## 4. Roadmap (PRD §16)

| Fase | Entregas | Situação |
|---|---|---|
| **MVP** | RF-01 completo · RF-02 (captura DF-e, NSU, ciência automática, inbox) · RF-06 (dashboard com semáforo) · Agentes Captura e Compliance | não iniciado |
| **Fase 2** | RF-03 completo · RF-04 · malha preventiva · Agentes Classificador e Conciliador | não iniciado |
| **Fase 3** | RF-05 (DP/eSocial) · portal white-label · canal WhatsApp · Copiloto · Coletor | não iniciado |
| **Fase 4** | RF-08 completo · IBS/CBS completo · API pública · certificações | não iniciado |

---

## 5. Pendências que bloqueiam fatia

| ID | Pendência | Bloqueia | Situação |
|---|---|---|---|
| **P-01** | Biblioteca e tipos de gráfico | Dashboard, Relatórios | **resolvida** — [ADR-007](adr/ADR-007-graficos.md) |
| **P-02** | Colapso de tabela em mobile: colunas sobreviventes e ação de linha | primeira fatia com tabela que precise de mobile real | **aberta** |
| **R-01** | Cofre de certificado sem KMS/HSM gerenciado no MVP (PRD §4.5 não cumprido integralmente) | nenhuma fatia; revisão obrigatória na Fase 2 | **aberta** — [ADR-003](adr/ADR-003-hospedagem-e-deploy.md) |

---

## Referências

- [`DEVELOPMENT.md`](DEVELOPMENT.md) · [`STATUS-ARQUIVO.md`](STATUS-ARQUIVO.md) · [`FORA-DE-ESCOPO.md`](FORA-DE-ESCOPO.md) · [`prd/mvp/README.md`](prd/mvp/README.md) · [`prd/mvp/RASTREABILIDADE.md`](prd/mvp/RASTREABILIDADE.md)
