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

## 9. Higiene do repositório

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
