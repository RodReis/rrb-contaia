# ADR-004 — Acesso a dados e RLS de dois níveis

- **Status:** Aceita · **Data:** 17/09/2026 · **Decisor:** PI

## Contexto
O isolamento entre tenants é o requisito mais crítico do produto (PRD §4.4): empresas concorrentes atendidas pelo mesmo escritório não podem se ver. A RLS do PostgreSQL depende de contexto de sessão (`SET LOCAL`) — o que, sob conexão pooled, exige controle explícito da transação.

## Decisão
**Drizzle ORM** sobre PostgreSQL, com migrations em SQL versionado. Toda requisição abre transação e executa `SET LOCAL app.tenant_id` e `SET LOCAL app.empresa_id` antes de qualquer consulta. O papel da aplicação **não** tem `BYPASSRLS`.

## Consequências
- O contexto de RLS é explícito, legível e testável — não depende de comportamento implícito do ORM.
- SQL-first facilita escrever e revisar a política de RLS junto da migration.
- Exige mais código de repositório escrito à mão que um ORM de alto nível.

## Riscos
- Esquecer o `SET LOCAL` em um caminho novo é **P0**. Mitigação: helper único de transação, proibição de acesso direto ao pool, e **teste anti-drift** que falha se houver tabela transacional sem `tenant_id`/`empresa_id`, sem índice ou sem RLS ([`TESTING.md`](../TESTING.md) §3.1).

## Alternativas descartadas
- Prisma: DX melhor, mas RLS com pooling exige `$transaction` + `$executeRaw` em toda query — risco no ponto mais sensível.
- TypeORM: integração nativa com NestJS, tipagem mais fraca e migrations mais frouxas.
