# PRS.md — Pull requests: prática, revisão e métricas do fluxo

> **Normativo.** Como uma entrega chega à `main`.
> Branch, commit e merge: [`GITHUB.md`](GITHUB.md). Pipeline e tempo de execução: [`CI-PR.md`](CI-PR.md). Critério de achado: [`REVIEW.md`](REVIEW.md). Prova: [`TESTING.md`](TESTING.md).

---

## 1. O que é uma boa PR

**PR pequena é mudança revisável e coerente, não limite artificial de linhas.** Código, testes, migration e documentação indispensáveis ao mesmo resultado ficam juntos; trabalho independente sai.

| Sinal | Bom | Ruim |
|---|---|---|
| Finalidade | uma | "e de quebra arrumei o lint de outro módulo" |
| Tamanho | revisável de uma sentada (referência: ≤ ~400 linhas de diff útil) | 2.000 linhas onde 1.600 são renomeação |
| Duração | aberta por horas, não semanas | branch de 9 dias contra uma `main` que andou |
| Descrição | diz o resultado | narra as tentativas |
| Testes | provam o comportamento novo | ausentes "porque é óbvio" |

**Não partir mudança atômica só para reduzir linhas** (`CLAUDE.md`). Migration que acompanha o código que a usa fica junto: separar cria uma `main` momentaneamente inconsistente.

**Refactor grande vai em PR própria**, antes ou depois — nunca embrulhado com feature, porque some no diff e ninguém revisa nenhum dos dois.

---

## 2. Corpo obrigatório

```markdown
## Problema
O que estava errado ou faltando, em uma ou duas frases.

## Antes / depois
Comportamento observável antes e depois. Para UI, screenshot nos dois temas.

## Prova de UI (quando aplicável)
- tela de referência em `docs/telas/`
- comparação protótipo × implementação
- temas CLARO e ESCURO
- viewports 768 / 1024 / 1440
- estados exercitados
- `frontend-design`: aplicada
- `impeccable`: passe de acabamento aplicado
- divergências intencionais e origem em `DEBITO.md`

## Escopo e limites
O que esta PR faz e o que deliberadamente não faz.

## Rastreabilidade
- refs #N
- SPEC-NNN / Fn (quando aplicável)
- ADR afetada (quando aplicável)

## Validação executada
| Prova | Resultado | Evidência |
|---|---|---|
| lint + typecheck | pass | job `quality` |
| test-regras | pass | relatório SPEC-007 |
| test-banco (RLS) | pass | artefato |
| test-tela | pass | artefato |
| e2e | not_run | sem credencial de homologação Sefaz |

## Riscos, migração e rollback
Migration reversível? Feature flag? O que fazer se quebrar em produção.

## Limitações / not_run
O que não foi verificado e por quê.
```

**Regras de honestidade:**

- **`not_run` nunca vira `pass`.** Ausência de credencial, serviço externo ou ambiente real é `not_run` (`CLAUDE.md`). Falha de worker ou falta de infraestrutura nunca vira PASS.
- **Não narrar tentativas abandonadas.** A descrição explica o resultado final.
- **Não afirmar estado de CI sem verificar no momento da fala.** Silêncio de watcher, lista vazia ou print antigo não é verde.
- **Prova visual não substitui regra, acessibilidade ou persistência.** Screenshot mostra que apareceu, não que está correto.

---

## 3. Rotina do autor

1. Confirmar issue, SPEC, base remota, branch e diff local. Ler [`APRENDIZADOS.md`](APRENDIZADOS.md) antes de começar.
2. Garantir **uma finalidade**; retirar escopo oportunista.
3. Implementar com commits coerentes e push frequente ([`GITHUB.md`](GITHUB.md) §3).
4. Rodar lint, typecheck, testes e as provas condicionais de [`TESTING.md`](TESTING.md).
5. **Autorrevisar o diff completo contra a base** com [`REVIEW.md`](REVIEW.md) — inclusive arquivos já commitados. Deduplicar achados anteriores.
6. Abrir a PR com o corpo do §2 e acompanhar os checks **do SHA atual**: `gh pr checks <n> --watch`.
7. Corrigir **no mesmo branch/PR**; revalidar após qualquer mudança material. Novo head ou avanço da base exige reconciliar.
8. Squash merge só com gate verde ([`GITHUB.md`](GITHUB.md) §5).
9. Confirmar `mergedAt`/`mergeSha` na origem; publicar o comentário de encerramento na issue (skill `fechar-card`); só então `proplan:done`.
10. Indicar o próximo card da ordem em comentário/PR e seguir.

---

## 4. Revisão

O fluxo é solo: **o autor é o revisor**, e por isso a revisão é mais rígida, não menos. A disciplina está em [`REVIEW.md`](REVIEW.md).

**Bloqueiam o merge:**

