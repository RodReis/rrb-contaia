# Motor tributário base versionado — Plano de implementação

> **Para agentes de implementação:** skill obrigatória `superpowers:executing-plans`; executar tarefa por tarefa com TDD. Em UI, usar `frontend-design`, `gstack:design-review` e `impeccable`. Reconciliar caminhos com a estrutura integrada pelas F1–F15 sem alterar os contratos abaixo.

**Objetivo:** implementar catálogo global versionado, avaliação tributária determinística e simulação manual ou por NF-e de teste conforme a SPEC-016.

**Arquitetura:** núcleo funcional puro em `packages/domain`, persistência global e auditoria no pacote de banco, casos de uso na API NestJS e interface Next.js. O adaptador NF-e normaliza XML em memória para o mesmo comando do formulário; não persiste nem envia o arquivo.

**Stack:** Node 24, TypeScript strict, NestJS 11, Next.js 16, React 19, Drizzle/PostgreSQL, Zod, parser XML seguro já aprovado no lockfile à época da implementação, Vitest e Playwright.

---

## 1. Mapa de responsabilidades

```text
packages/domain/src/tax-rules/       valores, vigência, operações e avaliador puro
packages/shared/src/tax-rules/       DTOs, schemas e códigos públicos
packages/db/src/tax-rules/           schema, repositórios e auditoria global
apps/api/src/tax-rules/              casos de uso, autorização e controllers
apps/api/src/tax-simulations/        orquestração manual e NF-e
apps/api/src/nfe/                    parser seguro e normalização descartável
apps/web/src/app/tax-rules/          catálogo, editor e simulador
tests/e2e/spec-016/                   jornadas, autorização e contrafactuais
```

O domínio não importa NestJS, Drizzle, XML, relógio ou navegador. O parser NF-e não consulta banco nem seleciona regra. O repositório não calcula tributo.

---

### Tarefa 1: Fixar contratos e avaliador puro

**Arquivos:**

- Criar: `packages/domain/src/tax-rules/model.ts`
- Criar: `packages/domain/src/tax-rules/evaluate-tax-rule.ts`
- Criar: `packages/domain/src/tax-rules/evaluate-tax-rule.test.ts`
- Modificar: `packages/domain/src/index.ts`

- [ ] **Passo 1: escrever testes falhos**

Cobrir base sem redução, redução, meio centavo arredondado para cima, limite inicial/final inclusivo, regra futura ignorada e reprodução byte a byte da memória.

```ts
expect(evaluateTaxRule(rule({ rateBasisPoints: 90 }), input({ baseCents: 10_001 }))).toMatchObject({
  resultCents: 90,
  rounding: 'HALF_UP',
});
```

- [ ] **Passo 2: provar a falha**

Executar: `pnpm --filter @contaia/domain test:regras -- tax-rules`

Esperado: FAIL por módulo ausente.

- [ ] **Passo 3: implementar tipos fechados e cálculo exato**

```ts
export type TaxType = 'ICMS' | 'PIS' | 'COFINS' | 'IBS_UF' | 'IBS_MUN' | 'CBS';
export type TaxRegime = 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL';
export type TaxRuleStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type TaxRuleOperation = Readonly<{
  baseReductionBasisPoints?: number;
  rateBasisPoints: number;
}>;
```

Calcular com inteiros ou decimal exato. Não converter dinheiro ou percentual para `number` fracionário. Retornar memória com numerador/denominador anterior ao arredondamento.

- [ ] **Passo 4: validar**

