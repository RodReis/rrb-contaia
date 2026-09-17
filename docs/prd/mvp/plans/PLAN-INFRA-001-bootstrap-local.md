# Bootstrap local do MVP-1 — Plano de implementação

> **Para agentes de implementação:** executar este plano tarefa por tarefa, com TDD nos checks verificáveis e commits pequenos. Não iniciar a SPEC-001 antes de este card estar integrado.

**Objetivo:** criar a fundação executável local do ContaIA, com monorepo, serviços Docker, shells de aplicação, migrations, testes e CI suficientes para iniciar a F1 sem refazer o bootstrap.

**Arquitetura:** monorepo pnpm + Turborepo com Web Next.js 16, API NestJS 11, shells de workers e Signer, PostgreSQL, Redis, Keycloak e MinIO em Docker Compose. A infraestrutura usa somente dados e segredos locais; não contém deploy ou configuração produtiva.

**Stack:** Node 24.15.0, pnpm 10.33.2, TypeScript strict, Turborepo, Next.js 16, React 19, NestJS 11, Drizzle ORM, PostgreSQL, Redis, Keycloak 26.5.2, MinIO, Vitest e Playwright.

**Issue:** #1 — `[INFRA] Bootstrap local do MVP-1`

---

## 1. Mapa de arquivos

```text
package.json                         scripts e versões raiz
pnpm-workspace.yaml                  fronteiras do workspace
pnpm-lock.yaml                       resolução reproduzível
turbo.json                           grafo de tarefas e outputs
tsconfig.base.json                   TypeScript strict compartilhado
.nvmrc                               Node 24.15.0
.npmrc                               engine strict e lockfile
.env.example                         portas e segredos exclusivamente locais
apps/web/                            Next.js e health HTTP
apps/api/                            NestJS, health e migrations
apps/workers/                        processo mínimo e health HTTP
apps/signer/                         processo isolado e health HTTP
packages/config/                     configs TypeScript/ESLint compartilhadas
packages/shared/                     contratos sem framework
packages/domain/                     domínio puro sem framework
packages/db/                         Drizzle, pool, migrations e checks
infra/docker/compose.yml             serviços locais e redes
infra/keycloak/realm-contaia.json    realm e admin seedado para desenvolvimento
scripts/ci/validate-workspace.mjs     self-check estrutural
scripts/ci/write-summary.mjs          resumo rastreável do gate
.github/workflows/ci.yml              matriz paralela e gate único
tests/e2e/bootstrap.spec.ts           smoke do ambiente local
docs/DEVELOPMENT.md                   comandos reais após o bootstrap
docs/STATUS.md                        progresso do card
```

Não criar `services/ai` funcional neste card. Criar somente o diretório documentado quando uma fatia de IA o exigir.

---

### Tarefa 1: Fixar runtime e workspace raiz

**Arquivos:**

- Criar: `package.json`
- Criar: `pnpm-workspace.yaml`
- Criar: `turbo.json`
- Criar: `tsconfig.base.json`
- Criar: `.nvmrc`
- Criar: `.npmrc`

- [ ] **Passo 1: criar o teste estrutural inicialmente falho**

Criar `scripts/ci/validate-workspace.mjs` verificando arquivos, engines e pacotes obrigatórios:

```js
import { readFile } from 'node:fs/promises';

const root = JSON.parse(await readFile(new URL('../../package.json', import.meta.url)));
const required = ['apps/web', 'apps/api', 'apps/workers', 'apps/signer', 'packages/shared', 'packages/domain', 'packages/db'];

if (root.engines?.node !== '>=24 <25') throw new Error('Node 24 não está fixado');
if (root.packageManager !== 'pnpm@10.33.2') throw new Error('pnpm não está fixado');

const workspace = await readFile(new URL('../../pnpm-workspace.yaml', import.meta.url), 'utf8');
for (const path of required) {
  if (!workspace.includes(path.split('/')[0])) throw new Error(`Workspace ausente: ${path}`);
}
```

- [ ] **Passo 2: provar a falha**

Executar: `node scripts/ci/validate-workspace.mjs`

Esperado: falha por ausência de `package.json`.

- [ ] **Passo 3: criar a configuração raiz mínima**

`package.json`:

```json
{
  "name": "rrb-contaia",
  "private": true,
  "packageManager": "pnpm@10.33.2",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test:regras": "turbo run test:regras",
    "test:banco": "turbo run test:banco",
    "test:tela": "turbo run test:tela",
    "test:e2e": "playwright test",
    "db:generate": "pnpm --filter @contaia/db db:generate",
    "db:migrate": "pnpm --filter @contaia/db db:migrate",
    "check:workspace": "node scripts/ci/validate-workspace.mjs"
  },
  "devDependencies": {
    "@playwright/test": "^1.55.0",
    "turbo": "^2.5.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
  - services/*
```

`turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**", "!.next/cache/**"] },
    "lint": { "dependsOn": ["^lint"] },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "test:regras": { "dependsOn": ["^build"], "outputs": ["coverage/**", "test-results/**"] },
    "test:banco": { "cache": false, "outputs": ["coverage/**", "test-results/**"] },
    "test:tela": { "dependsOn": ["^build"], "outputs": ["coverage/**", "test-results/**"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

`tsconfig.base.json` deve ativar `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` e `useUnknownInCatchVariables`.

- [ ] **Passo 4: instalar e validar**

Executar:

```bash
pnpm install
pnpm check:workspace
```

Esperado: lockfile criado e `check:workspace` com saída zero.

- [ ] **Passo 5: commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json .nvmrc .npmrc scripts/ci/validate-workspace.mjs
git commit -m "build: inicia workspace pnpm e turborepo"
```

---

### Tarefa 2: Criar pacotes compartilhados sem dependência de framework

**Arquivos:**

- Criar: `packages/config/package.json`
- Criar: `packages/config/tsconfig.json`
- Criar: `packages/shared/package.json`
- Criar: `packages/shared/src/index.ts`
- Criar: `packages/domain/package.json`
- Criar: `packages/domain/src/index.ts`
- Testar: `packages/domain/src/no-framework.test.ts`

- [ ] **Passo 1: escrever o teste de fronteira**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('fronteira do domínio', () => {
  it('não depende de framework', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain('@nestjs/common');
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain('next');
  });
});
```

- [ ] **Passo 2: provar a falha por pacote ausente**

Executar: `pnpm --filter @contaia/domain test:regras`

Esperado: falha porque o pacote ainda não existe.

- [ ] **Passo 3: criar os pacotes**

Cada pacote deve ser `private`, ESM, exportar somente `src/index.ts` e herdar `tsconfig.base.json`. `@contaia/domain` expõe inicialmente apenas:

```ts
export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type CorrelationId = Brand<string, 'CorrelationId'>;
```

- [ ] **Passo 4: executar regras, lint e tipos**

```bash
pnpm test:regras
pnpm lint
pnpm typecheck
```

Esperado: todos passam; categorias sem testes adicionais reportam zero testes, não PASS fictício.

- [ ] **Passo 5: commit**

```bash
git add packages
git commit -m "build: cria pacotes compartilhados do domínio"
```

---

### Tarefa 3: Criar Web Next.js 16 com health check

**Arquivos:**

- Criar: `apps/web/package.json`
- Criar: `apps/web/src/app/layout.tsx`
- Criar: `apps/web/src/app/page.tsx`
- Criar: `apps/web/src/app/api/health/route.ts`
- Criar: `apps/web/src/app/page.test.tsx`
- Criar: `apps/web/eslint.config.mjs`

- [ ] **Passo 1: scaffold oficial**

Executar:

```bash
pnpm dlx create-next-app@16.2.9 apps/web --ts --eslint --tailwind --app --src-dir --use-pnpm --import-alias "@/*" --disable-git
```

Remover lockfile interno e manter somente o lockfile da raiz.

- [ ] **Passo 2: escrever o teste de tela falho**

```tsx
import { render, screen } from '@testing-library/react';
import Home from './page';

