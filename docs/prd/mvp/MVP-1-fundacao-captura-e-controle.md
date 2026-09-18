# MVP-1 — Fundação, captura e controle operacional

> **Estado:** macroescopo aprovado pelo PI em 17/09/2026 · F1/SPEC-001 a F19/SPEC-019 aprovadas
> **Base:** PRD v3.1 §§4, 5, 6.1, 9.1, 10.1, 10.2 e 10.5
> **Ambiente:** Docker local, sem produção; qualquer dado real necessário está previamente autorizado no ambiente local ([ADR-012](../../adr/ADR-012-ambiente-local-ate-ultimo-mvp.md))

## 1. Objetivo

Entregar a primeira operação observável do ContaIA para um escritório contábil: autenticar, cadastrar escritório e empresas, controlar carteira e isolamento, importar a base inicial, capturar e triar documentos fiscais, acompanhar obrigações mínimas e priorizar empresas pelo semáforo operacional.

O MVP prova o comportamento em Docker local com os dados, seeds, fixtures, dublês e integrações necessários. Não prova operação produtiva.

## 2. Usuários atendidos

- `admin_escritorio`: configura o escritório, usuários, empresas, carteira e certificados de teste.
- `contador` e `auxiliar`: operam captura, triagem, agenda e dashboard dentro da carteira.
- `dp`: importa empregados dentro da carteira; o domínio funcional de DP permanece no MVP-3.
- `auditor_readonly`: consulta dados e trilhas sem alterar estado.

`cliente_portal`, o domínio funcional de DP e o super-admin completo não entram neste MVP.

## 2.1 Contrato transversal de UI

Toda capacidade com tela entrega a interface final desde sua própria fatia, nos temas CLARO e ESCURO, seguindo [`../../FRONTEND.md`](../../FRONTEND.md) §20.1, [`../../DESIGN-SYSTEM.md`](../../DESIGN-SYSTEM.md), `docs/design-system/` e a tela correspondente em `docs/telas/`. `frontend-design` e `impeccable` são obrigatórias; acabamento visual não pode ser transferido para outro card ou MVP.

## 3. Capacidades aprovadas

As capacidades abaixo são o checklist do épico. Cada uma é decomposta em comportamento vertical Curto/Médio antes da reserva de F/SPEC. Itens grandes, como captura e dashboard, não podem virar card monolítico.

- [ ] `[INFRA]` Fundação local: monorepo, Docker, banco, Redis, Keycloak, storage local, serviços, CI e health checks — pré-requisito sem F/SPEC.
- [ ] **F1 / SPEC-001:** autenticação OIDC, conclusão obrigatória e edição do cadastro do escritório.
- [ ] **F2 / SPEC-002:** cadastro básico, consulta CNPJá, retomada e ativação da empresa cliente.
- [ ] **F3 / SPEC-003:** manutenção da empresa cliente, múltiplos endereços, arquivamento e reativação.
- [ ] **F4 / SPEC-004:** documentos e versões da empresa.
- [ ] **F5 / SPEC-005:** Central de Pendências cadastrais e indicadores por empresa.
- [ ] **F6 / SPEC-006:** sino, notificações e histórico de notificações de pendências.
- [ ] **F7 / SPEC-007:** usuários, convites, ciclo de vida e papéis padrão.
- [ ] **F8 / SPEC-008:** papéis personalizados por snapshot de um papel padrão, com permissões controladas por módulo, funcionalidade e ação, aplicação na próxima requisição e auditoria.
- [ ] **F9 / SPEC-009:** carteira do colaborador, gestão individual e em lote, isolamento por empresa, notificações e auditoria.
- [ ] **F10 / SPEC-010:** RLS de dois níveis integrada à carteira, contextos humano e técnico, provas negativas entre tenants e empresas e anti-drift automático.
- [ ] **F11 / SPEC-011:** cofre local persistente com certificados A1 exclusivamente de teste, validação, rotação, responsável, alertas, pendências e auditoria.
- [ ] **F12 / SPEC-012:** Signer isolado, assinatura XML e mTLS contra dublês locais de DF-e e eSocial, com idempotência, auditoria, monitoramento e painel operacional.
- [ ] **F13 / SPEC-013:** importação e reimportação do plano de contas por CSV, com mapeamento de colunas, staging assíncrono, aceitação parcial, confirmação, relatório e histórico.
- [ ] **F14 / SPEC-014:** importação e reimportação de empregados por CSV, com CPF + matrícula como chave, mapeamento, staging assíncrono, aceitação parcial, confirmação, relatório, histórico, pendência e consulta, sem antecipar o domínio funcional de DP.
- [ ] **F15 / SPEC-015:** importação de plano de contas e empregados por XLSX/ODS, com escolha de aba e cabeçalho, adaptadores normalizados e equivalência integral às regras CSV das F13/F14.
- [ ] **F16 / SPEC-016:** catálogo global de regras tributárias versionadas, publicação imutável, simulador determinístico manual e por NF-e de teste, com leitura inicial de IBS/CBS sem persistência documental.
- [ ] **F17 / SPEC-017:** captura DF-e de NF-e modelo 55 e CT-e por estado de NSU, com staging opaco, idempotência, consulta automática e sob demanda, respeito ao `tempoMedio`, retry, DLQ e bloqueio por Rejeição 656.
- [ ] **F18 / SPEC-018:** pipeline desacoplado de parse e persistência de NF-e modelo 55 e CT-e, com XML original recuperável, hash SHA-256, normalização, IBS/CBS, pendências e reprocessamento.
- [ ] **F19 / SPEC-019:** Ciência da Emissão automática para NF-e modelo 55, com fluxo `resNFe → 210210 → procNFe → F18`, idempotência, reconciliação, retry, DLQ e visibilidade técnica.
- [ ] Inbox e aprovação humana das demais manifestações.
- [ ] Agenda mínima de obrigações e alertas D-3.
- [ ] Compliance inicial dentro do fluxo de alertas.
- [ ] Dashboard multiempresa com semáforo determinístico e drill-down.
- [ ] Auditoria append-only e observabilidade das decisões dos agentes.