Executar: `pnpm --filter @contaia/domain test:regras && pnpm --filter @contaia/domain typecheck`

Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
git add packages/domain
git commit -m "feat: cria avaliador tributario deterministico"
```

---

### Tarefa 2: Persistir catálogo global e auditoria

**Arquivos:**

- Criar: `packages/db/src/tax-rules/schema.ts`
- Criar: `packages/db/src/tax-rules/repository.ts`
- Criar: `packages/db/src/tax-rules/repository.integration.test.ts`
- Criar: migration Drizzle numerada após a última existente

- [ ] **Passo 1: escrever integrações falhas**

Provar que publicação congela conteúdo, sobreposição falha atomicamente, intervalos adjacentes passam, edição concorrente retorna conflito, arquivamento preserva versão e auditoria não aceita `UPDATE`/`DELETE`.

- [ ] **Passo 2: provar a falha**

Executar: `pnpm --filter @contaia/db test:banco -- tax-rules`

Esperado: FAIL por tabelas ausentes.

- [ ] **Passo 3: criar schema e restrições**

Criar `tax_rule`, `tax_rule_version` e `tax_rule_audit_event` como catálogo global, sem `tenant_id` ou `empresa_id`. Usar intervalo de datas e exclusão PostgreSQL para impedir sobreposição apenas entre versões publicadas da mesma identidade. Trigger bloqueia alteração/exclusão de versão publicada e qualquer alteração/exclusão da auditoria.

- [ ] **Passo 4: implementar repositório transacional**

Expor `createDraft`, `updateDraft(expectedVersion)`, `publish`, `archive`, `findApplicable` e `list`. Mapear violações para códigos da SPEC-016 sem expor SQL.

- [ ] **Passo 5: validar migration e anti-drift**

Executar: `pnpm db:migrate && pnpm test:banco`

Esperado: PASS, inclusive banco vazio e repetição da migration.

- [ ] **Passo 6: commit**

```bash
git add packages/db
git commit -m "feat: persiste regras tributarias versionadas"
```

---

### Tarefa 3: Expor catálogo e comandos na API

**Arquivos:**

- Criar: `packages/shared/src/tax-rules/contracts.ts`
- Criar: `apps/api/src/tax-rules/tax-rules.module.ts`
- Criar: `apps/api/src/tax-rules/tax-rules.controller.ts`
- Criar: `apps/api/src/tax-rules/tax-rules.controller.spec.ts`
- Modificar: `apps/api/src/app.module.ts`

- [ ] **Passo 1: definir e testar schemas públicos**

O contrato de escrita aceita identidade, vigência, operação tipada, fonte e aviso de fixture. Não aceita estado, autor, total calculado ou expressão livre enviados pelo cliente.

- [ ] **Passo 2: escrever testes de autorização e Problem Details**

Cobrir `super-admin`, papel de escritório, versão concorrente, imutabilidade, sobreposição, paginação e filtros.

- [ ] **Passo 3: implementar endpoints**

```text
GET /tax-rules
POST /tax-rules
GET /tax-rules/:id
PUT /tax-rules/:id
POST /tax-rules/:id/publish
POST /tax-rules/:id/archive
```

Controllers validam DTO e delegam. Casos de uso recebem ator, instante e `correlationId`; nenhum usa relógio global em função pura.

- [ ] **Passo 4: validar**

Executar: `pnpm --filter @contaia/api test:regras -- tax-rules && pnpm --filter @contaia/api typecheck`

Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
git add packages/shared apps/api
git commit -m "feat: expoe catalogo tributario na api"
```

---

### Tarefa 4: Criar simulação manual

**Arquivos:**

- Criar: `apps/api/src/tax-simulations/simulate-manual.use-case.ts`
- Criar: `apps/api/src/tax-simulations/tax-simulations.controller.ts`
- Criar: `apps/api/src/tax-simulations/tax-simulations.controller.spec.ts`

- [ ] **Passo 1: escrever testes falhos**

Testar seleção única pela data, ausência, ambiguidade por drift, acesso permitido, memória completa e regra futura sem efeito retroativo.

- [ ] **Passo 2: implementar comando**

```ts
export type ManualTaxSimulationInput = Readonly<{
  factDate: string;
  regime: TaxRegime;
  taxType: TaxType;
  operationType: string;
  baseCents: number;
}>;
```

Expor `POST /tax-simulations/manual`. Validar centavos como inteiro seguro não negativo e data civil existente. Selecionar no repositório e chamar o domínio puro.

- [ ] **Passo 3: validar**

Executar: `pnpm --filter @contaia/api test:regras -- tax-simulations`

Esperado: PASS.

- [ ] **Passo 4: commit**

```bash
git add apps/api/src/tax-simulations
git commit -m "feat: adiciona simulacao tributaria manual"
```

---

### Tarefa 5: Adaptar NF-e em memória com parser seguro

**Arquivos:**

- Criar: `apps/api/src/nfe/parse-nfe-tax-input.ts`
- Criar: `apps/api/src/nfe/parse-nfe-tax-input.spec.ts`
- Criar: `apps/api/src/nfe/fixtures/` com NF-e sintéticas válidas e inválidas
- Modificar: controller de simulações

- [ ] **Passo 1: escolher biblioteca por documentação atual**

Consultar via Context7 ou documentação oficial a biblioteca já compatível com Node 24. Fixar versão no lockfile e provar configuração que desabilita DTD e entidades externas. Se a biblioteca não oferecer essa garantia, rejeitá-la.

- [ ] **Passo 2: escrever testes falhos**

Cobrir NT 2025.002 v1.50, itens IBS/CBS, ausência dos grupos, XML malformado, CT-e, versão diferente, DTD/XXE, limite de tamanho e muitos itens.

