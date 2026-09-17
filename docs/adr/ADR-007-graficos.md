# ADR-007 — Biblioteca de gráficos (resolve P-01)

- **Status:** Aceita · **Data:** 17/09/2026 · **Decisor:** PI
- **Resolve:** pendência **P-01** de [`DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md) §8

## Contexto
O protótipo **não tem um único gráfico**: toda "visualização" é `<div>` com largura percentual. O PRD exige dashboard consolidado, KPIs e DRE gerencial. `CLAUDE.md` proíbe componente e gráfico nativo.

## Decisão
**Recharts via `shadcn/ui charts`**. Cor de série exclusivamente por token (`--chart-1…n`), definida nos dois temas.

## Consequências
- Gráfico herda o vocabulário de token do design system; nenhum hex literal.
- O bloqueio de fatia por P-01 deixa de existir: dashboard e relatórios podem ser especificados.
- Gráfico entra por `next/dynamic` — não pesa no bundle inicial ([`FRONTEND.md`](../FRONTEND.md) §15).

## Regras que acompanham a decisão
- **Todo gráfico tem alternativa textual** (tabela equivalente ou `aria-label` descritivo). Gráfico não é o único caminho para o número.
- **Cor nunca é o único diferenciador de série.**
- Valor monetário no gráfico usa a mesma formatação da tabela.
- Proibido `<canvas>` à mão, SVG improvisado e barra de `<div>` percentual.

## Riscos
- Recharts é pesado em gráfico com muitos pontos: acima de ~2.000 pontos, agregar no servidor antes de plotar.

## Alternativas descartadas
- Tremor: mais pronto para KPI, menos aderente ao token do shadcn — exigiria camada de adaptação.
