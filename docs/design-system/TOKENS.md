# TOKENS.md — ContaIA Design System

> **Normativo.** Fonte única dos valores de design. Nenhum valor de cor, espaçamento, tipografia ou raio pode entrar no código fora desta tabela.
> Onde este documento diverge do protótipo (`docs/telas/`), este documento vence — a divergência está justificada em [DEBITO.md](DEBITO.md).
> Onde diverge do PRD, o PRD vence e este documento está errado: abra `[FIX]`.

---

## 1. Regras invioláveis

1. **Proibido hex literal no código de aplicação.** Nada de `bg-[#10B981]`, `text-[#065F46]`, `style="color:#..."`. Cor entra por token.
2. **Proibida a escala default do Tailwind para cor semântica.** Nada de `bg-slate-50`, `text-emerald-700`, `bg-amber-100`, `border-red-200`. Essas classes existem no Tailwind mas são drift — ver [DEBITO.md §D-05](DEBITO.md#d-05).
3. **Todo token existe nos dois temas.** Claro e escuro são contrato. Um token que só funciona em um tema é bug.
4. **Token semântico, nunca literal.** `--color-success`, não `--color-green`. O nome diz o papel, não a aparência.
5. **Valor monetário, código fiscal e identificador** usam a família mono e `tabular-nums`. Sem exceção — ver §5.3.

---

## 2. Mecanismo de tema

Dois temas, **CLARO** e **ESCURO**, implementados em CSS custom properties com atributo no `<html>`:

```html
<html lang="pt-BR" data-theme="light">   <!-- ou "dark" -->
```

Este é o mecanismo que `docs/prototipo/index.html` já usa (com `localStorage` sob a chave `contaia-theme`) e é o que a implementação adota. As telas em `docs/telas/` usam `darkMode: "class"` do Tailwind com configs inline separados por arquivo; **esse padrão não é adotado** — ver [DEBITO.md §D-01](DEBITO.md#d-01).

Contrato de implementação:

- O tema é resolvido **antes da primeira pintura** (script bloqueante no `<head>`), para não haver flash de tema errado.
- Persistência em `localStorage['contaia-theme']`, com acesso dentro de `try/catch` — janela privada pode lançar.
- Sem preferência salva, o padrão é `light`. O sistema **não** segue `prefers-color-scheme` automaticamente sem decisão do PI.
- `data-theme` fica no elemento raiz, nunca em um wrapper interno: componentes em portal (toast, dialog) precisam herdar.

---

## 3. Cor

### 3.1 Vocabulário

Os tokens usam o vocabulário do **shadcn/ui**, fixado pelo PRD §14. Os configs do protótipo usam nomes Material Design 3 (`surface-container-highest`, `on-surface-variant`); a tabela de equivalência M3 → shadcn está em [DEBITO.md §D-02](DEBITO.md#d-02) e serve para ler o protótipo, não para escrever código novo.

### 3.2 Paleta — tema CLARO

Derivada do config das 17 telas claras consistentes de `docs/telas/`.

| Token shadcn | Valor | Papel |
|---|---|---|
| `--background` | `#f9f9ff` | Canvas base da aplicação |
| `--foreground` | `#101c2d` | Texto principal |
| `--card` | `#ffffff` | Superfície de card, tabela, painel |
| `--card-foreground` | `#101c2d` | Texto sobre card |
| `--popover` | `#ffffff` | Dropdown, popover, menu |
| `--popover-foreground` | `#101c2d` | Texto sobre popover |
| `--primary` | `#101c2d` | Ação primária, header, navegação ativa |
| `--primary-foreground` | `#ffffff` | Texto sobre primário |
| `--secondary` | `#eff3ff` | Superfície recuada, sidebar, trilho de aba |
| `--secondary-foreground` | `#101c2d` | Texto sobre secundário |
| `--muted` | `#e6eeff` | Fundo sutil, header de tabela, chip neutro |
| `--muted-foreground` | `#45464d` | Texto secundário, label, metadado |
| `--accent` | `#dde9ff` | Hover de superfície, linha ativa |
| `--accent-foreground` | `#101c2d` | Texto sobre accent |
| `--destructive` | `#ba1a1a` | Erro, risco crítico, ação destrutiva |
| `--destructive-foreground` | `#ffffff` | Texto sobre destrutivo |
| `--border` | `#c6c6cd` | Borda de card, divisor de tabela |
| `--input` | `#c6c6cd` | Borda de campo de formulário |
| `--ring` | `#101c2d` | Anel de foco |

**`--primary` é `#101c2d`, não `#000000`.** O protótipo usa preto puro; a direção de design (`docs/telas/DESIGN-CLARO.md`) pede `#0F172A`. Adotamos `#101c2d` (o próprio `on-surface` do protótipo) por ser o valor que já aparece em todo o texto das telas. Justificativa em [DEBITO.md §D-03](DEBITO.md#d-03).

### 3.3 Paleta — tema ESCURO

Derivada do config das 3 telas dark carbon, que são **byte-idênticas entre si** — o único subconjunto totalmente consistente do protótipo.

| Token shadcn | Valor | Papel |
|---|---|---|
| `--background` | `#0f131c` | Canvas base |
| `--foreground` | `#dfe2ef` | Texto principal |
| `--card` | `#1c1f29` | Superfície de card, tabela, painel |
| `--card-foreground` | `#dfe2ef` | Texto sobre card |
| `--popover` | `#262a34` | Dropdown, popover, menu |
| `--popover-foreground` | `#dfe2ef` | Texto sobre popover |
| `--primary` | `#8ed5ff` | Ação primária, navegação ativa |
| `--primary-foreground` | `#00354a` | Texto sobre primário |
| `--secondary` | `#181b25` | Superfície recuada, sidebar |
| `--secondary-foreground` | `#dfe2ef` | Texto sobre secundário |
| `--muted` | `#1c1f29` | Fundo sutil, header de tabela |
| `--muted-foreground` | `#bdc8d1` | Texto secundário, label |
| `--accent` | `#262a34` | Hover de superfície, linha ativa |
| `--accent-foreground` | `#dfe2ef` | Texto sobre accent |
| `--destructive` | `#ffb4ab` | Erro, risco crítico |
| `--destructive-foreground` | `#690005` | Texto sobre destrutivo |
| `--border` | `#3e484f` | Borda de card, divisor |
| `--input` | `#3e484f` | Borda de campo |
| `--ring` | `#8ed5ff` | Anel de foco |

No escuro, `--primary` é um cyan claro sobre fundo escuro: **texto sobre primário é escuro** (`#00354a`), não branco. Componente que assume `text-white` sobre primário quebra no escuro.

### 3.4 Escala de status do Semáforo Fiscal

O núcleo semântico do produto. Um token por estado, com tríade superfície / texto / indicador, nos dois temas.

| Estado | Token | CLARO (bg / fg / dot) | ESCURO (bg / fg / dot) |
|---|---|---|---|
| **Conforme** — reconciliado, aceito, assinatura válida | `success` | `#ecfdf5` / `#065f46` / `#10b981` | `rgba(78,222,163,.12)` / `#4edea3` / `#4edea3` |
| **Atenção** — vencimento próximo, D-3, pendência | `warning` | `#fffbeb` / `#92400e` / `#f59e0b` | `rgba(255,193,116,.12)` / `#ffc174` / `#ffc174` |
| **Crítico** — multa iminente, rejeição Sefaz, divergência | `danger` | `#fef2f2` / `#991b1b` / `#ef4444` | `rgba(255,180,171,.12)` / `#ffb4ab` / `#ffb4ab` |
| **Informação** — processamento em lote, telemetria | `info` | `#eff6ff` / `#1e40af` / `#1855b7` | `rgba(142,213,255,.12)` / `#8ed5ff` / `#8ed5ff` |
| **IA / automação** — sugestão de máquina, classificação automática | `ai` | `#fef6da` / `#5a4300` / `#d6a40e` | `rgba(245,158,11,.12)` / `#f59e0b` / `#f59e0b` |

Regras:

- **`danger` e `destructive` são tokens distintos.** `destructive` é ação do usuário (botão Excluir); `danger` é estado do dado (empresa em risco). Podem compartilhar matiz, nunca papel.
- **`ai` é um estado, não uma decoração.** Só marca conteúdo produzido por máquina e ainda não confirmado por humano. Ver [PATTERNS.md §4](PATTERNS.md#4-procedência-de-ia-e-hitl).
- **`success` não existe no protótipo claro.** A maioria das telas renderiza "Conforme" em cinza, por falta do token. Isso é corrigido aqui — ver [DEBITO.md §D-04](DEBITO.md#d-04).
- **O par `success` × `ai` não pode colidir.** No protótipo, `secondary` (mostarda `#785a00`) faz os dois papéis no claro e vira verde no escuro. Separados aqui em dois tokens — ver [DEBITO.md §D-06](DEBITO.md#d-06).

### 3.5 Token de dado financeiro

Sinal de valor não é estado de conformidade. Positivo/negativo de moeda usa escala própria:

| Token | CLARO | ESCURO | Uso |
|---|---|---|---|
| `--value-positive` | `#065f46` | `#4edea3` | Crédito, saldo positivo, variação favorável |
| `--value-negative` | `#991b1b` | `#ffb4ab` | Débito, saldo negativo, variação desfavorável |
| `--value-neutral` | `#45464d` | `#bdc8d1` | Zero, não aplicável, valor de referência |

Um lançamento de débito **não** é um erro: renderizar débito com `danger` é bug de semântica.

---

## 4. Espaçamento

Base 4px. Escala do protótipo, mantida (é consistente em 17 de 18 telas claras e nas 3 escuras).

| Token | Valor | Uso |
|---|---|---|
| `space-xs` | `0.25rem` (4px) | Gap entre ícone e rótulo, padding de chip |
| `space-sm` | `0.5rem` (8px) | Padding de célula de tabela, gap de item de nav |
| `space-md` | `0.75rem` (12px) | Padding de card, gap entre campos |
| `space-lg` | `1.25rem` (20px) | Padding de seção, gap entre blocos funcionais |
| `space-xl` | `1.75rem` (28px) | Separação entre domínios de página |

Gutters e margens:

| Token | Mobile | Tablet | Desktop |
|---|---|---|---|
| `gutter` | `1rem` | `1.25rem` | `1.5rem` |
| `margin` | `1rem` | `1.5rem` | `2rem` |

As variantes `-tablet` existem só no config escuro do protótipo; aqui valem para os dois temas.

---

## 5. Tipografia

### 5.1 Famílias

| Família | Papel | Carregamento |
|---|---|---|
| **Geist** | Display, headline, valor numérico de destaque | `next/font/google`, pesos 400–700 |
| **Inter** | Corpo, UI, tabela, formulário | `next/font/google`, pesos 400–600 |
| **JetBrains Mono** | Código fiscal, moeda, identificador, hash | `next/font/google`, pesos 400–600 |

**JetBrains Mono é obrigatória e precisa ser carregada.** No protótipo, 11 telas aplicam ~1.971 classes `font-code-*` sem jamais buscar a fonte — todo CNPJ, chave de 44 dígitos e coluna monetária renderiza em fallback sans-serif, anulando o alinhamento óptico que justifica a mono. Ver [DEBITO.md §D-07](DEBITO.md#d-07).

Carregar via `next/font` (não `<link>` para Google Fonts): elimina FOUT, evita requisição externa em runtime e é o padrão do Next.js.

### 5.2 Escala

Uma escala só, para os dois temas. O protótipo tem duas escalas divergentes (claro tem `title-*` e não tem `body-lg`; escuro tem `body-lg`/`display-lg` e não tem `title-*`) — unificadas aqui pela escala clara, que cobre 18 das 21 telas, acrescida de `display-lg` e `body-lg` do escuro. Ver [DEBITO.md §D-08](DEBITO.md#d-08).

| Token | Tamanho / Altura | Peso | Tracking | Família | Uso |
|---|---|---|---|---|---|
| `display-lg` | 36 / 44 | 600 | -0.025em | Geist | Número herói, tela de acesso |
| `headline-lg` | 30 / 38 | 600 | -0.02em | Geist | H1 de página, valor de KPI |
| `headline-md` | 22 / 28 | 600 | -0.015em | Geist | H2 de seção |
| `headline-sm` | 18 / 24 | 600 | -0.01em | Geist | H3, título de card |
| `title-md` | 15 / 20 | 600 | -0.005em | Inter | Rótulo de ação, aba ativa |
| `title-sm` | 14 / 20 | 600 | -0.005em | Inter | Rótulo de botão, cabeçalho de campo |
| `body-lg` | 16 / 24 | 400 | 0 | Inter | Texto longo, termos, política |
| `body-md` | 14 / 20 | 400 | 0 | Inter | Corpo padrão, célula de tabela |
| `body-sm` | 13 / 18 | 400 | 0 | Inter | Texto de apoio, descrição |
| `label-md` | 12 / 16 | 500 | 0 | Inter | Rótulo de formulário, chip |
| `label-sm` | 11 / 14 | 500 | 0.02em | Inter | Header de tabela (uppercase), eyebrow |
| `code-sm` | 12 / 16 | 400 | 0 | JetBrains Mono | Moeda, CNPJ, conta contábil |
| `code-xs` | 11 / 14 | 400 | 0 | JetBrains Mono | Chave de acesso, hash, NSU, metadado |

Variantes mobile: `display-lg` → 28/36, `headline-lg` → 24/32, `headline-md` → 20/28.

### 5.3 Números tabulares

Todo elemento que renderiza moeda, quantidade, data, percentual ou identificador numérico aplica:

```css
font-variant-numeric: tabular-nums;
```

No Tailwind: `tabular-nums`. **`tabular-nums` não aparece uma única vez no protótipo**, embora os dois documentos de direção o exijam — colunas monetárias não alinham. Ver [DEBITO.md §D-09](DEBITO.md#d-09).

---

## 6. Raio de borda

| Token | Valor | Uso |
|---|---|---|
| `radius-sm` | `0.125rem` (2px) | Chip, badge, indicador de célula |
| `radius-md` | `0.375rem` (6px) | Botão, campo, aba, controle segmentado |
| `radius-lg` | `0.5rem` (8px) | Card, painel, tabela, modal |
| `radius-xl` | `0.75rem` (12px) | Shell de aplicação, overlay de página inteira |
| `radius-full` | `9999px` | Avatar, dot de status, pílula de contagem |

**`radius-full` é `9999px`.** Todas as 21 telas do protótipo declaram `full: 0.75rem`, o que faz ~390 avatares, dots e pílulas renderizarem como quadrados de canto 12px em vez de círculos. Corrigido aqui; é a divergência de maior superfície visual do protótipo. Ver [DEBITO.md §D-10](DEBITO.md#d-10).

Acima de `radius-xl` é proibido em controle de núcleo.

---

## 7. Elevação

Profundidade por borda e tonalidade, não por sombra pesada. No escuro, empilhamento tonal substitui sombra — sombra preta sobre fundo carbono não aparece.

| Nível | CLARO | ESCURO | Uso |
|---|---|---|---|
| 0 | `--background`, sem borda | `--background`, sem borda | Canvas |
| 1 | `--card` + `1px --border` + `0 1px 2px rgba(16,28,45,.04)` | `--card` + `1px --border` | Card, tabela, painel |
| 2 | `--card` + `1px --border` + `0 4px 6px -1px rgba(16,28,45,.06)` | `--accent` + `1px --border` | Hover, card interativo |
| 3 | `--popover` + `1px --border` + `0 10px 15px -3px rgba(16,28,45,.08)` | `--popover` + `1px --border` + `0 10px 15px -3px rgba(0,0,0,.5)` | Dropdown, popover |
| 4 | `--popover` + `1px --border` + `0 20px 25px -5px rgba(16,28,45,.1)` | `--popover` + `1px --border` + `0 20px 25px -5px rgba(0,0,0,.7)` | Modal, drawer |

Backdrop de overlay: `rgba(16,28,45,.6)` no claro, `rgba(0,0,0,.72)` no escuro, com `backdrop-blur: 4px`.

---

## 8. Ícones

- **Família:** Material Symbols Outlined, variante única. Nada de Rounded/Sharp misturado.
- **Tamanho:** escala fechada, não valor arbitrário. O protótipo usa 16 tamanhos px distintos em 1.045 ocorrências — ver [DEBITO.md §D-11](DEBITO.md#d-11).

| Token | Tamanho | Uso |
|---|---|---|
| `icon-xs` | 14px | Dentro de chip, metadado inline |
| `icon-sm` | 16px | Botão compacto, ação de linha de tabela |
| `icon-md` | 18px | Botão padrão, item de navegação |
| `icon-lg` | 20px | Ação de header, ícone de card |
| `icon-xl` | 28px | Estado vazio, ilustração de dropzone |

Ícone é decorativo por padrão (`aria-hidden="true"`). Ícone que carrega significado sozinho — botão só com ícone — precisa de rótulo acessível. Ver [PATTERNS.md §7](PATTERNS.md#7-acessibilidade).

---

## 9. Movimento

| Token | Valor | Uso |
|---|---|---|
| `duration-fast` | 150ms | Hover, mudança de cor |
| `duration-normal` | 250ms | Abertura de painel, transição de tema |
| `duration-slow` | 400ms | Entrada de overlay |
| `ease-out` | `cubic-bezier(.16,1,.3,1)` | Entrada de elemento |

Anima só `transform`, `opacity`, `background-color`, `border-color`. Nunca `width`, `height`, `top`, `left`.

`prefers-reduced-motion: reduce` zera duração e desliga animação em laço (`animate-ping`, `animate-pulse`) — obrigatório, não opcional.

Animação de estado ao vivo tem significado fixo:
- `animate-ping` — apenas estado **crítico ao vivo** que exige ação.
- `animate-pulse` — apenas **processamento em andamento**.
- Nunca os dois no mesmo elemento. Nunca como decoração. Nunca como skeleton (skeleton tem token próprio).

---

## 10. Breakpoints

| Nome | Faixa | Layout |
|---|---|---|
| mobile | `< 768px` | Coluna única. Sidebar vira drawer. Tabela colapsa em cards. |
| tablet | `768–1023px` | Trilho de ícones 64px. Tabela rola horizontalmente com header fixo. |
| desktop | `1024–1599px` | Sidebar 264px. Grid de 12 colunas. |
| wide | `≥ 1600px` | Painel duplo: documento fonte + destino lado a lado. |

Largura da sidebar é **264px**, alinhada ao `--sidebar` de `docs/prototipo/index.html`. O protótipo de telas usa `w-72` (288px) no shell canônico e `w-64` (256px) no portal — ver [DEBITO.md §D-12](DEBITO.md#d-12).

---

## Referências

- [DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md) — contrato e governança
- [COMPONENTS.md](COMPONENTS.md) — catálogo de componentes
- [PATTERNS.md](PATTERNS.md) — padrões de composição
- [DEBITO.md](DEBITO.md) — divergências do protótipo e justificativas
- `docs/telas/DESIGN-CLARO.md`, `docs/telas/DESIGN-ESCURO.md` — direção original (não é contrato)