O Agente de Captura e o Compliance inicial não são componentes isolados: entram nas fatias verticais de captura, manifestação, agenda e dashboard.

## 4. Semáforo aprovado

- **Vermelho:** obrigação vencida, bloqueio de captura ou certificado inválido.
- **Amarelo:** vencimento em até três dias, manifestação pendente ou dados insuficientes/incompletos.
- **Verde:** somente quando não existir pendência conhecida e os dados necessários estiverem disponíveis.
- Cor nunca é a única representação; estado e motivo são textuais e levam ao fluxo de resolução.

## 5. Reconciliação do escopo

| Item do PRD | Estado neste MVP | Complemento/destino |
|---|---|---|
| RF-01 cadastro, usuários, carteira e RLS | entrou parcialmente | usuários e papéis padrão em F7; papéis personalizados, catálogo e matriz de autorização em F8; carteira e alçada por empresa em F9; RLS em fatia própria posterior do MVP-1 |
| RF-01 onboarding CSV/planilha | entrou | plano de contas CSV em F13; empregados CSV em F14; XLSX/ODS para ambos em F15; empregado importado passa ao domínio funcional de DP no MVP-3 |
| RF-01 cofre A1 e Signer | entrou parcialmente | material real, KMS/HSM e infraestrutura produtiva no gate pós-MVP-4 |
| RF-02 captura, parse, NSU e manifestações | entrou | prova externa somente em homologação não produtiva |
| RF-03 motor tributário | entrou parcialmente | base versionada e simulador em F16; apuração, regras completas, guias, escrituração e SPED no MVP-2; transição IBS/CBS completa no MVP-4 |
| RF-03 motor de obrigações | entrou parcialmente | agenda e D-3 agora; regras completas, penalidades e dependências no MVP-2 |
| RF-06 dashboard consolidado | entrou parcialmente | caixa e eSocial no MVP-3 |
| RF-07 Agente de Captura | entrou | integrado ao fluxo, não como card horizontal |
| RF-07 Compliance | entrou parcialmente | alertas mínimos agora; Compliance completo no MVP-2 |
| Produção e piloto real | transferido | gate de produção após o MVP-4 |

## 6. Critério de saída

- Todas as fatias derivadas deste checklist estão `finalizado` pelo PI.
- Fluxo local observável: autenticação → escritório → empresa/carteira → importação → captura/triagem → agenda → semáforo/drill-down.
- Testes de RLS cobrem todas as tabelas sensíveis existentes e provam negação entre tenants e empresas.
- Reprocessamento de NSU/XML não duplica documento.
- Nenhuma manifestação com efeito fiscal, exceto Ciência, executa sem aprovação registrada.
- Semáforo não mostra verde quando faltam dados.
- Card `[MVP1][GATE]` passa integralmente em Docker local.
- Rastreabilidade não contém requisito deste MVP sem destino.

## 7. Fora deste MVP

Apuração completa, guias, escrituração, SPED, financeiro, DP/eSocial, portal, mensageria ativa, Copiloto, billing, super-admin completo e produção. Todos têm destino explícito nos MVPs seguintes ou no gate produtivo.
