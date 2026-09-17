# PATTERNS.md — Padrões de Composição

> **Normativo.** [COMPONENTS.md](COMPONENTS.md) diz o que existe; este documento diz como se combina numa tela.
> Um padrão daqui vale para toda tela do produto. Tela que precisa fugir de um padrão registra o motivo na PR.

---

## 1. Shell da aplicação

O protótipo tem três shells diferentes (canônico `w-72`, portal `w-64`, dark carbon `h-20`). **Existe um shell só.**

```
┌────────────┬──────────────────────────────────────┐
│            │  Topbar  h-16  (fixa)                │
│  Sidebar   ├──────────────────────────────────────┤
│   264px    │                                      │
│   (fixa)   │  main                                │
│            │   └ Cabeçalho de página              │
│            │   └ Barra de filtro (opcional)       │
│            │   └ Conteúdo                         │
└────────────┴──────────────────────────────────────┘
```

Duas variantes de **dados**, não de estrutura:

| Variante | Quem usa | Diferença |
|---|---|---|
| `standard` | Escritório contábil | Navegação completa, seletor de empresa, telemetria fiscal |
| `portal` | Cliente white-label | Navegação reduzida, marca do escritório, seletor de competência no lugar do de empresa, sem fila HITL |

Responsivo: em `< 768px` a sidebar vira drawer e a topbar mantém só marca, menu e perfil.

---

## 2. Cabeçalho de página

O protótipo alterna entre eyebrow de RF e breadcrumb, sem regra. **Canonizado:**

```
Breadcrumb                                    [ações secundárias] [ação primária]
H1 (headline-lg)
Descrição (body-md, --muted-foreground, max-w-3xl)
```

- **Breadcrumb sempre**, `label-sm`, separador `chevron_right`. Último item é a página atual, sem link.
- **H1 sempre**, `headline-lg`. Uma tela do protótipo não tem H1 — isso é bug de acessibilidade, não estilo.
- **Descrição opcional**, mas se existir explica o que a tela faz, não repete o título.
- **Eyebrow de RF (`RF-06 • Motor V3.0`) não vai para produção.** É rastreabilidade de protótipo; o usuário final não sabe o que é RF-06.
- **Uma ação primária.** O resto é `secondary` ou `outline`.

---

## 3. Identificador fiscal

Regra transversal: todo identificador fiscal é mono + `tabular-nums`.

| Identificador | Exibição |
|---|---|
| CNPJ | `00.000.000/0000-00` completo, `code-sm` |
| CPF | `000.000.000-00` completo, `code-sm` |
| Chave de acesso (44 díg.) | **Truncada:** 4 primeiros + `…` + 4 últimos, `code-xs`. Completa em tooltip e copiável em um clique. |
| Hash SHA-256 | Truncada: 8 + `…` + 4 |
| NSU | Completo, `code-xs` |
| CFOP / NCM / CST / CNAE | `CodeChip` completo |

Truncar é decisão de layout; **o valor completo tem que estar sempre acessível** — tooltip, cópia ou detalhe. Um contador que precisa conferir uma chave contra a Sefaz não pode depender de um valor cortado.

Cópia: ícone `content_copy` ao passar o mouse, com confirmação por toast.

---

## 4. Procedência de IA e HITL

O padrão mais importante do produto. O usuário precisa saber, **sem clicar**, o que foi decidido por máquina e o que foi confirmado por humano.

### Três estados, sempre visíveis

| Estado | Marca visual | Significado |
|---|---|---|
| **Sugerido** | Token `ai` — chip "IA" + valor | Máquina propôs. Nenhum humano olhou. |
| **Confirmado** | Sem marca de IA | Humano aceitou. Vira dado normal. |
| **Rejeitado** | Volta ao valor anterior + entrada na trilha | Humano recusou. |

Regras:

1. **Todo valor sugerido carrega a marca `ai` até ser confirmado.** Sem exceção — nem em tabela densa, nem em impressão.
2. **Toda sugestão tem Aceitar e Rejeitar visíveis.** Rejeitar nunca fica escondido em menu.
3. **Confiança é mostrada quando existe**, em `code-xs`. Nunca como única justificativa: "97%" não explica nada sozinho.
4. **Sugestão tem fonte rastreável.** Regra aplicada, documento de origem ou norma. Sem fonte, não é sugestão — é palpite, e não se renderiza.
5. **Aceitar em lote exige confirmação** com a contagem explícita ("Aceitar 47 sugestões?"). Ação de um clique sobre dezenas de lançamentos fiscais é irreversível na prática.
6. **Toda transição vai para a trilha append-only** — quem, quando, valor antes, valor depois.

O token `ai` é exclusivo disso. Usar dourado por estética apaga o único sinal que diferencia máquina de humano.

---

## 5. Estados de tela

Toda tela que carrega dado remoto implementa os quatro, sem exceção:

