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

Depois do squash merge, a `main` roda a matriz completa — inclusive o que a PR condicionou — e gera os builds e imagens verificáveis.

- **`main` vermelha é interrupção de trabalho.** Corrigir vem antes do próximo card.
- **Não há deploy do MVP-1 ao MVP-4.** A `main` não publica em Vercel, Railway nem outro provedor ([ADR-012](adr/ADR-012-ambiente-local-ate-ultimo-mvp.md)).
- Migration é validada do zero e sobre a versão anterior no PostgreSQL local; reversibilidade ou plano de rollback continuam obrigatórios ([`CONVENTION.md`](CONVENTION.md)).
- A pipeline produtiva será especificada no gate posterior ao MVP-4, sem reaproveitar resultado local como prova de produção.

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
| 2026-10-15 | [#123](https://github.com/RodReis/rrb-contaia/pull/123) | 15m48s | `e2e` (14m45s) | Inicialização da composição e suíte Playwright integral do workspace | Medição registrada; manter cobertura e observar próximas execuções antes de propor otimização | `build`, `quality`, regras, banco, tela, E2E e `gate` passaram |
| 2026-10-21 | [#140](https://github.com/RodReis/rrb-contaia/pull/140) | 16m08s | `e2e` (15m53s) | Preparação da composição, seed e build (3m26s); suíte Playwright integral (12m27s) | Medição registrada; manter cobertura e observar próximas execuções antes de propor otimização | `build`, `quality`, regras, banco, tela, E2E e `gate` passaram |
| 2026-10-24 | [#150](https://github.com/RodReis/rrb-contaia/pull/150) | 15m57s | `e2e` (15m45s; Playwright 11m54s) | Inicialização/build da pilha (~3m51s) mais suíte integral (164 testes passaram; F35 falhou ao usar `selectOption` em componente Radix) | Corrigir interação do teste para selecionar opções Radix e observar próxima execução; cobertura mantida | `build`, `quality`, regras, banco e tela passaram; E2E falhou em um teste F35; gate falhou |
| 2026-10-25 | [#150](https://github.com/RodReis/rrb-contaia/pull/150) | 18m19s (CI `40153658242`) | `e2e` (17m56s) | Inicialização/build e suíte integral; interação do teste F35 ainda fechava o contexto do navegador antes de selecionar a opção Radix | Corrigir seleção por nome acessível; cobertura mantida | Demais jobs passaram; E2E e `gate` falharam no F35 |
| 2026-10-25 | [#150](https://github.com/RodReis/rrb-contaia/pull/150) | 16m35s (CI `40154884022`) | `e2e` (16m09s) | Inicialização/build e suíte integral; API recebeu body vazio em POST JSON F35 sem `Content-Type` e respondeu 422 | Enviar `Content-Type: application/json` nos três comandos JSON F35; cobertura mantida | Demais jobs passaram; E2E e `gate` falharam no F35 |
| 2026-10-25 | [#150](https://github.com/RodReis/rrb-contaia/pull/150) | 17m19s (CI `40156102959`) | `e2e` (16m52s; 176/176) | Inicialização, build e suíte Playwright integral do workspace | Medição registrada; manter cobertura e observar próximas execuções antes de propor otimização | `build`, `quality`, regras, banco, tela, E2E e `gate` passaram |
| 2026-10-26 | [#151](https://github.com/RodReis/rrb-contaia/pull/151) | 29m05s (CI `40353086517`) | `e2e` (28m47s; Playwright 12m27s) | `playwright install --with-deps chromium` levou 12m50s no runner Azure; preparação da composição e build, 3m47s. E2E passou o reprocessamento F36 e falhou quando a listagem mensal fez a tela exibir erro genérico | Medição registrada; E2E acrescenta verificação HTTP da listagem para revelar status/corpo; manter suíte integral | Demais jobs passaram; E2E e `gate` falharam na navegação F36 |
| 2026-10-25 | [#150](https://github.com/RodReis/rrb-contaia/pull/150) | 16m24s (CI `40160861881`) | `e2e` (16m07s) | Inicialização/build e suíte Playwright integral (164/166); falha F35 apenas na asserção do `span` interno do seletor de arquivo | Asserção transferida para o `label` visível do seletor; cobertura mantida | Demais jobs passaram; E2E e `gate` falharam no F35 |
| 2026-10-25 | [#150](https://github.com/RodReis/rrb-contaia/pull/150) | 17m15s (CI `40161983233`) | `e2e` (16m52s; 176/176) | Inicialização/build e suíte Playwright integral do workspace | Medição registrada; manter cobertura e observar próximas execuções antes de propor otimização | `build`, `quality`, regras, banco, tela, E2E e `gate` passaram; artefatos autenticados CLARO/ESCURO × 768/1024/1440 publicados |
| 2026-10-25 | [#150](https://github.com/RodReis/rrb-contaia/pull/150) | 16m45s (CI `40163770968`) | `e2e` (falhou no F35) | Fluxo E2E expandido para aprovação de regra excedeu `fields: 1` no interceptor Multer do endpoint | Limite ajustado para 8 campos; cobertura E2E mantida | Demais jobs passaram; E2E e `gate` falharam por HTTP 400 no multipart |
| 2026-10-25 | [#150](https://github.com/RodReis/rrb-contaia/pull/150) | 14m12s (CI `40164674063`) | `e2e` (falhou no F35) | Limite multipart elevado resolveu o 400; fixture reduzia campos que são obrigatórios pelo contrato e recebeu 422 | Restaurar os sete metadados obrigatórios; preservar limite `fields: 8` | Demais jobs passaram; E2E e `gate` falharam por ausência de sourceUrl, consultedAt e conditions |
| 2026-10-25 | [#150](https://github.com/RodReis/rrb-contaia/pull/150) | 16m18s (CI `40165585528`) | `e2e` (falhou no F35) | Limite `fields: 8` ainda respondeu `Too many fields` com os sete metadados obrigatórios e arquivo | Elevado limite Multer do upload para 12 campos; contrato e fixture mantidos | Demais jobs passaram; E2E e `gate` falharam no multipart de regra sintética |
| 2026-10-25 | [#150](https://github.com/RodReis/rrb-contaia/pull/150) | 16m27s (CI `40166524812`) | `e2e` (falhou no F35) | Upload e fluxo decisório passaram; exportação JSON comparou `dossierId` com ID externo da resposta, não o ID canônico interno | Comparar o export com `approvedDossier.dossier.dossierId`; contrato de hash e estado mantido | Demais jobs passaram; E2E e `gate` falharam só nessa asserção |
| 2026-10-26 | [#151](https://github.com/RodReis/rrb-contaia/pull/151) | >22m (CI `40341070083`) | `e2e` (14m21s; 166 passaram, 1 falhou) | Instalação de Chromium/Playwright consumiu 9m04s; setup+migrations+stack+build 2m33s; suíte integral 12m22s. F36 falhou na asserção da nova apuração: fixture usava `ATUALIZADO`, classificado como documento incompleto | Usar `ORIGINAL_BAIXADO` para alterar fingerprint sem criar sinal pós-venda ou status de documento incompleto; manter suíte integral | Demais jobs passaram; E2E e `gate` falharam aguardando nova run `40345311848` |

Preenchido pelo Code na mesma PR em que o estouro ocorreu. Linha sem causa medida não conta.

## 9. Testes e CI

- Categorias obrigatórias: regras, banco, tela e E2E quando aplicável. Evidência rastreável por SPEC/issue (arquivos brutos, cobertura por categoria, relatório agregado) conforme `docs/TESTING.md`.
- Correção de bug precisa de teste de regressão quando há comportamento verificável; se não houver teste viável, registrar o motivo e a prova alternativa na PR.
- Mudança em teste, workflow ou gerador de relatório exige self-check e verificação do relatório. Se tocar UI ou fluxo crítico, incluir prova visual/E2E.
- CI de PR com caminho crítico curto: jobs independentes em paralelo (`quality`, `test-regras`, `test-banco`, `test-tela`, `e2e`); o job agregado não reexecuta a suíte, só consolida artefatos e valida anti-drift/append-only; o `gate` depende dos obrigatórios. PR acima de 15 min sem justificativa técnica: medir e registrar a causa em `docs/CI-PR.md`. Otimização válida é paralelizar, condicionar por mudança e reaproveitar artefato — nunca remover prova.
- Dependência web/mobile que não suporte Node 24 ou dependência backend incompatível com a versão Python fixada é bloqueio explícito: documentar o erro e ajustar a matriz só com justificativa; nunca degradar versão em silêncio.
---

## Referências

- [`GITHUB.md`](GITHUB.md) · [`PRS.md`](PRS.md) · [`TESTING.md`](TESTING.md) · [`REVIEW.md`](REVIEW.md) · [`AUDIT.md`](AUDIT.md)
- [GitHub Actions — caching dependencies](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/cache-dependencies)
- [GitHub Actions — concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency)
- [GitHub — Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [Turborepo — filtering](https://turborepo.com/docs/reference/run)
