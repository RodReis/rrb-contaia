# docs/design-system/

Documentos operacionais do design system do ContaIA. O contrato e a governança estão em [`docs/DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md).

## Os quatro documentos

| Documento | Responde | Quando ler |
|---|---|---|
| [TOKENS.md](TOKENS.md) | *Que valor eu uso?* Cor, espaçamento, tipografia, raio, elevação, ícone, movimento, breakpoint — nos dois temas. | Antes de escrever qualquer CSS ou classe |
| [COMPONENTS.md](COMPONENTS.md) | *Esse componente já existe?* Catálogo do que existe, o que vem do shadcn e o que é nosso. | Antes de criar qualquer componente |
| [PATTERNS.md](PATTERNS.md) | *Como monto a tela?* Shell, cabeçalho, estados, formulário, acessibilidade, multi-tenant, tema. | Ao montar uma tela |
| [DEBITO.md](DEBITO.md) | *Por que o código não é igual ao protótipo?* Divergências decididas, com justificativa. | Quando o protótipo e o documento discordarem |

## Ordem de leitura

**Primeira tarefa de UI do projeto:** [`DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md) → TOKENS → PATTERNS → COMPONENTS.

**Card de UI no dia a dia:** COMPONENTS (o que existe) → PATTERNS (como compõe) → TOKENS (valores) → DEBITO (só se o protótipo discordar).

## Precedência

```
PRD  >  DESIGN-SYSTEM.md + docs/design-system/  >  docs/telas/  >  docs/prototipo/
```

- **PRD vence sempre.** Divergência com o PRD é `[FIX]`, não interpretação.
- **Estes documentos vencem o protótipo.** Onde divergem, a razão está em [DEBITO.md](DEBITO.md).
- **`docs/telas/` é referência**, não contrato. É protótipo gerado por ferramenta, com defeitos catalogados.
- **`docs/telas/DESIGN-CLARO.md` e `DESIGN-ESCURO.md` são direção original**, não contrato. Descrevem intenção; onde o protótipo não a cumpriu, [DEBITO.md](DEBITO.md) registra qual das duas prevalece.

## O que estes documentos não são

- **Não são `docs/FRONTEND.md`.** Aquele é o contrato de engenharia da interface (stack, tipagem, padrão de tela CRUD, prova por tela). Estes tratam de design: valor visual, componente, composição.
- **Não são SPEC.** Não definem o que uma tela faz. Definem como qualquer tela se parece e se comporta.
- **Não substituem o protótipo como referência de conteúdo.** Para saber *o que* uma tela mostra e em que ordem, a fonte continua sendo `docs/telas/` e o PRD.

## Manutenção

`docs/design-system/` é governança — mantida pelo **Cowork**, escrita direto na `main`, sem PR.

O **Code/Codex** não reescreve estes documentos. Quando a implementação revelar lacuna ou divergência nova:

- **Defeito óbvio de geração do protótipo** → normaliza, e propõe a linha em [DEBITO.md](DEBITO.md) pela PR do card.
- **Componente novo** → entra em [COMPONENTS.md](COMPONENTS.md) na mesma PR que o cria.
- **Decisão de produto que não existe em nenhum documento** → não inventa regra: pergunta ao PI (caso 1 de `CLAUDE.md`). As pendências já conhecidas estão em [DEBITO.md § Pendências](DEBITO.md#pendências-de-produto).

## Estado atual

Escrito a partir da análise de 23 telas de `docs/telas/`, de `docs/prototipo/index.html` e dos dois documentos de direção.

**Pendências abertas que bloqueiam fatia** (ver [DEBITO.md](DEBITO.md#pendências-de-produto)):

- **P-01** — biblioteca e tipos de gráfico ([detalhe](DEBITO.md#p-01-visualização-de-dados)). O protótipo não tem um único gráfico.
- **P-02** — colapso de tabela em mobile. Sem referência no protótipo.
