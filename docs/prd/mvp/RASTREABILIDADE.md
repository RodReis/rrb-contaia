# RASTREABILIDADE.md — Matriz normativa de requisitos

> **Normativa.** Prova para onde foi cada requisito aprovado do PRD: **mantido, transferido, adiado ou excluído**.
> **Ausência na matriz bloqueia aprovação documental** — um requisito sem linha aqui não foi decidido, foi esquecido.
> Mantida pelo **Cowork**. Regras de governança em [`README.md`](README.md).

**Atualizada em:** 19/09/2026 · **Base:** PRD v3.1 (17/09/2026)

---

## 1. Como ler

| Coluna | Significado |
|---|---|
| **Requisito** | item do PRD, na sua numeração |
| **Prioridade** | como o PRD classifica |
| **Destino** | `Mantido` (fatia deste MVP) · `Transferido` (outro MVP) · `Adiado` · `Excluído` |
| **Onde** | MVP e fatia, ou a linha de [`../../FORA-DE-ESCOPO.md`](../../FORA-DE-ESCOPO.md) |
| **Fatia / SPEC** | par alocado no Índice de [`../../STATUS.md`](../../STATUS.md) |

`—` em **Fatia / SPEC** significa **fatiamento ainda não feito**, não requisito sem destino.

---

## 2. Matriz por requisito funcional

