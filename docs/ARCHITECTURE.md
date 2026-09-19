# ARCHITECTURE.md — Desenho do sistema

> **Normativo.** Módulos, fronteiras, dados e resiliência.
> Deriva do PRD §§2, 3 e 14. **Onde divergir do PRD, o PRD vence** — divergência é `[FIX]`, não interpretação.
> Decisões pontuais e seus porquês vivem em [`DECISIONS.md`](DECISIONS.md) e [`adr/`](adr/).

---

## 1. Os cinco invariantes de arquitetura

Tudo abaixo existe para sustentar estes cinco. Proposta que os enfraquece é rejeitada, por mais elegante que seja.

1. **Determinismo fiscal.** Cálculo tributário e contábil sai do motor de regras versionado. **LLM nunca calcula** — orquestra, prioriza e explica.
2. **Isolamento em dois níveis.** `tenant_id` (escritório) e `empresa_id` (cliente) em toda tabela transacional, indexados, sob RLS.
3. **A chave privada nunca sai do cofre.** O *Signer*, isolado em rede privada, é o único que assina e o único que termina o mTLS com os órgãos.
4. **HITL obrigatório.** Nenhuma ação com efeito jurídico executa sem aprovação humana registrada — exceto a Ciência da Emissão.
5. **Trilha append-only.** Ação fiscal, contábil e trabalhista registra quem, quando, o quê e de onde. Não se edita, não se apaga.

---

## 2. Topologia

```
                    ┌──────────────────────────────┐
  Contador ────────▶│  Web — Next.js               │
  Cliente  ────────▶│  shell standard | portal      │
                    └───────────────┬──────────────┘
                                    │ HTTPS · cookie httpOnly
                    ┌───────────────▼──────────────┐      ┌──────────────┐
                    │  API — NestJS                │◀────▶│  Keycloak    │
                    │  Fiscal│Contábil│Financeiro  │ OIDC │  (OIDC/RBAC) │
                    │  DP│Admin│Agentes            │      └──────────────┘
                    └──┬──────────┬─────────┬──────┘
                       │          │         │
        ┌──────────────▼──┐  ┌────▼─────┐ ┌─▼─────────────────┐
        │ Motores determi-│  │ Fila     │ │ Orquestrador de   │
        │ nísticos:       │  │ BullMQ   │ │ Agentes (HITL)    │
        │ · Tributário    │  │ + Redis  │ └─┬─────────────────┘
        │ · Partidas dobr.│  └────┬─────┘   │
        │ · Obrigações    │       │         │ HTTP interno
        └─────────────────┘       │         ▼
                                  │   ┌───────────────────────┐
                   ┌──────────────▼─┐ │ Pipeline IA (Python)  │
                   │ Workers        │ │ features · embeddings │
                   │ · DF-e (NSU)   │ │ RAG · feedback        │
                   │ · eSocial      │ └───────────┬───────────┘
                   │ · Open Finance │             │
                   │ · Mensageria   │             │
                   └───────┬────────┘             │
                           │ mTLS via Signer      │
                   ┌───────▼────────┐             │
                   │ SIGNER         │             │
                   │ rede privada   │             │
                   │ única chave A1 │             │
                   └───────┬────────┘             │
                           ▼                      ▼
              Sefaz · eSocial · RFB    ┌──────────────────────────┐
                                       │ PostgreSQL + pgvector    │
                                       │ RLS (tenant × empresa)   │
                                       │ S3 (XML) · Redis · Vault │
                                       └──────────────────────────┘
```

**Ambientes:** do MVP-1 ao MVP-4, toda a topologia roda em Docker Compose local, numa instância nova e com portas próprias. Ambientes oficiais de homologação podem ser acessados pelos conectores locais com credenciais não produtivas. Hospedagem e deploy produtivos só são decididos na etapa posterior ao MVP-4 ([ADR-012](adr/ADR-012-ambiente-local-ate-ultimo-mvp.md)).

---

## 3. Repositório

