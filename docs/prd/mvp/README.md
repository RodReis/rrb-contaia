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
- [ ] os aprendizados foram consolidados em [`../../APRENDIZADOS.md`](../../APRENDIZADOS.md) — rotina e comando na seção "Rotina de consolidação" do próprio arquivo;
- [ ] [`../../STATUS.md`](../../STATUS.md) e [`../../DEVELOPMENT.md`](../../DEVELOPMENT.md) refletem o estado real.
- [ ] todas as fatias com UI comprovaram fidelidade, os dois temas e acabamento pelo protocolo de [`../../FRONTEND.md`](../../FRONTEND.md) §20.1 — dívida visual não é empurrada para o MVP seguinte.

---

## 8. Estado atual

Os quatro macroescopos foram aprovados pelo PI:

- [`MVP-1-fundacao-captura-e-controle.md`](MVP-1-fundacao-captura-e-controle.md)
- [`MVP-2-fiscal-contabil-e-financeiro.md`](MVP-2-fiscal-contabil-e-financeiro.md)
- [`MVP-3-dp-portal-e-comunicacao.md`](MVP-3-dp-portal-e-comunicacao.md)
- [`MVP-4-administracao-e-evolucao.md`](MVP-4-administracao-e-evolucao.md)

**Histórico consolidado até F69/SPEC-069:**

O MVP-1 possui F1/SPEC-001 a F25/SPEC-025 aprovadas. O MVP-2 possui F26/SPEC-026 a F77/SPEC-077 aprovadas. A F49/SPEC-049 é uma exceção `Enorme` pontual, expressamente aprovada pelo PI em 25/09/2026 para manter as cinco formas da ECD e seus pré-requisitos no mesmo contrato. A F50/SPEC-050 é uma segunda exceção `Enorme`, expressamente aprovada pelo PI na mesma data para reunir a ECF original e retificadora, os blocos aplicáveis, recuperação da ECD, e-Lalur/e-Lacs, revisão e artefatos no mesmo contrato. A F51/SPEC-051 é uma terceira exceção `Enorme`, expressamente aprovada pelo PI na mesma data para reunir livros de entradas, saídas e apurações com fechamento e reabertura fiscal. A F52/SPEC-052 é uma quarta exceção `Enorme`, expressamente aprovada pelo PI na mesma data para reunir enquadramento evidenciado, blocos aplicáveis completos, arquivo original e retificador, parser independente, revisão segregada e artefatos da EFD ICMS/IPI. A F53/SPEC-053 é uma quinta exceção `Enorme`, expressamente aprovada pelo PI na mesma data para reunir EFD-Contribuições completa, consolidação na matriz, original, retificadora, parser independente, revisão segregada e CPRB coberta. A F54/SPEC-054 é uma sexta exceção `Enorme`, expressamente aprovada pelo PI na mesma data para reunir motor contínuo de estoque, custo médio móvel e PEPS, inventário físico e Bloco H. As exceções valem somente para essas fatias e não alteram a régua geral de decomposição. A F55/SPEC-055 retoma a régua normal como fatia `Médio`, cobrindo apenas os leiautes restrito aos saldos e simplificado do Bloco K. A F56/SPEC-056 é `Grande`, cobrindo verticalmente produção própria e consumo do leiaute completo. A F57/SPEC-057 é `Médio`, cobrindo desmontagem e movimentação interna. A F58/SPEC-058 é `Grande`, cobre industrialização efetuada por terceiros com prova documental, reconciliação e correções das próprias origens. A F59/SPEC-059 é `Grande`, cobre reprocessamento e reparo no próprio estabelecimento, operações abertas entre competências e correções das próprias origens. A F60/SPEC-060 é `Médio`, cobre em revisão própria as correções de origem 3 e 5 dos apontamentos F57. A F61/SPEC-061 é `Médio`, cobre produção conjunta no próprio estabelecimento. A F62/SPEC-062 é `Médio`, cobre produção conjunta efetuada por terceiros com participante, NF-e modelo 55 e reconciliação de estoque obrigatórios. A F63/SPEC-063 é `Médio`, amplia a agenda F22 com catálogo oficial curado, calendário e exigibilidade para Simples Nacional e Lucro Presumido nas saídas já especificadas pelas F36 a F53. A F64/SPEC-064 é `Médio`, calcula penalidades e juros incorridos ou projetados para o mesmo catálogo e classifica prioridade fixa por prazo. A F65/SPEC-065 é `Médio`, acrescenta dependências rígidas, mapeamento temporal explícito e bloqueio da baixa/conclusão até todas as predecessoras estarem entregues ou não exigíveis. A F66/SPEC-066 é `Grande`, entrega grafo N:N de sucessão tributária, coexistência temporal, simulação e reavaliação no cronograma de 2026 a 2033, mantendo destinos sem implementação em `SEM_CAPACIDADE`. A F67/SPEC-067 é `Grande`, entrega malha preventiva contínua com EFD ICMS/IPI, EFD-Contribuições, DF-e e extrato local CSV/OFX, vínculo bancário determinístico restrito, casos versionados e gate do fechamento fiscal. A F68/SPEC-068 é `Grande`, entrega o núcleo de contas a pagar e receber com origens internas, parcelamento explícito, baixa manual total ou parcial e correção por eventos reversíveis. A F69/SPEC-069 é `Grande`, importa boleto de cobrança e arrecadação por PDF textual ou linha digitável, preserva a evidência e integra à F68 por vínculo ou proposta revisável. As demais capacidades aguardam decomposição.

