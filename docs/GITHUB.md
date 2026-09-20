# GITHUB.md — Branches, commits e merges

> **Normativo.** Como o trabalho entra na `main`.
> Pull request é assunto de [`PRS.md`](PRS.md); a pipeline é de [`CI-PR.md`](CI-PR.md); a rotina de autoria e evidência é de [`AUDIT.md`](AUDIT.md).

---

## 1. Modelo: trunk-based com branch curta

Uma linha só — `main` — sempre liberável. Todo trabalho nasce dela e volta por PR com CI verde.

```
main ──●──────●──────●──────●──────●─────▶
        \            /      \      /
         ●──●──●────        ●──●──
      feat/F7-cadastro   fix/area-negativa
```

- **`main` é protegida.** Nunca recebe commit direto de código (`CLAUDE.md`).
- **Exceção única:** o **Cowork** escreve documento de governança direto na `main`, sem PR, sem CI e sem aceite — e só os arquivos da sua lista (`CLAUDE.md`, `docs/prd/`, `docs/adr/`, `docs/APRENDIZADOS.md`, índice do `STATUS.md`, `docs/design-system/`).
- **Branch é curta: um card, idealmente ≤ 2 dias.** Branch viva por uma semana vira conflito, rebase caro e revisão impossível.
- **Não existe `develop`, `release` nem `hotfix`.** Correção urgente é uma branch curta como qualquer outra.
- **Worktree por card** (`superpowers:using-git-worktrees`) — evita `stash` e checkout misto.

---

## 2. Nome de branch

```
<tipo>/<SPEC|FIX|GATE|INFRA>-<slug-curto>
```

| Tipo | Uso | Exemplo |
|---|---|---|
| `feat` | fatia com spec | `feat/SPEC-007-cadastro-empresa` |
| `fix` | correção | `fix/FIX-area-talhao-negativa` |
| `infra` | CI, build, tooling | `infra/INFRA-cache-pnpm` |
| `chore` | dependência, limpeza sem efeito de produto | `chore/bump-drizzle` |
| `docs` | documentação de entrega do Code | `docs/testing-evidencia` |

Regras: minúsculas, hífen, sem acento, sem `#`, máximo ~50 caracteres. O número de SPEC/FIX no nome é o que liga a branch ao card sem depender de memória.

---

## 3. Commits — Conventional Commits

```
<tipo>(<escopo>): <assunto no imperativo, ≤ 72 caracteres>

<corpo: o porquê, não o que — o diff já diz o que>

refs #<issue>
```

**Tipos:** `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `revert`.

**Escopo:** o pacote ou domínio — `web`, `api`, `workers`, `signer`, `ai`, `db`, `fiscal`, `dp`, `financeiro`, `ci`.

**Breaking change:** `!` após o escopo e rodapé `BREAKING CHANGE: <o que quebrou e como migrar>`.

Exemplos:

```
feat(fiscal): manifestar ciência da emissão ao capturar DF-e

A ciência precisa ser imediata para liberar o download do XML completo
antes da análise de risco (PRD §5.2).

refs #42
```

```
fix(web): aceitar CNPJ alfanumérico no cadastro de empresa

refs #58
```

**Regras:**

1. **Idioma: PT-BR** no assunto e no corpo (`CLAUDE.md`). Tipo e escopo em inglês.
2. **Imperativo, sem ponto final:** "adiciona", não "adicionado" nem "adicionando".
3. **Um commit, uma ideia.** Commit que precisa de "e" no assunto são dois commits.
4. **`refs #N` no rodapé. Nunca `closes #N`** — fechar issue é aceite do PI (`CLAUDE.md`).
5. **Commits coerentes e push frequente** para não perder trabalho (`CLAUDE.md`). Checkpoint remoto vale mais que histórico perfeito na branch — o squash limpa depois.
6. **Nunca `git add -A` em checkout misto.** Adiciona o que é do card, arquivo por arquivo.
7. **Nada de segredo, `.env`, certificado, `.pfx`, `.p12` ou XML de cliente no commit.** Segredo vazado é rotação de chave, não `git rm`.
8. **Sem commit de artefato gerado** (`graphify-out/`, `.next/`, `dist/`, `coverage/`).
9. Rodapé de atribuição de agente conforme a convenção vigente do repositório.

---

## 4. Sincronização com a `main`

O Cowork pusha documento direto; quem colide é o Code, com branch aberta enquanto a `main` andou.