Monorepo pnpm + Turborepo ([ADR-001](adr/ADR-001-monorepo.md)):

```
apps/
  web/        Next.js 16 — interface (FRONTEND.md)
  api/        NestJS — API, casos de uso, motores determinísticos
  workers/    consumidores de fila (DF-e, eSocial, Open Finance, mensageria)
  signer/     microserviço isolado de assinatura e saída mTLS
services/
  ai/         Python — features, embeddings, RAG, feedback (serviço interno)
packages/
  shared/     contratos, schemas Zod, tipos, códigos de erro
  domain/     tipos e invariantes de domínio compartilhados
  config/     ESLint, TS, Tailwind, Vitest
infra/
  docker/     compose local
  db/         migrations SQL (Drizzle) e políticas de RLS
```

**Fronteira poliglota explícita** (PRD §2): Node/NestJS para API, workers e filas; Python **como serviço interno**, nunca como caminho de requisição do usuário.

---

## 4. Camadas na API

```
HTTP (controller)  →  valida entrada e delega. Não contém regra.
Caso de uso        →  controla a transação, orquestra, decide.
Domínio            →  entidades, invariantes, funções puras de cálculo.
Portas/adapters    →  repositórios, conectores de órgão, fila, cofre, LLM.
```

Regras (`CLAUDE.md`, "Convenções de código"):

- **Caso de uso controla a transação; controller só valida e delega.**
- **DTO nunca é entidade de persistência.**
- **Função de cálculo é pura:** sem banco, sem rede, sem relógio — o "agora" entra por parâmetro.
- **Adapter de órgão governamental fica atrás de anti-corruption layer** (§8).
- Dependência aponta para dentro: domínio não conhece framework, ORM nem HTTP.

---

## 5. Dados

### 5.1 PostgreSQL com RLS de dois níveis

- Acesso por **Drizzle ORM** ([ADR-004](adr/ADR-004-acesso-a-dados-e-rls.md)).
- Toda requisição abre transação e define o contexto antes de qualquer consulta:

```sql
SET LOCAL app.tenant_id  = '<uuid>';
SET LOCAL app.empresa_id = '<uuid>';
```

- As políticas de RLS leem esse contexto. **Consulta sem contexto não retorna nada** — nunca retorna tudo.
- O papel da aplicação **não** tem `BYPASSRLS`. A única exceção é o caminho de impersonation do super-admin, com **role de serviço dedicada e auditada** (PRD §3).
- **Anti-drift no schema:** teste que falha se existir tabela transacional sem `tenant_id`/`empresa_id`, sem índice ou sem RLS habilitada ([`TESTING.md`](TESTING.md) §3.1).
- Migrations em SQL versionado, aplicadas em passo próprio antes do deploy ([`CI-PR.md`](CI-PR.md) §6).

### 5.2 Onde cada dado mora

| Dado | Armazenamento | Retenção |
|---|---|---|
| Transacional (documento, lançamento, evento, tarefa HITL) | PostgreSQL | conforme PRD §12 |
| XML original de documento fiscal | S3 (object storage) + hash no banco | **≥ 5 anos** (PRD §12) |
| Embeddings de classificação | **pgvector no mesmo PostgreSQL** ([ADR-010](adr/ADR-010-vector-db.md)) — herda a RLS | enquanto o cliente existir |
| Cache, fila, rate limit | Redis | efêmero |
| Certificado A1, senha, credencial de órgão | Cofre (Vault/KMS) — acessível **só pelo Signer** | rotação auditada |
| Envelope de execução do agente — metadados, decisão, score, custo e hashes | PostgreSQL (append-only) | permanente; correção e descarte são novos eventos |
| Payload de agente — prompt, contexto, entrada e resposta integrais | armazenamento separado, append-only durante a retenção | 12 meses, depois anonimização ou descarte auditado; o envelope e os hashes permanecem |
| Log de auditoria | PostgreSQL, **append-only** | conforme PRD §12 |

