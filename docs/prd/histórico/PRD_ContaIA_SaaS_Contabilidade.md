# 📋 Product Requirements Document (PRD)
## ContaIA — SaaS de Contabilidade Inteligente Multi-empresa

| Campo | Valor |
|---|---|
| **Documento** | PRD — Fonte de Verdade do Produto |
| **Versão** | 1.0 |
| **Status** | Aprovado para desenvolvimento |
| **Data** | 15/09/2026 |
| **Owner** | Produto |
| **Última revisão** | 15/09/2026 |

> **⚠️ Regra de governança:** Este documento é histórico morto e a fonte de verdade sobre escopo PRD.md, requisitos e critérios de aceite. Qualquer divergência entre código, protótipos, conversas ou outros artefatos deve ser resolvida no /prd/PRD.md.

---

## 1. Visão e Contexto

### 1.1 Visão
Ser a plataforma de gestão financeira, fiscal e trabalhista que permite a escritórios contábeis e empresas operarem **vários clientes em um painel centralizado**, com automação por agentes de IA nas tarefas repetitivas e conformidade contínua com a legislação brasileira.

### 1.2 Problema
- Escritórios contábeis gerenciam dezenas/centenas de CNPJs com planilhas, sistemas legados e captura manual de documentos fiscais.
- Perda de prazos fiscais gera multas (ex.: eSocial — admissão com até 1 dia de antecedência; atraso sujeito a multa a partir de R$ 3.000 por empregado).
- A Reforma Tributária (IBS/CBS) exige que documentos fiscais (NF-e, NFC-e, CT-e, MDF-e) incorporem os novos campos a partir de **03/08/2026**, tornando sistemas atuais obsoletos.
- Tarefas repetitivas (classificação, conciliação, escrituração) consomem 60–70% do tempo do contador.

### 1.3 Solução
SaaS multi-tenant com:
1. Captura automática de documentos fiscais do governo (distribuição DF-e + manifestação).
2. Gestão Fiscal e Tributária com motor de regras versionado por vigência (atual + Reforma Tributária).
3. Gestão Financeira Integrada (Open Finance, Pix, CNAB, conciliação assistida por IA).
4. Departamento Pessoal com eSocial completo e validações pré-envio por IA.
5. Dashboard multi-empresa com alertas de compliance priorizados por risco financeiro.
6. Agentes de IA com aprovação humana (HITL) para tudo que gera obrigação legal.

### 1.4 Público-alvo
| Persona | Descrição |
|---|---|
| Escritório contábil (core) | 5–200 colaboradores, 30–1.000 CNPJs atendidos |
| Contador independente | 1–5 pessoas, até 30 CNPJs |
| Empresa (diretoria financeira) | Acesso a 1 CNPJ, portal do cliente |

### 1.5 Não-objetivos (out of scope v1)
- Emissão de NF-e em nome de clientes (fase posterior via parceiro).
- Contabilidade completa (balanço, DRE auditável) — foco em fiscal/financeiro/DP.
- Certificação de notas fiscais de serviço municipais fora do padrão nacional.
- ERP de estoque/produção.

---

## 2. Requisitos Funcionais

### RF-01 — Multi-tenancy e Gestão de Clientes
**Prioridade:** P0 (MVP)

- [ ] Cadastro de escritório (tenant raiz) com CNPJ, CRC, responsável técnico, CRUD completo(logo, endereços, documentos).
- [ ] Cadastro de empresas clientes do escritório(CNPJ, razão social, regime tributário: Simples/Presumido/Real, atividade CNAE, inscrições estaduais/municipais), CRUD completo(logo, endereços, documentos).
- [ ] Isolamento completo de dados por empresa (row-level security no PostgreSQL).
- [ ] Cadastro de usuários e papéis e permissões: `admin_escritorio`, `contador`, `auxiliar`, `gestor_financeiro`, `dp`, `cliente_portal`, `auditor_readonly`, CRUD completo de usuário e papéis com ROLE para visualisação da infomração.
- [ ] Vínculo de certificado digital (A1) por empresa, armazenado em cofre criptográfico isolado por tenant.

**Critérios de aceite:**
- Usuário de empresa A nunca acessa dados de empresa B (teste automatizado de RLS em 100% das tabelas sensíveis).
- Upload de certificado A1 rejeita arquivo expirado ou com senha incorreta.

### RF-02 — Captura Automática de Documentos Fiscais
**Prioridade:** P0 (MVP)

