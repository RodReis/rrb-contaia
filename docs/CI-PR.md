# CI-PR.md — Pipeline de PR: caminho curto, prova inteira

> **Normativo.** Como a CI de pull request é montada, medida e otimizada.
> Regra de ouro: **encurta-se o caminho crítico, nunca a prova.**

---

## 1. Objetivo e teto

| Alvo | Valor |
|---|---|
| **Gate de PR (p50)** | ≤ 8 min |
| **Gate de PR (teto)** | **15 min** — acima disso, medir e registrar a causa no §8 (`CLAUDE.md`) |
| Feedback de lint/typecheck | ≤ 3 min |
| Flakiness tolerada | **zero** — teste instável é defeito, não ruído |

O teto não é uma meta a perseguir cortando cobertura. É um **detector**: gate lento quase sempre denuncia job serializado, cache frio ou suíte mal fatiada — não excesso de teste.

---

## 2. Forma da pipeline

Jobs independentes **em paralelo**; um `gate` agregador como único *required check*.

```
 pull_request ─┬─ quality       (lint · typecheck · format · bundle budget)
               ├─ test-regras   (domínio puro: motor fiscal, contábil, validadores)
               ├─ test-banco    (Postgres efêmero: migrations, RLS, repositórios)
               ├─ test-tela     (Vitest + Testing Library)
               ├─ e2e           (Playwright — condicional, §5)
               └─ build         (apps afetados)
                        │
                        └─▶ gate  (agrega, valida anti-drift e append-only)
```

Regras estruturais:

1. **O `gate` não reexecuta a suíte.** Ele consolida artefatos, verifica que cada job obrigatório reportou, valida anti-drift e append-only, e publica o relatório. (`CLAUDE.md`)
2. **`gate` é o único required check** no ruleset ([`GITHUB.md`](GITHUB.md) §6). Adicionar checks obrigatórios um a um engessa a evolução da pipeline.
3. **Job obrigatório que não rodou não é sucesso.** `skipped` por path filter é `skipped` declarado; `skipped` por erro é falha.
4. **Cada job publica artefato bruto** (relatório, cobertura, screenshot, trace) rastreável por SPEC/issue ([`TESTING.md`](TESTING.md)).

---

## 3. Otimização — o que é permitido

Três alavancas, nesta ordem de retorno:

### 3.1 Paralelizar

- Jobs independentes rodam ao mesmo tempo. O gate espera; o desenvolvedor não.
- Dentro de um job, a suíte usa todos os núcleos do runner (Vitest com `pool: 'threads'`; Playwright com `workers`).
- **Sharding** (dividir a suíte entre runners) só entra com evidência de que o job é o caminho crítico e com recorte próprio — não é decisão livre do agente (`CLAUDE.md`).

### 3.2 Condicionar por mudança

Monorepo pnpm + Turborepo ([ADR-001](adr/ADR-001-monorepo.md)) permite rodar **só o que foi afetado**:

- `turbo run <task> --filter=...[origin/main]` resolve o grafo de dependência: mexer em `packages/shared` roda o que depende dele; mexer só em `docs/` não roda suíte nenhuma.
- **Path filters no workflow** para documentação pura.
- **Cuidado:** filtro errado é PASS falso. Mudança em migration, em schema compartilhado, em configuração de build ou em arquivo de CI **força a matriz inteira**. Na dúvida, roda tudo — perder 6 minutos é mais barato que mergear cego.

### 3.3 Reaproveitar artefato e cache

| Cache | Chave | Ganho típico |
|---|---|---|
| Store do pnpm | `pnpm-lock.yaml` | instalação de minutos para segundos |
| Cache do Turborepo | hash de entradas da task | pula build/test já provados no mesmo conteúdo |
| Cache do Next (`.next/cache`) | lock + fonte | build incremental |
| Navegadores do Playwright | versão do Playwright | evita download a cada execução |
| Imagem do Postgres de teste | tag fixa | sobe em segundos |

- **`build` roda uma vez** e publica artefato; `e2e` consome esse artefato em vez de reconstruir.
- **Cancelar execução obsoleta:** `concurrency: { group: pr-${{ github.ref }}, cancel-in-progress: true }`. Push novo mata a rodada anterior — é a economia mais barata que existe.
- **Fixar versões** (`actions/*@vN` por SHA ou tag, Node por `.nvmrc`, pnpm por `packageManager`) — matriz que muda sozinha é falha intermitente disfarçada.