**Append-only na prática:** sem `UPDATE` e sem `DELETE` nas tabelas de trilha — garantido por política, revogação de privilégio e teste de anti-drift. O payload expirável não é a trilha autoritativa: anonimização ou descarte preserva o envelope imutável e gera um novo evento com a política aplicada e o hash anterior.

### 5.3 Dinheiro

`BIGINT` em centavos de ponta a ponta ([ADR-005](adr/ADR-005-representacao-de-dinheiro.md)). Float é proibido (`CLAUDE.md`). Alíquota em centésimos de ponto percentual. Arredondamento é decisão explícita da função de cálculo, testada nas bordas.

---

## 6. Identidade e acesso

- **Keycloak self-hosted** como provedor OIDC ([ADR-011](adr/ADR-011-autenticacao.md)).
- Papéis do PRD §4.3: `admin_escritorio`, `contador`, `auxiliar`, `gestor_financeiro`, `dp`, `cliente_portal`, `auditor_readonly`, mais `super-admin` (RF-08).
- **Alçada (carteira)** é dado do produto, no PostgreSQL — não vira papel no provedor de identidade. O token diz quem é e qual o papel; o banco diz quais empresas.
- Sessão por **cookie `httpOnly`, `Secure`, `SameSite=Lax`**. Nunca token em `localStorage`.
- **Autorização é sempre verificada no servidor.** Esconder botão não é controle de acesso.

---

## 7. Signer — o serviço que justifica a arquitetura

| Propriedade | Implementação |
|---|---|
| Rede | privada, **sem domínio público**; só a API e os workers alcançam |
| Segredo | único detentor do acesso ao cofre do A1 |
| Função | assinar XML e **terminar o mTLS** com Sefaz e eSocial |
| Fronteira | recebe o documento a assinar e devolve o assinado, ou executa a chamada ao órgão; **nunca devolve a chave** |
| Auditoria | toda assinatura registra empresa, certificado, finalidade, correlação e resultado |
| Superfície | o menor código do repositório; dependência nova ali exige justificativa explícita |

**Nenhum outro serviço lê o certificado.** Nem a API, nem os workers, nem o front, nem o pipeline de IA.

> **Limite dos MVPs, registrado em [ADR-012](adr/ADR-012-ambiente-local-ate-ultimo-mvp.md):** o cofre e o Signer são implementados e provados localmente apenas com material criptográfico de teste. KMS/HSM, segredo real, região e isolamento da rede produtiva são gate obrigatório da etapa de produção, depois do MVP-4 e antes de qualquer piloto real.

---

## 8. Integrações governamentais — anti-corruption layer

Cada órgão tem um conector isolado, com contrato interno próprio. Mudança no layout do governo altera o conector, nunca o domínio.

**Captura DF-e — a fila é a arquitetura:**

- Estado por **NSU por CNPJ** (`ultNSU`, `maxNSU`, `tempoMedio`), persistido.
- **Agendamento derivado do estado do NSU, nunca de cronograma fixo.** Consulta recorrente sem novos documentos gera **Rejeição 656** e bloqueio de 1 hora.
- Lote de **50 NSUs** por requisição, com intervalo obrigatório.
- **Idempotência por chave de acesso e NSU** — reprocessar não duplica.
- Retry exponencial; alerta após 3 falhas.
- Intermediário homologado (Focus NFe, Nuvem Fiscal, PlugNotas) como **via alternativa**, atrás do mesmo contrato interno.

**Vigência cadastrada:** layout, prazo e regra de órgão têm `vigente_de`/`vigente_ate`. Mudança de cronograma é dado, não `if` no código.

---

## 9. Filas e workers

- **BullMQ sobre Redis.** Uma fila por natureza de trabalho (captura, manifestação, eSocial, conciliação, mensageria, IA).
- **Toda mensagem é idempotente** e carrega `tenant_id`, `empresa_id` e `correlationId`.
- **Retry com backoff exponencial**, teto de tentativas e **dead-letter queue** com alerta.
- **Rate limit por tenant e por órgão** — o limite do governo é compartilhado entre todos os clientes.
- Processamento em lote na madrugada para volume (PRD §18).
- **Worker nunca chama órgão diretamente:** passa pelo Signer.

