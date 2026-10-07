# Signer isolado e assinatura/mTLS simulada — Plano de implementação

> **Para agentes de implementação:** skill obrigatória `superpowers:executing-plans`; executar tarefa por tarefa com TDD (`superpowers:test-driven-development` em isolamento de tenant, decisão de acesso e idempotência). Em UI, usar `frontend-design` antes e durante, `gstack:design-review` e `impeccable` ao final. Reconciliar caminhos com a estrutura integrada sem alterar os contratos abaixo. Material de apoio do Code, não contrato: onde divergir do PRD ou da SPEC, a SPEC vence.

**Objetivo:** entregar o Signer isolado (assinatura XMLDSig e mTLS contra dublês locais DF-e/eSocial), com identidades técnicas mTLS, leitura estreita no Vault, idempotência, auditoria append-only, diagnóstico, monitor de saúde com incidentes e painel operacional na tela do Cofre, conforme a SPEC-012 (issue #14).

**Arquitetura:** núcleo funcional puro em `packages/domain`; contratos tipados versionados em `packages/shared`; persistência RLS e trilha append-only em `packages/db`; Signer (`apps/signer`) é o único consumidor do segredo e expõe uma API interna mTLS; workers (BullMQ/Redis) executam comandos, retry e monitor; API consulta e diagnostica sem poder assinar; web restaura card, coluna e painel. Signer, API, workers, Vault e dublês rodam no Compose, em rede `internal` sem porta publicada para o Signer.

**Stack:** Node 24, TypeScript strict, `node:https`/`node:tls` (PKCS#12 e mTLS), `xml-crypto` (XMLDSig, versão fixada — ver Tarefa 5), BullMQ + ioredis (versões fixadas), NestJS 11, Next.js 16, PostgreSQL com RLS, Vault KV v2, Vitest e Playwright.

**Spec:** `docs/prd/mvp/spec/SPEC-012-signer-isolado-assinatura-mtls-simulada.md`

## Decisões do PI para esta fatia (registradas em 07/10/2026)

| Tema | Decisão |
|---|---|
| Topologia | API e workers entram no Compose; Signer na rede `internal` sem `ports`; só a API publica porta em `127.0.0.1` |
| Fila | BullMQ sobre o Redis do Compose para diagnóstico, retry/backoff/DLQ e monitor de 1 minuto |
| Incidente | alerta e recuperação notificam os `admin_escritorio` ativos de **todos** os tenants com A1 vigente, por contexto técnico novo e restrito a esse fluxo |

## Decisões do Code (reversíveis, a registrar na PR)

- Chaves de permissão novas no catálogo F8: `certificados.signer.consultar` e `certificados.signer.testar` (padrões: `admin_escritorio` e `contador` ambos; `auxiliar` e `auditor_readonly` só `consultar`). Teste manual exige a chave **e** `podeMutarCofre`-equivalente (admin ou contador da carteira ativa).
- Papel de banco próprio `contaia_signer` (NOBYPASSRLS, sem DELETE, UPDATE por coluna) para a menor superfície do Signer; workers e API seguem em `contaia_app` com contexto técnico.
- Chave idempotente persistida só como `HMAC-SHA256(chave, SIGNER_IDEMPOTENCIA_PEPPER)`; o pepper vem de arquivo de segredo, nunca de variável em claro.
- Isolamento tenant/empresa no Vault: o caminho é **derivado dos metadados no banco** (`referencia_segredo`, tenant e empresa da linha), nunca do chamador; a política `signer-leitura` continua `read` por prefixo e um teste prova ausência de `list`, escrita e leitura de metadata.
- Dependência criptográfica nova (`xml-crypto`) e BullMQ/ioredis: justificativa e análise de manutenção na descrição da PR; proposta de ADR enviada ao PI (ADR é do Cowork).

## Restrições globais

- Node `>=24 <25`, TypeScript sem `any` implícito, `unknown` antes de validar dado externo.
- Erros de domínio com código estável; respostas HTTP `application/problem+json` com `type`, `title`, `status`, `code`, `correlationId`.
- Instantes em UTC; validade de certificado em data civil (`I-11`).
- Nunca `rejectUnauthorized: false`, CA universal, TLS sem validação ou HTTP simples nos dublês.
- Nenhum DTO com URL, host, porta, caminho do Vault, PKCS#12, senha, chave ou token.
- Somente material criptográfico e CAs de teste; nada de produção, KMS/HSM ou órgão oficial.
- Docker: primeira subida desta fatia cria **instância nova** (`COMPOSE_PROJECT_NAME=contaia-f12`) com **portas novas** no `.env`; nunca reaproveitar as portas já configuradas.
- Nova tabela exige classificação anti-drift em `packages/db/src/rls/classificacao.ts`, matriz/fixtures/cenário RLS e `appendOnly` nas de trilha.
- Texto de UI em PT-BR, Toast via Sonner, temas CLARO e ESCURO, viewports 768/1024/1440.
- PR referencia `refs #14`, nunca `closes`.

## Foco da revisão (entradas que a SPEC implica e nenhuma tarefa isolada exercita)

1. Chave idempotente reutilizada com conteúdo, empresa ou finalidade diferentes → 409 estável, sem tocar Vault nem dublê.
2. Duas chamadas simultâneas com a mesma chave → uma só executa; a outra recebe estado não terminal.
3. XML com `Signature` pré-existente incompatível, dois elementos-alvo (wrapping) ou DOCTYPE/entidade externa → recusa criptográfica sem nenhuma saída de rede.
4. 404 do Vault por soft delete (`inutilizar` da F11) → `CERTIFICADO_DESATIVADO`, não falha genérica.
5. Valor sentinela no segredo de teste ausente de respostas, logs, traces, HTML, screenshots e artefatos.

---

## 1. Mapa de responsabilidades

```text
packages/domain/src/signer/        finalidades, condição do certificado, idempotência, estado, incidente (puro)
packages/shared/src/signer.ts      contratos v1, códigos de erro, schemas zod
packages/db/migrations/0014_*.sql  operação, evento, estado por finalidade, verificação, incidente, notificação
packages/db/src/repositorios/signer*.ts
apps/signer/src/                   servidor mTLS, identidade, Vault, XMLDSig, adaptadores, orquestração
apps/workers/src/                  consumidores BullMQ, retry/DLQ, monitor de saúde
apps/api/src/signer/               cliente mTLS, consulta, diagnóstico manual, hook pós-F11
apps/web/src/features/cofre/signer/  card, coluna, painel, histórico
infra/docker/                      rede internal, CA local, Dockerfiles, dublês, política Vault
tests/e2e/spec-012-*.spec.ts       jornada, negações e vazamento
```

O domínio não importa NestJS, Drizzle, TLS, XML ou relógio. O Signer não importa `apps/api`. A API não importa o módulo de assinatura do Signer.

---

### Tarefa 1: Contratos e núcleo puro

**Arquivos:**

- Criar: `packages/domain/src/signer/{finalidades,condicao-certificado,idempotencia,estado,incidente}.ts` e `*.test.ts`
- Criar: `packages/shared/src/signer.ts`
- Modificar: `packages/domain/src/index.ts`, `packages/domain/src/erros.ts`, `packages/shared/src/index.ts`

**Interfaces produzidas:**

```ts
export const FINALIDADES = ['DFE_TESTE', 'ESOCIAL_TESTE'] as const;
export type Finalidade = (typeof FINALIDADES)[number];
export type DecisaoIdempotencia =
  | { tipo: 'NOVA' }
  | { tipo: 'REUTILIZAR'; operacaoId: string }
  | { tipo: 'EM_ANDAMENTO'; operacaoId: string }
  | { tipo: 'RETENTAR'; operacaoId: string }
  | { tipo: 'CONFLITO' };
export function decidirIdempotencia(existente: OperacaoExistente | null, pedido: PedidoIdempotente): DecisaoIdempotencia;
export function certificadoUtilizavel(v: VersaoDoCertificado, hojeCivil: string): { ok: true } | { ok: false; codigo: CodigoBloqueio };
export function piorEstado(estados: readonly EstadoFinalidade[]): EstadoFinalidade;
export function avancarIncidente(atual: Incidente | null, verificacao: 'OK' | 'FALHA', agora: Date): TransicaoIncidente; // abre na 3ª falha consecutiva, encerra na 1ª OK
```

- [ ] **Passo 1: testes falhos.** Cobrir: catálogo fechado (finalidade livre rejeitada); certificado ausente/vencido/futuro/desativado bloqueia e responsável inválido **não** bloqueia; `decidirIdempotencia` para cada ramo (terminal reutiliza, mesmo hash em andamento, transitória retenta, falha definitiva reutiliza recusa, qualquer divergência de tenant/empresa/finalidade/hash é `CONFLITO`); `piorEstado`; incidente: 2 falhas não abrem, 3ª abre e emite `NOTIFICAR_INDISPONIBILIDADE` uma única vez, falhas seguintes não repetem, 1ª OK encerra e emite `NOTIFICAR_RECUPERACAO` com duração.
- [ ] **Passo 2:** `pnpm --filter @contaia/domain test:regras -- signer` → FAIL por módulo ausente.
- [ ] **Passo 3:** implementar funções puras (o "agora" e a data civil entram por parâmetro) e o contrato em `packages/shared/src/signer.ts`: comandos `Assinar`, `ExecutarMtls`, `Diagnosticar`, consultas `Saude`, `Estados`, `Historico`; schemas zod `.strict()` sem campos proibidos; códigos `SIGNER_*` estáveis (identidade, alçada, contexto, finalidade, certificado, XML, vault, mtls, idempotência).
- [ ] **Passo 4:** teste de contrato que reprova qualquer schema contendo `url|host|porta|vault|pkcs12|senha|token|chave_privada`.
- [ ] **Passo 5:** `pnpm --filter @contaia/domain --filter @contaia/shared test:regras typecheck` → PASS. Commit `feat: contratos e nucleo puro do signer`.

---

### Tarefa 2: Banco, RLS e papel `contaia_signer`

**Arquivos:**

- Criar: `packages/db/migrations/0014_signer.sql`, `packages/db/src/repositorios/signer.ts`, `packages/db/src/repositorios/signer.integration.test.ts`
- Modificar: `packages/db/src/rls/classificacao.ts`, `src/testes/{matriz-rls,fixtures-rls,cenario-rls}.ts`, `src/contexto.ts` (novas `FINALIDADES_TECNICAS`: `OPERACAO_DO_SIGNER`, `MONITORAMENTO_DO_SIGNER`)

**Tabelas (todas com `app.uuid_v7()`, UTC):**

| Tabela | Classe | Regra |
|---|---|---|
| `app.signer_operacao` | empresa | estado `EM_ANDAMENTO/CONCLUIDA/RECUSADA/FALHA_TRANSITORIA`; único `(tenant_id, empresa_id, finalidade, chave_hmac)`; `hash_conteudo`; `referencia_segredo`; UPDATE só de `estado`, `resultado_codigo`, `fim` |
| `app.signer_evento` | empresa, append-only | uma linha por tentativa/recusa/reutilização, com identidade técnica, usuário originador, latência, `correlation_id`, `reutilizado` |
| `app.signer_estado_finalidade` | empresa | projeção por `(empresa_id, finalidade)`: estado, último teste, latência |
| `app.signer_verificacao` | global, append-only | verificação de saúde (OK/FALHA, latência) |
| `app.signer_incidente` | global | aberto/encerrado + duração; mudanças de estado como eventos append-only |
| `app.signer_notificacao` | tenant | por `usuario_id`; `tipo` `INDISPONIBILIDADE`/`RECUPERACAO`; alimenta o sino |

- [ ] **Passo 1:** teste de integração falho: RLS por tenant/empresa, UPDATE/DELETE de evento rejeitado, unicidade idempotente, `contaia_signer` sem acesso fora das suas tabelas e sem DELETE, contexto técnico sem tenant não lê nada (`I-2`).
- [ ] **Passo 2:** `pnpm --filter @contaia/db test:banco -- signer` → FAIL.
- [ ] **Passo 3:** migration e repositórios; função `SECURITY DEFINER` `app.signer_administradores_a_notificar()` que devolve `(tenant_id, usuario_id)` de `admin_escritorio` ativos em tenants com certificado `VIGENTE`, executável **somente** com a finalidade `MONITORAMENTO_DO_SIGNER`; ampliar o CHECK de `tipo` do sino.
- [ ] **Passo 4:** `pnpm --filter @contaia/db test:banco` e o anti-drift → PASS. Commit `feat: persistencia rls do signer`.

---

### Tarefa 3: PKI mTLS local e dublês

**Arquivos:**

- Modificar: `scripts/gerar-pki-de-teste.mjs` (+ teste) para emitir CA interna `AC mTLS Interna ContaIA (teste)`, certificados `signer` (server), `api` e `worker` (client) com SAN URI `urn:contaia:servico:<nome>` e EKU corretos, e certificados de servidor dos dublês com SAN DNS `duble-dfe`/`duble-esocial`
- Criar: `infra/docker/dubles/servidor-mtls.mjs`, `infra/docker/dubles/Dockerfile`, `infra/docker/dubles/servidor-mtls.test.ts`

- [ ] **Passo 1:** testes falhos do dublê: aceita A1 correto; recusa sem certificado cliente, certificado de CA não confiável e identidade (CNPJ) incompatível; deduplica por `Idempotency-Key` (mesmo efeito não é aceito duas vezes e a repetição devolve a resposta original).
- [ ] **Passo 2:** `node --test infra/docker/dubles` → FAIL.
- [ ] **Passo 3:** dublê com `https.createServer({ requestCert: true, rejectUnauthorized: true, ca })`; destino e porta fixos por finalidade via configuração; resposta controlável por cabeçalho de teste para simular timeout/indisponibilidade.
- [ ] **Passo 4:** segredos e chaves saem em `infra/docker/.vault-local/pki-mtls/` (gitignored); PASS. Commit `feat: pki mtls local e dubles`.

---

### Tarefa 4: Servidor mTLS do Signer, identidades e leitura do Vault

**Arquivos:**

- Criar: `apps/signer/src/{config,identidade,alcada,problema,vault,contexto,rotas}.ts` e testes
- Modificar: `apps/signer/src/main.ts`, `package.json` (deps), `.env.example`

- [ ] **Passo 1:** testes falhos (mTLS real em loopback com certificados da Tarefa 3): sem certificado cliente → conexão recusada; identidade desconhecida/expirada → `SIGNER_IDENTIDADE_INVALIDA` antes do domínio; `api` chama `/v1/assinar` → `SIGNER_ALCADA_NEGADA`; `worker` chama `/v1/estados` → permitido só para leitura prevista; contexto cruzado/ausente recusado **sem** chamada ao Vault (spy no cliente).
- [ ] **Passo 2:** executar `pnpm --filter @contaia/signer test:regras` → FAIL.
- [ ] **Passo 3:** `node:https` com `requestCert/rejectUnauthorized`; identidade extraída do SAN URI do peer; matriz de alçadas `{worker: [assinar, executar-mtls, diagnosticar, saude], api: [saude, estados, historico, diagnosticar]}`; cliente Vault `fetch` com token lido do arquivo a cada uso (padrão `apps/cofre/src/vault.ts`), `GET kv/data/certificados/<tenant>/<empresa>/<referencia>` com caminho **montado a partir do banco**; 404 → `CERTIFICADO_DESATIVADO`; qualquer falha do Vault → `SIGNER_VAULT_INDISPONIVEL` sem fallback; PKCS#12 só em memória, `Buffer.fill(0)` ao final.
- [ ] **Passo 4:** PASS + `pnpm --filter @contaia/signer lint typecheck`. Commit `feat: servidor mtls do signer`.

---

### Tarefa 5: XMLDSig e adaptadores DF-e/eSocial

**Arquivos:**

- Criar: `apps/signer/src/xml/{assinar,verificar,seguranca}.ts`, `apps/signer/src/adaptadores/{dfe,esocial}.ts` e testes; fixtures em `apps/signer/src/xml/__fixtures__/`
- Modificar: `apps/signer/package.json` (`xml-crypto` fixado exato)

- [ ] **Passo 1:** consultar a documentação atual de `xml-crypto` pelo Context7; registrar versão, mantenedores, data da última release e histórico de CVE na descrição da PR.
- [ ] **Passo 2:** testes falhos: assina o elemento previsto (RSA-SHA256, digest SHA-256, c14n do contrato do adaptador) e a verificação com o certificado público passa; XML malformado, alvo ausente, alvo duplicado (wrapping), `Signature` pré-existente incompatível, DOCTYPE/entidade externa → recusa específica; adulterar o XML após assinar → verificação falha.
- [ ] **Passo 3:** parser sem resolução de entidades; um único alvo por `Id`; adaptador por finalidade com elemento-alvo e destino na configuração, nunca no comando.
- [ ] **Passo 4:** PASS. Commit `feat: assinatura xmldsig por finalidade`.

---

### Tarefa 6: Saída mTLS, idempotência e auditoria no Signer

**Arquivos:**

- Criar: `apps/signer/src/{executar-mtls,caso-de-uso}.ts` e testes de integração com o dublê da Tarefa 3

- [ ] **Passo 1:** testes falhos: sucesso envia a chave idempotente ao dublê e grava evento; repetição terminal não reassina nem chama o dublê (contadores); falha transitória (timeout) não é terminal e a nova tentativa reaproveita a operação; falha definitiva é terminal e reutilizada; mesma chave com conteúdo/empresa/finalidade diferentes → 409; chamada concorrente → estado não terminal; verificação de assinatura falha → dublê não é chamado; uma única tentativa externa por chamada.
- [ ] **Passo 2:** `pnpm --filter @contaia/signer test:regras -- caso-de-uso` → FAIL.
- [ ] **Passo 3:** caso de uso controla a transação: valida contexto → `decidirIdempotencia` → lê Vault → assina e verifica → mTLS (`https.request` com `pfx`, `passphrase`, `ca` da config, `servername` validado) → evento sanitizado (sem XML, sem resposta integral); `AbortSignal.timeout` por finalidade.
- [ ] **Passo 4:** PASS. Commit `feat: execucao mtls idempotente no signer`.

---

### Tarefa 7: Compose, rede privada e política do Vault

**Arquivos:**

- Modificar: `infra/docker/compose.yml`, `infra/docker/vault/bootstrap.mjs`, `.env.example`, `.github/workflows/ci.yml`, `playwright.config.ts`, `scripts/ci/validate-workspace.mjs`
- Criar: `apps/{signer,api,workers}/Dockerfile`, `infra/docker/vault/signer-politica.test.mjs`

- [ ] **Passo 1:** teste falho de política (Vault efêmero): token do Signer lê `kv/data/certificados/*`, **nega** `list`, escrita, `delete`, `metadata` e `sys/*`; token da API não lê nada em `kv/`.
- [ ] **Passo 2:** `node --test infra/docker/vault` → FAIL ou SKIP explícito (`not_run`, nunca PASS) sem Vault.
- [ ] **Passo 3:** redes `contaia_local` (publicada em 127.0.0.1) e `contaia_privada` (`internal: true`); Signer, dublês, Vault e Redis na privada; API e workers nas duas; Signer sem `ports`; segredos montados como arquivos; healthchecks; **instância nova** (`contaia-f12`, portas novas no `.env`). A API, hoje no host, passa a container; verificar chamadas API→cofre (host) com `extra_hosts: host-gateway`.
- [ ] **Passo 4:** teste de alcance: do host, conectar ao Signer falha (sem porta); da API com certificado `api` funciona. `pnpm docker:up && pnpm docker:ps`.
- [ ] **Passo 5:** ajustar o job `e2e` da CI (compose, PKI, `PROVA_ESCOPO: SPEC-012`). Commit `feat: compose com rede privada do signer`.

---

### Tarefa 8: Workers, BullMQ, monitor e incidentes

**Arquivos:**

- Criar: `apps/workers/src/{fila,consumidor-signer,monitor,cliente-signer,incidente}.ts` e testes
- Modificar: `apps/workers/package.json` (`bullmq`, `ioredis` fixados), `apps/workers/src/main.ts`

- [ ] **Passo 1:** testes falhos: job de diagnóstico chama o Signer com identidade `worker` e atualiza o estado da finalidade (`sistema` como autor); retry com backoff exponencial e teto, estouro vai para DLQ; monitor repetível de 60 s grava `signer_verificacao`; 3 falhas abrem **um** incidente e criam uma notificação por admin (lista da função da Tarefa 2); falhas seguintes não duplicam; primeira OK encerra, grava duração e notifica os mesmos admins; indisponibilidade **não** cria item na Central de Pendências; falha de uma finalidade não vira indisponibilidade global.
- [ ] **Passo 2:** `pnpm --filter @contaia/workers test:regras` → FAIL.
- [ ] **Passo 3:** consumidor e monitor usando `avancarIncidente`; contexto técnico `MONITORAMENTO_DO_SIGNER` apenas na criação das notificações.
- [ ] **Passo 4:** PASS. Commit `feat: fila e monitor de saude do signer`.

---

### Tarefa 9: API — consulta, diagnóstico e gancho da F11

**Arquivos:**

- Criar: `apps/api/src/signer/{signer.module,signer.controller,signer.service,cliente-signer}.ts` e specs
- Modificar: `packages/domain/src/papeis/{catalogo,papeis-padrao}.ts`, `apps/api/src/app.module.ts`, `apps/api/src/certificados/certificados.service.ts` (após `registrarEventoDeCertificado`, enfileirar diagnóstico DF-e e eSocial **fora da transação**), `apps/api/src/auth/cobertura-de-acoes.spec.ts`

- [ ] **Passo 1:** testes falhos: `GET /signer/estado`, `GET /empresas/:id/signer` e `GET /empresas/:id/signer/historico?pagina&finalidade&resultado` (15 por página, decrescente); `POST /empresas/:id/signer/testes` exige chave `certificados.signer.testar`, escopo de empresa e carteira ativa; admin do tenant e contador da carteira passam, contador fora da carteira, auxiliar e auditor são negados; a API não possui rota nem cliente capaz de assinar (teste estrutural); teste manual duplicado em andamento retorna estado e não enfileira outro; falha do diagnóstico pós-F11 **não** reverte a vigência.
- [ ] **Passo 2:** `pnpm --filter @contaia/api test:regras` → FAIL.
- [ ] **Passo 3:** implementar com `GuardDeSessao`, `GuardDeCadastro`, `GuardDeAcao`, `GuardDeEscopoDeEmpresa`, `@ExigePermissao`; problem+json; atualizar a cobertura de ações; `ClienteSigner` com certificado `api` e CA da config.
- [ ] **Passo 4:** `pnpm --filter @contaia/api test:regras test:banco typecheck lint` → PASS. Commit `feat: api de consulta e diagnostico do signer`.

---

### Tarefa 10: Notificações de incidente no sino

**Arquivos:**

- Modificar: `apps/api/src/notificacoes/*`, `packages/db/src/repositorios/notificacoes.ts`, web `features/notificacoes/*`

- [ ] **Passo 1:** testes falhos: cada admin vê só a própria notificação de indisponibilidade/recuperação; outro tenant não vê; texto sem dado sensível; marcação de lida segue o padrão existente.
- [ ] **Passo 2–4:** implementar quarta fonte do sino (`signer_notificacao`), PASS, commit `feat: notificacoes de incidente do signer`.

---

### Tarefa 11: Interface — card, coluna, painel e histórico

**Arquivos:**

- Criar: `apps/web/src/features/cofre/signer/{cartao-do-signer,coluna-signer,painel-do-signer,historico-do-signer,queries,api}.ts(x)` e testes
- Modificar: `apps/web/src/features/cofre/{cartoes-do-resumo,lista-do-cofre,detalhe-da-empresa,area-do-cofre}.tsx`, `lib/mensagens.ts`

- [ ] **Passo 1:** invocar `frontend-design` (preservar a direção já aprovada) e abrir `docs/telas/contaia_configura_es_cofre_de_certificados_a1/{code.html,screen.png}` (card ~L117, coluna ~L311) e `docs/FRONTEND.md` §20.1.
- [ ] **Passo 2:** testes de tela falhos (Testing Library + `jest-axe`): estados carregando/operacional/degradado/indisponível/sem certificado/teste em andamento/sucesso/falha acionável/histórico vazio/página sem resultado/acesso negado/dados desatualizados; `Testar mTLS` oculto sem permissão e desabilitado durante execução; `Esc` fecha o painel e devolve o foco; estado nunca só por cor; região `aria-live` polida; `prefers-reduced-motion`.
- [ ] **Passo 3:** implementar com TanStack Query (invalidar `['cofre']` + `['signer']`), Toast Sonner com `correlationId`, histórico com filtros e paginação de 15; **sem** reintroduzir procuração, RLS, toggles, download, KMS/HSM ou uptime.
- [ ] **Passo 4:** `pnpm --filter @contaia/web test:tela typecheck lint` → PASS.
- [ ] **Passo 5:** `gstack:design-review` e passe final `impeccable`; registrar o ciclo para a PR. Commit `feat: painel operacional do signer`.

---

### Tarefa 12: E2E, contrafactuais e varredura de segredo

**Arquivos:**

- Criar: `tests/e2e/spec-012-signer-mtls.spec.ts`, `tests/e2e/fixtures/varredura-sentinela.ts`

- [ ] **Passo 1:** jornada: cadastrar A1 de teste com senha **sentinela** → diagnóstico automático das duas finalidades → worker assina e chama o dublê → repetição idempotente (contador do dublê inalterado) → consultar histórico → capturas CLARO/ESCURO em 768/1024/1440.
- [ ] **Passo 2:** contrafactuais: outro tenant, contador fora da carteira, API tentando assinar, finalidade livre, certificado vencido/futuro/desativado, Vault parado, dublê parado, derrubar o Signer e observar incidente + notificação + recuperação.
- [ ] **Passo 3:** varredura da sentinela em respostas, logs dos containers, traces, HTML, screenshots e artefatos (`trace/video/screenshot` desligados nos passos com segredo, como na F11).
- [ ] **Passo 4:** `pnpm test:e2e -- spec-012` → PASS; commit `test: e2e do signer`.

---

### Tarefa 13: Documentação de entrega, PR e encerramento

**Arquivos:**

- Modificar: `docs/DEVELOPMENT.md` (bloco "Card #14" e tabela §2, incluindo F10/F11 defasados se ainda divergirem), `docs/STATUS.md` (progresso; índice Fatia↔SPEC é do Cowork), `docs/TESTING.md` (evidência SPEC-012), `docs/ARCHITECTURE.md` §7 (topologia final), `.env.example`

- [ ] **Passo 1:** `pnpm lint && pnpm typecheck && pnpm test:regras && pnpm test:banco && pnpm test:tela && pnpm build`; o que não rodar fica `not_run`, nunca `pass`.
- [ ] **Passo 2:** `engineering:code-review` do diff completo contra a `main`; `gstack:qa`; P0/P1 bloqueiam.
- [ ] **Passo 3:** abrir PR (`refs #14`, SPEC-012, validação, limitações, justificativa das dependências, decisões do Code, ciclo `frontend-design`/`impeccable`); `gh pr checks <n> --watch`.
- [ ] **Passo 4:** merge por squash com CI verde; confirmar `mergedAt`/`mergeSha`; `superpowers:finishing-a-development-branch`; skill `fechar-card`; só então `proplan:done`; indicar o próximo card.

---

## Autorrevisão

| Requisito da SPEC | Tarefa |
|---|---|
| §3.1 identidades e alçadas | 3, 4 |
| §3.2–3.3 contexto e finalidades | 1, 4 |
| §3.4–3.5 Vault e condição do certificado | 1, 4, 7 |
| §3.6 XMLDSig | 5 |
| §3.7 mTLS simulada | 3, 6 |
| §3.8 idempotência | 1, 2, 6 |
| §3.9 diagnóstico automático e manual | 8, 9 |
| §3.10 saúde e incidentes | 1, 2, 8, 10 |
| §3.11 histórico | 2, 9, 11 |
| §5 interface | 11 |
| §9 provas e contrafactuais | 12 |
| §10 CI com evidência SPEC-012/#14 | 7, 13 |
