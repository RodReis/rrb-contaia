# ADR-008 — Política de cobertura de teste

- **Status:** Aceita · **Data:** 17/09/2026 · **Decisor:** PI

## Contexto
`CLAUDE.md` exige evidência por categoria e proíbe remover prova para ganhar minutos, mas não fixa piso. Piso global de cobertura é métrica conhecida por premiar o que é fácil de testar.

## Decisão
**Piso por categoria de risco, sem número global:**

| Alvo | Piso |
|---|---|
| Motor tributário, partida dobrada, motor de obrigações, conciliação, validadores | **95% de linhas e 100% dos invariantes documentados** |
| RLS e repositórios | **100% das tabelas sensíveis cobertas pelo anti-drift** |
| Casos de uso da API | **80% de linhas** |
| UI | sem piso numérico — prova por estado de tela + E2E do caminho crítico |
| Adaptadores, DTO, configuração | sem piso |

## Consequências
- O gate bloqueia por ausência de prova onde o risco está, não por média aritmética.
- Detalhe operacional em [`TESTING.md`](../TESTING.md) §5.

## Riscos
- Piso por categoria exige que a categorização esteja correta: código de domínio disfarçado de adaptador escaparia. Revisão verifica a classificação ([`REVIEW.md`](../REVIEW.md) §3.4).

## Alternativas descartadas
- Piso global de 80%: simples de configurar, incentiva teste de fachada.
- Sem piso: depende inteiramente de disciplina, sem detector automático.
