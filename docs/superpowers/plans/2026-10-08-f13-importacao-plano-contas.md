# F13 — Importação do plano de contas por CSV: plano de implementação

> **Para executores:** usar `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans`. Passos com checkbox (`- [ ]`).

**Goal:** entregar a SPEC-013 de ponta a ponta: upload, mapeamento, validação assíncrona em staging, prévia, confirmação transacional, relatório, histórico, pendência, notificação, permissões e UI nos dois temas.

**Architecture:** a API recebe o CSV (multipart), grava o original no object storage, registra a tentativa `RECEBIDA` e enfileira (BullMQ) a validação. O worker valida o arquivo inteiro com as regras puras de `@contaia/domain` e grava staging + rejeições sob RLS técnica. A confirmação roda num caso de uso transacional da API (versão otimista do plano, eventos append-only, pendência, notificação). A web consome a API por react-query.

**Tech Stack:** NestJS 11, BullMQ 6/ioredis, `csv-parse`, S3/MinIO (`StorageService`), Postgres 16 com RLS, Next 15 + react-query + Radix + Sonner, Vitest, Playwright.

**Spec:** `docs/prd/mvp/spec/SPEC-013-importacao-plano-contas-csv.md` (aprovada pelo PI em 18/09/2026). Issue #15. Branch `feat/SPEC-013-importacao-plano-contas-csv`.

## Estado de partida (verificado)

- **Pronto e verde:** domínio `packages/domain/src/plano-contas/*` (validação integral, máquina de estados, idempotência; 31 testes), contratos `packages/shared/src/plano-contas.ts`.
- **Rascunho com defeitos (reescrever):** migration `0015_importacao_plano_contas.sql` (9 defeitos listados na Task 3), `packages/db/src/repositorios/plano-contas.ts` (bugs listados na Task 4), `apps/api/src/plano-contas/*` e `packages/importacao-plano-contas-client/*` (não compilam).
- **Inexistente:** worker, web, testes de API/banco/tela/E2E, permissões no catálogo, tipo de pendência.

## Global Constraints

Copiados da SPEC e do `CLAUDE.md`; valem para todas as tasks.

- Arquivo: CSV, **10 MB** e **10.000 linhas** de dados no máximo.
- Campos obrigatórios: código (único na empresa), nome, tipo (`analítica`/`sintética`), natureza (`devedora`/`credora`), conta-pai (exceto raiz).
- Código repetido no arquivo: **todas** as ocorrências rejeitadas. Conta arquivada nunca é atualizada nem reativada. Ausentes do CSV ficam inalterados.
- Histórico: **15 tentativas por página**, da mais recente para a mais antiga.
- Estados: `RECEBIDA → VALIDANDO → AGUARDANDO_CONFIRMACAO → APLICANDO → CONCLUIDA | CONCLUIDA_COM_REJEICOES | FALHA`; `CANCELADA`; `REJEITADA`; `FALHA`. Terminais não reabrem.
- Confirmação obsoleta (plano mudou): **HTTP 409** `CONFLITO_DE_VERSAO`, nada aplicado.
- Idempotência por `tenant + empresa + hash do arquivo + mapeamento`.
- Notificação só ao **iniciador**; reuso idempotente não notifica de novo.
- Permissões (`Empresas → Plano de contas`): `consultar`, `importar`, `confirmar_importacao`, `baixar_relatorio`. `admin_escritorio` e `contador`: todas. `auxiliar` e `auditor_readonly`: `consultar` + `baixar_relatorio`. Demais papéis: nenhuma.
- Erro HTTP `application/problem+json` com `type`, `title`, `status`, `code`, `correlationId`. Erro de conteúdo vai ao relatório da linha, nunca HTTP 500.
- Funções de cálculo puras (o "agora" entra por parâmetro); caso de uso controla a transação; controller só valida e delega; `any` proibido; `unknown` antes de validar dado externo.
- Toda tabela nova: `tenant_id` + `empresa_id` NOT NULL, índices, RLS forçada, escopo imutável, sem `DELETE`; eventos append-only.
- UI: tela final nos temas CLARO e ESCURO; 768/1024/1440; skills `frontend-design` (antes e durante) e `impeccable` (no final); remover do protótipo centro de custo, correção inline, IA, vetorização e métricas fictícias.
- Idioma: PT-BR em docs, commits e UI; identificadores em inglês **quando novos** (o domínio existente usa português; manter o estilo do módulo).
- Commits: Conventional Commits em PT-BR, `refs #15`, rodapé `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Entradas e condições que a SPEC implica e nenhuma task testaria sozinha; cada linha tem teste na task dona.

1. CSV com **BOM UTF-8**, delimitador `;` (Excel pt-BR), aspas, quebra de linha CRLF e acentos em Latin-1 → diagnóstico determinístico, sem interpretar ambíguo em silêncio (Task 7, `parseCsv`).
2. Cabeçalho duplicado ou só em branco, arquivo só com cabeçalho, 10.001 linhas, 10 MB + 1 byte (Task 7 e Task 8).
3. Linha com código só de espaços, código com zeros à esquerda (`01` ≠ `1`), pai igual ao próprio código (ciclo de 1) (Task 7 e domínio).
4. Duas confirmações simultâneas da mesma prévia (corrida) → uma aplica, a outra recebe estado inválido/409, sem duplicar conta nem notificação (Task 4 e Task 8).
5. Worker cai no meio da validação e o job reentrega → staging não duplica, tentativa chega ao mesmo resultado (Task 9).
6. Usuário `auxiliar` tenta importar via API direta; usuário de outra empresa/tenant pede prévia, relatório ou arquivo → 403/404 sem revelar dado (Task 8).
7. Relatório CSV com campo iniciado em `=`, `+`, `-`, `@` (injeção de fórmula ao abrir no Excel) → prefixado com `'` (Task 8).

---

## Mapa de arquivos

