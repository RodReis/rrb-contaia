# MVP-2 — Fiscal, contábil e financeiro

> **Estado:** macroescopo aprovado pelo PI em 17/09/2026 · fatias/SPECs ainda não numeradas
> **Base:** PRD v3.1 §§6, 7, 10.3, 10.4 e 10.5
> **Dependência:** MVP-1 finalizado
> **Ambiente:** Docker local, sem produção; qualquer dado real necessário está previamente autorizado no ambiente local ([ADR-012](../../adr/ADR-012-ambiente-local-ate-ultimo-mvp.md))

## 1. Objetivo

Transformar os documentos e cadastros do MVP-1 em operação fiscal, contábil e financeira determinística: apurar, escriturar, fechar competências, administrar títulos, conciliar transações e detectar inconsistências antes do fechamento.

Toda capacidade com tela entrega a interface final desde sua própria fatia, nos temas CLARO e ESCURO, seguindo [`../../FRONTEND.md`](../../FRONTEND.md) §20.1, [`../../DESIGN-SYSTEM.md`](../../DESIGN-SYSTEM.md), `docs/design-system/` e a tela correspondente em `docs/telas/`. `frontend-design` e `impeccable` são obrigatórias; acabamento visual não pode ser transferido para outro card ou MVP.

## 2. Capacidades aprovadas

Cada capacidade será decomposta em fatias verticais Curto/Médio antes da reserva de F/SPEC. Nenhum item grande abaixo autoriza uma única issue monolítica.

- [ ] Regras tributárias completas por regime e vigência.
- [ ] Apuração determinística de ICMS, PIS, COFINS e IBS/CBS.
- [ ] Geração de DAS, DARF, GPS e FGTS-REINF.
- [ ] Plano de contas e centros de custo operacionais.
- [ ] Motor de partidas dobradas.
- [ ] Razão contábil e fechamento de competência.
- [ ] Estorno, cancelamento controlado e reabertura auditada.
- [ ] Escrituração dos livros fiscais.
- [ ] SPED Fiscal.
- [ ] SPED Contábil/ECD.
- [ ] Motor completo de obrigações por regime, UF e CNAE.
- [ ] Pré-requisitos, penalidades, dependências e sucessão tributária.
- [ ] Malha preventiva: SPED × DF-e × extrato antes do fechamento.
- [ ] Contas a pagar e receber.
- [ ] Importação de boleto e CNAB 240/400.
- [ ] Aging e fluxo de caixa projetado.
- [ ] DRE gerencial alimentada pelo razão.
- [ ] Open Finance com consentimento, extratos, saldos e webhooks.
- [ ] ITP, com autorização final exclusivamente no banco.
- [ ] Cobrança Pix e baixa idempotente.
- [ ] Conciliação determinística multi-critério.
- [ ] Classificação contábil assistida por embeddings e histórico.
- [ ] Agente Classificador integrado ao fluxo de classificação.
- [ ] Agente Conciliador integrado ao fluxo financeiro.
- [ ] Compliance completo, evoluindo os alertas mínimos do MVP-1.
- [ ] Saúde da aplicação: tenants ativos, DAU/MAU e consumo por tenant, sem billing.

## 3. Reconciliação do escopo

| Item anterior/PRD | Estado neste MVP | Complemento/destino |
|---|---|---|
| Motor tributário base do MVP-1 | entrou | evolui para apuração completa |
| Agenda mínima do MVP-1 | entrou | evolui para motor completo de obrigações |
| IBS/CBS capturado no MVP-1 | entrou parcialmente | apuração entra agora; transição completa até 2033 no MVP-4 |
| RF-03 | entrou | inclui partidas dobradas, livros, SPED e ECD |
| RF-04 | entrou | inclui financeiro, Open Finance, ITP, Pix e conciliação |
| Malha preventiva | entrou | cruzamento antes do fechamento |
| Agentes Classificador e Conciliador | entrou | dentro dos fluxos, não como cards horizontais |
| Compliance | entrou | motor completo e rascunhos; comunicação ativa fica no MVP-3 |
| Saúde da aplicação do RF-08 | entrou | não inclui planos, preço ou billing |
| Produção e validação com tráfego real | transferido | gate de produção após o MVP-4 |

## 4. Critério de saída

- Todas as fatias derivadas estão `finalizado` pelo PI.
- Cálculos fiscais e contábeis são reproduzíveis e nunca dependem de LLM.
- Todo lançamento fecha débito e crédito; competência fechada só aceita estorno e reabertura autorizada.
- SPED/ECD são gerados e validados com fixtures oficiais anonimizadas.
- Conciliação respeita os pesos e cortes do PRD, com regressão para falso match.
- ITP nunca move dinheiro sem autorização no banco; Pix é idempotente.
- Malha apresenta origem, regra, impacto e caminho de resolução.
- Card `[MVP2][GATE]` passa integralmente em Docker local.

## 5. Fora deste MVP

DP/eSocial, portal, mensageria ativa, Copiloto, billing, super-admin completo, API pública, Marketplace, certificação efetiva e produção.
