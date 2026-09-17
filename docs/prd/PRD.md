# 📋 Product Requirements Document — ContaIA
## SaaS de Contabilidade Inteligente Multi-empresa

| Campo | Valor |
|---|---|
| **Documento** | PRD — Fonte de Verdade do Produto |
| **Versão** | 3.1 |
| **Status** | Aprovado para desenvolvimento |
| **Data** | 17/09/2026 |
| **Owner** | Produto |
| **PI** | Rodrigo Reis |

> **Regra de governança:** este documento é a única fonte de verdade sobre escopo, requisitos e critérios de aceite. Qualquer divergência entre código, protótipos, conversas ou outros artefatos deve ser resolvida **em favor deste PRD** ou formalmente revisada aqui.

---

## 1. Visão e Contexto

### 1.1 Visão
Ser a plataforma de gestão financeira, fiscal, contábil e trabalhista que permite a escritórios contábeis e empresas operarem **vários clientes em um painel centralizado**, com automação por agentes de IA nas tarefas repetitivas e conformidade contínua com a legislação brasileira.

### 1.2 Problema
- Escritórios contábeis gerenciam dezenas/centenas de CNPJs com planilhas, sistemas legados e captura manual de documentos fiscais.
- Perda de prazos fiscais gera multas (ex.: eSocial — admissão com até 1 dia de antecedência; atraso sujeito a multa a partir de R$ 3.000 por empregado).
- Documentos fiscais emitidos a partir de 03/08/2026 já circulam com os campos de IBS/CBS da Reforma Tributária; sistemas que não os interpretam perdem informação desde já.
- Tarefas repetitivas (classificação, conciliação, escrituração) consomem 60–70% do tempo do contador.

### 1.3 Solução
SaaS multi-tenant de dois níveis — escritório contábil (tenant) e empresa cliente (sub-tenant) — com:

1. **Captura automática** de documentos fiscais do governo, via Distribuição DF-e com fila de estado por NSU e manifestação do destinatário.
2. **Gestão Fiscal, Tributária e Contábil** com motor de regras versionado por vigência (regime atual e Reforma Tributária) e escrituração contábil completa com partidas dobradas.
3. **Gestão Financeira Integrada** com Open Finance, Pix, CNAB, conciliação assistida e iniciação de pagamentos (ITP).
4. **Departamento Pessoal** com eSocial e validação pré-envio.
5. **Dashboard multi-empresa** com alertas priorizados por risco financeiro.
6. **Agentes de IA com aprovação humana** (HITL) para toda ação que gera obrigação legal.
7. **Arquitetura híbrida de IA**: regras determinísticas e embeddings para o volume; LLM para exceção, triagem e conversação.

### 1.4 Público-alvo

| Persona | Descrição | Papel no produto |
|---|---|---|
| Escritório contábil (core) | 5–200 colaboradores, 30–1.000 CNPJs atendidos | Tenant raiz |
| Contador independente | 1–5 pessoas, até 30 CNPJs | Tenant raiz |
| Empresa (diretoria financeira) | Acesso a 1 CNPJ, via portal do cliente | Sub-tenant / `cliente_portal` |
| Operação ContaIA | Suporte, billing, feature toggles | `super-admin` |

### 1.5 Não-objetivos
- Emissão de NF-e em nome de clientes (fase posterior, via parceiro).
- Captura automática de NFS-e de municípios que não aderiram ao padrão nacional.
- ERP de estoque ou produção.

---

## 2. Princípios de Arquitetura e Produto

| Princípio | Implementação |
|---|---|
| **Determinismo fiscal** | Todo cálculo tributário e contábil sai do motor de regras versionado. LLM nunca calcula — orquestra, prioriza e explica. |
| **Híbrido por custo** | Regras e embeddings resolvem o volume de classificação e conciliação; LLM atua em exceção, ambiguidade e conversação. |
| **HITL obrigatório** | Nenhuma ação com efeito jurídico executa sem aprovação humana registrada, exceto a Ciência da Emissão. |
| **Isolamento em dois níveis** | `tenant_id` (escritório) e `empresa_id` (cliente) em toda tabela transacional, indexados, sob Row-Level Security. |
| **Mínimo privilégio** | Cada agente acessa apenas os dados e APIs necessários à sua função. |
| **Chave privada nunca na API** | O microserviço *Signer*, isolado em rede privada, assina os documentos e termina a conexão mTLS com os órgãos governamentais. A chave nunca sai do cofre. |
| **Observabilidade total** | Todo prompt, ferramenta, entrada, saída e decisão de agente é registrado. |
| **Fallback seguro** | Incerteza acima do threshold escala para humano automaticamente. |
| **Anti-corruption layer** | Conectores governamentais isolados atrás de camada própria, com vigências cadastradas. |
| **Fronteira poliglota explícita** | Node.js/NestJS para API, workers de integração e filas. Python como serviço interno para features, embeddings, RAG e feedback de modelo. |

---

## 3. Modelo de Domínio

| Entidade | Chaves de isolamento |
|---|---|
| `tenant` — escritório contábil | — |
| `empresa` — cliente do escritório | `tenant_id` |
| `usuario`, `papel`, `permissao` | `tenant_id` |
| `carteira` — alçada do colaborador sobre empresas | `tenant_id` |
| `certificado_digital` (A1) | `tenant_id`, `empresa_id` |
| `procuracao_eletronica` (RFB/e-CAC) | `tenant_id`, `empresa_id` |
| `documento_fiscal` (NF-e, CT-e, NFS-e) + `xml_original` + `hash` | `tenant_id`, `empresa_id` |
| `evento_documento` / `manifestacao` | `tenant_id`, `empresa_id` |
| `controle_nsu` (`ultNSU`, `maxNSU`, `tempoMedio`) | `empresa_id` |
| `regra_tributaria` (`vigente_de` / `vigente_ate`) | global / por regime |
| `obrigacao` + `calendario_fiscal` | regime, UF, CNAE |
| `guia` (DAS, DARF, GPS, FGTS) | `tenant_id`, `empresa_id` |
| `plano_de_contas`, `centro_custo` | `tenant_id`, `empresa_id` |
| `lancamento_contabil` — partida dobrada, débito/crédito | `tenant_id`, `empresa_id` |
| `razao_contabil` — saldo por conta e período | `tenant_id`, `empresa_id` |
| `classificacao_contabil` + vetor no Vector DB | `tenant_id`, `empresa_id` |
| `importacao_onboarding` — arquivo de origem, status, linhas com erro | `tenant_id`, `empresa_id` |
| `titulo_pagar` / `titulo_receber` | `tenant_id`, `empresa_id` |
| `conta_bancaria`, `extrato`, `transacao_bancaria` | `tenant_id`, `empresa_id` |
| `conciliacao` — match, score, alternativas | `tenant_id`, `empresa_id` |
| `empregado`, `cargo`, `dependente` | `tenant_id`, `empresa_id` |
| `evento_esocial` + recibo + rejeição | `tenant_id`, `empresa_id` |
| `folha`, `rubrica` | `tenant_id`, `empresa_id` |
| `tarefa_hitl` — proposta do agente, aprovador, estado | `tenant_id`, `empresa_id` |
| `log_auditoria` — append-only, inclui sessões de impersonation | `tenant_id`, `empresa_id` |
| `execucao_agente` — prompt, contexto, score, ferramenta, custo | `tenant_id`, `empresa_id` |
| `plano`, `assinatura`, `feature_toggle` | `tenant_id` |

**Regra estrutural obrigatória:** toda tabela transacional carrega `tenant_id` **e** `empresa_id`, ambos indexados, sob RLS de dois níveis. 
A única exceção é o caminho de impersonation do super-admin, que usa role de serviço dedicada e auditada (RF-08).

