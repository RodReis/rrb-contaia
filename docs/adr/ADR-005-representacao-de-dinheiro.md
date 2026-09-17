# ADR-005 — Representação de dinheiro

- **Status:** Aceita · **Data:** 17/09/2026 · **Decisor:** PI

## Contexto
`CLAUDE.md` proíbe float para dinheiro. Falta decidir a representação no banco, no contrato e no front. Erro de centavo em apuração tributária é erro de declaração ao fisco.

## Decisão
**`BIGINT` em centavos**, de ponta a ponta: banco, DTO, contrato e estado do front. Alíquota e percentual em **centésimos de ponto percentual** (`1550` = 15,50%). A máscara existe apenas na exibição. Arredondamento é decisão explícita e testada da função de cálculo.

## Consequências
- Nenhuma conversão de ponto flutuante no caminho do dinheiro; soma e comparação são exatas.
- Serialização JSON trivial (inteiro), sem `Decimal` no cliente.
- `paraCentavos()` / `deCentavos()` são funções puras testadas, únicas responsáveis pela conversão.

## Riscos
- Rateio e alíquota exigem cuidado de arredondamento: a regra de arredondamento fica na função de cálculo, com teste de borda (meio centavo, divisão não exata).
- `BIGINT` em JS exige atenção ao limite de `Number.MAX_SAFE_INTEGER` — irrelevante na escala de valores fiscais, mas o contrato trafega inteiro, não `BigInt` serializado.

## Alternativas descartadas
- `NUMERIC(19,4)`: precisão nativa e soma trivial em SQL, mas vira string no JS e arrasta uma biblioteca decimal para a aplicação inteira.