---

## 10. Camada de agentes

Orquestrador com estado, roteamento e HITL (PRD §10.1). Do ponto de vista da arquitetura:

- **Ferramentas com mínimo privilégio:** cada agente recebe só as funções e os dados de que precisa.
- **Saída de LLM é dado hostil:** validada por schema antes de qualquer uso; nunca executada.
- **Pseudonimização** antes de sair para provedor de terceiro.
- **Abstração multi-provider** — o provedor do orquestrador é diferente do provedor dos agentes (PRD §19).
- **Custo e latência medidos por requisição e por tenant.**
- **A fila HITL é do domínio, não do agente:** `tarefa_hitl` é entidade transacional com RLS, aprovador, prazo e timeout de 24h que escala para supervisor.

Detalhe estratégico em [`AGENTES-IA-AUTONOMOS.md`](AGENTES-IA-AUTONOMOS.md) — que **não altera escopo por si** e exige ADR + SPEC para qualquer adoção.

---

## 11. Resiliência

| Cenário | Comportamento |
|---|---|
| Órgão fora do ar | fila retém, retry com backoff, alerta após 3 falhas; usuário vê estado "aguardando órgão", não erro genérico |
| Rejeição 656 | pausa os workers do CNPJ, notifica on-call, revisa agendamento (PRD §17.3) |
| Falha parcial de carregamento | 497 de 500 empresas aparecem; as 3 são sinalizadas ([`PATTERNS.md`](design-system/PATTERNS.md) §5) |
| Provedor de LLM indisponível | fallback de tier; se nenhum responde, escala para humano — **nunca calcula sem motor** |
| Explosão de custo de IA | rate limit por tenant + alerta (PRD §17.3) |
| Fila HITL acumulada (> 500) | notifica supervisores |
| Perda de banco | RPO ≤ 1h, RTO ≤ 4h; backup diário com **teste de restore mensal** (PRD §12) |

---

## 12. Observabilidade

- **`correlationId` atravessa** requisição, fila, worker, Signer e chamada ao órgão — e aparece no erro mostrado ao usuário ([`FRONTEND.md`](FRONTEND.md) §14).
- Métricas obrigatórias em toda integração governamental (PRD §12).
- Tracing distribuído entre API, workers e pipeline de IA.
- Alertas operacionais conforme PRD §17.3.
---

## 13. O que esta arquitetura recusa

| Recusado | Motivo |
|---|---|
| Cálculo fiscal em LLM | invariante 1 |
| Banco por tenant (schema-per-tenant) no MVP | RLS de dois níveis já atende 1.000 empresas × 100 escritórios (PRD §12); um banco por cliente multiplica migração e custo operacional sem ganho de segurança comprovado |
| Microserviços por módulo funcional | acoplamento transacional entre fiscal e contábil; o único serviço realmente isolado é o Signer, por segredo |
| Regra fiscal no front ou em route handler | camada 4 |
| Vector DB separado no MVP | isolamento teria de ser reimplementado fora da RLS ([ADR-010](adr/ADR-010-vector-db.md)) |
| Exclusão física de registro fiscal | invariante 5 |
| Chave de certificado em variável de ambiente da API | invariante 3 |

---

## Referências

- `docs/prd/PRD.md` §§2, 3, 12, 13, 14 · [`CONVENTION.md`](CONVENTION.md) · [`DECISIONS.md`](DECISIONS.md) e [`adr/`](adr/)
- [`FRONTEND.md`](FRONTEND.md) · [`TESTING.md`](TESTING.md) · [`CI-PR.md`](CI-PR.md) · [`AGENTES-IA-AUTONOMOS.md`](AGENTES-IA-AUTONOMOS.md)
