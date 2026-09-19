# SPEC-031 / F31 — Inclusão da NFC-e no complemento e restituição do ICMS-ST de autopeças em Goiás

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD v3.1 §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16
>
> **Estado:** aprovada pelo PI em 19/09/2026
>
> **Tamanho:** Médio — amplia a F29 para usar NFC-e modelo 65 normalizada pela F30 na mesma competência, sem criar fórmula, fechamento ou demonstrativo paralelo
>
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #35

## 1. Objetivo

Permitir que o escritório inclua NFC-e modelo 65 autorizada e normalizada pela F30 no cálculo histórico de complemento ou restituição do ICMS-ST da F29, junto às NF-e modelo 55 da mesma empresa e competência.

A cobertura permanece limitada a autopeças vendidas internamente a consumidor final por empresa estabelecida em Goiás, nos regimes `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO`, com fato gerador entre **27/10/2016 e 28/02/2018**. NF-e e NFC-e usam a mesma regra, memória, recuperação da entrada, consolidação mensal, revisão HITL e demonstrativo.

NFC-e sem CPF ou CNPJ do destinatário é elegível quando o documento válido comprovar operação interna e consumidor final. Identidade ausente do consumidor não é convertida em erro nem inferida; os indicadores fiscais do XML permanecem obrigatórios.

## 2. Fronteira da fatia

Esta fatia entrega:

- seleção de NFC-e modelo 65 apta no conjunto documental da F29;
- suporte aos layouts `3.10` e `4.00` normalizados pela F30;
- consolidação conjunta de NF-e 55 e NFC-e 65 na mesma revisão mensal;
- aceitação de consumidor não identificado quando `idDest` e `indFinal` comprovarem a operação coberta;
- identificação e filtro do modelo documental em linhas, memória e demonstrativo;
- tratamento de autorização e cancelamento conhecido pela F30;
- invalidação determinística da revisão quando o conjunto de NFC-e mudar;
- interface final na mesma área `Fiscal → Resolução tributária`, nos temas CLARO e ESCURO;
- auditoria append-only da seleção, exclusão, cálculo, invalidação e reprocessamento.

Não entrega:

- ingestão, validação, assinatura, protocolo ou normalização de NFC-e, que pertencem à F30;
- devolução, estorno proporcional, perda, perecimento ou saída interestadual;
- eventos diferentes de autorização e cancelamento;
- novo método de recuperação da entrada, fórmula tributária ou pacote normativo;
- operações fora do segmento, UF, regimes ou período aprovados na F29;
- transmissão, escrituração, crédito apropriado, guia, lançamento contábil ou efeito financeiro;
- consulta remota à Sefaz, emissão ou interpretação jurídica por LLM.

## 3. Cobertura e elegibilidade

### 3.1 Documento de saída

Uma NFC-e participa do processamento somente quando:

- pertence ao mesmo tenant e à empresa selecionada;
- possui modelo `65`, emitente estabelecido em `GO` e layout `3.10` ou `4.00` suportado;
- está autorizada, com chave, assinatura e protocolo coerentes segundo a F30;
- não está cancelada no snapshot usado pelo processamento;
- representa operação interna (`idDest = 1`) e venda a consumidor final (`indFinal = 1`);
- possui data fiscal entre 27/10/2016 e 28/02/2018, inclusive;
- contém item material com produto, NCM, CEST, CFOP, CST ou CSOSN, unidade, quantidade e valores necessários;
- encontra regra publicada e vigente da F29 para autopeças, regime e data;
- possui entrada recuperável pelo contrato da F29.

Documento fora da janela ou de outro modelo, UF, empresa, regime ou segmento recebe `NOT_APPLICABLE`. Documento potencialmente coberto, mas sem componente material necessário, produz `INDETERMINATE` e bloqueia a competência inteira.

### 3.2 Consumidor não identificado

A ausência de CPF, CNPJ ou bloco de destinatário não bloqueia a NFC-e quando o XML autorizado declarar operação interna e consumidor final. O motor:

- não cria pessoa, documento ou identificador sintético;
- não usa nome, texto livre ou modelo documental para inferir `idDest` ou `indFinal` ausente;
- preserva a ausência no snapshot e no demonstrativo quando o campo não for exigido;
- aplica as mesmas regras materiais e contrafactuais das linhas com destinatário identificado.

`idDest` ou `indFinal` ausente, contraditório ou inválido torna a linha `INDETERMINATE`; não existe fallback por aproximação.

