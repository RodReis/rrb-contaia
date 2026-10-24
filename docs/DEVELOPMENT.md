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

### 1.2 Instância local compartilhada

Usar sempre o projeto Compose `contaia` definido em `infra/docker/compose.yml`, a partir de `C:\Desenv\Projetos\rrb-contaia`. A mesma instância, portas e volumes persistem entre cards, branches e worktrees. Antes de subir, conferir `.env` e `COMPOSE_PROJECT_NAME`: manter `contaia`; se a instância já existir, apenas iniciá-la. Não copiar `.env` de novo, trocar portas ou criar outro projeto Compose por issue.

Somente na instalação inicial, quando a instância `contaia` ainda não existir:

```bash
pnpm install
cp .env.example .env            # somente se .env ainda não existir
pnpm docker:up                  # postgres, redis, keycloak e storage S3
pnpm db:migrate
pnpm dev
```

Portas reservadas para a instância compartilhada, verificadas como livres antes da instalação inicial
subida: Web `15100`, API `15101`, workers `15102` (saúde, só dentro da rede),
PostgreSQL `15432`, Redis `16379`, Keycloak `18080`, storage `19000` e console
`19001`. Todas publicadas apenas em `127.0.0.1`. A F7 acrescenta o Mailpit, que
captura o e-mail do convite: SMTP `11025` e interface `18025` (`MAILPIT_SMTP_PORT`
e `MAILPIT_UI_PORT`). Manter as portas da instância `contaia` entre cards.

