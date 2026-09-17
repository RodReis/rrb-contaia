# MVP-3 — Departamento pessoal, portal e comunicação ativa

> **Estado:** macroescopo aprovado pelo PI em 17/09/2026 · fatias/SPECs ainda não numeradas
> **Base:** PRD v3.1 §§8, 9.2, 9.3, 10.6, 10.7 e 10.8
> **Dependência:** MVP-2 finalizado
> **Ambiente:** Docker local, sem produção nem dados reais ([ADR-012](../../adr/ADR-012-ambiente-local-ate-ultimo-mvp.md))

## 1. Objetivo

Completar a operação trabalhista, abrir uma superfície segura para a empresa cliente e transformar pendências internas em comunicação ativa e rastreável, preservando decisão humana em toda ação com efeito jurídico.

Toda capacidade com tela entrega a interface final desde sua própria fatia, nos temas CLARO e ESCURO, seguindo [`../../FRONTEND.md`](../../FRONTEND.md) §20.1, [`../../DESIGN-SYSTEM.md`](../../DESIGN-SYSTEM.md), `docs/design-system/` e a tela correspondente em `docs/telas/`. `frontend-design` e `impeccable` são obrigatórias; acabamento visual não pode ser transferido para outro card ou MVP.

## 2. Capacidades aprovadas

- [ ] Cadastro de empregados, cargos, salários e dependentes.
- [ ] Aproveitamento dos empregados importados no MVP-1.
- [ ] Cálculo determinístico de folha: INSS, IRRF, FGTS, 13º, férias e rescisão.
- [ ] Geração das guias trabalhistas.
- [ ] Fechamento de folha e lotes de eventos.
- [ ] eSocial S-2200, S-1200, S-1210, S-2206 e S-2299.
- [ ] Eventos SST S-2210, S-2220 e S-2240.
- [ ] EFD-Reinf.
- [ ] Recibos, rejeições, retentativas e correção auditada.
- [ ] Validações determinísticas de bloqueio antes de qualquer LLM.
- [ ] Agente DP para explicação, triagem e sugestões.
- [ ] Dashboard com caixa consolidado e pendências do eSocial.
- [ ] Portal white-label por empresa.
- [ ] Documentos, guias e status de entregas no portal.
- [ ] Controle estrito do papel `cliente_portal`.
- [ ] Base versionada de legislação e fontes contábeis.
- [ ] Copiloto Contábil com RAG, citações e verificação de factualidade.
- [ ] Canal oficial de mensageria para o cliente.
- [ ] Envio de guias e coleta de recibos.
- [ ] Agente Coletor identificando documentos faltantes em D-2.
- [ ] Cobrança ativa contextual, com histórico e limites de reenvio.

Cada capacidade será decomposta antes da reserva de F/SPEC; folha, eSocial, portal e Copiloto não podem virar cards monolíticos.

## 3. Reconciliação do escopo

| Item anterior/PRD | Estado neste MVP | Complemento/destino |
|---|---|---|
| Empregados importados no MVP-1 | entrou | passam a alimentar o domínio de DP |
| RF-05 | entrou | folha, eventos, SST, EFD-Reinf e validações |
| Dashboard do MVP-1/2 | entrou parcialmente | recebe caixa e eSocial; administração global fica no MVP-4 |
| Portal e papel `cliente_portal` | entrou | isolamento continua sob RLS e carteira aplicável |
| Copiloto | entrou | somente resposta baseada em fontes e dados autorizados |
| Compliance do MVP-2 | entrou parcialmente | alimenta canal ativo; colaboração multiagente fica no MVP-4 |
| WhatsApp/Telegram/e-mail | entrou | canal oficial; provedor produtivo fica no gate pós-MVP-4 |
| Agente DP e Coletor | entrou | integrados aos fluxos; efeito jurídico permanece HITL |
| Produção e comunicação com cliente real | transferido | gate de produção após o MVP-4 |

## 4. Critério de saída

- Todas as fatias derivadas estão `finalizado` pelo PI.
- Validações de BLOQUEIO executam em código antes do LLM.
- Nenhum evento eSocial ou EFD-Reinf é transmitido sem aprovação humana registrada.
- `cliente_portal` não acessa outra empresa, inclusive dentro do mesmo tenant.
- Copiloto não renderiza afirmação factual sem fonte rastreável.
- Cobrança ativa respeita os limites de reenvio definidos na SPEC, o estado de entrega e o histórico de envio.
- Card `[MVP3][GATE]` passa integralmente em Docker local.

## 5. Fora deste MVP

Billing, super-admin completo, API pública, Marketplace, certificações, colaboração multiagente, infraestrutura produtiva e contato com destinatários reais.
