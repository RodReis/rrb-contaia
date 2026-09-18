# CONVENTION.md — Domínio: entidades, estados, invariantes e regras

> **Normativo. É o coração do produto.**
> Deriva do PRD §§3–11. **Onde divergir do PRD, o PRD vence** — divergência é `[FIX]`, não interpretação.
> Regra de produto que não existe aqui nem no PRD **não se inventa**: pergunta ao PI (`CLAUDE.md`).
> As regras marcadas **[PI]** foram decididas pelo PI nesta rodada e não estavam no PRD.

---

## 1. Vocabulário

Nome de domínio é em **português** (o negócio é brasileiro e a legislação também); código e identificador em inglês (`CLAUDE.md`). A tabela abaixo é a tradução única — não se inventa sinônimo.

| Termo | Significa | No código |
|---|---|---|
| **Tenant** | escritório contábil (raiz) | `tenant` |
| **Empresa** | cliente do escritório (sub-tenant) | `empresa` |
| **Carteira** | conjunto de empresas sob alçada de um usuário | `carteira` |
| **Documento fiscal** | NF-e, NFC-e, CT-e, MDF-e, NFS-e capturado ou recebido | `documento_fiscal` |
| **Manifestação** | declaração do destinatário perante a Sefaz | `manifestacao` |
| **Obrigação** | dever acessório com prazo | `obrigacao` |
| **Guia** | documento de arrecadação (DAS, DARF, GPS, FGTS) | `guia` |
| **Lançamento** | partida dobrada no razão | `lancamento_contabil` |
| **Competência** | mês de referência `AAAA-MM` | `competencia` |
| **Tarefa HITL** | proposta de agente aguardando decisão humana | `tarefa_hitl` |
| **Trilha** | log append-only de ação relevante | `log_auditoria` |

---

## 2. Invariantes globais

Valem para todo módulo. Violação é **P0/P1** ([`REVIEW.md`](REVIEW.md)).

| # | Invariante | Origem |
|---|---|---|
| **I-1** | Toda tabela transacional tem `tenant_id` **e** `empresa_id`, `NOT NULL`, indexados, sob RLS | PRD §3 |
| **I-2** | Consulta sem contexto de tenant **não retorna nada** | PRD §4.4 |
| **I-3** | Dinheiro é inteiro em centavos. Float é proibido | `CLAUDE.md` · [ADR-005](adr/ADR-005-representacao-de-dinheiro.md) |
| **I-4** | Cálculo fiscal e contábil sai do motor de regras versionado. **LLM nunca calcula** | PRD §2 |
| **I-5** | Ação com efeito jurídico exige aprovação humana registrada — exceto Ciência da Emissão | PRD §2 |
| **I-6** | Trilha é append-only: sem `UPDATE`, sem `DELETE` | PRD §12 |
| **I-7** | Registro de valor fiscal, contábil ou trabalhista **não se apaga** — arquiva-se | `CLAUDE.md` |
| **I-8** | Regra tributária é aplicada pela vigência da data do fato, não pela data de hoje | PRD §6.1 |
| **I-9** | Operação com efeito externo é idempotente | PRD §5.3 |
| **I-10** | Chave privada do certificado só existe no cofre e no Signer | PRD §4.5 |
| **I-11** | Data civil (competência, vencimento, emissão) não tem fuso; data e hora usa `America/Sao_Paulo` na exibição | [`FRONTEND.md`](FRONTEND.md) §12 |
| **I-12** | Recálculo de período fechado reproduz exatamente o mesmo resultado | PRD §6.5 |

---

## 3. Multi-tenancy, usuários e alçada (RF-01)

### 3.1 Isolamento

- Dois níveis: `tenant_id` (escritório) e `empresa_id` (cliente).
- **Usuário do escritório só acessa as empresas da sua carteira.**
- **`cliente_portal` acessa estritamente o próprio `empresa_id`.**
- **Impersonation de super-admin** usa role de serviço dedicada, nunca a sessão comum, e **sempre** gera entrada no log global (PRD §4.4).

### 3.2 Papéis