- [ ] Integração com o **web service de Distribuição de DF-e** (NF-e mod. 55, CT-e, NFS-e padrão nacional) para os CNPJs cadastrados, com o certificado do cliente.
- [ ] Consulta agendada (a cada 1h, configurável) e consulta sob demanda.
- [ ] **Manifestação do Destinatário**: ciência, confirmação, desconhecimento, operação não realizada.
- [ ] Parse de XML (NF-e, CT-e, NFS-e, eventos) para estrutura normalizada no banco.
- [ ] Armazenamento do XML original (obrigação legal, retenção mínima de 5 anos) com hash de integridade.
- [ ] Tela de triagem: inbox de documentos novos com sugestão automática de manifestação.
- [ ] **Agente de Captura**: monitora 24/7, manifesta automaticamente notas acima de confiança configurável, escala para humano em caso de divergência.

**Critérios de aceite:**
- NF-e emitida contra CNPJ do cliente aparece na inbox em ≤ 1h após autorização.
- Manifestação automática com log imutável de quem (agente/usuário) manifestou e quando.
- Falha de comunicação com a Sefaz gera retry exponencial e alerta após 3 tentativas.

### RF-03 — Gestão Fiscal e Tributária
**Prioridade:** P0/P1

- [ ] **Motor de regras tributárias versionado por vigência** (`vigente_de` / `vigente_ate`) — suporte simultâneo ao regime atual e à Reforma Tributária (IBS/CBS) com cronograma 2026–2033.
- [ ] Apuração de ICMS, PIS, COFINS, IBS/CBS por regime tributário.
- [ ] Geração de guias: DAS (Simples), DARF, GPS, FGTS-REINF.
- [ ] Escrituração de livros fiscais e geração de SPED Fiscal/Contábil (fase 2).
- [ ] **Monitoramento de obrigações acessórias**: calendário fiscal por regime e por estado (obrigações estaduais diferem).
- [ ] **Agente Compliance**: varre prazos diariamente, prioriza alertas por risco de multa, gera rascunho de entrega.

**Critérios de aceite:**
- Obrigação fiscal com vencimento em D-3 gera alerta no dashboard e por e-mail/WhatsApp.
- Mudança de regra tributária é cadastrada com vigência futura sem quebrar apurações passadas.
- Documento fiscal emitido após 03/08/2026 é parseado com campos IBS/CBS.

### RF-04 — Gestão Financeira Integrada
**Prioridade:** P1

- [ ] Contas a pagar e receber com importação de boletos (PDF/linha digitável), CNAB 240/400.
- [ ] **Open Finance Brasil**: consentimento do cliente, importação de extratos e saldos de contas correntes.
- [ ] **Conciliação automática assistida**: casamento extrato × lançamentos × documentos fiscais (Agente Conciliador), com fila de aprovação humana.
- [ ] **Pix**: emissão de cobrança via PSP/BaaS parceiro, webhook de baixa automática.
- [ ] Fluxo de caixa projetado por empresa e consolidado por escritório (30/60/90 dias).
- [ ] Relatórios: aging a pagar/receber, DRE gerencial simplificado.

**Critérios de aceite:**
- Extrato Open Finance importado alimenta a conciliação em ≤ 24h.
- Taxa de conciliação automática ≥ 70% no primeiro mês, com aprendizado contínuo.
- Baixa de Pix confirma lançamento sem intervenção manual.

### RF-05 — Departamento Pessoal (eSocial)
**Prioridade:** P2

- [ ] Cadastro de empregados, cargos, salários, dependentes.
- [ ] Envio de eventos eSocial S-1.3 (incl. S-2200 admissão — **até 1 dia antes do início das atividades**), S-1200 folha, S-1210 pagamento, S-2206 alteração, S-2299 desligamento.
- [ ] Cálculo de folha: INSS, IRRF, FGTS, 13º, férias, rescisão.
- [ ] **EFD-Reinf** (substituiu a DIRF, descontinuada a partir do ano-base 2025).
- [ ] Eventos SST (S-2210, S-2220, S-2240).
- [ ] **Agente de DP**: valida eventos antes do envio (admissão fora do prazo, salário abaixo do piso da categoria, divergências de CPF/pis).
- [ ] Guias: FGTS Digital, GPS, IRRF.

**Critérios de aceite:**
- Tentativa de envio de admissão com início "hoje" é bloqueada e alertada (risco de multa).
- Folha fechada gera eventos S-1200/S-1210 em lote com relatório de validação.
- Evento rejeitado pelo eSocial é classificado com causa provável e ação sugerida.

### RF-06 — Dashboard Multi-empresa
**Prioridade:** P0 (MVP — visão básica; completo na Fase 3)

