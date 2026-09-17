# 🤖 Stack de Agentes de IA — ContaIA

> **⚠️ Regra de governança:** Este documento é histórico morto e a fonte de verdade sobre escopo PRD.md, requisitos e critérios de aceite. Qualquer divergência entre código, protótipos, conversas ou outros artefatos deve ser resolvida no /prd/PRD.md.

## Arquitetura Técnica de Agentes Inteligentes para Contabilidade

| Campo | Valor |
|---|---|
| **Documento** | Stack de Agentes de IA |
| **Versão** | 1.0 |
| **Status** | Especificação técnica |
| **Data** | 15/09/2026 |
| **Owner** | Engenharia de IA |

---

## 1. Visão Geral da Arquitetura de Agentes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CAMADA DE ORQUESTRAÇÃO                             │
│  Agent Orchestrator (LangGraph / Custom) — estado, roteamento, HITL         │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ Agente   │  │ Agente   │  │ Agente   │  │ Agente   │  │ Agente   │     │
│  │ Captura  │  │Classifica│  │Conciliad.│  │Compliance│  │   DP     │     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘     │
│       │             │             │             │             │             │
├───────┴─────────────┴─────────────┴─────────────┴─────────────┴─────────────┤
│                           CAMADA DE MODELOS                                  │
│  LLM Router (classificação de intenção)                                      │
│  LLM Principal (GPT-4o / Claude 3.5 Sonnet / Llama 3.1 70B — self-hosted)   │
│  LLM Especializado (embeddings, extração, classificação)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                           CAMADA DE FERRAMENTAS                              │
│  Function Calling — APIs internas, Sefaz, eSocial, Open Finance, Banco      │
│  RAG (Vector DB) — base de conhecimento contábil, normas, histórico         │
│  Code Interpreter — cálculos tributários, simulações                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                           CAMADA DE DADOS                                    │
│  PostgreSQL (dados estruturados) │ S3 (XMLs, documentos) │ Redis (cache)   │
│  Pinecone/Weaviate (vector DB) │ Vault (secrets, certificados)              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Princípios de Design

| Princípio | Implementação |
|---|---|
| **HITL obrigatório** | Nenhum agente executa ação com efeito jurídico sem aprovação humana registrada |
| **Mínimo privilégio** | Cada agente acessa apenas os dados e APIs necessários para sua função |
| **Observabilidade total** | Todo pensamento, ferramenta usada, entrada e saída é logado |
| **Fallback seguro** | Em caso de incerteza > threshold, escala para humano automaticamente |
| **Determinismo fiscal** | Cálculos tributários usam motor de regras, não LLM (LLM apenas orquestra) |

---

## 2. Agente de Captura (Document Fiscais)

### 2.1 Propósito
Monitorar 24/7 a Distribuição DF-e, capturar documentos fiscais emitidos contra os CNPJs dos clientes, manifestar automaticamente quando seguro e escalar para triagem humana em casos de risco.

### 2.2 Fluxo de Execução

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Scheduler   │────▶│ Worker DF-e  │────▶│ Parse XML    │────▶│ Análise de   │
│ (a cada 1h) │     │ (certificado)│     │ (estrutura)  │     │ Risco        │
└─────────────┘     └──────────────┘     └──────────────┘     └──────┬───────┘
                                                                     │
                                    ┌────────────────────────────────┼────────────────┐
                                    │                                │                │
                                    ▼                                ▼                ▼
                              ┌─────────┐                    ┌──────────┐      ┌──────────┐
                              │ Score   │                    │ Score    │      │ Score    │
                              │ ≥ 0.85  │                    │ 0.50-0.85│      │ < 0.50   │
                              │ (auto)  │                    │ (sugest) │      │ (human)  │
                              └────┬────┘                    └────┬─────┘      └────┬─────┘
                                   │                              │                 │
                                   ▼                              ▼                 ▼
                              ┌─────────┐                    ┌──────────┐      ┌──────────┐
                              │Manifesta│                    │Inbox     │      │Inbox     │
                              │automática│                   │sugerida  │      │alerta    │
                              │+ log     │                   │+ notific.│      │+ notific.│
                              └─────────┘                    └──────────┘      └──────────┘