---

## 4. RF-01 — Multi-tenancy, Clientes e Cofre de Certificados

**Prioridade:** P0 — MVP

### 4.1 Cadastro e ciclo de vida
- [ ] Cadastro de escritório (tenant raiz): CNPJ, CRC, responsável técnico, logo, endereços, uploads de documentos — CRUD completo.
- [ ] Cadastro de empresas clientes: CNPJ, razão social, regime tributário (Simples / Presumido / Real), CNAE, inscrições estaduais e municipais, logo, endereços, documentos — CRUD completo.

### 4.2 Onboarding com importação de dados
- [ ] Upload de planilha/CSV do plano de contas do cliente.
- [ ] Upload de planilha/CSV do cadastro de empregados.
- [ ] Relatório de importação com linhas aceitas e linhas rejeitadas, sem interromper o restante do onboarding.

### 4.3 Usuários, papéis e alçada
- [ ] Papéis: `admin_escritorio`, `contador`, `auxiliar`, `gestor_financeiro`, `dp`, `cliente_portal`, `auditor_readonly`.
- [ ] CRUD completo de usuários e papéis, com controle de visualização por papel.
- [ ] **Carteira/alçada:** usuário do escritório acessa apenas as empresas da sua carteira.
- [ ] Usuário `cliente_portal` acessa estritamente o seu `empresa_id`.

### 4.4 Isolamento de dados
- [ ] RLS no PostgreSQL em dois níveis: `tenant_id` e `empresa_id`.
- [ ] `tenant_id` e `empresa_id` presentes e indexados em toda tabela transacional.
- [ ] A política de RLS impede vazamento entre clientes concorrentes atendidos pelo mesmo escritório.
- [ ] Impersonation do super-admin usa role de serviço separada, auditada — nunca a sessão comum de usuário.

### 4.5 Cofre de certificados e credenciais fiscais
- [ ] Vínculo de certificado digital **A1** por empresa, em cofre criptográfico (KMS/Vault) isolado por tenant, com rotação e auditoria.
- [ ] **Microserviço *Signer* isolado** em rede privada: assina o XML e atua como gateway de saída (mTLS) para Sefaz e eSocial. A chave privada não é exposta à API principal nem a qualquer outro serviço.
- [ ] **Procurações eletrônicas (RFB/e-CAC):** uso da procuração do e-CNPJ do escritório para consultar clientes, reduzindo a exigência de certificado A1 de toda a base no primeiro dia.

### 4.6 Critérios de aceite
- Usuário de empresa A nunca acessa dados de empresa B — teste automatizado de RLS em 100% das tabelas sensíveis no caminho de aplicação padrão.
- Usuário do escritório fora da carteira não lê dados da empresa.
- Upload de certificado A1 rejeita arquivo expirado ou com senha incorreta.
- A chave privada do A1 não é legível por nenhum serviço fora do Signer e do cofre.
- Toda sessão de impersonation gera entrada no log global de auditoria, sem exceção.

---

## 5. RF-02 — Captura Automática de Documentos Fiscais

**Prioridade:** P0 — MVP

### 5.1 Integrações e mecanismo de captura
- [ ] Integração com o **web service de Distribuição de DF-e** (NF-e modelo 55, CT-e), com certificado do cliente ou procuração.
- [ ] Integração com **NFS-e padrão nacional**, por via própria.
- [ ] **Fila com controle estrito de estado por NSU** (`ultNSU` vs. `maxNSU`) por CNPJ, respeitando o `tempoMedio` retornado pela Sefaz no XML de resposta.
  - A Sefaz limita o retorno a lotes de **50 NSUs** por requisição, com intervalo obrigatório entre chamadas.
  - Consulta recorrente sem novos documentos gera **Rejeição 656 — Consumo Indevido**, com bloqueio temporário de 1 hora. O agendamento é derivado do estado do NSU, nunca de um cronograma fixo.
- [ ] Consulta sob demanda, além da consulta agendada.
- [ ] Suporte a intermediário homologado (Focus NFe, Nuvem Fiscal, PlugNotas) como via alternativa, para absorver instabilidade e diferenças estaduais.
- [ ] Retry exponencial e alerta após 3 tentativas de falha de comunicação.

### 5.2 Manifestação do Destinatário
- [ ] Suporte aos quatro tipos: ciência, confirmação, desconhecimento e operação não realizada.
- [ ] **Cascata padrão:** *Ciência da Emissão* imediata, garantindo o download do XML completo → validação por regras e agente → *Confirmação da Operação* ou fila de aprovação humana para notas desconhecidas e suspeitas, protegendo o CNPJ contra nota fria.
- [ ] **Política de automação:** a Ciência da Emissão é executada automaticamente pelo agente, sob qualquer score. **Confirmação da Operação, Desconhecimento e Operação não Realizada exigem aprovação humana registrada, independente do score** — são declarações formais perante a Sefaz com efeito fiscal.
- [ ] Log imutável de autor (agente ou usuário), tipo e horário de cada manifestação.
- [ ] Tela de triagem: inbox de documentos novos com sugestão de manifestação e ação em 1 clique.

### 5.3 Parse e armazenamento
- [ ] Parse de XML (NF-e, CT-e, NFS-e e eventos) para estrutura normalizada no banco.
- [ ] Parse e persistência dos **campos de IBS/CBS** dos documentos emitidos a partir de 03/08/2026.
- [ ] Armazenamento do XML original com hash de integridade, retenção mínima de 5 anos.
- [ ] Idempotência por chave de acesso e NSU, sem duplicar documento em reprocessamento.

### 5.4 Critérios de aceite
- Documento disponibilizado no serviço de Distribuição DF-e aparece na inbox em **≤ 1h**, medido sobre a fila própria.
- Nenhuma requisição é emitida em violação do `tempoMedio` retornado pela Sefaz. Taxa de Rejeição 656 igual a zero em operação normal.
- Toda manifestação tem log imutável com autor, timestamp, score e aprovador quando aplicável.
- Nenhuma manifestação de Confirmação, Desconhecimento ou Operação não Realizada é transmitida sem aprovação humana registrada.
- XML original recuperável com hash validado.

---

## 6. RF-03 — Gestão Fiscal, Tributária e Contábil

**Prioridade:** P0 (motor base) · P1 (apurações e guias) · MVP-2 (escrituração completa)

### 6.1 Motor de regras tributárias
- [ ] Regras versionadas por vigência (`vigente_de` / `vigente_ate`), suportando simultaneamente o regime atual e a Reforma Tributária (IBS/CBS), cronograma 2026–2033.
- [ ] Cadastro de regra com vigência futura sem quebrar apuração de período passado.
- [ ] Cálculo tributário integralmente determinístico.

### 6.2 Apuração, guias e escrituração
- [ ] Apuração de ICMS, PIS, COFINS e IBS/CBS por regime tributário.
- [ ] Geração de guias: DAS (Simples Nacional), DARF, GPS e FGTS-REINF.
- [ ] **Motor de partidas dobradas:** todo lançamento gera contrapartida válida; razão contábil fechado por período.
- [ ] Escrituração de livros fiscais e geração de **SPED Fiscal** e **SPED Contábil (ECD)**.

### 6.3 Obrigações acessórias
- [ ] Calendário fiscal por regime, estado e atividade.
- [ ] **Motor de Obrigações** com regras versionadas em JSON, contendo periodicidade, dia de vencimento, ajuste para dia útil, pré-requisitos (faturamento, funcionários), penalidade (tipo, percentual, mínimo, juros), prioridade, vigência e mapeamento de sucessão sob a Reforma Tributária. Estrutura no Anexo B.1.
- [ ] Verificação de pré-requisitos por empresa antes de considerar a obrigação exigível.
- [ ] Dependências entre obrigações explicitadas no alerta, com a sequência de entrega.