| Estado | Tratamento |
|---|---|
| **Carregando** | Skeleton com a forma do conteúdo. Nunca spinner no lugar de uma tabela. |
| **Vazio** | `EmptyState` com o texto certo para o caso — nunca houve dado × filtro sem resultado × erro. São três mensagens diferentes ([COMPONENTS.md §3.7](COMPONENTS.md#37-emptystate)). |
| **Erro** | O que falhou, em linguagem de contador, e o que fazer. `correlationId` visível e copiável para suporte. |
| **Sucesso** | Conteúdo. |

O protótipo não tem nenhum dos três primeiros — toda tela vem populada com mock. Implementar só o caminho feliz é entregar metade da tela.

**Erro parcial existe:** se 3 de 500 empresas falharem ao carregar, mostra-se as 497 e sinaliza as 3. Não se derruba a tela inteira.

---

## 6. Formulário

- **Uma coluna** por padrão. Duas apenas quando os campos são curtos e pareados (cidade/UF, data inicial/final).
- **Label acima do campo, sempre visível.** Placeholder não é label — some ao digitar.
- **Obrigatório marcado com `*`** em `danger`, com legenda no topo do formulário.
- **Validação ao sair do campo** (`onBlur`), não a cada tecla. Validar durante a digitação acusa erro de um CNPJ pela metade.
- **Erro no envio:** foco vai para o primeiro campo inválido, e um resumo aparece no topo se houver mais de três erros.
- **Texto de ajuda antes de digitar; erro depois.** A mensagem de erro substitui a ajuda no mesmo espaço, sem empilhar e sem empurrar o layout.
- **Ação primária à direita**, no rodapé do formulário. Cancelar é `ghost` e fica à esquerda dela.
- **Nunca desabilitar o botão de envio por causa de validação.** Deixar clicável e mostrar os erros — botão desabilitado sem explicação não diz ao usuário o que falta.

Valor monetário: inteiro em centavos no estado, máscara na exibição. Float é proibido (`CLAUDE.md`).

---

## 7. Acessibilidade

O protótipo é praticamente inacessível: sem `focus-visible`, sem trap de foco, sem `role`, `aria-current` só numa tela, ações de linha rotuladas apenas por `title`. Nada disso é herdado.

Piso obrigatório, verificado por tela:

1. **Foco visível em tudo que recebe foco.** Anel `--ring`, 2px, offset 2px. Nunca `outline: none` sem substituto.
2. **Ordem de tabulação segue a ordem visual.** Sem `tabindex` positivo.
3. **Botão só com ícone tem `aria-label`.** `title=` não basta.
4. **Overlay prende o foco**, fecha com ESC e devolve o foco ao gatilho.
5. **Contraste:** 4.5:1 em texto normal, 3:1 em texto grande e em borda de controle — **nos dois temas**. Um token que passa no claro e reprova no escuro é bug de token.
6. **Cor nunca é o único sinal.** Semáforo fiscal sempre acompanha rótulo.
7. **Tabela tem `<caption>` ou `aria-label`**; header usa `<th scope>`.
8. **Atualização assíncrona anuncia em `aria-live`** — conclusão de lote, chegada de sugestão.
9. **`prefers-reduced-motion` desliga animação em laço.** `animate-ping` e `animate-pulse` são sinais de estado; sob reduced-motion viram estático, não somem.
10. **Um `<h1>` por página**, hierarquia sem pular nível.

Alvo de toque mínimo 44×44px em mobile, mesmo quando o visual é menor.

---

## 8. Escopo multi-tenant

O produto opera em dois níveis: escritório → empresa cliente. Errar o escopo é vazamento de dado entre tenants.

1. **A empresa ativa fica sempre visível na topbar.** Nunca só na URL.
2. **Trocar de empresa recarrega o escopo inteiro** e mostra carregamento. Nenhum dado da empresa anterior permanece na tela.
3. **Visão consolidada é rotulada como tal** ("Toda a base — 488 empresas"). Consolidado e individual nunca se parecem.
4. **Toda ação em lote nomeia o escopo** antes de confirmar.
5. **Nível de RLS visível** onde há dado sensível.

---

## 9. Tema

1. **Os dois temas são contrato.** Tela entregue só no claro está incompleta.
2. **Prova por tela nos dois temas** — a evidência da PR inclui as duas.
3. **Tema resolvido antes da primeira pintura.** Flash de tema errado é bug.
4. **Nada de valor condicionado a tema no componente.** Se um componente precisa de `if (theme === 'dark')`, falta token.
5. **Sombra não substitui borda no escuro.** Sombra preta sobre carbono não aparece; profundidade vem de tonalidade + borda.
6. **Contraste verificado nos dois** ([§7](#7-acessibilidade)).

---

## 10. Densidade

O produto é de alta densidade: um contador monitora centenas de CNPJs por viewport. Mas densidade é subordinada à legibilidade.

- Linha de tabela 36px, padding de célula `space-sm`.
- Texto de dado nunca abaixo de `body-sm` (13px). `label-sm` (11px) é só para rótulo e metadado, nunca para valor.
- Ícone nunca abaixo de `icon-xs` (14px). O protótipo tem ícones de 10px — ilegíveis.
- Card em grade de 4 colunas no desktop, 2 no tablet, 1 no mobile.

---

## 11. Performance

- **Tabela acima de 100 linhas é paginada no servidor.** Carteira de 488 empresas não vem inteira.
- **Acima de 500 linhas visíveis, virtualiza.**
- **Busca com debounce de 300ms.**
- **Estado de filtro e ordenação na URL**, não em estado local — tela de auditoria precisa ser compartilhável.
- **Otimista só no reversível.** Marcar item como lido, sim. Transmitir obrigação fiscal, não: espera a confirmação real.

---

## Referências

- [TOKENS.md](TOKENS.md) — valores
- [COMPONENTS.md](COMPONENTS.md) — catálogo
- [DEBITO.md](DEBITO.md) — divergências do protótipo
- [DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md) — contrato
