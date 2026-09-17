# AGENTES-IA-AUTONOMOS.md — Análise estratégica

> **Não é contrato e não altera escopo por si** (`CLAUDE.md`).
> Qualquer adoção do que está aqui exige, nesta ordem: **ADR em [`DECISIONS.md`](DECISIONS.md) → registro em [`prd/mvp/RASTREABILIDADE.md`](prd/mvp/RASTREABILIDADE.md) → SPEC própria**.
> O que vale hoje é o PRD §10 e [`CONVENTION.md`](CONVENTION.md) §8.

**Data:** 17/09/2026

---

## 1. A tese, em uma frase

Num produto contábil, **autonomia não é o objetivo — previsibilidade é**. O valor do agente está em eliminar trabalho repetitivo de baixo risco e em *preparar* o trabalho de alto risco para um humano decidir rápido. Um agente que decide sozinho um ato com efeito jurídico não é um produto melhor: é um passivo.

Daí a política já fixada no PRD: **HITL obrigatório**, com a Ciência da Emissão como única exceção — porque ela não fixa posição sobre a operação, apenas destrava o download do XML.

---

## 2. O eixo que realmente importa: risco × volume

| Quadrante | Exemplo no ContaIA | Motor correto |
|---|---|---|
| **Alto volume, baixo risco** | classificação contábil rotineira, conciliação com contrapartida óbvia | **Regras + embeddings.** LLM aqui é desperdício de dinheiro e fonte de variância |
| Alto volume, alto risco | manifestação de documento fiscal | Regras propõem, **humano aprova** |
| Baixo volume, baixo risco | redigir alerta, resumir pendência | LLM à vontade |
| **Baixo volume, alto risco** | evento eSocial fora do prazo, apuração de período fechado | **Determinístico e bloqueante.** LLM só explica |

**O erro clássico do setor é aplicar LLM ao primeiro quadrante** porque é onde está o volume — e é exatamente onde ele custa mais e acerta menos que um classificador vetorial treinado no histórico do próprio cliente.

---

## 3. Onde a autonomia paga, hoje

1. **Ciência da Emissão automática.** Já decidido. Ganho real: o XML completo chega sem espera humana.
2. **Preparo de decisão.** O agente entrega o caso pronto: documento, histórico do emitente, risco, sugestão e fonte. O humano decide em segundos em vez de minutos. **Isso é onde está o ganho de 60–70% do tempo do contador**, não na decisão automática.
3. **Detecção, não ação.** Malha preventiva, documento faltante em D-2, divergência SPED × DF-e × extrato. Detectar é barato e reversível; agir não é.
4. **Explicação.** Traduzir rejeição do eSocial e norma fiscal em linguagem acionável — alto valor percebido, risco baixo, erro visível na hora.

---

## 4. Onde a autonomia não paga — e provavelmente nunca vai

| Tentação | Por que não |
|---|---|
| Manifestar Confirmação/Desconhecimento automaticamente | Declaração formal perante a Sefaz. Erro é irreversível e expõe o CNPJ do cliente |
| Transmitir evento eSocial sem revisão | Multa a partir de R$ 3.000 por empregado; prazo de admissão é D-1 |
| Calcular tributo com LLM | Não-determinístico por construção. Recálculo tem de reproduzir o mesmo resultado (PRD §6.5) |
| Fechar competência automaticamente | Fechamento é ato do contador responsável ([`CONVENTION.md`](CONVENTION.md) §5.4) |
| Agente que escreve e executa o próprio código | Prompt injection a partir de XML de terceiro vira execução arbitrária |

---

## 5. Prompt injection é o risco esquecido

O ContaIA processa **documento fiscal emitido por terceiros desconhecidos**. Campos livres — razão social, descrição de produto, observação — são entrada hostil que chega ao contexto do modelo.

Regras que já valem ([`CONVENTION.md`](CONVENTION.md) §8.2):

- Saída de LLM é **validada por schema** antes de qualquer uso e **nunca executada**.
- Ferramenta com **mínimo privilégio**: o agente de captura não tem função que transmita manifestação sem aprovação.
- Dado de terceiro entra no prompt **delimitado e rotulado como dado**, nunca como instrução.
- Nada de `dangerouslySetInnerHTML` com conteúdo de documento fiscal ([`FRONTEND.md`](FRONTEND.md) §18).

**O controle que realmente protege não é o prompt — é a ausência da ferramenta.** Se o agente não tem como transmitir, a injeção não transmite.

---

## 6. Custo: a arquitetura híbrida é decisão econômica, não estética

O PRD §18 estima R$ 13–20 por empresa/mês. Esse número só se sustenta porque o volume é resolvido por regras e embeddings. Três alavancas, por ordem de retorno:

1. **Não chamar o modelo.** Cache de embedding, classificação por similaridade, regra determinística.
2. **Chamar o modelo barato.** Roteador de intenção manda a maioria para o tier rápido.
3. **Chamar em lote.** Documento fiscal processado de madrugada, em lotes.

**Métrica que denuncia desvio:** custo por requisição acima de R$ 0,50 e taxa de HITL acima de 40% (PRD §17.2). A segunda é a mais importante — HITL alto significa que o agente não está preparando decisão, está empurrando trabalho.

---

## 7. Agentes autônomos multi-etapa — o que observar antes de adotar

A Fase 4 prevê multi-agente colaborativo (Captura → Classificador → Conciliador). Antes de qualquer ADR nesse sentido, três condições:

1. **Cada agente individual dentro da meta** de acurácia, latência, custo e taxa de HITL por três meses seguidos (PRD §17.2).
2. **Trilha que permita reconstruir a cadeia inteira** — qual agente propôs o quê, com qual entrada, e onde o humano entrou. Cadeia sem trilha é impossível de auditar e, num produto fiscal, inauditável é inaceitável.
3. **Ponto de parada explícito.** Uma cadeia que se auto-realimenta sem teto de passos, de custo e de tempo é incidente esperando acontecer.

---

## 8. Regulação

O PL 2338/2023 e o debate regulatório brasileiro apontam para transparência, direito de revisão humana e avaliação de impacto em uso de alto risco. **A arquitetura já escolhida — HITL obrigatório, trilha imutável, fonte citada, revisão humana registrada — é a posição defensável.** Autonomia ampliada andaria contra a direção regulatória enquanto ela se firma.

Qualquer afirmação jurídica concreta sobre o tema **é do PI, não do Cowork nem do Code** (`CLAUDE.md`).

---

## 9. Conclusão operacional

O caminho de valor não é "mais autônomo". É:

**preparar melhor a decisão → medir onde o humano concorda → automatizar só o que for de baixo risco, reversível e medido.**

Nada aqui altera o escopo. Adoção passa por ADR, rastreabilidade e SPEC.

---

## Referências

- `prd/PRD.md` §§2, 10, 17, 18, 19 · `prd/histórico/Stack_Agentes_IA_ContaIA.md` (histórico, não contrato)
- [`CONVENTION.md`](CONVENTION.md) §8 · [`ARCHITECTURE.md`](ARCHITECTURE.md) §10 · [`DECISIONS.md`](DECISIONS.md)
