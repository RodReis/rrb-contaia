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
| PRD v3.1 | aprovado para desenvolvimento |
| Design system | escrito (tokens, componentes, patterns, débito) |
| Contratos de engenharia | escritos: arquitetura, domínio, frontend, git, PR, CI, teste, revisão, auditoria |
| Decisões | ADR-001 a ADR-012; ADR-003 substituída pela ADR-012 |
| MVPs | macroescopos aprovados: [`MVP-1`](prd/mvp/MVP-1-fundacao-captura-e-controle.md) · [`MVP-2`](prd/mvp/MVP-2-fiscal-contabil-e-financeiro.md) · [`MVP-3`](prd/mvp/MVP-3-dp-portal-e-comunicacao.md) · [`MVP-4`](prd/mvp/MVP-4-administracao-e-evolucao.md) |
| Fatias/SPECs | F1/SPEC-001 e F2/SPEC-002 aprovadas; F3/SPEC-003 e F4/SPEC-004 planejadas |
| Código | não iniciado |

---

## 2. Kanban

| Coluna | Cards |
|---|---|
| `proplan:planejado` | — |
| `proplan:backlog` | — |
| `proplan:todo` | #1 `[INFRA] Bootstrap local do MVP-1` · #2 F1/SPEC-001 · #3 F2/SPEC-002 |
| `proplan:doing` | — |
| `proplan:done` | — |
| `finalizado` | — |

Quem move o quê: `CLAUDE.md`, "Ciclo de vida do card".

---

## 3. Índice Fatia ↔ SPEC — fonte única da numeração

Cada fatia recebe um `F<n>` e um `SPEC-<nnn>` **iguais**, alocados **uma única vez** pelo Cowork. **Número nunca é reaproveitado.** Uma spec gera exatamente uma fatia.

| MVP | Fatia | SPEC | Slice do PRD | Título | Issue | Situação |
|---|---|---|---|---|---|---|
| MVP-1 | F1 | SPEC-001 | PRD §§4.1, 4.3, 4.4 e 15 | Acesso inicial e conclusão do cadastro do escritório | #2 | `proplan:todo` |
| MVP-1 | F2 | SPEC-002 | PRD §§4.1, 4.3, 4.4 e 15 | Cadastro e ativação da empresa cliente | #3 | `proplan:todo` |
| MVP-1 | F3 | SPEC-003 | PRD §4.1 | Manutenção da empresa cliente | — | planejada; especificação pendente |
| MVP-1 | F4 | SPEC-004 | PRD §4.1 | Documentos e pendências cadastrais | — | planejada; especificação pendente |

**Próximo número livre: F5 / SPEC-005.**

---

## 4. Roadmap (PRD §16)

| Fase | Entregas | Situação |
|---|---|---|
| **[MVP-1](prd/mvp/MVP-1-fundacao-captura-e-controle.md)** | base operacional de RF-01 · RF-02 (captura DF-e, NSU, ciência automática, inbox) · motor tributário base · agenda mínima · RF-06 (dashboard com semáforo) · Agentes Captura e Compliance inicial | #1 `[INFRA]`, #2 F1/SPEC-001 e #3 F2/SPEC-002 em `proplan:todo`; F3/F4 planejadas; demais fatias pendentes |
| **[MVP-2](prd/mvp/MVP-2-fiscal-contabil-e-financeiro.md)** | RF-03 completo · RF-04 · malha preventiva · Agentes Classificador, Conciliador e Compliance completo | macroescopo aprovado; fatias pendentes |
| **[MVP-3](prd/mvp/MVP-3-dp-portal-e-comunicacao.md)** | RF-05 (DP/eSocial) · portal white-label · canal ativo · Copiloto · Coletor | macroescopo aprovado; fatias pendentes |
| **[MVP-4](prd/mvp/MVP-4-administracao-e-evolucao.md)** | RF-08 completo · IBS/CBS completo · API pública · Marketplace · colaboração multiagente · preparação para certificações | macroescopo aprovado; API e Marketplace têm decisões pendentes |
| **Produção** | hospedagem, KMS/HSM, região, storage, backup/restore, observabilidade, migração, rollback e piloto real | somente após o MVP-4 |

---

## 5. Pendências que bloqueiam fatia

| ID | Pendência | Bloqueia | Situação |
|---|---|---|---|
| **P-01** | Biblioteca e tipos de gráfico | Dashboard, Relatórios | **resolvida** — [ADR-007](adr/ADR-007-graficos.md) |
| **P-02** | Colapso de tabela em mobile: colunas sobreviventes e ação de linha | primeira fatia com tabela que precise de mobile real | **aberta** |
| **R-01** | Infraestrutura produtiva com KMS/HSM ainda não definida | nenhuma fatia dos MVPs; bloqueia produção e piloto real após o MVP-4 | **transferida para o gate produtivo** — [ADR-012](adr/ADR-012-ambiente-local-ate-ultimo-mvp.md) |

---

## Referências

- [`DEVELOPMENT.md`](DEVELOPMENT.md) · [`STATUS-ARQUIVO.md`](STATUS-ARQUIVO.md) · [`FORA-DE-ESCOPO.md`](FORA-DE-ESCOPO.md) · [`prd/mvp/README.md`](prd/mvp/README.md) · [`prd/mvp/RASTREABILIDADE.md`](prd/mvp/RASTREABILIDADE.md)