### 6.4 Malha fiscal preventiva contínua
- [ ] Cruzamento em tempo real de SPED × DF-e × extrato bancário **antes** do fechamento, em lugar do relatório estático de fim de mês.

### 6.5 Critérios de aceite
- Obrigação com vencimento em D-3 gera alerta no dashboard e por e-mail/WhatsApp.
- Regra tributária cadastrada com vigência futura não altera apuração já fechada.
- Documento fiscal emitido após 03/08/2026 é apurado com os campos de IBS/CBS.
- Recálculo de período fechado reproduz o mesmo resultado.
- Todo lançamento contábil tem contrapartida válida, e o razão fechado bate com o saldo declarado no SPED Contábil do período.

---

## 7. RF-04 — Gestão Financeira Integrada

**Prioridade:** P1 — MVP-2

### 7.1 Contas a pagar e receber
- [ ] Importação de boletos por PDF e linha digitável.
- [ ] CNAB 240/400 para boletos e folha.
- [ ] Aging de contas a pagar e a receber.
- [ ] Fluxo de caixa projetado por empresa e consolidado por escritório (30/60/90 dias).
- [ ] DRE gerencial, alimentado pelo razão contábil.

### 7.2 Open Finance Brasil
- [ ] Importação de extratos e saldos de contas correntes, com o consentimento do cliente.
- [ ] Recebimento por **webhooks**, em lugar de importação D+1.
- [ ] **Iniciação de Pagamentos (ITP):** o sistema gera a guia, monta o agendamento na conta do cliente e dispara notificação no app do banco dele apenas para validação biométrica.

### 7.3 Pix
- [ ] Emissão de cobrança via PSP/BaaS parceiro.
- [ ] Webhook de baixa automática.

### 7.4 Conciliação
- [ ] Casamento de extrato × lançamentos × documentos fiscais, com fila de aprovação humana.
- [ ] Motor multi-critério determinístico — valor 40%, data 25%, descrição 20%, número do documento 15%. Algoritmo no Anexo C.
- [ ] LLM acionado apenas em casos ambíguos.

### 7.5 Critérios de aceite
- Extrato Open Finance importado alimenta a conciliação em ≤ 24h.
- Baixa de Pix confirma o lançamento sem intervenção manual.
- Taxa de conciliação automática ≥ 70% das transações com documento fiscal ou título correspondente já cadastrado no primeiro mês, chegando a ≥ 85% em 6 meses.
- Precisão da conciliação automática ≥ 99%, sem match incorreto.

---

## 8. RF-05 — Departamento Pessoal (eSocial)

**Prioridade:** P2 — MVP-3

### 8.1 Cadastros e folha
- [ ] Cadastro de empregados, cargos, salários e dependentes, também alimentado pela importação de onboarding.
- [ ] Cálculo de folha: INSS, IRRF, FGTS, 13º, férias e rescisão.
- [ ] Guias: FGTS Digital, GPS e IRRF.

### 8.2 Eventos eSocial
- [ ] Envio de eventos do layout **S-1.3**: S-2200 (admissão, **até 1 dia antes do início das atividades**), S-1200 (folha), S-1210 (pagamento), S-2206 (alteração) e S-2299 (desligamento).
- [ ] Eventos SST: S-2210, S-2220 e S-2240.
- [ ] **EFD-Reinf**, que substituiu a DIRF a partir do ano-base 2025.
- [ ] Tratamento de recibo e de rejeição, com classificação de causa provável e ação sugerida.

### 8.3 Critérios de aceite
- Tentativa de envio de admissão com início "hoje" é bloqueada e alertada.
- Folha fechada gera eventos S-1200 e S-1210 em lote, com relatório de validação.
- Evento rejeitado pelo eSocial é classificado com causa provável e ação sugerida.
- Taxa de rejeição após a validação do agente inferior a 2%.

---

## 9. RF-06 — Dashboard Multi-empresa e Portal do Cliente

**Prioridade:** P0 (visão consolidada, MVP-1) · MVP-3 (portal e copiloto)

### 9.1 Dashboard consolidado — MVP
- [ ] Visão de todas as empresas do escritório com **semáforo de saúde** (verde/amarelo/vermelho).
- [ ] Inbox de documentos fiscais estruturados e semáforo de pendências por CNPJ.
- [ ] KPIs: obrigações entregues e pendentes, guias vencendo em 72h, documentos não manifestados.
- [ ] Alertas priorizados por impacto financeiro — multa acima de informativo.
- [ ] Drill-down por empresa, com ação direta em 1 clique.

### 9.2 Evolução — MVP-3
- [ ] KPIs de caixa consolidado e eventos eSocial pendentes.
- [ ] **Portal do cliente white-label:** documentos, guias para pagamento e status de entregas.
- [ ] **Copiloto Contábil** — chat com RAG sobre os dados do cliente e a legislação (§10.6).

### 9.3 Canal ativo com o cliente
- [ ] **Canal oficial WhatsApp/Telegram:** cobrança automatizada de pendências, envio de guias e coleta de recibos, em lugar de portal passivo.

### 9.4 Critérios de aceite
- Dashboard consolidado com 500 empresas carrega em menos de 3s, com dados agregados pré-calculados.
- Cada alerta leva à tela de resolução em 1 clique.

---

## 10. RF-07 — Plataforma de Agentes de IA

**Prioridade:** P1/P2, por agente

### 10.1 Arquitetura e política geral

**Camadas**
1. **Orquestração** — Agent Orchestrator: estado, roteamento e HITL.
2. **Modelos** — roteador de intenção → tier de raciocínio → tier rápido de baixa latência → tier self-hosted para dados sensíveis → modelos de embedding. Os tiers ficam atrás de uma camada de abstração multi-provider; a escolha corrente de modelos é decisão de engenharia versionada fora deste documento.
3. **Ferramentas** — function calling (APIs internas, Sefaz, eSocial, Open Finance, banco), RAG sobre Vector DB e code interpreter para cálculo e simulação.
4. **Dados** — PostgreSQL, S3 para XMLs, Redis para cache, Vector DB e Vault.

**Divisão entre determinístico e LLM**

| Tarefa | Motor |
|---|---|
| Cálculo tributário e contábil | Regras versionadas — nunca LLM |
| Conciliação em volume | Regras + embeddings |
| Classificação rotineira | Embeddings/ML local + histórico do cliente |
| Exceção, ambiguidade, triagem | LLM |
| Conversação | LLM + RAG |

**Pipeline HITL**
```
AGENTE_PROPÕE → PENDENTE_APROVACAO → [APROVADO] → EXECUTA_AÇÃO → REGISTRA_LOG
                        │
                        ├─→ [REJEITADO] → RETORNA_ERRO_AO_AGENTE → FEEDBACK_APRENDIZADO → ATUALIZA_MODELO
                        │
                        └─→ (timeout 24h) → ESCALA_SUPERVISOR
```

Regras do HITL:
- Confirmação, Desconhecimento e Operação não Realizada, envio de evento eSocial, geração de guia — **sempre** exige aprovação humana. A Ciência da Emissão é a única exceção, por não fixar posição sobre a operação.
- Ação de baixo risco — classificação contábil, conciliação — pode ser auto-aprovada com score acima de 0,90.
- Timeout de 24h escala para supervisor e notifica o cliente.
- Toda aprovação e rejeição gera feedback para o modelo.

**Guardrails e citação**
- [ ] Pipelines de RAG fiscal retornam a fonte normativa explícita (ex.: "base legal: art. 12 da LC 123/06").

**Trilha de auditoria**
- [ ] Por decisão de agente: prompt, contexto, ferramenta usada, score, custo e aprovador, em storage imutável.