- [ ] **Passo 3: implementar normalização descartável**

Retornar somente metadados de simulação e itens normalizados. Nunca retornar DOM/XML bruto ao caso de uso, gravar arquivo, calcular dentro do parser ou buscar regra.

- [ ] **Passo 4: expor multipart**

Criar `POST /tax-simulations/nfe` com limite explícito de upload definido no schema, processamento em memória e descarte no `finally`. Campos não inferidos são enviados como complemento tipado no mesmo multipart.

- [ ] **Passo 5: provar ausência de persistência**

Executar teste que captura consultas ao banco, storage e logger e exige ausência de XML, chave de acesso e conteúdo fiscal bruto.

- [ ] **Passo 6: validar e commitar**

```bash
pnpm --filter @contaia/api test:regras -- nfe
git add apps/api package.json pnpm-lock.yaml
git commit -m "feat: simula tributos a partir de nfe de teste"
```

---

### Tarefa 6: Implementar catálogo e simulador web

**Arquivos:**

- Criar: `apps/web/src/app/tax-rules/page.tsx`
- Criar componentes focados em catálogo, editor, publicação, entrada manual, upload NF-e e memória
- Criar testes de tela junto aos componentes

- [ ] **Passo 1: aplicar direção visual**

Usar `frontend-design` e comparar com `docs/telas/contaia_apura_o_fiscal_tribut_ria_reforma_ibs_cbs_rf_03/`. Registrar antes/depois e não copiar KPIs ou ações fora da SPEC.

- [ ] **Passo 2: escrever testes de estados**

Cobrir vazio, rascunho, somente leitura, sobreposição, conflito, simulação manual, NF-e, complemento de campos, divergência, acesso negado e erro com correlação.

- [ ] **Passo 3: implementar página acessível**

As abas `Preenchimento manual` e `NF-e de teste` convergem para o mesmo componente de resultado. Diálogos prendem e devolvem foco. Valores são formatados apenas na borda; o estado preserva centavos inteiros.

- [ ] **Passo 4: validar temas e viewports**

Executar testes de tela e smoke Playwright em 768, 1024 e 1440 px, CLARO e ESCURO. Provar teclado, foco, contraste e redução de movimento.

- [ ] **Passo 5: refinar e commitar**

Aplicar `gstack:design-review` e `impeccable`; corrigir achados antes do commit.

```bash
pnpm --filter @contaia/web test:tela
git add apps/web
git commit -m "feat: cria interface do motor tributario base"
```

---

### Tarefa 7: Fechar E2E, fixtures e documentação de entrega

**Arquivos:**

- Criar: `tests/e2e/spec-016/motor-tributario.spec.ts`
- Modificar: `docs/DEVELOPMENT.md`
- Modificar: `docs/STATUS.md`
- Modificar: `docs/TESTING.md` somente se a execução revelar lacuna do contrato existente

- [ ] **Passo 1: criar fixtures globais não oficiais**

Seedar versões de teste para ao menos um tributo atual e IBS/CBS, com aviso inequívoco e intervalos que provem transição sem sobreposição.

- [ ] **Passo 2: executar jornadas E2E**

Provar admin cria/publica, usuário simula manualmente, NF-e calcula por item e total, valor declarado é comparado, regra futura não altera passado e XML não é persistido.

- [ ] **Passo 3: executar matriz completa**

```bash
pnpm lint
pnpm typecheck
pnpm test:regras
pnpm test:banco
pnpm test:tela
pnpm test:e2e
pnpm build
```

Esperado: tudo PASS no SHA final; integração externa permanece `not_run` porque a F16 não a utiliza.

- [ ] **Passo 4: autorrevisar e documentar**

Revisar diff completo contra SPEC-016, executar `engineering:code-review`, corrigir P0/P1 e registrar comandos, evidências visuais, limites e relatório rastreável por SPEC/issue.

- [ ] **Passo 5: commit**

```bash
git add tests/e2e/spec-016 docs/DEVELOPMENT.md docs/STATUS.md docs/TESTING.md
git commit -m "test: prova motor tributario base ponta a ponta"
```

---

## Verificação final do plano

- catálogo é global e não cria tabela transacional sem tenant;
- cálculo e seleção são puros, versionados e sem LLM;
- publicação é imutável e sobreposição é impossível;
- NF-e é descartável, segura e limitada ao simulador;
- captura, persistência documental e manifestações continuam nas futuras fatias RF-02;
- UI prova fidelidade, temas, responsividade, estados e acessibilidade;
- PR usa `refs #<issue>`, CI verde e não fecha a issue.