### 3.3 Composição da competência

NF-e 55 e NFC-e 65 compõem:

- um único `documentSetHash`;
- uma única sequência de revisões por empresa e competência;
- as mesmas atribuições de entrada e estoque;
- os mesmos totais brutos de restituição e complemento;
- um único saldo líquido, fluxo HITL e demonstrativo em rascunho.

Não existe compensação, aprovação, exportação ou status separado por modelo. O modelo é dimensão rastreável da linha, não fronteira de fechamento.

## 4. Autorização, cancelamento e conjunto documental

NFC-e cancelada antes do snapshot não participa do cálculo e permanece rastreável como excluída. O cancelamento não calcula devolução ou estorno.

Quando uma NFC-e ou cancelamento é importado pela F30:

- competência nunca processada passa a enxergar o estado documental atual;
- revisão em processamento detecta mudança no conjunto, retorna conflito e não conclui com snapshot superado;
- revisão `PENDING_REVIEW`, `APPROVED` ou `REJECTED` é marcada `STALE`;
- rascunho associado é preservado, invalidado e identificado como superado;
- o usuário precisa reprocessar a competência inteira;
- nenhuma nova revisão ou diferença tributária é criada automaticamente.

Reprocessamento congela um novo conjunto documental e aplica novamente a elegibilidade. Cancelamento posterior não altera revisão histórica imutável nem produz estorno proporcional.

## 5. Contratos de domínio

O contrato da F29 recebe a dimensão documental explícita:

```ts
type IcmsStOutputDocumentModel = "55" | "65";

type IcmsStSettlementLine = {
  outputDocumentId: string;
  outputDocumentModel: IcmsStOutputDocumentModel;
  outputItemId: string;
  productId: string;
  normalizedUnit: string;
  quantityScaled: bigint;
  recoveryOrigin: IcmsStRecoveryOrigin;
  presumedBaseCents: number;
  effectiveBaseCents: number;
  inputIcmsCents: number;
  inputIcmsStCents: number;
  effectiveIcmsCents: number;
  differenceKind: IcmsStDifferenceKind;
  restitutionCents: number;
  complementCents: number;
  ruleId: string;
  formulaVersion: string;
  sourceIds: readonly string[];
  blockingReasonCodes: readonly string[];
};
```

Os demais tipos, valores, fórmulas e estados da F29 permanecem válidos. Dinheiro usa centavos inteiros; quantidades, alíquotas e fatores usam precisão explícita. Float continua proibido.

O snapshot acrescenta modelo, layout, chave, autorização, estado de cancelamento e indicadores normalizados usados na elegibilidade. A memória identifica a origem F30 e os hashes do documento, parser e schema.

## 6. Cálculo, recuperação e demonstrativo

A NFC-e usa integralmente a ordem determinística da F29:

1. selecionar documento e item elegíveis;
2. localizar vínculo direto, EFD ou média ponderada mensal da entrada;
3. congelar quantidade, unidade, estoque e fontes;
4. determinar base e ICMS efetivos da saída;
5. comparar com o ICMS recuperável da entrada;
6. classificar `RESTITUTION`, `COMPLEMENT`, `NONE` ou `INDETERMINATE`;
7. consolidar NF-e e NFC-e na mesma competência.

A fatia não cria fórmula específica para NFC-e. Diferença documental que não altere os componentes materiais da regra não altera o cálculo.

O demonstrativo usa o campo de modelo já previsto no leiaute oficial e registra `65` nas linhas de NFC-e. Destinatário não é inventado para preencher campo inexistente ou opcional. As regras de hash, imutabilidade, rascunho sem efeito fiscal e invalidação da F29 permanecem iguais.

## 7. Autorização, isolamento e auditoria

Papéis e operações permanecem os da F29:

- `admin_escritorio` e `contador` processam, submetem, aprovam, rejeitam, exportam e consultam empresas autorizadas;
- `auxiliar` processa, consulta e submete quando autorizado, sem aprovar;
- `auditor_readonly` consulta sem mutar;
- `super-admin` global não lê dados fiscais do tenant por esse papel;
- demais papéis são negados por padrão.

Documentos, linhas, atribuições, revisões, demonstrativos e eventos possuem `tenant_id` e `empresa_id`, ficam sob RLS e respeitam a carteira ativa.

Eventos append-only registram seleção, exclusão, cálculo, conflito documental, invalidação e reprocessamento sem duplicar XML, CPF, assinatura ou conteúdo sensível em logs.