- [ ] Visão consolidada: todas as empresas do escritório com semáforo de saúde (verde/amarelo/vermelho).
- [ ] KPIs: obrigações entregues/pendentes, guias vencendo em 72h, caixa consolidado, documentos não manifestados, eventos eSocial pendentes.
- [ ] Alertas priorizados por impacto financeiro (multa > informativo).
- [ ] Drill-down por empresa.
- [ ] Portal do cliente white-label: documentos, guias para pagamento, status de entregas.
- [ ] Copiloto Contábil (chat com RAG sobre os dados): "quanto de ICMS a empresa X deve este mês?"

**Critérios de aceite:**
- Carregamento do dashboard consolidado com 500 empresas em < 3s (dados agregados pré-calculados).
- Cada alerta possui ação direta (ir para tela de resolução em 1 clique).

### RF-07 — Agentes de IA (plataforma)
**Prioridade:** P1/P2

| Agente | Função | Saída |
|---|---|---|
| Captura | Monitora DF-e 24/7, manifesta, extrai | Documentos estruturados |
| Classificador | Sugere conta contábil/CFOP/plano de contas | Sugestão com score |
| Conciliador | Casa extrato × lançamentos × notas | Matches + fila de exceções |
| Compliance | Varre prazos, gera rascunhos de entrega | Alertas + drafts |
| DP | Valida eventos eSocial pré-envio | Validação + bloqueio |
| Copiloto | Respostas naturais sobre dados do cliente | Resposta com fonte citada |

- [ ] Todo agente opera em modo **HITL** (human-in-the-loop): ação que gera obrigação legal exige aprovação humana registrada.
- [ ] Trilha de auditoria completa por decisão do agente (prompt, contexto, score, aprovador).

### RF-08 — Administração dos Multi-empresa(escritórios)
**Prioridade:** P3

- Visão do Super Admin.
- Gestão do Ciclo de Vida do Tenant(escritórios) CRUD completo.
- Gestão de Usuários(Convites) admin para Tenant(escritórios) CRUD completo.
- Gestão de Papéis e permissões: `super-admin`.
- Controle de Acesso (RBAC).
- Impersonation (Logar como).
- Gestão de Planos e Billing do Tenant(escritório).
- Feature Toggles (Gestão de Módulos)

RF-08 Dashboard:

Métricas de Negócio (SaaS Metrics): MRR (Receita Recorrente Mensal), Churn Rate (taxa de cancelamento), LTV (Lifetime Value) e CAC.
Saúde da Aplicação: Quantidade total de tenants ativos vs. inativos, novos tenants no mês, e usuários ativos diários/mensais (DAU/MAU) globais.
Consumo de Recursos por Tenant: Monitoramento de quem está consumindo mais banda, processamento ou armazenamento no banco de dados (para identificar clientes que estão custando mais do que pagam).

RF-08 Relatórios:

Logs de Auditoria Globais: Registro de ações críticas de todos os usuários de todos os tenants, além das ações da sua própria equipe de suporte (ex: "Admin X fez impersonation no Tenant Y").
Relatórios de Adoção: Quais funcionalidades (features) estão sendo mais ou menos usadas de forma geral na plataforma.

**Critérios de aceite:**
Carregamento de todos os tenants, cooperativas, 
Carregamento do dashboard dos tenants.

---

## 3. Requisitos Não-Funcionais

| Categoria | Requisito |
|---|---|
| **Disponibilidade** | 99,9% mensal (fora janelas de manutenção anunciadas) |
| **Performance** | APIs p95 < 500ms; dashboard < 3s; processamento de lote de 10.000 XMLs < 15min |
| **Escalabilidade** | Suportar 1.000 empresas por escritório e 100 escritórios sem re-arquitetura |
| **Segurança** | Criptografia em trânsito (TLS 1.3) e em repouso (AES-256); cofre de certificados com KMS/HSM; chaves por tenant |
| **Auditoria** | Logs imutáveis (append-only) de toda ação fiscal/trabalhista: quem, quando, o quê, de onde |
| **Retenção** | XMLs fiscais e eventos: mínimo 5 anos; dados de DP conforme LGPD e normas do eSocial |
| **LGPD** | Base legal mapeada por dado; consentimento para Open Finance; direitos do titular em até 15 dias |
| **Observabilidade** | Métricas, tracing e alertas em todas as integrações governamentais (Sefaz, eSocial) |
| **DR/Backup** | RPO ≤ 1h, RTO ≤ 4h; backups diários com teste de restore mensal |

---

## 4. Integrações

### 4.1 Governo
| Integração | O que faz | Observação |
|---|---|---|
| Distribuição DF-e (Sefaz) | Captura NF-e/CT-e/NFS-e emitidas contra o CNPJ | SOAP/REST + certificado A1 do cliente |
| Manifestação do Destinatário | Ciência/confirmação/desconhecimento/naoRealizada | Idem |
| eSocial (S-1.3) | Envio dos eventos trabalhistas | REST + certificado |
| EFD-Reinf | Retenções e substituição da DIRF | Ano-base 2025 em diante |
| Receita Federal | Consulta CNPJ, situação, certidões | APIs/integrações disponíveis |
| NFS-e nacional | Emissão/consulta | Modelo exige certificado por CNPJ; procuração eletrônica ainda não liberada — roadmap acompanha a Fenacon/gov.br |