`admin_escritorio` · `contador` · `auxiliar` · `gestor_financeiro` · `dp` · `cliente_portal` · `auditor_readonly` · `super-admin` (plataforma).

### 3.3 Alçada de aprovação HITL **[PI]**

Quem pode **aprovar ato com efeito jurídico**, sempre limitado às empresas da carteira:

| Domínio da tarefa | Aprovam |
|---|---|
| Fiscal e contábil (manifestação, apuração, guia fiscal, escrituração) | `contador`, `admin_escritorio` |
| Departamento pessoal (evento eSocial, folha, guia trabalhista) | `dp`, `admin_escritorio` |
| Financeiro (pagamento, iniciação ITP, baixa) | `gestor_financeiro`, `admin_escritorio` |
| Qualquer domínio, como escalonamento | `admin_escritorio` |

- **`auxiliar` prepara e submete, nunca aprova.**
- **`auditor_readonly` e `cliente_portal` nunca aprovam nada.**
- Aprovação fora da carteira é negada, mesmo para papel autorizado.
- **Quem propõe não é quem aprova** quando a proposta é de agente: o agente propõe, o humano aprova. Humano pode aprovar a própria proposta apenas em tarefa que ele mesmo preparou como `auxiliar` → nesse caso o aprovador é outro usuário com alçada.

### 3.4 Certificados e credenciais

- Certificado **A1** por empresa, em cofre isolado por tenant, com rotação e auditoria.
- Upload **rejeita arquivo expirado ou com senha incorreta** (PRD §4.6).
- Certificado a menos de 30 dias do vencimento gera alerta no dashboard.
- **Procuração RFB/e-CAC** é via alternativa ao A1 do cliente, com vigência própria.
- A chave privada nunca é legível fora do Signer e do cofre (I-10).

### 3.5 Onboarding com importação

- Importação de plano de contas e de empregados por CSV/planilha.
- **Linha inválida não interrompe o restante** (PRD §4.2): o relatório lista aceitas e rejeitadas, com o motivo por linha.
- Importação é idempotente por arquivo + chave natural da linha; reenviar o mesmo arquivo não duplica.

---

## 4. Documento fiscal e manifestação (RF-02)

### 4.1 Ciclo de vida

```text
RESUMO_CAPTURADO ─▶ CIENCIA_DADA ─▶ XML_COMPLETO_OBTIDO ─▶ PARSEADO
                                                                    │
                                                                    ▼
                                                               EM_ANALISE
                                                                    │
                                                                    ▼
                                                        AGUARDANDO_APROVACAO
                                                                    │
                                     ┌──────────────────────────────┤
                                     ▼                              ▼
                                MANIFESTADO                     ARQUIVADO
                            (confirmacao | desconhecimento |
                             operacao_nao_realizada)
                                     │
                                     ▼
                               CLASSIFICADO ─▶ ESCRITURADO
```

- Para NF-e recebida como `resNFe`, **`CIENCIA_DADA` é automática**, sob qualquer score — é o que libera a obtenção do `procNFe` completo (PRD §5.2). CT-e não percorre essa transição.
- NF-e já recebida como `procNFe` e CT-e completo ingressam diretamente em `XML_COMPLETO_OBTIDO`, sem fabricar Ciência.
- **`MANIFESTADO` só se alcança com aprovação humana registrada** para confirmação, desconhecimento e operação não realizada. Não existe caminho automático. (I-5)
- Transição registra **autor (agente ou usuário), tipo, horário, score e aprovador** — imutável.
- `ARQUIVADO` não apaga: o documento continua recuperável (I-7).

### 4.2 Captura

- Estado por **NSU por CNPJ**: `ultNSU`, `maxNSU`, `tempoMedio`.
- **O agendamento deriva do estado do NSU, nunca de cronograma fixo.**
- Lote máximo de **50 NSUs**; intervalo mínimo é o `tempoMedio` devolvido pela Sefaz.
- **Rejeição 656 (Consumo Indevido)** é evento de incidente: pausa o CNPJ, alerta o on-call, revisa o agendamento.
- **Idempotência por chave de acesso e NSU** (I-9). Reprocessamento não duplica.
- XML original guardado com **hash de integridade** e retenção **≥ 5 anos**.
- Campos de **IBS/CBS** parseados e persistidos para documentos emitidos a partir de **03/08/2026**.

