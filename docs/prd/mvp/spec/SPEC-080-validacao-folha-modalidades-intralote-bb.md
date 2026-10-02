# SPEC-080 — Validação de folha BB com modalidades de conta no mesmo lote

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F80
> **Issue:** [#94](https://github.com/RodReis/rrb-contaia/issues/94), sub-issue nativa do MVP-2 #31
> **Origem:** PRD §§3, 5.3, 7.1, 12, 13.2, 14, 15 e 16; complemento intralote da F79/SPEC-079 aprovado pelo PI em 02/10/2026
> **Tamanho:** Grande — estende comparação, cobertura bancária, retorno e interface existentes, sem criar executor
> **Estado:** aprovada pelo PI em 02/10/2026

## 1. Objetivo e comportamento observável

Conferir localmente a folha mensal líquida externa contra remessa BB CNAB 240 em que instruções de tipos de conta distintos apareçam **no mesmo lote**. A conferência pertence a uma empresa e competência e cobre conta corrente, poupança e conta salário do próprio BB. O usuário importa referência CSV/JSON e remessa, consulta a comparação por empregado e lote, anexa retornos e obtém relatório que separa validade estrutural, correspondência individual e situação bancária observada.

A F79 já cobre modalidades mistas entre lotes homogêneos. A F80 acrescenta apenas a análise intralote, sem reinterpretar conferências históricas F76–F79. A entrega não calcula folha, gera/transmite remessa, executa pagamento ou produz título, proposta, baixa, estorno ou lançamento F68. Consistência local não comprova aceite nem efetivação bancária.

## 2. Referência e universo de comparação

Reutilizar `schemaVersion = "2"` CSV/JSON da F79, com `accountType` por empregado (`CHECKING`, `SAVINGS`, `SALARY`), CPF único, valor textual exato convertido em centavos, destino e data para líquido positivo, líquido zero sem instrução, `bankCode = "001"` e identificadores bancários textuais. A v1 continua válida apenas nos fluxos já cobertos de conta corrente; não migrar nem reclassificar históricos. O universo é a referência integral e todos os lotes da remessa da mesma empresa e competência; não selecionar subconjunto conveniente.

Identificar cada instrução pelo lote/item e pelos campos comprovados no pacote técnico. Comparar CPF, tipo de conta declarado, destino completo, valor exato e data prevista. Tipo não comprovado no registro não é inferido pelo número da conta, nome, valor ou escolha do usuário. CPF duplicado, empregado ausente ou extra, líquido zero pago, referência parcial e divergência conhecida impedem conclusão positiva. Pagamentos divididos e múltiplos contratos por CPF continuam fora desta fatia.

## 3. Cobertura BB e classificação do lote

O [manual público de particularidades BB CNAB 240, versão julho/2019](https://bb.com.br/docs/pub/emp/empl/dwn/PgtVer03BB.pdf), consultado em 02/10/2026, apresenta uma forma de lançamento no cabeçalho do lote (posições 12–13) e lista `01` para corrente e `05` para poupança. Esse material não comprova representação ou aceitação de modalidades diferentes dentro do mesmo lote, nem conta salário BB. Serviço salarial `30`, forma FEBRABAN `04` e semelhança de campos não suprem a prova BB.

Versionar pacote técnico BB com URL, título, versão, consulta, hash, vigência/compatibilidade, posições, serviço, forma, segmentos/complementos e ocorrências, além de fixtures compatíveis de remessa e retorno que demonstrem como cada instrução intralote declara sua modalidade. Só concluir positivamente a estrutura, a correspondência de tipo e os retornos com cobertura BB específica para a combinação real. Ausência, conflito ou incompatibilidade dessa evidência torna a verificação afetada e a conclusão global `INDETERMINATE`; prova bancária sem pacote/fixtures é `not_run`, nunca PASS.

Preservar diagnósticos comprovados de campos, empregados e lotes mesmo com conclusão indeterminada. Contradição demonstrável entre o cabeçalho e instruções sob regra coberta é divergência estrutural, não sucesso nem simples ausência de cobertura. Erro conhecido em qualquer item impede conclusão global positiva. Validar bytes posicionais, identidade, convênio, conta pagadora, sequência, contagens e totais apenas conforme a versão coberta; não reescrever arquivo, trocar modalidade ou oferecer correção bancária automática.

## 4. Retornos, histórico e invariantes globais tocados

Correlacionar retorno à remessa e ao lote/item somente por identificadores cobertos. Preservar rejeição, aceite/agendamento e efetivação quando a ocorrência for comprovada; agendamento não é pagamento. Vínculo ambíguo, ocorrência desconhecida ou sequência sem resolução documentada fica `INDETERMINATE` na parte afetada e na conclusão global. Reimportação idêntica no mesmo contexto reutiliza evidência e registra a tentativa; nova origem ou pacote cria revisão imutável. Originais, hashes, versões, diagnósticos e eventos permanecem reproduzíveis.

| Invariante de `docs/CONVENTION.md` §2 | Aplicação |
|---|---|
| I-1/I-2 | Isolamento por tenant, empresa e carteira; consulta sem contexto não retorna dados. |
| I-3/I-4 | Valores em centavos e comparação determinística, sem float ou cálculo por LLM. |
| I-5 | Relatório sem ato externo ou autorização de pagamento. |
| I-6/I-7 | Evidência trabalhista, revisões e auditoria append-only, sem apagamento. |
| I-9 | Importação e reprocessamento idempotentes, ainda que sem efeito externo. |
| I-11 | Competência e datas civis; instantes exibidos em `America/Sao_Paulo`. |
| I-12 | Resultado histórico reproduzido com entradas e pacote congelados. |

I-8 não introduz regra tributária; I-10 não é acionado. Papéis seguem F76–F79; `auditor_readonly` não modifica evidência. Auditar importação, comparação, retorno, bloqueio, reprocessamento e download com ator, contexto, instante, `correlationId`, versões e resultado. Erros usam código estável e `application/problem+json`.

## 5. Interface e critérios de aceite

Ampliar a conferência de folha em Financeiro, usando `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/code.html`, sua `screen.png` e `docs/telas/prototipo/index.html` para conteúdo e fluxo. Aparência e comportamento seguem `docs/FRONTEND.md`, `docs/DESIGN-SYSTEM.md` e `docs/design-system/`. Mostrar empresa, competência, originais, pacote, tipo declarado e tipo comprovado por instrução, divergências, resultado por empregado/lote e conclusão global. Mostrar explicitamente o motivo da cobertura ausente. Estados: vazio, carregando, entrada inválida, cobertura ausente, estrutura divergente, comparação consistente, retorno pendente/rejeitado/agendado/efetivado, conflito, `INDETERMINATE`, erro e acesso negado. Provar temas CLARO/ESCURO, 375/768/1280/1536 px, teclado, foco, contraste, zoom e comparação visual/E2E conforme `docs/FRONTEND.md` §20.1, com `frontend-design` e `impeccable`.

1. CSV/JSON v2 equivalentes aceitam tipos distintos por empregado; v1/v2 e resultados históricos F76–F79 permanecem compatíveis.
2. Comparação individual exata detecta CPF, tipo, destino, centavos e data divergentes, duplicidade, ausências, extras e líquido zero pago; totais iguais não ocultam divergências.
3. Sem manual BB e fixtures intralote compatíveis, diagnósticos conhecidos aparecem, mas verificação afetada e resultado global são `INDETERMINATE`; a prova bancária é `not_run`.
4. Com pacote compatível, provar casos positivos e negativos de estrutura, modalidade por instrução, cabeçalho, contagens, totais e retorno. Contradição comprovada é divergência, nunca validação positiva.
5. Retornos desconhecidos/ambíguos, reimportação concorrente, revisões, isolamento, readonly e ausência de efeito F68 têm provas rastreáveis de regras e banco.
6. Tela e E2E cobrem estados, dois temas e prova visual conforme `docs/TESTING.md` e `docs/FRONTEND.md`.

## 6. Fora de escopo e destino

| Fora desta fatia | Destino nominal e gatilho |
|---|---|
| Empresas ou competências misturadas no arquivo | MVP-2: seleção de lotes em arquivos mistos de folha; isolamento e universo aprovados. |
| Pagamentos divididos ou múltiplos contratos por CPF | MVP-2: correspondência agregada de folha externa; chaves e regra de agregação aprovadas. |
| Outros bancos, adiantamento, 13º, férias e rescisão | MVP-2: modalidades e tipos adicionais de validação; contratos de origem, manuais e fixtures próprios. |
| Cálculo de folha, empregados, rubricas, encargos e eSocial | MVP-3: RF-05/folha e departamento pessoal. |
| Geração, manutenção, transmissão e execução bancária | MVP-2: integração bancária de folha própria; produção somente após MVP-4. |
| Títulos, propostas, baixas e contabilização da folha | MVP-2: integração financeiro-contábil de folha com origens, revisão e vínculos próprios. |

## 7. Decisões do PI e gate documental

PI aprovou em 02/10/2026: F80/SPEC-080 para modalidades diferentes **dentro do mesmo lote** BB, usando referência v2 e diagnóstico por empregado/lote. Sem prova BB específica, resultado global `INDETERMINATE` com diagnósticos conhecidos visíveis; contradição comprovada é divergência estrutural. Questões de produto abertas: **nenhuma**. A aprovação documental não presume cobertura operacional BB.
