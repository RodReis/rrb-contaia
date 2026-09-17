# Guia de pull requests

PR pequena é mudança revisável/coerente, não limite artificial de linhas. Código, testes, migration e docs indispensáveis ao resultado ficam juntos; trabalho independente sai.

## Corpo obrigatório

```markdown
## Problema
## Antes / depois
## Escopo e limites
## Rastreabilidade
- refs #N
- SPEC-NNN / Fn (quando aplicável)
## Validação executada
| Prova | Resultado | Evidência |
## Riscos, migração e rollback
## Limitações / not_run
```

Não narrar tentativas abandonadas nem afirmar PASS sem execução.

## Rotina

1. Confirmar issue, SPEC, base, branch e diff.
2. Garantir uma finalidade; retirar escopo oportunista.
3. Executar `TESTING.md`.
4. Autorrevisar o delta com `REVIEW.md`.
5. Abrir/atualizar PR e acompanhar checks do SHA atual.
6. Corrigir no mesmo branch e revalidar após mudança material.
7. Squash merge só com gate verde.
8. Confirmar integração na origem; então mover para `done`.

P0/P1, aceite não provado, migration insegura, conflito de produto, CI incompleta ou base não reconciliada bloqueiam. Preferência de estilo, documento ou skill opcional ausente não bloqueiam por si.

UI/fluxo crítico inclui screenshot/E2E do estado, viewport e ambiente. Imagem não substitui regra, acessibilidade ou persistência.

Referências: [GitHub PRs](https://docs.github.com/en/pull-requests/get-started/about-pull-requests) e [required checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

