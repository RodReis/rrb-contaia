# docs/prd/mvp/ — Governança de MVPs e SPECs

> **Ler antes de criar ou alterar qualquer MVP ou SPEC.** Mantido pelo **Cowork**, escrito direto na `main`.

---

## 1. A regra que sustenta todas as outras

**Fatiamento não reduz escopo.** Quebrar um requisito em fatias muda *quando* ele é entregue, nunca *se*. Todo requisito aprovado no PRD termina em um de quatro lugares, e em **exatamente um**:

| Destino | Significa |
|---|---|
| **Mantido** | está numa fatia deste MVP |
| **Transferido** | está numa fatia de outro MVP |
| **Adiado** | está em [`../../FORA-DE-ESCOPO.md`](../../FORA-DE-ESCOPO.md) com motivo e gatilho |
| **Excluído** | idem, com motivo — e o PRD registra a exclusão |

**Requisito que não aparece em nenhum dos quatro sumiu por descuido.** É isso que a matriz de [`RASTREABILIDADE.md`](RASTREABILIDADE.md) existe para impedir: **ausência na matriz bloqueia aprovação documental.**

---

## 2. Estrutura

```
docs/prd/mvp/
  README.md              este documento
  RASTREABILIDADE.md     matriz normativa requisito → destino
  MVP-1-<nome>.md        épico: objetivo, escopo, checklist das fatias, critério de saída
  MVP-2-<nome>.md
  spec/SPEC-NNN-<slug>.md   especificação por fatia (apoio ao Code, não contrato)
  plans/PLAN-NNN-<slug>.md  plano de implementação por fatia (apoio ao Code, não contrato)
```

**`spec/` e `plans/` são material de apoio.** Onde divergirem do PRD, **o PRD vence** (`CLAUDE.md`).

---

## 3. Numeração

- Cada fatia recebe um `F<n>` e um `SPEC-<nnn>` **iguais**, alocados **uma única vez** no **Índice Fatia ↔ SPEC** de [`../../STATUS.md`](../../STATUS.md) — **fonte única do par MVP ↔ SPEC ↔ Fatia**.
- **Número nunca é reaproveitado**, nem de fatia cancelada.
- **Uma spec gera exatamente uma fatia.**
- **Partir uma fatia é decisão do PI** e gera spec nova com número novo — **nunca sufixo** (`SPEC-007a` não existe).
- Plano de gate/homologação **não é fatia**: vira card `[GATE]`, sem `F` e sem `SPEC`.

---

## 4. Régua de tamanho

Estimativa de esforço de implementação de **uma** fatia, já com teste e documentação de entrega:

| Régua | Referência | O que fazer |
|---|---|---|
| **Curto** | até ~meio dia | tamanho ideal |
| **Médio** | ~1 dia | bom |
| **Grande** | ~2 dias | aceitável; justificar por que não parte |
| **Enorme** | acima disso | **não vira card.** Volta para o PI para fatiar |

Uma fatia entrega **comportamento verificável de ponta a ponta**, não uma camada. "Criar a tabela" não é fatia; "cadastrar empresa com CNPJ válido e vê-la na listagem" é.

---

## 5. O que uma SPEC precisa ter

1. **Fatia e MVP** a que pertence, e a Slice do PRD que a origina.
2. **Comportamento esperado**, em termos observáveis pelo usuário.
3. **Critério de aceite verificável** — o que a CI ou a prova visual precisa mostrar.
4. **Invariantes tocados** ([`../../CONVENTION.md`](../../CONVENTION.md) §2).
5. **Fora de escopo desta fatia**, explícito.
6. **Dúvidas resolvidas** — a spec só fecha com todas respondidas pelo PI.

**O Cowork apresenta as dúvidas ao PI em perguntas objetivas antes de fechar a spec**, e só cria a issue com tudo resolvido (`CLAUDE.md`). Spec que nasce com pergunta aberta vira retrabalho na implementação.

---

## 6. Ciclo

```
PRD (Slice)
   │  Cowork escreve MVP-<n>.md com o checklist das fatias
   ▼
Índice Fatia ↔ SPEC (STATUS.md) — aloca F<n> e SPEC-<nnn>
   │
   ▼
SPEC-<nnn>.md  ──(dúvidas ao PI)──▶ fechada
   │
   ▼
Issue `[MVP<n>][SPEC-<nnn>][F<n>] título`  →  proplan:planejado → backlog → todo
   │
   ▼
Code implementa · PR com CI verde · comentário de encerramento · proplan:done
   │
   ▼
PI aceita → finalizado
```

**O Cowork mantém os próximos 5 cards em `proplan:todo`**, na ordem de implementação (`CLAUDE.md`).

---

## 7. Critério de saída de um MVP

Um MVP fecha quando, **cumulativamente**:

- [ ] todas as fatias do checklist estão `finalizado` (aceite do PI);
- [ ] o card `[GATE]` de homologação passou;
- [ ] a matriz de [`RASTREABILIDADE.md`](RASTREABILIDADE.md) não tem requisito sem destino;
- [ ] os aprendizados foram consolidados em [`../../APRENDIZADOS.md`](../../APRENDIZADOS.md);
- [ ] [`../../STATUS.md`](../../STATUS.md) e [`../../DEVELOPMENT.md`](../../DEVELOPMENT.md) refletem o estado real.

---

## 8. Estado atual

**Nenhum MVP fatiado ainda.** O PRD v3.0 está aprovado e os contratos técnicos escritos; o fatiamento é a próxima rodada do Cowork.

Próximo número livre: **F1 / SPEC-001**.
