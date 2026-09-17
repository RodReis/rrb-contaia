# FRONTEND.md — Contrato de engenharia da interface web

> **Normativo.** Toda tarefa de UI começa por este documento.
> Ele decide **como se constrói**. [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) e [`docs/design-system/`](design-system/README.md) decidem **como se parece**.
> Onde tratarem do mesmo assunto sem se contradizer, valem os dois. Se se contradisserem, é defeito de documento: pergunta ao PI.

**Precedência:** `PRD` > `DESIGN-SYSTEM.md` + `docs/design-system/` > **este documento** > `docs/telas/` > protótipo.

---

## 1. O que este documento decide

O ContaIA é operado por um contador que administra centenas de CNPJs e responde por prazo legal. Três consequências de engenharia, não de estética:

1. **Dado errado na tela é multa.** Valor, identificador fiscal e prazo não podem depender de arredondamento de ponto flutuante, de fuso mal resolvido ou de cache servindo estado velho.
2. **Escopo de tenant é limite de segurança.** Empresa ativa errada na tela é vazamento entre clientes concorrentes do mesmo escritório.
3. **A tela é densa e a rede é real.** 488 empresas não vêm num `fetch`. Paginação, filtro e ordenação acontecem no servidor, e o usuário sabe o que está carregando.

Interface que falha em qualquer uma delas está errada, ainda que passe no lint.

---

## 2. Stack fixada

Versão é contrato. Mudança de major exige ADR ([`DECISIONS.md`](DECISIONS.md)).

| Camada | Escolha | Versão | Origem |
|---|---|---|---|
| Runtime | Node.js | **24 LTS** | `CLAUDE.md` |
| Framework | **Next.js (App Router)** | **16.x** | PRD §14 · [ADR-002](adr/ADR-002-stack-frontend.md) |
| UI runtime | React | **19.x** | ADR-002 |
| Linguagem | TypeScript `strict` | **5.x** | ADR-002 |
| CSS | **Tailwind CSS** | **4.x** (CSS-first, `@theme`) | PRD §14 |
| Componentes | **shadcn/ui** (CLI, código no repo) | corrente | PRD §14 |
| Primitivos | Radix UI (via shadcn) | corrente | — |
| Ícones | Lucide | corrente | `design-system/TOKENS.md` §8 |
| Estado de servidor | **TanStack Query v5** | 5.x | ADR-002 |
| Tabela | **TanStack Table v8** | 8.x | ADR-002 |
| Formulário | **React Hook Form** + `@hookform/resolvers` | corrente | ADR-002 |
| Schema | **Zod v4** | 4.x | ADR-002 |
| Máscara | **react-imask** | corrente | [ADR-006](adr/ADR-006-mascaras-e-validacao-br.md) |
| Toast | **Sonner** (via shadcn) | corrente | `CLAUDE.md` |
| Gráfico | **Recharts via `shadcn/ui charts`** | corrente | [ADR-007](adr/ADR-007-graficos.md) — resolve P-01 |
| Estado global de UI | **Zustand** | corrente | ADR-002 |
| Estado em URL | `nuqs` ou `useSearchParams` nativo | corrente | §7 |
| Datas | `date-fns` + `date-fns-tz` | corrente | §12 |
| Teste unitário/componente | Vitest + Testing Library | corrente | [`TESTING.md`](TESTING.md) |
| Teste E2E | Playwright | corrente | [`TESTING.md`](TESTING.md) |
| Lint/format | ESLint (flat config) + `eslint-plugin-jsx-a11y` + Prettier | corrente | §19 |

**Nada de componente nativo** (PRD §14). Não existe `<select>`, `<dialog>`, `<table>` cru, `alert()`, `confirm()`, `prompt()` nem `<input type="date">` em código de aplicação. Exceção exige registro em [`COMPONENTS.md`](design-system/COMPONENTS.md) na mesma PR.

**Biblioteca nova exige justificativa na PR:** o que ela resolve, por que shadcn/Radix/o que já está no repo não resolve, peso no bundle e manutenção. Não se adiciona dependência para economizar 20 linhas.

---

## 3. Estrutura

