# COMPONENTS.md — Catálogo de Componentes

> **Normativo.** Todo componente de interface do ContaIA está aqui ou é derivado de algo que está aqui.
> Base: **shadcn/ui** (PRD §14 — "nada de componente nativo, só em caso de exceção"). Este documento define o que a base shadcn não cobre e como a que cobre é configurada.
> Valores vêm de [TOKENS.md](TOKENS.md). Nenhum componente declara cor, tamanho ou raio literal.

---

## 0. Como usar este catálogo

**Antes de criar qualquer componente**, nesta ordem:

1. **shadcn/ui tem?** → instala e configura. Não reescreve.
2. **Já existe no projeto?** → reusa. Não duplica.
3. **É composição de dois que já existem?** → compõe na tela, não cria terceiro.
4. **Só então** → componente novo, e entra neste documento no mesmo PR.

Componente inventado fora desse fluxo é retrabalho — o PR volta.

### Origem

| Origem | Significado |
|---|---|
| **shadcn** | Instalado de `ui.shadcn.com`, configurado com nossos tokens. Não fork. |
| **shadcn+** | shadcn instalado, com variante ou comportamento acrescentado por nós. |
| **próprio** | Não existe em shadcn. Escrito por nós. |

### Estado de referência

| Marca | Significado |
|---|---|
| ✅ | Tem precedente no protótipo. Segue-o (com as correções de [DEBITO.md](DEBITO.md)). |
| ⚠️ | Precedente parcial ou inconsistente entre telas. A forma canônica está definida aqui. |
| 🆕 | **Sem precedente no protótipo.** Especificado do zero — ver [DEBITO.md §D-15](DEBITO.md#d-15). |

---

## 1. Fundação

### 1.1 Button

`shadcn+ ✅`

Variantes. As quatro primeiras são shadcn; `ai` é nossa.

| Variante | Uso | Fundo / Texto |
|---|---|---|
| `default` | Ação primária da tela. **Uma por tela.** | `--primary` / `--primary-foreground` |
| `secondary` | Ação de apoio | `--secondary` / `--secondary-foreground` |
| `outline` | Ação terciária, filtro | transparente + `--border` |
| `ghost` | Ação de linha de tabela, ícone puro | transparente, hover `--accent` |
| `destructive` | Excluir, revogar, cancelar transmissão | `--destructive` / `--destructive-foreground` |
| **`ai`** | Ação que dispara automação: "Conciliar em Lote", "Sugerir Classificação", "Auto-Gerar" | token `ai` |

Tamanhos: `sm` (h-8, `label-sm`), `default` (h-9, `title-sm`), `lg` (h-11, `title-sm`), `icon` (9×9).

Regras:

- **Ícone antes do rótulo**, exceto seta de avanço (`arrow_forward`, `login`, `open_in_new`), que vai depois.
- Botão só com ícone exige `aria-label`. `title=` sozinho **não basta** — o protótipo usa só `title` em toda ação de linha, e isso não é lido por leitor de tela.
- **Nunca** dois `default` na mesma área de ação.
- Estado de carregamento: spinner substitui o ícone, rótulo permanece, botão fica `disabled`. Nunca trocar o texto por "Processando…" — muda a largura e desloca o layout.
- Variante `ai` é reservada a ação **executada por máquina**. Não usar por destaque visual.

### 1.2 Input

`shadcn+ ⚠️`

Altura `h-9`, `body-md`, borda `--input`, foco em `--ring`.

Estados: default, focus, **error** 🆕, disabled, readonly.

**Estado de erro não existe no protótipo** ([D-15](DEBITO.md#d-15)). Definido aqui: borda `danger`, mensagem abaixo do campo em `label-sm` com ícone `error` de `icon-xs`, e `aria-describedby` ligando campo e mensagem. A mensagem **substitui** o texto de ajuda, não empilha.

Adornos: prefixo/sufixo posicionados com padding no input (`pl-9` para ícone, `pl-8` para texto curto). Ícone de adorno é `icon-md`, cor `--muted-foreground`.

### 1.3 InputMasked

`próprio 🆕`

Exigido por `CLAUDE.md` ("máscara e validação em Date, valores R$, CPF, CNPJ, telefone e e-mail"). **Sem precedente no protótipo** — lá valores monetários são texto renderizado.

| Máscara | Formato | Regras |
|---|---|---|
| `currency` | `R$ 1.234,56` | Prefixo fixo. Alinhado à direita. `code-sm` + `tabular-nums`. **Nunca float** — inteiro em centavos. |
| `cnpj` | `00.000.000/0000-00` | `code-sm`. Valida dígito verificador. |
| `cpf` | `000.000.000-00` | `code-sm`. Valida dígito verificador. |
| `phone` | `(00) 00000-0000` | Aceita 8 e 9 dígitos. |
| `date` | `DD/MM/AAAA` | Nunca `MM/DD`. Rejeita data impossível. |
| `accessKey` | 44 dígitos, grupos de 4 | `code-xs`. Exibição truncada — ver [PATTERNS.md §3](PATTERNS.md#3-identificador-fiscal). |

Máscara é de **apresentação**. O valor no estado é sempre cru (centavos inteiros, CNPJ só dígitos, data ISO).

### 1.4 Select

`shadcn ⚠️`

O protótipo usa `<select>` nativo sem chevron customizado. PRD fixa shadcn: usa-se `Select` do shadcn, com chevron, teclado e portal.

Select com mais de ~10 opções vira `Combobox` com busca. Seletor de empresa **sempre** é Combobox — a carteira tem centenas de CNPJs.

### 1.5 Checkbox / Switch / RadioGroup

`shadcn ⚠️`

- **Checkbox** — seleção de linha, consentimento. 16×16, `radius-sm`.
- **Switch** — liga/desliga que tem efeito imediato. Se precisa de "Salvar", é Checkbox, não Switch.
- **RadioGroup** 🆕 — **não existe no protótipo**; lá escolha exclusiva vira controle segmentado. Usar RadioGroup quando as opções precisam estar todas visíveis com descrição; Tabs quando trocam o conteúdo da área.

### 1.6 Textarea / Label / Form

`shadcn ✅`

`Form` do shadcn com `react-hook-form` + `zod`. Validação declarada em schema, nunca espalhada em handler.

---

## 2. Navegação e shell

O protótipo tem **três shells distintos** (canônico `w-72`, portal `w-64`, dark carbon `h-20`). Unificados num só — ver [PATTERNS.md §1](PATTERNS.md#1-shell-da-aplicação).

### 2.1 AppShell

`próprio ⚠️`

Composição: `Sidebar` + `Topbar` + `<main>`. Sidebar 264px ([D-12](DEBITO.md#d-12)), topbar `h-16`, main com `padding-top` igual à topbar.

Uma variante estrutural: `standard` (escritório contábil, navegação completa) e `portal` (cliente white-label, navegação reduzida, marca do escritório no lugar da marca ContaIA). **Mesmo componente, dados diferentes** — não dois shells.

### 2.2 Sidebar

`próprio ✅`

Grupos rotulados (`label-sm` uppercase, `--muted-foreground`), itens com ícone `icon-md` + rótulo `body-sm`.

Estados: default, hover (`--accent`), **ativo** (`--primary` de fundo, `--primary-foreground` de texto).

- Item ativo **precisa** de `aria-current="page"`. Só a tela dark carbon faz isso no protótipo.
- Badge no item: contador numérico (`danger` para bloqueante, `ai` para automático) ou dot de status.
- Mobile: vira drawer com overlay, fechando por ESC e por clique fora.

### 2.3 Topbar

`próprio ✅`

Da esquerda para a direita: seletor de empresa → pills de telemetria (ocultas abaixo de `xl`) → ações → alternador de tema → notificações → menu de perfil.

### 2.4 CompanySwitcher

`próprio ✅`

O componente mais característico do produto. Exibe razão social (truncada), CNPJ em `code-xs`, tag de regime tributário e indicador de nível de RLS.

Abre em Combobox com busca por razão social, CNPJ ou IE. Atalho `Cmd/Ctrl+K`. A troca de empresa **recarrega o escopo de dados inteiro** — precisa de estado de carregamento visível, nunca troca silenciosa.

### 2.5 Tabs / SegmentedControl

`shadcn ⚠️`

O protótipo tem o mesmo padrão em três escalas: trilho `--secondary`, item ativo `--card` + sombra, inativo `--muted-foreground`.

**Correção obrigatória:** no protótipo, item ativo e inativo usam **classes de fonte diferentes** (`title-sm` vs `body-md`), o que muda a largura ao trocar de aba e desloca o layout. Aqui, ativo e inativo têm a **mesma métrica**; a diferença é fundo, cor e peso.

### 2.6 Breadcrumb

`shadcn ⚠️`

O protótipo alterna entre breadcrumb e eyebrow de RF, sem regra. Canonizado em [PATTERNS.md §2](PATTERNS.md#2-cabeçalho-de-página).

---

## 3. Exibição de dados

### 3.1 DataTable

`próprio ⚠️`

O componente mais usado do produto. Base: shadcn `Table` + TanStack Table.

Anatomia:

| Parte | Especificação |
|---|---|
| Wrapper | `--card`, `radius-lg`, `1px --border`, `overflow-hidden` |
| Toolbar | Busca, filtros, ações em lote, contador de seleção |
| Header | `--muted`, `label-sm` uppercase, `--muted-foreground`, borda inferior |
| Linha | altura 36px, divisor `--border`, hover `--accent` |
| Célula numérica | alinhada à direita, `code-sm` + `tabular-nums` |
| Ações | última coluna, alinhada à direita |
| Paginação | rodapé, contagem total + tamanho de página |

Regras:

- **Altura de linha única: 36px.** O protótipo tem quatro alturas distintas; densidade alternável está fora de escopo ([P-03](DEBITO.md#p-03-densidade-de-tabela)).
- **Linha com estado semântico** usa fundo tingido em ~5% do token (`danger`, `warning`), **nunca** cor sólida. O tingimento é reforço do badge da linha, não substituto.
- Coluna numérica **sempre** `tabular-nums` ([D-09](DEBITO.md#d-09)).
- Seleção em lote: checkbox no header seleciona a página, não a base inteira. Quando há seleção, a toolbar mostra "N selecionados" e as ações em lote.
- **Estado vazio obrigatório** 🆕 — o protótipo não tem nenhum. Ver §3.7.
- **Estado de carregamento obrigatório** 🆕 — skeleton de linha, não spinner centralizado.
- Ordenação e filtro ficam na URL (`searchParams`), não em estado local. Tela de auditoria precisa ser compartilhável por link.

### 3.2 HierarchicalTable

`próprio ✅`

Especialização para DRE e plano de contas. Nível hierárquico por **fundo**, não por indentação isolada:

| Nível | Fundo | Peso |
|---|---|---|
| Grupo | `--muted` | 600 |
| Subgrupo | `--card`, com recuo | 400 |
| Subtotal | `--accent` | 600 |
| Total | `--primary` / `--primary-foreground` | 700 |

Expansão por linha, com estado na URL para que um relatório expandido seja compartilhável.

### 3.3 KpiCard

`próprio ✅`

Anatomia: barra de acento superior (2px, token de status) → rótulo `label-sm` uppercase com dot → valor `headline-lg` → texto de apoio `body-sm` → rodapé opcional com ação.

Regras:

- **Centavos em tamanho reduzido**, dentro do mesmo elemento do valor: `R$ 14.850` + `,00` em `headline-sm`. O protótipo tem dois tratamentos diferentes; este é o canônico.
- Valor **sempre** `tabular-nums` — KPI que muda em polling não pode "dançar".
- A cor do valor segue o **estado**, não o sinal: um KPI de risco é `danger` mesmo com valor positivo.
- `animate-ping` no dot **apenas** em estado crítico que exige ação hoje. Nunca decorativo.

### 3.4 StatusBadge

`próprio ⚠️`

O semáforo fiscal. O protótipo tem três formas coexistindo e onze pares de cor diferentes; unificado aqui.

Anatomia: dot (6px, `radius-full`) + rótulo `label-sm`. Fundo e texto do token de status, `radius-sm`, padding `space-xs`/`space-sm`.

| Estado | Token | Quando |
|---|---|---|
| Conforme | `success` | Reconciliado, aceito pela Sefaz, assinatura válida |
| Atenção | `warning` | Vencimento em D-3, pendência de validação |
| Crítico | `danger` | Multa iminente, rejeição, divergência de cálculo |
| Processando | `info` + `animate-pulse` | Lote em execução, download de NSU |
| Sugerido por IA | `ai` | Classificação automática ainda não confirmada |
| Neutro | `muted` | Rascunho, não aplicável, arquivado |

Regras:

- **Cor nunca é o único sinal.** Sempre acompanha rótulo textual — daltonismo, impressão, contraste baixo.
- Badge **não** leva borda. As bordas que aparecem no protótipo vêm das telas fora do sistema ([D-05](DEBITO.md#d-05)).
- Um badge por linha. Dois badges de status na mesma linha significam que faltam colunas.

### 3.5 ProgressBar

`próprio ✅`

Trilho `--muted`, preenchimento no token do estado, altura 6px, `radius-full`.

Variante **empilhada** para semáforo agregado: segmentos `success` / `warning` / `danger` na mesma barra, somando 100%.

Obrigatório: `role="progressbar"` com `aria-valuenow`/`aria-valuemin`/`aria-valuemax`. O protótipo não tem nenhum. Valor é limitado a 100% no componente — o protótipo tem uma barra em 103.86% ([D-14](DEBITO.md#d-14)).

### 3.6 CodeChip

`próprio ⚠️`

Para CFOP, NCM, CST, CNAE, NSU, hash. Fundo `--muted`, `code-xs`, `radius-sm`, `tabular-nums`.

Chave de acesso de 44 dígitos nunca é exibida inteira — ver [PATTERNS.md §3](PATTERNS.md#3-identificador-fiscal).

### 3.7 EmptyState

`próprio 🆕`

**Sem precedente.** Ícone `icon-xl` em `--muted-foreground`, título `headline-sm`, descrição `body-sm`, ação primária opcional.

Três casos distintos, com textos distintos:

| Caso | Mensagem |
|---|---|
| Nunca houve dado | Explica o que aparecerá ali + ação para criar |
| Filtro sem resultado | Diz que o filtro não achou + ação para limpar |
| Erro ao carregar | Explica a falha + ação para tentar de novo |

Tratar os três com o mesmo texto ("Nenhum resultado") é bug de UX: o usuário não sabe se o sistema quebrou ou se o filtro está errado.

### 3.8 Skeleton

`shadcn 🆕`

**Sem precedente.** Placeholder com a forma do conteúdo — linha de tabela é linha de tabela, card é card. Nunca spinner genérico substituindo uma tabela inteira.

Respeita `prefers-reduced-motion`: sem animação, só fundo estático.

---

## 4. Sobreposição

**Nenhum overlay real existe no protótipo** ([D-15](DEBITO.md#d-15)). Toda esta seção é especificação nova sobre a base shadcn.

### 4.1 Dialog

`shadcn 🆕`

Backdrop com blur, container `--popover`, elevação nível 4. Larguras: `sm` 420px, `default` 560px, `lg` 720px, `full` 90vw.

Obrigatório: trap de foco, ESC fecha, foco retorna ao gatilho, `aria-labelledby`/`aria-describedby`.

**Ação destrutiva ou irreversível usa `AlertDialog`, não `Dialog`** — exige confirmação explícita e não fecha por clique fora.

### 4.2 Sheet (drawer)

`shadcn 🆕`

Painel lateral para inspeção de documento e detalhe de registro sem perder o contexto da lista. No protótipo isso é uma coluna de grid; aqui é overlay de verdade.

### 4.3 DropdownMenu

`shadcn 🆕`

Menu de ações de linha (`more_vert`). No protótipo esses botões não abrem nada.

Ação destrutiva no menu vai por último, separada, em `destructive`.

### 4.4 Toast

`Sonner ✅`

Único overlay com precedente. `CLAUDE.md` fixa Sonner. Bottom-right, `z-50`, auto-dismiss em 4s.

**Toast nunca é o único registro de erro relevante.** Falha em transmissão fiscal precisa de estado persistente na tela, não só de um toast que some.

`alert()` é proibido.

### 4.5 Tooltip

`shadcn ⚠️`

Para rótulo de botão-ícone e explicação de abreviação fiscal. Não substitui rótulo visível em formulário, e não pode conter a única cópia de uma informação necessária — tooltip não existe em toque.

---

## 5. Domínio

Componentes específicos do negócio contábil. Todos **próprios**, todos com precedente no protótipo.

### 5.1 FiscalTrafficLight

`próprio ✅`
Indicador consolidado de conformidade por empresa. Dot + rótulo + contagem por severidade. É a leitura primária do dashboard.

### 5.2 CertificateCard

`próprio ✅`
Certificado A1/A3: titular, CNPJ, validade, dias restantes, status. Vencendo em ≤30 dias → `warning`; vencido → `danger`. Ação de renovação em `destructive` só quando já vencido.

### 5.3 CertificateUpload

`próprio 🆕`
Dropzone para `.pfx`/`.p12`. No protótipo é `<div>` sem `<input type="file">`, sem drag-over e sem lista. Aqui: input real, estado de arrasto, validação de extensão e tamanho, e **a senha nunca aparece em log ou em mensagem de erro**.

### 5.4 AiSuggestionCard

`próprio ✅`
Sugestão de agente: o que propõe, confiança, fonte, e as ações **Aceitar / Rejeitar / Editar**. Sempre em token `ai` — ver [PATTERNS.md §4](PATTERNS.md#4-procedência-de-ia-e-hitl).

### 5.5 HitlQueueItem

`próprio ✅`
Item da fila de revisão humana. Documento, sugestão da máquina, prazo, ação. Prazo vencendo escala para `warning` e depois `danger`.

### 5.6 AuditTrailEntry

`próprio ✅`
Linha de trilha append-only: quando, quem (humano ou agente), o quê, hash. Mono + `tabular-nums`. **Somente leitura, sem exceção** — não existe ação de editar ou excluir neste componente.

### 5.7 Stepper

`próprio ✅`
Onboarding em 5 etapas. Estados: concluído (check), atual (invertido), próximo, futuro. O protótipo distingue os dois últimos por **opacidade** (75%/50%); aqui a distinção é por cor e peso — opacidade sozinha reprova em contraste.

### 5.8 ChatMessage / SourceCitation

`próprio ✅`
Copiloto. Bolha do usuário à direita em `--primary`; resposta do assistente à esquerda em `--card`, com metadados acima (tempo de execução, status de auditoria RAG).

**Toda afirmação factual do copiloto carrega citação de fonte.** Resposta sem fonte rastreável não é renderizada como resposta — é erro. `SourceCitation` traz norma, artigo, trecho e link externo.

---

## 6. Proibido

| Proibido | Em vez disso |
|---|---|
| `alert()`, `confirm()`, `prompt()` | Toast (Sonner) ou AlertDialog |
| Hex literal, `bg-[#...]` | Token |
| `slate-*`, `emerald-*`, `amber-*` para status | Token de status |
| `<div onClick>` como botão | `<button>` |
| Exclusão física em CRUD | Arquivamento (`CLAUDE.md`) |
| `any` implícito | Tipo explícito; `unknown` antes de validar |
| Float para dinheiro | Inteiro em centavos |
| Cor como único sinal de estado | Cor + rótulo textual |
| Spinner no lugar de uma tabela | Skeleton com a forma do conteúdo |
| Biblioteca de gráfico sem SPEC | Bloqueia — ver [P-01](DEBITO.md#p-01-visualização-de-dados) |

---

## Referências

- [TOKENS.md](TOKENS.md) — valores
- [PATTERNS.md](PATTERNS.md) — composição
- [DEBITO.md](DEBITO.md) — divergências do protótipo
- [DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md) — contrato
