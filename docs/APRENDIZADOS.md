# APRENDIZADOS.md — Armadilhas já pagas

> **Leitura obrigatória do Code/Codex no passo 1 de todo card** (`CLAUDE.md`). É curto de propósito: se crescer demais, ninguém lê e deixa de servir.
> **Mantido pelo Cowork**, consolidado no fecho de cada MVP a partir da seção **Aprendizado** dos comentários de encerramento.

---

## Protocolo

**O que entra**

- Armadilha que **já custou tempo de verdade**, com **fonte verificável**: documentação oficial, commit, log, comando, mensagem de erro. Sem fonte, não entra (`CLAUDE.md`).
- Preferência: o que **se repete**. Uma ocorrência isolada vira linha no comentário de encerramento da issue, não aqui.

**O que não entra**

- Aprendizado inventado para preencher template. Seção sem conteúdo real recebe "Nenhum".
- Opinião de estilo, preferência pessoal, recomendação genérica de boa prática.
- Regra de produto — isso é [`CONVENTION.md`](CONVENTION.md) ou PRD.
- Decisão estrutural — isso é [`DECISIONS.md`](DECISIONS.md).

**Teto e promoção**

- **Teto de 25 linhas de conteúdo.** No fecho de MVP, o Cowork poda: item resolvido na raiz (por lint, teste ou tipo que impede o erro) sai; item que virou regra sobe para o documento normativo correspondente e a linha aqui é removida com a referência.
- **Uma armadilha impedida por automação é melhor que uma armadilha documentada.** Sempre que possível, o aprendizado vira teste, regra de lint ou tipo — e aí deixa de precisar estar nesta lista.

**Formato**

```
- **<armadilha em uma linha>** — <o que fazer>. Fonte: <link, commit ou comando>. (MVP<n>, #<issue>)
```

---

## Rotina de consolidação (gate de MVP)

Dispara **uma vez por MVP**, no card `[GATE]`, como pré-requisito do item "aprendizados consolidados" de [`../prd/mvp/README.md`](../prd/mvp/README.md) §7 — nunca por card individual.

1. Levantar todo comentário de encerramento do MVP (ajustar `[MVP<n>]` e o repositório):

   ```bash
   gh issue list --repo RodReis/rrb-contaia --state closed --search "[MVP1] in:title" \
     --json number --jq '.[].number' | while read -r n; do
     gh issue view "$n" --repo RodReis/rrb-contaia --json comments \
       --jq '.comments[] | select(.body | test("## Encerramento")) | .body' \
       | awk -v n="$n" 'BEGIN{print "### Issue #" n} /### Aprendizado/{f=1} f; /### Imprevistos/{f=0}'
   done
   ```

2. Sobre essa saída, aplicar os critérios já existentes acima (fonte verificável, recorrência entre cards, teto de 25 linhas) — **o comando levanta, não decide**.
3. Item que aparece numa issue só continua só no comentário de origem; não sobe para cá.

---

## Armadilhas

_(vazio — nenhum card entregue ainda)_

---

## Referências

- [`AUDIT.md`](AUDIT.md) · [`CONVENTION.md`](CONVENTION.md) · [`DECISIONS.md`](DECISIONS.md) · [`STATUS.md`](STATUS.md)