```
apps/web/
  src/
    app/                      # rotas (App Router)
      (auth)/                 # login, recuperação — sem shell
      (app)/                  # shell `standard` do escritório
        [empresaId]/…         # escopo de empresa
      (portal)/               # shell `portal` do cliente white-label
      api/                    # route handlers (BFF apenas; regra fiscal nunca aqui)
    components/
      ui/                     # shadcn — gerado pela CLI, não editado à mão sem registro
      domain/                 # componentes de domínio (§5 de COMPONENTS.md)
      layout/                 # AppShell, Sidebar, Topbar, CompanySwitcher
    features/<dominio>/       # fatia vertical: hooks, schemas, colunas, formulários, telas
      api.ts                  # chamadas ao backend
      queries.ts              # useQuery / useMutation
      schema.ts               # Zod: form + resposta
      columns.tsx             # colunas da DataTable
      <tela>.tsx
    lib/                      # http, formatadores, máscaras, utilitários puros
    hooks/                    # hooks transversais
    stores/                   # Zustand (só estado de UI)
    types/
  tests/
```

Regras:

- **A fatia vertical manda.** Código de um domínio fiscal vive em `features/<dominio>/`. `components/` só recebe o que é reusado por dois ou mais domínios.
- **`components/ui/` é território do shadcn.** Alteração num arquivo gerado é registrada em [`COMPONENTS.md`](design-system/COMPONENTS.md) com o motivo.
- **Sem barrel file (`index.ts` reexportando tudo).** Quebra tree-shaking e cria import cíclico.
- **Nome de arquivo em `kebab-case`; componente em `PascalCase`; hook em `camelCase` começando por `use`.**

---

## 4. Tipagem

`tsconfig` com `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`.

**Proibido:**

- `any` implícito ou explícito em código de aplicação (`CLAUDE.md`). Dado externo entra como `unknown` e só vira tipo depois de passar por Zod.
- `as` para calar o compilador. Type assertion só em type guard escrito e testado.
- `@ts-ignore`. `@ts-expect-error` com comentário explicando, quando inevitável.
- `!` (non-null assertion) fora de teste.
- `number` para dinheiro. Ver §9.

**Obrigatório:**

- **Tipos derivados do schema, nunca duplicados:** `type EmpresaForm = z.infer<typeof empresaFormSchema>`.
- **Branded types para identificador fiscal**, para que um CNPJ não seja atribuível a uma `string` qualquer:

```ts
// lib/brand.ts
declare const brand: unique symbol
export type Brand<T, B> = T & { readonly [brand]: B }

export type Cnpj   = Brand<string, 'Cnpj'>    // 14 dígitos, sem máscara
export type Cpf    = Brand<string, 'Cpf'>     // 11 dígitos, sem máscara
export type Centavos = Brand<number, 'Centavos'>
export type ChaveAcesso = Brand<string, 'ChaveAcesso'> // 44 dígitos
```

O construtor de cada branded type é a função de validação (§9). Não existe cast direto.

- **Resposta de API é validada em runtime.** Contrato quebrado do backend vira erro tratado, não `undefined` renderizado como "NaN" numa coluna de tributo.

---

## 5. Server e Client Components

| Faz | Onde |
|---|---|
| Ler dado para a primeira pintura, montar layout, resolver tema e sessão | **Server Component** |
| Interação, formulário, tabela com estado, toast, qualquer hook | **Client Component** (`'use client'` no topo do arquivo) |

- **`'use client'` o mais fundo possível na árvore.** Uma página inteira marcada como client anula o benefício do App Router.
- **Nunca passar segredo, token de acesso a órgão, conteúdo de certificado ou credencial por props de Server para Client.** O que atravessa a fronteira é serializado e vai para o HTML.
- **Server Action é permitida para mutação simples de formulário.** Fluxo que precisa de estado de carregamento rico, retry, cache invalidado e toast usa `useMutation`. Não se misturam os dois no mesmo formulário.
- **Regra fiscal, cálculo tributário e decisão de acesso nunca rodam no front** — nem em Server Component, nem em route handler. O front exibe; a API decide (`CLAUDE.md`, "Convenções de código").

---

## 6. Dados — TanStack Query v5

Toda leitura de dado remoto passa por `useQuery`/`useSuspenseQuery`. Toda escrita, por `useMutation`. **`useEffect` + `fetch` para buscar dado é defeito de revisão (P1).**

### 6.1 Chave de query