**Segurança nos agentes**

| Controle | Implementação |
|---|---|
| Isolamento por tenant | Namespace próprio no Vector DB; embeddings de clientes distintos nunca se misturam |
| Audit trail | Todo prompt, resposta, ferramenta e decisão em storage imutável |
| Rate limiting | Limite de requisições por tenant |

**Thresholds:** os cortes de score (0,50 / 0,60 / 0,85 / 0,90) são valores iniciais, revisados trimestralmente com base em dado de produção.

### 10.2 Agente de Captura

**Propósito:** monitorar a Distribuição DF-e, capturar os documentos emitidos contra os CNPJs dos clientes, dar ciência automaticamente e encaminhar as demais manifestações à triagem humana.

**Fluxo**
```
Fila por NSU (respeita tempoMedio/maxNSU) → Worker DF-e (via Signer)
  → Parse XML → Análise de risco
      qualquer score          → Ciência da Emissão automática + log
      score ≥ 0,85            → inbox com sugestão pronta, aguardando aprovação
      score entre 0,50 e 0,85 → inbox com sugestão + notificação, aguardando aprovação
      score < 0,50            → inbox com alerta + notificação, aguardando aprovação
```

**Componentes**

| Componente | Função |
|---|---|
| Scheduler (BullMQ / EventBridge) | Dispara workers conforme o estado do NSU ou sob demanda |
| Worker DF-e | Consome o web service da Sefaz com o certificado A1 via Signer |
| Parser (`fast-xml-parser` + schemas Sefaz) | Converte XML em JSON estruturado |
| Classificador de risco | Regras heurísticas + LLM: nota conhecida, suspeita ou anômala |
| Motor de manifestação | Executa a ciência automaticamente e as demais manifestações após aprovação |

**Entradas do classificador:** emitente (razão social e CNPJ), valor total, produtos, histórico de compras do emitente nos últimos 12 meses e regras do cliente (fornecedores aprovados, limites). **Saída:** JSON com `tipo_manifestacao`, `score`, `justificativa` e `riscos`. Prompt no Anexo A.1.

**Métricas**
- Latência entre disponibilização no DF-e e inbox ≤ 1h.
- Erro de manifestação inferior a 0,1%.
- Falso negativo de fraude inferior a 1%.

### 10.3 Agente Classificador

**Propósito:** classificar despesas, receitas e documentos fiscais no plano de contas do cliente, sugerir CFOP, centro de custo e natureza da operação, aprendendo com as aprovações do contador e alimentando o motor de partidas dobradas.

**Fluxo**
```
Documento → extração de features (NCM, CFOP, descrição, valor, histórico)
  → busca no Vector DB (classificações históricas do cliente, inicializadas pela importação de onboarding)
  → sugestão: conta, CFOP, centro de custo, observação
  → fila HITL
      aprovado  → gera lançamento contábil com partida dobrada
      rejeitado → feedback para o modelo
```

Substitui a construção manual de centenas de regras DE/PARA por auto-tagging vetorial baseado no histórico do cliente e em NCM/CFOP, com aprendizado ativo.

**Componentes:** feature extractor, modelo de embedding, Vector DB isolado por tenant, classificador e feedback loop em batch que atualiza o Vector DB a cada correção do contador.

**Registro no Vector DB:** `tenant_id`, `empresa_id`, embedding e metadados — descrição do produto, NCM, CFOP, valor, conta contábil, centro de custo, natureza, data, autor da classificação, aprovador e score. Estrutura no Anexo B.2.

**Saída:** conta contábil, código da conta, centro de custo, classificação (despesa, receita, ativo ou passivo), indicação de crédito potencialmente recuperável de ICMS/PIS/COFINS, observação, score e justificativa. O valor do crédito recuperável é calculado pelo motor de regras tributárias; a saída do agente é candidata a revisão, não o cálculo.

**Métricas**
- Acurácia top-1 ≥ 85%.
- Aprovação sem correção ≥ 70%.
- Classificação em menos de 2s por documento.
- Ganho de 2 pontos percentuais de acurácia por mês com o feedback.

### 10.4 Agente Conciliador

**Propósito:** casar transações bancárias do extrato Open Finance com lançamentos contábeis e documentos fiscais, identificando pagamentos, recebimentos e discrepâncias.

**Fluxo**
```
Extrato importado → normalização de descrições
  → matching multi-critério
      score ≥ 0,90            → auto-concilia
      score entre 0,60 e 0,90 → sugestão com alternativas (HITL)
      score < 0,60            → fila de exceções
```

**Componentes:** normalizador de descrições bancárias (`"PAG*JOAO SILVA LTDA"` → `"JOAO SILVA LTDA"`), embedding matcher para similaridade semântica, motor de regras determinístico, LLM refinador para ambiguidade e fila de exceções. Algoritmo no Anexo C.

**Métricas**
- Conciliação automática ≥ 70% no primeiro mês, sobre transações com contrapartida cadastrada, e ≥ 85% em 6 meses.
- Precisão ≥ 99%.
- Menos de 500ms por transação.
- Redução de trabalho manual ≥ 60%.

### 10.5 Agente Compliance

**Propósito:** varrer diariamente as obrigações, detectar prazos vencendo, gerar rascunhos de entrega e alertar com priorização por risco financeiro.

**Fluxo**
```
Calendário fiscal (regime, estado, atividade) → motor de obrigações (regras versionadas)
  → verificação de pré-requisitos × dados da empresa (faturamento, funcionários, regime)
  → alertas priorizados
      CRÍTICO — multa iminente  → SMS + push + dashboard
      ALTO    — multa em 3 dias → e-mail + push
      MÉDIO   — informativo     → e-mail diário
      BAIXO   — informativo     → dashboard passivo
```

**Saída:** alertas com `obrigacao_id`, nome, data de vencimento, dias restantes, prioridade, risco de multa, valor estimado da multa, ação sugerida, dependências e canal, mais resumo executivo. O valor estimado da multa vem do cálculo determinístico da regra `penalidade` da obrigação; o LLM prioriza, redige e explica. Prompt no Anexo A.3.

**Ações sugeridas:** "Gerar guia DAS", "Transmitir EFD-Reinf", "Revisar evento S-1200".

**Métricas**, medidas sobre o universo de obrigações cadastrado no calendário:
- Cobertura de 100% das obrigações do regime e do estado.
- Zero obrigações perdidas.
- Detecção em ≤ 24h após o surgimento da pendência.
- 80% ou mais dos alertas críticos resultam em ação em 24h.

### 10.6 Agente DP

**Propósito:** validar eventos eSocial antes do envio, detectar erros que gerariam rejeição ou multa e sugerir correções.

**Validações**, executadas em código antes de qualquer chamada a LLM:

| Validação | Regra | Severidade |
|---|---|---|
| Prazo de admissão | S-2200 transmitido até 1 dia antes do início das atividades | BLOQUEIO |
| Salário mínimo | Salário abaixo do piso da categoria ou do salário mínimo | BLOQUEIO |
| CPF/PIS | Divergência entre o CPF informado e a base da Receita | BLOQUEIO |
| Jornada | Carga horária acima de 44h semanais sem acordo | ALERTA |
| Dependentes | Idade do dependente acima do limite para dedução | ALERTA |
| SST | Evento S-2210 sem CAT registrada | ALERTA |
| Admissão × desligamento | Desligamento anterior à admissão | BLOQUEIO |
| FGTS | Opção de FGTS inválida para o vínculo | BLOQUEIO |

**Fluxo:** validação sintática do schema XML — erro bloqueia imediatamente. Aprovado, segue para a validação semântica determinística: BLOQUEIO retorna erro com sugestão de correção, ALERTA registra warning no evento, APROVADO gera lote pronto para transmissão. O LLM atua na explicação e nos casos de ALERTA, não na decisão de bloqueio.

