# RASTREABILIDADE.md — Matriz normativa de requisitos

> **Normativa.** Prova para onde foi cada requisito aprovado do PRD: **mantido, transferido, adiado ou excluído**.
> **Ausência na matriz bloqueia aprovação documental** — um requisito sem linha aqui não foi decidido, foi esquecido.
> Mantida pelo **Cowork**. Regras de governança em [`README.md`](README.md).

**Atualizada em:** 17/09/2026 · **Base:** PRD v3.0 (16/09/2026)

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
| RF-01 §4.1 Cadastro de escritório e empresas (CRUD) | P0 | Mantido | MVP-1 | — |
| RF-01 §4.2 Onboarding com importação CSV (plano de contas, empregados) | P0 | Mantido | MVP-1 | — |
| RF-01 §4.3 Usuários, papéis e carteira | P0 | Mantido | MVP-1 | — |
| RF-01 §4.4 RLS de dois níveis e impersonation auditada | P0 | Mantido | MVP-1 | — |
| RF-01 §4.5 Cofre A1, Signer e procuração RFB/e-CAC | P0 | Mantido | MVP-1 | — |
| RF-01 §4.5 Cofre com KMS/HSM gerenciado | P0 | **Adiado** | [`FORA-DE-ESCOPO.md`](../../FORA-DE-ESCOPO.md) §4 · [ADR-003](../../adr/ADR-003-hospedagem-e-deploy.md) | — |
| **RF-02** Captura automática de documentos fiscais | P0 | Mantido | MVP-1 | — |
| RF-02 §5.1 DF-e com fila por NSU e intermediário alternativo | P0 | Mantido | MVP-1 | — |
| RF-02 §5.2 Manifestação: ciência automática + inbox de aprovação | P0 | Mantido | MVP-1 | — |
| RF-02 §5.3 Parse, IBS/CBS, XML original com hash, idempotência | P0 | Mantido | MVP-1 | — |
| RF-02 §5.1 NFS-e de municípios fora do padrão nacional | — | **Excluído** | PRD §1.5 · [`FORA-DE-ESCOPO.md`](../../FORA-DE-ESCOPO.md) §2 | — |
| **RF-03** Motor de regras tributárias (base) | P0 | Mantido | MVP-1 | — |
| RF-03 §6.2 Apurações, guias e partidas dobradas | P1 | Transferido | MVP-2 (Fase 2) | — |
| RF-03 §6.2 SPED Fiscal e SPED Contábil (ECD) | Fase 2 | Transferido | MVP-2 | — |
| RF-03 §6.3 Motor de obrigações e calendário fiscal | P1 | Transferido | MVP-2 | — |
| RF-03 §6.4 Malha fiscal preventiva contínua | Fase 2 | Transferido | MVP-2 | — |
| **RF-04** Gestão financeira integrada | P1 | Transferido | MVP-2 (Fase 2) | — |
| RF-04 §7.2 Open Finance e ITP | P1 | Transferido | MVP-2 | — |
| RF-04 §7.3 Pix via BaaS/PSP | P1 | Transferido | MVP-2 | — |
| RF-04 §7.4 Conciliação multi-critério | P1 | Transferido | MVP-2 | — |
| **RF-05** Departamento pessoal e eSocial | P2 | Transferido | MVP-3 (Fase 3) | — |
| **RF-06** Dashboard multi-empresa (visão consolidada) | P0 | Mantido | MVP-1 | — |
| RF-06 §9.2 Portal do cliente white-label | Fase 3 | Transferido | MVP-3 | — |
| RF-06 §9.2 Copiloto Contábil | Fase 3 | Transferido | MVP-3 | — |
| RF-06 §9.3 Canal ativo WhatsApp/Telegram | Fase 3 | Transferido | MVP-3 | — |
| **RF-07** Agente de Captura | P1 | Mantido | MVP-1 | — |
| RF-07 §10.5 Agente Compliance (alertas de vencimento) | P1 | Mantido | MVP-1 | — |
| RF-07 §10.3 Agente Classificador | P1 | Transferido | MVP-2 | — |
| RF-07 §10.4 Agente Conciliador | P1 | Transferido | MVP-2 | — |
| RF-07 §10.6 Agente DP | P2 | Transferido | MVP-3 | — |
| RF-07 §10.7 Copiloto Contábil | P2 | Transferido | MVP-3 | — |
| RF-07 §10.8 Agente Coletor Ativo | P2 | Transferido | MVP-3 | — |
| RF-07 §10.1 Multi-agente colaborativo | Fase 4 | **Adiado** | [`FORA-DE-ESCOPO.md`](../../FORA-DE-ESCOPO.md) §3 | — |
| **RF-08** Administração da plataforma | P3 | Transferido | MVP-4 (Fase 4) | — |
| RF-08 §11.2 Saúde da aplicação (tenants ativos, DAU/MAU) | P3 | Transferido | MVP-2 (não depende de billing) | — |
| RF-08 §11.1 Planos e billing | P3 | **Adiado** | [`FORA-DE-ESCOPO.md`](../../FORA-DE-ESCOPO.md) §3 | — |
| Emissão de NF-e em nome do cliente | — | **Excluído** | PRD §1.5 | — |
| ERP de estoque ou produção | — | **Excluído** | PRD §1.5 | — |
| API pública e marketplace | Fase 4 | **Adiado** | [`FORA-DE-ESCOPO.md`](../../FORA-DE-ESCOPO.md) §3 | — |
| Certificações SOC 2 e ISO 27001 | Fase 4 | **Adiado** | [`FORA-DE-ESCOPO.md`](../../FORA-DE-ESCOPO.md) §3 | — |

---

## 3. Requisitos não-funcionais (PRD §12)

Não são fatia: são **critério de aceite transversal**, verificado em toda fatia a que se apliquem.

| RNF | Onde é provado |
|---|---|
| Disponibilidade 99,9% | operação — fora do gate de PR |
| Performance (API p95 < 500ms, dashboard < 3s, 10.000 XMLs < 15min) | [`AUDIT.md`](../../AUDIT.md) §5, por fatia |
| Escalabilidade (1.000 empresas × 100 escritórios) | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §13 |
| Segurança (TLS 1.3, AES-256, KMS, chave por tenant) | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §7 — **com R-01 aberto** |
| Auditoria append-only | [`TESTING.md`](../../TESTING.md) anti-drift |
| Retenção ≥ 5 anos de XML | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §5.2 |
| Observabilidade em toda integração governamental | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §12 |
| DR/Backup (RPO ≤ 1h, RTO ≤ 4h, restore mensal) | [ADR-003](../../adr/ADR-003-hospedagem-e-deploy.md) — responsabilidade explícita |
| LGPD | **fora do contrato de produto** por decisão registrada (`CLAUDE.md`) |

---

## 4. Estado

Todo requisito do PRD v3.0 tem destino declarado. **A coluna Fatia / SPEC só é preenchida quando o fatiamento acontecer** — é a próxima rodada do Cowork.

Nenhuma linha desta matriz é apagada. Requisito que muda de destino recebe a atualização na própria linha, com a data.
