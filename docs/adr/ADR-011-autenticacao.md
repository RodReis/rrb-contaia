# ADR-011 — Autenticação e identidade

- **Status:** Aceita · **Data:** 17/09/2026 · **Decisor:** PI

## Contexto
O PRD §14 diz apenas "Auth OIDC". O RF-01 exige sete papéis, alçada por carteira, portal do cliente e, no RF-08, impersonation auditada de super-admin.

## Decisão
**Keycloak self-hosted** como provedor OIDC. Sessão por cookie `httpOnly`, `Secure`, `SameSite=Lax`.

**Fronteira explícita:** o provedor de identidade responde *quem é o usuário e qual o papel*. **A carteira (quais empresas ele acessa) é dado do produto, no PostgreSQL** — não vira papel no Keycloak.

## Consequências
- MFA, federação e política de senha sem custo por usuário e sem dado de identidade fora do país.
- Impersonation do RF-08 não usa troca de token de usuário: usa o caminho de serviço auditado (PRD §4.4).
- Mais um serviço para operar, atualizar e incluir no backup.

## Riscos
- Keycloak mal operado é ponto único de falha de acesso: exige backup do realm, atualização acompanhada e monitoração.
- Tentação de modelar carteira como papel: proibido — alçada muda com frequência e é dado de produto.

## Alternativas descartadas
- Better Auth na própria API: mais rápido no MVP, MFA e federação por conta própria depois.
- Auth0/Clerk: menor esforço operacional, custo por MAU e dado de identidade de contador fora do país.