**Base de conhecimento:** histórico de causas de rejeição do eSocial.

**Saída:** status (APROVADO, BLOQUEADO ou ALERTA), erros com campo, severidade, descrição, regra violada, sugestão de correção e risco de multa, score de confiança e resumo. Prompt no Anexo A.4.

**Métricas**
- Rejeição após validação inferior a 2%.
- 95% ou mais dos casos de risco de multa bloqueados preventivamente.
- Validação em menos de 3s por evento.
- 60% ou mais dos eventos aprovados sem intervenção.

### 10.7 Copiloto Contábil

**Propósito:** responder perguntas sobre os dados do cliente, normas fiscais e status de obrigações, com fontes citadas.

**Arquitetura**
```
Pergunta → classificador de intenção
  → dados internos (SQL/RAG) | normas (Vector DB de legislação)
    | histórico de ações do usuário | calculadora (code interpreter)
  → resposta com fontes citadas → verificador de factualidade
      aprovado → responde | suspeito → adiciona disclaimer
```

**Bases de conhecimento**

| Base | Conteúdo | Atualização |
|---|---|---|
| Legislação | Leis, decretos e instruções normativas da RFB, Sefaz e eSocial | Diária, por coleta automatizada e curadoria |
| Jurisprudência | Decisões administrativas e judiciais relevantes | Semanal |
| Base interna | Documentos, lançamentos e eventos do cliente | Tempo real |
| FAQ e histórico | Perguntas frequentes com respostas aprovadas por contadores | Contínua |

**Regras de resposta:** nunca inventar números, datas ou normas; sempre citar a fonte; declarar quando a informação não está nas fontes disponíveis; usar a calculadora e mostrar o passo a passo; sugerir o contador responsável em decisão tributária complexa; não fornecer consultoria jurídica. Prompt no Anexo A.5.

**Métricas**
- Taxa de alucinação inferior a 1%.
- Satisfação do usuário ≥ 4,2/5.
- Menos de 3s para consultas simples e 10s para complexas.
- Escalonamento inferior a 15%.

### 10.8 Agente Coletor Ativo

**Propósito:** identificar documento faltante em D-2 do fechamento e cobrar o cliente de forma contextual pelo canal de mensageria, em lugar de aguardar upload passivo.

- [ ] Canal oficial WhatsApp/E-mail.
- [ ] Cobrança automatizada de pendências, envio de guias e coleta de recibos.

---

## 11. RF-08 — Administração da Plataforma

**Prioridade:** P3 — MVP-4

### 11.1 Funcionalidades
- [ ] Visão do super-admin sobre todos os tenants.
- [ ] Ciclo de vida do tenant — CRUD completo.
- [ ] Gestão de usuários e convites de admin para tenant — CRUD completo.
- [ ] Papel `super-admin` e RBAC.
- [ ] **Impersonation** ("logar como"), por caminho de serviço auditado e separado do acesso normal.
- [ ] Gestão de planos e billing do tenant.
- [ ] Feature toggles para gestão de módulos.

### 11.2 Dashboard administrativo
- [ ] **Métricas de SaaS:** MRR, churn rate, LTV e CAC.
- [ ] **Saúde da aplicação:** tenants ativos e inativos, novos tenants no mês, DAU/MAU globais — disponível no MVP-2, por não depender de cobrança.
- [ ] **Consumo de recursos por tenant:** banda, processamento e armazenamento, integrado ao custo de IA por tenant, para identificar cliente que custa mais do que paga.

### 11.3 Relatórios
- [ ] **Logs de auditoria globais:** ações críticas de todos os usuários de todos os tenants e da equipe de suporte, incluindo cada sessão de impersonation.
- [ ] **Relatórios de adoção:** features mais e menos utilizadas na plataforma.

### 11.4 Critérios de aceite
- Listagem de todos os tenants com paginação e filtros de status, em menos de 3s.
- Dashboard administrativo consolidado carrega em menos de 3s.
- Toda impersonation registra autor, tenant, duração e ações executadas no log global.

---

## 12. Requisitos Não-Funcionais

| Categoria | Requisito |
|---|---|
| **Disponibilidade** | 99,9% mensal, fora das janelas de manutenção anunciadas |
| **Performance** | APIs com p95 abaixo de 500ms; dashboard abaixo de 3s; processamento interno de lote de 10.000 XMLs em menos de 15min |
| **Escalabilidade** | 1.000 empresas por escritório e 100 escritórios sem re-arquitetura |
| **Segurança** | TLS 1.3 em trânsito e AES-256 em repouso; cofre de certificados com KMS/HSM; chaves por tenant |
| **Auditoria** | Logs imutáveis (append-only) de toda ação fiscal, contábil e trabalhista: quem, quando, o quê e de onde |
| **Retenção** | XMLs fiscais e eventos por no mínimo 5 anos |
| **Observabilidade** | Métricas, tracing e alertas em todas as integrações governamentais |
| **DR/Backup** | RPO ≤ 1h e RTO ≤ 4h; backups diários com teste de restore mensal |

---

## 13. Integrações

### 13.1 Governo

| Integração | Função | Observação |
|---|---|---|
| Distribuição DF-e (Sefaz) | Captura de NF-e e CT-e emitidos contra o CNPJ | SOAP/REST com certificado A1; controle de estado por NSU, lotes de 50, respeito ao `tempoMedio` |
| Manifestação do Destinatário | Ciência, confirmação, desconhecimento e operação não realizada | Ciência automática; demais tipos sob aprovação humana |
| eSocial (S-1.3) | Envio de eventos trabalhistas | REST com certificado |
| EFD-Reinf | Retenções e informações; substituiu a DIRF | Ano-base 2025 em diante |
| Receita Federal | Consulta de CNPJ, situação cadastral e certidões | APIs disponíveis |
| NFS-e nacional | Emissão e consulta | Exige certificado por CNPJ; municípios fora do padrão nacional não têm captura automática |
| Procuração RFB/e-CAC | Consulta de clientes pelo e-CNPJ do escritório | Reduz a exigência de A1 de toda a base |
| Intermediários homologados | Focus NFe, Nuvem Fiscal, PlugNotas | Via alternativa para instabilidade e diferenças estaduais |

Toda integração governamental é validada contra os ambientes oficiais de teste — Sefaz em homologação e eSocial em produção restrita — antes de ir a produção.

### 13.2 Bancos e pagamentos

| Integração | Uso |
|---|---|
| Open Finance Brasil | Extratos, saldos e conciliação, por webhooks |
| Open Finance — ITP | Agendamento do Pix de DAS e FGTS na conta do cliente, com aprovação biométrica no app do banco |
| Pix via BaaS/PSP | Cobrança e baixa automática |
| CNAB 240/400 | Boletos e folha |

### 13.3 Mensageria

| Integração | Uso |
|---|---|
| WhatsApp / Telegram, canal oficial | Cobrança de pendências, envio de guias, coleta de recibos e alertas críticos |

### 13.4 Diferencial técnico
Cofre de certificados por CNPJ do cliente, com isolamento criptográfico por tenant, rotação e auditoria — requisito inegociável das APIs fiscais.

---

## 14. Arquitetura de Referência

