# STATUS.md — Kanban, roadmap e Índice Fatia ↔ SPEC

> **Prosa curta, sem detalhe.** Detalhe vai para [`STATUS-ARQUIVO.md`](STATUS-ARQUIVO.md).
> O **Índice Fatia ↔ SPEC** (§3) é **fonte única da numeração** e é mantido pelo **Cowork**. O **progresso** (§2) é mantido pelo **Code**, dentro da PR.
> Em conflito de merge neste arquivo: **a versão da `main` vence**; o Code reaplica só o próprio progresso (`CLAUDE.md`).

**Atualizado em:** 18/09/2026

---

## 1. Onde o projeto está

Fase de **fundação executável**. O bootstrap local está no repositório; nenhuma regra de produto foi implementada.

| Frente | Situação |
|---|---|
| PRD v3.1 | aprovado para desenvolvimento |
| Design system | escrito (tokens, componentes, patterns, débito) |
| Contratos de engenharia | escritos: arquitetura, domínio, frontend, git, PR, CI, teste, revisão, auditoria |
| Decisões | ADR-001 a ADR-012; ADR-003 substituída pela ADR-012 |
| MVPs | macroescopos aprovados: [`MVP-1`](prd/mvp/MVP-1-fundacao-captura-e-controle.md) · [`MVP-2`](prd/mvp/MVP-2-fiscal-contabil-e-financeiro.md) · [`MVP-3`](prd/mvp/MVP-3-dp-portal-e-comunicacao.md) · [`MVP-4`](prd/mvp/MVP-4-administracao-e-evolucao.md) |
| Fatias/SPECs | F1/SPEC-001 a F17/SPEC-017 aprovadas |
| Código | bootstrap local entregue (#1): monorepo, Docker, shells de Web, API, workers e Signer, migrations, testes e CI |

---

## 2. Kanban

| Coluna | Cards |
|---|---|
| `proplan:planejado` | — |
| `proplan:backlog` | #7 F6/SPEC-006 · #9 F7/SPEC-007 · #10 F8/SPEC-008 · #11 F9/SPEC-009 · #12 F10/SPEC-010 · #13 F11/SPEC-011 · #14 F12/SPEC-012 · #15 F13/SPEC-013 · #16 F14/SPEC-014 · #17 F15/SPEC-015 · #18 F16/SPEC-016 · #19 F17/SPEC-017 |
| `proplan:todo` | #2 F1/SPEC-001 · #3 F2/SPEC-002 · #4 F3/SPEC-003 · #5 F4/SPEC-004 · #6 F5/SPEC-005 |
| `proplan:doing` | — |
| `proplan:done` | #1 `[INFRA] Bootstrap local do MVP-1` |
| `finalizado` | — |

Quem move o quê: `CLAUDE.md`, "Ciclo de vida do card".

---

## 3. Índice Fatia ↔ SPEC — fonte única da numeração

Cada fatia recebe um `F<n>` e um `SPEC-<nnn>` **iguais**, alocados **uma única vez** pelo Cowork. **Número nunca é reaproveitado.** Uma spec gera exatamente uma fatia.

| MVP | Fatia | SPEC | Slice do PRD | Título | Issue | Situação |
|---|---|---|---|---|---|---|
| MVP-1 | F1 | SPEC-001 | PRD §§4.1, 4.3, 4.4 e 15 | Acesso inicial e conclusão do cadastro do escritório | #2 | `proplan:todo` |
| MVP-1 | F2 | SPEC-002 | PRD §§4.1, 4.3, 4.4 e 15 | Cadastro e ativação da empresa cliente | #3 | `proplan:todo` |
| MVP-1 | F3 | SPEC-003 | PRD §4.1 | Manutenção da empresa cliente | #4 | `proplan:todo` |
| MVP-1 | F4 | SPEC-004 | PRD §4.1 | Documentos da empresa | #5 | `proplan:todo` |
| MVP-1 | F5 | SPEC-005 | PRD §§4.1 e 9.1 | Central de Pendências cadastrais | #6 | `proplan:todo` |
| MVP-1 | F6 | SPEC-006 | PRD §§4.1 e 9.1 | Notificações de pendências | #7 | `proplan:backlog` |
| MVP-1 | F7 | SPEC-007 | PRD §§4.3, 4.4 e 15 | Gestão de usuários e papéis padrão | #9 | `proplan:backlog` |
| MVP-1 | F8 | SPEC-008 | PRD §§4.3, 4.4 e 15 | Papéis personalizados e permissões | #10 | `proplan:backlog` |
| MVP-1 | F9 | SPEC-009 | PRD §§4.3, 4.4, 4.6 e 15 | Carteira do colaborador e isolamento por empresa | #11 | `proplan:backlog` |
| MVP-1 | F10 | SPEC-010 | PRD §§3, 4.4 e 4.6 | RLS de dois níveis e provas negativas | #12 | `proplan:backlog` |
| MVP-1 | F11 | SPEC-011 | PRD §§4.5, 4.6, 15 e 16 | Cofre local de certificados A1 | #13 | `proplan:backlog` |
| MVP-1 | F12 | SPEC-012 | PRD §§4.5, 4.6, 14, 15 e 16 | Signer isolado e assinatura/mTLS simulada | #14 | `proplan:backlog` |
| MVP-1 | F13 | SPEC-013 | PRD §§4.2, 15 e 16 | Importação do plano de contas por CSV | #15 | `proplan:backlog` |
| MVP-1 | F14 | SPEC-014 | PRD §§4.2, 8.1, 15 e 16 | Importação de empregados por CSV | #16 | `proplan:backlog` |
| MVP-1 | F15 | SPEC-015 | PRD §§4.2, 15 e 16 | Importação de planilhas XLSX/ODS | #17 | `proplan:backlog` |
| MVP-1 | F16 | SPEC-016 | PRD §§2, 3, 5.3, 6.1, 6.5, 15 e 16 | Motor tributário base versionado | #18 | `proplan:backlog` |
| MVP-1 | F17 | SPEC-017 | PRD §§3, 4.5, 5.1, 5.4, 14, 15 e 16 | Captura DF-e por NSU | #19 | `proplan:backlog` |

**Próximo número livre: F18 / SPEC-018.**

---

## 4. Roadmap (PRD §16)

| Fase | Entregas | Situação |
|---|---|---|
| **[MVP-1](prd/mvp/MVP-1-fundacao-captura-e-controle.md)** | base operacional de RF-01 · RF-02 (captura DF-e, NSU, ciência automática, inbox) · motor tributário base · agenda mínima · RF-06 (dashboard com semáforo) · Agentes Captura e Compliance inicial | #1 `[INFRA]` concluída; #2–#6, F1/SPEC-001 a F5/SPEC-005, em `proplan:todo`; F6/SPEC-006 a F17/SPEC-017 em backlog; demais fatias pendentes |
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