**Atualização corrente:** o MVP-2 possui F26/SPEC-026 a F77/SPEC-077 aprovadas. A F71/SPEC-071 é `Grande`, estende a cobrança do Banco do Brasil em CNAB 240/400 com alteração de vencimento, desconto, protesto, sustação e baixa de registro, uma instrução em voo e atualização exclusiva do estado bancário observado; pagamentos com código de barras são tratados pela F72 e a validação inicial de folha é tratada pela F76, com complementos próprios do MVP-2. A F72/SPEC-072 é `Grande` e entrega pagamentos locais BB CNAB 240 de boletos, tributos e convênios com código de barras, vinculados à F68/F69, com remessa, retorno e proposta de baixa revisável; não há transmissão nem baixa automática.

Próximo número livre: **F78 / SPEC-078**.

A F73/SPEC-073 é `Grande`: F73/SPEC-073 entrega manutenção local de pagamentos BB CNAB 240 originados F72, com alteração de data e valor revalidado F68/F69, cancelamento confirmado, cobertura por operação, aprovação segregada e proposta revisável de estorno vinculada à baixa F68; nova tentativa exige resolução financeira ou ausência comprovada de baixa; operação sem cobertura fica bloqueada e rastreada, sem cancelamento/reinclusão automático. A publicação oficial inicial não comprova todas as operações J/O; complementos de manutenção por modalidade permanecem nominalmente no MVP-2 até evidência oficial e fixtures aprovadas. A F74/SPEC-074 é `Grande` e cobre DARF comum, DARF Simples e GPS sem código de barras em remessa/retorno locais BB CNAB 240, com guia externa validada, parcela F68 publicada, bloqueio de vencidos, cobertura técnica por modalidade e proposta revisável de baixa somente após efetivação.

A F75/SPEC-075 é Grande: validação específica de DARF numerado DCTFWeb/SicalcWeb emitido externamente, conferência documental, vínculo único F68/F69 e integração F72 sem duplicar o ciclo bancário. Canal segmento O depende de cobertura específica; sem evidência fica INDETERMINATE. Emissão/consulta RFB, canal sem código, rateio entre parcelas, OCR e atualização permanecem em capacidades próprias do MVP-2.

A F76/SPEC-076 é `Grande`: F76/SPEC-076 entrega validação local de folha mensal líquida externa CSV/JSON contra remessa BB CNAB 240 de crédito em conta corrente BB, por empresa/competência, com comparação individual exata por CPF, destino, valor e data, líquido zero sem pagamento e retornos com histórico/divergências; somente relatório, sem cálculo de folha, geração/transmissão, pagamento ou efeito F68. Conta poupança BB passa à F77/SPEC-077 com referência v2 e tipo de conta explícito; demais modalidades/tipos, pagamentos divididos, arquivos mistos e integrações permanecem em complementos próprios do MVP-2; RF-05/cálculo de folha permanece no MVP-3.

A F77/SPEC-077 é `Grande`: amplia a conferência de folha mensal BB CNAB 240 para crédito em poupança, com referência CSV/JSON v2 e `accountType` explícito; v1 permanece válida para conta corrente e cada conferência usa uma modalidade. Preserva comparação individual exata, retornos e histórico sem efeito financeiro. Conta salário, outros bancos, arquivos mistos, pagamentos divididos e demais tipos continuam em complementos próprios do MVP-2.