| Requisito | Prioridade | Destino | Onde | Fatia / SPEC |
|---|---|---|---|---|
| **RF-01** Multi-tenancy, clientes e cofre de certificados | P0 | Mantido | MVP-1 | — |
| RF-01 §4.1 Cadastro, consulta e edição do escritório | P0 | Mantido | MVP-1 | F1 / SPEC-001 |
| RF-01 §4.1 Arquivamento/ciclo de vida do tenant | P0 | Transferido | MVP-4, junto ao RF-08 e ao super-admin | — |
| RF-01 §4.1 Cadastro de empresas clientes (CRUD) | P0 | Mantido | MVP-1 | F2 / SPEC-002 · F3 / SPEC-003 · F4 / SPEC-004 · F5 / SPEC-005 · F6 / SPEC-006 |
| RF-01 §4.2 Onboarding com importação do plano de contas por CSV | P0 | Mantido | MVP-1 | F13 / SPEC-013 |
| RF-01 §4.2 Onboarding com importação de empregados por CSV | P0 | Mantido | MVP-1 | F14 / SPEC-014 |
| RF-01 §4.2 Onboarding com importação por XLSX/ODS | P0 | Mantido | MVP-1 | F15 / SPEC-015 |
| RF-01 §4.3 Usuários e papéis padrão | P0 | Mantido | MVP-1 | F7 / SPEC-007 |
| RF-01 §4.3 Papéis personalizados e permissões por módulo, funcionalidade e ação | P0 | Mantido | MVP-1 | F8 / SPEC-008 |
| RF-01 §4.3 Carteira/alçada | P0 | Mantido | MVP-1 | F9 / SPEC-009 |
| RF-01 §4.4 RLS de dois níveis | P0 | Mantido | MVP-1 | F10 / SPEC-010 |
| RF-01 §4.4 impersonation auditada | P0 | Transferido | MVP-4; caminho de serviço só é exercido após o super-admin existir | — |
| RF-01 §4.5 Cofre A1 | P0 | Mantido | MVP-1 | F11 / SPEC-011 |
| RF-01 §4.5 Signer isolado, assinatura e mTLS local | P0 | Mantido | MVP-1 | F12 / SPEC-012 |
| RF-01 §4.5 Procuração RFB/e-CAC | P0 | Mantido | MVP-1 | F25 / SPEC-025 |
| RF-01 §4.5 Cofre com KMS/HSM gerenciado | P0 | **Transferido** | Etapa de produção após o MVP-4 · [`FORA-DE-ESCOPO.md`](../../FORA-DE-ESCOPO.md) §4 · [ADR-012](../../adr/ADR-012-ambiente-local-ate-ultimo-mvp.md) | — |
| **RF-02** Captura automática de documentos fiscais | P0 | Mantido | MVP-1 | F17 / SPEC-017 e capacidades posteriores do RF-02 |
| RF-02 §5.1 DF-e com fila por NSU e intermediário alternativo | P0 | Mantido | MVP-1 | F17 / SPEC-017; conectores externos no GATE do MVP-1 |
| RF-02 §5.2 Manifestação: ciência automática + análise, inbox e aprovação | P0 | Mantido | MVP-1 | F19 / SPEC-019 para Ciência automática; F20 / SPEC-020 para classificação e proposta; F21 / SPEC-021 para inbox, aprovação, transmissão e reconciliação |
| RF-02 §5.3 Parse, IBS/CBS, XML original com hash, idempotência | P0 | Mantido | MVP-1 | F18 / SPEC-018 para NF-e 55 e CT-e; NFS-e e eventos nas capacidades próprias do MVP-1 |
| RF-02 §5.1 NFS-e de municípios fora do padrão nacional | — | **Excluído** | PRD §1.5 · [`FORA-DE-ESCOPO.md`](../../FORA-DE-ESCOPO.md) §2 | — |
| **RF-03** Motor de regras tributárias (base) | P0 | Mantido | MVP-1 | F16 / SPEC-016 |
| RF-03 §6.1 Regras completas por regime e vigência | P1 | Mantido | MVP-2 | F26 / SPEC-026 inicia com Simples Nacional e Lucro Presumido em Goiás; F27 / SPEC-027 cobre ICMS-ST já retido em autopeças; F28 / SPEC-028 cobre responsabilidade e cálculo por MVA nas entradas históricas de autopeças até 28/02/2018; F29 / SPEC-029 cobre complemento e restituição nas vendas internas de autopeças entre 27/10/2016 e 28/02/2018; demais métodos, exceções, segmentos e expansão permanecem em fatias próprias |
| RF-03 §6.2 Apurações, guias e partidas dobradas | P1 | Transferido | MVP-2 | — |
| RF-03 §6.2 SPED Fiscal e SPED Contábil (ECD) | MVP-2 | Transferido | MVP-2 | — |
| RF-03 §6.3 Agenda mínima, vencimentos e alertas D-3 | P1 | Mantido | MVP-1 | F22 / SPEC-022 |
| RF-03 §6.3 Motor completo por regime/UF/CNAE, pré-requisitos, penalidades, dependências e sucessão | P1 | Transferido | MVP-2 | — |
| RF-03 §6.4 Malha fiscal preventiva contínua | MVP-2 | Transferido | MVP-2 | — |
| **RF-04** Gestão financeira integrada | P1 | Transferido | MVP-2 | — |
| RF-04 §7.2 Open Finance e ITP | P1 | Transferido | MVP-2 | — |
| RF-04 §7.3 Pix via BaaS/PSP | P1 | Transferido | MVP-2 | — |
| RF-04 §7.4 Conciliação multi-critério | P1 | Transferido | MVP-2 | — |
| **RF-05** Departamento pessoal e eSocial | P2 | Transferido | MVP-3 | — |
| **RF-06** Dashboard multi-empresa (visão consolidada) | P0 | Mantido | MVP-1 | F23 / SPEC-023 para semáforo, KPIs operacionais e drill-down; caixa e eSocial no MVP-3 |
| RF-06 §9.2 Portal do cliente white-label | MVP-3 | Transferido | MVP-3 | — |
| RF-06 §9.2 Copiloto Contábil | MVP-3 | Transferido | MVP-3 | — |
| RF-06 §9.3 Canal ativo WhatsApp/Telegram | MVP-3 | Transferido | MVP-3 | — |
| **RF-07** Agente de Captura | P1 | Mantido | MVP-1 | F17 / SPEC-017 a F21 / SPEC-021 |
| RF-07 §10.5 Compliance inicial (agenda e alertas de vencimento) | P1 | Mantido | MVP-1 | F22 / SPEC-022 |
| RF-07 §§10.1, 10.2 e 10.5 Auditoria append-only e observabilidade dos agentes do MVP-1 | P1 | Mantido | MVP-1 | F24 / SPEC-024 |
| RF-07 §10.5 Compliance completo e rascunhos de entrega | P1 | Transferido | MVP-2 | — |
| RF-07 §10.3 Agente Classificador | P1 | Transferido | MVP-2 | — |
| RF-07 §10.4 Agente Conciliador | P1 | Transferido | MVP-2 | — |
| RF-07 §10.6 Agente DP | P2 | Transferido | MVP-3 | — |
| RF-07 §10.7 Copiloto Contábil | P2 | Transferido | MVP-3 | — |
| RF-07 §10.8 Agente Coletor Ativo | P2 | Transferido | MVP-3 | — |
| RF-07 §10.1 Multi-agente colaborativo | MVP-4 | Transferido | MVP-4 | — |
| **RF-08** Administração da plataforma | P3 | Transferido | MVP-4 | — |
| RF-08 §11.2 Saúde da aplicação (tenants ativos, DAU/MAU) | P3 | Transferido | MVP-2 (não depende de billing) | — |
| RF-08 §11.1 Planos e billing | P3 | Transferido | MVP-4 | — |
| Emissão de NF-e em nome do cliente | — | **Excluído** | PRD §1.5 | — |
| ERP de estoque ou produção | — | **Excluído** | PRD §1.5 | — |
| API pública e marketplace | MVP-4 | Transferido | MVP-4; SPECs bloqueadas até o PI definir os contratos de produto | — |
| Controles e evidências preparatórias para SOC 2 e ISO 27001 | MVP-4 | Transferido | MVP-4 | — |
| Auditoria externa e certificação SOC 2 e ISO 27001 | Produção | **Transferido** | Gate de produção após o MVP-4 | — |