```

### 2.3 Componentes Técnicos

| Componente | Tecnologia | Função |
|---|---|---|
| Scheduler | BullMQ / AWS EventBridge | Dispara workers a cada hora ou sob demanda |
| Worker | Node.js + axios-ntlm | Consome web service Sefaz com certificado A1 |
| Parser | fast-xml-parser + schemas Sefaz | Extrai campos do XML para JSON estruturado |
| Classificador de Risco | LLM + regras heurísticas | Determina se a nota é "conhecida", "suspeita" ou "anômala" |
| Motor de Manifestação | Worker dedicado | Executa ciência/confirmação via web service |

### 2.4 Prompt do Classificador de Risco

```
Você é um agente contábil especializado em análise de documentos fiscais.
Analise a seguinte NF-e e determine se ela deve ser manifestada automaticamente.

DADOS DA NOTA:
- Emitente: {emitente_razao_social} (CNPJ: {emitente_cnpj})
- Valor: R$ {valor_total}
- Produtos: {lista_produtos}
- Histórico do emitente: {historico_compras} (últimos 12 meses)
- Regras do cliente: {regras_cliente} (fornecedores aprovados, limites, etc.)

INSTRUÇÕES:
1. Se o emitente está na lista de fornecedores aprovados E o valor está dentro do padrão histórico → manifestar como "Ciência da Operação"
2. Se o emitente é desconhecido OU o valor é anômalo (> 3x média) OU produtos não relacionados à atividade → sugerir "Operação não Realizada" ou "Desconhecimento"
3. Se houver indícios de fraude (CNPJ suspenso, valor muito alto, produtos atípicos) → escalar para humano

RETORNE APENAS JSON:
{
  "decisao": "auto_manifestar" | "sugerir" | "escalar",
  "tipo_manifestacao": "ciencia" | "confirmacao" | "desconhecimento" | "nao_realizada",
  "score": 0.0 a 1.0,
  "justificativa": "string",
  "riscos": ["string"]
}
```

### 2.5 Métricas
- **Latência**: tempo entre emissão da NF-e e aparecimento na inbox ≤ 1h
- **Taxa de manifestação automática**: target ≥ 60% das notas
- **Taxa de erro de manifestação**: target < 0,1% (manifestação incorreta)
- **Falsos negativos de fraude**: target < 1%

---

## 3. Agente Classificador (Contábil)

### 3.1 Propósito
Classificar automaticamente despesas, receitas e documentos fiscais no plano de contas correto, sugerir CFOP, centro de custo e natureza da operação, aprendendo com as aprovações do contador.

### 3.2 Fluxo de Execução

```
Documento fiscal recebido
        │
        ▼
┌───────────────┐
│ Extração de   │
│ features      │
│ (NCM, CFOP,   │
│ descrição,    │
│ valor, hist.) │
└───────┬───────┘
        │
        ▼
┌───────────────┐     ┌───────────────┐
│ Busca no      │────▶│ Histórico de  │
│ Vector DB     │     │ classificações│
│ (RAG)         │     │ do cliente    │
└───────┬───────┘     └───────────────┘
        │
        ▼
┌───────────────┐
│ LLM gera      │
│ sugestão:     │
│ conta, CFOP,  │
│ centro, obs   │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ Fila de       │
│ aprovação     │
│ (HITL)        │
└───────┬───────┘
        │
   ┌────┴────┐
   ▼         ▼
Aprovado  Rejeitado
   │         │
   ▼         ▼
