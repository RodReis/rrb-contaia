# 🔐 Documento de Privacidade, Compliance e Segurança de Dados

## Política de Proteção de Dados Pessoais e Governança de Segurança não vinculado ao /prd/PRD.md

| Campo | Valor |
|---|---|
| **Documento** | Política de Privacidade, Compliance e Segurança |
| **Versão** | 1.0 |
| **Data de publicação** | 15/09/2026 |
| **Controlador** | ContaIA Serviços Contábeis em Nuvem LTDA |
| **Encarregado de Dados (DPO)** | dpo@contaia.com.br |
| **Última revisão** | 15/09/2026 |

> Este documento é **autônomo e independente**: possui valor legal e regulatório próprio, não depende de nenhum outro documento interno ou externo para sua validade e não faz referência cruzada a documentos de produto. Em caso de conflito com materiais de marketing, vence este documento.

---

## PARTE I — DISPOSIÇÕES GERAIS

### 1. Objetivo e Abrangência
Estabelecer as diretrizes de tratamento de dados pessoais e dados pessoais sensíveis, os controles de segurança da informação e as práticas de compliance da plataforma, em conformidade com:
- **Lei nº 13.709/2018 (LGPD)**
- **Lei nº 12.965/2014 (Marco Civil da Internet)**
- **Resolução nº 1/2020 do CNJ** (sigilo fiscal, quando aplicável)
- **Normas do eSocial** (Retificação Técnica 43/2024 e atualizações — regras de uso, armazenamento e sigilo dos dados trabalhistas)
- **Recomendações do Banco Central** para participantes de Open Finance (quando aplicável via parceiros de consentimento)

### 2. Papéis LGPD
| Papel | Quem assume | Situação |
|---|---|---|
| **Controlador** | ContaIA, para dados de usuários da plataforma, logs, dados de navegação e credenciais | Sempre |
| **Operador** | ContaIA, para dados de empregados e sócios dos clientes do escritório, tratados sob instrução do escritório contábil | Quando o escritório é controlador |
| **Controlador conjunto** | ContaIA + escritório contábil, quando ambos definem finalidades conjuntas (ex.: portal do cliente) | Caso a caso, com termo de cooperação |

### 3. Princípios aplicados
Finalidade, adequação, necessidade, transparência, segurança, prevenção, não discriminação e responsabilização — todos adotados por desenho (*privacy by design*).

---

## PARTE II — DADOS PESSOAIS TRATADOS

### 4. Categorias de dados
| Categoria | Exemplos | Sensível? | Base legal |
|---|---|---|---|
| Identificação | Nome, CPF, RG, data de nascimento | Não | Execução de contrato; obrigação legal |
| Contato | E-mail, telefone, WhatsApp | Não | Execução de contrato |
| Profissionais/Trabalhistas | Cargo, salário, admissão, PIS, dependentes, dados de saúde ocupacional (SST), afastamentos | **Sim (saúde, quando houver)** | Obrigação legal (eSocial/CLT); proteção da vida |
| Dados fiscais vinculados a pessoas | Notas fiscais, transações | Não | Obrigação legal |
| Financeiros vinculados a pessoas | Extratos via Open Finance, dados de pagamento | Não | Consentimento (Open Finance) |
| Navegação/Uso | Logs, IP, dispositivo, cookies | Não | Legítimo interesse |
| Biométricos | Não coletados | — | — |

### 5. Dados de menores de idade
A plataforma **não trata dados pessoais de menores de 16 anos** como regra. 
Aprendizes (contratação de 14–18 anos, art. 303 do Decreto 9.854/2017) são tratados exclusivamente sob obrigação legal de envio ao eSocial, com acesso restrito a usuários autorizados e registro de auditoria.

### 6. Dados sensíveis — regras especiais
- Dados de saúde coletados via eventos SST (S-2210/S-2220/S-2240) são **pseudonimizados na visualização padrão**, acessíveis integralmente apenas a perfis `dp` e `auditor_readonly`.
- Compartilhamento com terceiros exige base legal específica e registro.

---

## PARTE III — FINALIDADES E COMPARTILHAMENTO

### 7. Finalidades
1. Execução dos serviços contratados (fiscal, financeiro, DP).
2. Cumprimento de obrigações legais e regulatórias (Sefaz, eSocial, Receita Federal, EFD-Reinf).
3. Automação assistida por IA (sempre com aprovação humana — nenhuma decisão exclusivamente automatizada produz efeitos jurídicos sobre o titular).
4. Melhoria do serviço (métricas agregadas e anonimizadas).
5. Comunicação operacional e de segurança.

### 8. Compartilhamento
| Destinatário | Dados | Base legal |
|---|---|---|
| Órgãos públicos (Sefaz, RFB, eSocial/FGTS Digital) | Documentos fiscais e eventos trabalhistas | Obrigação legal |
| Instituições financeiras (via Open Finance) | Dados do titular, mediante consentimento | Consentimento |
| PSP/BaaS de pagamentos | Dados mínimos para cobrança | Execução de contrato |
| Suboperadores (nuvem, suporte) | Conforme contrato de cláusulas de proteção | Operação autorizada |
| Escritório contábil cliente | Dados das empresas sob sua guarda | Contrato |

**Proibições:** venda de dados pessoais; compartilhamento para marketing de terceiros; uso de dados trabalhistas para score de crédito.

---

## PARTE IV — DIREITOS DOS TITULARES