---

## 3. Requisitos não-funcionais (PRD §12)

Não são fatia: são **critério de aceite transversal**, verificado em toda fatia a que se apliquem.

| RNF | Onde é provado |
|---|---|
| Disponibilidade 99,9% | desenho e teste de resiliência nos MVPs; medição real no gate de produção pós-MVP-4 |
| Performance (API p95 < 500ms, dashboard < 3s, 10.000 XMLs < 15min) | [`AUDIT.md`](../../AUDIT.md) §5, por fatia |
| Escalabilidade (1.000 empresas × 100 escritórios) | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §13 |
| Segurança (TLS 1.3, AES-256, KMS, chave por tenant) | implementação local com segredos de teste; KMS e prova real no gate de produção pós-MVP-4 ([ADR-012](../../adr/ADR-012-ambiente-local-ate-ultimo-mvp.md)) |
| Auditoria append-only | MVP-1 · F24 / SPEC-024 · [`TESTING.md`](../../TESTING.md) anti-drift; auditoria global e impersonation no MVP-4 |
| Retenção ≥ 5 anos de XML | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §5.2 |
| Observabilidade em toda integração governamental | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §12 |
| DR/Backup (RPO ≤ 1h, RTO ≤ 4h, restore mensal) | contrato e ensaio local nos MVPs; prova da infraestrutura no gate de produção pós-MVP-4 ([ADR-012](../../adr/ADR-012-ambiente-local-ate-ultimo-mvp.md)) |
| Privacidade e proteção de dados | **fora do contrato de produto** por decisão registrada (`CLAUDE.md`); não gera requisito nem controle técnico nesta matriz |

---

## 4. Estado

Todo requisito do PRD v3.1 tem destino declarado. **A coluna Fatia / SPEC só é preenchida quando o fatiamento acontecer** — é a próxima rodada do Cowork.

Nenhuma linha desta matriz é apagada. Requisito que muda de destino recebe a atualização na própria linha, com a data.
