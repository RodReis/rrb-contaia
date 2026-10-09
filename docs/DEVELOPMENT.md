# DEVELOPMENT.md — Ordem de execução e status por item

> **Mantido pelo Code/Codex**, atualizado **dentro da PR** a cada entrega, junto com o progresso em [`STATUS.md`](STATUS.md).
> Aqui moram os **passos**; o card é a fatia ([`CLAUDE.md`](../CLAUDE.md)). Uma issue por fatia, nunca por passo.

---

## 1. Ambiente

Do MVP-1 ao MVP-4, existe somente o ambiente Docker local definido na [ADR-012](adr/ADR-012-ambiente-local-ate-ultimo-mvp.md). Build, CI e homologação não publicam aplicação. Produção, piloto real e infraestrutura de nuvem são uma etapa posterior ao último MVP.

### 1.1 Requisitos

| Item | Versão |
|---|---|
| Node.js | 24.15.0 (`.nvmrc`) |
| pnpm | 10.33.2 (fixado em `packageManager`) |
| Docker + Compose | corrente (validado em 29.8.0) |
| Python | fixado em `services/ai/.python-version` (serviço ainda não criado) |

### 1.2 Primeira subida

```bash
pnpm install
cp .env.example .env            # portas e credenciais locais, todas sintéticas
pnpm docker:up                  # postgres, redis, keycloak e storage S3
pnpm db:migrate
pnpm dev
```

Portas reservadas para este projeto, verificadas como livres antes da primeira
subida: Web `15100`, API `15101`, workers `15102` (saúde, só dentro da rede),
PostgreSQL `15432`, Redis `16379`, Keycloak `18080`, storage `19000` e console
`19001`. Todas publicadas apenas em `127.0.0.1`. A F7 acrescenta o Mailpit, que
captura o e-mail do convite: SMTP `11025` e interface `18025` (`MAILPIT_SMTP_PORT`
e `MAILPIT_UI_PORT`). Quem já tem outra instância local sobe o Mailpit com portas
novas pelo `.env`, sem reutilizar as de outro projeto.

