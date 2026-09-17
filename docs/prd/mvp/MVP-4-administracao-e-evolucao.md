# MVP-4 — Administração da plataforma e evolução

> **Estado:** macroescopo aprovado pelo PI em 17/09/2026 · fatias/SPECs ainda não numeradas
> **Base:** PRD v3.1 §§10.1, 11 e 16
> **Dependência:** MVP-3 finalizado
> **Ambiente:** Docker local; produção é etapa posterior ([ADR-012](../../adr/ADR-012-ambiente-local-ate-ultimo-mvp.md))

## 1. Objetivo

Completar a administração SaaS, as evoluções fiscais e agentic aprovadas e preparar evidência técnica suficiente para abrir, depois do MVP-4, um gate separado de produção. Este MVP não publica o sistema nem usa cliente real.

## 2. Capacidades aprovadas

- [ ] Super-admin e RBAC administrativo.
- [ ] Gestão global do ciclo de vida dos tenants.
- [ ] Convite e gestão dos administradores de tenant.
- [ ] Impersonation por caminho de serviço separado e auditado.
- [ ] Planos, assinatura e billing.
- [ ] Feature toggles por tenant e plano.
- [ ] Métricas SaaS: MRR, churn, LTV e CAC.
- [ ] Saúde global e consumo de recursos por tenant.
- [ ] Auditoria global e relatórios de adoção.
- [ ] Motor completo da transição IBS/CBS até 2033.
- [ ] API pública versionada, autenticada, limitada e auditada.
- [ ] Marketplace.
- [ ] Colaboração multiagente: Captura → Classificador → Conciliador.
- [ ] Predição de fluxo de caixa e obrigações sem substituir cálculo determinístico.
- [ ] Controles e pacote de evidências preparatórias para SOC 2 e ISO 27001.

## 3. Decisões pendentes que bloqueiam somente as SPECs correspondentes

O PRD cita os itens abaixo, mas não define produto suficiente para implementá-los. Nenhum agente pode completar essas lacunas por conveniência.

| Item | Decisões necessárias do PI |
|---|---|
| API pública | consumidores, operações expostas, modelo de credencial, cotas, versionamento e SLA |
| Marketplace | atores, objeto negociado, jornada, responsabilidade comercial, cobrança e critérios de aceite |

As demais capacidades podem ser especificadas sem aguardar essas respostas. As fatias de API pública e Marketplace permanecem em `planejado` até a decisão.

## 4. Reconciliação do escopo

| Item anterior/PRD | Estado neste MVP | Complemento/destino |
|---|---|---|
| RF-08 completo | entrou | operação produtiva fica no gate posterior |
| Saúde da aplicação iniciada no MVP-2 | entrou | evolui para visão global, custos e adoção |
| IBS/CBS dos MVPs 1–2 | entrou | completa a transição versionada até 2033 |
| API pública | entrou parcialmente | macroescopo mantido; SPEC aguarda decisões do §3 |
| Marketplace | entrou parcialmente | macroescopo mantido; SPEC aguarda decisões do §3 |
| Multi-agente colaborativo | entrou | somente sobre agentes individuais já medidos por cenários locais |
| Predição | entrou | recomendação explicável; não cria fato contábil, fiscal ou financeiro |
| SOC 2 e ISO 27001 | entrou parcialmente | controles/evidências agora; auditoria externa e certificação no gate produtivo |
| Produção, KMS/HSM e piloto real | transferido | etapa de produção após este MVP |

## 5. Critério de saída

- As decisões de API pública e Marketplace foram fechadas pelo PI, suas SPECs foram aprovadas e todas as fatias do MVP estão `finalizado`.
- Impersonation usa caminho separado e gera trilha global completa.
- Billing e feature toggles funcionam com dados sintéticos e webhooks simulados.
- Colaboração multiagente mantém autorização, RLS, idempotência e HITL dos agentes individuais.
- Predições exibem origem, incerteza e não são contabilizadas como resultado real.
- Pacote preparatório de controles e evidências aponta claramente o que só pode ser provado em produção.
- Card `[MVP4][GATE]` passa integralmente em Docker local.

## 6. Transferência obrigatória para produção

Após o MVP-4, um gate próprio deve decidir e provar hospedagem, KMS/HSM, região, object storage, TLS, backup/restore, RPO/RTO, observabilidade, migration, rollback, pipeline de deploy, integrações produtivas, piloto controlado e métricas reais. Nenhum desses itens está descartado pelo encerramento local dos MVPs.