A chave carrega o escopo de tenant. Sem isso, trocar de empresa serve dado da anterior pelo cache.

```ts
// features/documentos/queries.ts
export const documentoKeys = {
  all:    (t: TenantId, e: EmpresaId) => ['documentos', t, e] as const,
  list:   (t: TenantId, e: EmpresaId, params: ListParams) =>
            [...documentoKeys.all(t, e), 'list', params] as const,
  detail: (t: TenantId, e: EmpresaId, id: string) =>
            [...documentoKeys.all(t, e), 'detail', id] as const,
}
```

- **`tenantId` e `empresaId` entram em toda chave de dado transacional.** Sem exceção.
- Ao trocar de empresa, o escopo inteiro é invalidado ([`PATTERNS.md`](design-system/PATTERNS.md) §8.2) — a tela mostra carregamento, não dado da empresa anterior.

### 6.2 Configuração padrão

| Parâmetro | Valor | Motivo |
|---|---|---|
| `staleTime` | 30s em listagem, 0 em fila HITL e inbox de manifestação | Prazo fiscal não convive com dado velho |
| `gcTime` | 5min | — |
| `retry` | 2, com backoff exponencial; **0 em mutação** | Reenviar manifestação ou evento eSocial duplica ato jurídico |
| `refetchOnWindowFocus` | `true` em dashboard e fila HITL; `false` em formulário aberto | Não se recarrega por baixo de quem está digitando |
| `throwOnError` | `true` em rota com error boundary | Erro não vira tela em branco |

### 6.3 Mutação

- **Invalidação explícita** das chaves afetadas em `onSuccess`. Não se confia em refetch por foco.
- **Otimista só no reversível** ([`PATTERNS.md`](design-system/PATTERNS.md) §11). Marcar como lido, sim. Transmitir manifestação, gerar guia, enviar evento eSocial: espera a confirmação real do servidor.
- **Idempotência:** mutação que gera efeito externo envia `Idempotency-Key` (UUID gerado na abertura do formulário, não no clique). Clique duplo não transmite duas vezes.
- **Botão de envio bloqueia reentrada** (`isPending`), mas **nunca fica desabilitado por validação** ([`PATTERNS.md`](design-system/PATTERNS.md) §6).

### 6.4 Prefetch e streaming

- Listagem crítica (dashboard, inbox) é prefetchada no Server Component e hidratada via `HydrationBoundary`.
- Seções independentes usam `<Suspense>` com **Skeleton com a forma do conteúdo**, nunca spinner genérico.

---

## 7. Estado — onde cada coisa mora

| Tipo de estado | Ferramenta | Nunca |
|---|---|---|
| Dado do servidor | TanStack Query | `useState` + `useEffect` |
| Filtro, ordenação, página, aba, competência | **URL** (`searchParams`) | estado local — a tela precisa ser compartilhável e auditável |
| Formulário | React Hook Form | estado controlado campo a campo |
| UI global (sidebar colapsada, tema, densidade, empresa ativa) | Zustand | Context recriado a cada render |
| Derivado | cálculo puro no render / `useMemo` só com medição | duplicar dado em outro estado |

**Zustand é para UI, não para dado de negócio.** Um store que guarda lista de documentos é bug de arquitetura: o cache é do Query.

Estado de filtro na URL é requisito de auditoria ([`PATTERNS.md`](design-system/PATTERNS.md) §11), não preferência.

---

## 8. Formulários — React Hook Form + Zod

```ts
// features/empresas/schema.ts
export const empresaFormSchema = z.object({
  cnpj:        cnpjSchema,
  razaoSocial: z.string().trim().min(3, 'Informe a razão social').max(200),
  regime:      z.enum(['SIMPLES', 'PRESUMIDO', 'REAL']),
  email:       emailSchema,
  telefone:    telefoneSchema.optional(),
  faturamento: centavosSchema,           // inteiro em centavos
})
export type EmpresaForm = z.infer<typeof empresaFormSchema>
```

```tsx
const form = useForm<EmpresaForm>({
  resolver: zodResolver(empresaFormSchema),
  mode: 'onBlur',              // PATTERNS §6 — não valida a cada tecla
  reValidateMode: 'onChange',  // depois do primeiro erro, corrige ao vivo
  defaultValues,
})
```

Regras:

