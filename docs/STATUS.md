# STATUS.md — Kanban, roadmap e Índice Fatia ↔ SPEC

> **Prosa curta, sem detalhe.** Detalhe vai para [`STATUS-ARQUIVO.md`](STATUS-ARQUIVO.md).
> O **Índice Fatia ↔ SPEC** (§3) é **fonte única da numeração** e é mantido pelo **Cowork**. O **progresso** (§2) é mantido pelo **Code**, dentro da PR.
> Em conflito de merge neste arquivo: **a versão da `main` vence**; o Code reaplica só o próprio progresso (`CLAUDE.md`).

**Atualizado em:** 25/09/2026

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
| Fatias/SPECs | F1/SPEC-001 a F46/SPEC-046 aprovadas |
| Código | #1 bootstrap local, #2 F1 (acesso e cadastro do escritório), #3 F2 (cadastro e ativação da empresa), #4 F3 (manutenção da empresa e Histórico de Informações), #5 F4 (documentos da empresa), #6 F5 (Central de Pendências cadastrais) e #7 F6 (Notificações de pendências) |

---

## 2. Kanban

| Coluna | Cards |
|---|---|
| `proplan:planejado` | — |
| `proplan:backlog` | #47 `[FIX] app.uuid_v7()` · #9 F7/SPEC-007 · #10 F8/SPEC-008 · #11 F9/SPEC-009 · #12 F10/SPEC-010 · #13 F11/SPEC-011 · #14 F12/SPEC-012 · #15 F13/SPEC-013 · #16 F14/SPEC-014 · #17 F15/SPEC-015 · #18 F16/SPEC-016 · #19 F17/SPEC-017 · #20 F18/SPEC-018 · #21 F19/SPEC-019 · #22 F20/SPEC-020 · #23 F21/SPEC-021 · #24 F22/SPEC-022 · #25 F23/SPEC-023 · #26 F24/SPEC-024 · #27 F25/SPEC-025 · #28 F26/SPEC-026 · #29 F27/SPEC-027 · #32 F28/SPEC-028 · #33 F29/SPEC-029 · #34 F30/SPEC-030 · #35 F31/SPEC-031 · #36 F32/SPEC-032 · #37 F33/SPEC-033 · #38 F34/SPEC-034 · #39 F35/SPEC-035 · #41 F36/SPEC-036 · #43 F37/SPEC-037 · #44 F38/SPEC-038 · #53 F39/SPEC-039 · #54 F40/SPEC-040 · #55 F41/SPEC-041 · #56 F42/SPEC-042 · #57 F43/SPEC-043 · #58 F44/SPEC-044 · #59 F45/SPEC-045 · #60 F46/SPEC-046 |
| `proplan:todo` | — |
| `proplan:doing` | — |
| `proplan:done` | — |
| `proplan:finalizado` | #1 `[INFRA] Bootstrap local do MVP-1` · #2 F1/SPEC-001 · #3 F2/SPEC-002 · #4 F3/SPEC-003 · #5 F4/SPEC-004 · #6 F5/SPEC-005 · #7 F6/SPEC-006 · #45 `[FIX] ambiente local` |

Quem move o quê: `CLAUDE.md`, "Ciclo de vida do card".

---

## 3. Índice Fatia ↔ SPEC — fonte única da numeração

Cada fatia recebe um `F<n>` e um `SPEC-<nnn>` **iguais**, alocados **uma única vez** pelo Cowork. **Número nunca é reaproveitado.** Uma spec gera exatamente uma fatia.

