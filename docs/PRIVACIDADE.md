# PRIVACIDADE.md — Registro não normativo para revisão pós-MVP-4

> **Não é contrato de produto.** Este documento não altera PRD, MVP, SPEC, arquitetura, convenções, testes ou critérios de aceite.
> **Não é citado por SPEC.** Os identificadores de MVP/SPEC/Fatia abaixo registram somente o contexto em que o assunto surgiu.
> **Decisão:** ao final do MVP-4, o PI revisa este registro junto com [`prd/histórico/Politica_Privacidade_LGPD_Compliance.md`](prd/histórico/Politica_Privacidade_LGPD_Compliance.md) e decide o que, se algo, será promovido formalmente ao produto.

**Mantido por:** Cowork

**Revisão decisória:** após o encerramento do MVP-4

**Estado de todas as entradas:** candidato sem efeito normativo, salvo decisão posterior registrada pelo PI

---

## 1. Como registrar

Durante a especificação, registrar aqui qualquer assunto de privacidade, proteção de dados, LGPD ou consentimento que possa merecer análise posterior. O registro deve descrever o fato ou a pergunta sem prescrever solução jurídica.

Cada entrada contém:

- contexto em que surgiu: MVP, SPEC e Fatia, quando já existirem;
- assunto observado;
- origem verificável;
- decisão atual, sempre não normativa durante os MVPs;
- destino da revisão.

É proibido usar uma entrada deste arquivo para:

- criar critério de aceite, tarefa, fatia ou bloqueio;
- exigir controle técnico ou comportamento de interface;
- alterar PRD, `CONVENTION.md`, `ARCHITECTURE.md` ou uma SPEC;
- declarar conformidade jurídica.

---

## 2. Registro

| ID | Contexto | Assunto para análise posterior | Origem | Estado atual | Revisão |
|---|---|---|---|---|---|
| PRIV-001 | MVP-1 · SPEC/Fatia ainda não alocadas | Tratamento de CPF, CNPJ e nomes enviados a provedores de IA terceiros | Removido do PRD v3.1 durante o alinhamento documental de 17/09/2026 | Candidato sem efeito sobre produto | Pós-MVP-4 |
| PRIV-002 | Transversal · SPEC/Fatia não aplicáveis | Prazo de retenção e destino de prompts e respostas de IA | Removido do PRD v3.1 durante o alinhamento documental de 17/09/2026 | Candidato sem efeito sobre produto | Pós-MVP-4 |
| PRIV-003 | Transversal · SPEC/Fatia não aplicáveis | Uso de dados de clientes para treinamento de modelos | Removido do PRD v3.1 durante o alinhamento documental de 17/09/2026 | Candidato sem efeito sobre produto | Pós-MVP-4 |
| PRIV-004 | MVP-2 · SPEC/Fatia ainda não alocadas | Consentimento relacionado ao Open Finance | Removido do PRD v3.1 durante o alinhamento documental de 17/09/2026 | Candidato sem efeito sobre produto | Pós-MVP-4 |
| PRIV-005 | MVP-3 · SPEC/Fatia ainda não alocadas | Retenção de dados de departamento pessoal | Removido do PRD v3.1 durante o alinhamento documental de 17/09/2026 | Candidato sem efeito sobre produto | Pós-MVP-4 |
| PRIV-006 | MVP-4 · SPEC/Fatia ainda não alocadas | Transparência, revisão humana e avaliação de impacto para IA | Removido do PRD v3.1 durante o alinhamento documental de 17/09/2026 | Candidato sem efeito sobre produto | Pós-MVP-4 |
| PRIV-007 | Transversal · SPEC/Fatia não aplicáveis | Conteúdo de dados de clientes em logs de aplicação e console do navegador | Removido dos contratos técnicos durante o alinhamento documental de 17/09/2026 | Candidato sem efeito sobre produto | Pós-MVP-4 |
| PRIV-008 | MVP-1 · SPEC-001/F1 em especificação | CPF, e-mail e telefone do responsável técnico no cadastro do escritório | Decisão do PI durante a especificação da F1 em 17/09/2026 | Candidato sem efeito sobre produto | Pós-MVP-4 |
| PRIV-009 | MVP-1 · SPEC-002/F2 aprovada | Telefone e e-mail públicos retornados por consulta de CNPJ e armazenados como contatos opcionais da empresa | Decisão do PI durante a especificação da F2 em 17/09/2026 | Candidato sem efeito sobre produto | Pós-MVP-4 |
| PRIV-010 | MVP-1 · SPEC-002/F2 aprovada | Retorno da API de CNPJ pode conter dados de sócios e representantes que não são usados pelo produto | Documentação e resposta observada da CNPJá durante a especificação da F2 em 17/09/2026 | Candidato sem efeito sobre produto | Pós-MVP-4 |
| PRIV-011 | MVP-1 · SPEC-004/F4 planejada | Arquivos enviados no cadastro da empresa podem conter dados pessoais ou documentos de terceiros | Decisão de incluir documentos durante a especificação iniciada na F2 em 17/09/2026; recorte transferido para F4 | Candidato sem efeito sobre produto | Pós-MVP-4 |

---

## 3. Resultado da revisão pós-MVP-4

_(preenchido somente após decisão explícita do PI)_

Para cada entrada, registrar um dos resultados:

- **promovida:** indicar o documento normativo e a decisão do PI;
- **adiada:** indicar o destino e o gatilho de retorno;
- **descartada:** indicar o motivo;
- **permanece em análise:** indicar a pendência objetiva.

Nenhuma promoção acontece apenas pela edição deste arquivo: o documento normativo correspondente deve ser alterado explicitamente.

---

## Referências

- [`prd/histórico/Politica_Privacidade_LGPD_Compliance.md`](prd/histórico/Politica_Privacidade_LGPD_Compliance.md) — insumo histórico, sem efeito sobre produto durante os MVPs.
- [`FORA-DE-ESCOPO.md`](FORA-DE-ESCOPO.md) — registra o tratamento não normativo durante os MVPs.
- [`prd/mvp/RASTREABILIDADE.md`](prd/mvp/RASTREABILIDADE.md) — mantém privacidade e proteção de dados fora do contrato de produto até decisão posterior.
