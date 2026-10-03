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
subida: Web `15100`, API `15101`, workers `15102`, Signer `15103`,
PostgreSQL `15432`, Redis `16379`, Keycloak `18080`, storage `19000` e console
`19001`. Todas publicadas apenas em `127.0.0.1`. A F7 acrescenta o Mailpit, que
captura o e-mail do convite: SMTP `11025` e interface `18025` (`MAILPIT_SMTP_PORT`
e `MAILPIT_UI_PORT`). Quem já tem outra instância local sobe o Mailpit com portas
novas pelo `.env`, sem reutilizar as de outro projeto.

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
  - **deferido até a fatia de carteira (F9):** as chaves `documentos.arquivos.consultar`, `documentos.analise.consultar` e `pendencias.pendencias.abrir_origem` ainda não restringem a resposta do servidor (a listagem de documentos exige só `documentos.exigencias.consultar`). Hoje só o administrador, que tem todas as chaves, alcança essas rotas; antes de liberar empresas a outros papéis o servidor precisa filtrar versões e estado de análise por essas chaves (achado da revisão de segurança);
  - a reativação exige a matriz revisada enviada explicitamente e, se houve permissão obsoleta, a confirmação dela;
  - **`Substituir` implica `Enviar`** (como toda ação implica `Consultar`): substituir é enviar versão nova pela mesma rota, então `Substituir` sozinha seria permissão morta (403). Conceder uma concede o par; retirar `Enviar` retira `Substituir`.

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