O **Signer não publica porta**: vive na rede privada do Compose (`contaia_privada`,
`internal`) e só as identidades de serviço o alcançam. `pnpm docker:up` agora também
prepara os segredos de teste e sobe a API, os workers, o Signer e os dublês mTLS (exige
`pnpm cofre:pki-teste` antes e o banco já migrado; ver o Card #14).

Para parar os contêineres preservando os volumes e cadastros:

```bash
pnpm docker:down
```

- **Autorizado a subir o Docker se estiver parado.** Reutilizar sempre a instância `contaia` existente. Não executar `down --volumes`, `docker volume rm` nem comandos equivalentes como limpeza rotineira.
- **Recriação excepcional:** antes de remover contêiner ou volume, identificar todos os dados persistentes da instância (PostgreSQL, Redis, MinIO e Vault), fazer backup e validar arquivos e procedimento de restauração. Só então remover a instância afetada, recriar o projeto `contaia`, restaurar o backup e conferir dados e acesso. Falha no backup impede a remoção. Registrar o procedimento e a verificação na entrega correspondente.
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
| 10 | [#16](https://github.com/RodReis/rrb-contaia/issues/16) `[MVP1][SPEC-014][F14]` Importação de empregados por CSV | F14 / SPEC-014 | em revisão | — | pipeline da F13 extraído para módulo genérico (banco, API, workers, web); chave CPF + matrícula, duplicata rejeita todas as ocorrências, arquivado não reativa, aba Empregados em consulta, etapa opcional no onboarding, aviso ao iniciador e aos administradores com a empresa na carteira |
| 11 | [#17](https://github.com/RodReis/rrb-contaia/issues/17) `[MVP1][SPEC-015][F15]` Importação de planilhas XLSX/ODS | F15 / SPEC-015 | em revisão | — | leitor próprio em processo filho (`@contaia/planilhas`); aba e linha de cabeçalho escolhidas, mapeamento por letra, fórmula/mescla em coluna mapeada rejeitam só a linha, linha oculta contada; modelos CSV/XLSX/ODS; equivalência com o CSV nos dois domínios |
| 12 | [#19](https://github.com/RodReis/rrb-contaia/issues/19) `[MVP1][SPEC-017][F17]` Captura DF-e por NSU | F17 / SPEC-017 | em implementação | — | estado/cursor, staging opaco, Signer mTLS, fila e scheduler por elegibilidade; DLQ, reprocessamento autenticado, consulta e métricas operacionais. Pendentes: jornada E2E e provas visuais nos dois temas/viewports |
| 13 | [#20](https://github.com/RodReis/rrb-contaia/issues/20) `[MVP1][SPEC-018][F18]` Parse e persistência de XML, hash e IBS/CBS | F18 / SPEC-018 | em implementação | — | parser seguro com checks estruturais de leiaute 4.00, outbox transacional staging → fila F18, storage original, hash, persistência/RLS, API e painel; itens/componentes, protocolo, referências, partes/endereço e tributos normalizados. Pendentes: XSD oficial, migration/integração em PostgreSQL, cobertura completa de CT-e/NF-e, provas de UI/E2E e CI |
| 14 | [#21](https://github.com/RodReis/rrb-contaia/issues/21) `[MVP1][SPEC-019][F19]` Ciência da Emissão automática | F19 / SPEC-019 | integrada; aguarda aceite do PI | #125 | fluxo resNFe → Ciência 210210 pelo Signer mTLS → procNFe por chave → staging/outbox F18; tentativas append-only, RLS, DLQ, retomada por ciclo, API e painel. CI #203 verde em todos os gates. Prova visual comparativa em CLARO/ESCURO e viewports 768/1024/1440 permanece `not_run` localmente pelo symlink do worktree rejeitado pelo Turbopack |
| 15 | [#26](https://github.com/RodReis/rrb-contaia/issues/26) `[MVP1][SPEC-024][F24]` Auditoria append-only e decisões dos agentes | F24 / SPEC-024 | implementação em PR | — | ledger com RLS/append-only, captura F20–F22, redaction, integridade e tela mestre-detalhe; revelação restrita a `admin_escritorio`, justificada e auditada; exportação assíncrona com artefato/hash, download rastreado e expiração em 24 horas. E2E ponta a ponta e captura visual autenticada pendentes |

---

## 3. Passos por card

Detalhamento operacional de cada card em execução. Passo concluído fica marcado, com o PR que o entregou.

### Card #20 — `[MVP1][SPEC-018][F18]` Parse e persistência de XML, hash e IBS/CBS

- [x] Contrato inicial da fila e filtro de resumos/eventos fora da F18.
- [x] Outbox criado na mesma transação do staging, com descoberta de escopos mínimos e publicação idempotente recuperável após falha de Redis; scheduler F18 inicia com storage sem depender do Signer.
- [x] Parser XML com limite de tamanho, rejeição de DTD/XXE, hash SHA-256 dos bytes e testes focados.
- [x] Modelo inicial com documentos, itens, origens e eventos sob RLS; APIs de consulta, integridade, original e reprocessamento.
- [x] Painel técnico com filtros, detalhes, integridade, download e reprocessamento.
- [x] Persistir protocolo e referências de documentos NF-e/CT-e e exibi-los no detalhe.
- [x] Preservar emissão como data civil e converter recebimento de protocolo em instante UTC validado.
- [x] Separar identificador fiscal, nome e localização declarada de emitente/destinatário, com RLS e append-only.


- [x] Construir inbox mestre–detalhe, filtros/ordenação/paginação na URL, decisão individual, lote parcial só de 210200 para uma empresa, histórico com protocolo, decisão/outbox, Signer mTLS e worker.
- [x] Consultar a identidade oficial mTLS para reconciliação; estado ausente ou resposta inconclusiva permanece `RESULTADO_INCERTO` e não dispara retransmissão.
- [x] Selar proposta original/versão, motivo de troca e chave de acesso validada pelo servidor; recuperar publicação pendente do outbox e reivindicar transmissão com atualização condicional.
- [x] Builds, typecheck e lint do workspace; warning preexistente em `aba-de-enderecos.tsx`. Testes locais: domínio 4 F21 (866 no pacote), Signer 6, API 2 F21 (1.440 no pacote), worker 3 F21 (189 no pacote), UI 3 F21 (1.290 no pacote).
- [ ] Executar integração de banco, integração Docker e E2E: `not_run` localmente porque `docker info` não respondeu; repetir na CI e registrar evidência por categoria.
- [ ] Prova comparativa visual de CLARO/ESCURO em 768/1024/1440, acessibilidade por teclado/axe e estados/falha parcial conforme SPEC-021 §5 e `docs/FRONTEND.md` §20.1.
- [x] Revisar o diff, corrigir findings e configurar relatórios da CI para `SPEC-021`; issue movida de `proplan:todo` para `proplan:doing` pela CLI do GitHub.
- [x] Abrir [PR #129](https://github.com/RodReis/rrb-contaia/pull/129) com `refs #23`; CI pendente. Merge, comentário de encerramento e `proplan:done` ainda não realizados.
### Card #21 — `[MVP1][SPEC-019][F19]` Ciência da Emissão automática

- [x] Classificar `resNFe` modelo 55 e destinatário; bloquear XML inseguro, chave/modelo/CNPJ inválidos e documentos já disponíveis.
- [x] Registrar Ciência 210210 com identidade idempotente no Signer; transmitir mTLS e reconciliar aceite, duplicidade, manifestação anterior e incerteza.
- [x] Recuperar `procNFe` pela chave, validar chave e CNPJ no XML, preservar novo staging ligado ao resumo e encaminhar à outbox F18.
- [x] Registrar tentativas e eventos append-only, outbox retomável sob RLS, DLQ e retomada por ciclo sem apagar histórico.
- [x] Expor lista, detalhe, histórico e retomada autorizada no painel fiscal.
- [x] Validar lint, typecheck e testes focados; builds API/Signer/DB/shared passam.
- [x] Validar migration/RLS e E2E na CI #203 (PostgreSQL, matriz RLS e composição Docker); Docker Desktop ausente localmente.
- [x] Validar build Web na CI #203.
- [ ] Prova visual comparativa CLARO/ESCURO em 768/1024/1440: `not_run`; rota local bloqueada pelo symlink do worktree rejeitado pelo Turbopack.
- [x] CI #203 verde em qualidade, regras, banco, tela, build, E2E e gate.
- [x] Rejeitar namespace/modelo/versão diferentes do layout 4.00 e exigir blocos fiscais mínimos para NF-e/CT-e.
- [x] Persistir e exibir base e totalizadores IBS/CBS do documento, mantendo extração por item para NF-e.
- [x] Normalizar base, alíquota, valor e situação presentes para ICMS, ICMS-ST, IPI, II, PIS, COFINS, IBS e CBS, por item e documento quando o XML oferece o grupo.
- [x] Persistir componentes de frete do CT-e separados das medidas de carga, sem repetir o total do serviço.
- [x] Reprocessar conteúdo com nova versão do parser, manter normalizações anteriores append-only e projetar no detalhe somente a versão vigente.
- [ ] Confirmar migration 0029 e fluxo completo no PostgreSQL/MinIO isolados; cobrir idempotência, conflito, RLS, retry e DLQ.
- [ ] Validar recuperação do outbox com Redis indisponível e retorno, incluindo publicação repetida/idempotência.
- [ ] Completar normalização de NF-e/CT-e conforme SPEC-018, incluindo XSD oficial versionado, demais totais e grupos tributários. A validação atual cobre versão 4.00 e estrutura mínima, não substitui XSD. Consulta oficial em 15/10/2026: NF-e pacote 010f (NT 2025.002 v1.50 + NT 2026.007 v1.00) ([Portal NF-e](https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=BMPFMBoln3w%3D)); CT-e NT 2026.004 v1.00 e RTC NT 2026.002 v1.01 ([Portal CT-e](https://www.cte.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=0xlG1bdBass%3D)).
- [ ] Cobrir tela nos temas CLARO/ESCURO e 768/1024/1440 px, E2E e axe; executar revisão visual e passe `impeccable`.
- [ ] Atualizar relatório por SPEC, autorrevisar diff, abrir PR com `refs #20` e acompanhar CI verde.

### Card #19 — `[MVP1][SPEC-017][F17]` Captura DF-e por NSU

- [x] Estado por tenant/empresa/CNPJ, controle monotônico do NSU, CAS, staging bruto opaco e avanço do cursor na mesma transação.
- [x] Captura manual e automática pelo mesmo worker/Signer mTLS; lotes limitados a 50, deduplicação por NSU/chave e intervalo compartilhado por tenant/órgão de 60 s além do `tempoMedio` por CNPJ.
- [x] Scheduler com papel de descoberta somente executável, função de saída mínima e revalidação sob RLS por empresa; consulta de admin limitada à captura e ao próprio tenant.
- [x] Retry exponencial com jitter, bloqueio 656 isolado, trilha append-only e alerta deduplicado com resolução; reprocessamento da DLQ preserva execução/chave/origem e registra o ator.
- [x] API para status/histórico, métricas operacionais dos últimos 30 dias e UI para consulta, paginação e reprocessamento administrativo.
- [x] Validação local focada: 22 testes de domínio, 1 de contrato compartilhado, 4 de UI, 4 do guard de API e 22 do Signer; typecheck em oito pacotes. PostgreSQL limpo: migrações 0000–0028 aplicadas, matriz RLS 5/5 e integração F17 7/7. Correções incluíram ordem do `REVOKE` em 0023 e qualificação do `pgcrypto` para UUIDv7 sob `search_path` fechado.
- [ ] E2E da empresa com A1 de teste até o dublê mTLS, com repetição idempotente e avanço do cursor; prova de falha parcial sem avanço.
- [ ] Capturas e axe nos estados relevantes, CLARO/ESCURO em 768/1024/1440, revisão visual contra o protótipo e passe final `impeccable`.
- [ ] Relatório `test-results/SPEC-017/`, autorrevisão do diff e validação do CI na PR.

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
- [ ] **Decisões para o PI confirmar**: analítica com filhas — a filha cujo pai resultante é analítico é recusada com `VALOR_FORA_DO_DOMINIO` em `conta_pai` (interpretação da SPEC §3.4 sem código novo), e a sintética com filhas vigentes que viraria analítica é recusada mesmo quando o lote move as filhas para outro ramo (conservador: a linha da filha pode ser recusada e ela ficar sob o pai antigo); incluir a versão do plano na identidade de reuso dos terminais (decidido: FIX #107); notificar também o `AGUARDANDO_CONFIRMACAO`; notificação de quem saiu da carteira; redação da SPEC §3.7 ("reutiliza o resultado terminal", enquanto FALHA e CANCELADA liberam nova tentativa)
- [ ] **Achados registrados e não corrigidos**: a checagem de empresa arquivada no envio, na confirmação e no cancelamento não trava a linha da empresa (`FOR SHARE`), então um arquivamento exatamente entre a checagem e o commit não é barrado (mesmo padrão de documentos e cofre; backlog); query keys da web sem o tenant (a sessão não o carrega; um `QueryClient` por shell); `StatusBadge` fora de `label-sm` (achado da F11, vale aqui também); sem teto agregado de campos por linha no parse síncrono (pior caso ~0,9 s numa linha com milhões de campos); **toast de sucesso do Sonner (`richColors`, padrão da biblioteca no `Toaster` global de `provedores.tsx`) reprova o `color-contrast` do axe nos temas claro e escuro** — pré-existente e global, para o backlog do design system (a prova visual da etapa de onboarding espera o toast "Empresa ativada." sair antes da captura e do axe)
- [x] **Correções após o merge — FIX #107** (reuso de resultado terminal obsoleto, decisão do PI): o reenvio idêntico só reaproveita CONCLUIDA, CONCLUIDA_COM_REJEICOES ou REJEITADA se o plano não mudou desde que ela terminou; se mudou, abre tentativa nova (revalida contra o plano atual). Regra: REJEITADA terminou na versão da validação; CONCLUIDA* nela + 1 (a confirmação exige a versão validada e a aplicação a sobe uma vez); versão atual diferente → obsoleta. `0016_importacao_plano_contas_reuso_obsoleto.sql`: coluna `obsoleta` (só sobe, só em resultado reutilizável, sozinha no terminal congelado) e a UNIQUE parcial passa a ignorá-la. `criarTentativa` decide e marca na mesma instrução (`ON CONFLICT … DO UPDATE`, linha travada) e refaz a inserção; o envio simultâneo cai no reuso da nova (I-9). A antiga fica intacta no histórico. Limitação conhecida: arquivar conta não sobe `empresa_plano_versao` (não existe fluxo de arquivamento hoje); quando o CRUD/arquivamento existir, ele precisa subir a versão, senão um plano mudado só por arquivamento continua reaproveitando o resultado antigo. API e web sem mudança
- [ ] Fora da fatia: XLSX/ODS (F15), empregados (F14), centros de custo, CRUD manual do plano, IA/vetorização, uso do plano na escrituração e retenção produtiva

### Card #16 — `[MVP1][SPEC-014][F14]` Importação de empregados por CSV

- [x] **Contrato e domínio** (`packages/domain/src/empregados/`, `packages/shared/src/empregados.ts`): permissões `empresas.empregados.{consultar,importar,confirmar_importacao,baixar_relatorio}` no catálogo (admin todas; contador e auditor consultam e baixam; auxiliar nada; o `dp` vale por papel personalizado). Cinco campos obrigatórios, chave natural CPF + matrícula e validação integral pura com um código estável por linha (`CAMPO_OBRIGATORIO_AUSENTE`, `CPF_INVALIDO`, `DATA_NASCIMENTO_INVALIDA`, `DATA_ADMISSAO_INVALIDA`, `ADMISSAO_NAO_POSTERIOR_AO_NASCIMENTO`, `CHAVE_DUPLICADA_NO_ARQUIVO` — todas as ocorrências — e `EMPREGADO_ARQUIVADO`). Também ficam aqui o modelo CSV e o relatório no formato da F13, que neutraliza fórmula
- [x] **Banco** (`0017_importacao_empregados.sql`):
  - tabelas `empregado`, `empresa_empregados_versao` (versão otimista), tentativa, staging, eventos append-only e notificação individual;
  - pendência `EMPREGADOS_NAO_IMPORTADOS`, não dispensável, com backfill para as empresas ATIVA;
  - função `app.admins_autorizados_da_empresa`;
  - RLS de dois níveis, anti-drift e matriz estendidos.

  O ciclo de vida da tentativa (criar com idempotência e obsolescência, validar, confirmar, aplicar, finalizar, cancelar, falhar e eventos) virou módulo genérico, parametrizado por descritor de tabelas. O plano de contas delega a ele, e a suíte da F13 foi a rede de regressão
- [x] **API** (`apps/api/src/importacao/` comum e `apps/api/src/empregados/`): orquestrador genérico extraído do plano de contas, sem editar nenhum teste da F13. Rotas `empresas/:empresaId/empregados`: base paginada com busca, modelo, envio (202), histórico de 15, prévia, rejeições, relatório em fluxo, original, confirmar e cancelar. Fila `empregados-validacao`. O aviso vai para o iniciador e os `admin_escritorio` com a empresa na carteira, e o reuso idempotente não avisa. O importador CSV morto (`apps/api/src/import/`) e o `csv-parse` da API saíram
- [x] **Workers** (`apps/workers/src/importacao/` comum e `apps/workers/src/empregados/`): processador, consumidor, leitura do S3 e códigos de falha passaram a ser fábricas; o plano de contas virou um wrapper fino. A validação dos empregados roda em três passos, sem transação aberta durante I/O, com FALHA e fila morta só com códigos e sem CPF ou nome em log, job ou erro
- [x] **UI**:
  - fluxo de importação genérico em `features/importacao/`, por domínio;
  - aba `Empregados` com base em consulta (sem editar, arquivar ou reativar), CPF em mono tabular e estados de acesso negado;
  - etapa opcional `Empregados` no onboarding, depois do plano de contas;
  - pendência na Central e aviso no sino.

  `frontend-design` na construção e passe `impeccable critique bolder animate colorize layout clarify optimize polish` no fim, sobre a UI viva (detector mecânico limpo). A comparação com a referência `code.html` e os achados visuais estão no corpo da PR; um `COMPARACAO.md` local em `test-results/` (fora do Git) é só apoio
- [x] **E2E da spec-014: 20/20; spec-013: 18/18, as duas em paralelo como na CI** (`tests/e2e/spec-014-importacao-empregados.spec.ts`, `fixtures/empregados.ts`, `fixtures/empregados*.csv`):
  - jornada com CSV legado em Latin-1 até base, relatório e histórico, com `correlationId` no banco e no Redis;
  - o modelo do ContaIA baixado pelo botão e importado de volta com o mapeamento padrão;
  - os contrafactuais da SPEC §9;
  - confirmação repetida, em sequência e em paralelo: uma aplica, a outra 409 `ESTADO_INVALIDO_PARA_ACAO`, sem empregado nem aviso duplicado;
  - papéis, carteira e tenant; notificações conferidas no banco e no sino; pendência e onboarding;
  - captura do protótipo e varredura de segredo e de PII nos logs.

  A falha **durante a aplicação** (transação revertida inteira) é provada na integração da API (`apps/api/src/empregados/empregados.service.integration.test.ts`, trigger de falha com CPF e nome no `detail`) e não é duplicada no E2E. Os auxiliares da F13 (`fixtures/plano-contas.ts`) foram parametrizados pelo domínio, com o padrão no plano. As provas da spec-013 vão para `provas/spec-013/` quando o escopo é outro
- [x] **Provas visuais**: 20 estados, CLARO/ESCURO em 768/1024/1440:
  - base vazia, histórico vazio, arquivo rejeitado antes do envio, arquivo selecionado, mapeamento incompleto;
  - validando, prévia parcial, rejeições, prévia sem rejeições, confirmação (diálogo);
  - concluída, concluída com rejeições, zero válidas, cancelada, falha técnica com `correlationId`, conflito 409;
  - histórico, permissão insuficiente, fora da carteira e etapa do onboarding.

  O axe (WCAG 2.1 A/AA) roda em 1024 px por tema; 768 e 1440 só têm a medição de rolagem horizontal, como na F13. Os estados da SPEC §5.3 cobertos **só por `test:tela`** (`aba-empregados.test.tsx`, com jest-axe, que não mede contraste) são: carregando com skeleton, confirmação em andamento, histórico indisponível, relatório indisponível, conteúdo longo, busca sem resultado, erro da base, empresa arquivada (somente leitura) e o 403 de papel sem `consultar`
- [x] **CI**: `PROVA_ESCOPO=SPEC-014`. A suíte E2E inteira continua rodando, com a spec-013 incluída
- [x] **Defeitos que só a pilha real mostrou** (corrigidos nesta PR; a prova E2E reprovava antes):
  - placeholder do `Select` em `muted-foreground/70` reprovava o axe `color-contrast` no mapeamento incompleto. É pré-existente (F2), mas só a F14 captura esse estado;
  - stepper de seis etapas do onboarding rolava na horizontal em 768 px; passou a `compacto`;
  - spec-002 e spec-013 esperavam a lista de empresas logo depois do plano de contas e agora passam pela etapa de empregados
- [x] **Revisão final da branch** (código e segurança, corrigido nesta PR, com teste RED→GREEN): (1) depois de "Recarregar versão atual" a tela não mostrava o que a outra pessoa salvou e o próximo salvamento a sobrescrevia: agora mostra os valores atuais do servidor; (2) o papel de plataforma só vale em token emitido para o cliente web (`azp`), e a leitura do papel de realm ganhou testes de unidade; (3) integridade no banco: gatilhos em `tax_rule` (identidade), `INSERT` só como rascunho e `TRUNCATE` recusado nas três tabelas.
- [x] **Provas locais** (instância `contaia-f14`):
  - `lint` e `typecheck`: 14/14;
  - `test:regras`: domínio 679, shared 135, workers 132, API 1.110, cofre 176;
  - `test:tela`: 935;
  - `test:banco`: db 461, API 51, workers 49;
  - `build`: 9/9.

  Signer: a suíte quebrava localmente por CRLF nos shebangs. Com LF temporário passou 109/24/41; com o `eol=lf` desta PR (`.gitattributes`), signer `test:regras` 109/109, signer-client 24/24 e signer `test:banco` 41/41
- [ ] **Suíte E2E inteira local**: 127 testes — 112 passaram, 1 falhou, 14 not_run (o processo do Playwright caiu com 0xC0000409 no Windows durante a spec-012; a spec-012 passou 15/15 isolada); a CI é quem decide
- [ ] **not_run**:
  - `check:signer-infra`: não pedido nesta fatia; roda na CI;
  - CI remota: roda ao abrir a PR; o resultado fica na PR, não aqui
- [ ] **Decisões para o PI confirmar**:
  1. Comparação da matrícula: `trim` + NFC, sensível a caixa e com zeros preservados (`00123` ≠ `123`).
  2. Datas aceitas: `dd/mm/aaaa` e `aaaa-mm-dd`, reais no calendário. `1/2/20`, `31/02/1990` e número serial do Excel são rejeitados, nunca interpretados.
  3. CPF aceito: 11 dígitos ou a máscara padrão `000.000.000-00`; outra pontuação é rejeitada.
  4. O papel `dp` ainda não existe como papel padrão (MVP-3) e vale por papel personalizado.
  5. "`admin_escritorio` com acesso à empresa" foi implementado como vínculo de carteira ativo (regra da F9/F10/F11), e não como "toda empresa do tenant". O administrador sem a empresa na carteira não é avisado.
  6. Nome e matrícula sem limite de tamanho; o limite de 10 MB do arquivo é o teto.
  7. O `screen.png` da referência (`contaia_onboarding_de_clientes_importa_o_de_legados_rf_01`) está quebrado no repositório (28 bytes); a comparação usou o `code.html`.
  8. Onboarding: a etapa de empregados vem depois do plano de contas e só aparece para quem tem `consultar` em Empresas → Empregados.
  9. Base de empregados: "Ativo" é um selo verde por linha (precedente: "Ativa" na carteira); alternativa é ambos os estados em selo neutro.
- [ ] **Achados registrados e não corrigidos**:
  - **Tx1 do worker com falha determinística** (diferente de banco fora) deixa a tentativa em RECEBIDA, sem FALHA nem aviso. É a mesma limitação da F13: a máquina de estados não permite RECEBIDA → FALHA.
  - **`packages/db/src/notificacoes.integration.test.ts`** usa e-mails fixos e quebra depois de uma rodada interrompida. Sugestão: `[FIX]` separado.
  - **Texto herdado da F13** "fica de fora" na prévia, comum aos dois domínios.
  - **Rollback da migration 0017** (nesta ordem, com o papel dono do schema, pois a trilha de pendências é append-only):
    1. remover as pendências com `origem = 'EMPREGADOS'` / `tipo = 'EMPREGADOS_NAO_IMPORTADOS'` (incluindo as do backfill) e os seus eventos em `app.empresa_evento_de_pendencia`; esses eventos só saem com o trigger `empresa_evento_de_pendencia_append_only` (0007) desabilitado durante a remoção e reabilitado em seguida;
    2. restaurar `empresa_pendencia_origem_check` e `empresa_pendencia_tipo_check` às definições da 0015 (a 0016 não os altera): origem sem `EMPREGADOS` e tipo sem `EMPREGADOS_NAO_IMPORTADOS`;
    3. dropar as 6 tabelas, filhas antes das mães: `app.importacao_empregados_notificacao`, `app.importacao_empregados_evento`, `app.importacao_empregados_linha`, `app.importacao_empregados`, `app.empresa_empregados_versao`, `app.empregado`; com elas saem as policies, os índices e os triggers `escopo_imutavel` (um por tabela), `empregado_protegido`, `empresa_empregados_versao_protegida`, `importacao_empregados_protegida` e `importacao_empregados_evento_append_only`;
    4. dropar as 5 funções, depois das tabelas porque `data_civil_valida` é usada em CHECK da linha e as `proteger_*` por triggers: `app.proteger_empregado()`, `app.proteger_versao_do_agregado()`, `app.proteger_tentativa_de_importacao()`, `app.data_civil_valida(text)` e `app.admins_autorizados_da_empresa(uuid)`.
  - **Causa global do tamanho de texto (`cn()` + tailwind-merge sem configuração)**: `text-code-sm`/`text-label-sm`/`text-body-*` são tratados como cor e o tamanho é descartado quando há outra `text-*` na mesma chamada (20+ arquivos desde o MVP-1). Compensado só nos arquivos tocados; correção global (`extendTailwindMerge` com os tokens `--text-*`) fica para um `[FIX]` próprio, junto com o código `1.1.01.01` que ainda quebra na tabela de rejeições do plano de contas (F13).
  - **Seguimentos sem card ainda**: busca por CPF exige termo com forma de CPF, mas termo numérico curto (matrícula `12`) ainda casa CPFs que contêm `12` (exigir ≥ 3 dígitos); índice único parcial `(tentativa_id, cpf, matrícula) WHERE VALIDA` como rede de segurança do staging; `main.ts` dos workers não fecha o 1º consumidor se o 2º falhar ao subir; `tests/e2e/spec-014-…` passa de 800 linhas (como a spec-013).
- [ ] Fora da fatia: XLSX/ODS (F15), cargo, salário, vínculo, dependentes, folha, eSocial, IA, edição, arquivamento e reativação de empregado (MVP-3) e retenção produtiva

### Card #17 — `[MVP1][SPEC-015][F15]` Importação de planilhas XLSX/ODS

- [x] **Contrato e domínio** (`packages/shared/src/tabela.ts`, `packages/domain/src/planilhas/`): `FormatoDeArquivo` (`CSV`/`XLSX`/`ODS`), contrato tabular comum (aba, linhas com o número original, célula com valor exibido, tipo nativo, fórmula, mescla e data civil), códigos estáveis de arquivo e estrutura (`FORMATO_XLS_NAO_SUPORTADO`, `FORMATO_XLSM_NAO_SUPORTADO`, `ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO`, `ARQUIVO_CORROMPIDO`, `EXTENSAO_DIFERENTE_DO_CONTEUDO`, `PLANILHA_SEM_ABA_UTILIZAVEL`, `ABA_INEXISTENTE`, `ABA_SEM_DADOS`, `CABECALHO_MESCLADO`, `CONFIGURACAO_DE_PLANILHA_INCOMPLETA`, `LIMITE_DE_PROCESSAMENTO_EXCEDIDO`, `SERVICO_OCUPADO`) e de linha (`CELULA_COM_FORMULA`, `CELULA_MESCLADA`) nos dois domínios. `tabelaParaRegistros` e `conferirCabecalho` transformam a aba em linhas candidatas e rejeições estruturais; dali em diante valem as regras das SPEC-013/014
- [x] **Leitor** (`packages/planilhas` → `@contaia/planilhas`, só Node): ZIP pelo diretório central, `node:zlib` com teto, `saxes` em fluxo sem DTD e `ssf` para o valor exibido; tetos de entradas, bytes inflados (por parte e no total, inclusive leituras repetidas), colunas, células, sharedStrings e `numFmt`. Sempre em **processo filho** (`--max-old-space-size=512`, 30 s, bytes por IPC, nada em argv nem env). Os modelos XLSX/ODS saem de um escritor mínimo do próprio pacote
- [x] **Banco** (`0018_importacao_planilhas.sql`): formato, aba (nome e posição), linha do cabeçalho, linhas ignoradas e ocultas e diagnósticos nas tentativas dos dois domínios; a chave de idempotência passa a incluir formato, aba e cabeçalho; eventos `SELECAO_DE_PLANILHA` e `LEITURA_PLANILHA`; CHECKs de coerência (CSV sem aba e com cabeçalho na linha 1; nome de aba com 1 a 255 caracteres)
- [x] **API**: `POST …/{plano-contas|empregados}/planilhas/inspecao`, sem estado (abas, aba efetiva, cabeçalho sugerido ou escolhido, colunas por letra, amostra, ignoradas, ocultas e mescla no cabeçalho); envio com `aba` + `linhaCabecalho` e mapeamento por letra, revalidado antes do storage; `GET …/modelo?formato=csv|xlsx|ods`; limitador de 2 leituras por processo (503 `SERVICO_OCUPADO` com `Retry-After: 5`)
- [x] **Workers**: o mesmo leitor no filho, com limitador de 2 leituras por processo e fila; fórmula ou mescla em coluna mapeada rejeitam só a linha, e a linha oculta é processada e contada. Defeito do arquivo → REJEITADA sem retry; falha técnica do filho → retry até FALHA
- [x] **UI**: formatos aceitos e modelos oficiais CSV/XLSX/ODS junto do envio; aba (automática quando única), linha do cabeçalho sobre a amostra, resumo de ignoradas e ocultas, mapeamento por letra ("Coluna C — Nome"), estados de leitura, de planilha que não pode ser usada e de serviço ocupado; grupo "Planilha lida" na prévia e configuração no histórico. `frontend-design` na construção; **passe `impeccable` feito** sobre a UI viva (`critique bolder animate colorize layout clarify optimize polish`, no próprio fluxo, sem subagentes; detector `impeccable detect` nos arquivos de UI alterados: `[]`), com 11 achados corrigidos — entre eles o seletor de aba com ~12 px de largura (`max-w-md` resolvia pela escala de espaçamento; agora há um teste que barra `max-w-`/`min-w-` com `xs..xl` no web), a inspeção cancelável ao trocar arquivo ou aba (`AbortSignal` até o `fetch`), chave própria para a consulta desligada, o id do pedido no lugar de `sem-correlacao`, a contagem do "Tentar de novo" com `aria-describedby`, o nome do rádio com a prévia da linha, o foco depois de falha e de troca de arquivo, `accept` por formato nos downloads e a amostra com altura máxima. Detalhes e a comparação com o protótipo no corpo da PR
- [x] **E2E da spec-015: 16/16; na cadeia de projetos com as specs 013 (18/18) e 014 (20/20), uma spec por vez: 54/54 em 5,1 min** (`tests/e2e/spec-015-importacao-planilhas.spec.ts`, `fixtures/planilhas.ts`, `packages/planilhas/fixtures/*-libreoffice.{xlsx,ods}`):
  - uma jornada XLSX e uma ODS por domínio, com planilhas regravadas pelo LibreOffice, até base, relatório e histórico;
  - modelos XLSX/ODS baixados pela tela e importados de volta;
  - equivalência CSV × XLSX × ODS nos dois domínios;
  - os contrafactuais da SPEC §7/§9 (lista no TESTING.md);
  - permissões por papel, carteira e tenant; serviço ocupado com 503 real; falha do worker até FALHA;
  - nenhum dado das planilhas nos logs da API e dos workers
- [x] **Provas visuais**: 21 estados, CLARO/ESCURO em 768/1024/1440, sem violação do axe (1024 px por tema) e sem rolagem horizontal: modelos para download, lendo, aba única, várias abas (plano e empregados), aba sem dados, cabeçalho sugerido, cabeçalho alterado (plano e empregados), linhas ocultas, planilha selecionada, prévia parcial com fórmula e mescla (plano e empregados), arquivo protegido, arquivo corrompido, extensão incompatível, limite excedido, cabeçalho mesclado, serviço ocupado e histórico com planilha (plano e empregados). Provas recapturadas depois do passe `impeccable`, com zero violação do axe e zero rolagem horizontal nos 21 estados. A comparação com a referência (`referencia-code-html-1440.png`), os achados por classe e as exceções intencionais vão no corpo da PR
- [x] **CI**: `PROVA_ESCOPO=SPEC-015`. A suíte E2E inteira continua rodando com 2 workers; as specs 013, 014 e 015 rodam encadeadas nos projetos `importacao-013` → `importacao-014` → `importacao-015` (mesmas filas de validação; cada uma pausa a do seu domínio na prova de falha) e o resto em paralelo no projeto `chromium`. As provas das specs 013 e 014 vão para `provas/spec-013/` e `provas/spec-014/` com o escopo da F15. O `pnpm build` gera o `dist` de `@contaia/planilhas` antes do E2E, e as imagens da API e dos workers já incluem o pacote
- [x] **Defeito que só a pilha real mostrou** (corrigido nesta PR, com teste de regressão): o leitor de ODS não reconhecia `table:visibility="collapse"` — o valor do ODF, que o LibreOffice grava — e lia a linha oculta como visível (processada, mas não contada nem sinalizada)
- [x] **Revisão final da branch** (corrigido nesta PR, com teste): um ODS hostil de 831 bytes (linha repetida 1.048.576 vezes com célula tipada vazia repetida 16.384 vezes) prendia o filho até o relógio de 30 s sem disparar teto — linha ou célula repetida sem conteúdo agora só avança o contador; teto também nos `numFmt` personalizados; `<row r>` só em decimal; falha técnica do leitor na API vai ao log como erro, com motivo estável e sem conteúdo; tetos de relógio dos testes de desempenho relaxados para não oscilar em runner carregado
- [x] **Provas locais** (instância `contaia-f14`, API e workers reconstruídos com o código da F15, banco migrado até a 0018):
  - `lint` 16/16 (1 warning pré-existente em `aba-de-enderecos.tsx`), `typecheck` 16/16 e `check:workspace`;
  - `test:regras`: domínio 782, shared 180, planilhas 152, API 1.247, workers 177, signer 109, signer-client 24, cofre 176 (na rodada completa o processo do cofre caiu com 0xC0000409 no Windows; isolado, 176/176);
  - `test:tela`: 1.051;
  - `test:banco` (API e workers do Compose parados): db 486 (duas rodadas seguidas), API 65, workers 83, signer 41;
  - `build`: 10/10;
  - E2E com `tsc` estrito (tsconfig temporário) em spec-013, spec-014, spec-015 e fixtures: limpo
- [x] **Suíte E2E inteira local** (`CI=1`, 2 workers, banco recriado e semeado, depois do passe `impeccable`): 145/145 em 8,7 min com as specs de importação encadeadas, sem falha, flaky nem `not_run` (antes do encadeamento: 145/145 em 6,1 min)
- [ ] **not_run**:
  - abertura dos modelos no **Excel** real: sem Excel na máquina. No **LibreOffice** (`soffice --headless --convert-to csv`), os quatro modelos baixados pela tela (`modelo-plano-de-contas.{xlsx,ods}`, `modelo-empregados.{xlsx,ods}`) abrem com o cabeçalho e a linha de exemplo do CSV, com zeros e máscara preservados (`00123`, `529.982.247-25`);
  - telas abaixo de 768 px (fora das larguras do protocolo; as tabelas rolam com o esmaecido, sem colapso em cartão), Firefox e Safari (o E2E é só Chromium);
  - `check:signer-infra`: não pedido nesta fatia; roda na CI;
  - CI remota: roda ao abrir a PR; o resultado fica na PR, não aqui
- [ ] **Decisões para o PI confirmar**:
  1. Proteção de aba ou de pasta **sem criptografia** (`sheetProtection`, `workbookProtection`, ODS `table:protected`) não rejeita o arquivo: ele abre sem senha. Só a criptografia (OOXML cifrado, ODF `encryption-data`) é "protegido por senha".
  2. Formato numérico inválido ou forjado (`numFmt` que o `ssf` não interpreta) cai na renderização `General` do valor guardado, sem rejeitar o arquivo.
  3. Data curta do sistema (`numFmt` 14) e formatos de data que dependem da localidade são exibidos como `dd/mm/aaaa` (pt-BR); em coluna de data vale a data civil nativa.
  4. O mapeamento de planilha referencia a coluna pela **letra** (`A`, `B`, … `AA`), nunca pelo texto do cabeçalho; a tela mostra "Coluna C — Nome". O CSV segue mapeado pelo nome.
  5. Separador decimal: o XLSX exibe `20.5` e o ODS `20,5`, cada um como o arquivo guarda. Nenhum campo das F13/F14 é decimal hoje; vira regra quando houver.
  6. Abas ocultas são listadas como as demais e contam para "várias abas → escolher"; a tela não as marca como ocultas.
  7. Teto do leitor: aba com mais de 11.001 linhas com conteúdo é rejeitada (`LIMITE_DE_PROCESSAMENTO_EXCEDIDO`), o que admite até 1.000 linhas preenchidas acima do cabeçalho com 10.000 de dados.
  8. `.txt` com conteúdo CSV continua aceito pelo caminho CSV das F13/F14, mas a SPEC §3.1 diz "exclusivamente .csv/.xlsx/.ods". Restringir é uma linha, porém muda F13/F14.
  9. XLSX/ODS renomeado para `.csv` cai em `ARQUIVO_INVALIDO` (caminho CSV), não em `EXTENSAO_DIFERENTE_DO_CONTEUDO`; `.xlsx`/`.ods` com outro conteúdo é `EXTENSAO_DIFERENTE_DO_CONTEUDO`.
  10. O estouro do relógio do leitor (30 s) vira REJEITADA permanente (`LIMITE_DE_PROCESSAMENTO_EXCEDIDO`), mesmo quando a causa é máquina sobrecarregada. O limitador é de 2 leituras por processo (API e cada réplica de workers), sem justiça entre tenants, e a falha técnica do filho na API responde 503 `SERVICO_OCUPADO`.
  11. Abertura dos modelos no Excel real: `not_run` (só LibreOffice, acima).
  12. O seletor de aba é um `Select`: o COMPONENTS.md §1.4 pede `Combobox` acima de ~10 opções e o projeto não tem um genérico. Planilhas reais têm poucas abas, mas o contrato admite até 1.000.
  13. O evento `LEITURA_PLANILHA` não tem colunas de metadados próprias: linhas ignoradas, ocultas e diagnósticos ficam na linha da tentativa, gravada na mesma transação do evento.
  14. Cada inspeção lê o arquivo duas vezes no processo filho (abas e aba escolhida), sem cache entre as etapas, e o envio lê de novo para revalidar: escolher o arquivo, mudar a linha do cabeçalho e enviar soma até cinco leituras no filho por configuração (mais, se o usuário trocar a aba ou o cabeçalho várias vezes), todas disputando as 2 vagas do limitador.
- [ ] **Achados registrados e não corrigidos** (pendentes):
  - **Leitor** (`packages/planilhas`): a deduplicação de partes não inclui `workbook`/`.rels` (limitado pelo orçamento de bytes); SIGABRT/134 é sempre classificado como memória; CDATA ou comentário com `<!DOCTYPE` no 1º MiB é rejeitado; o filho pode levar até 10 s para subir + 30 s de trabalho; SIGKILL por cgroup é retentável (limitado pelo teto de 5 tentativas).
  - **API**: limitador sem justiça por tenant; a leitura da planilha vem antes de `exigirEmpresaQueAceitaImportacao` (mesma ordem do CSV); CSV com `aba`/`linhaCabecalho` malformados dá 422; o subpath `@contaia/planilhas/testes` (construtores de bomba de ZIP) continua indo para o `dist` e as imagens — o lint `semImportarConstrutoresDeTeste` impede que código de produção o importe.
  - **Workers**: sem evento `LEITURA_PLANILHA` quando a leitura funciona mas a estrutura é recusada.
  - **Banco**: a mensagem de diagnóstico é texto livre (≤ 500) por convenção; as contagens não são validadas no repositório (só o worker as grava).
  - **Web**: o tamanho de texto descartado pelo `cn()` (tailwind-merge sem os tokens `--text-*`) é a causa global herdada da F14, com card próprio (#110); nas peças da F15 a compensação é local (`clsx`).
  - **Visuais, aceitos no passe `impeccable`**: no histórico em 1024 px a célula do arquivo de uma planilha ocupa até 5 linhas (nome; formato; aba; cabeçalho; leitura), sem cortes, porque a coluna tem ~190 px e alargá-la faria a tabela rolar — fica para o PI decidir outra composição; códigos longos na tabela de rejeições quebram depois do `_` (é o `CodigoQuebravel` das F13/F14, de propósito; copiar devolve o código exato); no 413 do envio aparecem juntos o alerta persistente e o toast (FRONTEND.md §11: toast não substitui estado de tela).
  - **Testes**: `tests/e2e/spec-015-…` passa de 800 linhas (como as specs 013 e 014).
  - **Rollback da migration 0018** (copiado do cabeçalho; não há migration "down" no runner: aplicar à mão, numa transação). Perde a configuração e os diagnósticos das tentativas de planilha, que continuam no histórico mas passam a parecer CSV. Os eventos `SELECAO_DE_PLANILHA`/`LEITURA_PLANILHA` ficam (append-only): o CHECK antigo volta `NOT VALID`, valendo só para linhas novas. Se duas tentativas vivas (ou com resultado ainda atual) diferem só pela aba, pelo cabeçalho ou pelo formato, o índice antigo recusa a recriação (23505): antes, cancelar a viva ou marcar `obsoleta` no resultado terminal. Os passos são o bloco `ROLLBACK:INICIO … ROLLBACK:FIM` da migration, executado pelo teste de banco:
    1. `DROP COLUMN` de `formato`, `aba_nome`, `aba_posicao`, `linha_cabecalho`, `linhas_ignoradas_antes_do_cabecalho`, `linhas_ocultas` e `diagnosticos` em `app.importacao_plano_contas` e `app.importacao_empregados`;
    2. recriar `importacao_plano_contas_idempotente` e `importacao_empregados_idempotente` como `UNIQUE (empresa_id, tenant_id, hash_arquivo, mapeamento) WHERE estado NOT IN ('FALHA', 'CANCELADA') AND NOT obsoleta`;
    3. restaurar `app.proteger_importacao_plano_contas()` e `app.proteger_tentativa_de_importacao()` à versão da 0017;
    4. recriar `importacao_plano_contas_evento_acao_check` e `importacao_empregados_evento_acao_check` sem as duas ações novas, `NOT VALID`.
- [ ] Fora da fatia: `.xls`, `.xlsm`, planilhas protegidas por senha (decifrar), várias abas na mesma tentativa, execução de fórmula, campos novos nos domínios, edição de célula na tela, prova no Excel real e retenção produtiva

### Card #18 — `[MVP1][SPEC-016][F16]` Motor tributário base versionado

- [x] **Domínio** (`packages/domain/src/tax-rules/`): `evaluateTaxRule` puro (sem banco, rede ou relógio; o fato entra por parâmetro) com base em centavos inteiros, redução e alíquota em centésimos de ponto percentual (10000 = 100%), arredondamento `HALF_UP` por racionais exatos em `BigInt` e memória de cálculo completa; `selectApplicableRule` (só `PUBLISHED` vigente na data do fato: nenhuma → `TAX_RULE_NOT_APPLICABLE`, mais de uma → `TAX_RULE_AMBIGUOUS`, nunca precedência). 11 códigos de erro estáveis novos.
- [x] **Banco** (`0019_tax_rules.sql`): catálogo **global** (`tax_rule`, `tax_rule_version`, `tax_rule_audit_event`, classe `global`, sem `tenant_id`) fechado para o papel da aplicação; só as funções `SECURITY DEFINER` `app.tax_rule_*` sob a finalidade de serviço `CATALOGO_TRIBUTARIO` (identidade `api-catalogo-tributario`) o alcançam. Versão publicada é imutável (trigger, inclusive para o dono), a identidade da regra não muda nem some, toda versão nasce como rascunho, TRUNCATE é recusado, nada é apagado, publicadas da mesma identidade não se sobrepõem (`EXCLUDE USING gist`, limites inclusivos; arquivar libera o intervalo), versão otimista (`lock_version`) e auditoria append-only na mesma transação. `packages/db/src/tax-rules/repository.ts`, 29 testes de banco.
- [x] **API**: `GET/POST /tax-rules`, `GET/PUT /tax-rules/:id`, `POST /tax-rules/:id/publish|archive`, `POST /tax-simulations/manual` e `POST /tax-simulations/nfe` (multipart). `super_admin` do Keycloak (claim `realm_access.roles`, sem linha em `app.usuario`) administra; o escritório só consulta versões `PUBLISHED` e simula, pelas permissões novas `fiscal.motor_tributario.consultar|simular` (admin do escritório herda; contador e auditor recebem; auxiliar não). Escritório em rota de administração → 403 `PLATFORM_ADMIN_REQUIRED`.
- [x] **NF-e de teste** (`apps/api/src/nfe/`): parser seguro em memória com `@xmldom/xmldom` 0.8.15 (DTD/ENTITY recusados antes de interpretar, só UTF-8, 2 MiB, até 990 itens, NF-e 4.00 modelo 55). O XML **nunca é gravado**: o buffer é zerado ao fim e a integração prova que nenhuma consulta nem log o carrega. Leiaute fixado em **NT 2025.002 v1.50** (SPEC §3.6).
- [x] **UI** (`/fiscal/motor-tributario`): catálogo com filtros na URL, painel lateral para criar, editar, publicar e arquivar (versão otimista, conflito explicado sem perder o digitado), simulador manual e por NF-e (análise → complemento → cálculo por item e total, valor declarado × calculado, memória de cálculo por tributo), estados de carregando, vazio, erro, acesso negado e sem regra, nos temas CLARO e ESCURO. Peças novas: `CampoDeValor` (moeda e percentual) e `ZonaDeXml` (COMPONENTS.md §§1.7–1.8).
- [x] **Seed local** (`pnpm db:seed`): 7 versões de teste **não oficiais** (ICMS corrente e a transição IBS/CBS de 2026 para 2027 sem sobreposição), pelas mesmas funções da API; idempotente. O realm local ganha o usuário `super.admin` (senha sintética `super_admin_local_123`): **Keycloaks já em execução precisam reimportar o realm**.
- [x] **E2E da spec-016: 10/10** (`tests/e2e/spec-016/motor-tributario.spec.ts`): super_admin cria, publica, simula e arquiva; regra futura publicada não altera o cálculo de 2026; vigência sobreposta recusada (a versão continua rascunho); versão arquivada deixa de ser aplicável (sem cálculo improvisado); auditoria na ordem do ciclo; contadora só lê e leva 403 ao escrever; NF-e calcula por item e no total, compara com o declarado (CBS R$ 1,84 × R$ 1,89 → divergente) e o XML não aparece em nenhuma tabela `app.*`; auxiliar sem acesso. Provas visuais: 6 estados, CLARO/ESCURO em 768/1024/1440, sem violação do axe e sem rolagem horizontal, em `test-results/SPEC-016/e2e/provas/`.
- [x] **Defeito que só a pilha real mostrou** (corrigido nesta PR, com teste de regressão): `GET/PUT/publish/archive /tax-rules/:id` validavam o id com `z.uuid()`, que recusa ~3/4 dos ids de `app.uuid_v7()` (variante fora de 8/9/a/b; ver `[FIX] app.uuid_v7()`). Os testes de controle só usavam ids com variante 8. Agora usa o mesmo regex dos demais DTOs.
- [x] **Provas locais** (instância `contaia-f16`: Postgres 45432, Keycloak 46180, API 46101, Web 15100):
  - `lint` 16/16, `typecheck` 16/16, `check:workspace`, `build` 10/10;
  - `test:regras`: shared 231, domain 810, signer-client 24, workers 177, signer 109, planilhas 152, cofre 176, API 1.416 (na rodada completa do turbo o processo da API caiu com 0xC0000409 no Windows; isolado, 1.416/1.416);
  - `test:tela`: 1.274;
  - `test:banco` (banco limpo): db 515, API 84, workers 83, signer 41;
  - E2E: só a spec-016 (10/10, contra Keycloak, Postgres, API e Web reais; sem cofre, workers nem dublês, que ela não usa)
- [ ] **not_run**:
  - suíte E2E inteira e `pnpm test:e2e` com a composição completa: roda na CI;
  - integração externa: a F16 não usa nenhuma (nenhum serviço de terceiro, nenhuma consulta de NF-e real);
  - telas abaixo de 768 px (a tabela rola; ações empilhadas), Firefox e Safari
- [ ] **Decisões para o PI confirmar**:
  1. **Leiaute da NF-e**: fixado em NT 2025.002 **v1.50** (SPEC §3.6/§14), embora a **v1.51** já exista. Adotá-la exige fixture, parser e testes próprios.
  2. **Nomes dos campos RTC** do parser (`IBSCBS/gIBSCBS`, `gIBSUF`, `gIBSMun`, `gCBS`, `IBSCBSTot`) vêm de exemplos públicos e **não foram conferidos contra o XSD oficial da v1.50**; as fixtures são sintéticas. Conferir antes do aceite.
  3. Super-admin = papel de realm `super_admin` lido do JWT verificado, **sem** linha em `app.usuario`. A navegação do escritório não lista o "Motor tributário" para ele (não há sessão de escritório); ele entra pela URL. Se a plataforma precisar de menu próprio, é card novo.
  4. Arquivada não é selecionável (SPEC §3.2). A identidade (tributo, regime, operação) é fixa na criação; para outra combinação, nova regra.
  5. Comando fora do ciclo (publicar não rascunho, arquivar rascunho ou arquivada, editar publicada) → `TAX_RULE_IMMUTABLE`, que vem antes de `TAX_RULE_VERSION_CONFLICT` (SPEC §6.3 não tem código de transição inválida).
  6. `TAX_RULE_AMBIGUOUS` responde **500** (integridade, nunca precedência). No banco real a restrição de exclusão o torna inalcançável; a ambiguidade só é provada em unidade.
  7. A listagem traz `canAdminister` (campo a mais no contrato) para a tela decidir se mostra as ações.
  8. `FALHA_TECNICA` tem mensagem própria no motor (a global fala de importação de CSV).
  9. Tabela do catálogo abaixo de desktop (P-02, aberta): ações empilhadas na linha e rolagem horizontal do contêiner da tabela quando faltar largura; sem colapso em cartão.
- [ ] **Rollback da migration 0019** (sem migration "down" no runner: aplicar à mão, numa transação; apaga o catálogo e a auditoria, só antes de qualquer regra publicada ter sido usada): `DROP FUNCTION` de `app.tax_rule_find_applicable`, `_count`, `_list`, `_archive`, `_publish`, `_update_draft`, `_create_draft`, `_lock_for_command`, `_get`, `_row_of`, `_write_audit`, `app.exigir_contexto_do_catalogo_tributario()` e `app.contexto_do_catalogo_tributario()`; `DROP TABLE` de `tax_rule_audit_event`, `tax_rule_version` e `tax_rule`; `DROP FUNCTION app.proteger_tax_rule_version()` e `DROP TYPE app.tax_rule_version_row`. A lista exata, com as assinaturas, está no cabeçalho do arquivo e é executada pelo teste de banco.
- [ ] Fora da fatia: captura, persistência documental e manifestações de NF-e (RF-02, fatias futuras), qualquer integração externa, cálculo de apuração, guia ou lançamento, regra tributária oficial (todo dado é fixture "dado de teste não oficial") e menu próprio da plataforma

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

### Card #22 — `[MVP1][SPEC-020][F20]` Classificação de risco e proposta de manifestação

- [x] Configuração versionada por empresa, fornecedores aprovados/arquivados/reativados, histórico e centavos exatos.
- [x] API sob tenant/carteira e queue idempotente; execution, análise, tentativa e eventos append-only com RLS.
- [x] Worker confere SHA-256 do staging contra F18, reparseia XML e registra sinais e abstenção segura.
- [x] Painel em claro/escuro via tokens, configuração, histórico, evidências, lacunas, estados e reprocessamento sem ação jurídica.
- [x] Testes focados de domínio, schema, parser e tela; builds/tipagens locais de domínio/shared/DB/API/workers/web.
- [x] Decisão do PI em 16/10: proposta determinística só com condição comprovável; ausência de evidência suficiente resulta em `ABSTER_SE`.
- [x] 210200 exige prova explícita e referenciada da realização, além de fornecedor aprovado, limite respeitado e histórico compatível; 210220/210240 exigem evidência positiva, explícita e referenciada para seus fatos.
- [ ] Worker ainda não recebe fonte estruturada de prova de realização, não solicitação ou não realização; no estado atual, execuções elegíveis resultam em `ABSTER_SE` até existir essa fonte.
- [ ] SPEC-020 §3.5.1 ainda descreve a regra anterior de 210200; alinhamento documental pelo Cowork pendente.
- [ ] `test:banco` local e smoke Playwright: `not_run`; Docker Engine não respondeu neste host, e `DATABASE_URL` não está configurada.
- [x] CI da PR #127 no SHA `97e05845c71d431052ebcd3eef8928ecb8044fb5`: 7 jobs obrigatórios verdes; E2E 165/165.
- [ ] Provas visuais CLARO/ESCURO em 768/1024/1440 e autorrevisão completa; CI verde não substitui esses gates visuais.
- [ ] SPEC-020 §3.5.1 diverge da decisão do PI registrada na issue/PR; alinhamento pertence ao Cowork e bloqueia merge.
- [ ] PR #127 permanece draft; merge depende dos gates acima.
- [ ] Alteração remota de `proplan:todo` para `proplan:doing` bloqueada pelo 403 do GitHub connector; não contornar.

---

### Card #24 — `[MVP1][SPEC-022][F22]` Agenda de obrigações e alertas D-3

- [x] Motor puro de aplicabilidade, calendário civil, cobertura explícita, vencimento ajustado, dependências e prioridade D-3.
- [x] Catálogo global versionado protegido por contexto de serviço e guard do `super_admin`; ocorrências, trilha e outbox permanecem isoladas por tenant/empresa.
- [x] Geração idempotente, destinatários por carteira/admin, notificação in-app, baixa manual e reabertura auditadas.
- [x] API, worker agendado e tela da agenda com lista/calendário, filtros na URL, detalhe e ações conforme alçada.
- [x] Correção pós-smoke: origem humana `HUMANA` e técnica `TECNICA` aceitas nas funções SQL do catálogo/calendário com escopo de empresa; filtro mensal `AAAA-MM` convertido para o primeiro dia; consultas no mesmo cliente PostgreSQL sequenciadas.
- [x] Regressão de banco: geração, leitura de regras publicadas e calendário em contextos humano/técnico, além da listagem mensal sob RLS; lint e typecheck de `@contaia/db` passaram.
- [x] Smoke local autenticado: “Atualizar competência” gerou ocorrência para a empresa cadastrada; agenda carregou com 1 ocorrência e cobertura incompleta, sem novos erros da API.
- [x] Testes de banco locais: `@contaia/db` 529 testes em 29 arquivos e `@contaia/workers` 83 testes em 5 arquivos; lint e typecheck do workspace passaram.
- [ ] E2E local: `not_run`; os gates remotos da PR são a prova completa de integração.
- [x] Autorrevisão do CI: o E2E encontrou listas de menu exatas das SPECs 007/008 desatualizadas após a concessão da consulta da agenda aos papéis dessas jornadas; expectativas atualizadas para refletir as permissões efetivas, inclusive depois de alterar ou reduzir outras permissões.
- [ ] Evidência visual CLARO/ESCURO em 768/1024/1440: `not_run`; o smoke validou o fluxo funcional em viewport atual, sem capturas dimensionais/temas.
- [ ] PR e CI remoto: em andamento.

### Card #25 — `[MVP1][SPEC-023][F23]` Dashboard multiempresa com semáforo e drill-down

- [x] Projeção idempotente por empresa e fonte, semáforo determinístico, revisão por fonte e reconciliador técnico isolado.
- [x] API paginada com KPIs, busca, filtros de cor/regime/fonte/tipo, carteira e autorização no servidor; painel de motivos com destinos condicionados às permissões existentes.
- [x] Tela responsiva com estados de carregamento/vazio/erro, tema do produto, CNPJ mascarado, filtros na URL e drawer acessível.
- [x] Navegação do dashboard adicionada sem restringir a largura global das demais telas.
- [x] `pnpm typecheck`: 16 tarefas passaram; `pnpm lint`: passou, com aviso preexistente em `aba-de-enderecos.tsx`; `pnpm test:regras`: 13 tarefas passaram.
- [x] API: validação de filtros, paginação, ordenação e UUID de detalhe — 2/2 testes.
- [x] Banco F23: idempotência, fonte indisponível, isolamento de carteira/tenant e escopo técnico — 1/1; fixture de 500 empresas consultada em 1,511 s (<3 s).
- [x] Dashboard: 3/3 testes focados; suíte web: 90/90 arquivos e 1.296/1.296 testes; anti-drift 17/17 e matriz RLS 5/5.
- [ ] Suíte ampla de banco local afetada por fixtures antigas duplicadas e timeouts sob concorrência; os testes F23 focados passaram. CI limpo é gate obrigatório.
- [ ] Playwright autenticado, E2E de origem até resolução, carga com 500 empresas e capturas CLARO/ESCURO em 768/1024/1440: `not_run` — infraestrutura Keycloak local sem resposta HTTP no smoke desta execução.
- [ ] PR e CI remoto: em andamento.

### Card #26 — `[MVP1][SPEC-024][F24]` Auditoria append-only e decisões dos agentes

- [x] Ledger separado de metadados e payload, escopado por tenant/empresa, RLS forçada, escrita sem privilégios diretos e proteção append-only; capture transacional de execuções, análises, tentativas e eventos F20, transmissão F21 e eventos determinísticos F22.
- [x] Canonicalização/hash SHA-256, redaction no armazenamento e leitura, filtro/paginação/detalhe com estado de integridade, expiração de payload após 12 meses com evento, e manifesto por empresa do universo exportado.
- [x] Tela CLARO/ESCURO responsiva, filtros e seleção na URL, detalhe redigido, indicação de integridade e exportação JSON/CSV.
- [x] Migração limpa e banco focado: auditoria 5/5 e matriz RLS 5/5; typecheck API/Web/DB/Workers, lint dos pacotes e testes focados executados.
  - [x] Revelação integral: chave exclusiva `usuarios.auditoria_payload.revelar`, concedida apenas ao `admin_escritorio`; endpoint exige justificativa e confirmação, verifica hashes e grava evento append-only antes de devolver conteúdo. Auditor e demais papéis recebem 403.
- [x] Exportação JSON/CSV assíncrona por fila, armazenamento do artefato, SHA-256, download rastreado e remoção/estado de expiração em 24 horas; revalida escopo no processamento e no download.
- [ ] Execução completa do agente com prompt/contexto/ferramentas, E2E ponta a ponta e prova visual autenticada CLARO/ESCURO em 768/1024/1440: `not_run` nesta execução; captura disponível reflete apenas campos persistidos pelas fontes F20–F22.
- [x] Autorrevisão do diff contra `origin/main`, incluindo migration, API, worker, UI e testes; `git diff --check` limpo.
- [x] PR #132 aberta com `refs #26`, head `162274ab`; build, quality, test-regras, test-tela e E2E passaram no CI.
- [ ] `test-banco` e gate ainda falham: em três tentativas no mesmo head, a suíte atingiu timeout de 5s em XLSX de F13 ou excedeu por 30–345ms o limite de 3s do benchmark F23. Nenhuma falha aponta para código F24; não alterei esses testes/limites fora do escopo.

### Card #27 — `[MVP1][SPEC-025][F25]` Procuração eletrônica RFB/e-CAC

- [x] Domínio de poderes, vigência civil inclusiva, autorização, estados e marcos D-30/D-7/vencimento.
- [x] Migration 0039 com versões, snapshots de CNPJ, eventos/ operações/notificações, RLS, imutabilidade, constraints, scheduler e funções de acesso à evidência.
- [x] Repositórios com ciclo de vida, documento F4 privado com SHA-256, idempotência, alertas, resumo por estado, filtros por estado/poder/vencimento e ordenação/paginação SQL.
- [x] API delegada a services, autorização tenant/carteira/papel/estado/poder, erro com `correlationId`, histórico paginado com verificação de carteira e dublê local fixo.
- [x] Worker de alertas e serviço Docker do dublê RFB sem acesso a portal oficial, gov.br ou Sefaz.
- [x] Interface integrada ao Cofre com query cache, filtros/página na URL, contagem por estado com escopo de carteira, cadastro em cinco etapas, metadados/hash, detalhe/histórico, download protegido e operações visíveis por permissão/poder ativo; declaração de conferência humana explícita.
- [x] API: resposta do dublê limitada a campos tipados e 16 KiB; tentativas recusadas e falhas de comunicação auditadas; resumo de resultados sem guardar payload integral.
- [x] Testes locais: API 1.452/1.452 regras antes do limite de leitura em streaming; testes F25 focados 8/8 após o ajuste; workers 191/191; domain 883/883; shared 246/246; tela/Cofre 40/40; typecheck e lint API/DB/Web/Workers.
- [ ] Repetição posterior da suíte API encerrou com código nativo `3221226505` antes do relatório; não foi classificada como falha de teste. O teste focado F25 permaneceu verde.
- [x] Web lint sem erros; aviso preexistente de `react-hooks/incompatible-library` em `aba-de-enderecos.tsx`.
- [x] Build do workspace: 10/10 pacotes, incluindo Next.js, API e workers.
- [x] Banco: suíte completa 536/536 antes dos últimos ajustes; após corrigir fixtures de CNPJ, anti-drift 17/17 e matriz RLS 5/5.
- [x] Suíte DB local final: 536/536; Docker/Postgres foram iniciados pela composição isolada local.
- [ ] Playwright autenticado e capturas CLARO/ESCURO em 768/1024/1440: `not_run`; dependem de API, Keycloak, Vault e MinIO locais.
- [ ] PR #135 (`refs #27`): primeira rodada CI com build, quality, regras, tela e E2E verdes; `test-banco` encontrou expectativas RLS de notificações corrigidas neste commit. Novo CI, merge confirmado e comentário obrigatório de encerramento pendentes. Issue #27 segue aberta em `proplan:doing`.

### Card #28 — `[MVP2][SPEC-026][F26]` Resolução tributária de entradas NF-e em Goiás

- [x] Iniciado em worktree dedicado `codex/f26-issue28`; issue em `proplan:doing`.
- [x] Modelo tipado de pacote curado, validação estrutural, canonicalização e hash SHA-256; resolvedor por vigência com abstenção em lacuna, ausência de dados, exceção e colisão.
- [x] Migration 0040 para pacotes globais, auditoria do ciclo e snapshots imutáveis por item, tenant, empresa e documento; RLS, chaves idempotentes e classificação anti-drift.
- [x] API de importar/validar/revisar/publicar/arquivar pacote com autorização de super-admin; API de processar/listar/comparar snapshots com permissões fiscais.
- [x] F18 fornece NF-e, NCM, CFOP, CST/CSOSN, partes e data. Regime é buscado no histórico cadastral pela vigência do fato e congelado nos fatos do snapshot.
- [x] Idempotência, revisão sequencial, motivo obrigatório após a primeira versão, preservação imutável e histórico/comparação na tela de documentos fiscais.
- [x] Ambiguidade entre regras aborta a revisão inteira com Problem Details 409; publicação de pacote serializa a checagem de cobertura concorrente em `0041_tax_package_publish_lock.sql`.
- [x] Endpoint de resolução aceita `packageId` publicado opcional; pacote ausente ou incompatível com fatos do documento retorna `TAX_PACKAGE_NOT_APPLICABLE` sem fallback.
- [x] Erros de ciclo de vida do pacote são traduzidos em códigos `TAX_PACKAGE_*` estáveis; validação rejeita fixtures duplicadas ou sem regra referenciada.
- [x] UI do motor consulta o estado real de pacotes publicados e declara limites; teste focal de decisão indeterminada e de pacote publicado sem pressupor cobertura.
- [ ] Pacote inicial normativo ainda não importado/publicado: existe o artefato de trabalho [`F26-pacote-inicial-draft.json`](prd/mvp/plans/F26-pacote-inicial-draft.json), com 13 fontes consultadas em 20/10/2026, incluindo atos CGSN 190/191 e seus efeitos escalonados. Sem regras executáveis; não revisado nem publicável. Converter fontes em regras por tributo/CFOP/NCM/CST e fixtures exige revisão tributária humana.
- [ ] Revalidação temporal achou alterações posteriores à data de corte da SPEC: LC 227/2026 consta na [LC 123 compilada](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm) e a [Lei GO 24.391/2026](https://legisla.casacivil.go.gov.br/pesquisa_legislacao/115982) altera o CTE. Revalidar vigência e escopo antes de montar pacote; nenhuma regra foi inferida desses achados.
- [x] Indicadores fiscais: importação é identificada conservadoramente pelo grupo CFOP 3; CST 04 identifica tributação monofásica e CST 05 identifica substituição de PIS/COFINS (ambas fora da cobertura); ausência só é marcada quando PIS e COFINS estão ambos presentes com CSTs completos. CFOPs conhecidos de devolução/transferência/remessa são identificados. `cBenef` é extraído e persistido; código declarado indica benefício fora da cobertura, enquanto ausência e o literal `SEM CBENEF` permanecem desconhecidos.
- [x] Contrato do pacote permite importar pacote documental sem regra, mas o validador retorna `PACKAGE_EXECUTABLE_RULES_EMPTY`; nenhuma transição para `VALIDATED` ocorre. Pacotes com regras exigem fixtures e o endpoint verifica fixture para cada regra.
- [x] Artefato draft JSON validado estruturalmente: 13 fontes, 0 regras e 0 fixtures. Não revisado, não publicável e não produz decisões cobertas.
- [x] Testes focados F26 após últimos commits: domínio 17/17; contrato compartilhado 53/53; API do ciclo de pacote 1/1; banco F26 10/10 em PostgreSQL isolado na porta 25426; migrations 0000–0043 sem pendências. `pnpm build` 10/10; `git diff --check` limpo. Impeccable detect na tela/lista/detalhe: sem achados.
- [ ] Próximo card `todo` reportado pelo GitHub: #29 `[MVP2][SPEC-027][F27] ICMS-ST retido em entradas de autopeças em Goiás`.
- [x] Captura da finalidade: operador declara individualmente os itens adquiridos para revenda; a declaração, autoria e versão da NF-e ficam registradas no snapshot. Itens sem declaração continuam `INDETERMINATE`; o XML não é usado para inferir finalidade.
- [x] E2E regressivo F16 em stack isolado limpo: 10/10 cenários; migrações 0000–0041, seed local, ciclo do catálogo, simulação, autorização, NF-e de teste, axe e 36 capturas CLARO/ESCURO a 768/1024/1440 passaram. Evidência em `test-results/F26-ISOLATED/e2e/provas/spec-016/`; a tela mostra F26 como “Sem pacote publicado”, sem pacote tributário oficial.
- [ ] Diagnóstico do stack persistente anterior: `GET /tax-packages` retorna 200, mas seus 78 registros têm `content` sem `coverage` e `exclusions`; o schema da UI rejeita essa resposta. A base nova e vazia não reproduziu o erro. Não usar capturas desse stack contaminado.
- [x] Checks locais após integração: domínio 894/894; API 1453/1453; tela 1308/1308; banco F26 6/6; typecheck API/web/db aprovado. Suite completa de banco anterior terminou 524/542, com 18 falhas fora F26 em 13 arquivos (timeouts por contenção, FK fixture Signer e limiar de performance).
- [x] Continuação F26: regras API 1462/1462 (workers serializados), domínio 896/896, tela web 1308/1308 no checkpoint anterior; extração conservadora de ST adicionada; build DB/domain, typecheck API/DB e lint alterado passaram.
- [x] Teste integrado F26 7/7 em PostgreSQL 17 isolado na porta nova 25527; migrations 0000–0041 aplicadas. Leitura dos tributos por item validada sob RLS, incluindo evidência ICMS_ST.
- [x] Autorrevisão corrigiu validação de pacote: fixtures agora são obrigatórias, schema tipa expectativa de tratamento e a validação executa uma amostra contra a regra referenciada. Após ajuste: domínio 898/898, shared 247/247, API 1462/1462 serial; builds/typechecks dos pacotes/API passaram.
- [x] Lint API/db sem erros; lint web com um aviso preexistente em `aba-de-enderecos.tsx`. `impeccable detect` sem achados. `pnpm build` 10/10 pacotes; `git diff --check` limpo.
- [x] E2E autenticado F26 do documento à memória/comparação: 11/11 cenários da spec passaram, incluindo snapshot indeterminado, reprocessamento, comparação, autorização e regressão F16. Capturas da resolução em CLARO/ESCURO a 768/1024/1440, axe WCAG 2.1 A/AA em 1024 e rolagem horizontal nas três larguras passaram. Evidência em `test-results/local/e2e/provas/spec-016/`; cobre pacote ausente e não substitui validação com pacote oficial.
- [x] Polimento visual F26: contexto fiscal exibe data civil em `dd/MM/yyyy` e distribui rótulos/valores em pares legíveis; `impeccable detect` final sem achados.
- [x] Autorrevisão incremental: replay idempotente recusa item duplicado; fixtures usam fatos independentes; NF-e exige destinatário da empresa, emitente distinto e protocolo de autorização; fontes normativas por decisão; cobertura temporal considera regime, documento e operação; fila paginada por empresa com filtros; eventos append-only com RLS na migration 0042. API 1464/1464; DB F26 10/10; web 1308/1308 antes da fila e painel 5/5 depois; E2E spec-016 11/11 com fila, axe e capturas; lint/typecheck/build DB/API/web passaram. Lint web mantém 1 aviso preexistente em `aba-de-enderecos.tsx`.
- [ ] Suite completa de banco no PostgreSQL isolado: processo Vitest encerrou com código Windows 3221226505 após vários arquivos passarem; não há resultado agregado. F26 integração 10/10 passou isoladamente.
- [ ] PR aguarda pacote normativo inicial da SPEC-026 com fontes (órgão, título, URL, dispositivo, publicação, consulta e vigência), regras por tributo/regime/operação/CFOP/NCM/CST e fixtures executadas, além de revisão humana registrada. Rechecagem encontrou [LC 227/2026](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm) alterando LC 123 e LC 214, e alterações recentes no RCTE/GO ([Decreto 10.690/2025](https://legisla.casacivil.go.gov.br/pesquisa_legislacao/110663), [Decreto 10.824/2025](https://legisla.casacivil.go.gov.br/pesquisa_legislacao/111713)); recortes, vigências e efeitos ainda exigem revisão humana, sem inferir regra ou publicar conteúdo. Diff incremental após ajuste da seleção da fila sem P0/P1; CI verde, merge e comentário de encerramento pendentes.

## Referências

- [`STATUS.md`](STATUS.md) · [`AUDIT.md`](AUDIT.md) · [`TESTING.md`](TESTING.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`FRONTEND.md`](FRONTEND.md)

### Card #29 — `[MVP2][SPEC-027][F27]` ICMS-ST retido em entradas de autopeças em Goiás

- [x] Iniciado em worktree dedicado `codex/f27-issue29`; issue #29 em `proplan:doing`.
- [x] Migration 0044 preserva CEST original por item, com formato de sete dígitos e sem reescrever snapshots/documentos existentes.
- [x] Parser fiscal F18 passa a extrair CEST do XML modelo 55; teste sintético confirma CEST/NCM/CST e ICMS-ST declarado por item e documento.
- [x] Pacote curado aceita selector CEST explícito e resolvedor exige combinação CEST/NCM para ICMS-ST; regras F26 sem CEST seguem compatíveis para entradas sem ST, nunca enquadram ST.
- [x] Serviço preserva evidência declarada (base, alíquota, valor, CEST/NCM/grupo) e checa presença e fechamento exato em centavos contra total `vST`; ICMS fica `INDETERMINATE` se checagem falha/não executada. PIS/COFINS e demais dimensões seguem independentes.
- [x] Tela lista CEST, declara valores da NF-e e motivos das checagens; badge sinaliza indeterminação em qualquer dimensão, sem sugerir crédito/apuração.
- [x] Fontes oficiais pesquisadas incluem Decreto GO 9.108/2017 (autopeças excluídas da ST pelas operações posteriores desde 01/01/2018), Decreto 10.177/2022 (Apêndice CEST) e alterações RCTE 10.690/2025; CEST é identificador, não prova de retenção/regra vigente. Nenhuma regra, par CEST/NCM ou fixture legal foi inventado.
- [x] Testes domínio 905/905, shared 250/250, API focal 5/5, DB F26 10/10 com migrations 0000–0044 em PostgreSQL 17 isolado `25429`; build 10/10; lint do workspace sem erros (um aviso preexistente em `aba-de-enderecos.tsx`); `impeccable detect` sem achados.
- [ ] Revisão tributária humana do pacote inicial, regras e fixtures oficiais: bloqueia validação/publicação do pacote e aceite fiscal; sem pacote publicável, não há resultado `APPLICABLE` de F27.
- [x] E2E autenticado F27 preserva CEST sintético no snapshot `INDETERMINATE`; 6 capturas CLARO/ESCURO em 768/1024/1440; axe WCAG 2.1 A/AA sem violações e sem rolagem horizontal. Fluxo F27 passou; suíte CI E2E 156/156. Capturas no artefato `resultados-e2e`, pasta `e2e/provas/spec-016/`, prefixo `f27-cest-contexto`.
- [x] Self-check anti-drift/gate, diff check e CI #39471292332 verdes no head `4f9c5b5`; E2E passou. A primeira tentativa de build falhou ao resolver `next/font/google` no Turbopack; rerun seletivo de build passou.
- [ ] PR #137 aberta (`refs #29`); merge, confirmação do SHA integrado e cerimônia `fechar-card` pendentes. Sem `proplan:done` antes de resolver a revisão/publicação do pacote fiscal oficial.

### Card #35 — `[MVP2][SPEC-031][F31]` Inclusão da NFC-e no complemento e restituição do ICMS-ST

- [x] Iniciado em worktree dedicada `codex/f31-issue35`; issue #35 em `proplan:doing`, sub-issue nativa de #31.
- [x] Parser e persistência preservam `idDest`/`indFinal` originais. A NFC-e 65 sem identificador do consumidor só passa pelo domínio com `idDest=1` e `indFinal=1`; indicadores ausentes ou contraditórios permanecem indeterminados.
- [x] F29 inclui NFC-e no conjunto mensal, exclui canceladas antes do snapshot e registra hash/lista de canceladas. Importação, cancelamento e apuração serializam pela mesma trava da competência; mudança documental invalida também revisão ainda não submetida.
- [x] API filtra histórico/detalhe por modelo e UI identifica modelo/chave, consumidor sem identificador e revisão desatualizada com ação explícita de reprocessamento.
- [x] Provas locais: build 10/10; typecheck shared/domain/DB/API/workers/web; parser 1/1, domínio 6/6 e tela 6/6; lint shared/domain/DB/API e lint web sem erros (aviso React Compiler preexistente em `aba-de-enderecos.tsx`); `git diff --check`.
- [x] CI do head `aa3cbd2ab7d62229b0765ee0e98af440e22d5efa`: build, quality, regras, banco, tela, E2E e gate passaram (run `39780017320`); PR #141 mergeada em `0690fbb24a89aaea9b573576837a2c9ca961458e`.
- [ ] E2E autenticado específico F30 → F31 → aprovação/rascunho → cancelamento → `STALE` → reprocessamento não existe. E2E da CI cobriu regressão F29 (2 testes), sem provar essa jornada F31. O demonstrativo oficial histórico (IN 1.558/23-GSE) foi localizado e prevê o modelo documental; a aprovação ainda depende do pacote tributário oficial de autopeças publicado e revisado para produtos, regime e vigência. Sem essa cobertura, o resultado permanece `INDETERMINATE`, sem regra ou valor inventado.
- [ ] Capturas F31 CLARO/ESCURO × 768/1024/1440 e comparação visual correspondente não têm evidência rastreável anexada. `not_run`; `test-tela` verde não substitui captura visual.
- [ ] Comentário com evidências publicado na issue #35; `proplan:done` aguarda pacote tributário oficial F29 publicado/revisado, E2E completo da SPEC-031 e capturas visuais rastreáveis.

### Card #37 — `[MVP2][SPEC-033][F33]` Reconstrução histórica do ICMS-ST de autopeças em Goiás

- [x] Iniciado em worktree dedicada `codex/f33-issue37`; issue #37 em `proplan:doing`, sub-issue nativa de #31.
- [x] Domínio consolida somente revisões aprovadas e não obsoletas, preserva principal bruto/estornos/saldo, memória causal e hashes; fatos originais fora de 27/10/2016–28/02/2018 não entram.
- [x] Migration 0071 cria pacotes, linhas e eventos append-only com RLS/índices/FKs compostas; API gera/reproduz por seleção e contrato, audita downloads/superação e serve PDF/CSV/JSON privados. Uso externo bloqueado até F34/SPEC-034.
- [x] Painel fiscal com seleção de regime/período, totais, competências excluídas e downloads; regras completas do domínio 934/934 e da API 1.479/1.479, telas completas 1.322/1.322, matriz RLS 5/5 e anti-drift 17/17.
- [x] E2E autenticado 2/2: geração/reuso, PDF/CSV/JSON com SHA-256, superação por revisão nova, axe sem violações críticas e sem rolagem horizontal; capturas CLARO/ESCURO em 768/1024/1440. Typecheck/build e lint da API e Web passaram; lint Web manteve warning preexistente em `aba-de-enderecos.tsx`.
- [ ] Suíte DB integral local `not_run` como validação conclusiva: a execução paralela teve 14 falhas de colisão/timeouts; a serial teve 500 testes aprovados/49 ignorados e 3 arquivos bloqueados por usuários de fixtures estáticas deixados no Compose compartilhado após a primeira execução. Matriz RLS e anti-drift focados passaram; CI limpa ainda é gate obrigatório.
- [ ] Revisão final, PR, CI, merge confirmado, comentário de encerramento e `proplan:done` pendentes.

### Card #38 — `[MVP2][SPEC-034][F34]` Acréscimos legais da reconstrução histórica do ICMS-ST em Goiás

- [x] Motor puro aplica regras versionadas por vigência em trilhas independentes, usa centavos inteiros e mantém lacunas/conflitos/atos ausentes como `INDETERMINATE`; sem regra ou taxa oficial embutida.
- [x] Migrations 0072–0073 adicionam pacotes normativos, atos formais, resultados e eventos append-only com RLS, FKs compostas, índices, `escopo_imutavel`, storage privado e aprovação humana da fonte F33.
- [x] API valida hash canônico e revisões atuais da F33, hash do pacote normativo/anexos e hash dos atos formais; cálculo idempotente, revisão interna e exportação privada PDF/CSV/JSON com SHA-256.
- [x] Painel F34 integrado à resolução fiscal; teste de tela focal 2/2, domínio focal 5/5, PDF 1/1, matriz RLS 5/5 após migrations 0072–0073 no Compose compartilhado `contaia`; `pnpm lint`, `pnpm build` e `git diff --check` passaram. Warning preexistente do React Compiler em `aba-de-enderecos.tsx`.
- [x] Fixture E2E autenticada cobre fonte sintética rastreável, aprovação, pacote de regra sintético não oficial, cálculo, revisão, hash de PDF/CSV/JSON e reprodução; execução E2E local `not_run` por timeout no bootstrap `webServer` do Playwright. CI run `40056808935`: E2E 174/174; imagens CLARO/ESCURO × 768/1024/1440 e arquivos PDF/CSV/JSON/manifest publicados em `resultados-e2e/e2e/provas/spec-033/`.
- [x] Inspeção visual das capturas 1440 CLARO e 768 ESCURO: aviso de fixture sintética visível, página responsiva e trilhas separadas; não há protótipo F34 específico em `docs/telas/` para comparação direta. `impeccable detect --json` sem achados.
- [ ] Revisão final, merge confirmado, comentário de encerramento e `proplan:done` pendentes; ausência de pacote oficial curado mantém resultados reais indeterminados.

### Card #36 — `[MVP2][SPEC-032][F32]` Eventos posteriores no complemento e restituição do ICMS-ST

- [x] Domínio calcula estorno proporcional cumulativo em centavos inteiros; última devolução absorve resíduo de arredondamento, sem exceder valor ou quantidade original.
- [x] Migration 0058 cria evidência manual e linhas de estorno append-only, com RLS por tenant/empresa, índices e FKs compostas para preservar vínculo da linha com revisão original.
- [x] API registra devolução manual somente sobre linha aprovada e não obsoleta, serializa saldo por linha, exige anexo privado e registra hash SHA-256; moeda não é recebida pela API.
- [x] Submissão de evidência aceita auxiliar; decisão separada por contador/admin fica append-only. Estorno exige aprovação e passa por função restrita `SECURITY DEFINER`; `INSERT` direto da aplicação foi revogado.
- [x] Tela mostra vínculo causal, evidência submetida, decisão contador/admin e valores separados; ação só aparece para alçada correspondente.
- [x] Aprovação compõe revisão imutável na competência do evento e linha C002 com hash; histórico e filtro por modelo incluem snapshots F32.
- [x] Testes locais: API focal 6/6, domínio e shared aprovados; tela 7/7; banco F32, matriz RLS e anti-drift 23/23; typecheck/lint dos pacotes afetados e `git diff --check`.
- [x] Migrations 0059/0061/0062/0063 registram cancelamento NFC-e somente quando origem, item importado, chave, protocolo e hash coincidem; a API não insere cancelamento diretamente. A migration 0068 invalida snapshots afetados por evidência nova de devolução; migrations aplicadas no Compose compartilhado `contaia`.
- [x] Matriz RLS (100%, 5 testes) e anti-drift do catálogo (17 testes) passaram após as migrations 0059/0060; fixtures F32 cobrem evento, estorno e cancelamento.
- [x] Ingestão EFD e NF-e normalizada identifica devoluções por referência, validade da competência e hash; origem manual rejeita valores fiscais declarados pelo usuário.
- [x] Worker valida evento autorizado de cancelamento NF-e 55 (XSD, XMLDSig, cadeia ICP na data do evento e protocolo); persiste proveniência verificada e concilia evento órfão ao documento correspondente.
- [x] PR #143 integrada por squash no SHA `ababe945b44a9f4e12f5f8e9236ad3e3cac1a794`; CI do head `4d72917b25da9aa343a7bb749626239c7695e807` verde (run `39946224492`), incluindo `e2e` e gate; issue #36 aberta em `proplan:done`, aguardando aceite do PI.
- [ ] E2E autenticado local e capturas CLARO/ESCURO × 768/1024/1440: `not_run` no ambiente local anterior, cujo bootstrap do Vault retornou HTTP 400. Nenhum volume foi recriado ou removido.

### Card #34 — `[MVP2][SPEC-030][F30]` Importação e normalização de NFC-e modelo 65 em Goiás

- [x] Upload assíncrono XML/ZIP, limites de expansão, armazenamento por hash, consulta de lote, CSV e download original com hash/auditoria.
- [x] Parser de NFC-e GO 3.10/4.00, schema versionado, chave/modelo/emitente/protocolo, normalização de itens/tributos/pagamentos e integração inicial com F18/F29.
- [x] Migrations 0053–0056 adicionam persistência append-only de eventos de cancelamento órfãos, RLS, unicidade por identidade, estado `CANCELLED`, trigger `escopo_imutavel` e contexto técnico restrito ao `worker-nfce`; invalidação F29 aceita worker autorizado com ator humano ativo.
- [x] Worker valida schema oficial do envelope e do detalhe 110111, XMLDSig com referência única ao `infEvento`/`infNFe` sem IDs repetidos, empresa e ambiente; evento com documento existente cancela na transação, evento órfão fica `PENDING_LINK` e concilia ao importar a NFC-e.
- [x] Parser distingue protocolo do evento em `retEvento/infEvento`; prova shared 7/7 e worker XSD oficial 2/2. Typechecks/lints de shared, DB e workers; DB focal + matriz RLS + anti drift 23/23 após migrations 0000–0056 em PostgreSQL 17 isolado iniciado do zero; `git diff --check`.
- [x] Validade do certificado de assinatura e dos emissores CA aceitos é conferida no instante de `dhEvento`/recebimento do protocolo; assinatura exige caminho até raiz configurada e referência única ao alvo assinado.
- [ ] Não há verificação de revogação CRL/OCSP, fixture criptográfica confiável de evento nem teste worker de assinatura/vínculo antes/depois da nota.
- [ ] Ainda faltam reprocessamento técnico auditado, endpoint autorizado/auditado de original para evento, conciliação/reuso/conflito concorrente comprovados e grupos de normalização que ainda não foram cobertos por fixture.
- [ ] Completar regressão de armazenamento/falha técnica, segurança ZIP/XML, performance, provas de API/worker e E2E, comparação com protótipo e evidência CLARO/ESCURO × 768/1024/1440. CI verde anterior era do head `343e815`; este novo head precisa de CI própria.

### Card #33 — `[MVP2][SPEC-029][F29]` Complemento e restituição de ICMS-ST de autopeças em Goiás

- [x] Domínio e contratos versionados calculam base/ICMS efetivos com decimal exato, rateio de vínculo direto e média ponderada limitada às entradas elegíveis; package validator rejeita regras sem fixture concordante, duplicidade e sobreposição. Sem parâmetro oficial, pacote não publica.
- [x] Migrations 0046–0051: snapshots, itens, eventos append-only, revisão derivada, RLS/índices, `indFinal`, GTIN, série/número NF-e, trigger canônico de escopo e inserts de domínio restritos.
- [x] API e UI integram competência, bloqueios, memória por item, paginação e revisão por alçada. Falta de pacote/cobertura/leiaute mantém competência bloqueada, sem totais e sem submissão/decisão/exportação.
- [x] Suítes locais concluídas: domínio 918/918, API 1.472/1.472, web 1.313/1.313 e banco 547/547; migrations 0000–0051 em PostgreSQL 17 isolado na porta 25439; builds, typechecks, lints e `git diff --check` passaram. Warning React Compiler preexistente em `aba-de-enderecos.tsx`.
- [x] Smoke E2E autenticado 2/2 com escritório/empresa/usuário sintéticos isolados e removidos na limpeza. Seis capturas do estado bloqueado sem cobertura oficial em CLARO/ESCURO × 768/1024/1440; axe sem violações críticas e sem rolagem horizontal. Evidências em `test-results/SPEC-029/e2e/provas/f29-bloqueio-sem-cobertura-*.png`. Comparação com protótipo específico da apuração permanece indisponível; `impeccable detect --json` sem achados nos arquivos da tela.
- [ ] Pacote histórico oficial por produto/regime/vigência, vínculos de saída/entrada ou EFD e cobertura verificável de eventos posteriores não estão disponíveis. O leiaute oficial do demonstrativo normal (IN 1.558/23-GSE, operações de 27/10/2016 a 31/03/2023) foi localizado, mas não supre essas regras materiais. Não há cálculo aprovável; linhas seguem indeterminadas, revisão e exportação bloqueadas. Não inventar regra, taxa, fonte ou fixture.
- [ ] PR #139 aberta (`refs #33`), CI remota em execução; merge, comentário de encerramento e `proplan:done` pendentes. Issue #33 permanece aberta em `proplan:doing`. `origin/main` verificada no SHA `1643ab0e1f0457364b51efd693cf08924de1bad0`.

### Card #32 — `[MVP2][SPEC-028][F28]` ICMS na entrada histórica de autopeças em Goiás

- [x] Iniciado em worktree dedicado `codex/f28-issue32`; issue #32 em `proplan:doing`.
- [x] Domínio histórico com três obrigações independentes, corte de 28/02/2018, seleção estrita por vigência e cálculo racional exato por MVA original/ajustada; ausência material, retenção válida ou sem evidência permanece `INDETERMINATE`, sem valor.
- [x] Contrato dos pacotes, parser e fatos normalizados incluem MVA, método, relações, frete, seguro, desconto, outras despesas e ICMS próprio; sem alíquota/MVA/datas/códigos embutidos como fallback.
- [x] Migration 0045 adiciona revisão humana sob RLS, eventos append-only e escopo imutável; submissão por papel autorizado, decisão versionada e rejeição motivada. Corrigida expansão SQL de função composta que executava a decisão repetidamente; leitura retorna o último evento de decisão.
- [x] API e painel fiscal mostram obrigações separadas, memória e fontes disponíveis, estado informativo e ações de revisão condicionadas ao papel; valor aprovado não gera guia ou efeito financeiro.
- [x] Testes focados: domínio 7/7; contratos/parser 56/56; API fiscal 18/18; tela 6/6; banco F28 11/11 e matriz RLS 5/5 em PostgreSQL 17 isolado na porta 25432. Migration 0000–0045 limpa, `pnpm build` 10/10, anti-drift/gate 6/6; typecheck passou; lint sem erros, com um aviso preexistente em `aba-de-enderecos.tsx`.
- [x] E2E autenticado regressivo F27 sem pacote em stack isolado: 1/1; revisões F28 mostram as três obrigações `INDETERMINATE`, sem valor, em CLARO/ESCURO e 768/1024/1440; axe sem violações e sem rolagem horizontal. Seis capturas em `test-results/F28-LOCAL/e2e/provas/spec-016/` (artefato local ignorado pelo Git).
- [ ] Pacote histórico oficial da F28 não foi curado, validado e publicado. A ausência preserva decisões indeterminadas; critérios de cobertura Simples/Presumido, operações internas/interestaduais, regras de responsabilidade, valores aprováveis e fixtures legais seguem pendentes de fontes oficiais completas e revisão tributária humana. Decretos GO 9.108/2017 e 9.147/2018 documentam a alteração/corte da ST, mas não bastam para inferir todos os parâmetros do pacote.
- [ ] E2E não cobre pacote oficial, cálculo aprovável, submissão/aprovação/rejeição humanas nem reprocessamento com regra legal. O cenário com pacote ausente não substitui esses gates da SPEC-028.
- [ ] Revisão comparativa visual com protótipo, CI remoto e PR: pendentes. Não declarar cartão aceito nem `proplan:done` enquanto os gates da SPEC-028 não forem cobertos.