1. **Um schema por formulário, derivado do contrato da API.** Schema de resposta e schema de formulário são arquivos vizinhos e não se contradizem.
2. **`mode: 'onBlur'`.** Validar durante a digitação acusa erro de um CNPJ pela metade.
3. **Erro no envio:** foco no primeiro campo inválido; resumo no topo acima de três erros ([`PATTERNS.md`](design-system/PATTERNS.md) §6).
4. **Toast não é canal de erro de campo.** Erro de campo fica no campo. Toast é para o resultado da operação (§11).
5. **Rascunho não se perde:** formulário longo (onboarding, folha) guarda rascunho local e avisa ao sair com alteração pendente.
6. **`disabled` vs `readOnly`:** campo bloqueado por regra de negócio é `readOnly` com explicação visível; `disabled` sem motivo na tela é bug de UX.

---

## 9. Máscara, formatação e validação brasileira

**Regra de ouro: o estado guarda o valor cru; a máscara é só apresentação.** O que vai para a API é o dígito, nunca a string formatada.

| Campo | Estado | Exibição | Validação | Erro padrão |
|---|---|---|---|---|
| **Moeda (R$)** | `Centavos` (inteiro) | `Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' })`, mono + `tabular-nums` | `z.number().int()`, faixa quando houver | "Informe um valor válido" |
| **CPF** | 11 dígitos | `000.000.000-00` | dígito verificador próprio, testado | "CPF inválido" |
| **CNPJ** | 14 dígitos | `00.000.000/0000-00` | dígito verificador próprio, testado; **aceita o CNPJ alfanumérico** (regra vigente a partir de 2026) | "CNPJ inválido" |
| **Telefone** | dígitos com DDD | `(00) 00000-0000` / `(00) 0000-0000` | DDD existente + 10 ou 11 dígitos | "Telefone inválido" |
| **E-mail** | string normalizada (trim + minúsculas) | como digitado | `z.email()` | "E-mail inválido" |
| **Data** | **ISO `YYYY-MM-DD`** (data civil, sem hora) | `dd/MM/yyyy`, mono | data real + faixa da regra (ex.: competência) | "Data inválida" |
| **Data e hora** | ISO 8601 com offset | `dd/MM/yyyy HH:mm` em `America/Sao_Paulo` | — | — |
| **Competência** | `YYYY-MM` | `MM/AAAA` | mês entre 1 e 12 | "Competência inválida" |
| **Percentual/alíquota** | inteiro em centésimos de ponto (`1550` = 15,50%) | `15,50%` | faixa 0–100 | "Alíquota inválida" |
| **Chave de acesso** | 44 dígitos | truncada 4…4 ([`PATTERNS.md`](design-system/PATTERNS.md) §3) | 44 dígitos + DV | "Chave de acesso inválida" |
| **CEP** | 8 dígitos | `00000-000` | 8 dígitos | "CEP inválido" |

Implementação:

- Máscara no componente **`InputMasked`** ([`COMPONENTS.md`](design-system/COMPONENTS.md) §1.3), sobre `react-imask`. Não se escreve máscara nova por tela.
- **Validador de CPF/CNPJ é código nosso**, em `lib/validators/`, com teste de tabela cobrindo: válido, DV errado, todos os dígitos iguais, tamanho errado, alfanumérico, com e sem máscara ([ADR-006](adr/ADR-006-mascaras-e-validacao-br.md)).
- **Nunca `parseFloat` em valor monetário.** Conversão de string mascarada para `Centavos` passa por `paraCentavos()`, função pura e testada.
- **Colar valor mascarado funciona.** Colar `"12.345,67"` num campo de moeda resulta em `1234567` centavos.
- Máscara **não impede envio**: campo incompleto gera erro de validação, não bloqueio silencioso de digitação.

---

## 10. Padrão de tela CRUD

Toda entidade administrável do produto segue esta anatomia. Fugir dela exige motivo na PR.

### 10.1 Rotas

```
/<recurso>                     listagem (filtros e página na URL)
/<recurso>/novo                criação (página, quando o formulário é longo)
/<recurso>/[id]                detalhe
/<recurso>/[id]/editar         edição
```

Formulário curto (até ~8 campos) abre em **`Sheet`**; formulário longo, em **página própria**. Nunca `Dialog` para formulário com rolagem.

