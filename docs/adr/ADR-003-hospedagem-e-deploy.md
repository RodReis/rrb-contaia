# ADR-003 — Hospedagem e deploy

- **Status:** Aceita, **com risco aberto** · **Data:** 17/09/2026 · **Decisor:** PI

## Contexto
O PRD exige cofre de certificados com KMS/HSM, Signer em rede privada, RPO ≤ 1h / RTO ≤ 4h e retenção de XML por 5 anos (§§4.5 e 12). O projeto é solo e precisa de operação barata no MVP.

## Decisão
- **Desenvolvimento:** Docker Compose local (instância nova, portas novas na primeira subida — `CLAUDE.md`).
- **Produção:** **Vercel** para o web (Next.js) e **Railway** para API, workers, Signer, PostgreSQL e Redis.
- Deploy a partir da `main` verde ([`CI-PR.md`](../CI-PR.md) §6); migration em passo próprio, antes da aplicação.

## Consequências
- DX e preview de PR no front; operação mínima no back.
- Signer em **private networking**, sem domínio público.
- Object storage para XML contratado à parte, com retenção e versionamento.

## Riscos — abertos e conhecidos
1. **Railway não oferece KMS/HSM gerenciado.** No MVP o cofre roda como serviço próprio em rede privada, com chave mestra em segredo de ambiente. **Isso não cumpre integralmente o PRD §4.5 e é revisto na Fase 2**, antes de escala de base. Registrar em [`FORA-DE-ESCOPO.md`](../FORA-DE-ESCOPO.md).
2. **Dado fiscal atravessa dois provedores** (Vercel e Railway). Tráfego só por HTTPS, sessão em cookie `httpOnly`, e nenhum dado sensível persistido no lado do web.
3. **DR:** backup e teste de restore mensal são responsabilidade explícita — não vêm de graça.
4. Região de execução precisa ser fixada e verificada (latência com órgãos brasileiros e requisito de residência de dado).

## Alternativas descartadas
- AWS (ECS + RDS + KMS): atende melhor o §4.5, custo e complexidade maiores no dia 1. **É o destino natural da revisão da Fase 2.**
- VPS próprio: controle total, mas concentra operação de backup, DR e observabilidade no PI.