| MVP | Fatia | SPEC | Slice do PRD | Título | Issue | Situação |
|---|---|---|---|---|---|---|
| MVP-1 | F1 | SPEC-001 | PRD §§4.1, 4.3, 4.4 e 15 | Acesso inicial e conclusão do cadastro do escritório | #2 | `proplan:finalizado` |
| MVP-1 | F2 | SPEC-002 | PRD §§4.1, 4.3, 4.4 e 15 | Cadastro e ativação da empresa cliente | #3 | `proplan:finalizado` |
| MVP-1 | F3 | SPEC-003 | PRD §4.1 | Manutenção da empresa cliente | #4 | `proplan:finalizado` |
| MVP-1 | F4 | SPEC-004 | PRD §4.1 | Documentos da empresa | #5 | `proplan:finalizado` |
| MVP-1 | F5 | SPEC-005 | PRD §§4.1 e 9.1 | Central de Pendências cadastrais | #6 | `proplan:finalizado` |
| MVP-1 | F6 | SPEC-006 | PRD §§4.1 e 9.1 | Notificações de pendências | #7 | `proplan:finalizado` |
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
| MVP-1 | F18 | SPEC-018 | PRD §§3, 5.3, 5.4, 6.1, 6.5, 12, 14, 15 e 16 | Parse e persistência de XML, hash e IBS/CBS | #20 | `proplan:backlog` |
| MVP-1 | F19 | SPEC-019 | PRD §§2, 3, 5.2, 5.3, 5.4, 10.2, 12, 14, 15, 16 e 20.2 | Ciência da Emissão automática | #21 | `proplan:backlog` |
| MVP-1 | F20 | SPEC-020 | PRD §§2, 3, 5.2, 5.4, 10.1, 10.2, 12, 14, 15, 16 e Anexo A.1 | Classificação de risco e proposta de manifestação | #22 | `proplan:backlog` |
| MVP-1 | F21 | SPEC-021 | PRD §§2, 3, 5.2, 10.1, 10.2, 12, 13.1, 14, 15, 16, 20.2 e Anexo A.1 | Inbox, aprovação e transmissão de manifestações | #23 | `proplan:backlog` |
| MVP-1 | F22 | SPEC-022 | PRD §§6.3, 6.5, 9.1, 10.5, 15, 16 e Anexo B.1 | Agenda de obrigações e alertas D-3 | #24 | `proplan:backlog` |
| MVP-1 | F23 | SPEC-023 | PRD §§9.1, 9.4, 15 e 16 | Dashboard multiempresa com semáforo e drill-down | #25 | `proplan:backlog` |
| MVP-1 | F24 | SPEC-024 | PRD §§2, 3, 5.4, 10.1, 10.2, 10.5, 12, 14, 15 e 16 | Auditoria append-only e decisões dos agentes | #26 | `proplan:backlog` |
| MVP-1 | F25 | SPEC-025 | PRD §§3, 4.5, 12, 13.1, 15 e 16 | Procuração eletrônica RFB/e-CAC | #27 | `proplan:backlog` |
| MVP-2 | F26 | SPEC-026 | PRD §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16 | Resolução tributária de entradas NF-e em Goiás | #28 | `proplan:backlog` |
| MVP-2 | F27 | SPEC-027 | PRD §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16 | ICMS-ST retido em entradas de autopeças em Goiás | #29 | `proplan:backlog` |
| MVP-2 | F28 | SPEC-028 | PRD §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16 | ICMS na entrada histórica de autopeças em Goiás | #32 | `proplan:backlog` |
| MVP-2 | F29 | SPEC-029 | PRD §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16 | Complemento e restituição do ICMS-ST de autopeças em Goiás | #33 | `proplan:backlog` |
| MVP-2 | F30 | SPEC-030 | PRD §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16 | Importação e normalização de NFC-e modelo 65 em Goiás | #34 | `proplan:backlog` |
| MVP-2 | F31 | SPEC-031 | PRD §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16 | Inclusão da NFC-e no complemento e restituição do ICMS-ST de autopeças em Goiás | #35 | `proplan:backlog` |
| MVP-2 | F32 | SPEC-032 | PRD §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16 | Eventos posteriores no complemento e restituição do ICMS-ST | #36 | `proplan:backlog` |
| MVP-2 | F33 | SPEC-033 | PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16 | Reconstrução histórica do ICMS-ST de autopeças em Goiás | #37 | `proplan:backlog` |
| MVP-2 | F34 | SPEC-034 | PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16 | Acréscimos legais da reconstrução histórica do ICMS-ST em Goiás | #38 | `proplan:backlog` |
| MVP-2 | F35 | SPEC-035 | PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16 | Dossiê interno de decisão do ICMS-ST histórico | #39 | `proplan:backlog` |
| MVP-2 | F36 | SPEC-036 | PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16 | Apuração mensal e guias prévias para comércio de autopeças em Goiás | #41 | `proplan:backlog` |
| MVP-2 | F37 | SPEC-037 | PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16 | Apuração mensal de PIS e Cofins para autopeças no Lucro Presumido | #43 | `proplan:backlog` |
| MVP-2 | F38 | SPEC-038 | PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16 | Apuração trimestral de IRPJ e CSLL para autopeças no Lucro Presumido | #44 | `proplan:backlog` |
| MVP-2 | F39 | SPEC-039 | PRD §§3, 4.2, 6.2, 10.3, 12, 14, 15 e 16 | Catálogo contábil operacional | #53 | `proplan:backlog` |
| MVP-2 | F40 | SPEC-040 | PRD §§3, 6.2, 6.5, 12, 14, 15 e 16 | Lançamentos contábeis manuais balanceados | #54 | `proplan:backlog` |
| MVP-2 | F41 | SPEC-041 | PRD §§3, 5.3, 6.2, 6.5, 10.3, 12, 14, 15 e 16 | Motor determinístico de partidas contábeis | #55 | `proplan:backlog` |
| MVP-2 | F42 | SPEC-042 | PRD §§3, 6.2, 6.5, 12, 14, 15 e 16 | Razão contábil e balancete por período | #56 | `proplan:backlog` |
| MVP-2 | F43 | SPEC-043 | PRD §§3, 6.2, 6.5, 12, 14, 15 e 16 | Fechamento e reabertura de competência contábil | #57 | `proplan:backlog` |
| MVP-2 | F44 | SPEC-044 | PRD §§3, 4.2, 6.2, 6.5, 12, 14, 15 e 16 | Saldos de abertura contábil | #58 | `proplan:backlog` |
| MVP-2 | F45 | SPEC-045 | PRD §§3, 6.2, 6.5, 7.1, 12, 14, 15 e 16 | DRE gerencial por empresa | #59 | `proplan:backlog` |
| MVP-2 | F46 | SPEC-046 | PRD §§3, 6.2, 6.5, 7.1, 12, 14, 15 e 16 | Modelos de DRE do escritório | #60 | `proplan:backlog` |