- **Rebase, nunca merge da `main` para dentro da branch.** `git pull --rebase origin main`. Histórico linear, revisão legível, bissecção útil.
- **O Code reaplica o próprio trabalho por cima** e **nunca desfaz linha escrita pelo Cowork** (`CLAUDE.md`).
- **`STATUS.md` divergente: a versão da `main` vence**; o Code reaplica só o próprio progresso.
- **Force-push só na própria branch de PR**, e com `--force-with-lease`. Nunca na `main`.
- **Nunca reescrever histórico já mergeado.**

---

## 5. Entrada na `main`: squash merge

- **Squash merge é o único modo.** Um card vira um commit na `main`.
- **A mensagem do squash é o título e o resumo da PR**, não a lista de commits intermediários. Ela precisa fazer sentido para quem ler `git log` em seis meses.
- **CI verde no SHA atual** é pré-condição, sem exceção (`CLAUDE.md`). PASS antigo não vale para código novo.
- **Branch atualizada com a `main`** antes do merge.
- **Branch é excluída após o merge.**
- **Merge queue não está habilitada** ([ADR-009](adr/ADR-009-ci-runner-e-merge-queue.md)): com um único aprovador e fila curta, ela só acrescenta uma rodada de CI. Reavaliar quando houver mais de um autor concorrente ou fila de PRs esperando gate.

Confirmar `mergedAt`/`mergeSha` na origem antes de declarar integrado (`CLAUDE.md`).

---

## 6. Proteção da `main` (ruleset)

| Regra | Valor |
|---|---|
| Push direto de código | bloqueado |
| PR obrigatória para código | sim |
| Required status checks | `gate` (job agregado — ver [`CI-PR.md`](CI-PR.md)) |
| Branch atualizada antes do merge | sim |
| Squash como único método | sim |
| Force-push e exclusão da `main` | bloqueados |
| Aprovação humana extra | **não** — o fluxo é solo; exigir aprovador inexistente trava a entrega (`CLAUDE.md`) |
| Assinatura de commit | recomendada, não obrigatória no MVP |

**Alterar ruleset, exigência de review, auto-merge nativo ou atualização obrigatória de branch exige escopo e autorização próprios** (`CLAUDE.md`). Não é decisão livre do agente.

---

## 7. Issues e rastreabilidade

- Título conforme `CLAUDE.md`: `[MVP<n>][SPEC-<nnn>][<F<n>|FIX|GATE|INFRA|TEST>] <título livre>`.
- Labels de ciclo de vida: `proplan:planejado` → `backlog` → `todo` → `doing` → `done` → `finalizado`.
- **Quem move o quê está em `CLAUDE.md`.** Nenhuma automação fecha issue: o fechamento é aceite do PI.
- **`proplan:done` só com o comentário de encerramento publicado** (skill `fechar-card`): Resumo da implementação, Aprendizado, Imprevistos.
- A issue é a fonte de verdade da entrega; o resumo no chat aponta para ela.

---

## 8. Tags e release

- Versionamento semântico na tag: `v<major>.<minor>.<patch>`.
- Tag anotada, criada a partir de um commit da `main` com CI verde.
- Notas de release geradas dos commits do intervalo — daí a exigência de assunto legível (§3).
- Enquanto o produto estiver pré-MVP, `v0.x` e tag só em marco de MVP (`[GATE]`).

---

## 9. Título da issue

`[MVP<n>][SPEC-<nnn>][<F<n> | FIX | GATE | INFRA | TEST>] <título livre>` — tokens nesta ordem, seguidos de espaço e título livre. **Só entra token que é verdade**; o que não existe, omite. Nunca o número nu, sempre o par.

- Fatia com spec → `[MVP2][SPEC-007][F7] Cadastro de talhão com área e cultura`
- Correção ligada a uma spec → `[MVP2][SPEC-007][FIX] área do talhão aceita valor negativo`
- Correção ligada só a ADR/doc → `[MVP1][FIX] custo por hectare ignora insumo sem nota`
- Portão de MVP → `[MVP3][GATE] Homologação da integração meteorológica`
- Processo/infra → `[INFRA] CI: relatório de testes por SPEC/issue`
- Card de teste/descartável → `[TEST] ...`

## Ciclo de vida do card — labels `proplan:*` e quem move

