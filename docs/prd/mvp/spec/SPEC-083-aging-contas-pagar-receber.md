# SPEC-083 — Aging de contas a pagar e a receber

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F83
> **Estado:** aprovada pelo PI em 12/10/2026
> **Tamanho:** Médio
> **Issue:** [#115](https://github.com/RodReis/rrb-contaia/issues/115)
> **PRD:** §§3, 5.3, 7.1, 12, 14, 15 e 16

## 1. Resultado observável

Consultar o envelhecimento dos saldos abertos de contas a pagar e a receber registrados na F68, por empresa ou consolidados no escritório, para uma data-base civil escolhida pelo usuário. Cada parcela com saldo aberto aparece uma vez, classificada em “A vencer”, “1–30 dias”, “31–60 dias”, “61–90 dias” ou “acima de 90 dias”. A visão mostra saldo aberto em centavos, quantidade de parcelas e acesso ao detalhe da parcela e do compromisso de origem.

A consulta é somente leitura. Não cria nem altera títulos, baixas, estornos ou lançamentos. Não calcula juros, multa, desconto, recebimentos futuros ou previsão de caixa. A projeção de fluxo de caixa de 30/60/90 dias tem destino próprio na F84/SPEC-084.

## 2. Fonte e cálculo

A fonte exclusiva é o histórico financeiro interno da F68. O relatório considera parcelas publicadas cujo saldo aberto reconstruído na data-base seja positivo. Liquidações parciais reduzem o saldo; estornos recompõem o saldo afetado; cancelamentos removem o saldo cancelado a partir do evento, sem apagar o histórico. Parcelas totalmente liquidadas ou sem saldo aberto não entram nas faixas.

A data-base é obrigatória e civil (`AAAA-MM-DD`), sem fuso. Para reconstruir o saldo daquele dia, são considerados os eventos F68 ocorridos até o fim daquele dia em `America/Sao_Paulo`, inclusive. O mesmo conjunto de eventos e a mesma data-base devem reproduzir o mesmo resultado, em conformidade com I-11 e I-12.

O vencimento igual ou posterior à data-base fica em “A vencer”. Para vencimento anterior, dias de atraso são a diferença entre a data-base e o vencimento civil, sem contagem inclusiva do dia do vencimento: de 1 a 30, 31 a 60, 61 a 90 e acima de 90 dias. A faixa pertence à parcela, não ao compromisso; o compromisso pode aparecer em faixas diferentes quando tem parcelas com vencimentos distintos.

Valores usam saldo aberto nominal da F68 em centavos inteiros. Juros e multa registrados como parte de uma baixa não aumentam o saldo nominal em aberto; descontos só reduzem esse saldo conforme a regra F68. Não há projeção ou atualização implícita.

## 3. Visões e acesso

A tela separa contas a pagar de contas a receber e oferece:

- visão de uma empresa autorizada;
- visão consolidada do escritório, agregando apenas empresas autorizadas no mesmo tenant/carteira;
- totais por faixa, quantidade de parcelas e saldo aberto;
- detalhamento das parcelas incluídas, com empresa, contraparte em snapshot, compromisso, vencimento, saldo e data-base aplicada.

O consolidado deve ser igual à soma das empresas efetivamente incluídas. Nenhum filtro, total, detalhe ou exportação pode incluir empresa, carteira ou tenant não autorizado. As permissões de leitura seguem o contrato de acesso financeiro da F68; papéis sem leitura não recebem dados pelo endpoint nem pela interface.

A consulta não introduz persistência financeira ou mutação de estado. Erros seguem os códigos estáveis e `application/problem+json` definidos em `docs/ARCHITECTURE.md` e `docs/CONVENTION.md`.

## 4. Invariantes

- Aplicar isolamento I-1/I-2 por tenant, carteira e empresa; consultas consolidadas obedecem à autorização de cada empresa.
- Usar centavos inteiros, datas civis, cálculo determinístico e eventos reversíveis da F68; não usar float nem relógio oculto.
- Uma parcela elegível pertence a exatamente uma faixa; totais consolidados não duplicam parcelas.
- A consulta não publica, baixa, cancela, estorna nem altera compromisso ou parcela.
- A auditoria e o acesso à origem seguem os registros e permissões aplicáveis da F68.

## 5. Contrato de UI

Usar `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/` como referência de conteúdo e hierarquia para contas a pagar, aging e contas a receber. A área desta fatia inclui seleção de data-base, empresa ou consolidado, alternância entre pagar/receber, totais por faixa e detalhe das parcelas. O protótipo não prevalece sobre `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md`.

Cobrir carregamento, vazio, data-base ausente/inválida, filtros sem resultado, dados encontrados, falha recuperável e acesso negado. Implementar temas CLARO e ESCURO e provar 375/768/1280/1536 px, navegação por teclado, foco, contraste, zoom, comparação com o protótipo e acabamento conforme `docs/FRONTEND.md` §20.1. Aplicar `frontend-design` e o passe final de `impeccable`; incluir smoke ao vivo com Playwright.

## 6. Critérios de aceite

1. Vencimento igual à data-base fica em “A vencer”; vencimento anterior classifica corretamente nos limites 1, 30, 31, 60, 61, 90 e 91 dias.
2. Cada parcela com saldo aberto aparece em uma faixa; parcelas sem saldo ficam fora; parcelas do mesmo compromisso podem cair em faixas distintas.
3. Baixas parciais, liquidação integral, estorno e cancelamento reproduzem o saldo correto em datas antes e depois dos eventos, inclusive no consolidado.
4. Totais por faixa e totais consolidados fecham em centavos com o detalhe, sem duplicidade ou inclusão de empresa não selecionada/autorizada.
5. Repetir a consulta com a mesma data-base e eventos reproduz exatamente as faixas e valores; nenhuma mutação F68 ou efeito externo ocorre.
6. Cobrir regras, banco, tela e E2E aplicáveis, permissões, isolamento, ambos os temas, responsividade e acessibilidade com evidência rastreável por F83/#115 conforme `docs/TESTING.md`.

## 7. Fora de escopo e destino

| Fora desta fatia | Destino nominal e gatilho |
|---|---|
| Projeção de fluxo de caixa por empresa e consolidada para 30/60/90 dias | MVP-2: F84/SPEC-084, com regras de previsão e fontes aprovadas em fatia própria. |
| Open Finance, saldos bancários, webhooks e consentimento | MVP-2: fatia própria de Open Finance com contrato bancário e consentimento aprovados. |
| ITP, Pix, conciliação e baixa automática | MVP-2: fatias próprias, com parceiros, autorização e critérios aprovados. |
| Atualização financeira de títulos, juros, multa e desconto futuros | MVP-2: capacidade própria de atualização financeira aprovada; o aging só reflete o saldo já registrado na F68. |
| Criação, baixa, cancelamento, estorno e contabilização automática | Permanecem nos fluxos próprios da F68 e em futura integração financeiro-contábil aprovada. |

## 8. Decisões do PI e gate documental

PI aprovou em 12/10/2026: F83/SPEC-083 cobre somente aging; projeção de fluxo de caixa será F84/SPEC-084. O aging apresenta contas a pagar e receber por empresa e consolidado por escritório, aceita data-base consultada e usa “A vencer”, 1–30, 31–60, 61–90 e acima de 90 dias. Questões de produto abertas: **nenhuma**.