---

## 4. Otimização — o que é proibido

Não é decisão livre do agente (`CLAUDE.md`):

| Proibido | Por quê |
|---|---|
| `[skip ci]` em PR | merge sem prova |
| Cache de PASS entre SHAs diferentes | PASS antigo não vale para código novo |
| Rerun cego até passar | esconde teste instável, que é defeito |
| Remover cobertura, teste de RLS, anti-drift ou append-only para ganhar minutos | troca segurança por velocidade no ponto mais sensível do produto |
| Transformar `not_run` em `pass` | mentira na evidência |
| `continue-on-error` em job obrigatório | gate verde sem prova |
| Reduzir a suíte só na PR e "rodar tudo depois na `main`" | quebra a `main` e inverte o custo |
| Trocar runner ou contratar infraestrutura sem evidência e recorte próprios | custo sem diagnóstico |

**Teste flaky não é retentado: é corrigido ou quarentenado com issue `[FIX]` aberta e prazo.** Quarentena sem issue é remoção de prova.

---

## 5. Jobs e condições

| Job | Roda quando | Serviços | Duração alvo |
|---|---|---|---|
| `quality` | sempre (exceto mudança só em `docs/`) | — | ≤ 3 min |
| `test-regras` | mudança em domínio, `packages/shared` ou configuração | — | ≤ 3 min |
| `test-banco` | mudança em migration, repositório, política de RLS ou schema | Postgres efêmero (service container ou Testcontainers) | ≤ 6 min |
| `test-tela` | mudança em `apps/web` | — | ≤ 5 min |
| `e2e` | mudança em `apps/web` ou `apps/api`; **sempre** em fatia de fluxo crítico | app buildado + Postgres | ≤ 8 min |
| `build` | mudança em app | — | ≤ 5 min |
| `gate` | sempre | — | ≤ 1 min |

**Integração com órgão governamental (Sefaz, eSocial) não roda na CI de PR.** Depende de certificado e de ambiente de homologação — é prova condicional, executada fora e declarada como `not_run` na PR quando indisponível ([`TESTING.md`](TESTING.md)).

**Segredo de produção nunca entra na CI de PR.** Certificado A1, chave do Signer e credencial de órgão não existem nesse contexto. PR de fork não recebe segredo algum.

---

## 6. CI da `main`

Depois do squash merge, a `main` roda a matriz completa — inclusive o que a PR condicionou — mais build de imagem e deploy.

- **`main` vermelha é interrupção de trabalho.** Corrigir vem antes do próximo card.
- Deploy: **Vercel** (web) e **Railway** (API, workers) a partir da `main` verde ([ADR-003](adr/ADR-003-hospedagem-e-deploy.md)).
- Migration roda em passo próprio, antes do deploy da aplicação, e é reversível ou acompanhada de plano de rollback ([`CONVENTION.md`](CONVENTION.md)).

---

## 7. Observabilidade da própria pipeline

Cada execução do `gate` registra no relatório: duração total, duração por job, caminho crítico, jobs pulados e o motivo, taxa de retentativa.

O que se acompanha (ver [`PRS.md`](PRS.md) §5):

- duração do gate (p50 e p95) por semana;
- job que mais aparece como caminho crítico;
- taxa de cache hit do pnpm e do Turborepo;
- execuções canceladas por push novo (economia real);
- testes que falharam e passaram no rerun — **lista de flaky, com issue aberta**.

---

## 8. Registro de estouro de 15 min

Gate acima de 15 minutos sem justificativa técnica é registrado aqui, com medição — não com impressão.

| Data | PR | Duração | Caminho crítico | Causa | Ação | Resultado |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

Preenchido pelo Code na mesma PR em que o estouro ocorreu. Linha sem causa medida não conta.

---

## Referências

- [`GITHUB.md`](GITHUB.md) · [`PRS.md`](PRS.md) · [`TESTING.md`](TESTING.md) · [`REVIEW.md`](REVIEW.md) · [`AUDIT.md`](AUDIT.md)
- [GitHub Actions — caching dependencies](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/cache-dependencies)
- [GitHub Actions — concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency)
- [GitHub — Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [Turborepo — filtering](https://turborepo.com/docs/reference/run)