```
Frontend Next.js + Tailwind (multi-tenant) + shadcn: https://ui.shadcn.com/, nada de componente nativo, só em caso de exceção.
API Gateway (NestJS) + Auth OIDC
Módulos: Fiscal │ Contábil │ Financeiro │ DP │ Admin
Motor de Regras Tributárias (versionado por vigência) ── determinístico
Motor de Partidas Dobradas / Razão Contábil ── determinístico
Motor de Obrigações (regras versionadas em JSON)
Orquestrador de Agentes (estado, roteamento, HITL)
Fila de Integrações (BullMQ/SQS) + Workers
  └─ Fila DF-e com estado por NSU (ultNSU / maxNSU / tempoMedio)
Signer isolado em rede privada ── único detentor da chave privada A1;
  assina os documentos e termina o mTLS com Sefaz e eSocial
Conectores: Sefaz │ eSocial │ Open Finance │ Pix │ Mensageria
PostgreSQL (RLS por tenant e empresa) │ S3 (documentos) │ Redis │ Vector DB │ Vault/KMS
Pipeline de IA (Python, serviço interno): features, embeddings, RAG, feedback de modelo
Observabilidade de agentes: tracing, custo por requisição e por tenant
```

---

## 15. UX — Fluxos Principais

**Contrato de entrega da interface:** do MVP-1 ao MVP-4, cada fatia com UI entrega a tela final desde o início, nos temas CLARO e ESCURO. Conteúdo, fluxo e hierarquia seguem as referências de `docs/telas/`; aparência, componentes, tokens, estados, responsividade e acessibilidade seguem `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md`, que corrigem os defeitos catalogados dos protótipos. Não existe etapa posterior de “aplicar o design”. A implementação usa obrigatoriamente `frontend-design`, sem substituir a direção aprovada, e `impeccable` para acabamento e refino antes do aceite.

1. **Onboarding de cliente** — cadastrar CNPJ → vincular certificado A1 ou procuração RFB/e-CAC → importar plano de contas e cadastro de empregados via CSV → primeiro pull de DF-e, até 90 dias retroativos, respeitando o controle de NSU → triagem inicial assistida.
2. **Dia a dia do contador** — abrir dashboard → resolver alertas priorizados → aprovar manifestações e sugestões do agente → fechar as guias do dia.
3. **Fechamento fiscal mensal** — malha preventiva cruza SPED × DF-e × extrato → agente gera rascunhos de apuração → contador revisa → transmite → dashboard atualiza o semáforo.
4. **Admissão de funcionário** — DP cadastra → Agente DP valida e bloqueia se fora do prazo → transmite o S-2200 dentro do prazo legal.
5. **Cobrança de pendências** — em D-2 do fechamento, o Agente Coletor identifica o documento faltante e cobra o cliente por WhatsApp.

---

## 16. Roadmap

**Regra de ambiente aprovada pelo PI:** MVP-1, MVP-2, MVP-3 e MVP-4 são desenvolvidos e homologados integralmente em Docker local, com dados sintéticos/anonimizados e credenciais não produtivas. Não há deploy, piloto com empresa real, certificado real ou dado real durante esses MVPs. A **produção é uma etapa posterior ao MVP-4**, com gate próprio para hospedagem, KMS/HSM, região, storage, backup/restore, observabilidade, migração e rollback. Requisitos transferidos para esse gate continuam obrigatórios e não podem ser descartados pelo fatiamento.

| Fase | Prazo | Entregas de produto | Agentes |
|---|---|---|---|
| **MVP-1** | 3–4 meses | Base operacional de RF-01 — multi-tenancy de dois níveis, RLS, cofre e Signer com material de teste, importação de plano de contas e empregados · RF-02 — captura DF-e com fila por NSU, parse com campos IBS/CBS, ciência automática e inbox de aprovação para as demais manifestações · RF-06 — dashboard com semáforo de pendências por CNPJ | Captura (ciência automática e sugestão para os demais tipos) · Compliance (alertas de vencimento) |
| **MVP-2** | +3 meses | RF-03 completo — motor de regras versionado, apurações, guias, escrituração contábil e ECD · RF-04 — Open Finance, ITP, conciliação assistida, Pix, contas a pagar e receber · Malha fiscal preventiva contínua | Classificador · Conciliador · Compliance completo, com rascunhos de entrega |
| **MVP-3** | +4 meses | RF-05 — DP e eSocial · Portal do cliente white-label · Canal ativo WhatsApp | DP · Copiloto Contábil · Coletor Ativo |
| **MVP-4** | contínuo | RF-08 completo — billing, planos e preço · Motor completo de IBS/CBS · API pública · Marketplace · controles e evidências preparatórias para certificações | Multi-agente colaborativo (Captura → Classificador → Conciliador) · Predição de fluxo de caixa e obrigações |
| **Produção** | após o MVP-4 | Infraestrutura produtiva, KMS/HSM, região, object storage, backup/restore, observabilidade, migração, rollback, piloto controlado com dados reais e certificações externas | Validação operacional dos agentes e métricas reais |

---

## 17. Métricas de Sucesso

### 17.1 Produto

| Métrica | Meta 6 meses pós-MVP |
|---|---|
| Tempo de captura, da disponibilização no DF-e à inbox | ≤ 1h |
| Taxa de conciliação automática, sobre transações com contrapartida cadastrada | ≥ 70% |
| Obrigações fiscais perdidas, sobre o calendário cadastrado | 0 por tenant ativo |
| Tarefas repetitivas automatizadas, por pesquisa periódica com clientes | ≥ 50% |
| NRR — receita recorrente líquida | ≥ 100% |
| NPS dos clientes do escritório | ≥ 50 |

### 17.2 Agentes

| Métrica | Alerta |
|---|---|
| Latência p95 por agente | acima de 5s |
| Taxa de erro por agente | acima de 1% |
| Custo por requisição | acima de R$ 0,50 |
| Taxa de HITL — intervenção humana necessária | acima de 40% |
| Aprovação sem correção | abaixo de 60% |
| Alucinações detectadas | acima de 0,5% |
| Documentos processados por hora | queda acima de 20% |

### 17.3 Alertas operacionais

```yaml
alertas:
  - nome: "agente_captura_falha_sefaz"
    condicao: "erro_conexao_sefaz > 3 em 10min"
    acao: "notificar_oncall + pausar_workers + notificar_clientes"

  - nome: "bloqueio_nsu_sefaz"
    condicao: "rejeicao_656 > 0"
    acao: "notificar_oncall + revisar_agendamento_da_fila"

  - nome: "agente_dp_rejeicao_alta"
    condicao: "taxa_rejeicao_eSocial > 5% em 1h"
    acao: "notificar_time_dp + revisar_prompt"

  - nome: "custo_llm_explosao"
    condicao: "custo_diario > 150% da media_7dias"
    acao: "ativar_rate_limiting + investigar"

  - nome: "fila_hitl_acumulada"
    condicao: "itens_pendentes > 500"
    acao: "notificar_supervisores + escalonar_humanos"
```

---

## 18. Custos de IA

**Estratégias de otimização**

| Estratégia | Economia estimada |
|---|---|
| Cache de embeddings em Redis | 30–40% das chamadas de embedding |
| Classificação de intenção leve | Roteia 60% das tarefas para o tier barato |
| Processamento em lote | Documentos fiscais em lotes de 100 durante a madrugada |
| Fallback para regras determinísticas | Cálculo tributário sem LLM |
| Tier self-hosted para dados sensíveis | Modelo próprio quando o dado não pode sair da infraestrutura |

**Estimativa mensal para 1.000 empresas ativas**

| Item | Custo |
|---|---|
| LLM | R$ 8.000–15.000 |
| Embeddings e Vector DB | R$ 2.000 |
| Infraestrutura — workers, fila, cache | R$ 3.000 |
| **Total** | **R$ 13.000–20.000/mês — cerca de R$ 13–20 por empresa** |

A estimativa não inclui a curadoria de legislação e jurisprudência do Copiloto nem a infraestrutura do tier self-hosted, orçadas junto da fase em que entram.

