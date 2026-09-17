# DEBITO.md — Divergências entre protótipo e Design System

> **Este documento não é uma lista de tarefas.** É o registro de onde o design system **deliberadamente diverge** do protótipo em `docs/telas/`, e por quê.
> Quando a implementação encontrar o protótipo fazendo X e o [TOKENS.md](TOKENS.md)/[COMPONENTS.md](COMPONENTS.md) mandando Y, a resposta está aqui. **Segue-se o documento, não o protótipo.**
> Nenhum item daqui é decisão pendente: todos foram decididos. Item que exige decisão nova do PI está na seção [Pendências](#pendências-de-produto) e **bloqueia** a fatia correspondente.

**Método.** Os achados vêm de leitura direta dos 23 arquivos `docs/telas/*/code.html` e de `docs/prototipo/index.html`, com contagem por `grep`/parse dos blocos `tailwind.config`. Contagens são verificáveis; onde há estimativa, está marcada.

---

## Mapa do protótipo

| Grupo | Telas | Situação |
|---|---|---|
| **Claro consistente** | 17 telas | Config de cor/espaçamento/tipografia idêntico. É a base do tema CLARO. |
| **Escuro consistente** | 3 telas (`..._tema_dark_carbon`) | Configs **byte-idênticos** entre si. Único subconjunto totalmente coerente do protótipo. É a base do tema ESCURO. |
| **Fora do sistema** | 3 telas | `administra_o_da_plataforma_super_admin_rf_08`, `governan_a_corporativa_kpis_..._redesenhado`, `plataforma_de_agentes_de_ia_rf_07`. Escritas em Tailwind default. Ver [D-05](#d-05). |
| **Sem config** | 2 telas | `contaia_logo_dark_carbon_edition`, `logo_oficial_contaia_...` — assets de logo, não telas. |
| **Vazia** | 1 pasta | `contaia_enterprise_core/` não tem `code.html`. |
| **Casca do catálogo** | `docs/prototipo/index.html` | Navegador de protótipos, não tela de produto. Paleta própria. Ver [D-13](#d-13). |

**São 2 temas: CLARO e ESCURO.** As paletas divergentes listadas acima não são temas adicionais — são drift a normalizar.

---

## Divergências decididas

### D-01
**Mecanismo de tema: `data-theme` + CSS variables, não `darkMode:"class"` com config por arquivo.**

*Protótipo:* cada `code.html` traz seu próprio `<script id="tailwind-config">` inline com o tema inteiro. As 3 telas escuras declaram `darkMode: "class"` e `<html class="dark">`, mas **nenhuma tela do protótipo usa uma única classe `dark:`** — o tema vem de config separado, não de variante.

*Decisão:* tema por `data-theme="light|dark"` no `<html>`, com tokens em CSS custom properties. É o mecanismo que `docs/prototipo/index.html` já implementa (com `localStorage['contaia-theme']` em `try/catch`).

*Motivo:* config inline por arquivo não existe em Next.js — há um `tailwind.config` só. Sem isso, os dois temas não podem coexistir na mesma aplicação, que é o requisito.

---

### D-02
**Vocabulário de token: shadcn/ui, não Material Design 3.**

*Protótipo:* nomes M3 (`surface-container-highest`, `on-surface-variant`, `inverse-primary`, `on-secondary-fixed-variant`).

*Decisão:* vocabulário shadcn (`--background`, `--card`, `--muted`, `--accent`, `--destructive`). PRD §14 fixa shadcn/ui, "nada de componente nativo".

*Motivo:* componente shadcn instalado espera essas variáveis. Manter nomes M3 exigiria patch manual em todo componente novo, para sempre.

**Tabela de leitura M3 → shadcn** (para interpretar o protótipo, não para escrever código):

| M3 (protótipo) | shadcn (implementação) |
|---|---|
| `surface`, `background` | `--background` |
| `on-surface`, `on-background` | `--foreground` |
| `surface-container-lowest` | `--card` / `--popover` |
| `surface-container-low` | `--secondary` |
| `surface-container` | `--muted` |
| `surface-container-high` | `--accent` |
| `surface-container-highest` | `--accent` (estado mais forte) |
| `on-surface-variant` | `--muted-foreground` |
| `primary` / `on-primary` | `--primary` / `--primary-foreground` |
| `error` / `on-error` | `--destructive` / `--destructive-foreground` |
| `outline-variant` | `--border` / `--input` |
| `secondary` (mostarda, claro) | **sem equivalente** — virou `ai`, ver [D-06](#d-06) |

Sem equivalente shadcn: `inverse-*`, `*-fixed`, `*-fixed-dim`, `surface-tint`, `tertiary*`. Não são portados — nenhum tem papel distinto no produto.

---

### D-03
**`--primary` do tema claro é `#101c2d`, não `#000000`.**

*Protótipo:* as 18 telas claras declaram `"primary": "#000000"` e `"tertiary": "#000000"` — preto puro.

*Direção:* `docs/telas/DESIGN-CLARO.md` especifica `#0F172A` (Deep Slate/Navy) e descreve a marca como "disciplina monocromática", não preto absoluto. Os comentários de brand embutidos no HTML das telas também dizem `Primary color: #0f172a` — o gerador documentou uma intenção que o config não cumpriu.

*Decisão:* `#101c2d`, que é o `on-surface` já usado em todo texto das telas claras.

*Motivo:* preto puro sobre `#f9f9ff` é contraste 20.4:1 — acima do necessário e visualmente duro em sessão longa de auditoria, que é o caso de uso declarado. `#101c2d` mantém 17.1:1, muito acima de AAA, e unifica cor de texto e cor de marca num só valor.

---

### D-04
**Tokens de status criados: `success`, `warning`, `danger`, `info`, `ai`.**

*Protótipo:* **não existe token de sucesso em nenhum dos 18 configs claros.** O `#10B981` que `DESIGN-CLARO.md` exige para "Compliant / Zero Risk" não está em config nenhum. O resultado é que "Conforme" é renderizado por três caminhos incompatíveis:

1. `central_de_escritura_o_sped_ecd` — hardcode literal: `bg-[#ECFDF5] text-[#065F46]`, 47 ocorrências.
2. 8 telas — Tailwind default: `bg-emerald-100 text-emerald-800`.
3. Restante — **sem cor**: `bg-surface-container-high text-on-surface`, ou seja, chip cinza.

*Decisão:* cinco tokens de status, com tríade bg/fg/dot nos dois temas, em [TOKENS.md §3.4](TOKENS.md#34-escala-de-status-do-semáforo-fiscal).

*Motivo:* o semáforo fiscal é o sinal mais importante do produto. Um contador que abre a carteira precisa distinguir conforme de crítico em varredura periférica. Chip cinza para "Conforme" desliga exatamente esse sinal.

---

### D-05
**Três telas são descartadas como referência visual.**

| Tela | Evidência |
|---|---|
| `governan_a_corporativa_kpis_..._redesenhado` | 422 classes Tailwind default (`slate`, `emerald`, `amber`, `blue`, `indigo`, `teal`), **zero** classes `surface*`/`on-surface*`. Config com 11 cores divergentes e `borderRadius.lg` próprio. Troca o slot `secondary` de dourado-IA para verde. |
| `administra_o_da_plataforma_super_admin_rf_08` | 373 classes default + 51 utilitários arbitrários (`text-[#111318]`×28, `bg-[#eaecf1]`×8). Config **sem `fontSize` e sem `spacing`**. Header marcado no HTML como bloco importado (`SHARED HEADER ANCHOR (READ-ONLY)`), com fonte Be Vietnam Pro e ícones Phosphor. Sem sidebar. |
| `plataforma_de_agentes_de_ia_rf_07` | 171 classes default. Carrega Be Vietnam Pro, família que nenhum config declara e nenhuma classe usa. |

Somadas: **966 de 1.068** ocorrências de classe default do protótipo inteiro.

*Decisão:* essas telas valem como **referência de conteúdo e fluxo** (o que a tela mostra, em que ordem), nunca como referência visual. Quando forem implementadas, seguem [TOKENS.md](TOKENS.md) e [COMPONENTS.md](COMPONENTS.md) como qualquer outra.

*Motivo:* são redesenhos feitos fora do sistema. Replicá-las importaria um segundo design system para dentro do produto.

---

### D-06
**`secondary` do protótipo é desmembrado em `ai` e `success`.**

*Protótipo:* `secondary: #785a00` / `secondary-container: #fdc73a` (mostarda) é o "dourado da IA" no tema claro, usado em 16 telas com esse papel de forma consistente. **Mas:**

- No tema escuro, `secondary: #4edea3` — verde menta, que ali é o token de **sucesso**.
- No claro, `text-secondary` também marca "alerta / expirando" em várias telas.

Ou seja: um mesmo token significa **IA** e **alerta** dentro do claro, e **sucesso** no escuro. Três papéis, um nome.

*Decisão:* separados em tokens distintos — `ai` (dourado nos dois temas), `success` (verde nos dois temas), `warning` (âmbar nos dois temas).

*Motivo:* é o conflito de token mais perigoso do protótipo. Sem separar, um chip "gerado por IA" e um chip "conforme" ficam indistinguíveis num tema e trocam de significado no outro. Num produto onde o usuário precisa saber o que foi conferido por humano e o que não foi, isso é falha material — ver [PATTERNS.md §4](PATTERNS.md#4-procedência-de-ia-e-hitl).

---

### D-07
**JetBrains Mono passa a ser carregada de fato.**

*Protótipo:* a família está declarada em 18 configs, mas o `<link>` existe em apenas 7 `<head>`. **11 telas aplicam classes `font-code-*` sem jamais buscar a fonte:**

| Tela | Usos `code-*` |
|---|---|
| `relat_rios_gerenciais_avan_ados` | 342 |
| `triagem_de_captura_df_e_inbox` | 245 |
| `gest_o_financeira_integrada` | 183 |
| `central_de_escritura_o_sped_ecd` | 178 |
| `apura_o_fiscal_tribut_ria` | 168 |
| `onboarding_de_clientes` | 164 |
| `departamento_pessoal_folha` | 163 |
| `dashboard_multi_empresa_rf_06` | 145 |
| `configura_es_cofre_de_certificados` | 136 |
| `copiloto_cont_bil_conversacional` | 125 |
| `central_de_cobran_a_ativa` | 122 |

**≈1.971 aplicações de tipografia monoespaçada renderizando em fallback sans-serif** — exatamente onde a direção exige mono: chave NF-e de 44 dígitos, máscara CNPJ/CPF, NSU, hash SHA-256, CFOP/NCM/CST.

*Decisão:* carregar JetBrains Mono via `next/font/google`, pesos 400–600.

*Motivo:* o alinhamento óptico coluna a coluna é a razão de existir da mono num produto fiscal. Sem a fonte, a decisão de usá-la nunca foi executada.

*Consequência prevista:* a largura de cada uma dessas ~2.000 células muda ao carregar a fonte. Layout de tabela calibrado a olho sobre o fallback vai precisar de reajuste. **Isso é esperado, não é regressão.**

---

### D-08
**Escala tipográfica única para os dois temas.**

*Protótipo:* claro e escuro têm escalas diferentes, não a mesma escala em dois temas:

| Token | Claro | Escuro |
|---|---|---|
| `headline-lg` | 30px | 28px |
| `headline-md` | 22px | 20px |
| `headline-sm` | 18px | 16px |
| `label-md` | 12px | 13px |
| `body-sm` | 13px | 12px |
| `title-sm` / `title-md` | existe | **não existe** |
| `body-lg` / `display-lg` | **não existe** | existe |

Além disso, no escuro `label-*` e `code-sm` mapeiam para **Geist**, não Inter/JetBrains.

*Decisão:* escala única em [TOKENS.md §5.2](TOKENS.md#52-escala), baseada na clara (cobre 18 das 21 telas), acrescida de `display-lg` e `body-lg` vindos do escuro. `code-*` é JetBrains Mono nos dois temas.

*Motivo:* trocar de tema não pode remaquetar a página. Tamanho de fonte é estrutura, não cor.

---

### D-09
**`tabular-nums` passa a ser obrigatório.**

*Protótipo:* **zero ocorrências** em todas as telas, apesar de `DESIGN-CLARO.md` ("Tabular figures (`tnum`) must be enforced across all monetary columns") e `DESIGN-ESCURO.md` ("All financial balances, tax keys, transaction IDs, and currency amounts utilize tabular lining figures") exigirem explicitamente.

*Decisão:* obrigatório em moeda, quantidade, data, percentual e identificador numérico.

*Motivo:* combinado com [D-07](#d-07), significa que o alinhamento numérico do protótipo nunca funcionou — nem pela fonte, nem pela feature tipográfica.

---

### D-10
**`radius-full` é `9999px`, não `0.75rem`.**

*Protótipo:* **21 de 21 telas** declaram `full: "0.75rem"` (12px). A classe `rounded-full` é usada **390 vezes** (de 3 em `termos_de_uso_hitl` a 42 em `gest_o_financeira_integrada`).

*Efeito real:* todo avatar, dot de status, badge-pílula e botão circular do protótipo renderiza como **quadrado de canto 12px**. Ambos os documentos de direção declaram `full: 9999px` — o config contradiz a direção.

*Decisão:* `9999px`.

*Motivo:* é o que a direção pede e o que `rounded-full` significa universalmente. Um dot de semáforo quadrado não lê como indicador de status.

*Consequência prevista:* é a divergência de **maior superfície visual** do protótipo — muda a aparência de ~390 elementos. Telas implementadas vão parecer diferentes do protótipo nesses pontos, e isso é correção, não desvio.

**Nota relacionada:** a escala inteira de raio do protótipo está deslocada um degrau em relação à direção (protótipo: `DEFAULT 0.125 / lg 0.25 / xl 0.5 / full 0.75`; direção: `sm 0.125 / DEFAULT 0.25 / md 0.375 / lg 0.5 / xl 0.75 / full 9999px`). O protótipo não tem `sm` nem `md`. [TOKENS.md §6](TOKENS.md#6-raio-de-borda) adota a escala da direção.

---

### D-11
**Tamanho de ícone passa a ser escala fechada.**

*Protótipo:* 1.045 usos de `text-[Npx]` em **16 valores distintos** — 18px×340, 16px×215, 11px×185, 20px×133, 14px×119, 10px×116, e mais dez valores. Não há token de tamanho de ícone. As 3 telas fora do sistema usam ainda outra escala (`text-base`/`text-sm`/`text-xs`).

*Decisão:* cinco tokens (`icon-xs` 14 a `icon-xl` 28) em [TOKENS.md §8](TOKENS.md#8-ícones).

*Motivo:* 16 tamanhos arbitrários não é decisão de design, é acidente de geração. Ícone de 10px é ilegível e não passa em alvo de toque.

---

### D-12
**Sidebar tem 264px.**

*Protótipo:* `w-72` (288px) no shell canônico de 4 telas, `w-64` (256px) no portal do cliente, `264px` em `docs/prototipo/index.html`.

*Decisão:* 264px, valor do `index.html`.

*Motivo:* escolha arbitrária entre três valores próximos; o do `index.html` é o único definido como variável (`--sidebar`) e já responsivo.

---

### D-13
**A paleta de `docs/prototipo/index.html` não entra no produto.**

*Protótipo:* o catálogo usa uma quarta paleta (`--brand: #1559b7`, `--good: #079669`, `--warn: #b57900`, `--danger: #c83b47`), distinta das telas claras e escuras.

*Decisão:* dela se aproveita o **mecanismo** (`data-theme`, `localStorage`, `prefers-reduced-motion`, `:focus-visible`), não os **valores**.

*Motivo:* `index.html` é o navegador de protótipos, ferramenta interna, não superfície de produto.

---

### D-14
**Defeitos de config que simplesmente não são portados.**

| Defeito | Onde | Efeito |
|---|---|---|
| `primary-fixed: "dae2fd"` sem `#` | 9 das 18 telas claras | Valor CSS inválido; a classe não pinta |
| `py-0.2` | ~20 ocorrências (`cofre_a1`, `esocial`, `open_finance`) | Valor Tailwind inexistente; não compila |
| `style="width: 103.86%"` | `governan_a_corporativa` | Barra de progresso estoura o trilho |
| `viewbox` minúsculo no SVG sparkline | `relat_rios_gerenciais` | Inválido em JSX; precisa ser `viewBox` |
| Be Vietnam Pro carregada sem uso | `plataforma_de_agentes_de_ia` | Download morto |
| 3 URLs diferentes de eixos do Material Symbols | 21 telas | 18 telas nunca exercem `FILL`/`wght` declarados |

Nenhum exige decisão: são erros de geração.

---

### D-15
**Componentes sem precedente no protótipo.**

O protótipo **não tem**, e portanto [COMPONENTS.md](COMPONENTS.md) especifica do zero:

| Ausente | Situação no protótipo |
|---|---|
| **Overlay real** (modal, drawer, backdrop) | Os "modais" da tela dark carbon são cards inline em grid. Nenhum `<dialog>`, backdrop, trap de foco ou ESC. Único overlay verdadeiro é o toast. |
| **Estado de erro em campo** | Erro só aparece como badge em linha de tabela. Nenhum input tem estado inválido. |
| **`focus-visible`** | Ausente em todo o protótipo, exceto `focus:ring` em 3 inputs do login. |
| **Radio** | Não existe. Escolha exclusiva é feita com controle segmentado de `<button>`. |
| **Input mascarado** (R$, CPF, CNPJ, telefone, Date) | Não existe. Valores monetários são texto renderizado. `CLAUDE.md` exige máscara. |
| **`<input type="file">`** | O dropzone de certificado A1 é uma `<div>` clicável sem input. Sem drag-over, sem lista de arquivos. |
| **Estado vazio** | Zero ocorrências. Toda tabela vem populada. |
| **Skeleton** | Zero. Todo `animate-pulse` do protótipo é dot ao vivo, não placeholder. |
| **Popover / menu** | Botões `more_vert` não abrem nada. |
| **Gráfico** | **Nenhuma biblioteca, nenhum `<canvas>`.** O único SVG de dado é um sparkline de 6 pontos. Toda "visualização" é `<div>` com `style="width:N%"`. |
| **`aria-*`, `role`** | Praticamente ausentes. Um `aria-label` em nav; `aria-current="page"` só na tela escura. |

---

### D-16
**Padrões de JavaScript do protótipo que não são portados.**

O protótipo manipula DOM imperativamente. Em React, vira estado:

| Padrão no protótipo | Onde | Substituto |
|---|---|---|
| Reescrever `btn.className` inteiro como string | login, dark carbon | Estado + `cn()` condicional |
| Ler `.classList.contains('hidden')` como fonte de verdade | dark carbon | Estado booleano |
| `querySelectorAll('button')` global com match por `innerText` | onboarding | Handler por item |
| `row.style.opacity = '0.5'` imperativo | onboarding | Estado por linha |
| `innerText = 'Processado ✓'` | onboarding | Render condicional |

Estado real implicado, a modelar: `personaTab`, `selectedRows: Set<id>`, `viewMode`, `consents`, `signed`, resolução por linha. Toast vai para **Sonner**, conforme `CLAUDE.md`.

---

## Pendências de produto

Itens que **exigem decisão do PI** e **bloqueiam** a fatia correspondente. Enquadram-se no caso 1 de `CLAUDE.md` ("decisão de produto que não existe em nenhum documento").

### P-01 Visualização de dados
O protótipo não tem um único gráfico. Dashboard, DRE e relatórios gerenciais mostram números e barras de proporção, nada mais. **Se alguma tela precisar de gráfico de verdade** (série temporal, composição, comparação), é decisão nova: qual biblioteca, quais tipos, qual paleta de séries. Não é transcrição do protótipo.
*Bloqueia:* fatias de Relatórios Gerenciais e Dashboard, se a SPEC pedir gráfico.

### P-02 — Tabela em mobile
[TOKENS.md §10](TOKENS.md#10-breakpoints) diz que tabela colapsa em card no mobile, seguindo `DESIGN-CLARO.md`. **Nenhuma tela do protótipo implementa isso** — não há referência de quais colunas sobrevivem no card nem de como fica a ação de linha. Para tabela fiscal com 8+ colunas, a escolha das colunas é decisão de produto.
*Bloqueia:* primeira fatia com tabela que precise de suporte mobile real.

### P-03 Densidade de tabela
`DESIGN-CLARO.md` cita "36px padrão, 32px em alta densidade", sugerindo um alternador. O protótipo tem quatro alturas de linha diferentes (`py-2`, `py-2.5`, `py-space-sm`, `py-3`) e **nenhum alternador**. Se densidade alternável é requisito, precisa de SPEC.
*Não bloqueia:* [COMPONENTS.md](COMPONENTS.md) fixa uma altura só. Alternador fica fora de escopo até haver SPEC.

---

## Protocolo

- **Divergência nova encontrada na implementação:** se é defeito óbvio de geração (como [D-14](#d-14)), o Code normaliza e acrescenta linha aqui no mesmo PR. Se muda comportamento de produto, é `[FIX]` ou pergunta ao PI.
- **Este documento é do Cowork** (`docs/design-system/` é governança). O Code propõe acréscimo pelo PR do card; não reescreve decisão registrada.
- **Item resolvido não é apagado.** Débito vira histórico: quem ler daqui a seis meses precisa saber por que o código não parece com o protótipo.
