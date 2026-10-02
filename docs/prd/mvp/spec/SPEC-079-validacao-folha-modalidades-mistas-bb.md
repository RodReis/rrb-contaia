# SPEC-079 — Validação de folha BB com modalidades de conta mistas por CNAB 240

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F79
> **Issue:** [#93](https://github.com/RodReis/rrb-contaia/issues/93), sub-issue nativa do MVP-2 #31
> **Origem:** PRD §§3, 5.3, 7.1, 12, 13.2, 14, 15 e 16; complemento de F76/SPEC-076 a F78/SPEC-078 aprovado pelo PI em 02/10/2026
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 02/10/2026

## 1. Objetivo e resultado

Conferir localmente uma folha mensal líquida externa contra remessa BB CNAB 240 que contenha lotes de crédito em conta corrente, poupança e conta salário do próprio BB. Uma conferência pertence a uma empresa e competência; cada lote contém uma única modalidade, mas a remessa pode conter lotes de modalidades diferentes. A entrega é relatório com validade estrutural, correspondência individual e situação bancária observada, discriminadas por lote e modalidade e consolidadas para a conferência.

Não calcula folha, gera ou transmite remessa, executa pagamento nem produz título, proposta, baixa, estorno ou lançamento F68. Consistência da remessa não comprova aceite bancário, efetivação ou regularidade trabalhista.

## 2. Referência e universo da comparação

Reutilizar CSV/JSON `schemaVersion = "2"` das F77/F78 com `accountType` explícito por empregado: `CHECKING`, `SAVINGS` ou `SALARY`. A v1 permanece válida para as conferências homogêneas de corrente da F76; históricos v1/v2 não são reinterpretados. Os demais campos e regras individuais da v2 permanecem: uma empresa/competência, CPF único, líquido em centavos inteiros, destino e data para valor positivo, e líquido zero sem instrução. `bankCode = "001"` é exigido para pagamento positivo. Identificadores de conta são texto e preservam zeros significativos.

O universo é a referência integral e todos os lotes da remessa da mesma empresa e competência. Não selecionar apenas lotes convenientes para obter conclusão positiva. O tipo declarado por empregado deve corresponder à modalidade tecnicamente comprovada no lote da sua instrução. Lote com modalidades internas misturadas, empresa/competência divergente, referência parcial, tipo ausente/inválido ou CPF duplicado impede conclusão positiva. A correspondência exige identificadores comprovados do lote e item, CPF, tipo e destino completo, valor exato e data; nome, CPF ou valor isolados não resolvem ambiguidade. Pagamentos divididos e múltiplos contratos por CPF não são agregados nesta fatia.

## 3. Cobertura bancária e conclusão

Validar bytes posicionais, headers/trailers, identidade, convênio, conta pagadora, lotes, serviços, formas, segmentos, sequências, contagens e totais conforme pacote técnico oficial BB versionado e fixtures compatíveis por modalidade, segmento e ocorrência. O pacote registra URL, título, versão, consulta, hash e vigência/compatibilidade. Norma FEBRABAN isolada não substitui prova de aceitação BB. Em especial, serviço salarial `30` e forma FEBRABAN `04` não comprovam conta salário BB; não converter corrente `01`, poupança `05` ou cartão salário em conta salário por inferência.

Exibir diagnósticos comprovados por lote mesmo quando outro lote não tiver cobertura. A falta, contradição ou incompatibilidade de manual/fixtures para uma modalidade torna a verificação afetada `INDETERMINATE` e a conclusão global `INDETERMINATE`; não apresentar remessa inteira como validada. Erro conhecido em qualquer lote também impede conclusão global positiva. A prova bancária sem pacote/fixtures compatíveis é `not_run`, nunca PASS. Conclusão global positiva exige estrutura, correspondência e retorno, quando existente, comprovados para todo o universo.

## 4. Retornos, evidência e acesso

Vincular retornos à remessa e a cada lote/item somente pelos identificadores cobertos. Preservar ocorrências, ordem e evidência temporal; distinguir rejeição, aceite/agendamento e efetivação, sem tratar agendamento como pagamento. Ocorrência desconhecida, vínculo ambíguo ou sequência conflitante sem resolução comprovada produz `INDETERMINATE` na parte afetada e na conclusão global. Reimportação idêntica no mesmo contexto é idempotente e registra a tentativa; nova entrada ou pacote cria revisão imutável. Preservar originais, hashes, versões, diagnósticos, retornos e histórico append-only.

Aplicam-se I-1/I-2 (tenant, empresa, carteira e RLS), I-3/I-4 (centavos e determinismo), I-5 (sem ato externo), I-6/I-7 (evidência e auditoria), I-9 (idempotência), I-11 (datas civis e instantes em `America/Sao_Paulo`) e I-12 (reprodução histórica). Papéis seguem F76–F78; `auditor_readonly` não modifica evidências. Auditar importação, comparação, retorno, bloqueio, reprocessamento e download com ator, contexto, instante, `correlationId`, pacote e resultado. Erros usam código estável e `application/problem+json`.

## 5. Interface e aceite

Ampliar a conferência de folha em Financeiro para identificar remessa mista, empresa, competência, versões, originais, cobertura, resultados por lote/modalidade e por empregado, divergências por campo, histórico e conclusão global. Mostrar resultados parciais comprovados junto ao `INDETERMINATE` global. Conteúdo e fluxo seguem `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/`; aparência e comportamento seguem `docs/FRONTEND.md`, `docs/DESIGN-SYSTEM.md` e `docs/design-system/`. Cobrir vazio, carregando, entrada inválida, cobertura ausente, estrutura inválida, divergência, consistente, retorno pendente/rejeitado/agendado/efetivado, conflito, `INDETERMINATE`, erro e acesso negado. Provar CLARO/ESCURO, responsividade, teclado, foco, contraste, zoom e comparação visual/E2E conforme `docs/FRONTEND.md` §20.1, com `frontend-design` e `impeccable`.

Critérios: (1) CSV/JSON v2 equivalentes com tipos mistos e compatibilidade histórica v1/v2; (2) lotes homogêneos de modalidades distintas, mesma empresa/competência e totais íntegros; (3) tipo divergente, lote misto, referência parcial, empregado ausente/extra, líquido zero pago e CPF duplicado sem falso positivo; (4) cobertura ausente em conta salário com diagnósticos parciais e conclusão global `INDETERMINATE`; (5) retorno correlacionado por lote/item, repetição idempotente, ambiguidade e histórico preservado; (6) isolamento, readonly e ausência de efeito F68; (7) provas de regras, banco, tela, E2E e visual rastreáveis por SPEC/issue conforme `docs/TESTING.md`.

## 6. Fora de escopo e destino

| Fora desta fatia | Destino e gatilho |
|---|---|
| Arquivos com empresas ou competências misturadas | MVP-2: seleção de lotes em arquivos mistos de folha; isolamento e universo de comparação aprovados. |
| Modalidades diferentes dentro do mesmo lote | MVP-2: validação intralote de folha; manual BB, fixtures e regra de correspondência aprovados. |
| Pagamentos divididos ou múltiplos contratos por CPF | MVP-2: correspondência agregada de folha externa; chaves e regras aprovadas. |
| Crédito para outros bancos e outros tipos de folha | MVP-2: modalidades e tipos adicionais com contratos de origem, manuais e fixtures próprios. |
| Cálculo, empregados, rubricas, encargos e eSocial | MVP-3: RF-05/folha e departamento pessoal. |
| Geração, manutenção, transmissão e execução bancária | MVP-2: integração bancária de folha própria; produção após MVP-4. |
| Títulos, propostas, baixas e contabilização da folha | MVP-2: integração financeiro-contábil de folha com revisão e vínculos próprios. |

## 7. Decisões do PI

PI aprovou em 02/10/2026: F79/SPEC-079 para arquivo misto **somente por tipos de conta**, uma empresa e competência, um tipo por lote, referência v2 com `accountType` por empregado e diagnóstico parcial com conclusão global `INDETERMINATE` quando faltar cobertura em qualquer modalidade. Questões de produto abertas: **nenhuma**. Aprovação documental não presume cobertura operacional BB.
