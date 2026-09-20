# rrb-contaIA

SaaS de contabilidade inteligente multi-empresa: uma plataforma multi-tenant de
dois níveis — escritório contábil (tenant) e empresa cliente (sub-tenant) — que
permite a escritórios contábeis operar centenas de CNPJs num painel
centralizado, com captura fiscal, apuração tributária e automação por agentes
de IA sobre as tarefas repetitivas.

Monorepo pnpm + Turborepo. Do MVP-1 ao MVP-4 o projeto roda **somente em Docker
local**, em instância própria e com portas próprias: não há deploy produtivo
([ADR-012](docs/adr/ADR-012-ambiente-local-ate-ultimo-mvp.md)).

## Pré-requisitos

| Ferramenta | Versão |
|---|---|
| Node.js | `>=24 <25` |
| pnpm | `10.33.2` (via `packageManager`, use `corepack enable`) |
| Docker + Docker Compose | qualquer versão recente, com suporte a `compose.yml` |

## Instalação

```bash
corepack enable        # garante o pnpm na versão fixada pelo repositório
pnpm install
cp .env.example .env
```

`.env.example` já traz portas e credenciais locais sintéticas — nenhum segredo
real entra no repositório. Não edite `.env` para apontar para infraestrutura
compartilhada ou produtiva; cada instância local usa portas próprias.

## Subir o ambiente (Docker)

```bash
pnpm docker:up      # Postgres, Redis, Keycloak e MinIO
pnpm db:migrate      # aplica as migrations no Postgres
pnpm db:seed         # cria o tenant e o usuário de teste no Keycloak/Postgres
```

`docker:up` sobe os serviços de infraestrutura definidos em
[`infra/docker/compose.yml`](infra/docker/compose.yml). Aguarde os health
checks ficarem `healthy` antes de migrar (`pnpm docker:ps` mostra o status).
`db:seed` é obrigatório na primeira subida: sem ele não existe usuário para
autenticar via OIDC.

Para derrubar o ambiente: `pnpm docker:down`.

## Build

```bash
pnpm build     # build de todos os apps e pacotes via Turborepo
pnpm lint      # ESLint em todo o workspace
pnpm typecheck # checagem de tipos em todo o workspace
```

## Rodar em desenvolvimento (localhost)

```bash
pnpm dev
```

Sobe todos os apps em paralelo (`turbo run dev --parallel`), nas portas
definidas em `.env`:

| App | URL local | Porta (`.env`) |
|---|---|---|
| Web (Next.js) | http://127.0.0.1:15100 | `WEB_PORT` |
| API (NestJS) | http://127.0.0.1:15101 | `API_PORT` |
| Workers | — (sem HTTP público) | `WORKERS_PORT` |
| Signer | — (serviço isolado) | `SIGNER_PORT` |
| Keycloak (admin console) | http://127.0.0.1:18080 | `KEYCLOAK_PORT` |
| MinIO (console) | http://127.0.0.1:19001 | `MINIO_CONSOLE_PORT` |

**Acesse a Web sempre por `http://127.0.0.1:15100`, nunca por
`http://localhost:15100`.** O login OIDC fixa a origem em `127.0.0.1` para a
sessão gravada em cookie; abrir por `localhost` quebra o retorno do fluxo de
autenticação.

## Testes

```bash
pnpm test:regras  # regras de domínio
pnpm test:banco   # testes de integração com o Postgres
pnpm test:tela    # testes de componente/tela
pnpm test:e2e     # Playwright, fim a fim
```

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `apps/web` | interface Next.js |
| `apps/api` | API NestJS, casos de uso e motores determinísticos |
| `apps/workers` | consumidores de fila |
| `apps/signer` | serviço isolado de assinatura |
| `packages/shared` | contratos e códigos de erro |
| `packages/domain` | tipos e invariantes de domínio, sem framework |
| `packages/db` | Drizzle, migrations e acesso a dados |
| `packages/config` | TypeScript, ESLint e Vitest compartilhados |
| `infra/docker` | ambiente local |

## Documentação

Comandos e ordem de execução em [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md);
o resto dos contratos em [`docs/`](docs/), a começar por
[`CLAUDE.md`](CLAUDE.md).