it('identifica o ambiente local do ContaIA', () => {
  render(<Home />);
  expect(screen.getByRole('heading', { name: 'ContaIA' })).toBeVisible();
  expect(screen.getByText('Ambiente local')).toBeVisible();
});
```

- [ ] **Passo 3: implementar página e health route mínimos**

`route.ts`:

```ts
export async function GET() {
  return Response.json({ service: 'web', status: 'ok' });
}
```

A página deve usar tokens do design system e conter somente título, identificação do ambiente e estado de inicialização; não antecipar a tela da F1.

- [ ] **Passo 4: validar**

```bash
pnpm --filter @contaia/web test:tela
pnpm --filter @contaia/web lint
pnpm --filter @contaia/web typecheck
pnpm --filter @contaia/web build
```

Esperado: testes, lint, tipos e build passam.

- [ ] **Passo 5: commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "build: cria shell web com health check"
```

---

### Tarefa 4: Criar API NestJS 11 com health check

**Arquivos:**

- Criar: `apps/api/src/main.ts`
- Criar: `apps/api/src/app.module.ts`
- Criar: `apps/api/src/health/health.controller.ts`
- Criar: `apps/api/src/health/health.controller.spec.ts`
- Criar: `apps/api/package.json`

- [ ] **Passo 1: scaffold oficial**

Executar:

```bash
pnpm dlx @nestjs/cli@11 new apps/api --package-manager pnpm --language ts --skip-git --strict
```

Remover lockfile interno e ajustar o nome para `@contaia/api`.

- [ ] **Passo 2: escrever o teste falho**

```ts
it('retorna saúde da API', async () => {
  await request(app.getHttpServer())
    .get('/health')
    .expect(200)
    .expect({ service: 'api', status: 'ok' });
});
```

- [ ] **Passo 3: implementar bootstrap e health**

`main.ts` deve usar `forceCloseConnections: true`, `enableShutdownHooks()` e porta vinda de `API_PORT`. O controller retorna exatamente o contrato testado.

- [ ] **Passo 4: validar**

```bash
pnpm --filter @contaia/api test
pnpm --filter @contaia/api lint
pnpm --filter @contaia/api typecheck
pnpm --filter @contaia/api build
```

Esperado: tudo passa sem depender do Docker.