### 10.2 Listagem (Read)

- Cabeçalho de página conforme [`PATTERNS.md`](design-system/PATTERNS.md) §2 — breadcrumb, H1, uma ação primária.
- **Barra de filtro**: busca com debounce de 300ms, filtros de domínio, botão "Limpar" quando houver filtro ativo. **Tudo na URL.**
- **`DataTable`** (§11), paginada no servidor acima de 100 linhas.
- **Quatro estados obrigatórios** ([`PATTERNS.md`](design-system/PATTERNS.md) §5): Skeleton com a forma da tabela, `EmptyState` nas três variantes (nunca houve dado × filtro sem resultado × erro), erro com `correlationId` copiável, sucesso.
- Contagem total visível ("488 empresas") — o usuário precisa saber o tamanho do universo antes de agir em lote.

### 10.3 Criação e edição (Create/Update)

- Formulário conforme §8; layout conforme [`PATTERNS.md`](design-system/PATTERNS.md) §6.
- Ao salvar: invalidar as chaves da listagem e do detalhe, toast de sucesso, e voltar para onde o usuário estava — preservando filtro e página da URL.
- **Edição parte do dado servido**, não de cópia em store. Conflito (`409`) informa que o registro mudou e oferece recarregar, sem descartar o que foi digitado.

### 10.4 Exclusão (Delete) — na verdade, arquivamento

**Registro de valor fiscal, contábil ou trabalhista não se apaga.** A ação padrão é **arquivar/inativar** (`CLAUDE.md`, "Convenções de código"), preservando a trilha append-only.

- Ação sempre atrás de **`AlertDialog`**, nomeando o registro: *"Arquivar a empresa Padaria Aurora ME (12.345.678/0001-90)?"*.
- **Ação em lote exige a contagem explícita** e o escopo de tenant nomeado: *"Arquivar 47 registros de Toda a base — 488 empresas?"* ([`PATTERNS.md`](design-system/PATTERNS.md) §§4 e 8).
- **Irreversível de verdade** (quando existir, e só por regra do PRD) exige digitar o identificador para confirmar.
- Nunca deletar em um clique. Nunca `confirm()` do navegador.
- Desfazer: quando a operação for reversível, o toast de sucesso traz **"Desfazer"** com janela declarada.

### 10.5 Ações de linha na grid

- Até três ações frequentes ficam **visíveis** como `Button` `ghost` `icon`, com `aria-label` — não escondidas em menu.
- O excedente vai para `DropdownMenu` (`⋯`), com a ação destrutiva **separada por divisor e em `danger`**, no fim.
- Ação de linha **nunca é o único caminho**: o detalhe do registro oferece as mesmas ações.
- Toda ação de linha é operável por teclado, com foco visível.

---

## 11. DataTable — TanStack Table v8

`DataTable` é componente único do projeto ([`COMPONENTS.md`](design-system/COMPONENTS.md) §3.1). Não se escreve tabela nova por tela.

**Contrato:**

| Recurso | Regra |
|---|---|
| Paginação | **Servidor** acima de 100 linhas (`manualPagination`). Tamanhos: 25/50/100. Página e tamanho na URL. |
| Ordenação | `manualSorting`; coluna ordenável tem indicador visual e `aria-sort` |
| Filtro | `manualFiltering`; filtro na URL; busca com debounce 300ms |
| Seleção | `rowSelection` só quando houver ação em lote; barra de ação em lote aparece com a contagem e o escopo |
| Virtualização | acima de 500 linhas visíveis (`@tanstack/react-virtual`) |
| Coluna numérica | alinhada à direita, mono + `tabular-nums` ([`TOKENS.md`](design-system/TOKENS.md) §5.3) |
| Coluna de status | `StatusBadge` com rótulo textual — cor nunca é o único sinal |
| Coluna sugerida por IA | marca `ai` + Aceitar/Rejeitar visíveis ([`PATTERNS.md`](design-system/PATTERNS.md) §4) |
| Densidade | linha 36px ([`PATTERNS.md`](design-system/PATTERNS.md) §10) |
| Estados | Skeleton com o número de colunas real; `EmptyState` correto para cada causa |
| Acessibilidade | `<caption>` ou `aria-label`; `<th scope>`; navegação por teclado |
| Mobile | colapso conforme pendência **P-02** ([`DEBITO.md`](design-system/DEBITO.md)) — enquanto aberta, tabela de fatia nova declara na PR o comportamento adotado abaixo de 768px |

