# rrb-contaia

SaaS de gestão contábil.

Monorepo pnpm + Turborepo. Do MVP-1 ao MVP-4 o projeto roda **somente em Docker
local**, em instância própria e com portas próprias: não há deploy produtivo
([ADR-012](docs/adr/ADR-012-ambiente-local-ate-ultimo-mvp.md)).

## Primeira subida

```bash
pnpm install
cp .env.example .env
pnpm docker:up
pnpm db:migrate
pnpm dev
```

`.env.example` já traz portas e credenciais locais sintéticas. Nenhum segredo
real entra no repositório.

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