## 8. Contrato de interface

A F31 estende a tela da F29 e não cria aba ou módulo paralelo:

1. filtro de modelo com `Todos`, `NF-e 55` e `NFC-e 65`;
2. modelo e chave visíveis em cada linha;
3. mesma tabela, memória, consolidado, fila HITL e demonstrativo;
4. ausência de destinatário exibida como `Consumidor não identificado`, sem estado de erro;
5. documento cancelado identificado no histórico, sem aparecer como linha calculada no snapshot novo;
6. revisão `STALE` com motivo documental e ação explícita de reprocessar a competência inteira.

Estados obrigatórios da F29 permanecem e incluem conjunto desatualizado, conflito durante processamento e NFC-e cancelada no histórico. Estado nunca depende apenas de cor.

A interface segue `docs/telas/` como referência de conteúdo e fluxo, e `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md` como contrato. A entrega prova CLARO e ESCURO em 768, 1024 e 1440 px, teclado, foco, contraste, leitor de tela e redução de movimento. `frontend-design` preserva a direção visual aprovada e `impeccable` executa o acabamento final.

## 9. API e persistência

Os endpoints da F29 permanecem; listagens e consultas aceitam filtro opcional por modelo `55` ou `65`. Processamento e reprocessamento recebem a revisão documental esperada e incluem ambos os modelos no mesmo snapshot.

O contrato normalizado da F30 é a única fonte da NFC-e. O motor da F29 não lê XML bruto, não revalida assinatura ou protocolo e não corrige normalização.

Erros seguem `application/problem+json`. Além dos códigos da F29, os fluxos distinguem, no mínimo:

- `ICMS_ST_OUTPUT_DOCUMENT_NOT_AUTHORIZED`;
- `ICMS_ST_OUTPUT_DOCUMENT_CANCELLED`;
- `ICMS_ST_OUTPUT_INDICATOR_MISSING`;
- `ICMS_ST_DOCUMENT_SET_STALE`.

O caso de uso controla a transação. Controller apenas valida e delega. DTO não é entidade. Regras de unicidade, idempotência, concorrência, imutabilidade e append-only permanecem as da F29 e da F30.

## 10. Invariantes

| ID | Invariante |
|---|---|
| `I-1` | NF-e 55 e NFC-e 65 compõem uma única revisão e consolidação por competência |
| `I-2` | NFC-e sem destinatário pode ser elegível; `idDest` e `indFinal` não podem ser inferidos |
| `I-3` | documento sem autorização coerente ou já cancelado não entra no snapshot calculado |
| `I-4` | mudança documental invalida a revisão, mas nunca recalcula ou cria revisão automaticamente |
| `I-5` | cancelamento não apaga original nem calcula devolução ou estorno proporcional |
| `I-6` | linha material indeterminada bloqueia a competência inteira, independentemente do modelo |
| `I-7` | fórmula, recuperação da entrada e materialidade são as mesmas da F29 |
| `I-8` | dinheiro não usa float; ausência material nunca vira zero |
| `I-9` | todo dado fiscal permanece isolado por tenant, empresa, RLS e carteira |
| `I-10` | LLM não seleciona documento, regra, estoque, indicador nem valor |

## 11. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Regras | NFC-e 3.10/4.00, com e sem destinatário, restituição, complemento, igualdade e indeterminação |
| Contrafactuais | outro modelo, UF, empresa, período, regime, segmento, `idDest`, `indFinal`, autorização ou regra |
| Composição | NF-e e NFC-e no mesmo hash, revisão, média de entrada, totais brutos e saldo líquido |
| Cancelamento | antes do snapshot, durante processamento, após submissão e após aprovação |
| Banco | RLS, carteira, unicidade, idempotência, concorrência, imutabilidade e append-only |
| Exportação | modelo `65`, linhas mistas, totais, hash, consumidor não identificado e rascunho invalidado |
| Autorização | auxiliar não aprova; contador/admin aprovam; auditor só lê; super-admin global não lê tenant |
| Tela | CLARO/ESCURO, 768/1024/1440, filtros, estados, teclado, foco, contraste e leitor de tela |
| E2E | importar NFC-e na F30 → processar competência mista → aprovar → gerar rascunho → importar cancelamento → observar `STALE` → reprocessar |

Fixtures oficiais ou sintéticas rastreáveis cobrem ambos os layouts, regimes e consumidor identificado/não identificado. Ausência de ambiente ou prova real é `not_run`, nunca `pass`.