| Transição | Quem | Quando |
|---|---|---|
| → `planejado` | Cowork | spec em rascunho, dúvidas abertas com o PI |
| `planejado` → `backlog` | Cowork | dúvidas resolvidas; **mesma issue** (troca o label, não cria outra), assignee PI, corpo com link para a Slice do PRD |
| `backlog` → `todo` | Cowork | os próximos 5 cards da ordem de implementação |
| `todo` → `doing` | Code | ao iniciar o card — sempre o primeiro `todo` da ordem |
| `doing` → `done` | Code | após confirmar o merge na origem **e publicar o comentário de encerramento** na issue; link do PR no corpo da issue |
| `done` → `finalizado` + fechar a issue | **PI** | aceite. Só o PI. Nenhuma automação fecha issue |

Não existe label `proplan:next`/`proplan:proximo`: ao terminar um card, o Code apenas **registra em comentário/PR** qual é o próximo `todo` da ordem antes de seguir para ele — não é uma transição de label.

### Hierarquia das issues

- Cada MVP tem exatamente uma issue-pai estrutural, com título `[MVP<n>] <título do MVP no PRD>` e corpo com link para `docs/prd/mvp/MVP-*.md`.
- Todo card que contém `[MVP<n>]` no título — fatia, correção, gate ou teste daquele MVP — é criado ou imediatamente vinculado como **sub-issue nativa do GitHub** dessa issue-pai. Referência textual no corpo não substitui o vínculo nativo.
- A issue-pai não recebe label `proplan:*`: ela organiza a swimlane e o progresso no ProPlan, mas não é card executável nem ocupa coluna.
- Card sem MVP, como `[INFRA]` transversal ou `[TEST]` descartável sem vínculo com um MVP, permanece na raiz (`Sem épico`).
- O Cowork confirma o vínculo pai–filha no GitHub antes de considerar a criação concluída. Se a primeira fatia de um MVP for criada e a issue-pai ainda não existir, cria o pai primeiro.

### Encerramento de card (obrigatório)

Depois do merge confirmado na origem e **antes** de aplicar `proplan:done`, o Code publica na issue do card um comentário de encerramento com três seções: **Resumo da implementação**, **Aprendizado** e **Imprevistos**. Formato, regras de conteúdo e comandos: skill `fechar-card`.

`proplan:done` só pode ser aplicada se esse comentário existir — issue em `proplan:done` sem comentário de encerramento é violação de processo e o PI devolve o card. Seção sem conteúdo real recebe "Nenhum": ninguém inventa aprendizado nem imprevisto para preencher template. Aprendizado só entra com fonte verificável (doc oficial, commit, log, comando). O comentário na issue é a fonte de verdade da entrega; o resumo no chat só aponta para ele. A seção **Aprendizado** é consolidada pelo Cowork em `docs/APRENDIZADOS.md` no fecho de cada MVP — protocolo no cabeçalho daquele arquivo.

Aceite verde para uma entrega é **CI verde** — nada mais.

O Code só para quando `todo` está vazio ou quando cai num dos dois casos abaixo.

## O que bloqueia o Code — dois casos, não há terceiro

1. **Decisão de produto que não existe em nenhum documento** (spec, PRD, ADR) e que escolher seria criar regra → pergunta ao PI.
2. **Problema técnico da spec** — inexequível, ou contradiz `docs/ARCHITECTURE.md`, `docs/CONVENTION.md` ou um ADR → pergunta ao PI.

Documento faltando não bloqueia. ADR não bloqueia. Falta de spec não bloqueia. Se está parado por qualquer outro motivo, o motivo está errado: implementa e registra a decisão no PR.

Tudo o mais — nome de campo, ordem de implementação interna, estrutura de pasta, dublê de teste, como testar, se cabe refactor junto — **é do Code, decide na hora**. Errou? É reversível: corrige no PR seguinte.

**Bug:** comportamento já documentado (ADR, `ARCHITECTURE.md`, `CONVENTION.md`, `STATUS.md`) que está errado → o Code cria o card `[FIX]` em Backlog, cita a fonte no corpo e segue o fluxo normal, sem esperar ninguém. Se o comportamento correto **ainda não existe** e escolhê-lo é decisão de produto, é o caso 1.

## Git: dois atores escrevem — quem cede no conflito

