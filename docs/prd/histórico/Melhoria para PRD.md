# Diagnóstico e Evolução Estratégica do PRD (SaaS Contábil 2027)

> **⚠️ Regra de governança:** Este documento é histórico morto e a fonte de verdade sobre escopo PRD.md, requisitos e critérios de aceite. Qualquer divergência entre código, protótipos, conversas ou outros artefatos deve ser resolvida no /prd/PRD.md.

---

## 1. Diagnóstico Crítico dos Gargalos Técnicos e Fiscais

### 1.1. O Gargalo da Sefaz (Consumo Indevido e NSU)
* **Problema:** A consulta horária (`RF-02`) por CNPJ via Web Service de Distribuição DF-e gera rejeição por **"Consumo Indevido" (Rejeição 656)** com bloqueio temporário de 1 hora pela Sefaz caso não haja novos documentos. Além disso, a Sefaz limita o retorno a lotes de 50 NSUs por requisição com intervalo obrigatório.
* **Correção:** Substituir o cronograma rígido por uma fila com **controle estrito de estado por NSU (`ultNSU` vs `maxNSU`)**, respeitando o tempo de espera (`tempoMedio`) retornado pelo próprio XML da Sefaz. Avaliar o uso de intermediários homologados (ex.: Focus NFe, Nuvem Fiscal, PlugNotas) para absorver a instabilidade e as diferenças estaduais no MVP.

### 1.2. O Isolamento de Multi-tenancy em Dois Níveis
* **Problema:** O PRD menciona RLS (Row-Level Security) por empresa, mas o modelo contábil exige hierarquia rígida de dois níveis: **Tenant (Escritório Contábil)** e **Sub-Tenant (Empresa Cliente)**.
* **Correção:** A política de RLS deve garantir que:
  1. Usuários do escritório acessem apenas as empresas da sua carteira ou alçada permitida.
  2. Usuários do portal do cliente (`cliente_portal`) acessem estritamente o seu `empresa_id`.
  3. Toda tabela transacional carregue `tenant_id` e `empresa_id` devidamente indexados para evitar vazamentos de dados entre clientes concorrentes.

### 1.3. Custos e Latência de IA (LLMs vs. Algoritmos Determinísticos)
* **Problema:** Utilizar LLMs em tarefas massivas (como conciliação bancária ou classificação de plano de contas em milhares de lançamentos diários) gerará custos proibitivos de tokens e alta latência.
* **Correção:** Adotar arquitetura híbrida: **regras determinísticas + embeddings/ML local** para conciliação e classificação rotineira (que resolvem cerca de 90% dos casos); reservar as **LLMs** exclusivamente para exceções, triagem de ambiguidades e para o Copiloto conversacional.

---

## 2. Visão Tecnológica para 2027: O que falta no PRD

| Módulo | Prática Legada (2020–2024) | Padrão Moderno (2027) |
|---|---|---|
| **Classificação Contábil** | Contador digita ou cria 500 regras manuais de DE/PARA | Auto-tagging vetorial baseado no histórico do cliente + NCM/CFOP com aprendizado ativo |
| **Comunicação com Cliente** | E-mails e portais passivos onde o cliente raramente entra | **Agente Conversacional Oficial (WhatsApp/Telegram)**: cobrança automatizada de pendências, envio de guias e coleta de recibos |
| **Integração Bancária** | CNAB manual e importação de extrato D+1 | **Open Finance com Webhooks e Iniciação de Pagamentos (ITP)**: o escritório agenda o Pix do DAS/FGTS direto na conta do cliente com 1 clique de aprovação |
| **Auditoria** | Relatórios estáticos gerados apenas no fechamento do mês | **Malha Fiscal Preventiva Contínua**: cruzamento em tempo real (SPED x DF-e x Extrato) antes do fechamento |

---

## 3. Propostas de Melhoria por Requisito Funcional

### RF-01 — Multi-tenancy e Cofre de Certificados A1
* **Arquitetura de Assinatura Isolada:** Evitar expor a chave privada na API principal. Implementar um microserviço *Signer* isolado em rede privada, consumindo o certificado diretamente do cofre KMS/Vault. A aplicação envia o payload (hash do XML), o Signer assina e devolve o XML envelopado.
* **Gestão de Procurações Eletrônicas:** Permitir o uso da procuração RFB/e-CAC do e-CNPJ do escritório para consultar clientes, reduzindo a fricção inicial de exigir o certificado A1 de 100% da base no primeiro dia.

### RF-02 — Captura e Manifestação Inteligente
* **Manifestação em Cascata Automatizada:** Padronizar o ciclo: *Ciência da Emissão* imediata (garantindo o download do XML completo) $\rightarrow$ validação por regras/agente $\rightarrow$ *Confirmação da Operação* ou fila HITL para notas desconhecidas/suspeitas (proteção contra emissão de notas frias contra o CNPJ).

### RF-04 — Gestão Financeira e Pagamentos
* **Iniciação de Pagamentos (Pix ITP):** Evoluir além da geração de QR Codes estáticos. Integrar a funcionalidade de ITP para que o sistema gere a guia, monte o agendamento de pagamento na conta do cliente via Open Finance e dispare uma notificação no app do banco dele apenas para validação biométrica.

### RF-07 — Redefinição dos Agentes de IA
* **Agente Coletor Ativo (WhatsApp):** Em vez de aguardar o upload passivo de extratos ou notas de serviços tomados, o agente identifica a falta do documento em D-2 do fechamento e cobra o cliente de forma contextual via canal de mensageria.
* **Guardrails e Citações RAG:** Garantir que prompts e pipelines de RAG fiscal retornem fontes normativas explícitas (ex.: *"base legal: art. 12 da LC 123/06"*), eliminando alucinações e conferindo segurança jurídica ao contador.

---

## 4. Ajuste de Roadmap e MVP

O escopo original do MVP apresentava um volume excessivo de entregas para uma janela de 3 a 4 meses. Recomenda-se focar estritamente na **"Dor da Entrada"** (o caos da captura fiscal), empurrando frentes financeiras densas para as fases seguintes.

### Novo Desenho do MVP (3 a 4 meses)
* **RF-01 (Base):** Multi-tenancy estruturado com RLS e Cofre A1 seguro.
* **RF-02 (Essencial):** Captura de DF-e via fila robusta com controle de NSU / intermediário homologado.
* **RF-06 (Básico):** Inbox de documentos fiscais estruturados e dashboard com semáforo de pendências por CNPJ.
* *Corte estratégico do MVP:* Contas a pagar/receber e conciliação bancária completa foram transferidas para a **Fase 2**, priorizando a estabilidade fiscal inicial.

### Visão Consolidada do Roadmap
* **MVP (3–4 meses):** Estrutura multi-tenant, cofre A1, captura de DF-e e inbox de triagem fiscal básica.
* **Fase 2 (+3 meses):** Módulo Fiscal completo (motor de regras versionado), Open Finance, conciliação assistida e agentes de captura/compliance.
* **Fase 3 (+4 meses):** Departamento Pessoal (eSocial/Reinf), portal do cliente white-label e agentes de DP/Conciliação.
* **Fase 4 (Contínuo):** Motor completo da Reforma Tributária (IBS/CBS), API pública, marketplace e certificações de segurança (SOC 2 / ISO 27001).