| Responsabilidade | Arquivo | Ação |
|---|---|---|
| Catálogo e papéis padrão | `packages/domain/src/papeis/catalogo.ts`, `papeis-padrao.ts` (+ testes) | Modificar |
| Códigos de erro | `packages/domain/src/erros.ts`, `apps/api/src/comum/problema.ts` | Modificar |
| Pendência `PLANO_CONTAS` | `packages/domain/src/pendencias/pendencias.ts`, `packages/domain/src/plano-contas/pendencias.ts` | Modificar / criar |
| Parser de CSV (puro) | `packages/domain/src/plano-contas/csv.ts` (+ teste) | Criar |
| Relatório CSV (puro) | `packages/domain/src/plano-contas/relatorio.ts` (+ teste) | Criar |
| Contratos | `packages/shared/src/plano-contas.ts`, `arquivos.ts` | Modificar |
| Migration | `packages/db/migrations/0015_importacao_plano_contas.sql` | Reescrever |
| RLS (anti-drift) | `packages/db/src/rls/classificacao.ts`, `testes/fixtures-rls.ts` | Modificar |
| Repositório | `packages/db/src/repositorios/plano-contas.ts` (+ integração) | Reescrever |
| Sino | `packages/db/src/repositorios/notificacoes.ts` | Modificar |
| API | `apps/api/src/plano-contas/*` | Reescrever |
| Worker | `apps/workers/src/plano-contas/*`, `config.ts`, `main.ts`, `consumidores.ts` | Criar / modificar |
| Compose | `infra/docker/compose.yml` (workers: S3) | Modificar |
| Web | `apps/web/src/features/plano-contas/*`, `app/(app)/empresas/[empresaId]/...` | Criar |
| E2E | `tests/e2e/spec-013-plano-contas.spec.ts`, `fixtures/*.csv` | Criar |
| Docs | `docs/DEVELOPMENT.md` (Card #15), `docs/STATUS.md` | Modificar |

**Removidos:** `packages/importacao-plano-contas-client/` (duplicata do `signer-client`; constantes de fila ficam em `@contaia/shared`, enfileiramento fica na API).

---

### Task 1: Permissões no catálogo e papéis padrão

**Files:**
- Modify: `packages/domain/src/papeis/catalogo.ts` (ações em `ROTULO_DA_ACAO` l.9; funcionalidade em `CATALOGO` módulo `empresas`)
- Modify: `packages/domain/src/papeis/papeis-padrao.ts` (`auxiliar` l.44, `auditor_readonly` l.49)
- Test: `packages/domain/src/papeis/catalogo.test.ts` (array `ESPERADO` l.15), `papeis-padrao.test.ts` (l.56), `matriz.test.ts`

**Interfaces:**
- Produces: chaves `empresas.plano_contas.consultar | importar | confirmar_importacao | baixar_relatorio` em `ChaveDePermissao`.

- [ ] **Step 1: testes que falham.** No `catalogo.test.ts`, inserir as 4 chaves no `ESPERADO` na posição do catálogo (logo após `empresas.historico.consultar`). Em `papeis-padrao.test.ts`, ajustar `contador` (as 4), `auxiliar` e `auditor_readonly` (`consultar` + `baixar_relatorio`). Em `matriz.test.ts` acrescentar:

```ts
it('baixar_relatorio implica consultar na funcionalidade plano_contas', () => {
  expect(consultaImplicada('empresas.plano_contas.baixar_relatorio')).toBe('empresas.plano_contas.consultar');
});
it('confirmar_importacao não implica importar', () => {
  expect(dependentesDeConsulta('empresas.plano_contas.consultar')).not.toContain('empresas.plano_contas.confirmar_importacao_implica_importar');
  expect(consultaImplicada('empresas.plano_contas.confirmar_importacao')).toBe('empresas.plano_contas.consultar');
});
```

- [ ] **Step 2:** `pnpm --filter @contaia/domain test:regras` → FALHA (chaves ausentes).
- [ ] **Step 3: implementar.** Em `ROTULO_DA_ACAO`:

```ts
  importar: 'Importar',
  confirmar_importacao: 'Confirmar importação',
  baixar_relatorio: 'Baixar relatório',
```

Em `CATALOGO`, módulo `empresas`, depois de `historico`:

```ts
      {
        id: 'plano_contas',
        rotulo: 'Plano de contas',
        acoes: ['consultar', 'importar', 'confirmar_importacao', 'baixar_relatorio'],
      },
```

Em `papeis-padrao.ts`, `auxiliar` e `auditor_readonly` recebem explicitamente `'empresas.plano_contas.consultar'` e `'empresas.plano_contas.baixar_relatorio'` (o helper `consultas()` não reconhece `baixar_relatorio`). `admin_escritorio` e `contador` herdam por `CHAVES_DO_CATALOGO`/`chavesDoModulo('empresas')`.

- [ ] **Step 4:** testes do domínio passam; `pnpm --filter @contaia/api exec vitest run src/papeis` passa (o spec de catálogo compara com `CHAVES_DO_CATALOGO`).
- [ ] **Step 5: commit** `feat(domain): permissões de plano de contas no catálogo (refs #15)`.

---

### Task 2: Códigos de erro e status HTTP

**Files:**
- Modify: `packages/domain/src/erros.ts` (já tem 4 códigos do rascunho: `TENTATIVA_NAO_ENCONTRADA`, `ESTADO_INVALIDO_PARA_ACAO`, `FILA_INDISPONIVEL`, `FALHA_TECNICA`; acrescentar `ARQUIVO_VAZIO`, `ARQUIVO_ACIMA_DO_LIMITE`, `CABECALHO_INVALIDO`, `MAPEAMENTO_INCOMPLETO`)
- Modify: `apps/api/src/comum/problema.ts:49` (`statusPorCodigo`)
- Test: `apps/api/src/comum/problema.spec.ts` (criar se não existir)

**Interfaces:** `CODIGOS_DE_ERRO.<x>` → status: `TENTATIVA_NAO_ENCONTRADA` 404, `ESTADO_INVALIDO_PARA_ACAO` 409, `FILA_INDISPONIVEL` 503, `FALHA_TECNICA` 500, `ARQUIVO_VAZIO`/`CABECALHO_INVALIDO`/`MAPEAMENTO_INCOMPLETO` 422, `ARQUIVO_ACIMA_DO_LIMITE` 413. `CONFLITO_DE_VERSAO` já é 409.

- [ ] **Step 1: teste.**

```ts
it.each([
  ['TENTATIVA_NAO_ENCONTRADA', 404], ['ESTADO_INVALIDO_PARA_ACAO', 409], ['FILA_INDISPONIVEL', 503],
  ['ARQUIVO_ACIMA_DO_LIMITE', 413], ['ARQUIVO_VAZIO', 422], ['MAPEAMENTO_INCOMPLETO', 422],
] as const)('%s → %i', (codigo, status) => {
  expect(statusPorCodigo(CODIGOS_DE_ERRO[codigo])).toBe(status);
});
```

- [ ] **Step 2:** rodar → FALHA. **Step 3:** acrescentar os códigos e o mapa. **Step 4:** PASSA. **Step 5:** commit `feat(api): códigos de erro da importação do plano de contas (refs #15)`.

---

### Task 3: Migration 0015 corrigida, RLS e pendência no banco

**Files:**
- Rewrite: `packages/db/migrations/0015_importacao_plano_contas.sql`
- Modify: `packages/db/src/rls/classificacao.ts`, `packages/db/src/testes/fixtures-rls.ts`
- Test: `packages/db/src/plano-contas.integration.test.ts` (criar), `anti-drift.integration.test.ts` e `rls-matriz.integration.test.ts` (existentes devem passar)

**Interfaces — tabelas (todas com `tenant_id`, `empresa_id`, FK composta `(empresa_id, tenant_id) → app.empresa(id, tenant_id)`):**
- `app.conta_contabil(id, codigo, nome, tipo, natureza, conta_pai, arquivada, arquivada_em, versao, criado_em, atualizado_em)` — `UNIQUE(empresa_id, codigo)`; trigger impede mudar `codigo`/escopo e reativar.
- `app.empresa_plano_versao(empresa_id PK, tenant_id, versao bigint NOT NULL DEFAULT 0)` — incrementada em toda aplicação; é a **versão otimista do plano** (SPEC §6.3). Linha criada sob demanda (`INSERT … ON CONFLICT DO NOTHING`).
- `app.importacao_plano_contas(id, …, hash_arquivo, mapeamento jsonb, arquivo_nome, arquivo_tamanho, arquivo_chave, estado, plano_versao_na_validacao bigint NULL, totais jsonb NULL, usuario_iniciador_id, usuario_confirmador_id, usuario_cancelador_id, correlation_id, reutilizada_por_idempotencia, criado_em, iniciado_em, finalizado_em)` — `UNIQUE(id, empresa_id, tenant_id)` (necessário às FKs filhas); `UNIQUE(empresa_id, tenant_id, hash_arquivo, mapeamento)`.
- `app.importacao_plano_contas_evento` — append-only; `app.importacao_plano_contas_linha(… numero_linha, codigo text NULL, nome text NULL, tipo text NULL, natureza text NULL, conta_pai text NULL, status 'VALIDA'|'REJEITADA', acao 'INCLUIR'|'ATUALIZAR' NULL, codigo_de_erro NULL, campo NULL, mensagem NULL)` — colunas de valor **anuláveis** (linha rejeitada por campo ausente/fora do domínio precisa gravar o valor cru como texto sem CHECK de domínio).
- `app.importacao_plano_contas_notificacao(id, tenant_id, empresa_id, tentativa_id, usuario_id, lida, lida_em, criado_em)` — classe **empresa** (como `empresa_certificado_notificacao`), `UNIQUE(tentativa_id, usuario_id)`.
- Pendência: `DROP/ADD CONSTRAINT empresa_pendencia_origem_check` e `_tipo_check` incluindo origem `PLANO_CONTAS` e tipo `PLANO_CONTAS_INCOMPLETO`; **backfill** idempotente para toda empresa `ATIVA` sem conta não arquivada (`ON CONFLICT (empresa_id, chave) WHERE estado='ABERTA' DO NOTHING`, evento `CRIACAO`), chave `plano-contas:incompleto`.

**Defeitos do rascunho a corrigir (cada um vira uma asserção no teste de integração):**
1. FKs filhas exigem `UNIQUE(id, empresa_id, tenant_id)` na tentativa.
2. Notificação sem `empresa_id`.
3. Evento: apenas `REVOKE UPDATE` (aplicação precisa `INSERT/SELECT`); política só `SELECT/INSERT`; trigger `app.rejeitar_escrita_em_historico()`.
4. Notificação em classe `tenant` não funciona para contador/worker → classe `empresa`.
5. `GRANT UPDATE` da tentativa inclui `mapeamento`, `estado`, `plano_versao_na_validacao`, `totais`, `usuario_*`, `iniciado_em`, `finalizado_em`, `reutilizada_por_idempotencia`. Fluxo: a tentativa nasce **já com mapeamento** (passo 2 da UI cria a tentativa; o upload ocorre antes, ver Task 8), por isso a `UNIQUE` de idempotência não é circular.
6. `GRANT UPDATE` em `conta_contabil` inclui `atualizado_em`.
7. Versão do plano em `empresa_plano_versao` (acima), nunca `max(versao)` das contas.
8. Backfill e CHECKs de pendência (acima).
9. Colunas de valor da linha anuláveis (acima).

- [ ] **Step 1: teste de integração (falha).** `plano-contas.integration.test.ts` com dois pools (`criarPool()` superusuário semeia, `criarPoolDaAplicacao()` prova) e sufixo único por execução, cobrindo: (a) insert de conta duplicada no mesmo `empresa_id` falha `23505`; (b) tenant B não enxerga conta/tentativa/linha/notificação do tenant A; (c) humano fora da carteira não lê; (d) `UPDATE` em evento é negado, `DELETE` em tudo é negado; (e) `UPDATE conta_contabil SET codigo=…` rejeitado; reativar conta arquivada rejeitado; (f) backfill: empresa `ATIVA` sem conta tem pendência `PLANO_CONTAS_INCOMPLETO` aberta; (g) duas tentativas com mesmo hash+mapeamento → `23505`.
- [ ] **Step 2:** `pnpm db:migrate` no ambiente local (ver Task 0 do ambiente abaixo) e `pnpm --filter @contaia/db test:banco` → FALHA.
- [ ] **Step 3:** reescrever a migration (modelo estrutural: `0014_signer.sql`), registrar as 5 tabelas em `rls/classificacao.ts` (`appendOnly: true` no evento), fixtures de INSERT em `testes/fixtures-rls.ts` (com `colunaDeAtualizacao` onde há UPDATE).
- [ ] **Step 4:** `pnpm db:migrate && pnpm --filter @contaia/db test:banco` → PASSA, incluindo `anti-drift` e `rls-matriz`.
- [ ] **Step 5: commit** `feat(db): migration do plano de contas com RLS, versão do plano e pendência (refs #15)`.

> **Ambiente local (Task 0 informal):** os containers `contaia-*` (portas 151xx/181xx) já estão de pé nesta máquina. Carregar `.env` no shell (`set -a; . ./.env; set +a`) antes de `db:migrate`/`test:banco`. Criar instância nova com portas novas só se a atual for de outro worktree (`CLAUDE.md`).

---

### Task 4: Repositório do plano de contas

**Files:**
- Rewrite: `packages/db/src/repositorios/plano-contas.ts`; ajustar `packages/db/src/index.ts`
- Test: `packages/db/src/plano-contas.repositorio.integration.test.ts`

**Interfaces (todas recebem `PoolClient`, nunca abrem transação):**

```ts
criarTentativa(c, n: NovaTentativa): Promise<TentativaDeImportacao>            // ON CONFLICT → devolve a existente com reutilizada=true
buscarTentativa(c, empresaId: string, id: string): Promise<TentativaDeImportacao | null>   // sempre por empresaId
iniciarValidacao(c, tentativaId: string, agora: Date): Promise<void>           // RECEBIDA→VALIDANDO + lê versão do plano (cria linha se não existir)
gravarResultadoDaValidacao(c, tentativaId: string, linhas: readonly LinhaDeStaging[], agora: Date): Promise<TotaisDaPrevia>   // idempotente: DELETE-free; usa UNIQUE(tentativa_id, numero_linha) ON CONFLICT DO NOTHING
confirmar(c, ctx: {tentativaId; usuarioId; agora}): Promise<TentativaDeImportacao>      // AGUARDANDO_CONFIRMACAO→APLICANDO com UPDATE … WHERE estado='AGUARDANDO_CONFIRMACAO' (corrida: 0 linhas → ErroDeDominio ESTADO_INVALIDO_PARA_ACAO)
aplicarLinhas(c, tentativaId: string, agora: Date): Promise<{incluidas: number; atualizadas: number}>   // versão do plano checada: se != plano_versao_na_validacao → ErroDeConflito CONFLITO_DE_VERSAO; incrementa versão
finalizar(c, tentativaId, estadoFinal: 'CONCLUIDA' | 'CONCLUIDA_COM_REJEICOES', totais, agora): Promise<void>
cancelar(c, ctx: {tentativaId; usuarioId; agora}): Promise<void>               // só AGUARDANDO_CONFIRMACAO
registrarEvento(c, e: NovoEvento): Promise<void>
listarHistorico(c, empresaId, pagina: number): Promise<HistoricoDeImportacoes> // 15 por página, shape do shared
listarRejeicoes(c, empresaId, tentativaId, pagina, porPagina): Promise<PaginaDeRejeicoes>
listarLinhasParaRelatorio(c, empresaId, tentativaId): AsyncIterable<LinhaDoRelatorio>  // cursor, sem carregar 10k em memória
listarPlano(c, empresaId, pagina, porPagina, busca?): Promise<PaginaDoPlano>
contarContasValidas(c, empresaId): Promise<number>
criarNotificacao(c, n): Promise<boolean>                                       // ON CONFLICT DO NOTHING → false se já existia
```

Correções obrigatórias sobre o rascunho: `inserirLinhasStaging` insere `tenant_id`/`empresa_id` e usa a contagem de parâmetros certa (11 por linha → usar `unnest` com arrays em vez de placeholders posicionais); `aplicarLinhas` distingue incluída (`xmax = 0`) de atualizada e **nunca** toca conta arquivada (a validação já a rejeitou; o `WHERE arquivada=false` é defesa em profundidade e a contagem usa `RETURNING`).

- [ ] **Step 1:** testes de integração (um `it` por item): idempotência (`criarTentativa` repetida devolve a mesma, `reutilizada=true`); aplicar inclui novas e atualiza existentes e mantém ausentes; conta arquivada permanece intacta; versão mudou entre validação e confirmação → `CONFLITO_DE_VERSAO` e **nenhuma** conta alterada (transação revertida); **duas `confirmar` concorrentes** (`Promise.all`, dois clientes) → exatamente uma ok e uma `ESTADO_INVALIDO_PARA_ACAO`; `gravarResultadoDaValidacao` repetido não duplica linhas; `listarHistorico` devolve 15 por página, mais recente primeiro; `buscarTentativa` com `empresaId` errado → `null`.
- [ ] **Step 2:** rodar → FALHA. **Step 3:** implementar. **Step 4:** PASSA. **Step 5:** commit `feat(db): repositório transacional do plano de contas (refs #15)`.

---

### Task 5: Pendência "plano de contas incompleto"

**Files:**
- Modify: `packages/domain/src/pendencias/pendencias.ts` (tipos `OrigemDaPendencia`, `TipoDaPendencia`), `packages/db/src/repositorios/pendencias.ts` (`dispensar` l.271/281: `PLANO_CONTAS` também não dispensável), `apps/api/src/pendencias/pendencias.dto.ts` (l.15–31), `apps/api/src/comum/restricao-por-chave.ts`
- Create: `packages/domain/src/plano-contas/pendencias.ts` (+ teste)

**Interfaces:**

```ts
export const causasDoPlanoDeContas = (entrada: {
  readonly temContaValida: boolean;
  readonly hoje: string; // yyyy-mm-dd, injetado
}): readonly CausaDaPendencia[];
```

Devolve `[]` se `temContaValida`; senão uma causa `{ origem: 'PLANO_CONTAS', tipo: 'PLANO_CONTAS_INCOMPLETO', chave: 'plano-contas:incompleto', dataLimite: null }`. Segue o formato de `causasDeCertificado`.

- [ ] **Step 1: teste.**

```ts
it('sem conta válida abre pendência', () => {
  expect(causasDoPlanoDeContas({ temContaValida: false, hoje: '2026-10-08' })).toEqual([
    expect.objectContaining({ origem: 'PLANO_CONTAS', tipo: 'PLANO_CONTAS_INCOMPLETO', chave: 'plano-contas:incompleto' }),
  ]);
});
it('com conta válida não há causa', () => {
  expect(causasDoPlanoDeContas({ temContaValida: true, hoje: '2026-10-08' })).toEqual([]);
});
```

- [ ] **Step 2–4:** falha → implementar (tipos novos nas uniões, DTO, restrição) → passa; `packages/db/src/pendencias.integration.test.ts`: acrescentar caso "PLANO_CONTAS não é dispensável (409 `PENDENCIA_NAO_DISPENSAVEL`)".
- [ ] **Step 5: commit** `feat(domain): pendência de plano de contas incompleto (refs #15)`.

---

### Task 6: Notificação de conclusão no sino

**Files:**
- Modify: `packages/db/src/repositorios/notificacoes.ts` (`ITENS_DO_SINO` l.79: ramo novo; `marcarVariasComoLidas` l.250: `UPDATE` novo), `apps/web/src/features/notificacoes/api.ts` (`TipoDeNotificacao`), `apresentacao.ts` (`tipoDaNotificacao`, `rotaDaNotificacao`)
- Test: `packages/db/src/notificacoes.integration.test.ts`, `apps/web/src/features/notificacoes/sino-de-notificacoes.test.tsx`

**Interfaces:** tipo `IMPORTACAO_PLANO_CONTAS_CONCLUIDA`; o ramo filtra `usuario_id = $usuario` (só o iniciador vê). `rotaDaNotificacao` → `/empresas/{empresaId}?aba=plano-contas&tentativa={id}`.

- [ ] **Step 1:** testes: iniciador vê 1 item; outro usuário da mesma carteira vê 0; `marcarVariasComoLidas` marca só o do próprio usuário; no web, rótulo e rota corretos. **Step 2–4:** falha → implementar → passa. **Step 5:** commit `feat(notificacoes): conclusão da importação do plano de contas no sino (refs #15)`.

---

### Task 7: CSV puro (parser, mapeamento e relatório)

**Files:**
- Create: `packages/domain/src/plano-contas/csv.ts`, `relatorio.ts` + `csv.test.ts`, `relatorio.test.ts`; exportar no barrel `packages/domain/src/index.ts`
- Modify: `packages/shared/src/plano-contas.ts` (campos do mapeamento), `packages/shared/src/arquivos.ts` (`TipoDeArquivo` `'IMPORTACAO_PLANO_CONTAS'`: `.csv`, 10 MB, sem assinatura mágica; `conteudoConfereComOTipo` aceita texto)
- Dependência: `csv-parse` fica **só** no pacote que parseia. Para manter o domínio puro e sem I/O, o parser de baixo nível (`csv-parse/sync`) fica no worker e na API (validação de cabeçalho); o domínio expõe apenas funções sobre **linhas já tokenizadas** (`readonly string[][]`).

**Interfaces:**

```ts
export const LIMITE_DE_LINHAS = 10_000;
export const LIMITE_DE_BYTES = 10 * 1024 * 1024;
export type CampoDoContrato = 'codigo' | 'nome' | 'tipo' | 'natureza' | 'conta_pai';
export type Mapeamento = Readonly<Record<CampoDoContrato, string>>; // campo → nome da coluna de origem

export const decodificarCsv = (bytes: Uint8Array): { texto: string; delimitador: ',' | ';' | '\t' };
// remove BOM; tenta UTF-8 estrito, senão Latin-1; delimitador pelo cabeçalho (maioria, empate → ';'); lança ErroDeDominio ARQUIVO_VAZIO / CABECALHO_INVALIDO
export const validarMapeamento = (cabecalho: readonly string[], m: Mapeamento): readonly { campo: CampoDoContrato; motivo: 'AUSENTE' | 'COLUNA_INEXISTENTE' | 'COLUNA_REPETIDA' }[];
export const normalizarLinhas = (cabecalho: readonly string[], linhas: readonly (readonly string[])[], m: Mapeamento): readonly LinhaBruta[];
// LinhaBruta = { numero: number; codigo: string; nome: string; tipo: string; natureza: string; contaPai: string } — trim, tipo/natureza sem acento e minúsculos → 'analitica'|'sintetica'|'devedora'|'credora' ou o valor cru (domínio rejeita depois)
export const gerarRelatorioCsv = (linhas: AsyncIterable<LinhaDoRelatorio>): AsyncIterable<string>;
// separador ';', BOM, CRLF, escape de aspas; célula iniciada por = + - @ recebe prefixo '
export const MODELO_CSV: string; // 'codigo;nome;tipo;natureza;conta_pai\r\n1;Ativo;sintetica;devedora;\r\n…'
```

- [ ] **Step 1: testes (falham).** `decodificarCsv`: BOM removido; `;` detectado; Latin-1 `Matrícula` decodificado; vazio → `ARQUIVO_VAZIO`; só cabeçalho → `ARQUIVO_VAZIO`. `validarMapeamento`: faltando `natureza` → `[{campo:'natureza', motivo:'AUSENTE'}]`; mesma coluna para `codigo` e `nome` → `COLUNA_REPETIDA`. `normalizarLinhas`: `'Analítica '` → `'analitica'`; código `'01'` permanece `'01'`; código só de espaços → `''`. `gerarRelatorioCsv`: `=1+1` vira `'=1+1`; aspas escapadas; começa com BOM. `MODELO_CSV` roda sem rejeição em `validarLinhasDoPlano`.
- [ ] **Step 2–4:** falha → implementar → passa. **Step 5:** commit `feat(domain): parser, mapeamento e relatório CSV do plano de contas (refs #15)`.

---

### Task 8: API (upload, tentativa, prévia, confirmar, cancelar, consultas, relatório)

**Files:**
- Delete: rascunho em `apps/api/src/plano-contas/*`; Create: `plano-contas.controller.ts`, `plano-contas.service.ts` (casos de uso), `plano-contas.dto.ts`, `plano-contas.fila.ts` (provider BullMQ com `Symbol`), `plano-contas.apresentacao.ts` (DTO de saída)
- Modify: `apps/api/src/app.module.ts` (controller **antes** de `EmpresaController`, providers e fila), `apps/api/src/comum/storage.service.ts` (aceitar `empresaId` na chave: `${tenantId}/${empresaId}/${tipo}/${uuid}${ext}` via parâmetro opcional)
- Modify: `apps/api/src/auth/cobertura-de-acoes.spec.ts` (tabelas `ROTAS` l.154 e `CASOS` l.241)
- Test: `plano-contas.service.spec.ts` (regras, dublês), `plano-contas.controller.spec.ts`, `plano-contas.service.integration.test.ts` (banco+Redis+MinIO reais, padrão `signer.service.integration.test.ts`)

**Rotas** (`@Controller('empresas/:empresaId/plano-contas')`, `@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)`; **`@ExigePermissao` por método**, nunca na classe):

| Método | Rota | Permissão |
|---|---|---|
| GET | `modelo` | `baixar_relatorio` |
| POST | `importacoes` (multipart: `arquivo` + `mapeamento` JSON) | `importar` |
| GET | `importacoes?pagina=` | `consultar` |
| GET | `importacoes/:id` (prévia/estado, com `empresaId` conferido) | `consultar` |
| GET | `importacoes/:id/rejeicoes?pagina=` | `consultar` |
| GET | `importacoes/:id/relatorio` (CSV) | `baixar_relatorio` |
| GET | `importacoes/:id/arquivo` (original) | `baixar_relatorio` |
| POST | `importacoes/:id/confirmar` (corpo `{versaoDaPrevia}`) | `confirmar_importacao` |
| POST | `importacoes/:id/cancelar` | `confirmar_importacao` |
| GET | `contas?pagina=&busca=` | `consultar` |

Decisões técnicas fixadas (não são regra de produto): o upload é multipart na API (padrão F4); o **SHA-256 é calculado no servidor**; o mapeamento vem junto no `POST importacoes` (assim a tentativa nasce idempotente por `hash+mapeamento`); cabeçalho e tamanho são validados **antes** de criar a tentativa (rejeição de arquivo → problem+json, sem staging); o relatório CSV é gerado sob demanda a partir das linhas do banco (determinístico), o original fica no storage; cancelar/confirmar exigem a permissão, **não** exigem ser o iniciador (SPEC §3.8 "usuário autorizado").

**Interfaces do serviço:**

```ts
class PlanoContasService {
  enviar(ctx: Contexto, empresaId: string, arquivo: {buffer: Buffer; nome: string; mimetype: string}, mapeamento: Mapeamento): Promise<VisaoDaTentativa>;
  previa(ctx: Contexto, empresaId: string, id: string): Promise<VisaoDaTentativa>;
  confirmar(ctx: Contexto, empresaId: string, id: string, versaoDaPrevia: number): Promise<VisaoDaTentativa>;
  cancelar(ctx: Contexto, empresaId: string, id: string): Promise<VisaoDaTentativa>;
  historico(ctx: Contexto, empresaId: string, pagina: number): Promise<HistoricoDeImportacoes>;
  rejeicoes(ctx, empresaId, id, pagina): Promise<PaginaDeRejeicoes>;
  relatorio(ctx, empresaId, id): AsyncIterable<string>;
  plano(ctx, empresaId, pagina, busca?): Promise<PaginaDoPlano>;
  protected agora(): Date;
}
// Contexto = { tenantId: string; usuarioId: string; correlationId: string }  (de tenantDa/autorDa/obterCorrelationId)
```

`confirmar` abre **uma** transação com `comContextoHumano` e, dentro dela e nesta ordem: `confirmar` (repositório) → `aplicarLinhas` (versão otimista) → `registrarEvento` → `finalizar` → reconciliar pendência (`causasDoPlanoDeContas` + `reconciliar` filtrado pela origem `PLANO_CONTAS`) → `criarNotificacao` ao iniciador. Falha em qualquer ponto reverte tudo. Reenvio idêntico (`reutilizada`) devolve o resultado terminal e **não** notifica.

- [ ] **Step 1: testes de regras (falham)** com `PoolDoBanco`/storage/fila dublados: arquivo > 10 MB → `ARQUIVO_ACIMA_DO_LIMITE`; 10.001 linhas → idem; mapeamento incompleto → `MAPEAMENTO_INCOMPLETO`; mesmo arquivo+mapeamento → reutiliza (sem novo `add` na fila); mapeamento diferente → nova tentativa; `confirmar` em tentativa de outro `empresaId` → `TENTATIVA_NAO_ENCONTRADA`; `confirmar` fora de `AGUARDANDO_CONFIRMACAO` → `ESTADO_INVALIDO_PARA_ACAO`; fila indisponível → tentativa fica `RECEBIDA` e o erro é `FILA_INDISPONIVEL` (503, retomável). `cobertura-de-acoes.spec`: `ROTAS` com `TODOS` para consultar/baixar e `so('admin_escritorio','contador')` para importar/confirmar/cancelar; `CASOS` com papel personalizado `['importar']` negado em confirmar e `['baixar_relatorio']` permitido no download.
- [ ] **Step 2:** rodar `pnpm --filter @contaia/api test:regras` → FALHA. **Step 3:** implementar. **Step 4:** PASSA (incluindo o anti-drift de `cobertura-de-acoes` e `app.module.spec.ts`, que pega falha de DI).
- [ ] **Step 5:** teste de integração (banco + Redis + MinIO locais): upload real → job na fila; confirmação concorrente (duas chamadas) → uma aplica; contador de empresa fora da carteira → 403 `EMPRESA_FORA_DA_CARTEIRA`; outro tenant → 404; `auxiliar` em `POST importacoes` → 403; relatório CSV começa com BOM e neutraliza `=`.
- [ ] **Step 6: commit** `feat(api): importação do plano de contas (upload, prévia, confirmação, relatório) (refs #15)`.

---

### Task 9: Worker de validação

**Files:**
- Modify: `apps/workers/src/config.ts` (separar config do mTLS do Signer: `lerConfigBase` exige só `REDIS_URL`; `lerConfigDoSigner` mantém os arquivos de cert; `main.ts` sobe cada consumidor só se sua config existir), `consumidores.ts` (registro), `package.json` (`@aws-sdk/client-s3`, `csv-parse`, `@contaia/shared`)
- Create: `apps/workers/src/plano-contas/validacao.ts` (processador), `leitura-s3.ts`, `validacao.test.ts`, `validacao.integration.test.ts`
- Modify: `infra/docker/compose.yml` (serviço `workers`: `S3_ENDPOINT`, `S3_BUCKET`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `depends_on: minio`)

**Interfaces:**

```ts
export const processarValidacao = async (deps: {
  pool: Pool; ler: (chave: string) => Promise<Buffer>; agora: () => Date;
}, job: unknown): Promise<void>;
```

Fluxo: valida o payload com `ComandoValidarImportacaoSchema` (inválido → `UnrecoverableError('PAYLOAD_INVALIDO')`) → `comContexto(pool, contextoTecnico({ finalidade: 'PROCESSAMENTO_DE_EMPRESA', tenantId, empresaId, correlationId }))` → `iniciarValidacao` → lê o original → `decodificarCsv` + `csv-parse` + `normalizarLinhas` → carrega contas vigentes (códigos + arquivada + se têm filhas) → `validarLinhasDoPlano` → `gravarResultadoDaValidacao` (estado `AGUARDANDO_CONFIRMACAO`, ou `REJEITADA` se zero válidas). Falha transitória relança (BullMQ repete: `attempts: 5`, backoff exponencial 2 s, nomes/opções vindos de `@contaia/shared`); tentativas esgotadas → estado `FALHA` + evento com **código estável** (nunca mensagem crua) e job na fila morta (padrão `consumidores.ts`). `jobId` determinístico (`validacao:{tentativaId}`).

- [ ] **Step 1: testes de regras** com dublês: CSV bom → `AGUARDANDO_CONFIRMACAO` com totais; CSV com ciclo → linhas rejeitadas, restante válido; zero válidas → `REJEITADA`; payload inválido → `UnrecoverableError`; erro de leitura S3 → relança (retry).
- [ ] **Step 2: integração** (Redis `16379`, `prefix` único por teste, `obliterate` no `afterAll`): job entregue **duas vezes** não duplica linhas nem muda o resultado; após esgotar tentativas o estado é `FALHA` e a DLQ guarda só o código; worker de outro tenant não lê a tentativa (RLS).
- [ ] **Step 3–4:** falha → implementar → passa (`pnpm --filter @contaia/workers test:regras` e `test:banco`).
- [ ] **Step 5: commit** `feat(workers): validação assíncrona do plano de contas em staging (refs #15)`.

---

### Task 10: Web — cliente, aba "Plano de contas" e fluxo de importação

**Antes de escrever UI:** invocar `frontend-design` (modo Operate, sem trocar a direção visual aprovada) e ler `docs/DESIGN-SYSTEM.md`, `docs/design-system/{TOKENS,COMPONENTS,PATTERNS,DEBITO}.md`, `docs/FRONTEND.md`, `docs/telas/DESIGN-CLARO.md` e `DESIGN-ESCURO.md`, e a referência `docs/telas/contaia_onboarding_de_clientes_importa_o_de_legados_rf_01/{screen.png,code.html}`.

**Files (Create em `apps/web/src/features/plano-contas/`):** `api.ts` (via `requisitar`; envio com `FormData`), `queries.ts` (chaves `['plano-contas', tenantId, empresaId, …]`; mutações com `invalidateQueries`, `toast.success`, `onError: avisarFalha`), `permissoes.ts` (strings das 4 chaves + `concede(sessao, chave)`), `aba-plano-de-contas.tsx`, `envio-do-csv.tsx` (dropzone, valida extensão/tamanho antes de enviar com `validarArquivo`), `mapeamento-de-colunas.tsx` (lê o cabeçalho no navegador; pré-seleciona colunas com mesmo nome do modelo; bloqueia avanço com campos ausentes), `acompanhamento.tsx` (polling com `refetchInterval` enquanto `RECEBIDA|VALIDANDO|APLICANDO`; região `aria-live="polite"`), `previa.tsx` (totais, tabela de rejeições paginada, `Confirmar importação`/`Cancelar importação` em `AlertDialog`), `resultado.tsx`, `historico.tsx` (15/página, página na URL), `plano-vigente.tsx`.
**Modify:** `apps/web/src/features/empresa/manutencao-da-empresa.tsx` (aba nova `plano-contas` e **aba controlada pela URL** `?aba=`; a aba aparece para quem tem `consultar`), `pendencias/central-de-pendencias.tsx` (`ROTULO_DA_ORIGEM`, `ROTULO_DO_TIPO`, `OPCOES_DE_ORIGEM`, `ehOrigem`, ação "Abrir aba Plano de contas" → `?aba=plano-contas`), `pendencias/api.ts`.

**Estados obrigatórios (SPEC §5.3), todos com teste:** carregando (skeleton); sem plano e sem tentativa; arquivo selecionado; arquivo rejeitado antes do envio; mapeamento incompleto; validando; prévia sem rejeições; prévia com aceitação parcial; zero válidas; confirmando; concluída; concluída com rejeições (toast `warning` com link ao relatório); cancelada; falha técnica com `correlationId` copiável e nova tentativa; conflito por plano alterado (mensagem + botão "Validar novamente"); histórico vazio; relatório indisponível (histórico permanece, botão tenta de novo); permissão insuficiente (botões `importar`/`confirmar` ausentes **e** a API nega); empresa fora da carteira (`EmptyState` já existente em `PaginaDaEmpresa`).

- [ ] **Step 1: testes de tela (falham)**, padrão de `aba-de-documentos.test.tsx` (`QueryClientProvider` sem retry, `fetch` dublado com `application/problem+json`, `axe(container)` sem violações): um teste por estado acima; fluxo completo (selecionar CSV → mapear → ver prévia → confirmar → ver resultado); teclado (Tab até `Confirmar`, `Esc` fecha o diálogo e devolve o foco ao acionador); `auxiliar` não vê `Importar`; mapeamento incompleto desabilita `Continuar` e destaca os campos.
- [ ] **Step 2–4:** falha → implementar nos dois temas com tokens semânticos (sem hex, sem cor default do Tailwind) → `pnpm --filter @contaia/web test:tela` passa; `typecheck` e `lint` limpos (sem `any`, `as`, `!`, `@ts-ignore`).
- [ ] **Step 5:** commit `feat(web): aba Plano de contas com importação CSV (refs #15)`.

---

### Task 11: Onboarding — etapa do plano de contas

> **Decisão do PI pendente (ver mensagem de entrega do plano).** Empresa `CADASTRO_INCOMPLETO` não entra em carteira nem é legível pela RLS operacional; o plano só pode ser importado após a **ativação**. Proposta: o passo aparece como **etapa final opcional do wizard, exibida na tela de sucesso da ativação**, reutilizando `AbaPlanoDeContas`, com ação "Continuar sem importar" (mantém a pendência). Não altera `ETAPAS_DA_EMPRESA` (domínio) nem bloqueia a ativação.

**Files:** Modify `apps/web/src/features/empresa/wizard.tsx` (tela pós-ativação), Test `wizard-plano-de-contas.test.tsx`.

- [ ] **Step 1:** teste: após ativar, o wizard mostra a etapa "Plano de contas" com o mesmo componente da aba; "Continuar sem importar" navega para a empresa e a pendência aparece na Central; sem permissão `importar` a etapa só informa. **Step 2–4:** falha → implementar → passa. **Step 5:** commit `feat(web): etapa de plano de contas no fim do onboarding (refs #15)`.

---

### Task 12: E2E e fixtures

**Files:** Create `tests/e2e/spec-013-plano-contas.spec.ts`, `tests/e2e/fixtures/plano-bom.csv`, `plano-parcial.csv` (ciclo + pai ausente + duplicado + conta arquivada), `plano-legado.csv` (`;`, Latin-1, cabeçalhos de ERP para exercitar o mapeamento), `plano-so-cabecalho.csv`.

Padrão da `spec-012`: `mode: 'serial'`, escritório e usuários próprios (`e2e-f13-*`), `Pool` em `DATABASE_URL` para inspecionar banco, `PROVA_ESCOPO=SPEC-013`, provas visuais nos dois temas e em 768/1024/1440, varredura de segredo.

- [ ] **Step 1:** jornada: contador envia `plano-legado.csv` → mapeia → validação parcial → prévia → confirma → plano atualizado → baixa relatório CSV → histórico mostra a tentativa; verificar no banco que contas ausentes ficaram intactas e que o `correlationId` aparece na fila (job), no erro e no histórico. Contrafactuais: arquivo grande, cabeçalho inválido, zero válidas (pendência persiste e onboarding não bloqueia), ciclo, pai rejeitado, conta arquivada, **conflito concorrente** (plano alterado entre prévia e confirmação → 409 + revalidação), falha do worker (derrubar o consumidor → `FALHA` acionável), reenvio idêntico (sem nova conta/notificação), notificação só para o iniciador. Permissões: `auxiliar` consulta/baixa e não importa; outro tenant e empresa fora da carteira negados.
- [ ] **Step 2:** `pnpm docker:up && pnpm db:migrate && pnpm db:seed && pnpm build && PROVA_ESCOPO=SPEC-013 pnpm test:e2e` → PASSA (memória do projeto: se o Docker local travar, o E2E roda na CI; registrar `not_run` com motivo, nunca `pass`).
- [ ] **Step 3: commit** `test(e2e): jornada completa do plano de contas (refs #15)`.

---

### Task 13: Acabamento, documentação e entrega

- [ ] **Step 1: `impeccable`** sobre as telas (`critique bolder animate colorize layout clarify optimize polish`; inspecionar desktop e mobile, corrigir em um lote, uma confirmação). Capturar antes/depois, claro/escuro, 768/1024/1440, estados, foco e teclado (`FRONTEND.md` §20.1).
- [ ] **Step 2:** `superpowers:requesting-code-review` / `engineering:code-review` no diff inteiro; `security-reviewer` (upload, autorização, RLS, injeção de fórmula, nome de arquivo); `database-reviewer` na migration. Corrigir CRÍTICO/ALTO.
- [ ] **Step 3: `gstack:qa`** (smoke ao vivo com Playwright) e `gstack:design-review`.
- [ ] **Step 4: docs.** `docs/DEVELOPMENT.md`: seção "Card #15" com os passos executados; `docs/STATUS.md`: progresso (índice Fatia↔SPEC é do Cowork, não editar). Remover a duplicata `packages/importacao-plano-contas-client` do workspace e do lock.
- [ ] **Step 5: verificação final** (`superpowers:verification-before-completion`): `pnpm lint && pnpm typecheck && pnpm test:regras && pnpm test:banco && pnpm test:tela && pnpm build`; `pnpm check:workspace && pnpm check:gate`.
- [ ] **Step 6: PR** com `.github/pull_request_template.md` e `docs/PRS.md` §2 (Problema; antes/depois nos dois temas; prova de UI; escopo e limites; `refs #15`; tabela de validação; riscos/rollback; `not_run`). `gh pr checks <n> --watch` até `gate` verde; mergear; `superpowers:finishing-a-development-branch`; **`fechar-card`** (comentário de encerramento com Resumo, Aprendizado e Imprevistos) e só então `proplan:done`.

---

## Auto-revisão

**Cobertura da SPEC:** §3.2 arquivo → T7/T8; §3.3 campos → domínio existente/T7; §3.4 validação → domínio existente + T9; §3.5 prévia → T8/T10; §3.6 aplicação + 409 → T4/T8; §3.7 idempotência → T3/T4/T8; §3.8 cancelamento → T4/T8; §3.9 histórico/relatório → T4/T7/T8/T10; §3.10 pendência/notificação → T3/T5/T6/T8; §3.11 estados → domínio existente/T4; §3.12 autorização → T1/T8; §4 invariantes I-1/2/6/7/9 → T3/T4; §5 UI → T10/T11/T13; §6 fluxo e fila → T8/T9; §9–10 provas → T3/T4/T8/T9/T10/T12.

**Pontos que dependem de confirmação do PI:** posição do passo no onboarding (T11); relatório CSV gerado sob demanda em vez de gravado no storage ao fim da validação (SPEC §3.9 diz "associados à tentativa no armazenamento local"; o original está no storage, o relatório é derivável e determinístico das linhas imutáveis).

**Limites desta versão do plano:** as Tasks 8–12 listam assinaturas, rotas, estados e casos de teste exatos, mas o corpo do código de UI e dos casos de uso é escrito na execução, guiado pelos testes (TDD). Se o executor encontrar lacuna material na SPEC, volta ao PI.