### 4.3 Prazo

Documento disponibilizado no DF-e aparece na inbox em **≤ 1h**, medido sobre a fila própria (PRD §5.4).

---

## 5. Fiscal, tributário e contábil (RF-03)

### 5.1 Motor de regras

- Regra tem `vigente_de` e `vigente_ate`. **Aplica-se a regra vigente na data do fato gerador** (I-8).
- **Cadastrar regra com vigência futura não altera apuração passada** (PRD §6.5).
- Cálculo **integralmente determinístico** e reprodutível (I-12).
- Regime atual e Reforma Tributária (IBS/CBS) coexistem no mesmo motor, por vigência.

### 5.2 Partida dobrada

- **Todo lançamento tem contrapartida válida**; a soma dos débitos é igual à soma dos créditos no lançamento.
- Lançamento pertence a uma **competência** e a uma empresa.
- **O razão fechado bate com o saldo declarado no SPED Contábil do período** (PRD §6.5).
- Numeração sequencial por empresa e exercício, sem lacuna e sem reaproveitamento.

### 5.3 Correção: estorno, nunca edição **[PI]**

- **Lançamento não se edita e não se apaga.** Correção é **lançamento de estorno** referenciando o original, com motivo e autor.
- Vale para lançamento de período fechado **e** para lançamento já transmitido em obrigação.
- Lançamento de competência **aberta** e ainda não transmitido pode ser **cancelado antes do fechamento**, com registro na trilha — o que não é edição silenciosa: o cancelamento é um evento.

### 5.4 Fechamento de competência **[PI]**

- **Fechamento é ação humana explícita**, por `contador` ou `admin_escritorio` da carteira, registrada na trilha com autor e horário.
- Competência fechada: **só aceita estorno**. Nenhum lançamento novo, nenhuma alteração.
- **Reabertura existe**, é exclusiva de `admin_escritorio`, exige motivo e vai para a trilha.
- Apuração de competência fechada é **reproduzível** (I-12): recalcular devolve o mesmo resultado.

### 5.5 Obrigações

- Regra versionada em JSON conforme Anexo B.1 do PRD: periodicidade, dia de vencimento, ajuste para dia útil, pré-requisitos, penalidade, prioridade, vigência e sucessão sob a Reforma.
- **Pré-requisito é verificado por empresa** antes de a obrigação ser considerada exigível.
- **Dependência entre obrigações** aparece no alerta, com a sequência de entrega.
- Alerta em **D-3** do vencimento, no dashboard e por e-mail/WhatsApp (PRD §6.5).
- **Valor de penalidade é calculado pelo motor**, nunca estimado por LLM.

### 5.6 Malha fiscal preventiva

Cruzamento contínuo de **SPED × DF-e × extrato bancário antes do fechamento** — não relatório estático de fim de mês.

---

## 6. Financeiro (RF-04)

- Título a pagar/receber tem empresa, vencimento, valor em centavos e situação.
- **Conciliação** por motor multi-critério determinístico: valor 40%, data 25%, descrição 20%, número do documento 15% (Anexo C do PRD).
- Cortes: **≥ 0,90 auto-concilia · 0,60–0,90 sugere com alternativas (HITL) · < 0,60 fila de exceções**. Valores iniciais, revisados trimestralmente com dado de produção.
- **Precisão da conciliação automática ≥ 99%** — match incorreto é pior que match ausente.
- **Iniciação de pagamento (ITP)** monta o agendamento na conta do cliente; a autorização é do cliente, no app do banco. O sistema **nunca** move dinheiro por conta própria.
- Baixa por webhook de Pix é automática e idempotente.

---

## 7. Departamento pessoal (RF-05)

### 7.1 Validações de bloqueio (executadas em código, antes de qualquer LLM)