**Infinite scroll é exceção, não padrão.** Listagem fiscal é conferida e auditada: paginação explícita permite dizer "página 3 de 12". Scroll infinito só onde a SPEC pedir feed cronológico (ex.: trilha de auditoria), com âncora estável.

**Definição de coluna vive em `features/<dominio>/columns.tsx`**, tipada por `ColumnDef<T>`, sem JSX de negócio embutido — célula complexa vira componente próprio.

---

## 12. Formatação, fuso e idioma

- **Interface em PT-BR** (`CLAUDE.md`). Código e identificadores em inglês; rótulo, mensagem e texto de erro em português.
- **Fuso de exibição: `America/Sao_Paulo`.** Prazo fiscal vence em horário de Brasília; renderizar em UTC erra o dia da entrega.
- **Data civil (competência, vencimento, data de emissão) não tem fuso.** Trafega e é comparada como `YYYY-MM-DD`. Converter para `Date` do JS para formatar é a origem clássica do bug de "um dia a menos".
- Formatação por `Intl` (`pt-BR`) ou `date-fns` com locale `ptBR`; nunca concatenação manual de string.
- Sem i18n multi-idioma no MVP. Texto de interface centralizado por feature para que a extração futura não seja reescrita.

---

## 13. Feedback ao usuário

**Toda mensagem ao usuário é Toast (Sonner). `alert`, `confirm` e `prompt` são proibidos** (`CLAUDE.md`).

| Tipo | Quando | Duração |
|---|---|---|
| `success` | operação concluída com efeito verificável | 4s |
| `info` | processo iniciado em segundo plano ("Importação em andamento") | 4s |
| `warning` | concluído com ressalva ("Importação concluída: 312 aceitas, 8 rejeitadas" + link para o relatório) | 8s |
| `error` | falhou | **persistente até dispensar**, com `correlationId` copiável |

Regras:

1. **Toast não substitui estado de tela.** Lista que falhou mostra estado de erro *e* toast.
2. **Toast não é canal de erro de validação de campo.**
3. **Um toast por operação.** Lote gera um toast com o agregado, não 47.
4. **Toast de erro carrega o `correlationId`** do `application/problem+json` (§14) — é o que o suporte pede.
5. Toast **nunca** carrega a única cópia de um dado (número de protocolo, recibo). Isso vai para a tela e para a trilha.

---

## 14. Erro de API no cliente

O backend responde `application/problem+json` com `type`, `title`, `status`, `code`, `correlationId` (`CLAUDE.md`).

- O cliente HTTP (`lib/http.ts`) normaliza toda falha nesse formato — inclusive falha de rede, que recebe `code` próprio.
- **`code` é a chave de tradução.** A tela mapeia `code` → mensagem em PT-BR. Nunca se exibe `title` cru do backend nem *stack trace*.
- **Sem mapeamento**, exibe-se mensagem genérica acionável + `correlationId`. Nunca "Erro inesperado" sozinho.
- `401` → sessão expirada, preservando a rota de retorno. `403` → falta de alçada, dizendo qual (carteira, papel, escopo de empresa), sem vazar existência de dado de outro tenant. `409` → conflito de versão (§10.3). `422` → erro de validação, mapeado campo a campo no formulário.
- **`error.tsx` por segmento de rota** e `global-error.tsx` na raiz. Erro em uma seção não derruba a tela inteira ([`PATTERNS.md`](design-system/PATTERNS.md) §5, erro parcial).

---

## 15. Performance

**Metas, medidas no perfil de rede e hardware do contador médio, não no laptop do desenvolvedor:**

| Métrica | Meta |
|---|---|
| LCP (p75) | ≤ 2,5s |
| INP (p75) | ≤ 200ms |
| CLS (p75) | ≤ 0,1 |
| Dashboard com 500 empresas | < 3s (PRD §9.4) |
| JS inicial por rota (gzip) | ≤ 200KB; acima disso, justificativa na PR |

Práticas obrigatórias:

- **Carregamento sob demanda:** `next/dynamic` para gráfico, editor, visualizador de XML, tabela pesada e qualquer coisa abaixo da dobra. Modal e Sheet carregam ao abrir, não no *bundle* da página.
- **Paginação no servidor** acima de 100 linhas; virtualização acima de 500 (§11).
- **Debounce de 300ms** em busca; `AbortController` cancelando a requisição anterior.
- **Skeleton, nunca spinner**, para conteúdo estruturado ([`PATTERNS.md`](design-system/PATTERNS.md) §5).
- **Fonte:** `next/font` com `display: swap` e subset latin; JetBrains Mono efetivamente carregada — o protótipo a declara e nunca a carrega ([`DEBITO.md`](design-system/DEBITO.md)).
- **Imagem:** `next/image` com dimensão declarada. Logo de tenant tem tamanho máximo validado no upload.
- **`useMemo`/`useCallback` só com medição.** Memoização preventiva é ruído.
- **Agregado pesado é pré-calculado no backend** (PRD §9.4). O front não soma 488 empresas no cliente.
- **Bundle medido na CI** por rota; regressão acima do orçamento é achado P2 ([`REVIEW.md`](REVIEW.md)).

---

## 16. Gráficos

**Recharts via `shadcn/ui charts`** ([ADR-007](adr/ADR-007-graficos.md)). Resolve a pendência **P-01** do design system.

- Cor de série sai **exclusivamente de token** (`--chart-1…n`), definida nos dois temas. Nenhum hex literal.
- **Todo gráfico tem alternativa textual**: tabela equivalente acessível (`Ver dados`) ou `aria-label` descrevendo a série. Gráfico não é o único caminho para o número.
- **Tooltip não substitui eixo rotulado.** Valor monetário no gráfico usa a mesma formatação da tabela.
- **Cor nunca é o único diferenciador de série** — padrão, marcador ou rótulo direto.
- Gráfico entra por `next/dynamic` (§15).
- **Proibido:** `<canvas>` desenhado à mão, SVG inline improvisado, `<div>` com largura percentual fingindo barra (o padrão do protótipo — é débito, não referência).

---

## 17. Procedência de IA e HITL no código

[`PATTERNS.md`](design-system/PATTERNS.md) §4 é o contrato visual. Do lado da engenharia:

- Todo campo que pode ter origem de agente trafega com **procedência** (`sugerido` | `confirmado` | `rejeitado`), **score** e **fonte**. O componente não infere procedência a partir da ausência de dado.
- **Sem fonte rastreável, não renderiza como sugestão.**
- Aceitar/Rejeitar são **mutações** com registro na trilha; nunca alteração local silenciosa.
- **Aceitar em lote** exige `AlertDialog` com contagem (§10.4).
- Ação com efeito jurídico (confirmação, desconhecimento, operação não realizada, evento eSocial, geração de guia) **nunca é otimista** e nunca é auto-aprovada na interface (PRD §10.1).

---

## 18. Segurança no cliente

1. **Certificado A1, chave privada e senha de certificado nunca chegam ao front.** Upload vai direto para o endpoint do cofre; a tela mostra apenas metadado (titular, validade, situação).
2. **Token de sessão em cookie `httpOnly`, `Secure`, `SameSite=Lax`.** Nunca `localStorage`.
3. **Nunca `dangerouslySetInnerHTML`** com conteúdo vindo de documento fiscal, nome de fornecedor ou resposta de LLM. XML e texto de terceiro são dado hostil.
4. **Escopo de tenant é reforçado no servidor.** Esconder botão não é controle de acesso; a tela reflete a permissão, não a implementa.
5. **Nenhum `console.log` com dado de cliente** em código de produção — CPF, CNPJ, valor e conteúdo de documento fiscal.
6. CSP sem `unsafe-eval`; origem externa declarada explicitamente.

---

## 19. Qualidade de código

- **ESLint (flat config)** com `typescript-eslint` estrito, `eslint-plugin-jsx-a11y` e `eslint-plugin-react-hooks`. Regra desligada exige comentário com o motivo.
- **Prettier** decide formatação. Discussão de estilo não entra em revisão ([`REVIEW.md`](REVIEW.md)).
- **Componente acima de ~200 linhas ou com mais de um motivo para mudar** é decomposto. Lógica sai para hook; apresentação fica no componente.
- **Função pura de cálculo ou formatação vive em `lib/`**, sem React, sem rede, sem relógio — o "agora" entra por parâmetro (`CLAUDE.md`).
- **Sem número mágico e sem string literal repetida** de domínio: vira constante tipada.
- **Nada de código morto, `TODO` órfão ou componente comentado.** O histórico está no git.