### 9. Direitos e prazos
| Direito | Canal | Prazo de resposta |
|---|---|---|
| Confirmação e acesso | painel ou e-mail do DPO | até 15 dias |
| Correção | painel ou e-mail do DPO | imediato, até 15 dias |
| Anonimização, bloqueio ou eliminação | e-mail do DPO | até 15 dias (respeitadas retenções legais) |
| Portabilidade | e-mail do DPO | até 15 dias |
| Informação sobre compartilhamento | e-mail do DPO | até 15 dias |
| Revogação de consentimento | painel | imediato |
| Oposição e revisão de decisão automatizada | e-mail do DPO | até 15 dias |

**Restrições:** pedidos de eliminação podem ser parcialmente negados quando o dado for exigido por obrigação legal de retenção fiscal/trabalhista (ex.: 5 anos para documentos fiscais; prazos do eSocial), hipótese em que o dado será bloqueado para uso diverso.

### 10. Canais do titular
- **DPO:** dpo@contaia.com.br
- **Formulário no painel:** Privacidade → Solicitações
- **Autoridade Nacional de Proteção de Dados (ANPD):** www.gov.br/anpd

---

## PARTE V — SEGURANÇA DA INFORMAÇÃO

### 11. Controles técnicos
| Domínio | Controle |
|---|---|
| Criptografia em repouso | AES-256 em banco, arquivos e backups |
| Criptografia em trânsito | TLS 1.3; pinagem em integrações críticas |
| Certificados digitais de clientes | Cofre dedicado com chaves por tenant (KMS/HSM); nunca em disco legível; acesso por sistema apenas |
| Isolamento por cliente | Row-Level Security em 100% das tabelas com dados de empresas |
| Autenticação | MFA obrigatório; SSO/OIDC; sessões com expiração |
| Gestão de acesso | Menor privilégio; concessão por papel; revisão trimestral |
| Logs e auditoria | Logs append-only de toda ação fiscal, trabalhista e de acesso a dados sensíveis (quem, quando, o quê, origem) |
| Ambientes | Separação rigorosa de dev/staging/prod; dados de produção jamais usados em testes sem anonimização |
| Backups | Diários, criptografados, com teste de restauração mensal |
| Resposta a incidentes | Plano com classificação, contenção, comunicação à ANPD em até 3 dias úteis (quando aplicável) e aos titulares em prazo razoável |
| Pentest | Testes de invasão semestrais por empresa independente |

### 12. Engenharia de IA responsável
- Modelos não treinam com dados dos clientes sem autorização expressa.
- Dados enviados a provedores de LLM são minimizados e pseudonimizados.
- Toda saída que produz efeito jurídico exige aprovação humana registrada.
- Direito de revisão de decisão automatizada garantido (item 9).

### 13. Retenção e descarte
| Dado | Prazo |
|---|---|
| Documentos fiscais (XML) | mínimo 5 anos (obrigação legal) |
| Eventos eSocial e guias | conforme normas vigentes do eSocial |
| Logs de acesso | 12 meses (Marco Civil) |
| Dados de navegação/marketing | até revogação ou 24 meses de inatividade |
| Backups | ciclo de 30 dias, depois descarte seguro |

Descarte por destruição criptográfica ou sanitização certificada.

---

## PARTE VI — COMPLIANCE REGULATÓRIO

### 14. Conformidade fiscal e trabalhista
- Envio de informações aos órgãos públicos apenas mediante certificado digital válido do próprio titular (CNPJ) ou procuração quando regulamentada.
- Guarda de sigilo fiscal e trabalhista; acesso interno registrado e justificado.
- Acompanhamento contínuo de mudanças normativas (Sefaz, eSocial, EFD-Reinf, Reforma Tributária) com revisão trimestral desta política.

### 15. Open Finance
- Consentimento específico, granular e revogável pelo titular.
- Nenhum dado bancário é acessado sem consentimento vigente.
- Uso exclusivo para conciliação e visualização contratadas.

### 16. Certificações e auditoria (metas)
- ISO/IEC 27001 e SOC 2 Type II no horizonte de 24 meses.
- Auditorias internas anuais de LGPD com relatório de impacto (RIPD) para tratamentos de alto risco.

---

## PARTE VII — GOVERNANÇÃO

### 17. Papéis de governança
- **DPO (Encarregado):** canal com titulares e ANPD; registro das operações de tratamento.
- **Comitê de Segurança e Privacidade:** reunião mensal; aprova exceções e revisa incidentes.
- **Todos os colaboradores:** treinamento de LGPD e segurança na admissão e anualmente, com termo de confidencialidade.

### 18. Relatório de Impacto (RIPD)
Obrigatório para: tratamento de dados de saúde (SST), uso de IA sobre dados pessoais, integrações com Open Finance, e qualquer novo compartilhamento relevante.

### 19. Violações e sanções internas
Descumprimento desta política sujeita o colaborador a processo disciplinar, sem prejuízo das sanções civis, administrativas e penais aplicáveis.

### 20. Atualizações
Esta política é revisada anualmente ou quando houver mudança legal significativa, mediante comunicação aos titulares e clientes com antecedência mínima de 15 dias.

---

## ANEXO A — Resumo para o Titular (versão acessível)

**Quem somos:** plataforma de contabilidade que serve escritórios contábeis e empresas.
**O que fazemos com seus dados:** usamos para cumprir obrigações fiscais e trabalhistas (notas fiscais, folha, impostos) e para operar a plataforma, sempre com segurança e com sua autorização quando exigida.
**Seus direitos:** você pode pedir para ver, corrigir, bloquear ou excluir seus dados a qualquer momento pelo e-mail dpo@contaia.com.br.
**Consentimento Open Finance:** você controla e pode revogar quando quiser, direto no painel.

---

*Documento publicado em 15/09/2026 — Versão 1.0. Alterações somente mediante revisão formal pelo Comitê de Segurança e Privacidade.*