- [ ] **Passo 5: commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "build: cria API NestJS com health check"
```

---

### Tarefa 5: Criar shells de workers e Signer

**Arquivos:**

- Criar: `apps/workers/src/main.ts`
- Criar: `apps/workers/src/health.test.ts`
- Criar: `apps/workers/package.json`
- Criar: `apps/signer/src/main.ts`
- Criar: `apps/signer/src/health.test.ts`
- Criar: `apps/signer/package.json`

- [ ] **Passo 1: escrever testes falhos para os contratos de saúde**

Cada pacote testa uma função pura:

```ts
export const health = (service: 'workers' | 'signer') => ({ service, status: 'ok' as const });
```

- [ ] **Passo 2: provar a falha**

```bash
pnpm --filter @contaia/workers test:regras
pnpm --filter @contaia/signer test:regras
```

Esperado: módulos ausentes.

- [ ] **Passo 3: implementar processos mínimos**

Usar `node:http` para expor `/health`; não adicionar BullMQ, certificado, assinatura ou integração governamental neste card.

- [ ] **Passo 4: validar build e encerramento gracioso**

```bash
pnpm --filter @contaia/workers test:regras
pnpm --filter @contaia/signer test:regras
pnpm --filter @contaia/workers build
pnpm --filter @contaia/signer build
```

- [ ] **Passo 5: commit**

```bash
git add apps/workers apps/signer
git commit -m "build: cria shells de workers e signer"
```

---

### Tarefa 6: Configurar PostgreSQL e migrations Drizzle

**Arquivos:**

- Criar: `packages/db/package.json`
- Criar: `packages/db/drizzle.config.ts`
- Criar: `packages/db/src/client.ts`
- Criar: `packages/db/src/migrate.ts`
- Criar: `packages/db/src/health.ts`
- Criar: `packages/db/src/health.integration.test.ts`
- Criar: `packages/db/migrations/0000_bootstrap.sql`

- [ ] **Passo 1: escrever integração falha**

O teste conecta usando `DATABASE_URL`, executa `select 1` e prova que a role da aplicação possui `rolbypassrls = false`.

- [ ] **Passo 2: provar a falha sem banco**

Executar: `pnpm --filter @contaia/db test:banco`

Esperado: falha de conexão; não converter em `pass`.

- [ ] **Passo 3: criar cliente e migration SQL**

O cliente usa `drizzle-orm/node-postgres`. A migration cria somente extensões/esquemas técnicos e a role `contaia_app` sem `BYPASSRLS`; nenhuma entidade de produto entra no card de infraestrutura.

- [ ] **Passo 4: executar contra PostgreSQL efêmero**

```bash
docker compose -f infra/docker/compose.yml up -d postgres
pnpm db:migrate
pnpm test:banco
```

Esperado: migration e teste passam em banco vazio.

- [ ] **Passo 5: commit**

```bash
git add packages/db
git commit -m "build: configura postgres e migrations drizzle"
```

---

### Tarefa 7: Montar Docker Compose local com portas próprias

**Arquivos:**

- Criar: `.env.example`
- Criar: `infra/docker/compose.yml`
- Criar: `infra/docker/api.Dockerfile`
- Criar: `infra/docker/web.Dockerfile`
- Criar: `infra/docker/node-service.Dockerfile`
- Criar: `infra/keycloak/realm-contaia.json`

- [ ] **Passo 1: revalidar as portas antes da primeira subida**

Portas reservadas no plano: Web `15100`, API `15101`, workers `15102`, Signer `15103`, PostgreSQL `15432`, Redis `16379`, Keycloak `18080`, MinIO API `19000`, MinIO Console `19001`.

Executar no PowerShell:

```powershell
$ports=15100,15101,15102,15103,15432,16379,18080,19000,19001
Get-NetTCPConnection -State Listen | Where-Object { $ports -contains $_.LocalPort }
```

Esperado: nenhuma linha. Se houver conflito, escolher uma faixa inteiramente nova e atualizar `.env.example`, Compose e este plano no mesmo PR.

- [ ] **Passo 2: criar Compose e health checks**

Todos os serviços têm health check real. Keycloak usa `start-dev --import-realm`, monta `infra/keycloak` em `/opt/keycloak/data/import` e fixa imagem `quay.io/keycloak/keycloak:26.5.2`. O realm cria o client local e o papel `admin_escritorio`, sem credencial real.

- [ ] **Passo 3: validar configuração sem subir**

```bash
docker compose --env-file .env.example -f infra/docker/compose.yml config --quiet
```

Esperado: código zero.

- [ ] **Passo 4: subir e verificar saúde**

```bash
docker compose --env-file .env.example -f infra/docker/compose.yml up -d --build
docker compose --env-file .env.example -f infra/docker/compose.yml ps
```

Esperado: todos os serviços `healthy`; nenhum contêiner de outro projeto alterado.

- [ ] **Passo 5: commit**

```bash
git add .env.example infra
git commit -m "build: adiciona ambiente docker local isolado"
```

---

### Tarefa 8: Criar smoke E2E do ambiente

**Arquivos:**

- Criar: `playwright.config.ts`
- Criar: `tests/e2e/bootstrap.spec.ts`
- Criar: `tests/helpers/wait-for-services.ts`

- [ ] **Passo 1: escrever o E2E falho**

```ts
import { expect, test } from '@playwright/test';

