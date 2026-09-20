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
`19001`. Todas publicadas apenas em `127.0.0.1`.

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
| 3 | [#3](https://github.com/RodReis/rrb-contaia/issues/3) `[MVP1][SPEC-002][F2]` Cadastro e ativação da empresa cliente | F2 / SPEC-002 | a fazer | — | próximo `proplan:todo` |

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
