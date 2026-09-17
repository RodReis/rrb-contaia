# DESIGN-SYSTEM.md — ContaIA

> **Contrato de design da interface.** Define o que é normativo, quem decide o quê, e como uma entrega de UI prova que cumpriu o design system.
> Os valores e catálogos vivem em [`docs/design-system/`](design-system/README.md). Este documento é a governança.

---

## 1. O que este documento decide

O ContaIA é um SaaS contábil multi-tenant para escritórios brasileiros. Um contador abre a aplicação para descobrir, em segundos, **qual das suas centenas de empresas está prestes a tomar multa** — e para distinguir o que uma máquina propôs do que um humano conferiu.

Disso saem as três obrigações não-negociáveis da interface:

1. **O semáforo fiscal é legível em varredura periférica.** Conforme, atenção e crítico se distinguem sem leitura atenta e sem depender só de cor.
2. **Procedência é sempre visível.** Valor sugerido por IA nunca se parece com valor confirmado por humano.
3. **Número alinha.** Moeda, chave de acesso e identificador em fonte mono com `tabular-nums`, para conferência coluna a coluna.

Interface que falha em qualquer uma delas está errada, ainda que bonita.

---

## 2. Base

| Decisão | Valor | Origem |
|---|---|---|
| Framework | Next.js | PRD §14 |
| CSS | Tailwind | PRD §14 |
| Biblioteca de componentes | **shadcn/ui** — "nada de componente nativo, só em caso de exceção" | PRD §14 |
| Vocabulário de token | shadcn (`--background`, `--card`, `--muted`…) | Decisão do PI |
| Temas | **Dois: CLARO e ESCURO**, ambos normativos | Decisão do PI |
| Mecanismo de tema | `data-theme` no `<html>` + CSS custom properties | [DEBITO.md D-01](design-system/DEBITO.md#d-01) |
| Toast | Sonner | `CLAUDE.md` |
| Famílias | Geist (display) · Inter (UI) · JetBrains Mono (fiscal) | `docs/telas/DESIGN-*.md` |

**Dois temas significa dois temas.** Uma tela entregue só no claro não está entregue.

---

## 3. Documentos

| Documento | Conteúdo |
|---|---|
| [design-system/TOKENS.md](design-system/TOKENS.md) | Cor, espaçamento, tipografia, raio, elevação, ícone, movimento, breakpoint — nos dois temas |
| [design-system/COMPONENTS.md](design-system/COMPONENTS.md) | Catálogo: o que existe, o que vem do shadcn, o que é nosso |
| [design-system/PATTERNS.md](design-system/PATTERNS.md) | Composição: shell, cabeçalho, estados, formulário, acessibilidade, multi-tenant |
| [design-system/DEBITO.md](design-system/DEBITO.md) | Divergências decididas contra o protótipo, com justificativa |
| [design-system/README.md](design-system/README.md) | Índice e ordem de leitura |

---

## 4. Precedência

```
PRD  >  DESIGN-SYSTEM.md + docs/design-system/  >  docs/FRONTEND.md  >  docs/telas/  >  docs/prototipo/
```

- **PRD vence sempre.** Divergência com o PRD é `[FIX]`, não interpretação.
- **`docs/FRONTEND.md`** é o contrato de *engenharia* da interface (stack, tipagem, padrão de tela CRUD, prova por tela); este é o contrato de *design*. Onde tratarem do mesmo assunto sem se contradizer, valem os dois. Se se contradisserem, é defeito de documento: pergunta ao PI.
- **`docs/telas/` é referência, não contrato.** É protótipo gerado por ferramenta. Os defeitos estão catalogados em [DEBITO.md](design-system/DEBITO.md).
- **`docs/telas/DESIGN-CLARO.md` e `DESIGN-ESCURO.md`** são a direção original. Descrevem intenção, e o protótipo nem sempre a cumpriu.

**A regra operacional:** quando o protótipo e estes documentos discordarem, **segue-se o documento** e consulta-se [DEBITO.md](design-system/DEBITO.md) para entender por quê. Não se replica defeito por fidelidade.

---

## 5. O protótipo, honestamente

`docs/telas/` tem 23 telas que valem muito como referência de **conteúdo e fluxo** — o que cada tela mostra, em que ordem, com que dado. Como referência **visual**, tem defeitos catalogados. Os de maior consequência:

| Achado | Alcance |
|---|---|
| `radius-full` declarado como `0.75rem` em vez de `9999px` | ~390 avatares, dots e pílulas renderizam quadrados — **21 de 21 telas** |
| JetBrains Mono nunca carregada | ~1.971 células fiscais em fallback sans-serif — **11 telas** |
| `tabular-nums` ausente | **zero ocorrências** no protótipo inteiro, apesar de ambas as direções exigirem |
| Sem token de sucesso no tema claro | "Conforme" renderiza **cinza** na maioria das telas |
| `secondary` com três papéis | dourado-IA e alerta no claro, verde-sucesso no escuro — **mesmo nome, significados opostos** |
| Três telas fora do design system | 966 classes Tailwind default; são redesenhos, não referência |
| Sem overlay, estado vazio, skeleton, erro de campo, máscara, gráfico | **não existem** no protótipo; especificados do zero |

Cada um está registrado com contagem e justificativa em [DEBITO.md](design-system/DEBITO.md).

**Consequência a aceitar de saída:** telas implementadas **não vão ser pixel-idênticas ao protótipo**, e isso é correção, não desvio. Divergência prevista e justificada não é defeito de entrega.

---

## 6. Aceite de uma entrega de UI

Além do aceite geral de `CLAUDE.md` (CI verde), toda fatia de UI prova:

### Obrigatório

- [ ] **Nenhum hex literal e nenhuma classe de cor default do Tailwind** no código de aplicação
- [ ] **Prova visual nos dois temas** — claro e escuro, na evidência da PR
- [ ] **Quatro estados de tela** onde há dado remoto: carregando, vazio, erro, sucesso
- [ ] **Foco visível** em tudo que recebe foco; navegação completa por teclado
- [ ] **Contraste** 4.5:1 em texto normal e 3:1 em texto grande e borda de controle, **nos dois temas**
- [ ] **Valor monetário e identificador fiscal** em mono com `tabular-nums`
- [ ] **Componente novo** registrado em [COMPONENTS.md](design-system/COMPONENTS.md) na mesma PR
- [ ] **Responsivo** em 768 / 1024 / 1440
- [ ] **Semáforo fiscal** com rótulo textual, não só cor
- [ ] **Tela final desde a primeira fatia**, sem wireframe, shadcn-default genérico ou dívida visual deliberadamente empurrada para depois
- [ ] **Fidelidade comprovada ao protótipo correspondente** em conteúdo, fluxo, hierarquia e densidade, corrigindo as divergências catalogadas em `DEBITO.md`
- [ ] **`frontend-design` aplicada** dentro da direção visual existente; não como autorização para redesign
- [ ] **`impeccable` aplicada após a conclusão funcional**, com inspeção conjunta de desktop/mobile, correção em lote e no máximo uma confirmação final
- [ ] **Evidência comparativa** nos temas CLARO e ESCURO e nos viewports exigidos por `FRONTEND.md` §20.1

### Quando aplicável

- [ ] **Valor sugerido por IA** com marca `ai` e ações Aceitar/Rejeitar visíveis
- [ ] **Ação irreversível** atrás de `AlertDialog` com confirmação explícita
- [ ] **Escopo de tenant** visível antes de qualquer ação em lote
- [ ] **Tabela acima de 100 linhas** paginada no servidor
- [ ] **Filtro e ordenação** na URL

Item não verificável no ambiente é `not_run` na PR, **nunca** `pass` (`CLAUDE.md`).

---

## 7. Papéis

| Quem | Faz | Não faz |
|---|---|---|
| **PI** | Decide direção visual, resolve pendência de produto, aceita entrega | Não implementa |
| **Cowork** | Mantém estes documentos, escreve direto na `main` | Não escreve código |
| **Code/Codex** | Implementa seguindo os documentos; propõe acréscimo a [COMPONENTS.md](design-system/COMPONENTS.md)/[DEBITO.md](design-system/DEBITO.md) pela PR | Não inventa regra de produto; não reescreve decisão registrada |

### O que bloqueia o Code numa tarefa de UI

Os mesmos dois casos de `CLAUDE.md`, sem terceiro:

1. **Decisão de produto que não existe em documento nenhum** e escolher seria criar regra. As já conhecidas estão em [DEBITO.md § Pendências](design-system/DEBITO.md#pendências-de-produto).
2. **Problema técnico da spec** — inexequível, ou contradiz este documento, `ARCHITECTURE.md`, `CONVENTION.md` ou um ADR.

**Não bloqueia:** protótipo divergir do documento (o documento vence), faltar token para caso novo (propõe na PR), shadcn não cobrir um componente (escreve e registra).

---

## 8. Pendências que bloqueiam fatia

| ID | Pendência | Bloqueia |
|---|---|---|
| **P-01** | Biblioteca e tipos de gráfico. **O protótipo não tem um único gráfico** — toda "visualização" é `<div>` com largura percentual. Se alguma SPEC pedir gráfico de verdade, é decisão nova. | Relatórios Gerenciais, Dashboard — se a SPEC pedir gráfico |
| **P-02** | Colapso de tabela em mobile: quais colunas sobrevivem no card e o que acontece com a ação de linha. Sem referência no protótipo. | Primeira fatia com tabela que precise de mobile real |

Detalhe em [DEBITO.md § Pendências](design-system/DEBITO.md#pendências-de-produto).

---

## 9. Evolução

- **Token novo** exige justificativa em [TOKENS.md](design-system/TOKENS.md) e existência nos dois temas.
- **Componente novo** entra em [COMPONENTS.md](design-system/COMPONENTS.md) na mesma PR, depois de verificado que o shadcn não cobre e que não existe equivalente no projeto.
- **Mudança em token existente** afeta todas as telas: exige decisão do PI e prova visual de regressão.
- **Item de [DEBITO.md](design-system/DEBITO.md) não é apagado ao ser resolvido.** Débito vira histórico — quem ler daqui a seis meses precisa saber por que o código não parece com o protótipo.