Lança     Feedback
no ERP    para modelo
```

### 3.3 Componentes Técnicos

| Componente | Tecnologia | Função |
|---|---|---|
| Feature Extractor | Python + regex | Extrai NCM, CFOP, descrição do produto, valor |
| Embedding Model | text-embedding-3-large / E5-large | Gera embeddings de descrições de produtos e classificações históricas |
| Vector DB | Pinecone / Weaviate | Armazena classificações históricas por cliente (tenant isolado) |
| Classificador | GPT-4o-mini / Claude 3 Haiku | Gera sugestão com base no contexto RAG |
| Feedback Loop | Pipeline batch | Quando o contador corrige, atualiza o Vector DB |

### 3.4 Estrutura de Dados no Vector DB

```json
{
  "id": "class_abc123",
  "tenant_id": "escritorio_001",
  "empresa_id": "empresa_456",
  "embedding": [0.023, -0.156, ...],
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

### 3.5 Prompt do Classificador

```
Você é um contador experiente especializado em classificação contábil.
Classifique o seguinte documento fiscal no plano de contas do cliente.

DOCUMENTO:
- Tipo: {tipo_documento}
- Emitente: {emitente}
- Descrição: {descricao_produtos}
- NCM: {ncm}
- CFOP: {cfop}
- Valor: R$ {valor}
- Natureza da operação: {natureza_operacao}

CONTEXTO HISTÓRICO (classificações similares aprovadas):
{contexto_rag}

PLANO DE CONTAS DO CLIENTE:
{plano_contas}

INSTRUÇÕES:
1. Sugira a conta contábil mais adequada
2. Sugira o centro de custo
3. Classifique como despesa, receita, ativo ou passivo
4. Indique se há crédito de ICMS/PIS/COFINS recuperável
5. Forneça observação contábil

RETORNE APENAS JSON:
{
  "conta_contabil": "string",
  "codigo_conta": "string",
  "centro_custo": "string",
  "classificacao": "despesa" | "receita" | "ativo" | "passivo",
  "credito_recuperavel": {
    "icms": boolean,
    "pis": boolean,
    "cofins": boolean,
    "valor_estimado": number
  },
  "observacao": "string",
  "score": 0.0 a 1.0,
  "justificativa": "string"
}
```

### 3.6 Métricas
- **Acurácia top-1**: target ≥ 85% (conta contábil correta na primeira sugestão)
- **Taxa de aprovação sem correção**: target ≥ 70%
- **Tempo médio de classificação**: < 2s por documento
- **Melhoria contínua**: acurácia deve aumentar 2% a cada mês com feedback

---

## 4. Agente Conciliador (Financeiro)

### 4.1 Propósito
Casar automaticamente transações bancárias (extrato Open Finance) com lançamentos contábeis e documentos fiscais, identificando pagamentos, recebimentos e discrepâncias.

### 4.2 Fluxo de Execução

```
Extrato bancário importado
        │
        ▼
┌───────────────┐
│ Normalização  │
│ (limpeza de   │
│ descrições,   │
│ padronização) │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ Matching      │
│ multi-critério│
│ (valor, data, │
│ descrição,    │
│ documento)    │
└───────┬───────┘
        │
   ┌────┴────┬────────────┐
   ▼         ▼            ▼
Match      Match        Não match
100%       parcial      ou múltiplo
   │         │            │
   ▼         ▼            ▼
Auto-     Sugestão     Fila de
concilia  com score    exceções
          (HITL)       (human)
```

### 4.3 Algoritmo de Matching

```python
# Pseudocódigo do motor de conciliação

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

        # Critério 3: descrição/destinatário (peso 20%)
        similarity = embedding_similarity(
            transacao.descricao, 
            candidato.descricao
        )
        score += similarity * 0.20

        # Critério 4: número do documento (peso 15%)
        if extrair_numeros(transacao.descricao) == candidato.numero_documento:
            score += 0.15
        elif fuzzy_match(extrair_numeros(transacao.descricao), candidato.numero_documento) > 0.8:
            score += 0.10

        scores.append((candidato, score))

    # Decisão
    scores.sort(key=lambda x: x[1], reverse=True)

    if scores[0][1] >= 0.90:
        return {"acao": "auto_conciliar", "match": scores[0]}
    elif scores[0][1] >= 0.60:
        return {"acao": "sugerir", "match": scores[0], "alternativas": scores[1:3]}
    else:
        return {"acao": "escalar", "candidatos": scores[:3]}
```

### 4.4 Componentes Técnicos

| Componente | Tecnologia | Função |
|---|---|---|
| Normalizador | Python + regex + NLP | Limpa descrições de banco (ex.: "PAG*JOAO SILVA LTDA" → "JOAO SILVA LTDA") |
| Embedding Matcher | sentence-transformers | Similaridade semântica entre descrições |
| Motor de Regras | Python | Matching determinístico (valor exato, data, número de documento) |
| LLM Refinador | GPT-4o-mini | Resolve casos ambíguos com contexto adicional |
| Fila de Exceções | BullMQ | Casos que precisam de intervenção humana |

### 4.5 Métricas
- **Taxa de conciliação automática**: target ≥ 70% no primeiro mês, ≥ 85% após 6 meses
- **Precisão de conciliação automática**: target ≥ 99% (sem erros de match)
- **Tempo médio de conciliação**: < 500ms por transação
- **Redução de trabalho manual**: ≥ 60% de transações sem intervenção humana

---

## 5. Agente Compliance (Fiscal)

### 5.1 Propósito
Varrer diariamente obrigações fiscais, detectar prazos vencendo, gerar rascunhos de entregas e alertar com priorização por risco financeiro (multa > informativo).

### 5.2 Fluxo de Execução

```
┌─────────────────┐
│ Calendário      │
│ Fiscal          │
│ (por regime,    │
│ estado,         │
│ atividade)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Motor de        │
│ Obrigações      │
│ (regras         │
│ versionadas)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Verificação de  │────▶│ Dados da        │
│ pré-requisitos  │     │ empresa         │
│ (documentos,    │     │ (faturamento,   │
│ guias, eventos) │     │ funcionários,   │
│                 │     │ regime)         │
└────────┬────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│ Geração de      │
│ alertas         │
│ priorizados     │
└────────┬────────┘
         │
    ┌────┴────┬────────────┬────────────┐
    ▼         ▼            ▼            ▼
 Crítico   Alto         Médio        Baixo
 (multa    (multa       (informativo) (informativo)
  iminente) em 3 dias)
    │         │            │            │
    ▼         ▼            ▼            ▼
 SMS +     E-mail +      E-mail       Dashboard
 Push +    Push          (diário)     (passivo)
 Dashboard
```

### 5.3 Motor de Obrigações (Regras Versionadas)

```json
{
  "obrigacao_id": "DAS_SIMPLES",
  "nome": "DAS - Simples Nacional",
  "regimes": ["SIMPLES_NACIONAL"],
  "periodicidade": "MENSAL",
  "dia_vencimento": 20,
  "dia_vencimento_ajustado": "dia_util_antecessor",
  "prerequisitos": [
    {"tipo": "faturamento", "minimo": 0},
    {"tipo": "funcionarios", "minimo": 0}
  ],
  "penalidade": {
    "tipo": "multa",
    "percentual": 0.005,
    "minimo": 100.00,
    "juros": 0.01
  },
  "prioridade": "ALTA",
  "vigencia": {
    "inicio": "2020-01-01",
    "fim": null
  },
  "regra_reforma_tributaria": {
    "vigencia_inicio": "2033-01-01",
    "nova_descricao": "IBS Federal - Simples Nacional",
    "novo_codigo": "IBS_SIMPLES"
  }
}
```

### 5.4 Prompt do Agente Compliance

```
Você é um agente fiscal que monitora obrigações de empresas brasileiras.
Analise a situação da empresa e determine os próximos alertas necessários.

EMPRESA:
- Razão Social: {razao_social}
- Regime: {regime_tributario}
- Estado: {uf}
- Atividade: {cnae_principal}
- Faturamento último mês: R$ {faturamento}
- Funcionários: {quantidade_funcionarios}

OBRIGAÇÕES PENDENTES:
{lista_obrigacoes_pendentes}

DOCUMENTOS/EVENTOS JÁ ENTREGUES:
{lista_entregues}

INSTRUÇÕES:
1. Para cada obrigação pendente, calcule o risco: dias até vencimento, valor estimado da multa, impacto operacional
2. Priorize: multa iminente > multa em 3 dias > informativo > opcional
3. Sugira ações concretas: "Gerar guia DAS", "Transmitir EFD-Reinf", "Revisar evento S-1200"
4. Se houver dependência (ex.: não pode entregar X sem Y), indique a sequência

RETORNE APENAS JSON:
{
  "alertas": [
    {
      "obrigacao_id": "string",
      "nome": "string",
      "data_vencimento": "YYYY-MM-DD",
      "dias_restantes": number,
      "prioridade": "CRITICA" | "ALTA" | "MEDIA" | "BAIXA",
      "risco_multa": number,
      "valor_estimado_multa": number,
      "acao_sugerida": "string",
      "dependencias": ["string"],
      "canal": "push" | "email" | "sms" | "dashboard"
    }
  ],
  "resumo_executivo": "string"
}
```

### 5.5 Métricas
- **Cobertura de obrigações**: 100% das obrigações do regime/estado mapeadas
- **Falso negativo (obrigação perdida)**: 0 (target absoluto)
- **Tempo de detecção**: alerta gerado em ≤ 24h após surgimento da pendência
- **Taxa de ação do usuário**: ≥ 80% dos alertas críticos resultam em ação em 24h

---

## 6. Agente DP (Departamento Pessoal)

### 6.1 Propósito
Validar eventos eSocial antes do envio, detectar erros que gerariam rejeição ou multa, e sugerir correções.

### 6.2 Validações Realizadas

| Validação | Regra | Severidade |
|---|---|---|
| Prazo de admissão | S-2200 deve ser transmitido até 1 dia antes do início das atividades | BLOQUEIO |
| Salário mínimo | Salário < piso da categoria ou salário mínimo | BLOQUEIO |
| CPF/PIS | Divergência entre CPF informado e base da Receita | BLOQUEIO |
| Jornada | Carga horária > 44h semanal sem acordo | ALERTA |
| Dependentes | Idade do dependente > limite para dedução | ALERTA |
| SST | Evento S-2210 sem CAT registrada | ALERTA |
| Admissão x desligamento | Desligamento antes da admissão | BLOQUEIO |
| FGTS | Opção de FGTS inválida para o vínculo | BLOQUEIO |

### 6.3 Fluxo de Validação

```
Evento eSocial criado
        │
        ▼
┌───────────────┐
│ Validação     │
│ sintática     │
│ (schema XML)  │
└───────┬───────┘
        │
   ┌────┴────┐
   ▼         ▼
Erro      OK
   │         │
   ▼         ▼
Bloqueia  ┌───────────────┐
imediato  │ Validação     │
          │ semântica     │
          │ (regras de    │
          │ negócio)      │
          └───────┬───────┘
                  │
             ┌────┴────┬────────────┐
             ▼         ▼            ▼
          Bloqueio   Alerta       Aprovado
             │         │            │
             ▼         ▼            ▼
          Retorna   Registra    Gera lote
          erro      warning     de envio
          com       no evento   pronto
          sugestão              para
          de correção           transmissão
```

### 6.4 Prompt do Validador DP

```
Você é um especialista em eSocial e Departamento Pessoal.
Valide o seguinte evento antes do envio ao governo.

EVENTO: {tipo_evento} (ex: S-2200, S-1200, S-2299)
DADOS DO EVENTO:
{dados_evento_json}

DADOS DA EMPRESA:
- CNAE: {cnae}
- Natureza Jurídica: {natureza_juridica}
- Regime: {regime_previdenciario}

DADOS DO EMPREGADO:
{historico_empregado}

REGRAS DE VALIDAÇÃO:
{regras_especificas_do_evento}

BASE DE CONHECIMENTO:
{causas_rejeicao_comuns} (histórico de rejeições do eSocial)

INSTRUÇÕES:
1. Valide cada campo contra as regras do eSocial
2. Verifique consistência com dados históricos do empregado
3. Identifique rejeições prováveis antes do envio
4. Sugira correções específicas

RETORNE APENAS JSON:
{
  "status": "APROVADO" | "BLOQUEADO" | "ALERTA",
  "erros": [
    {
      "campo": "string",
      "severidade": "BLOQUEIO" | "ALERTA",
      "descricao": "string",
      "regra_violada": "string",
      "sugestao_correcao": "string",
      "risco_multa": number
    }
  ],
  "score_confianca": 0.0 a 1.0,
  "resumo": "string"
}
```

### 6.5 Métricas
- **Taxa de rejeição pós-validação**: target < 2% (rejeições do eSocial após passar pelo agente)
- **Bloqueios preventivos de multa**: ≥ 95% dos casos de risco de multa são bloqueados
- **Tempo de validação**: < 3s por evento
- **Taxa de eventos aprovados sem intervenção**: ≥ 60%

---

## 7. Copiloto Contábil (Chat com RAG)

### 7.1 Propósito
Interface conversacional que responde perguntas sobre dados do cliente, normas fiscais e status de obrigações, com fontes citadas e sem alucinações.

### 7.2 Arquitetura RAG

```
Pergunta do usuário
        │
        ▼
┌───────────────┐
│ Classificador │
│ de intenção   │
│ (LLM router)  │
└───────┬───────┘
        │
   ┌────┴────────────┬───────────────┬───────────────┐
   ▼                 ▼               ▼               ▼
Consulta        Consulta        Consulta        Consulta
a dados         a normas        a histórico     a calculadora
internos        (vector DB      de ações        (code
(SQL/RAG)       de legislação)  do usuário      interpreter)
   │                 │               │               │
   └─────────────────┴───────────────┴───────────────┘
                     │
                     ▼
              ┌───────────────┐
              │ LLM gera      │
              │ resposta com  │
              │ fontes        │
              │ citadas       │
              └───────┬───────┘
                      │
                      ▼
              ┌───────────────┐
              │ Verificador   │
              │ de factualidade│
              │ (self-check)  │
              └───────┬───────┘
                      │
                 ┌────┴────┐
                 ▼         ▼
              Aprovado  Suspeito
                 │         │
                 ▼         ▼
              Responde  Adiciona
              usuário   disclaimer
```

### 7.3 Bases de Conhecimento (Vector DBs)

| Base | Conteúdo | Atualização |
|---|---|---|
| **Legislação** | Leis, decretos, instruções normativas da RFB, Sefaz, eSocial | Diária (web scraping + curadoria) |
| **Jurisprudência** | Decisões administrativas e judiciais relevantes | Semanal |
| **Base interna** | Documentos fiscais, lançamentos, eventos do cliente | Em tempo real |
| **FAQ/Histórico** | Perguntas frequentes e respostas aprovadas por contadores | Contínua |

### 7.4 Prompt do Copiloto

```
Você é o Copiloto Contábil, um assistente especializado em contabilidade brasileira.
Responda à pergunta do usuário usando APENAS as fontes fornecidas.

PERGUNTA: {pergunta_usuario}

CONTEXTO DOS DADOS DO CLIENTE:
{resultado_consulta_sql}

CONTEXTO DA LEGISLAÇÃO:
{resultado_rag_legislacao}

HISTÓRICO DE AÇÕES:
{historico_usuario}

INSTRUÇÕES CRÍTICAS:
1. NUNCA invente números, datas ou normas que não estejam nas fontes
2. Sempre cite a fonte da informação (ex: "Conforme IN RFB nº XXXX/202X...")
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

### 7.5 Métricas
- **Taxa de alucinação**: target < 1% (respostas com informação inventada)
- **Taxa de satisfação do usuário**: target ≥ 4,2/5
- **Tempo de resposta**: < 3s para consultas simples, < 10s para complexas
- **Taxa de escalonamento**: target < 15% (perguntas que o copiloto não consegue responder)

---

## 8. Infraestrutura de Agentes

### 8.1 Stack Tecnológica Completa

| Camada | Tecnologia | Justificativa |
|---|---|---|
| **Orquestração** | LangGraph / CrewAI / Custom | Gerenciamento de estado, roteamento, HITL |
| **LLM Principal** | GPT-4o / Claude 3.5 Sonnet | Raciocínio complexo, poucas alucinações |
| **LLM Rápido** | GPT-4o-mini / Claude 3 Haiku | Tarefas simples, baixo custo, alta latência |
| **LLM Self-hosted** | Llama 3.1 70B (opcional) | Dados altamente sensíveis, compliance |
| **Embeddings** | text-embedding-3-large / E5-large | Alta qualidade para RAG |
| **Vector DB** | Pinecone / Weaviate / Qdrant | Busca semântica, isolamento por tenant |
| **Fila** | BullMQ / AWS SQS / RabbitMQ | Processamento assíncrono, retry, DLQ |
| **Cache** | Redis | Cache de embeddings, sessões, rate limiting |
| **Observabilidade** | LangSmith / Langfuse / Custom | Tracing, custos, métricas por agente |
| **Feature Store** | Feast / Custom | Features de ML compartilhadas |

### 8.2 Pipeline de HITL (Human-in-the-Loop)

```
┌─────────────────────────────────────────────────────────────┐
│                    ESTADOS DO HITL                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  AGENTE_PROPÕE ──▶ PENDENTE_APROVACAO ──▶ [APROVADO]       │
│       │                    │                  │              │
│       │                    │                  ▼              │
│       │                    │           EXECUTA_AÇÃO         │
│       │                    │                  │              │
│       │                    │                  ▼              │
│       │                    │           REGISTRA_LOG         │
│       │                    │                                │
│       │                    └──▶ [REJEITADO] ──▶ RETORNA_ERRO│
│       │                           │           AO_AGENTE      │
│       │                           │                          │
│       │                           ▼                          │
│       │                    FEEDBACK_APRENDIZADO              │
│       │                           │                          │
│       │                           ▼                          │
│       │                    ATUALIZA_MODELO                   │
│       │                                                    │
│       └──▶ (timeout 24h) ──▶ ESCALA_SUPERVISOR             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Regras do HITL:**
- Ações que geram obrigação legal (manifestação, envio eSocial, geração de guia) SEMPRE exigem aprovação
- Ações de baixo risco (classificação contábil, conciliação) podem ser auto-aprovadas com score > 0,90
- Timeout de 24h: se nenhum humano aprovar, escala para supervisor e notifica cliente
- Toda aprovação/rejeição gera feedback para o modelo (aprendizado contínuo)

### 8.3 Segurança e Privacidade nos Agentes

| Controle | Implementação |
|---|---|
| **Pseudonimização** | Dados enviados a LLMs de terceiros têm CPF, CNPJ, nomes mascarados (ex: CPF ***\*\*\*\*\*-**12) |
| **Isolamento por tenant** | Cada cliente tem seu próprio namespace no Vector DB; embeddings nunca se misturam |
| **Audit trail** | Todo prompt, resposta, ferramenta usada e decisão é logado em storage imutável |
| **Rate limiting** | Máximo de requisições por tenant para evitar custos excessivos e uso indevido |
| **Data retention de logs de IA** | 12 meses para prompts/respostas; depois anonimização ou descarte |
| **Consentimento para treinamento** | Dados dos clientes NÃO são usados para treinar modelos sem autorização expressa |

### 8.4 Custos e Otimização

| Estratégia | Economia estimada |
|---|---|
| Cache de embeddings (Redis) | 30–40% de redução em chamadas de embedding |
| Classificação de intenção leve | Roteia 60% das tarefas para LLM barato (mini/haiku) |
| Batch processing | Processa documentos fiscais em lotes de 100 durante a madrugada |
| Fallback para regras determinísticas | Cálculos tributários usam motor de regras, não LLM (100% de economia nesses casos) |
| Self-hosted para dados sensíveis | Llama 3.1 70B para casos que não podem sair da infraestrutura |

**Estimativa de custo mensal por 1.000 empresas ativas:**
- LLM (OpenAI/Anthropic): ~R$ 8.000–15.000
- Embeddings + Vector DB: ~R$ 2.000
- Infraestrutura (workers, fila, cache): ~R$ 3.000
- **Total**: ~R$ 13.000–20.000/mês (≈R$ 13–20/empresa/mês)

---

## 9. Observabilidade e Métricas

### 9.1 Dashboard de Agentes

| Métrica | Fonte | Alerta |
|---|---|---|
| Latência p95 por agente | LangSmith | > 5s |
| Taxa de erro por agente | Logs | > 1% |
| Custo por requisição | LangSmith | > R$ 0,50 |
| Taxa de HITL (humanos necessários) | Fila de aprovação | > 40% (indica modelo fraco) |
| Taxa de aprovação sem correção | Feedback HITL | < 60% |
| Alucinações detectadas | Verificador factual | > 0,5% |
| Documentos processados/hora | Workers | queda > 20% |

### 9.2 Alertas Operacionais

```yaml
alertas:
  - nome: "agente_captura_falha_sefaz"
    condicao: "erro_conexao_sefaz > 3 em 10min"
    acao: "notificar_oncall + pausar_workers + notificar_clientes"

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

## 10. Roadmap de Agentes

| Fase | Agente | Entrega | Complexidade |
|---|---|---|---|
| **MVP** | Captura (básico) | Auto-manifestação de notas conhecidas | Média |
| **MVP** | Compliance (básico) | Alertas de vencimento de guias | Baixa |
| **Fase 2** | Classificador | Classificação contábil com RAG | Alta |
| **Fase 2** | Conciliador | Matching bancário automático | Alta |
| **Fase 2** | Compliance (completo) | Geração de rascunhos de entrega | Média |
| **Fase 3** | DP | Validação pré-envio eSocial | Média |
| **Fase 3** | Copiloto | Chat com RAG sobre dados e normas | Alta |
| **Fase 4** | Multi-agente | Agentes colaboram entre si (ex.: Captura → Classificador → Conciliador) | Muito Alta |
| **Fase 4** | Predição | Previsão de fluxo de caixa e obrigações futuras | Alta |

---

## 11. Riscos e Mitigações Específicos de IA

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Alucinação em cálculo tributário | Média | Alto | LLM NUNCA calcula; apenas orquestra motor de regras |
| Viés na classificação contábil | Média | Médio | Diversidade no feedback; auditoria de classificações por perfil |
| Dependência excessiva de LLM de terceiro | Alta | Alto | Estratégia multi-provider; Llama self-hosted para casos críticos |
| Vazamento via prompt injection | Baixa | Alto | Sanitização de inputs; sandboxing; nunca executar código gerado por LLM sem revisão |
| Custo LLM inesperado | Média | Médio | Rate limiting; caching; fallback para regras; alertas de custo |
| Regulamentação de IA (PL 2338/2023) | Média | Alto | HITL obrigatório; transparência; direito de revisão; RIPD para IA |

---

*Documento gerado em 15/09/2026 — Versão 1.0*