## 19. Matriz de Distribuição dos Modelos por Tier

**Cada modelo atende a um papel específico dentro do pipeline, guiado por custo por milhão de tokens, latência e requisitos regulatórios**

### Modelos Recomendados
Tier Raciocínio: Claude 3.5 Sonnet, GPT-4o
Tier Rápido / Baixa Latência: Gemini 1.5 Flash, Claude 3.5 Haiku, GPT-4o-mini
Tier Embeddings: text-embedding-3-small (OpenAI) ou BGE-M3 / Qwen-Embedding local
Tier Soberano / Sensível (Self-Hosted/VPC): Hermes 3 (Llama 3/3.1 fine-tuned) via AWS Bedrock (instâncias dedicadas) ou vLLM em VPC privada
Tier Contexto Longo: Kimi (Moonshot), Gemini 1.5 Pro

#### Prioridade para: Claude/GPT/Google/Hermes

**O provedor do Orquestrador/Pipeline Python deve ser diferente do provedor dos agentes no AI Gateway.**
---

## 20. Riscos e Mitigações

### 20.1 Produto e integrações

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Mudanças nas APIs do governo (Sefaz, eSocial) | Alta | Alto | Anti-corruption layer nos conectores, monitoramento e cadastro de vigências |
| Bloqueio por Consumo Indevido (Rejeição 656) | Alta | Alto | Controle de estado por NSU, respeito ao `tempoMedio` e intermediário homologado como via alternativa |
| Reforma Tributária altera o cronograma | Média | Alto | Motor versionado por vigência, com regras configuráveis |
| Certificado A3 não automatizável | Média | Médio | Recomendação de A1 e uso de procuração RFB/e-CAC |
| Rejeições no eSocial | Alta | Médio | Agente validador determinístico e base de causas de rejeição |
| Vazamento de dados sensíveis | Baixa | Crítico | Cofre KMS, RLS de dois níveis, auditoria e pentests semestrais |
| Custo de IA em tarefa massiva | Alta | Alto | Regras e embeddings para o volume; LLM restrito à exceção |
| NFS-e municipal fora do padrão nacional | Alta | Alto | Comunicação clara da cobertura e upload manual como via alternativa |
| Início frio do Classificador e do Conciliador | Média | Médio | Importação de plano de contas e histórico no onboarding |
| Concorrência em captura fiscal | Alta | Alto | Acompanhamento de mercado contínuo e diferenciação pela automação de ponta a ponta |

### 20.2 Específicos de IA

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Alucinação em cálculo tributário ou contábil | Média | Alto | LLM nunca calcula; apenas orquestra o motor de regras |
| Viés na classificação contábil | Média | Médio | Diversidade no feedback e auditoria de classificações por perfil |
| Dependência excessiva de um provedor de LLM | Alta | Alto | Abstração multi-provider e tier self-hosted para casos críticos |
| Vazamento por prompt injection | Baixa | Alto | Sanitização de inputs, sandboxing e nenhuma execução de código gerado por LLM sem revisão |
| Custo de LLM inesperado | Média | Médio | Rate limiting, caching, fallback para regras e alertas de custo |
| Manifestação automática indevida | Baixa | Crítico | Apenas a Ciência da Emissão é automática; os demais tipos exigem aprovação humana |

---

## 21. Glossário

- **DF-e** — Documentos Fiscais Eletrônicos distribuídos pela Sefaz.
- **Manifestação do Destinatário** — registro do tomador sobre a NF-e recebida, obrigatório para escriturar créditos.
- **NSU** — Número Sequencial Único da Distribuição DF-e. `ultNSU` é o último lido; `maxNSU`, o último disponível.
- **Rejeição 656 (Consumo Indevido)** — bloqueio temporário de 1 hora aplicado pela Sefaz a consultas excessivas sem novos documentos.
- **`tempoMedio`** — intervalo mínimo entre consultas, retornado pela Sefaz no XML de resposta.
- **HITL** — *human-in-the-loop*: o agente propõe, o humano aprova.
- **RLS** — *Row-Level Security*: isolamento de dados no banco, aqui em dois níveis, por tenant e por empresa.
- **Signer** — microserviço isolado que detém o acesso ao certificado, assina os documentos e faz a saída de rede para os órgãos governamentais.
- **ITP** — Iniciação de Transação de Pagamento, no Open Finance.
- **EFD-Reinf** — Escrituração Fiscal Digital de Retenções e Informações; substituiu a DIRF.
- **IBS/CBS** — tributos sobre consumo criados pela Reforma Tributária.
- **DAS** — Documento de Arrecadação do Simples Nacional.
- **ECD** — Escrituração Contábil Digital, o SPED Contábil.
- **RAG** — *Retrieval-Augmented Generation*: resposta gerada a partir de fontes recuperadas.

---

## Anexo A — Prompts dos Agentes

### A.1 Classificador de Risco — Agente de Captura

```
Você é um agente contábil especializado em análise de documentos fiscais.
Analise a seguinte NF-e e classifique o risco da operação.

DADOS DA NOTA:
- Emitente: {emitente_razao_social} (CNPJ: {emitente_cnpj})
- Valor: R$ {valor_total}
- Produtos: {lista_produtos}
- Histórico do emitente: {historico_compras} (últimos 12 meses)
- Regras do cliente: {regras_cliente} (fornecedores aprovados, limites)

INSTRUÇÕES:
1. Se o emitente está na lista de fornecedores aprovados E o valor está dentro do padrão
   histórico → sugerir "Confirmação da Operação"
2. Se o emitente é desconhecido OU o valor é anômalo (> 3x a média) OU os produtos não se
   relacionam à atividade → sinalizar para revisão humana, com os riscos identificados
3. Se houver indícios de fraude (CNPJ suspenso, valor muito alto, produtos atípicos)
   → escalar com prioridade

RETORNE APENAS JSON:
{
  "tipo_manifestacao_sugerida": "confirmacao" | "desconhecimento" | "nao_realizada",
  "score": 0.0 a 1.0,
  "justificativa": "string",
  "riscos": ["string"]
}
```

A Ciência da Emissão é executada pelo motor de manifestação antes desta análise, para garantir o download do XML completo. A sugestão retornada acima entra na fila de aprovação humana; nenhum dos tipos é transmitido à Sefaz sem aprovação registrada.

### A.2 Agente Classificador

```
Você é um contador experiente especializado em classificação contábil.
Classifique o seguinte documento fiscal no plano de contas do cliente.

DOCUMENTO:
- Tipo: {tipo_documento}
- Emitente: {emitente}
- Descrição: {descricao_produtos}
- NCM: {ncm} · CFOP: {cfop} · Valor: R$ {valor}
- Natureza da operação: {natureza_operacao}

CONTEXTO HISTÓRICO (classificações similares aprovadas):
{contexto_rag}

PLANO DE CONTAS DO CLIENTE:
{plano_contas}

INSTRUÇÕES:
1. Sugira a conta contábil mais adequada
2. Sugira o centro de custo
3. Classifique como despesa, receita, ativo ou passivo
4. Indique se há crédito de ICMS/PIS/COFINS potencialmente recuperável
5. Forneça observação contábil

RETORNE APENAS JSON:
{
  "conta_contabil": "string",
  "codigo_conta": "string",
  "centro_custo": "string",
  "classificacao": "despesa" | "receita" | "ativo" | "passivo",
  "credito_recuperavel": { "icms": boolean, "pis": boolean, "cofins": boolean },
  "observacao": "string",
  "score": 0.0 a 1.0,
  "justificativa": "string"
}
```

A indicação de crédito recuperável é candidata a revisão; o valor é apurado pelo motor de regras tributárias.

### A.3 Agente Compliance