---

## 20. Prova por tela — Definition of Done

Além do aceite geral (`CLAUDE.md`: CI verde) e do aceite de design ([`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) §6), toda fatia com UI prova na PR:

**Obrigatório**

- [ ] Nenhum `any`, `as` supressor, `@ts-ignore` ou `!` no diff
- [ ] Nenhum hex literal nem classe de cor default do Tailwind
- [ ] **Prova visual nos dois temas** (claro e escuro)
- [ ] **Quatro estados** onde há dado remoto: carregando (Skeleton), vazio (variante certa), erro (com `correlationId`), sucesso
- [ ] Toda mensagem por Toast; nenhum `alert`/`confirm`
- [ ] Ação destrutiva atrás de `AlertDialog` com o registro nomeado
- [ ] Máscara e validação conforme §9, com teste do validador
- [ ] Moeda em centavos no estado; nenhum `parseFloat` em dinheiro
- [ ] Filtro, ordenação e página na URL
- [ ] Tabela acima de 100 linhas paginada no servidor
- [ ] Chave de query com `tenantId` e `empresaId`
- [ ] Navegação completa por teclado e foco visível; `aria-label` em botão só com ícone
- [ ] Responsivo em 768 / 1024 / 1440
- [ ] Teste de componente dos estados e do caminho de erro ([`TESTING.md`](TESTING.md))

**Quando aplicável**

- [ ] Valor sugerido por IA com marca `ai`, score, fonte e Aceitar/Rejeitar visíveis
- [ ] Ação em lote com contagem e escopo de tenant nomeados
- [ ] E2E Playwright do caminho crítico da fatia
- [ ] Orçamento de bundle da rota respeitado
- [ ] Gráfico com alternativa textual

Item não verificável no ambiente é **`not_run`** na PR, **nunca** `pass` (`CLAUDE.md`).

---

## 21. Proibido

| Proibido | Em vez disso |
|---|---|
| `alert`, `confirm`, `prompt` | Toast (Sonner) e `AlertDialog` |
| Componente HTML nativo de interação (`select`, `dialog`, `input[type=date]`) | shadcn/ui |
| Gráfico nativo, `<canvas>` à mão, barra de `<div>` percentual | Recharts via shadcn charts |
| `float`/`number` decimal para dinheiro | `Centavos` (inteiro) |
| `useEffect` + `fetch` para carregar dado | TanStack Query |
| Dado de servidor em Zustand ou Context | cache do Query |
| Filtro e ordenação em estado local | URL |
| Spinner no lugar de tabela | Skeleton |
| Exclusão física de registro fiscal | arquivamento + trilha |
| Otimismo em ação com efeito jurídico | confirmação real do servidor |
| `localStorage` para token | cookie `httpOnly` |
| `dangerouslySetInnerHTML` com dado de terceiro | renderização segura |
| Hex literal e cor default do Tailwind | token do design system |
| Deletar em um clique | `AlertDialog` com o registro nomeado |

---

## Referências

- [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) — contrato de design
- [`design-system/TOKENS.md`](design-system/TOKENS.md) · [`COMPONENTS.md`](design-system/COMPONENTS.md) · [`PATTERNS.md`](design-system/PATTERNS.md) · [`DEBITO.md`](design-system/DEBITO.md)
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — desenho do sistema · [`CONVENTION.md`](CONVENTION.md) — domínio
- [`TESTING.md`](TESTING.md) · [`REVIEW.md`](REVIEW.md) · [`PRS.md`](PRS.md) · [`CI-PR.md`](CI-PR.md)
- [`DECISIONS.md`](DECISIONS.md) e [`adr/`](adr/) — decisões registradas
- [Next.js](https://nextjs.org/docs) · [shadcn/ui](https://ui.shadcn.com) · [TanStack Query](https://tanstack.com/query/latest) · [TanStack Table](https://tanstack.com/table/latest) · [React Hook Form](https://react-hook-form.com) · [Zod](https://zod.dev) · [Sonner](https://sonner.emilkowal.ski)