Próximo número livre: **F47 / SPEC-047**.

---

## 4. Roadmap (PRD §16)

| Fase | Entregas | Situação |
|---|---|---|
| **[MVP-1](prd/mvp/MVP-1-fundacao-captura-e-controle.md)** | base operacional de RF-01 · RF-02 (captura DF-e, NSU, ciência automática, classificação e inbox) · motor tributário base · agenda mínima · RF-06 (dashboard com semáforo) · Agentes Captura e Compliance inicial | #1 `[INFRA]` concluída; #2–#7, F1/SPEC-001 a F6/SPEC-006, `proplan:finalizado`; F7/SPEC-007 a F25/SPEC-025 em backlog; demais fatias pendentes |
| **[MVP-2](prd/mvp/MVP-2-fiscal-contabil-e-financeiro.md)** | RF-03 completo · RF-04 · malha preventiva · Agentes Classificador, Conciliador e Compliance completo | F26/SPEC-026 a F46/SPEC-046 aprovadas; demais fatias pendentes |
| **[MVP-3](prd/mvp/MVP-3-dp-portal-e-comunicacao.md)** | RF-05 (DP/eSocial) · portal white-label · canal ativo · Copiloto · Coletor | macroescopo aprovado; fatias pendentes |
| **[MVP-4](prd/mvp/MVP-4-administracao-e-evolucao.md)** | RF-08 completo · IBS/CBS completo · API pública · Marketplace · colaboração multiagente · preparação para certificações | macroescopo aprovado; API e Marketplace têm decisões pendentes |
| **Produção** | hospedagem, KMS/HSM, região, storage, backup/restore, observabilidade, migração, rollback e piloto real | somente após o MVP-4 |

---

## 5. Pendências que bloqueiam fatia

| ID | Pendência | Bloqueia | Situação |
|---|---|---|---|
| **P-01** | Biblioteca e tipos de gráfico | Dashboard, Relatórios | **resolvida** — [ADR-007](adr/ADR-007-graficos.md) |
| **P-02** | Colapso de tabela em mobile: colunas sobreviventes e ação de linha | primeira fatia com tabela que precise de mobile real | **resolvida na F23/SPEC-023** — empresa, estado, motivo e ação sobrevivem; demais dados ficam no detalhe |
| **R-01** | Infraestrutura produtiva com KMS/HSM ainda não definida | nenhuma fatia dos MVPs; bloqueia produção e piloto real após o MVP-4 | **transferida para o gate produtivo** — [ADR-012](adr/ADR-012-ambiente-local-ate-ultimo-mvp.md) |

---

## Referências

- [`DEVELOPMENT.md`](DEVELOPMENT.md) · [`STATUS-ARQUIVO.md`](STATUS-ARQUIVO.md) · [`FORA-DE-ESCOPO.md`](FORA-DE-ESCOPO.md) · [`prd/mvp/README.md`](prd/mvp/README.md) · [`prd/mvp/RASTREABILIDADE.md`](prd/mvp/RASTREABILIDADE.md)
