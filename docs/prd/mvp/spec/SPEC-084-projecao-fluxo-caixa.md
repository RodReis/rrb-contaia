# SPEC-084 — Projeção de fluxo de caixa 30/60/90 dias

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F84
> **Issue:** [#116](https://github.com/RodReis/rrb-contaia/issues/116)
> **Estado:** aprovada pelo PI em 12/10/2026
> **Tamanho:** Grande
> **PRD:** §§3, 5.3, 7.1, 12, 14, 15 e 16

## 1. Resultado observável

Consultar o saldo de caixa projetado acumulado em 30, 60 e 90 dias, por empresa autorizada e no consolidado do escritório. A projeção parte dos saldos bancários informados pela capacidade própria de Open Finance do MVP-2 e soma as parcelas F68 a receber e subtrai as parcelas F68 a pagar ainda abertas, conforme vencimento e saldo nominal registrados.

Os horizontes são cumulativos: o saldo em 60 dias inclui o fluxo considerado em 30 dias; o saldo em 90 dias inclui os fluxos dos 90 dias. A consulta mostra data-base, instante e cobertura dos saldos bancários, saldo inicial, entradas, saídas, saldo projetado e acesso às parcelas que compõem os valores.

Parcelas F68 já vencidas e ainda abertas são consideradas fluxo imediato dentro do primeiro horizonte de 30 dias e aparecem identificadas como vencidas. Vencimentos de hoje também pertencem ao primeiro horizonte. Os períodos usam datas civis em `America/Sao_Paulo`.

## 2. Fonte e cálculo

- F68 é a autoridade para compromisso, direção, parcela, vencimento, baixa, estorno, cancelamento e saldo aberto nominal.
- A capacidade própria de Open Finance é a autoridade para saldos bancários normalizados e sua data/hora de referência. A F84 depende dessa capacidade; não implementa consentimento, conexão ou coleta bancária.
- Cada projeção usa saldos bancários acessíveis na data-base da consulta e o conjunto de parcelas F68 abertas na mesma referência. A referência de saldo e sua versão devem aparecer na consulta para permitir reprodução.
- Para cada horizonte, somam-se uma vez os saldos abertos de parcelas a receber com vencimento até o limite do horizonte e subtraem-se os de parcelas a pagar. Parcela vencida é tratada como vencendo na data-base para a projeção, sem alterar seu vencimento de origem.
- Valores são BRL em centavos inteiros. Não há conversão de moeda, atualização por juros, multa, desconto ou probabilidade de recebimento/pagamento.

A conta projetada é: saldo bancário inicial coberto + recebíveis F68 elegíveis − pagáveis F68 elegíveis. Transações bancárias já refletidas no saldo inicial não são somadas novamente como fluxo futuro. A F84 não faz conciliação entre transação bancária e parcela F68.

## 3. Visões, cobertura e acesso

A tela separa entradas, saídas e saldo projetado para cada horizonte, com detalhe das contas bancárias e parcelas consideradas. Oferece visão de uma empresa autorizada e consolidado do escritório, cuja composição é somente a soma das empresas que o usuário pode acessar.

Quando faltar conta autorizada, saldo, referência de atualização ou cobertura íntegra de F68, a projeção é apresentada como **parcial**, com identificação das fontes ausentes ou desatualizadas. O valor parcial não pode ser apresentado como total completo. A F84 consome o estado de cobertura reportado pelas capacidades de origem; não cria regras de consentimento nem muda o estado bancário.

Aplicam-se as permissões de leitura financeira e os limites de tenant, carteira e empresa da F68 e da capacidade bancária. Filtros, detalhes e consolidados nunca incluem dados não autorizados. A consulta é somente leitura: não altera conta, título, parcela, baixa, lançamento, consentimento ou transação.

Erros seguem códigos estáveis e `application/problem+json` de `docs/ARCHITECTURE.md` e `docs/CONVENTION.md`.

## 4. Invariantes

- Isolar todos os resultados por tenant, carteira e empresa autorizada; aplicar o mesmo limite a totais, detalhes e exportações.
- Usar somente saldos bancários da capacidade de Open Finance e parcelas/saldos F68; cada origem permanece autoridade de seu dado.
- Usar centavos inteiros, datas civis e cálculo determinístico, sem relógio oculto, float, estimativa ou mutação financeira.
- Os horizontes são cumulativos; cada parcela aberta compõe cada horizonte aplicável uma vez, e cada conta bancária entra uma vez no saldo inicial.
- Cobertura ausente ou desatualizada produz estado parcial explícito, nunca uma afirmação de completude.
- A consulta não paga, recebe, baixa, estorna, cancela, contabiliza, cria consentimento ou inicia integração bancária.

## 5. Contrato de UI

Usar `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/` como referência de conteúdo e hierarquia da área financeira. A tela desta fatia inclui os horizontes acumulados de 30/60/90 dias, saldo inicial, entradas, saídas, saldo projetado, data/referência das fontes, estado de cobertura e detalhamento das contas e parcelas incluídas. O protótipo não prevalece sobre `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md`.

Cobrir carregamento, vazio, dados encontrados, resultado parcial, fonte ausente/desatualizada, falha recuperável e acesso negado. Implementar temas CLARO e ESCURO; provar 375/768/1280/1536 px, teclado, foco, contraste, zoom, comparação com protótipo, estados e acabamento conforme `docs/FRONTEND.md` §20.1. Aplicar `frontend-design`, `impeccable` e smoke ao vivo com Playwright.

## 6. Critérios de aceite

1. Os saldos em 30, 60 e 90 dias são cumulativos e fecham em centavos a partir do saldo bancário inicial e das entradas/saídas F68 elegíveis.
2. Vencimento na data-base e vencimento futuro até cada limite entram uma vez no horizonte correspondente; parcela vencida e ainda aberta entra como fluxo imediato no horizonte de 30 dias e permanece identificada.
3. Baixa parcial, quitação, estorno e cancelamento refletem o saldo aberto F68 da referência; parcelas sem saldo não entram.
4. Repetir a consulta com as mesmas versões de saldo bancário e eventos F68 reproduz valores e composição idênticos.
5. Ausência ou desatualização de fontes é sinalizada como parcial; o consolidado equivale à soma das empresas autorizadas incluídas e não atravessa tenant/carteira.
6. A consulta não produz mutações F68, contábeis, bancárias ou de consentimento.
7. Cobrir regras, banco, tela e E2E aplicáveis, isolamento, ambos os temas, responsividade e acessibilidade, com evidência rastreável por F84/issue conforme `docs/TESTING.md`.

## 7. Fora de escopo e destinos

| Fora desta fatia | Destino nominal e gatilho |
|---|---|
| Consentimento, conexão, coleta e normalização de Open Finance | Fatia própria do MVP-2, pré-requisito da F84, sob contrato bancário normalizado aprovado. |
| Conciliação entre movimento bancário e parcela F68; baixa automática | Fatias próprias de conciliação e integração financeira, com regras e aprovação específicas. |
| ITP, Pix, pagamentos, recebimentos ou qualquer efeito externo | Fatias próprias, com parceiro, autorização e critérios aprovados; produção somente após MVP-4. |
| Projeção probabilística, recorrências não registradas na F68, juros, multa, desconto e atualização futura | Capacidades próprias do MVP-2, após fonte, regra e recorte aprovados. |
| Novas moedas, conversão ou atualização de câmbio | Capacidade própria, com fontes e regra de conversão aprovadas. |

## 8. Decisões do PI e gate documental

PI aprovou em 12/10/2026: F84/SPEC-084 cobre projeção acumulada de 30/60/90 dias por empresa e consolidada no escritório; usa saldos do Open Finance por uma dependência própria e parcelas F68; fluxo vencido e aberto entra imediatamente no horizonte de 30 dias; cobertura incompleta é apresentada como parcial. A integração Open Finance não pertence à F84. Questões de produto abertas: **nenhuma**.
