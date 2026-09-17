# AUDIT.md — Rotina de autoria, revisão, performance e evidência

> **Operacional.** O passo a passo de um card, do primeiro comando ao `proplan:done`.
> Distingue **orientação operacional** (isto aqui) de **evolução da pipeline** (§7).
> Substitui a referência a `docs/AUTID.md` do `CLAUDE.md`, que era erro de digitação.

---

## 1. Antes de escrever código

- [ ] Ler [`APRENDIZADOS.md`](APRENDIZADOS.md) — curto, e é onde moram as armadilhas já pagas.
- [ ] Confirmar issue, SPEC aplicável, base remota, branch e diff local.
- [ ] Worktree/branch por card ([`GITHUB.md`](GITHUB.md)).
- [ ] Preservar mudanças de outros trabalhos; **nunca `git add -A` em checkout misto**.
- [ ] Verificar em [`DECISIONS.md`](DECISIONS.md) se alguma ADR já decide o ponto.
- [ ] Se a tarefa tem UI: [`FRONTEND.md`](FRONTEND.md) → [`design-system/COMPONENTS.md`](design-system/COMPONENTS.md) → [`PATTERNS.md`](design-system/PATTERNS.md) → [`TOKENS.md`](design-system/TOKENS.md).

---

## 2. Autoria

- Uma finalidade por PR. Escopo oportunista fica fora.
- Commits coerentes, push frequente ([`GITHUB.md`](GITHUB.md) §3).
- Decisão tomada no caminho (nome de campo, estrutura de pasta, dublê de teste) é do Code — **decide na hora e registra no PR**. Errou, corrige no PR seguinte.
- Decisão estrutural (fronteira de módulo, troca de biblioteca, mudança de contrato) vira **ADR proposta na PR**, não é feita em silêncio.

---

## 3. Verificação local, antes de abrir a PR

| Passo | Comando de referência | Falha bloqueia |
|---|---|---|
| Lint | `pnpm lint` | sim |
| Tipos | `pnpm typecheck` | sim |
| Regras | `pnpm test:regras` | sim |
| Banco/RLS | `pnpm test:banco` | sim |
| Tela | `pnpm test:tela` | sim |
| E2E (quando aplicável) | `pnpm test:e2e` | sim |
| Build dos apps afetados | `pnpm build` | sim |

Prova condicional indisponível é **`not_run` com motivo**, nunca `pass` ([`TESTING.md`](TESTING.md)).

---

## 4. Autorrevisão

Diff completo contra a base, com [`REVIEW.md`](REVIEW.md). O fluxo é solo: o autor é o revisor, e por isso o passo é obrigatório e não simbólico.

Saída: lista de achados por gravidade + declaração de P0/P1 aberto. P0/P1 aberto não abre PR — corrige antes.

---

## 5. Performance — o que se mede e quando

| Alvo | Limite (PRD §12) | Quando medir |
|---|---|---|
| API p95 | < 500ms | toda fatia que cria ou altera endpoint |
| Dashboard | < 3s com 500 empresas | fatia de dashboard ou de agregado |
| Lote de 10.000 XMLs | < 15min | fatia de worker de captura ou parse |
| Listagem administrativa | < 3s com paginação e filtro | fatia de RF-08 |
| LCP / INP / CLS | 2,5s / 200ms / 0,1 (p75) | toda fatia de UI |
| Bundle por rota | ≤ 200KB gzip | toda fatia de UI |

Regras:

- **Medição com volume realista.** 20 registros em base vazia não prova nada sobre 488 empresas.
- **Consulta nova é explicada:** `EXPLAIN ANALYZE` anexado quando a fatia introduz consulta em tabela transacional.
- **N+1 é achado P2**, mesmo quando "está rápido" no dado de teste.
- **Regressão acima do orçamento** é registrada na PR com número antes/depois — não com adjetivo.

---

## 6. Evidência

O que entra na PR ([`PRS.md`](PRS.md) §2):

- tabela **Validação executada** com resultado e link do artefato;
- prova visual nos **dois temas** quando há UI;
- trace/screenshot do E2E do caminho crítico;
- número de performance quando o §5 se aplica;
- `not_run` declarado com motivo.

O que entra na **issue** ([`fechar-card`](../CLAUDE.md)): comentário de encerramento com **Resumo da implementação**, **Aprendizado** e **Imprevistos**. Seção sem conteúdo real recebe "Nenhum" — ninguém inventa aprendizado para preencher template. Aprendizado só entra com fonte verificável (doc oficial, commit, log, comando).

**A issue é a fonte de verdade da entrega.** O resumo no chat só aponta para ela.

---

## 7. Orientação operacional × evolução da pipeline

| É operacional (Code decide e faz) | É evolução da pipeline (exige escopo e autorização) |
|---|---|
| Rodar a suíte, medir, anexar artefato | Alterar ruleset, exigência de review, auto-merge |
| Escrever teste novo, fábrica, fixture | Remover cobertura, anti-drift, append-only ou teste |
| Ajustar path filter que estava errado | Introduzir sharding, migrar runner, contratar infraestrutura |
| Corrigir teste instável ou abrir `[FIX]` | Reescrever workflow humano ou trocar comando de validação sem preservar o contrato |
| Registrar estouro de 15min em [`CI-PR.md`](CI-PR.md) | Mudar o teto de 15min |

Coluna da direita: **pergunta ao PI** (`CLAUDE.md`).

---

## 8. Fechamento

1. CI verde no SHA atual — verificado no momento da fala, não lembrado.
2. Squash merge com branch atualizada.
3. Confirmar `mergedAt`/`mergeSha` na origem.
4. Comentário de encerramento na issue.
5. `proplan:done`. **O PI fecha a issue** — nenhuma automação fecha.
6. Atualizar [`DEVELOPMENT.md`](DEVELOPMENT.md) e o progresso em [`STATUS.md`](STATUS.md) **dentro da PR**, nunca por commit direto na `main`.
7. Indicar o próximo `todo` da ordem.

---

## Referências

- [`GITHUB.md`](GITHUB.md) · [`PRS.md`](PRS.md) · [`CI-PR.md`](CI-PR.md) · [`TESTING.md`](TESTING.md) · [`REVIEW.md`](REVIEW.md) · [`DEVELOPMENT.md`](DEVELOPMENT.md) · [`APRENDIZADOS.md`](APRENDIZADOS.md)
