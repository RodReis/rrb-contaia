# ADR-009 — Runner de CI e merge queue

- **Status:** Aceita · **Data:** 17/09/2026 · **Decisor:** PI

## Contexto
Teto de 15 min por PR (`CLAUDE.md`). O fluxo é solo: um autor, um aprovador (o PI, no aceite). Merge queue existe para evitar o "PR verde que quebra a main" quando há PRs concorrentes.

## Decisão
**Runners hospedados pelo GitHub, sem merge queue.** O gate é: required check único (`gate`) + branch atualizada com a `main` antes do squash.

## Consequências
- Nenhuma rodada extra de CI por merge.
- Segredo de produção (certificado A1, chave do Signer) nunca precisa existir em runner próprio.
- Reavaliar quando houver mais de um autor concorrente ou fila de PRs esperando gate — aí o `merge_group` passa a pagar.

## Riscos
- Sem merge queue, dois merges quase simultâneos podem passar verdes e quebrar a `main`. Mitigação: exigência de branch atualizada + `main` vermelha interrompe o trabalho ([`CI-PR.md`](../CI-PR.md) §6).

## Alternativas descartadas
- Merge queue agora: custo de CI dobrado sem o problema que ela resolve.
- Runner self-hosted: CI mais barata, mas coloca segredo e isolamento sob responsabilidade própria.