| Validação | Regra | Severidade |
|---|---|---|
| Prazo de admissão | S-2200 até **1 dia antes** do início das atividades | **BLOQUEIO** |
| Salário mínimo | abaixo do piso da categoria ou do mínimo | **BLOQUEIO** |
| CPF/PIS | divergência com a base da Receita | **BLOQUEIO** |
| Admissão × desligamento | desligamento anterior à admissão | **BLOQUEIO** |
| FGTS | opção inválida para o vínculo | **BLOQUEIO** |
| Jornada | acima de 44h semanais sem acordo | ALERTA |
| Dependentes | idade acima do limite de dedução | ALERTA |
| SST | S-2210 sem CAT registrada | ALERTA |

- **BLOQUEIO impede a transmissão.** O LLM explica e atua em ALERTA; **não decide bloqueio** (PRD §10.6).
- Evento rejeitado é classificado com causa provável e ação sugerida.
- Meta: **rejeição após validação < 2%**.

---

## 8. Agentes e HITL (RF-07)

### 8.1 Máquina da tarefa HITL

```
AGENTE_PROPOE ─▶ PENDENTE_APROVACAO ─┬─ APROVADO  ─▶ EXECUTANDO ─▶ EXECUTADO ─▶ trilha
                                      ├─ REJEITADO ─▶ feedback ao modelo
                                      └─ (24h sem decisão) ─▶ ESCALADO
```

- **Timeout de 24h escala para os `admin_escritorio` do tenant** **[PI]**, que têm fila própria de escalonados, e notifica o cliente (PRD §10.1).
- **Aprovação e rejeição geram feedback** para o modelo.
- **Auto-aprovação só em ação de baixo risco** — classificação contábil e conciliação — com score **> 0,90** (PRD §10.1). Nunca em ato com efeito jurídico.
- Toda execução de agente registra prompt, contexto, ferramenta, score, custo e aprovador, em storage imutável.

### 8.2 Limites duros

- **LLM não calcula** (I-4). Resultado fiscal vem do motor, mesmo que o modelo devolva outro número.
- **Saída de LLM é validada por schema** antes de qualquer uso, e nunca executada como código.
- **Isolamento vetorial por tenant e empresa** — embeddings de clientes distintos nunca se misturam.
- **Sugestão sem fonte rastreável não é sugestão**: não se registra e não se renderiza ([`PATTERNS.md`](design-system/PATTERNS.md) §4).

---

## 9. Regras transversais de dado

| Assunto | Regra |
|---|---|
| **Identificador** | UUID v7 como chave primária de entidade transacional |
| **Dinheiro** | `BIGINT` em centavos; alíquota em centésimos de ponto percentual (I-3) |
| **Data** | competência `AAAA-MM`; data civil `AAAA-MM-DD`; data e hora em UTC no banco, `America/Sao_Paulo` na exibição (I-11) |
| **CNPJ/CPF** | armazenados **sem máscara**, só dígitos; CNPJ aceita o formato alfanumérico vigente |
| **Situação de registro** | `ativo` / `arquivado` — nunca exclusão física (I-7) |
| **Versão de registro** | `criado_em`, `atualizado_em`, `versao` para controle otimista (HTTP 409) |
| **Erro de domínio** | código estável; resposta `application/problem+json` com `type`, `title`, `status`, `code`, `correlationId` |
| **Idempotência** | chave natural (NSU, chave de acesso) ou `Idempotency-Key` fornecida pelo cliente (I-9) |

---

## 10. O que não está decidido

Nada aqui é decidido por conveniência de implementação. Quando faltar regra:

1. **Decisão de produto inexistente em documento algum** → pergunta ao PI (caso 1 de `CLAUDE.md`).
2. **Problema técnico da spec** → pergunta ao PI (caso 2).

Tudo o mais — nome de campo, ordem de implementação interna, estrutura de pasta, dublê de teste — é do Code, que decide na hora e registra no PR.

---

## Referências

- `docs/prd/PRD.md` — fonte de verdade · [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`DECISIONS.md`](DECISIONS.md) · [`FRONTEND.md`](FRONTEND.md) · [`TESTING.md`](TESTING.md) · [`REVIEW.md`](REVIEW.md)