```
Você é um agente fiscal que monitora obrigações de empresas brasileiras.
Analise a situação da empresa e determine os próximos alertas necessários.

EMPRESA:
- Razão Social: {razao_social}
- Regime: {regime_tributario} · Estado: {uf} · Atividade: {cnae_principal}
- Faturamento do último mês: R$ {faturamento}
- Funcionários: {quantidade_funcionarios}

OBRIGAÇÕES PENDENTES: {lista_obrigacoes_pendentes}
DOCUMENTOS E EVENTOS JÁ ENTREGUES: {lista_entregues}
VALORES DE PENALIDADE CALCULADOS: {penalidades_calculadas}

INSTRUÇÕES:
1. Para cada obrigação pendente, avalie o risco: dias até o vencimento, penalidade
   calculada e impacto operacional
2. Priorize: multa iminente > multa em 3 dias > informativo > opcional
3. Sugira ações concretas ("Gerar guia DAS", "Transmitir EFD-Reinf", "Revisar evento S-1200")
4. Se houver dependência entre obrigações, indique a sequência

RETORNE APENAS JSON:
{
  "alertas": [
    {
      "obrigacao_id": "string",
      "nome": "string",
      "data_vencimento": "YYYY-MM-DD",
      "dias_restantes": number,
      "prioridade": "CRITICA" | "ALTA" | "MEDIA" | "BAIXA",
      "valor_penalidade": number,
      "acao_sugerida": "string",
      "dependencias": ["string"],
      "canal": "push" | "email" | "sms" | "dashboard"
    }
  ],
  "resumo_executivo": "string"
}
```

Os valores de penalidade são calculados pelo motor de obrigações e entregues prontos ao agente, que prioriza e redige.

### A.4 Validador DP

```
Você é um especialista em eSocial e Departamento Pessoal.
Revise o seguinte evento e as validações já executadas antes do envio ao governo.

EVENTO: {tipo_evento}
DADOS DO EVENTO: {dados_evento_json}
RESULTADO DAS VALIDAÇÕES DETERMINÍSTICAS: {resultado_validacoes}

DADOS DA EMPRESA:
- CNAE: {cnae} · Natureza Jurídica: {natureza_juridica}
- Regime previdenciário: {regime_previdenciario}

DADOS DO EMPREGADO: {historico_empregado}
BASE DE CONHECIMENTO: {causas_rejeicao_comuns}

INSTRUÇÕES:
1. Explique cada erro apontado pelas validações, em linguagem acionável
2. Verifique consistência com os dados históricos do empregado
3. Identifique rejeições prováveis não cobertas pelas validações determinísticas
4. Sugira correções específicas

RETORNE APENAS JSON:
{
  "erros_complementares": [
    {
      "campo": "string",
      "severidade": "ALERTA",
      "descricao": "string",
      "regra_violada": "string",
      "sugestao_correcao": "string"
    }
  ],
  "score_confianca": 0.0 a 1.0,
  "resumo": "string"
}
```

As validações de BLOQUEIO (§10.6) são executadas em código antes desta chamada e não dependem do LLM.

### A.5 Copiloto Contábil

```
Você é o Copiloto Contábil, um assistente especializado em contabilidade brasileira.
Responda à pergunta do usuário usando APENAS as fontes fornecidas.

PERGUNTA: {pergunta_usuario}
CONTEXTO DOS DADOS DO CLIENTE: {resultado_consulta_sql}
CONTEXTO DA LEGISLAÇÃO: {resultado_rag_legislacao}
HISTÓRICO DE AÇÕES: {historico_usuario}

INSTRUÇÕES CRÍTICAS:
1. NUNCA invente números, datas ou normas que não estejam nas fontes
2. Sempre cite a fonte da informação (ex.: "Conforme IN RFB nº XXXX/202X...")
3. Se não souber, diga "Não encontrei essa informação nas fontes disponíveis"
4. Para cálculos, use a calculadora e mostre o passo a passo
5. Se a pergunta envolver decisão tributária complexa, sugira consultar o contador responsável
6. Não forneça consultoria jurídica — apenas informação baseada em dados e normas

FORMATO DA RESPOSTA:
- Resposta direta e objetiva
- Citação das fontes
- Disclaimer quando aplicável
- Sugestão de ação quando relevante
```

---

## Anexo B — Estruturas de Dados

### B.1 Obrigação com regra versionada

```json
{
  "obrigacao_id": "DAS_SIMPLES",
  "nome": "DAS - Simples Nacional",
  "regimes": ["SIMPLES_NACIONAL"],
  "periodicidade": "MENSAL",
  "dia_vencimento": 20,
  "dia_vencimento_ajustado": "dia_util_antecessor",
  "prerequisitos": [
    { "tipo": "faturamento", "minimo": 0 },
    { "tipo": "funcionarios", "minimo": 0 }
  ],
  "penalidade": {
    "tipo": "multa",
    "percentual": 0.005,
    "minimo": 100.00,
    "juros": 0.01
  },
  "prioridade": "ALTA",
  "vigencia": { "inicio": "2020-01-01", "fim": null },
  "regra_reforma_tributaria": {
    "vigencia_inicio": "2033-01-01",
    "nova_descricao": "IBS Federal - Simples Nacional",
    "novo_codigo": "IBS_SIMPLES"
  }
}
```

### B.2 Classificação no Vector DB

```json
{
  "id": "class_abc123",
  "tenant_id": "escritorio_001",
  "empresa_id": "empresa_456",
  "embedding": [0.023, -0.156],
  "metadata": {
    "descricao_produto": "PAPEL A4 SULFITE 500 FLS",
    "ncm": "4802.56.00",
    "cfop": "5102",
    "valor": 45.90,
    "conta_contabil": "3.1.01.01 - MATERIAL DE ESCRITÓRIO",
    "centro_custo": "ADMINISTRATIVO",
    "natureza": "DESPESA OPERACIONAL",
    "data_classificacao": "2026-08-15",
    "classificado_por": "agente",
    "aprovado_por": "contador_joao",
    "score_confianca": 0.92
  }
}
```

---

## Anexo C — Motor de Conciliação

```python
def conciliar(transacao, candidatos):
    scores = []

    for candidato in candidatos:
        score = 0.0

        # Critério 1: valor (peso 40%)
        if abs(transacao.valor - candidato.valor) < 0.01:
            score += 0.40
        elif abs(transacao.valor - candidato.valor) / candidato.valor < 0.05:
            score += 0.25

        # Critério 2: data (peso 25%)
        diff_dias = abs((transacao.data - candidato.data).days)
        if diff_dias == 0:
            score += 0.25
        elif diff_dias <= 2:
            score += 0.15
        elif diff_dias <= 5:
            score += 0.05

        # Critério 3: descrição / destinatário (peso 20%)
        similarity = embedding_similarity(transacao.descricao, candidato.descricao)
        score += similarity * 0.20

        # Critério 4: número do documento (peso 15%)
        if extrair_numeros(transacao.descricao) == candidato.numero_documento:
            score += 0.15
        elif fuzzy_match(extrair_numeros(transacao.descricao), candidato.numero_documento) > 0.8:
            score += 0.10

        scores.append((candidato, score))

    scores.sort(key=lambda x: x[1], reverse=True)

    if scores[0][1] >= 0.90:
        return {"acao": "auto_conciliar", "match": scores[0]}
    elif scores[0][1] >= 0.60:
        return {"acao": "sugerir", "match": scores[0], "alternativas": scores[1:3]}
    else:
        return {"acao": "escalar", "candidatos": scores[:3]}
```

Os cortes de 0,90 e 0,60 são valores iniciais, revisados trimestralmente com base em dado de produção.

---

*ContaIA — PRD versão 3.1, 17/09/2026. Alterações somente mediante revisão formal.*