test('ambiente local expõe Web e API saudáveis', async ({ page, request }) => {
  await page.goto('http://127.0.0.1:15100');
  await expect(page.getByRole('heading', { name: 'ContaIA' })).toBeVisible();

  const api = await request.get('http://127.0.0.1:15101/health');
  expect(api.ok()).toBe(true);
  await expect(api.json()).resolves.toEqual({ service: 'api', status: 'ok' });
});
```

- [ ] **Passo 2: executar antes do ambiente**

Executar: `pnpm test:e2e`

Esperado: falha de conexão quando o Compose estiver parado.

- [ ] **Passo 3: executar com o ambiente saudável**

```bash
docker compose --env-file .env.example -f infra/docker/compose.yml up -d
pnpm test:e2e
```

Esperado: PASS, com relatório Playwright em `test-results/INFRA-1/e2e/`.

- [ ] **Passo 4: provar que health check detecta falha**

Parar apenas a API, executar o smoke e confirmar FAIL; religar a API e confirmar PASS. Registrar ambos no relatório do card.

- [ ] **Passo 5: commit**

```bash
git add playwright.config.ts tests
git commit -m "test: prova ambiente local ponta a ponta"
```

---

### Tarefa 9: Montar CI paralela e gate agregador

**Arquivos:**

- Criar: `.github/workflows/ci.yml`
- Criar: `scripts/ci/write-summary.mjs`
- Criar: `scripts/ci/validate-gate.mjs`
- Criar: `scripts/ci/validate-gate.test.mjs`

- [ ] **Passo 1: escrever self-check falho do gate**

O teste alimenta o agregador com uma categoria ausente e exige código diferente de zero; depois alimenta todas as categorias e exige sucesso.

- [ ] **Passo 2: implementar o resumo**

`write-summary.mjs` escreve `test-results/INFRA-1/resumo.json` com categoria, totais, falhas, pulos, `not_run`, motivo e duração. `validate-gate.mjs` falha se um job obrigatório não reportar.

- [ ] **Passo 3: criar workflow**

Jobs paralelos: `quality`, `test-regras`, `test-banco`, `test-tela`, `e2e`, `build`; `gate` depende de todos e não reexecuta suíte. Usar Node 24, pnpm 10.33.2, `pnpm install --frozen-lockfile`, cache do pnpm, `concurrency.cancel-in-progress: true` e artefatos brutos.

- [ ] **Passo 4: validar localmente**

```bash
node --test scripts/ci/validate-gate.test.mjs
pnpm lint
pnpm typecheck
pnpm test:regras
pnpm test:banco
pnpm test:tela
pnpm test:e2e
pnpm build
```

Esperado: todos passam; o resumo referencia `INFRA-1`.

- [ ] **Passo 5: commit**

```bash
git add .github scripts/ci
git commit -m "ci: cria matriz paralela e gate agregado"
```

---

### Tarefa 10: Atualizar documentação e executar prova final

**Arquivos:**

- Modificar: `README.md`
- Modificar: `docs/DEVELOPMENT.md`
- Modificar: `docs/STATUS.md`
- Modificar: `docs/CI-PR.md` somente se houver medição acima de 15 minutos

- [ ] **Passo 1: documentar comandos reais**

Registrar instalação, cópia de `.env.example`, subida, migrations, desenvolvimento, testes, parada e limpeza apenas dos volumes nomeados deste projeto.

- [ ] **Passo 2: executar a matriz local completa**

```bash
pnpm lint
pnpm typecheck
pnpm test:regras
pnpm test:banco
pnpm test:tela
pnpm test:e2e
pnpm build
```

Esperado: tudo passa no SHA final.

- [ ] **Passo 3: provar reinicialização limpa**

Parar os serviços, remover somente os volumes nomeados `contaia_*`, subir novamente, aplicar migrations e repetir o smoke. Não usar comando destrutivo contra volumes de outros projetos.

- [ ] **Passo 4: revisar o diff completo**

Verificar especialmente:

- nenhum segredo ou dado real;
- nenhuma porta reutilizada;
- nenhum serviço em `latest`;
- nenhum teste obrigatório silenciado;
- nenhum deploy configurado;
- Keycloak estritamente em modo local;
- API e banco preparados para a F1 sem implementar regra da F1.

- [ ] **Passo 5: commit de documentação**

```bash
git add README.md docs/DEVELOPMENT.md docs/STATUS.md docs/CI-PR.md
git commit -m "docs: registra bootstrap local do MVP-1"
```

---

## Verificação final do plano

- O card entrega infraestrutura, não comportamento de produto.
- A SPEC-001 continua dependente deste card e não é antecipada.
- O ambiente inteiro é local e utiliza dados sintéticos.
- Os quatro tipos de prova aplicáveis possuem comando e artefato.
- A CI tem gate único e jobs paralelos.
- Produção, nuvem, certificado, Signer funcional, filas reais e IA permanecem fora.

## Fontes consultadas

- ADR-001, ADR-002, ADR-004, ADR-008, ADR-009, ADR-011 e ADR-012.
- `ARCHITECTURE.md`, `TESTING.md`, `CI-PR.md` e `DEVELOPMENT.md`.
- Documentação atual consultada via Context7: pnpm, Turborepo, Next.js 16.2.9, NestJS 11.1.16, Drizzle ORM e Keycloak 26.5.2.