- achado **P0/P1** não resolvido;
- aceite da SPEC não provado;
- migration insegura ou irreversível sem plano;
- conflito com PRD, ADR, [`CONVENTION.md`](CONVENTION.md) ou [`ARCHITECTURE.md`](ARCHITECTURE.md);
- CI incompleta, vermelha ou de SHA anterior;
- base não reconciliada.

**Não bloqueiam por si:** preferência de estilo (é trabalho do Prettier), ausência de documento opcional ou de skill realmente opcional. Em fatia com UI, `frontend-design`, `impeccable` e o protocolo equivalente de [`FRONTEND.md`](FRONTEND.md) §20.1 são obrigatórios; indisponibilidade da skill não dispensa sua disciplina nem a evidência.

**UI e fluxo crítico** incluem screenshot ou E2E declarando estado, viewport e ambiente — nos dois temas —, comparação com o protótipo correspondente e evidência do acabamento ([`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) §6; [`FRONTEND.md`](FRONTEND.md) §20.1).

---

## 5. Monitoramento e métricas do fluxo

Medir o fluxo serve para **encontrar onde o trabalho para**, não para pontuar pessoa. Nenhuma destas métricas é meta individual e nenhuma delas é aceite de entrega — **aceite é CI verde e aprovação do PI**.

### 5.1 Métricas de entrega (DORA)

| Métrica | Definição | Referência inicial | Onde olhar |
|---|---|---|---|
| **Lead time de mudança** | primeiro commit da branch → merge na `main` | ≤ 2 dias por card | `gh pr list --state merged` |
| **Frequência de merge** | PRs mergeadas por semana | ≥ 3 | idem |
| **Taxa de falha de mudança** | merges que exigiram `[FIX]` imediato ÷ total | ≤ 15% | issues `[FIX]` referenciando o PR |
| **Tempo de recuperação** | merge quebrado → `main` verde de novo | ≤ 1h | histórico da CI na `main` |
| **Retrabalho** | commits de correção sobre uma entrega já fechada | queda mês a mês | [`APRENDIZADOS.md`](APRENDIZADOS.md) |

As quatro primeiras são as métricas de desempenho de entrega do DORA (a quinta, retrabalho, foi acrescentada pelo próprio DORA ao conjunto). Referência inicial é **calibragem**, não contrato: ajustar com dado real depois de 20 PRs.

### 5.2 Métricas de PR

| Métrica | Sinal | Limite de atenção |
|---|---|---|
| Diff útil (exclui gerado/lock/snapshot) | revisabilidade | acima de ~400 linhas: justificar |
| Idade da PR aberta | risco de conflito | acima de 2 dias |
| Rodadas de CI até o verde | qualidade da autorrevisão | acima de 3 |
| Duração do gate | custo de cada rodada | acima de 15min ([`CI-PR.md`](CI-PR.md)) |
| Achados P0/P1 por PR | eficácia da revisão | tendência de alta |
| Arquivos tocados fora do escopo | escopo oportunista | qualquer um sem justificativa |

### 5.3 O que fazer com o número

- **Lead time subindo** → card grande demais. Fatiar é decisão do PI (`CLAUDE.md`), então o Code registra a evidência e pergunta.
- **Rodadas de CI acima de 3** → a autorrevisão está deixando passar o que a CI pega. O problema é o passo 5 da rotina, não a CI.
- **Gate acima de 15min** → medir e registrar a causa em [`CI-PR.md`](CI-PR.md). **Nunca** resolver removendo prova, `[skip ci]`, cache de PASS ou rerun cego (`CLAUDE.md`).
- **Taxa de falha de mudança subindo** → falta categoria de teste, não falta velocidade.
- **Métrica boa com produto ruim não vale nada.** PR pequena e rápida que entrega comportamento errado piorou tudo, e o número não mostra isso.

### 5.4 Registro

- Duração e causa de gate estourado: [`CI-PR.md`](CI-PR.md).
- Aprendizado recorrente (a armadilha que já custou tempo duas vezes): [`APRENDIZADOS.md`](APRENDIZADOS.md), pelo comentário de encerramento.
- Progresso por card: [`STATUS.md`](STATUS.md); prosa longa em [`STATUS-ARQUIVO.md`](STATUS-ARQUIVO.md).
- **Revisão do conjunto a cada fecho de MVP**, com o PI. Não se otimiza métrica semanalmente.

---

## 6. Template no repositório

`.github/pull_request_template.md` reproduz o §2. Quando o template existir, usá-lo é obrigatório (`CLAUDE.md`).

---

## Referências

- [`GITHUB.md`](GITHUB.md) · [`CI-PR.md`](CI-PR.md) · [`TESTING.md`](TESTING.md) · [`REVIEW.md`](REVIEW.md) · [`AUDIT.md`](AUDIT.md)
- [GitHub — About pull requests](https://docs.github.com/en/pull-requests/get-started/about-pull-requests)
- [GitHub — Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
- [DORA — Software delivery performance metrics](https://dora.dev/guides/dora-metrics/)