### 4.2 Bancos e Pagamentos
| Integração | Uso |
|---|---|
| Open Finance Brasil | Extratos, saldos, conciliação (consentimento do cliente) |
| Pix (via BaaS/PSP) | Cobrança e baixa automática |
| CNAB 240/400 | Boletos e folha |

### 4.3 Diferencial técnico
Cofre de certificados **por CNPJ do cliente** com isolamento criptográfico por tenant, rotação e auditoria — requisito inegociável das APIs fiscais.

---

## 5. Arquitetura (referência)

```
Frontend Next.js + Tailwind (multi-tenant)
API Gateway (NestJS) + Auth OIDC
Módulos: Fiscal │ Financeiro │ DP
Motor de Regras Tributárias (versionado por vigência)
Agentes de IA (LLM + function calling + HITL)
Fila de Integrações (BullMQ/SQS) + Workers
Conectores: Sefaz │ eSocial │ Open Finance │ Pix
PostgreSQL (RLS por tenant) │ S3 (documentos) │ Redis │ Vault/KMS (certificados)
```

---

## 6. UX — Fluxos principais

1. **Onboarding de cliente**: cadastrar CNPJ → vincular certificado A1 → primeiro pull de DF-e (até 90 dias retroativos) → triagem inicial assistida.
2. **Dia a dia do contador**: abrir dashboard → resolver alertas priorizados → aprovar manifestações/cançoes do agente → fechar guias do dia.
3. **Fechamento fiscal mensal**: agente gera rascunhos de apuração → contador revisa → transmite → dashboard atualiza semáforo.
4. **Admissão de funcionário**: DP cadastra → agente valida → transmite S-2200 com prazo garantido.

---

## 7. Métricas de Sucesso (KPIs do produto)

| Métrica | Meta 6 meses pós-MVP |
|---|---|
| Tempo médio de captura de NF-e após emissão | ≤ 1h |
| Taxa de conciliação automática | ≥ 70% |
| Obrigações fiscais perdidas (multas por atraso) | 0 por tenant ativo |
| % de tarefas repetitivas automatizadas (relato dos clientes) | ≥ 50% |
| NRR (receita recorrente líquida) | ≥ 100% |
| NPS de clientes do escritório | ≥ 50 |

---

## 8. Roadmap

| Fase | Prazo | Entregas |
|---|---|---|
| **MVP** | 3–4 meses | RF-01, RF-02 (básico), RF-06 (básico), contas a pagar/receber simples |
| **Fase 2** | +3 meses | RF-03 completo, RF-04 (Open Finance, conciliação, Pix), guias fiscais, agentes Captura + Compliance |
| **Fase 3** | +4 meses | RF-05 (DP/eSocial), portal do cliente, agentes Conciliador + DP + Copiloto |
| **Fase 4** | contínuo | Motor CBS/IBS completo, API pública, marketplace, certificações SOC 2/ISO 27001 |

---

## 9. Riscos e Mitigações

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Mudanças nas APIs do governo (Sefaz/eSocial) | Alta | Alto | Camada anti-corruption de conectores; monitoramento; cadastro de vigências |
| Reforma Tributária muda cronograma | Média | Alto | Motor versionado; regras configuráveis |
| Certificado A3 não automatizável | Média | Médio | Recomendar A1; suporte a procuração quando liberada |
| Rejeições no eSocial | Alta | Médio | Agente validador + base de causas de rejeição |
| Vazamento de dados sensíveis (LGPD) | Baixa | Crítico | Cofre KMS, RLS, auditoria, pentests semestrais |

---

## 10. Glossário

- **DF-e**: Documentos Fiscais Eletrônicos distribuídos pela Sefaz.
- **Manifestação do Destinatário**: registro do tomador sobre a NF-e recebida (obrigatório para escriturar créditos).
- **HITL**: Human-in-the-loop — agente propõe, humano aprova.
- **RLS**: Row-Level Security — isolamento de dados no banco por tenant.
- **EFD-Reinf**: Escrituração Fiscal Digital de Retenções e Informações — substituiu a DIRF.
- **IBS/CBS**: novos tributos da Reforma Tributária sobre consumo.
- **DAS**: Documento de Arrecadação do Simples Nacional.

---

*Documento gerado em 15/09/2026 — Versão 1.0. Alterações somente mediante revisão formal.*