- O Cowork pusha documento direto na `main`. É o único caminho do processo sem PR, CI ou aceite, e vale **só para os documentos que ele mantém**.
- **Todo código entra por PR com CI verde, sem exceção.** Nunca commit de código direto na `main`.
- Divisão **por arquivo**: governança (`CLAUDE.md`, `docs/prd/mvp/spec/`, `docs/prd/`, `docs/adr/`, `docs/APRENDIZADOS.md`, índice do `STATUS.md`) é do Cowork; código, testes, build, CI e documentação de entrega (`docs/DEVELOPMENT.md`, progresso no `STATUS.md`, `docs/TESTING.md`, `docs/CI-PR.md`) são do Code. Cowork precisando tocar algo fora da sua lista → para e pergunta ao PI.
- Como o Cowork não abre PR, ele nunca vê conflito. Quem colide é o Code, com branch aberta enquanto a `main` andou. Regra: o Code **rebase e reaplica** o próprio trabalho por cima. O Code **nunca desfaz** linha escrita pelo Cowork; se o `STATUS.md` divergiu, a versão da `main` vence e o Code reaplica só o próprio progresso.
- PR referencia a issue com **`refs #N`**. **Nunca `closes #N`** — forjaria o aceite do PI.

## Rotina do Code por card

1. Confirmar branch, diff local, issue, SPEC aplicável e base remota. Ler `docs/APRENDIZADOS.md` antes de começar — é curto e é onde moram as armadilhas já pagas. Worktree/branch por card. Preservar mudanças de outros trabalhos; não usar `git add -A` em checkout misto.
2. Uma finalidade por PR. Código, testes e docs necessários à mesma entrega ficam juntos; escopo oportunista fica fora. Mudança independente vai em PR separada; não partir mudança atômica só para reduzir linhas.
3. Commits coerentes e push frequente para preservar o trabalho. Não acumular grande alteração sem checkpoint remoto.
4. Rodar lint, typecheck, testes e as provas condicionais de `docs/TESTING.md`. Ausência de credencial, serviço externo ou ambiente real é `not_run`, **nunca** `pass`. Falha de worker ou falta de infra nunca vira PASS.
5. Autorrevisão do diff completo contra a base, inclusive arquivos já commitados (`engineering:code-review`): achados verificáveis, P0/P1 bloqueiam, deduplicar achados anteriores.
6. Preencher a PR com problema, comportamento antes/depois, `refs #N`, SPEC quando houver, validação executada e limitações. Usar o template quando existir. A descrição explica o resultado final, não narra as tentativas.
7. CI: `gh pr checks <n> --watch` (bloqueia até o fim e devolve código de saída). **Nunca afirmar estado de CI, PR ou job sem verificar no momento da fala**; silêncio de watcher, lista vazia, print antigo ou status lembrado não é verde. Novo head ou avanço da base exige reconciliar — PASS antigo não vale para código novo.
8. Corrigir no mesmo branch/PR. Merge por squash com CI verde. Bloqueio externo ou de permissão: preservar a PR e informar a causa; não contornar nem confundir com defeito de código.
9. Confirmar `mergedAt`/`mergeSha` na origem antes de declarar "integrado". Publicar o comentário de encerramento na issue (skill `fechar-card`) e só então aplicar `proplan:done`. Documentação da entrega vai no PR — nunca commit na `main` para registrar merge.
10. Indicar o próximo card e seguir.
---

## 10. Higiene do repositório

- `.gitignore` cobre `node_modules/`, `.next/`, `dist/`, `coverage/`, `.env*` (exceto `.env.example`), `graphify-out/`, `*.pfx`, `*.p12`, `*.pem`.
- **`.env.example` versionado e atualizado** na mesma PR que introduz variável nova. Variável nova sem exemplo quebra o próximo ambiente.
- Arquivo binário grande (screenshot de evidência, protótipo) fica sob `docs/`, com peso vigiado; acima de ~2MB, justificar na PR.
- Hooks locais (`lefthook` ou `husky`) rodam lint e typecheck no `pre-push` — **nunca substituem a CI**, que é a única prova válida.
---

## Referências

- [`PRS.md`](PRS.md) · [`CI-PR.md`](CI-PR.md) · [`AUDIT.md`](AUDIT.md) · [`TESTING.md`](TESTING.md) · [`REVIEW.md`](REVIEW.md)
- [Conventional Commits](https://www.conventionalcommits.org/pt-br/v1.0.0/)
- [Trunk Based Development](https://trunkbaseddevelopment.com/5-min-overview/)
- [GitHub — About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub — About pull request merges](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/about-pull-request-merges)