## 12. Critérios de aceite

- [ ] NFC-e modelo 65 autorizada e elegível participa da mesma competência das NF-e 55.
- [ ] Layouts 3.10 e 4.00 normalizados pela F30 são cobertos no período aprovado.
- [ ] NFC-e sem CPF/CNPJ do destinatário é aceita quando `idDest = 1` e `indFinal = 1`.
- [ ] Indicador ausente ou contraditório nunca é inferido e resulta em linha indeterminada.
- [ ] Modelo documental fica explícito na linha, memória, filtro e demonstrativo.
- [ ] Fórmula, recuperação da entrada, materialidade e HITL permanecem iguais aos da F29.
- [ ] Documento cancelado antes do snapshot não é calculado.
- [ ] Documento ou cancelamento novo invalida revisão afetada sem recalcular automaticamente.
- [ ] Totais brutos e saldo líquido consolidam NF-e e NFC-e sem fechamento separado.
- [ ] RLS, carteira, idempotência, concorrência e auditoria impedem acesso ou efeito duplicado.
- [ ] E2E prova o ciclo F30 → F31 → cancelamento → `STALE` → reprocessamento.
- [ ] Interface final prova temas, responsividade, estados e acessibilidade obrigatórios.

## 13. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Devolução e estorno proporcional | capacidade própria de eventos posteriores do MVP-2 |
| Saída interestadual | capacidade própria de ressarcimento do MVP-2 |
| Demais eventos de NFC-e | fatia própria de eventos fiscais no MVP-2 |
| Outros segmentos, UFs e regimes | fatias próprias de expansão tributária no MVP-2 |
| Transmissão e escrituração | capacidades próprias de obrigação e livros fiscais no MVP-2 |
| Crédito, guia, contabilidade e financeiro | capacidades posteriores de apuração, contabilidade e financeiro do MVP-2 |
| Produção e consulta real | gate posterior ao MVP-4 |

Nenhum complemento foi descartado. Esta fatia amplia somente o documento de saída aceito pela F29.

## 14. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Capacidade | incluir NFC-e 65 no cálculo histórico da F29 |
| Composição | NF-e 55 e NFC-e 65 na mesma competência e consolidação |
| Consumidor | aceitar NFC-e sem destinatário identificado quando os indicadores fiscais comprovarem consumidor final interno |
| Cobertura | herdar autopeças, Goiás, regimes e período da F29 |
| Fórmula | reutilizar integralmente cálculo e recuperação da entrada da F29 |
| Cancelamento | excluir do snapshot novo; alteração posterior marca revisão como `STALE` e exige reprocessamento |
| Interface | mesma tela da F29, sem aba ou fechamento separado |
| Efeito | rascunho sem transmissão ou efeito fiscal, contábil ou financeiro |

## 15. Matriz de cobertura

| Requisito | Cobertura |
|---|---|
| Identidade | extensão da F29 para NFC-e 65 normalizada pela F30 |
| Comportamento | selecionar, calcular, consolidar, revisar, invalidar e reprocessar NFC-e junto à NF-e |
| Aceite | §12, com provas por categoria no §11 |
| Invariantes | §10, incluindo composição única, fail-closed, RLS e ausência de inferência |
| Fora de escopo | §13, todos com destino explícito |
| Dúvidas resolvidas | §14, sem decisão de produto pendente |
| Contrato de UI | §8, tela final nos dois temas e estados obrigatórios |
| Rastreabilidade | PRD §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16; MVP-2; issues #33, #34 e #35 |

## 16. Referências oficiais datadas

- Secretaria da Economia de Goiás, NFC-e — Nota Fiscal do Consumidor Eletrônica, consultada em 19/09/2026;
- Secretaria da Economia de Goiás, leiautes do Demonstrativo de Apuração da Restituição ou Complementação do ICMS-ST para regime normal e Simples Nacional, consultados em 19/09/2026;
- Portal Nacional da NF-e, MOC 7.0, schemas e Notas Técnicas aplicáveis aos layouts 3.10 e 4.00, consultados em 19/09/2026;
- fontes normativas e pacote histórico aprovados na SPEC-029.

## 17. Aprovação

Capacidade, composição documental, consumidor não identificado, cobertura herdada, cancelamento, interface, provas e destinos aprovados pelo PI em 19/09/2026. A implementação deve seguir esta SPEC sem introduzir cálculo separado, identificação sintética do consumidor, evento posterior, transmissão ou efeito externo.
