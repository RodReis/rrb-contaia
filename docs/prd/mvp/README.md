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

### 1.1 Escolha mínima não descarta o complemento

Quando o PI escolhe uma alternativa mínima, menor ou recomendada para um MVP, essa escolha define **o que entra agora**, não autoriza apagar o restante do requisito. Todo complemento precisa aparecer nominalmente como **transferido** para outro MVP ou como **adiado/excluído** em [`../../FORA-DE-ESCOPO.md`](../../FORA-DE-ESCOPO.md), sempre com destino e gatilho.

Cada documento de MVP e cada SPEC reconciliam o escopo item a item com um destes estados: **entrou**, **entrou parcialmente**, **transferido** ou **adiado/excluído**. Item marcado como “entrou parcialmente” declara obrigatoriamente qual complemento falta e em qual MVP/fatia ele será tratado. “Fora desta fatia” sem destino explícito é inválido.

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
7. **Destino do complemento** — toda redução, versão mínima ou entrega parcial aponta o MVP/fatia que recebe o restante; nada fica apenas como “depois”.
8. **Contrato de UI**, quando aplicável — tela de referência em `docs/telas/`, estados, temas CLARO/ESCURO, viewports e provas exigidas por [`../../FRONTEND.md`](../../FRONTEND.md) §20.1; `frontend-design` e `impeccable` são obrigatórias na implementação.

**O Cowork apresenta as dúvidas ao PI em perguntas objetivas antes de fechar a spec**, e só cria a issue com tudo resolvido (`CLAUDE.md`). Spec que nasce com pergunta aberta vira retrabalho na implementação.

### 5.1 Gate obrigatório de conformidade antes da issue

Os oito itens acima são **gate**, não orientação. Antes de marcar uma SPEC como aprovada ou criar sua issue, o Cowork executa a conferência abaixo no documento completo:

| Verificação | Evidência mínima dentro da SPEC |
|---|---|
| Identidade | cabeçalho com MVP, F, SPEC e origem exata no PRD |
| Comportamento | seção observável pelo usuário, sem descrever apenas camada técnica |
| Aceite | critérios enumerados e ligados a provas de CI, teste ou prova visual |
| Invariantes | seção explícita **Invariantes globais tocados**, citando os códigos `I-n` de `CONVENTION.md` §2 e explicando como cada um se aplica; “segue CONVENTION” não basta |
| Fora de escopo | tabela explícita do que não entra |
| Dúvidas | decisões do PI registradas e questões abertas iguais a “Nenhuma” |
| Complementos | cada item parcial aponta fatia já numerada; se ainda não houver número, aponta nominalmente a capacidade e o MVP que obrigatoriamente a receberá |
| UI | caminhos concretos de `docs/telas/`, estados, CLARO/ESCURO, viewports, provas de `FRONTEND.md` §20.1 e uso obrigatório de `frontend-design` e `impeccable`; “referências aplicáveis” não basta |

Resultado da conferência:

- qualquer item ausente mantém a SPEC em revisão e bloqueia a criação da issue;
- a autorrevisão procura também contradições, placeholders e escopo Enorme;
- correção posterior de não conformidade documental preserva o aceite funcional do PI, mas precisa ser publicada antes de implementação da fatia;
- `STATUS.md` só recebe “aprovada” depois que o gate inteiro estiver atendido.

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
- [ ] todas as fatias com UI comprovaram fidelidade, os dois temas e acabamento pelo protocolo de [`../../FRONTEND.md`](../../FRONTEND.md) §20.1 — dívida visual não é empurrada para o MVP seguinte.

---

## 8. Estado atual

Os quatro macroescopos foram aprovados pelo PI:

- [`MVP-1-fundacao-captura-e-controle.md`](MVP-1-fundacao-captura-e-controle.md)
- [`MVP-2-fiscal-contabil-e-financeiro.md`](MVP-2-fiscal-contabil-e-financeiro.md)
- [`MVP-3-dp-portal-e-comunicacao.md`](MVP-3-dp-portal-e-comunicacao.md)
- [`MVP-4-administracao-e-evolucao.md`](MVP-4-administracao-e-evolucao.md)

O fatiamento do MVP-1 começou: F1/SPEC-001 a F13/SPEC-013 estão aprovadas. F14/SPEC-014 e F15/SPEC-015 estão reservadas pelo PI como destinos explícitos, ainda sem SPEC aprovada. As demais capacidades aguardam decomposição.

Próximo número livre: **F16 / SPEC-016**.