O **Signer não publica porta**: vive na rede privada do Compose (`contaia_privada`,
`internal`) e só as identidades de serviço o alcançam. `pnpm docker:up` agora também
prepara os segredos de teste e sobe a API, os workers, o Signer e os dublês mTLS (exige
`pnpm cofre:pki-teste` antes e o banco já migrado; ver o Card #14).

Para parar e limpar **somente** os volumes deste projeto:

```bash
pnpm docker:down
docker volume rm contaia_postgres contaia_redis contaia_minio
```

- **Autorizado a subir o Docker se estiver parado.** Na primeira vez, **criar instância nova com portas novas** — nunca reutilizar as portas já configuradas de outro projeto (`CLAUDE.md`).
- **No ambiente local, está previamente autorizado o uso de qualquer dado real necessário.** Produção continua fora dos MVPs 1–4 ([ADR-012](adr/ADR-012-ambiente-local-ate-ultimo-mvp.md)).

### 1.3 Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | web + api + workers em modo de desenvolvimento |
| `pnpm lint` / `pnpm typecheck` | qualidade estática |
| `pnpm test:regras` / `test:banco` / `test:tela` / `test:e2e` | categorias de [`TESTING.md`](TESTING.md) |
| `pnpm build` | build dos apps afetados |
| `pnpm db:migrate` / `db:generate` | migrations (Drizzle) |
| `pnpm docker:up` / `docker:down` / `docker:ps` | ambiente local |
| `pnpm check:workspace` | self-check estrutural do monorepo |
| `pnpm check:gate` | self-check do agregador da CI |

O relatório por categoria sai em `test-results/<SPEC|INFRA>/`; defina
`PROVA_ESCOPO` para nomear a pasta (ex.: `PROVA_ESCOPO=INFRA-1`).

---

## 2. Ordem de execução

A ordem de implementação é a **ordem do board** (`CLAUDE.md`): o Code pega sempre o primeiro `proplan:todo`.
Enquanto o fatiamento em MVP/SPEC não existir, esta tabela fica vazia — **ela não inventa ordem**.

| # | Card | Fatia / SPEC | Situação | PR | Observação |
|---|---|---|---|---|---|
| 1 | [#1](https://github.com/RodReis/rrb-contaia/issues/1) `[INFRA]` Bootstrap local do MVP-1 | — | entregue | #2 | precede a F1; sem F e sem SPEC |
| 2 | [#2](https://github.com/RodReis/rrb-contaia/issues/2) `[MVP1][SPEC-001][F1]` Acesso inicial e conclusão do cadastro do escritório | F1 / SPEC-001 | entregue | #7 | acesso OIDC, wizard de 5 etapas, edição por abas, RLS por tenant |
| 3 | [#3](https://github.com/RodReis/rrb-contaia/issues/3) `[MVP1][SPEC-002][F2]` Cadastro e ativação da empresa cliente | F2 / SPEC-002 | entregue | #42 | consulta CNPJá, wizard de 4 etapas, listagem com filtro na URL, unicidade por tenant |
| 4 | [#4](https://github.com/RodReis/rrb-contaia/issues/4) `[MVP1][SPEC-003][F3]` Manutenção da empresa cliente | F3 / SPEC-003 | entregue | #48 | abas de manutenção, finalidade de endereço, arquivamento com justificativa, Histórico de Informações append-only |
| 5 | [#5](https://github.com/RodReis/rrb-contaia/issues/5) `[MVP1][SPEC-004][F4]` Documentos da empresa | F4 / SPEC-004 | entregue | #49 | checklist, upload com versões, análise explícita, storage privado, histórico documental append-only |
| 6 | [#6](https://github.com/RodReis/rrb-contaia/issues/6) `[MVP1][SPEC-005][F5]` Central de Pendências cadastrais | F5 / SPEC-005 | entregue | #50 | reconciliação síncrona cadastral/documental, indicador na lista, dispensa com justificativa, histórico append-only |
| 7 | [#7](https://github.com/RodReis/rrb-contaia/issues/7) `[MVP1][SPEC-006][F6]` Notificações de pendências | F6 / SPEC-006 | entregue | #51 | sino, badge, painel das 15 mais recentes, seleção individual/lote, histórico paginado, notificação na mesma transação da reconciliação |
| 8 | [#9](https://github.com/RodReis/rrb-contaia/issues/9) `[MVP1][SPEC-007][F7]` Gestão de usuários e papéis padrão | F7 / SPEC-007 | em revisão | #95 | convite por e-mail com link de uso único, quatro papéis padrão aditivos, suspensão/arquivamento, proteção do último administrador, histórico de usuários, rota pública do convite |
| 9 | [#10](https://github.com/RodReis/rrb-contaia/issues/10) `[MVP1][SPEC-008][F8]` Papéis personalizados e permissões | F8 / SPEC-008 | em revisão | #98 | catálogo controlado por chave, papel por snapshot de um padrão, matriz por módulo/funcionalidade/ação, aplicação na próxima requisição, arquivamento e reativação com revisão, auditoria append-only |

---

## 3. Passos por card

Detalhamento operacional de cada card em execução. Passo concluído fica marcado, com o PR que o entregou.

### Card #1 — `[INFRA]` Bootstrap local do MVP-1 (PR #2)

- [x] Workspace pnpm + Turborepo, Node e pnpm fixados, TypeScript strict compartilhado
- [x] `@contaia/config`, `@contaia/shared` e `@contaia/domain`, com teste que barra framework no domínio
- [x] Shell Web em Next.js 16, tokens do design system nos dois temas e health check
- [x] API NestJS 11 com health check, Vitest no lugar do Jest do scaffold
- [x] Shells de workers e Signer, sem cofre, fila ou assinatura
- [x] PostgreSQL com pgvector, Drizzle e migration técnica; role `contaia_app` sem `BYPASSRLS`
- [x] Compose local com Redis, Keycloak e storage S3, portas próprias e health check real
- [x] Smoke E2E, com prova de que reprova quando um serviço está fora
- [x] CI paralela com gate agregador e resumo por categoria

### Card #2 — `[MVP1][SPEC-001][F1]` Acesso inicial e conclusão do cadastro do escritório (PR #7)

- [x] Validadores de CNPJ (com o formato alfanumérico vigente), CPF, telefone, CEP, e-mail e UF
- [x] Máquina de estado do cadastro: etapa só conclui com dado válido e arquivo persistido; ativação idempotente
- [x] Schema com RLS por `tenant_id`, CNPJ único global, um endereço principal ativo e anti-drift de schema
- [x] `app.uuid_v7()` própria — o PostgreSQL 17 não traz `uuidv7()` nativo
- [x] Resolução de identidade e checagem de CNPJ por função `SECURITY DEFINER` estreita, sem `BYPASSRLS`
- [x] Acesso OIDC pelo Keycloak com PKCE, sessão em cookie `httpOnly` e proxy que nunca expõe o token
- [x] Bloqueio de área operacional por guard no servidor enquanto o tenant está `CADASTRO_INCOMPLETO`
- [x] Wizard de cinco etapas com retomada, uploads de logo e documentos e conclusão transacional
- [x] Edição por abas depois da ativação, sem reabrir o wizard
- [x] Telas nos temas CLARO e ESCURO, com os quatro estados e sem violação de acessibilidade
- [x] Provas: 80 de regras, 34 de banco, 8 de tela e 9 E2E, com o caminho crítico na CI

### Card #3 — `[MVP1][SPEC-002][F2]` Cadastro e ativação da empresa cliente (PR #42)

- [x] Domínio puro da empresa: regimes, enquadramento só no Simples, inscrição com número apenas em `POSSUI`, ativação idempotente
- [x] Regime tributário nunca inferido — ausência de Simples não decide entre Presumido e Real
- [x] Schema com RLS por `tenant_id` e **unicidade de CNPJ por tenant**, não global: dois escritórios podem atender a mesma empresa sem um descobrir o outro
- [x] `REVOKE DELETE` no default ACL do schema e nas tabelas existentes — o `ALTER DEFAULT PRIVILEGES` do F1 não bastava e toda tabela nova nascia com DELETE, violando I-7
- [x] Porta de consulta de CNPJ com falha como valor: indisponibilidade, limite e não encontrado liberam o preenchimento manual em vez de lançar
- [x] Adaptador da CNPJá no servidor, resposta como `unknown` validada por Zod, quadro societário e excedente descartados, timeout por `AbortSignal`
- [x] Telefone e e-mail que a validação do produto recusa não são propostos — a base pública guarda número anterior ao nono dígito
- [x] Consulta antes da criação: duplicidade no tenant abre o cadastro existente em vez de criar segunda empresa
- [x] Wizard de quatro etapas com persistência por etapa, retomada na primeira pendente e ativação transacional
- [x] Situação cadastral externa irregular exige confirmação em `AlertDialog` nomeando empresa e CNPJ
- [x] Listagem com busca, filtro e página na URL, contagem total, quatro estados e colapso em cartões abaixo de 768px
- [x] Componentes novos do catálogo: `Select` (Radix) e `StatusBadge` (dot + rótulo, cor nunca sozinha)
- [x] `EmptyState` e `ErroDeTela` com `nivel` — o `<h3>` fixo pulava nível depois do `<h1>` e reprovava no `heading-order`
- [x] Telas nos temas CLARO e ESCURO, com os quatro estados e sem violação de acessibilidade
- [x] Provas: 107 de regras, 50 de banco, 21 de tela e 4 E2E; prova externa real executada fora da CI com o CNPJ de teste da SPEC

### Card #9 — `[MVP1][SPEC-007][F7]` Gestão de usuários e papéis padrão (PR #95)

- [x] Quatro papéis padrão **aditivos** (matriz capacidade × ação em `packages/domain/src/usuarios/papeis.ts`, `administrar` implica todas); `GuardDeAcao` **falha fechado**: rota sem `@ExigeAcao`/`@AcaoLivre` é negada, e o teste de cobertura reprova rota esquecida — esquecer anotação nunca abre acesso
- [x] Papel e situação são lidos **ao vivo** em `app.resolver_identidade` a cada requisição: suspender, arquivar ou trocar papel vale na requisição seguinte, mesmo com JWT ainda válido (nenhuma revisão cacheada no token)
- [x] Convite do produto, não do Keycloak: token de 256 bits, só o `sha256` vai ao banco, 48 h, uso único; reenvio ou correção de e-mail invalida o link anterior; **qualquer recusa responde o mesmo `CONVITE_INVALIDO`** (sem oráculo de "usado/expirado/inexistente"). O aceite consome o convite como **primeiro passo** da transação, então dois aceites simultâneos se serializam antes de tocar o Keycloak
- [x] Expiração do convite é **preguiçosa** (sem worker): o evento `CONVITE_EXPIRADO` nasce, de forma idempotente, ao listar, consultar o histórico, tentar aceitar ou reenviar. Reenviar sem reconciliar antes perdia o evento (invalidar vem antes de reconhecer o vencimento)
- [x] Keycloak entra **dentro** da transação do banco, com compensações. A compensação precisa ser registrada **antes** da chamada: com timeout de 5 s, o Keycloak pode aplicar depois de o cliente desistir, e o erro subiria sem compensação (identidade com e-mail novo ou conta ativa sem o aceite gravado). Todas as compensações são idempotentes
- [x] **Último administrador: travar linhas de papel não basta.** Suspender e arquivar mudam `usuario.estado`, não o papel; a segunda transação lia o estado do snapshot antigo e os dois admins se suspendiam em paralelo (escritório sem administrador). `travarAdminsAtivos` agora toma um lock consultivo por tenant **antes** da consulta. O teste de concorrência original só cobria rebaixar × rebaixar
- [x] Quem altera um usuário o carrega com `for update`: sem isso, dois "suspender" simultâneos gravavam dois eventos e duas edições se sobrescreviam. Falta o controle otimista por `versao` (deferido)
- [x] **Rota pública do convite** (`/api/publico/convites/*`): lista fechada de caminhos, sem `Authorization` nem cookie, corpo com teto de 8 KB. O limitador em memória (10/min por cliente e rota) lê a **última** entrada de `X-Forwarded-For`, que a web escreve — o início da lista vem do cliente e permitia zerar o limite e encher o `Map`; agora há teto de chaves, limpeza amortizada e teto global por rota
- [x] **Corrigir o e-mail de um convidado só funcionava no dublê**: o Keycloak 26 recusa trocar `username` (`error-user-attribute-read-only`) com `editUsernameAllowed=false`, e a API respondia 503. O realm local passou a permitir, e um E2E contra o Keycloak real cobre o caso. PUT parcial (`{enabled}`, `{email}`) preserva nome e sobrenome — verificado ao vivo
- [x] Sem carteira (F9 ainda não existe), só `admin_escritorio` enxerga empresas; os demais veem zero. As listas devolvem `escopoDeEmpresas: 'NENHUMA'` e a tela diz "Você ainda não tem empresas na sua carteira" (componente `SemCarteira`) em vez de afirmar "Sem pendências" ou "Sem notificações"
- [x] Migration `0009` troca `usuario.papel/situacao` por `estado` + `usuario_papel` (sem DELETE: papel removido ganha `removido_em`), com backfill, e **aborta** se sobrar usuário ativo sem papel em vez de mascarar com default. `usuario_evento` é append-only por trigger e `REVOKE`; RLS forçada nas três tabelas novas
- [x] E-mail único **entre escritórios** (índice em `lower(email)`): a recusa não diz de quem é. Efeito: o seed local reassocia o usuário existente quando o Keycloak é recriado sem reset do Postgres, em vez de criar um segundo tenant
- [x] UI: lista (tabela só a partir de 1024 px, cartões abaixo — a 768 px a tabela cortava as ações), catálogo de papéis, wizard de duas etapas com revisão, edição por abas, aceite público e aba "Usuários e acessos" no Histórico, nos dois temas, em 390/768/1024/1440 px
- [x] **E2E da F7 roda em escritório e administrador próprios**: ativar o tenant do seed quebrava a SPEC-001 (exige tenant incompleto) sob paralelismo; e o helper `abrirEtapa` da F2 usava `isVisible` (não espera) e falhava com a máquina ocupada
- [x] **Banco de teste limpo antes do E2E completo, com 2 workers** (como a CI): com workers ilimitados as `beforeAll` das specs 003–006 ativam o tenant antes de a SPEC-001 rodar, falha que já existia
- [x] **A imagem do MinIO saiu dos registros públicos**: `quay.io/minio/minio` (qualquer tag, inclusive a fixada) e `minio/minio` no Docker Hub passaram a recusar o `pull`, e o E2E da CI morria ao subir o storage — a `main` ficou vermelha desde 27/09. Compose e CI passam a usar `bitnamilegacy/minio` fixada **por digest** (o mesmo MinIO, congelado, com o mesmo `/data` e `/minio/health/live`), como root para continuar lendo volumes antigos. Quem já tem o volume `contaia_minio` não precisa recriá-lo; quem recria o contêiner baixa a imagem nova. Risco: é um espelho legado sem atualização, aceitável para o ambiente local dos MVPs 1–4 e a reavaliar no gate de produção
- [x] `@contaia/api` compila contra o `dist` de `@contaia/db`: depois de mudar assinatura no db, reconstruir o db antes do `nest build` isolado (o `pnpm build` já ordena)
- [x] Provas: 354 no domínio, 380 na API, 134 de banco (RLS real, concorrência com transações independentes, atomicidade mutação + auditoria), 301 de tela e 39 E2E (8 + 1 de correção de e-mail na F7) contra a pilha real com Keycloak, PostgreSQL e Mailpit
- [ ] Deferidos (registrados na PR): controle otimista por `versao`, identidade órfã se a criação no Keycloak estourar o tempo, foco do teclado após confirmar suspender/arquivar, e os itens de endurecimento do gate de produção (segredo do client de administração fora do repositório, `bruteForceProtected`, SMTP com TLS, CSP na página de aceite)

### Card #10 — `[MVP1][SPEC-008][F8]` Papéis personalizados e permissões (PR #98)

- [x] **Catálogo controlado por chave estável** `módulo.funcionalidade.ação` em `packages/domain/src/papeis`. A matriz capacidade × ação da F7 deixa de existir: os quatro papéis padrão passam a ser conjuntos de chaves (teste escrito à mão confirma que o comportamento da F7 não mudou) e o `GuardDeAcao` confere chaves, ainda **falhando fechado**; o teste de cobertura agora lista cada rota real por papel padrão e por matriz personalizada
- [x] **Permissão efetiva resolvida a cada requisição**: `app.resolver_identidade` devolve as permissões dos papéis personalizados **ativos** na **revisão vigente**, e a API soma com as dos papéis padrão. Nada vai no token nem em cache: reduzir o papel nega na próxima requisição da mesma sessão (provado no E2E contra Keycloak real). Chave obsoleta no snapshot não concede nada
- [x] **Dados**: `papel_personalizado` (nome único sem caixa/espaços por coluna gerada), `papel_personalizado_revisao` (snapshot integral, append-only por trigger e por privilégio) e `usuario_papel_personalizado` (sem DELETE, `removido_em`). A auditoria reaproveita `usuario_evento` — a aba "Usuários e acessos" é uma só — com `usuario_afetado_id` nulo, `papel_id` e `revisao` para eventos de papel, travado por CHECK. RLS forçada nas três tabelas
- [x] **Concorrência**: o papel é carregado `for update` para alterar ou arquivar e `for share` para atribuir, então arquivar × atribuir se serializam (provado com transações independentes). Revisão otimista (`revisaoEsperada`, 409) e papel + revisão + evento confirmam ou desfazem juntos
- [x] **Rotas migradas para chaves**: documentos (enviar, substituir, visualizar, baixar, aprovar, rejeitar, dispensar), empresas (arquivar e reativar separados), notificações, pendências e histórico. Envio com versão vigente é substituição e exige também `Substituir` (conferido antes e depois do upload)
- [x] **UI nos dois temas**: aba Papéis e permissões (padrão somente leitura + personalizados com busca, filtro Ativos/Arquivados/Todos e paginação na URL), wizard de três etapas, edição com abas Resumo e Permissões, matriz com módulos expansíveis, dependência de Consultar, ocultação de módulo com confirmação e área exclusiva bloqueada, confirmação de redução com os usuários afetados, reativação com revisão e papéis personalizados na atribuição de usuários e no histórico
- [x] **Armadilha: o `errors` do React Hook Form zera os erros de validação quando o objeto muda de identidade** — o wizard perdia a mensagem de campo obrigatório porque o objeto era recriado a cada render. Estabilizado com `useMemo`
- [x] **Armadilha: `heading-order` do axe** — a matriz abria em `h3` direto sob o `h1`; ganhou um `h2` próprio ("Permissões do papel")
- [x] **Docker Desktop travado** (API do engine sem resposta e porta do Postgres aceitando TCP e derrubando a conexão) foi resolvido reiniciando o Docker Desktop; os contêineres `spec007-*` precisaram de `docker start` e o Postgres levou alguns segundos de recuperação
- [x] Provas: 259 no domínio, 558 na API, 167 de banco (RLS real, revisão imutável, concorrência atribuir × arquivar, atomicidade papel + revisão + evento), 445 de tela e E2E da F8 contra a pilha real (11 testes, inclusive provas visuais em claro/escuro e 390/768/1024/1440 px)
- [ ] **Decisões técnicas que o PI deve confirmar** (a SPEC não as fixa):
  - dispensar uma pendência (`PUT /empresas/:id/pendencias/:id/dispensa`) exige `documentos.exigencias.dispensar` **e** `pendencias.pendencias.consultar` (o catálogo não tem ação própria; só a de documentos apagaria também alerta de origem cadastral);
  - o Histórico de Informações exige **histórico global e histórico cadastral** (API e menu): sem os dois a tela abriria negada;
  - usuário **arquivado** não conta como vínculo para impedir o arquivamento do papel (senão o administrador teria de reconvidar a pessoa só para soltar o papel); suspenso e convidado contam;
  - o usuário pode ter **só papel personalizado** (a regra "ao menos um papel" vale para qualquer tipo);
  - **resolvido na F9:** as chaves `documentos.arquivos.consultar`, `documentos.analise.consultar` e `pendencias.pendencias.abrir_origem` ainda não restringem a resposta do servidor (a listagem de documentos exige só `documentos.exigencias.consultar`). Hoje só o administrador, que tem todas as chaves, alcança essas rotas; antes de liberar empresas a outros papéis o servidor precisa filtrar versões e estado de análise por essas chaves (achado da revisão de segurança);
  - a reativação exige a matriz revisada enviada explicitamente e, se houve permissão obsoleta, a confirmação dela;
  - **`Substituir` implica `Enviar`** (como toda ação implica `Consultar`): substituir é enviar versão nova pela mesma rota, então `Substituir` sozinha seria permissão morta (403). Conceder uma concede o par; retirar `Enviar` retira `Substituir`.

### Card #11 — `[MVP1][SPEC-009][F9]` Carteira do colaborador e isolamento por empresa

- [x] **Carteira = em quais empresas; papel = o que fazer.** `decidirAcessoEmpresarial` (domínio puro) compõe, na ordem da SPEC §3.5, tenant → usuário ativo → vínculo de carteira → permissão do papel. Uma condição nunca substitui a outra, **nem para o `admin_escritorio`**: o placeholder `escopoDeEmpresas` da F7 (admin vê tudo) foi removido
- [x] **Decisão de acesso a cada requisição**, não no token: `GuardDeEscopoDeEmpresa` consulta `app.carteira_vinculo` (uma ida ao banco por rota `:empresaId`) — adicionar ou remover vale na próxima requisição da mesma sessão (provado no E2E). Empresa do tenant fora da carteira → `403 EMPRESA_FORA_DA_CARTEIRA` com nome e CNPJ no `detalhes` do `problem+json`; empresa de outro tenant ou inexistente → `404`, sem revelar nada
- [x] **Listagens filtradas no SQL pela carteira de quem pergunta** (empresas, Central de Pendências, histórico das empresas e sino) — o parâmetro é obrigatório no tipo, para a base inteira nunca voltar por esquecimento. Colaborador sem empresa vê vazio e a orientação de ausência de alçada
- [x] **Lote atômico**: `planejarAlteracao` (domínio) valida tudo e só então o caso de uso aplica vínculos, evento e notificações **numa transação**. Item inválido (usuário arquivado, empresa arquivada ou em cadastro, de outro tenant) derruba o lote inteiro com `422` e a lista de itens; revisão desatualizada → `409 CARTEIRA_DESATUALIZADA`; repetir adição ou remover vínculo ausente não gera evento, notificação nem revisão
- [x] **Modelo** (`0011_carteira.sql`): `carteira_vinculo` sem DELETE (`encerrado_em` + motivo; reatribuir abre vínculo **novo**, nunca reativa o antigo; trigger só deixa mudar de ativo para encerrado), índice único parcial `(usuario, empresa) WHERE encerrado_em IS NULL` (empresa compartilhável, par não duplica), FK composta `(…, tenant_id)` e RLS forçada; `usuario.revisao_carteira` (monotônica); `carteira_evento` append-only por trigger e privilégio; `carteira_notificacao` (uma por colaborador e operação, `UNIQUE (evento_id, usuario_id)`)
- [x] **Concorrência**: colaboradores da operação são travados `for update` em ordem de id (as duas operações simultâneas se enfileiram e a segunda planeja contra o que a primeira gravou); o encerramento por arquivamento trava na mesma ordem para não haver deadlock
- [x] **Autoatribuição na criação** (`EmpresaService.criar`): só o `admin_escritorio` criador entra na carteira, na mesma transação, com evento `AUTOATRIBUICAO` e sem notificação (o afetado é o próprio autor). É na **criação**, e não só na ativação, porque as etapas do wizard rodam antes da ativação e passam pela alçada — sem isso o admin perderia acesso no meio do cadastro
- [x] **Ciclo**: arquivar usuário encerra os vínculos (evento, sem aviso: ele já não entra); suspender preserva; arquivar empresa encerra os vínculos de todos e avisa cada colaborador; reativar nada restaura — exige nova atribuição. Tudo na mesma transação do arquivamento
- [x] **Notificação consolidada** em tabela própria por destinatário: o sino (painel, histórico, contador, marcar lida) é **do usuário** — pendências só das empresas da carteira dele, aviso de carteira só para o destinatário e **sem depender de carteira** (quem acabou de perder a última empresa é justamente quem precisa vê-lo). Marcar a notificação alheia responde como inexistente
- [x] **Leitura granular no servidor (pré-requisito da F8, comentário da issue #11)**: sem `documentos.arquivos.consultar` as versões não saem; sem `documentos.analise.consultar` aprovado/rejeitado vira "enviado" e o motivo da rejeição some; sem `pendencias.pendencias.abrir_origem` a referência da origem da pendência é omitida
- [x] UI nos dois temas: Central de Carteiras (aba na área de usuários: lista orientada a colaboradores, filtros na URL, seleção e lote com revisão), gestão individual (página dedicada e aba **Carteira** do usuário, mesmo componente), aba **Colaboradores** da empresa, **Minha carteira** (para onde o aviso do sino leva), aba **Carteiras** do Histórico e a tela de empresa fora da carteira. Remoção sempre em `AlertDialog` com o impacto por extenso; lote recusado lista os itens na própria tela
- [x] Provas: 283 no domínio, 625 na API, 500 de tela (inclui axe em cada visão); banco (RLS real, atomicidade, concorrência, append-only, isolamento entre tenants, leituras filtradas e escopo do sino) e E2E da F9 contra a pilha real executam na CI desta PR
- [ ] **Decisões do PI durante a implementação** (registradas aqui; nenhuma altera a SPEC):
  - contador/auxiliar que criam empresa **não** são autoatribuídos (a SPEC só fala do admin criador): a empresa fica sem ninguém na carteira até o admin atribuí-la;
  - **o admin alcança empresa ARQUIVADA sem vínculo** (consulta e reativação). Sem isso o arquivamento, que encerra os vínculos de todos, impediria qualquer pessoa de abrir a empresa para reativá-la. Empresa ativa continua exigindo vínculo, para o admin também; o histórico das arquivadas segue a mesma regra;
- [ ] **Decisões técnicas que o PI deve confirmar** (a SPEC não as fixa):
  - administrar carteira usa `usuarios.usuarios_e_papeis.administrar` (só `admin_escritorio`) e a aba Carteiras do Histórico usa as mesmas duas chaves da aba Usuários e acessos;
  - a notificação de **arquivamento de empresa** avisa os colaboradores; a de **arquivamento de usuário** e a **autoatribuição** não geram aviso;
  - **Minha carteira** é rota livre para qualquer usuário ativo e devolve só os vínculos da própria sessão;
  - empresa em `CADASTRO_INCOMPLETO` não é opção de atribuição (SPEC §3.4: "somente empresa ativa"); só o admin criador a tem na carteira durante o wizard;
  - o `ErroDeDominio` passou a carregar `detalhes` estruturados (usado no 403 com nome e CNPJ);
- [ ] Deferido e entregue na F10: RLS por empresa e provas negativas sobre todas as tabelas sensíveis; a `lida` das notificações de pendência continua **compartilhada** entre colaboradores da mesma empresa (herdada da F6: uma leitura vale para todos) — a F9 não a tornou por usuário

### Card #12 — `[MVP1][SPEC-010][F10]` RLS de dois níveis e provas negativas

- [x] **Contexto transacional humano e técnico, validado no domínio** (`packages/domain/src/acesso`): `contextoHumano` (tenant, usuário, finalidade) e `contextoTecnico` (identidade técnica, finalidade específica, tenant, **empresa**, `correlationId`) falham fechado, antes de qualquer consulta, com `CONTEXTO_DE_ACESSO_INVALIDO` (403). O banco recebe as variáveis por `set_config(..., true)` dentro da transação (`comContextoHumano`, `comContexto`, `semContexto` em `packages/db/src/contexto.ts`); nada existe fora dela, então a conexão reaproveitada do pool nunca herda recorte (provado com `max: 1`). `comContextoDeTenant` deixou de existir
- [x] **Políticas por empresa e carteira** (`0012_rls_dois_niveis.sql`): `app.empresa_autorizada(empresa_id)` = usuário **ATIVO** com vínculo ativo (finalidade comum), ou — só para o administrador, conferido no banco por `usuario_papel` — empresa **arquivada** (a exceção da F9), ou o job técnico da empresa do trabalho. Funções `SECURITY INVOKER`: leem `usuario` e `carteira_vinculo` sob a própria RLS, sem depender de o dono da função ignorar a RLS. Uma política por comando; as tabelas append-only ficam só com `SELECT` e `INSERT`
- [x] **Finalidades** (enumeradas, não escolhidas por controller ou payload; um teste estático da API garante): `COMUM`; `ADMIN_ACESSO` (usuários, papéis e carteiras — lê o cadastro básico de `empresa` do tenant, escreve vínculos, **nunca** abre tabela operacional de empresa fora da carteira); `LOCALIZACAO_BASICA_EMPRESA` (somente leitura do cadastro básico, para o 403 da F9 e a duplicidade de CNPJ). `comFinalidade` troca a finalidade só num trecho da mesma transação e restaura; só requisição humana troca
- [x] **Empresa em criação** (`comEmpresaEmCriacao`): o criador escreve na empresa que a própria transação acabou de inserir, e só nela, antes de existir vínculo (contador e auxiliar que criam não são autoatribuídos, SPEC-009 §3.1). A marca some no fim do trecho e da transação; job técnico não a herda
- [x] **Classificação obrigatória e anti-drift sobre o catálogo real** (`packages/db/src/rls/`): toda tabela é `empresa`, `vinculo`, `raiz_tenant`, `raiz_empresa`, `tenant` (gestão do escritório) ou `global`; as classes sem `empresa_id` são allowlist com origem e justificativa. Reprova a CI: tabela sem classe, `tenant_id`/`empresa_id` anuláveis, índice ausente, RLS desabilitada ou não forçada, privilégio sem política, política sem contexto, trigger `escopo_imutavel` ausente, `BYPASSRLS`/`SUPERUSER`, `DELETE`/`TRUNCATE`, UPDATE em append-only. Provado com tabela deliberadamente insegura num schema descartável
- [x] **Escrita de gestão só na gestão de acesso**: `usuario_papel` (o papel que concede a exceção do administrador), `papel_personalizado*`, `usuario_papel_personalizado`, `carteira_vinculo` e `carteira_evento` só aceitam INSERT/UPDATE em `ADMIN_ACESSO` de usuário ATIVO (`app.gestao_de_acesso()`); `carteira_notificacao` é do destinatário (lê e marca como lida a sua) ou da gestão de acesso. Um bug de escrita na finalidade comum não promove ninguém a administrador. A F8 (`PapeisService`) passou a rodar em `ADMIN_ACESSO`, como a SPEC §3.3 manda. Usuário suspenso ou arquivado não ganha dado por declarar finalidade administrativa
- [x] **Job técnico não grava cross-tenant**: `empresa_cnae_secundario`, `empresa_endereco` e `empresa_evento_de_historico` ganharam a chave composta `(empresa_id, tenant_id)` que as demais já tinham; sem ela o job (tenant do contexto + empresa do trabalho) gravaria linha do tenant B ligada a empresa do A. O job lê o próprio escritório mas não o escreve
- [x] **UPDATE não move linha entre tenant nem empresa**: o `WITH CHECK` só vê a linha nova, então a trigger `escopo_imutavel` compara com a velha em todas as tabelas
- [x] **`rls-matrix.json`**: 24 tabelas sensíveis, 100% cobertas, 1082 casos, pelo papel `contaia_app` em PostgreSQL real — leitura, inserção, alteração e exclusão dentro do recorte (controle positivo), fora da carteira, outro tenant, sem contexto, contexto adulterado (tenant não-uuid, finalidade inventada, humano sem usuário, técnico sem empresa), suspenso com vínculo preservado, finalidade administrativa e job técnico em outra empresa. Negação só vale como RLS quando o erro é o de política (`42501` "row-level security"); privilégio e trigger têm categoria própria. A CI publica o arquivo vinculado à SPEC-010 e à issue #12 (`PROVA_ESCOPO` agora é `SPEC-010`)
- [x] **A API conecta como `contaia_app`**: antes ela usava o superusuário do Compose, que ignora até `FORCE ROW LEVEL SECURITY` — as políticas existiam e nunca valiam em runtime. `criarPoolDaAplicacao` (usa `DATABASE_APP_URL`; sem ela troca usuário e senha da `DATABASE_URL`) e o `PoolDoBanco` **recusa subir** se o papel conectado for superusuário ou tiver `BYPASSRLS`. Migrations e seed continuam no papel administrativo
- [x] **Armadilha: o PostgreSQL confere as políticas de LEITURA também na linha nova de um UPDATE.** Reativar uma empresa arquivada pelo administrador sem vínculo passava pelo `USING` (arquivada) e pelo `WITH CHECK`, mas a linha nova (`ativo`) não passava na política de `SELECT`, e o E2E devolveu 500 (`new row violates row-level security policy for table "empresa"`). A matriz só mudava `id = id`, que mantém a empresa arquivada, e não pegou; agora tem o caso com `situacao = 'ativo'`. A reativação roda sob a marca de empresa em criação/reativação (só nessa operação, só nessa empresa). Fonte: log do E2E da PR #100
- [x] **Ajustes de fluxo exigidos pela RLS**: arquivar/reativar empresa grava o evento **antes** da troca de situação e do fim dos vínculos (depois dela, nem a carteira nem a exceção do administrador valem para quem operou) e devolve a visão dentro da própria transação; encerrar vínculos de outros colaboradores roda em `ADMIN_ACESSO`; a duplicidade de CNPJ lê o cadastro básico em `LOCALIZACAO_BASICA_EMPRESA`. Efeito colateral bom: `camposDoHistorico`, que listava campos de empresas fora da carteira, passou a respeitar a carteira
- [x] **Worker**: ainda não existe consumidor (`apps/workers` só tem `/health`); o contrato técnico e as provas de banco estão prontos e a primeira fatia com worker acrescenta a sua finalidade em `FINALIDADES_TECNICAS`
- [ ] **Decisões técnicas que o PI deve confirmar** (a SPEC não as fixa):
  - tabelas de gestão do escritório (usuários, papéis, convites, histórico, onboarding, evento e notificação de carteira) não têm `empresa_id`; ficaram na allowlist com origem e justificativa (classe `tenant`), isoladas por tenant e por contexto humano — job técnico não lê nenhuma —, com leitura/escrita restrita à gestão de acesso onde descrito acima;
  - o administrador, na finalidade comum, tem escrita nas tabelas FILHAS de empresa **arquivada** (não só no histórico e em `empresa`): a consulta de documentos de uma empresa arquivada semeia o checklist, então restringir quebraria a leitura; o `WITH CHECK` de `empresa` também aceita qualquer coluna do administrador nessa condição (a RLS não compara linha velha e nova);
  - `app.correlation_id` existe no contrato, mas a API ainda não o preenche nas requisições humanas (nenhum caso de uso o consome até a auditoria de decisões);
  - `comEmpresaEmCriacao` confia no id que o caso de uso passa (o do INSERT da própria transação); um chamador futuro que o receba de fora ampliaria o acesso, então fica restrito a `EmpresaService.criar`;
  - `empresa` não tem coluna `empresa_id` (a linha **é** a empresa): classe `raiz_empresa`, isolada por carteira e pela finalidade administrativa para o cadastro básico. A finalidade administrativa lê as colunas inteiras da linha (RLS não restringe coluna); o repositório devolve só o que a F9 aprova;
  - criação de empresa e leitura do cadastro básico pela gestão de acesso são as duas leituras tenant-wide de `empresa`; nenhuma tabela filha (endereço, CNAE, documentos, pendências, histórico, notificações) abre por finalidade administrativa;
  - registro persistente das negações da RLS e tela de diagnóstico seguem fora (SPEC §12).

### Card #13 — `[MVP1][SPEC-011][F11]` Cofre local de certificados A1

- [x] **Quatro peças, uma fronteira de segredo**: Vault standalone (KV v2) · `apps/cofre` (ingestão) · API principal · navegador. Arquivo e senha vão do navegador **direto ao cofre**, com um ticket de uso único que a API assina (HMAC, expira, `jti` consumido na primeira tentativa); a API só recebe metadados e uma referência opaca (UUID). Nenhuma rota devolve arquivo, senha ou chave e não existe download. Provado no E2E: o sentinela de senha não aparece em resposta HTTP, HTML, tabelas do cofre nem nos artefatos da execução
- [x] **Vault** (`infra/docker/vault/bootstrap.mjs`, o mesmo script no compose e na CI): servidor standalone persistente (nunca `-dev`); o bootstrap é idempotente (init, unseal, KV v2 com `cas_required`, audit device, políticas, tokens) e reiniciar o Vault preserva segredo, políticas e metadados na tela (E2E). Três políticas: `cofre-ingestao` **create-only** (sobrescrever referência existente é negado e o segredo original fica intacto; sem `read`), `signer-leitura` (só `read`; ninguém a usa nesta fatia, a prova é que ela lê e as demais não) e `api-principal` (nenhuma capacidade em `kv/`; a API real nem recebe token do Vault). O compose passou a nomear contêineres, rede e volumes por `COMPOSE_PROJECT_NAME`, para instância nova por card
- [x] **Cofre** (`apps/cofre`): valida o PKCS#12 em memória (senha, e-CNPJ A1 ICP-Brasil, cadeia até a raiz confiável, vigência por data civil em `America/Sao_Paulo`, CNPJ da empresa contra **todos** os CNPJs do certificado) com o parse em `worker_thread`, prazo e teto agregado de iterações do KDF; o ticket é conferido **antes** de ler o arquivo; limite de 10 MB. A decisão é função pura do domínio (`avaliarCertificado`). Escuta em `127.0.0.1` por padrão e usa `COFRE_ADMIN_TOKEN` separado do token de serviço
- [x] **Ativação em duas pontas sem perder nem vazar segredo**: o cofre grava no Vault e chama `POST /interno/cofre/ativacao` na API. Recusa definitiva compensa destruindo a versão gravada; desfecho **ambíguo** (rede, timeout, 5xx) repete a ativação com o mesmo ticket e a mesma referência (idempotente por ticket e referência) e só destrói diante de recusa definitiva. A desativação é em duas fases (inutilizar no cofre, depois transação; restaura se a transação falhar) e é serializada: desativação concorrente nunca restaura o segredo de um certificado já desativado
- [x] **Modelo** (`0013_cofre_certificados.sql`): versões do certificado (índice único parcial garante **um vigente por empresa**; sem DELETE; imutável salvo a transição de estado e a troca de responsável), eventos append-only, tickets de uso único e notificações individuais por marco (`UNIQUE` por certificado, usuário e marco). RLS de dois níveis na classe `empresa`, com anti-drift, classificação e `rls-matrix.json` estendidos
- [x] **Regras puras no domínio**: estados e marcos D-30, D-15, D-7 e vencido (só o marco atual; reprocessar não duplica), transições de cadastro, substituição, desativação (motivo obrigatório) e troca de responsável, pendências `CERTIFICADO_AUSENTE`, `CERTIFICADO_VENCIDO`, `CERTIFICADO_DESATIVADO` e `CERTIFICADO_SEM_RESPONSAVEL` (a do cofre **não é dispensável**). Mutar exige a chave `certificados.cofre.*` **e** papel padrão `admin_escritorio` ou `contador` (SPEC §3.2)
- [x] **Alertas sem worker**: a reconciliação é preguiçosa e idempotente, ao consultar o cofre, o sino e a Central (ainda não há worker no repositório, como a F6 já decidiu). Responsável inativo ou fora da carteira gera `RESPONSAVEL_PERDIDO` uma vez, alerta aos administradores e pendência, sem derrubar o certificado
- [x] **UI** (`/configuracoes/cofre`, claro e escuro, 768, 1024 e 1440 px): busca, filtro, ordem e página na URL; cadastro e substituição com envio direto ao cofre e progresso; troca de responsável; desativação em `AlertDialog` com motivo; aba **Certificados** no Histórico de Informações; alertas no sino; pendências na Central. O item **Cofre de certificados** do menu aparece para quem tem `certificados.cofre.consultar`
- [x] **Acabamento da UI** (`FRONTEND.md` §20.1): `frontend-design` aplicada na construção e, ao final, o passe `impeccable` (crítica em contexto único, sem os dois subagentes) sobre as capturas do E2E contra o protótipo, nos dois temas e em 768, 1024 e 1440 px, com as correções num único lote e uma rodada de confirmação. Corrigido: o regime aparecia como enum cru (`SIMPLES_NACIONAL`; agora `rotuloDoRegime` em `features/empresa/rotulos.ts`, que a lista de empresas também passou a usar), o fundo do selo de estado sumia na linha tingida do tema claro (contorno na cor do rótulo) e o nome do responsável quebrava no meio da palavra (colunas rebalanceadas). Detector mecânico do `impeccable`: sem achados
- [ ] **Achado para o PI (fora do escopo desta fatia, não alterado)**: o `StatusBadge` mostra o rótulo no tamanho do texto da célula (~16px) e não em `label-sm` (11px), como o `COMPONENTS.md` §3.4 fixa. A causa é o `cn` (tailwind-merge) descartar `text-label-sm` ao lado de `text-<token>-foreground`, porque não conhece as escalas do design system (o `estilos.ts` do cofre já contorna o mesmo problema com `clsx`). Vale para as cerca de 20 telas que usam o componente, inclusive as da F7 já aceitas; corrigir na raiz (`extendTailwindMerge` com as escalas) muda todas elas e precisa de decisão e de novas capturas
- [x] **CI**: `PROVA_ESCOPO` é `SPEC-011`; o job `e2e` gera os segredos efêmeros, sobe o Vault, roda o bootstrap e gera em runtime a PKI sintética de teste (`scripts/gerar-pki-de-teste.mjs`: AC raiz e intermediária de teste, e-CNPJ A1 válido e as variações inválidas — A3, e-CPF, cadeia desconhecida, expirado, ainda não vigente e CNPJ diferente). Nenhum certificado, chave ou senha é versionado
- [x] **Provas**: 388 no domínio, 798 na API, 176 no cofre, 635 de tela (inclui axe), 287 de banco (RLS real, append-only, idempotência, escopo) e 14 E2E do cofre contra Vault, cofre, API e web reais; a suíte E2E completa fecha em 69 passed com o ajuste das specs antigas
- [x] **Armadilhas pagas**:
  - item novo no menu quebra as listas exatas de `itensDoMenu` das specs 003, 007 e 008 (e a 003 pegava o primeiro `role=status` da tela, que passou a ser o aviso do cofre); o papel que só tem Empresas e Carteira **mantém** o Cofre, porque `certificados.cofre.consultar` vem do papel base e a redução do teste só oculta o Histórico;
  - os E2E antigos exigem banco limpo, e as suítes `usuarios` e `papeis-personalizados` desligam a trigger `usuario_evento_append_only` globalmente na limpeza, então rodadas interrompidas deixam resíduo (`tenant_cnpj_key`, `usuario_email_unico`): recriar o banco e repetir. Sob carga de 2 workers com o resto da suíte, o teste visual da spec-007 estoura os 480 s; sozinho com a spec-008 passa em 2,8 min;
  - `CI=true` não reaproveita servidor: o Playwright sobe web, API e cofre sozinho e falha se a porta já estiver em uso
- [ ] **Decisões técnicas que o PI deve confirmar** (a SPEC não as fixa):
  - papéis padrão: `admin_escritorio` e `contador` têm todas as chaves `certificados.*`; `auxiliar` e `auditor_readonly` só consultam (o auditor também o histórico de certificados);
  - a raiz ICP-Brasil de dev e CI é **sintética**; colocar uma raiz real em `COFRE_RAIZES_ICP_DIR` faria o mesmo código valer para certificado real, o que cabe ao PI decidir quando houver produção;
  - os avisos do cofre são individuais por destinatário e **não** geram `empresa_notificacao`;
  - `POST /interno/cofre/ativacao` e `/recusa` são autenticadas por `COFRE_SERVICE_TOKEN` (Bearer, comparação em tempo constante) e reavaliam responsável, permissão e carteira **como o usuário do ticket**;
  - sem Docker na máquina do PI durante a implementação, a pilha foi validada em Postgres, Vault e Keycloak nativos; o contrato com contêineres roda na CI desta PR
- [ ] Fora da fatia: Signer, assinatura, mTLS, procuração RFB/e-CAC, KMS/HSM e operação produtiva (SPEC-012 em diante)

### Card #14 — `[MVP1][SPEC-012][F12]` Signer isolado e assinatura/mTLS simulada

- [x] **Topologia (decisão do PI, 07/10/2026)**: API e workers passam para o Compose; o Signer e os dublês mTLS de DF-e e eSocial vivem só na rede `privada` (`internal`), sem `ports`; PostgreSQL e Vault também entram nela. Uma imagem parametrizada (`infra/docker/servico.Dockerfile`) serve api, workers e signer. Web e cofre seguem como processos do host (a API os alcança por `host.docker.internal`; em Linux/CI o cofre e o dublê da CNPJá escutam em `0.0.0.0`, no runner efêmero)
- [x] **Signer** (`apps/signer`, único consumidor do segredo): servidor mTLS TLS 1.3, identidade pelo SAN `urn:contaia:servico:{api|worker|signer}` com alçada por identidade; caso de uso em três fases (decisão em transação → segredo fora da transação → estado final); XMLDSig RSA-SHA256 com `xml-crypto` (justificativa e análise de manutenção na PR); assinatura **validada antes** da saída; **uma** chamada mTLS por tentativa (retry é do worker); idempotência por HMAC com pepper de arquivo; PKCS#12 só em memória e zerado
- [x] **Banco** (`0014_signer.sql`): `signer_operacao`, `signer_evento` (append-only), `signer_notificacao`, e as tabelas globais do monitor acessíveis só por funções `SECURITY DEFINER` sob contexto técnico de serviço; classificação anti-drift, matriz e fixtures de RLS estendidas
- [x] **Workers** (`apps/workers`, BullMQ sobre o Redis): diagnóstico pós-F11 (DF-e e eSocial separados, 5 tentativas com backoff, fila morta só com código estável) e monitor de saúde de 1 minuto; três falhas abrem **um** incidente, que notifica os `admin_escritorio` ativos dos tenants com A1 vigente; a recuperação notifica os mesmos e registra a duração; **nada** vai para a Central de Pendências
- [x] **API**: `/signer/painel`, `/signer/estados` (em lote, autorizado pela carteira), `/empresas/:id/signer`, `/historico` (15 por página, sem a referência do segredo) e `POST /testes`; chaves `certificados.signer.consultar|testar` no catálogo (admin e contador ambas; auxiliar e auditor só consultam)
- [x] **UI** (cofre, claro e escuro, 768/1024/1440): cartão `Microserviço Signer`, coluna `Signer mTLS`, painel no detalhe com `Testar mTLS` (sem disparo duplicado), resultado com `correlationId`, histórico com filtros, alertas no sino. `frontend-design` na construção e passe `impeccable` ao final (detector mecânico sem achados; corrigidos no olho um typo de classe que deixava a data enorme, a coluna estreita demais, a palavra de estado redundante e o botão `Painel` quebrando linha)
- [x] **Ambiente**: `pnpm docker:up` agora prepara os segredos de teste (`scripts/preparar-segredos-do-signer.mjs`: PKI mTLS, pepper, raízes ICP de teste dos dublês e o ponto de montagem do token) e sobe tudo; exige `pnpm cofre:pki-teste` antes. Ordem na primeira vez: `docker compose … up -d postgres` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm docker:up` (a API não sobe sem o papel `contaia_app`, criado pela migration). `MONITOR_INTERVALO_MS` (padrão 60000) só é encurtado na prova E2E
- [x] **CI**: `PROVA_ESCOPO=SPEC-012`; o job `e2e` sobe a composição inteira (PostgreSQL → migrate → resto), roda as provas de infraestrutura (alcance e política do Vault) e o E2E, com `API_EM_COMPOSE=1`
- [x] **Provas**: 445 no domínio, 47 em `shared`, 24 em `signer-client`, 109 no Signer (+41 de banco), 19 nos workers (+18 de banco), 834 na API (+18 de banco), 340 de banco em `@contaia/db`, 706 de tela (inclui axe), 28 de scripts/dublês, 5 de alcance do Signer e 5 de política do Vault, e **15 E2E da spec-012** contra a composição real; a suíte E2E inteira fecha com 91 passed no ambiente local limpo
- [x] **Defeitos que só a pilha real mostrou** (todos com teste que falhava antes): `CertificadosService` sem `@Inject(SignerService)` (a API não subia no contêiner; `app.module.spec.ts`); impressão digital gravada pela F11 em **maiúsculas** contra a minúscula do Signer (toda operação virava `SIGNER_VAULT_INDISPONIVEL`; a fixture do teste de banco agora segue o formato real); `KEYCLOAK_INTERNAL_URL` para o JWKS e a Admin API da API em contêiner
- [x] **Revisão final do branch** (revisor de código e de segurança, contexto fresco), corrigido com teste que falhava antes: retomada **concorrente** depois de falha transitória executava duas vezes (agora só uma recebe a operação; a outra vê "em andamento") e a finalização só vale se a operação ainda está em andamento; operação **presa** em andamento (processo morto no meio) ganhou prazo de 2 minutos (`em_andamento_desde`) e é retomada; retomada **depois de rotação** do certificado vira conflito (a operação registra a versão exata); o estado por finalidade só conta **teste de mTLS da versão vigente** (reutilização idempotente, assinatura pura e certificado antigo não pintam a coluna); a resposta `DEGRADADO` do próprio Signer (ex.: Vault selado) deixa de aparecer como "Operacional" no cartão; o agente HTTP compartilhado deixou de reter o PKCS#12 depois da operação; a fila só aceita diagnóstico automático; `DATABASE_URL` de superusuário saiu dos contêineres; `check:dubles` entrou na CI e as provas de infraestrutura **falham** (não pulam) na CI; a região viva do resultado do teste fica sempre montada
- [ ] **Achados registrados e não corrigidos nesta PR** (para o PI/Cowork): papel de banco próprio para o Signer e para o monitor (hoje `contaia_app` com contexto técnico por GUC; o Plano previa `contaia_signer`); TLS no Vault e separação das redes internas (o `tls_disable` vem da F11 e é local-only, ADR-012); Redis sem senha; chave idempotente do teste manual derivada do `X-Correlation-Id` do cliente (o estado já não é alterado por reutilização); recusa definitiva do dublê sai como 502 e o worker a repete; checagem de `rolsuper`/`rolbypassrls` na subida do Signer e dos workers; log de segurança de handshake recusado e de alçada negada; fixar `node-forge` por versão exata e os digests das imagens
- [x] **Armadilhas pagas**: o Docker cria uma **pasta** onde falta o arquivo de um bind mount (o token do Signer; o script de preparo cria o arquivo vazio); contêiner com `uid` diferente do dono dos segredos 0600 não os lê (`CONTAINER_UID`); verificação de um contêiner parado leva até o timeout do cliente (15 s), então a prova do incidente espera mais que 3 intervalos; `test:banco` do `@contaia/db` falha se os workers locais estiverem de pé (escrevem nas tabelas globais do monitor) — pare-os antes
- [ ] **Decisões para o PI confirmar**: uma imagem Docker parametrizada em vez de três `Dockerfile`; contêineres rodam com o `uid` do dono dos segredos; o estado das empresas, com o Signer parado e a página recém-aberta, mostra "Estado indisponível agora" (o último estado conhecido só sobrevive na tela já aberta; não há cache no servidor); proposta de ADR para o Cowork (Signer isolado, rede privada, identidade por certificado de serviço)
- [ ] Fora da fatia: certificado real, KMS/HSM, órgão oficial, procuração RFB/e-CAC e operação produtiva

### Card #15 — `[MVP1][SPEC-013][F13]` Importação do plano de contas por CSV

- [x] **Contrato e domínio** (`packages/domain/src/plano-contas/`): permissões `empresas.plano_contas.{consultar,importar,confirmar_importacao,baixar_relatorio}` no catálogo (admin e contador todas; auxiliar e auditor consultam e baixam); estados da importação (`podeTransicionar`); leitura do CSV (`decodificarCsv`: BOM, UTF-8/Latin-1, `;`/`,`/tabulação, diagnóstico determinístico) e `lerCsv` único no `@contaia/shared` (API e worker usam a mesma configuração do `csv-parse`); mapeamento livre com coluna repetida recusada; validação integral pura; relatório CSV com BOM, `;` e fórmula neutralizada
- [x] **Hierarquia resultante** (`hierarquia.ts`): a decisão é tomada sobre o plano FINAL (vigente + lote). Ciclo formado com contas vigentes é recusado; conta vigente cuja linha é recusada volta ao pai antigo e isso também é conferido; filha de pai rejeitado é `CONTA_PAI_REJEITADA` mesmo que o pai exista no vigente; código repetido conta todas as linhas do arquivo; analítica não recebe filhas. Resolução quase linear: ancoragem (índice pai → filhas, fila) e busca de ciclos por rodada com atalhos comprimidos (como num union-find: o trecho com pai vigente não muda mais e o trecho pendente contíguo só muda junto com a origem). 10.000 linhas em cadeia invertida em ~20 ms (o ponto fixo antigo levava 30 s com 4.000). A re-revisão achou um caso adversário e válido que a primeira versão da busca deixava quadrático — vigente `R ← C1 ← … ← Cm ← folha` e o lote pondo cada `Ci` sob a folha: cada rodada recusa uma linha, que volta ao pai antigo e fecha um ciclo maior (9.999 linhas: ~7 s; com 10.000 vigentes na cauda: ~27 s, perto do lockDuration padrão do BullMQ). Com os atalhos: ~35 ms e ~36 ms. Equivalência com a busca anterior (oráculo só no teste), independência da ordem e validade do plano final provadas por propriedade com semente fixa
- [x] **Banco** (`0015_importacao_plano_contas.sql`): conta contábil com chave natural por empresa e FK de conta-pai diferida, tentativa, staging de linhas, eventos append-only, notificação individual, versão otimista do plano (`empresa_plano_versao`) e a pendência `PLANO_CONTAS_INCOMPLETO` (não dispensável; backfill para as empresas ATIVA sem conta). RLS de dois níveis, anti-drift e matriz estendidos. Idempotência pela UNIQUE parcial tenant + empresa + hash + mapeamento, que libera FALHA e CANCELADA
- [x] **API** (`apps/api/src/plano-contas/`): envio multipart (202) com o original no MinIO endereçado por conteúdo, fila BullMQ (`plano-contas-validacao`, id de job determinístico), prévia com diagnóstico fechado, confirmação numa transação (aplicar → eventos → finalizar → pendência → notificação; falha técnica reverte tudo e uma 2ª transação curta registra a FALHA), cancelamento, histórico de 15, plano paginado com busca, relatório em fluxo com teto de ociosidade e prazo total, downloads com `nosniff` e `Cache-Control: no-store`. Enviar, confirmar e cancelar recusam empresa arquivada (`EMPRESA_ARQUIVADA`, 409) ou em cadastro (`EMPRESA_NAO_ATIVA`)
- [x] **Workers** (`apps/workers/src/plano-contas/`): validação em três passos sem transação aberta durante I/O; a FALHA é gravada pelo processador com o job ainda ativo, na última tentativa (adiada se o banco estiver fora); o erro devolvido ao BullMQ é só o código estável (nada do CSV no hash do job); fila morta com os quatro identificadores e o código
- [x] **UI** (aba `Plano de contas` e etapa opcional depois da ativação, claro e escuro): envio com leitura do cabeçalho no navegador, mapeamento com amostra, acompanhamento por consulta com espera crescente, prévia, rejeições paginadas, confirmação/cancelamento em `AlertDialog` ("Manter prévia" como recusa), desfecho, histórico e plano vigente, pendência e aviso no sino. `frontend-design` na construção; passe `impeccable` final **estático** (sem render local: Docker travado) — detector mecânico sem achados; as capturas CLARO/ESCURO em 768/1024/1440 e o axe saem do E2E na CI
- [x] **Provas locais (sem Docker)**: 554 no domínio, 119 em `shared`, 74 nos workers, 1.009 na API, 860 de tela (inclui axe); E2E com `tsc` estrito e `playwright --list` (18 testes). **Não rodaram localmente** (Docker Desktop/WSL travado): `test:banco` de `@contaia/db`, API e workers, os testes de integração novos (empresa arquivada por HTTP, duas prévias diferentes confirmadas em paralelo) e o E2E — rodam na CI desta PR
- [x] **Revisão final do branch** (dois revisores, contexto fresco), corrigido nesta PR com teste que falhava antes: ciclo com o plano vigente passava e era gravado; validação O(n³) travava o event loop do worker; analítica recebia filhas (vigente, nova, ou sintética que virava analítica no mesmo lote); filha de pai rejeitado era aceita quando o pai existia no vigente; empresa arquivada aceitava importação pelo administrador; mensagem "Nenhuma conta foi alterada" sem prova quando a FALHA não era gravada; erro cru do banco no Redis; região rolável sem foco (axe `scrollable-region-focusable`); histórico velho até recarregar; input de arquivo focável invisível; dois "Cancelar" no mesmo diálogo; barra de proporção proibida; microcopy; código morto (`decidirIdempotenciaDaImportacao`, `proximoEstado`, schemas sem consumidor, `comContextoTecnico`)
- [x] **Armadilhas pagas**: o BullMQ 6 recusa `:` no nome de fila e dispara `failed` só com o job já finalizado (registrar a FALHA ali deixava a tentativa presa em VALIDANDO); `csv-parse` gasta ~17 µs por linha em branco (linhas vazias e só de aspas saem antes dele — 10 MiB de `""` caíram de 85 s para 33 ms); `correlationId` com `_` é recusado pela regex da API; linha com campos a mais vira rejeição da linha, não do arquivo
- [ ] **Decisões para o PI confirmar**: analítica com filhas — a filha cujo pai resultante é analítico é recusada com `VALOR_FORA_DO_DOMINIO` em `conta_pai` (interpretação da SPEC §3.4 sem código novo), e a sintética com filhas vigentes que viraria analítica é recusada mesmo quando o lote move as filhas para outro ramo (conservador: a linha da filha pode ser recusada e ela ficar sob o pai antigo); incluir a versão do plano na identidade de reuso dos terminais; notificar também o `AGUARDANDO_CONFIRMACAO`; notificação de quem saiu da carteira; redação da SPEC §3.7 ("reutiliza o resultado terminal", enquanto FALHA e CANCELADA liberam nova tentativa)
- [ ] **Achados registrados e não corrigidos**: a checagem de empresa arquivada no envio, na confirmação e no cancelamento não trava a linha da empresa (`FOR SHARE`), então um arquivamento exatamente entre a checagem e o commit não é barrado (mesmo padrão de documentos e cofre; backlog); query keys da web sem o tenant (a sessão não o carrega; um `QueryClient` por shell); `StatusBadge` fora de `label-sm` (achado da F11, vale aqui também); sem teto agregado de campos por linha no parse síncrono (pior caso ~0,9 s numa linha com milhões de campos)
- [ ] Fora da fatia: XLSX/ODS (F15), empregados (F14), centros de custo, CRUD manual do plano, IA/vetorização, uso do plano na escrituração e retenção produtiva

### Card #7 — `[MVP1][SPEC-006][F6]` Notificações de pendências (PR #51)

- [x] Notificação nasce na mesma transação síncrona que já reconcilia pendências (F4/F5) — sem fila nem worker novo; gatilho de "documento vence" é recalculado na leitura, mesmo padrão de vencimento documental de F4, porque não existe worker/cron no repositório
- [x] **Índice único de idempotência precisa incluir o `tipo` da notificação, não só `(empresa_id, chave)`** — achado da revisão final: a `chave` de pendência (`exigencia:<id>`) é compartilhada por três causas da mesma exigência (nova pendência, documento rejeitado, documento vencido); sem `tipo` no índice, uma notificação não lida de um tipo descarta em silêncio a de outro tipo da mesma exigência. Corrigido para `(empresa_id, chave, tipo)` antes do merge
- [x] `marcarComoLida`/`marcarVariasComoLidas` não recebem `empresaId` — a rota de notificação não é aninhada em empresa (diferente de pendências); `tenant_id` + `id` bastam, RLS forçada cobre o isolamento, e `empresa_id` do evento vem do próprio `RETURNING` do UPDATE, não de entrada do cliente
- [x] FK composta `(usuario_id, tenant_id)` no evento de notificação — mesmo padrão de F4/F5 (FK simples não impede evento apontar usuário de outro tenant)
- [x] Badge do sino usa `bg-danger-indicator` com texto preto, não branco — branco sobre a cor do tema escuro dava contraste 1.7:1 (falha WCAG); preto dá 5.58:1 (claro) e 12.37:1 (escuro)
- [x] Histórico é do tenant inteiro, não por empresa (SPEC-006 §3) — E2E que consulta o histórico sem escopar pelo nome/CNPJ da própria empresa fixture colide com notificações de outros specs no mesmo tenant seed sob paralelismo real de CI, mesmo passando sempre isolado localmente
- [x] Provas: 156 de regras no domínio, 93 na API, 103 de banco (RLS real, sem bypass, concorrência com transações independentes), 93 de tela, 3 E2E rodados contra stack real autenticada
- [ ] Pendência de produto registrada na PR: gatilho de vencimento síncrono (não por cron) e leitura de "notificação equivalente" (mesma causa **e** mesmo tipo) — decisões do PI, ambas confirmadas via pop-up de encerramento

### Card #6 — `[MVP1][SPEC-005][F5]` Central de Pendências cadastrais (PR #50)

- [x] Reconciliação síncrona compara causas calculadas com pendências abertas e aplica só o diff — nunca recria o que já existe, nunca perde histórico do que foi resolvido
- [x] Índice único parcial `(empresa_id, chave) WHERE estado = 'ABERTA'` — mesma causa não duplica pendência aberta, idempotente sob reprocessamento e concorrência real
- [x] Histórico append-only por trigger, mesmo padrão de F3/F4
- [x] Provas: banco com RLS real e concorrência via transações independentes, tela e E2E cobrindo o caminho crítico ponta a ponta

### Card #5 — `[MVP1][SPEC-004][F4]` Documentos da empresa

- [x] Domínio puro dos documentos: checklist padrão, aplicabilidade das inscrições, máquina de seis estados, validade por data civil
- [x] Análise sempre explícita — nenhuma função do domínio devolve `APROVADO` a partir de um envio, nem quando quem subiu foi o administrador
- [x] `NAO_SE_APLICA` mantém a exigência na lista com `aplicavel: false`: exigência que some da lista some junto com o que já foi enviado
- [x] **FK composta `(tenant_id, empresa_id)` e `(tenant_id, usuario_id)`** — achado da fatia: FK simples para `app.empresa(id)` não impede um escritório gravar linha apontando para a empresa de outro, porque a RLS confere o `tenant_id` da própria linha, que o atacante preenche com o dele. Dois testes provavam o vazamento antes da correção
- [x] Uma versão vigente por exigência por índice parcial único; versão somente leitura por trigger (só o arquivamento passa); evento documental append-only como o histórico da F3
- [x] Documento da empresa é tipo próprio de arquivo: PDF/JPG/PNG até 20 MB, sem `.docx`, porque todo formato aceito precisa abrir no navegador
- [x] `TipoDeArquivoDoEscritorio` estreita o caminho da SPEC-001: alargar `TipoDeArquivo` sem isso deixaria o documento da empresa chegar à coluna `tipo` de `escritorio_arquivo`
- [x] `StorageService` sai de `escritorio/` para `comum/` e ganha leitura; sem URL assinada nem bucket público — link direto entregaria o documento sem trilha
- [x] Acesso só vira evento depois de o storage devolver o arquivo: falha de leitura não registra acesso concluído
- [x] Aba Documentos nos temas CLARO e ESCURO, com os quatro estados, dropzone real com validação por arrasto e versões anteriores somente leitura
- [x] Ordem do checklist pela SPEC, não por `criado_em`: o semeio grava as sete na mesma transação e `now()` empata em todas
- [x] Provas: 20 de regras no domínio, 4 no shared, 24 na API, 17 de banco, 24 de tela e 4 E2E, mais 4 capturas nos dois temas em 1440 e 768

### Card #4 — `[MVP1][SPEC-003][F3]` Manutenção da empresa cliente (PR #48)

- [x] Domínio puro da manutenção: finalidade de endereço, vigência por data civil em `America/Sao_Paulo`, justificativa obrigatória, diferenças da fonte externa
- [x] CNPJ imutável após a ativação, com código próprio (`CNPJ_IMUTAVEL`) — tentativa explícita é recusada em vez de ignorada em silêncio
- [x] Finalidade única por empresa entre endereços ativos; como são quatro finalidades, a empresa tem no máximo quatro endereços
- [x] Endereço Fiscal é sempre o padrão, amarrado por CHECK (`principal = (finalidade = 'FISCAL')`) — duas colunas independentes permitiriam estado incoerente
- [x] Troca de finalidade Fiscal passa por `situacao = 'em_troca'`: índice único é verificado por linha durante o comando, e constraint `DEFERRABLE` não aceita predicado parcial
- [x] Histórico append-only por **trigger**, não só por GRANT — um `GRANT` pode escapar numa fatia futura; a trigger vale para qualquer role
- [x] Coluna `sequencia` no histórico: `ocorrido_em` empata dentro da transação e o sufixo do `uuid_v7` é aleatório, então dois eventos salvos juntos apareceriam em ordem arbitrária
- [x] Migration faz backfill antes de criar as restrições — migration que só funciona em tabela vazia não é migration
- [x] Alteração e evento na mesma transação: a escrita usa o repositório direto, não o `EmpresaService`, que abre transação própria
- [x] Conflito de edição concorrente por compare-and-swap na `versao`, opcional no repositório (a manutenção informa, o wizard da F2 não)
- [x] CNPJá compara e **nunca** aplica sozinha: seleção campo a campo, situação externa irregular só alerta, falha externa preserva os dados e a edição manual
- [x] Empresa arquivada fica somente para consulta, por `fieldset disabled` — e o servidor recusa a escrita de qualquer forma
- [x] Lista abre em `ATIVA`; a arquivada aparece só sob o filtro `ARQUIVADA`, que cruza `status` e `situacao`
- [x] Histórico de Informações global com as quatro abas e os quatro filtros, sem nenhuma ação de escrita na tela
- [x] Componente novo do catálogo: `AreaDeTexto` (justificativa é texto corrido, e um `input` de uma linha esconde o que ficou registrado para sempre)
- [x] Telas nos temas CLARO e ESCURO, com os estados e sem violação de acessibilidade
- [x] Provas: 42 de regras, 67 de banco, 42 de tela e 3 E2E; dublê da CNPJá por `CNPJA_URL`, porque dublar só no navegador deixava a aplicação seletiva consultar a fonte real

---

## 4. Rotina

A rotina completa está em [`AUDIT.md`](AUDIT.md). Em resumo:

1. Ler [`APRENDIZADOS.md`](APRENDIZADOS.md) · confirmar issue, SPEC, base e branch.
2. Worktree por card.
3. Implementar com uma finalidade só.
4. Rodar as categorias aplicáveis de [`TESTING.md`](TESTING.md).
5. Autorrevisar com [`REVIEW.md`](REVIEW.md).
6. PR conforme [`PRS.md`](PRS.md); acompanhar o gate do SHA atual.
7. Squash com gate verde; confirmar `mergedAt` na origem.
8. Comentário de encerramento na issue (`fechar-card`) → `proplan:done`.
9. Atualizar este documento e [`STATUS.md`](STATUS.md) **na PR**.

---

## Referências

- [`STATUS.md`](STATUS.md) · [`AUDIT.md`](AUDIT.md) · [`TESTING.md`](TESTING.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`FRONTEND.md`](FRONTEND.md)
