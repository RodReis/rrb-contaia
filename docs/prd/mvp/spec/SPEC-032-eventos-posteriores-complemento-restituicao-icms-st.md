# SPEC-032 / F32 — Eventos posteriores no complemento e restituição do ICMS-ST

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD v3.1 §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16
>
> **Estado:** aprovada pelo PI em 19/09/2026
>
> **Tamanho:** Grande e delimitada — trata cancelamento autorizado posterior e devolução integral ou parcial das saídas já calculadas pelas F29/F31, sem transmissão, escrituração, apropriação, guia ou efeito financeiro
>
> **Ambiente:** Docker local; documentos reais necessários estão autorizados localmente; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #36

## 1. Objetivo

Permitir que o escritório trate eventos posteriores que alterem uma venda de autopeça já incluída no complemento ou na restituição histórica do ICMS-ST das F29/F31, preservando o cálculo original e produzindo uma nova revisão auditável.

A fatia cobre cancelamento autorizado e devolução integral ou parcial. Cancelamento corrige a competência da saída original; devolução estorna, na competência em que ocorreu, a restituição ou o complemento reconhecido para a quantidade devolvida. Nenhum evento edita, apaga ou recalcula silenciosamente revisão anterior.

A cobertura permanece limitada às saídas originais de autopeças em operações internas a consumidor final em Goiás, nos regimes `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO`, documentadas por NF-e modelo 55 ou NFC-e modelo 65 e com fato gerador entre **27/10/2016 e 28/02/2018**.

## 2. Fronteira da fatia

Esta fatia entrega:

- consumo de cancelamento autorizado já validado e vinculado ao documento original;
- registro de devolução integral ou parcial por NF-e normalizada, EFD ou evidência manual controlada;
- vínculo determinístico entre devolução, item e saída original;
- proporcionalização por quantidade devolvida, após conversão de unidade auditável;
- estorno do complemento ou da restituição reconhecidos na linha original;
- revisão imutável na competência adequada a cada tipo de evento;
- invalidação de revisão e rascunho afetados, sem reprocessamento automático;
- extensão do demonstrativo das F29/F31 com linha de estorno equivalente ao registro `C002` dos leiautes oficiais de Goiás;
- interface final na mesma área `Fiscal → Resolução tributária`, nos temas CLARO e ESCURO;
- auditoria append-only da evidência, vínculo, decisão, invalidação, estorno e reprocessamento.

Não entrega:

- emissão, autorização, cancelamento ou consulta remota de documento fiscal;
- devolução sem documento ou evidência verificável;
- digitação manual de imposto, base, alíquota, restituição, complemento ou valor de estorno;
- perda, perecimento, roubo, saída interestadual ou ressarcimento;
- pauta, PMPF ou preço sugerido sem pacote normativo próprio;
- operação fora do segmento, UF, regimes, modelos ou período aprovados;
- transmissão de demonstrativo ou EFD, escrituração, crédito apropriado, guia, lançamento contábil, título ou pagamento;
- interpretação jurídica ou cálculo por LLM;
- produção ou piloto real.

## 3. Eventos cobertos

### 3.1 Cancelamento autorizado posterior

O cancelamento precisa vir de evento fiscal oficial, validado e vinculado ao documento autorizado conforme os contratos da F18 ou F30. Digitação, PDF, DANFE, imagem ou declaração do usuário não cancelam documento.

Quando o cancelamento já existir antes do snapshot, a saída não participa do cálculo. Quando chegar durante ou depois do processamento:

- revisão em processamento detecta conflito de conjunto e não conclui;
- revisão `PENDING_REVIEW`, `APPROVED` ou `REJECTED` passa a `STALE`;
- rascunho associado é preservado e invalidado;
- o usuário reprocessa explicitamente a competência da saída original;
- a nova revisão exclui integralmente a saída cancelada;
- revisão e memória anteriores permanecem imutáveis.

Cancelamento não gera linha `C002`: ele retira a saída do novo snapshot da competência original. Se a competência original estiver fechada por capacidade posterior, esta fatia não a reabre automaticamente e retorna bloqueio estável para o fluxo próprio de reabertura.

### 3.2 Devolução integral ou parcial

A devolução representa entrada posterior vinculada a uma saída originalmente calculada. São aceitas três origens:

1. NF-e de devolução normalizada e preservada pelo repositório fiscal;
2. registro EFD importado com identidade suficiente do documento, item, quantidade e saída original;
3. evidência manual estruturada, com documento comprobatório anexado.

A evidência manual permite informar somente:

- chave, número, modelo, série, data e CFOP do documento de devolução;
- chave da saída original;
- item, produto, unidade e quantidade devolvida;
- data de entrada/escrituração quando comprovada;
- anexo, observação factual e vínculo proposto.

O usuário não informa nenhum valor tributário. O motor recupera restituição, complemento, regra, unidade e quantidade da linha original aprovada. Campo manual que tente substituir esses valores é rejeitado.

### 3.3 Competência do efeito

Cada evento segue regra própria:

- cancelamento produz nova revisão da competência da saída original;
- devolução produz estorno na competência civil em que a devolução ocorreu, com referência imutável à saída, linha e revisão originais;
- evento não desloca efeito por data de upload ou processamento;
- mudança de data comprovada cria evidência nova e não altera registro aceito.

A competência da devolução pode ser posterior a 28/02/2018. O limite temporal se aplica à saída original coberta pela F29/F31; não autoriza incluir uma saída original fora daquela janela.

## 4. Vínculo e proporcionalização

### 4.1 Vínculo determinístico

O vínculo direto exige identidade da saída original e correspondência inequívoca do item. A ordem de resolução é:

1. chave da saída e número do item explicitamente referenciados;
2. chave da saída, código de produto e combinação única de NCM/CEST/unidade;
3. proposta manual submetida com documento anexo e aprovação humana.

Não existe vínculo por descrição aproximada, valor parecido, proximidade de data ou LLM. Ausência, multiplicidade ou contradição produz `INDETERMINATE`.

Uma devolução não pode consumir quantidade superior ao saldo devolvível da linha original. Devoluções anteriores aceitas reduzem esse saldo. Concorrência sobre o mesmo saldo é serializada e uma das tentativas retorna conflito de versão.

### 4.2 Conversão de unidade

A quantidade devolvida é convertida para a unidade congelada na linha original. A conversão precisa ser exata e vir de relação versionada já aprovada ou de fator comprovado no documento. Unidade incompatível, fator ausente ou conversão ambígua resulta em `INDETERMINATE`.

Quantidade usa decimal exato ou inteiro escalado. Float é proibido. A memória preserva quantidade original, devolvida, previamente estornada, saldo, fator, escala e regra de arredondamento.

### 4.3 Estorno proporcional

Para a linha original determinada:

```text
proporcao = quantidade_devolvida_normalizada / quantidade_original_normalizada
estorno_restituicao = restituição_original × proporcao
estorno_complemento = complemento_original × proporcao
```

O arredondamento monetário ocorre somente no resultado final de cada componente, pela mesma regra versionada da F29. Devolução integral estorna exatamente o valor original ainda não estornado; a última devolução parcial absorve eventual resíduo de arredondamento para que a soma nunca exceda nem fique abaixo do total original.

- linha `RESTITUTION` gera estorno da restituição;
- linha `COMPLEMENT` gera estorno do complemento;
- linha `NONE` gera valores zero e permanece rastreável;
- linha `INDETERMINATE`, revisão inexistente, superada ou sem memória material não recebe valor inferido.

Restituição e complemento estornados permanecem em campos separados. O saldo líquido da competência é derivado depois dos totais brutos; um não sobrescreve o outro.

## 5. Revisões, aprovação e demonstrativo

Cada evento aceito cria efeito em uma nova revisão da competência correspondente. Revisão, evidência e decisão anteriores permanecem append-only.

Fluxo da devolução:

1. registrar e validar a evidência;
2. resolver ou submeter o vínculo;
3. congelar a linha original e o saldo devolvível;
4. calcular o estorno determinístico;
5. compor nova revisão da competência do evento;
6. submeter à mesma alçada HITL da F29;
7. aprovar ou rejeitar com motivo;
8. gerar novo rascunho de demonstrativo, sem efeito externo.

O demonstrativo acrescenta linha de estorno compatível com o registro `C002`, contendo competência, documento de devolução, item, quantidade, saída original e valores de restituição/complemento estornados. Fonte, hash, versão do cálculo e relação causal acompanham o artefato.

Nova evidência que afete revisão já submetida ou aprovada a marca como `STALE`; o sistema nunca recalcula, aprova ou substitui o rascunho automaticamente.

## 6. Contratos de domínio

Os nomes são referência funcional; o Code pode ajustá-los sem alterar o contrato:

```ts
type IcmsStSubsequentEventKind = "AUTHORIZED_CANCELLATION" | "RETURN";
type IcmsStReturnEvidenceOrigin = "NORMALIZED_NFE" | "EFD" | "MANUAL_DOCUMENT";

type IcmsStReturnEvidence = {
  eventId: string;
  origin: IcmsStReturnEvidenceOrigin;
  returnDocumentId: string;
  returnItemId: string;
  originalOutputDocumentId: string;
  originalOutputItemId: string;
  eventDate: string;
  normalizedUnit: string;
  returnedQuantityScaled: bigint;
  evidenceHash: string;
};

type IcmsStReversalLine = {
  eventId: string;
  originalSettlementRevisionId: string;
  originalSettlementLineId: string;
  returnedQuantityScaled: bigint;
  reversedRestitutionCents: number;
  reversedComplementCents: number;
  formulaVersion: string;
  sourceIds: readonly string[];
  blockingReasonCodes: readonly string[];
};
```

Erros seguem `application/problem+json`. Os fluxos distinguem, no mínimo:

- `ICMS_ST_EVENT_EVIDENCE_INVALID`;
- `ICMS_ST_EVENT_LINK_NOT_FOUND`;
- `ICMS_ST_EVENT_LINK_AMBIGUOUS`;
- `ICMS_ST_RETURN_QUANTITY_EXCEEDED`;
- `ICMS_ST_RETURN_UNIT_INCOMPATIBLE`;
- `ICMS_ST_ORIGINAL_CALCULATION_UNAVAILABLE`;
- `ICMS_ST_REVISION_STALE`;
- `ICMS_ST_CLOSED_PERIOD_REOPENING_REQUIRED`.

Idempotência considera tenant, empresa, tipo do evento, identidade fiscal, item e hash da evidência. Mesmo evento e mesmo conteúdo reutilizam o resultado; mesma identidade com conteúdo divergente produz conflito.

## 7. Autorização, isolamento e auditoria

- `admin_escritorio` e `contador` registram, corrigem por nova evidência, submetem, aprovam, rejeitam, reprocessam e exportam empresas autorizadas;
- `auxiliar` registra, consulta e submete quando autorizado, sem aprovar;
- `auditor_readonly` consulta evidência, memória, revisão, decisão e demonstrativo sem mutar;
- `super-admin` global não lê dados fiscais do tenant por esse papel;
- demais papéis são negados por padrão.

Evidências, anexos, vínculos, saldos, revisões, linhas, decisões e demonstrativos possuem `tenant_id` e `empresa_id`, ficam sob RLS e respeitam carteira ativa. Anexo usa storage privado, hash e autorização na leitura.

Auditoria append-only registra criação, validação, proposta, aprovação de vínculo, rejeição, conflito, cálculo, invalidação, reprocessamento, aprovação e download. Logs e métricas não contêm XML integral, documento anexado, CPF/CNPJ ou conteúdo fiscal sensível.

## 8. Contrato de interface

A F32 compõe a tela da F29/F31, sem módulo ou fechamento paralelo:

1. histórico de cancelamentos e devoluções por competência;
2. ação `Registrar devolução` com origem XML, EFD ou documento manual;
3. formulário manual limitado a vínculo, item, quantidade, datas e anexo;
4. comparação entre saída original, quantidade devolvida, saldo e estorno calculado;
5. identificação explícita de devolução integral ou parcial;
6. memória causal navegável até documento, linha e revisão originais;
7. revisão `STALE` com motivo e ação explícita de reprocessar;
8. linha de estorno e totais brutos no demonstrativo;
9. mensagens acionáveis para vínculo ausente, ambíguo, quantidade excedida, unidade incompatível e período fechado.

Estados obrigatórios: vazio, carregando, evidência selecionada, validação, vínculo encontrado, vínculo pendente de aprovação, indeterminado, conflito, calculado, submetido, aprovado, rejeitado, revisão desatualizada, falha recuperável e falha terminal. Estado nunca depende apenas de cor.

A referência de conteúdo, fluxo, hierarquia e densidade é `docs/telas/contaia_apura_o_fiscal_tribut_ria_reforma_ibs_cbs_rf_03/`. Aparência, componentes, estados, acessibilidade e correções seguem `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md`.

A implementação usa `frontend-design` antes e durante a construção e `impeccable` no acabamento. A PR prova comparação com o protótipo, CLARO/ESCURO, 768/1024/1440 px, teclado, foco, contraste, leitor de tela e redução de movimento conforme `FRONTEND.md` §20.1.

## 9. Invariantes globais tocados

Aplicação concreta dos códigos globais de `docs/CONVENTION.md`:

| Código | Aplicação nesta fatia |
|---|---|
| `I-1` | tabelas de evento, vínculo, evidência, revisão e saída demonstrativa possuem `tenant_id` e `empresa_id`, `NOT NULL`, índices e RLS |
| `I-2` | leitura, simulação, aprovação e exportação sem contexto de tenant não retornam dados nem executam comando |
| `I-3` | valores de complemento, restituição e estorno usam centavos inteiros; quantidade, fator e proporção possuem precisão declarada, sem float para dinheiro |
| `I-4` | vínculo fiscal, proporção e valor são calculados pelo motor de regras versionado; LLM não calcula, não vincula e não interpreta evidência para alterar resultado |
| `I-5` | aprovação humana registrada é exigida antes de qualquer ação com efeito fiscal; nesta fatia a aprovação gera somente rascunho interno, sem transmissão externa |
| `I-6` | trilha de ingestão, vínculo, cálculo, aprovação e revisão é append-only, sem `UPDATE` ou `DELETE` |
| `I-7` | evento, evidência, vínculo, cálculo e revisão não são apagados; correção gera nova versão ou arquivamento, preservando histórico |
| `I-8` | regra tributária da venda original usa a data do fato original; regra do evento usa a data do cancelamento ou devolução, nunca a data de processamento |
| `I-9` | a geração interna é reentrante; se etapa futura publicar efeito externo, ela deverá usar chave idempotente por evento/vínculo/competência |
| `I-10` | F32 não manipula chave privada de certificado; validação/autorização fiscal permanece nos fluxos de documento e signer já definidos |
| `I-11` | competências e datas civis de saída, cancelamento e devolução não têm fuso; data/hora de processamento é armazenada em UTC e exibida em `America/Sao_Paulo` |
| `I-12` | reprocessamento de período fechado com o mesmo snapshot, evidências e versões reproduz o mesmo resultado, sem reabrir competência automaticamente |

## 10. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Regras | cancelamento, devolução integral, parcial única, parciais sucessivas, resíduo final e linha `NONE` |
| Origens | NF-e normalizada, EFD e documento manual produzem o mesmo resultado para o mesmo fato |
| Contrafactuais | valor fiscal manual, vínculo ausente/múltiplo, quantidade excedida, unidade incompatível, saída fora do recorte e revisão original indisponível |
| Competência | cancelamento revisa o mês original; devolução afeta o mês do evento; data de upload não altera competência |
| Banco | RLS, carteira, idempotência, saldo concorrente, imutabilidade, anexos privados e append-only |
| Fechamento | nova evidência marca revisão e rascunho como `STALE`; período fechado exige fluxo próprio de reabertura |
| Exportação | linha `C002`, integral/parcial, NF-e/NFC-e originais, totais brutos, saldo, hash e rejeição de artefato parcial |
| Autorização | auxiliar não aprova; contador/admin aprovam; auditor só lê; super-admin global não lê tenant |
| Tela | CLARO/ESCURO, 768/1024/1440, estados, teclado, foco, contraste, leitor de tela e movimento reduzido |
| E2E | aprovar F29/F31 → registrar devolução → validar vínculo → calcular → aprovar → gerar rascunho; importar cancelamento → observar `STALE` → reprocessar competência original |

Fixtures oficiais ou sintéticas rastreáveis cobrem os dois regimes, NF-e e NFC-e como saída original, devolução integral/parcial, cancelamento e falhas materiais. Ausência de integração ou prova real é `not_run`, nunca `pass`.

## 11. Critérios de aceite

- [ ] Cancelamento oficial posterior invalida a revisão e exige reprocessamento explícito da competência original.
- [ ] Reprocessamento por cancelamento exclui integralmente a saída sem editar ou apagar revisão anterior.
- [ ] Devoluções integrais e parciais são aceitas por NF-e normalizada, EFD ou evidência manual controlada.
- [ ] Evidência manual não aceita nenhum valor tributário e exige documento anexado.
- [ ] Vínculo e conversão de unidade são determinísticos; ausência ou ambiguidade resulta em `INDETERMINATE`.
- [ ] Quantidade devolvida acumulada nunca excede a quantidade original e concorrência não duplica estorno.
- [ ] Estorno proporcional reutiliza valores da linha original e preserva restituição/complemento separados.
- [ ] Cancelamento afeta a competência original; devolução afeta a competência do evento.
- [ ] Demonstrativo inclui linha de estorno equivalente ao `C002`, memória, fontes e hash reproduzíveis.
- [ ] Revisão e rascunho afetados ficam `STALE`; não existe recálculo, aprovação ou transmissão automática.
- [ ] RLS, carteira, idempotência, imutabilidade e auditoria impedem acesso ou efeito duplicado.
- [ ] Testes de regras, banco, tela e E2E publicam evidência vinculada à SPEC-032 e à issue #36.
- [ ] Interface final prova ambos os temas, responsividade, estados e acessibilidade exigidos.

## 12. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Saída interestadual | capacidade própria de ressarcimento do MVP-2 |
| Perda, perecimento, roubo e demais eventos sem devolução | fatias próprias de eventos fiscais do MVP-2, condicionadas a fonte e recorte oficiais |
| Pauta, PMPF e preço sugerido | fatia própria quando houver segmento e fonte oficial aplicáveis |
| Outros segmentos, UFs, regimes, documentos e períodos de saída | fatias próprias de expansão tributária do MVP-2 |
| Transmissão do demonstrativo e escrituração EFD | capacidades próprias de obrigações e livros fiscais do MVP-2 |
| Apropriação de crédito, guia, contabilidade e financeiro | capacidades posteriores de apuração, contabilidade e financeiro do MVP-2 |
| Reabertura de competência fiscal fechada | fatia própria de fechamento, estorno e reabertura auditada do MVP-2 |
| Produção, consulta oficial e piloto real | gate posterior ao MVP-4 |

Nenhum complemento foi descartado. A F32 encerra somente devolução e cancelamento na cadeia histórica das F29/F31.

## 13. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Capacidade | eventos posteriores da F29/F31 |
| Eventos | cancelamento autorizado e devolução integral ou parcial na mesma fatia |
| Evidências | NF-e normalizada, EFD e evidência manual estruturada |
| Limite manual | vínculo, item, quantidade, datas e documento; nenhum valor tributário |
| Competência | cancelamento corrige a competência original; devolução estorna na competência do evento |
| Cobertura | herdar autopeças, Goiás, regimes, documentos e período da saída original das F29/F31 |
| Cálculo | proporção determinística sobre os valores da linha original, sem LLM ou edição humana |
| Interface | compõe Resolução tributária, sem módulo ou fechamento paralelo |
| Efeito | rascunho sem transmissão ou efeito fiscal, contábil ou financeiro |

**Questões abertas:** nenhuma.

## 14. Gate dos oito itens obrigatórios

| Verificação | Evidência nesta SPEC |
|---|---|
| Identidade | cabeçalho, MVP-2, F32/SPEC-032 e origem no PRD |
| Comportamento | §§1–5, observável por cancelamento, devolução, revisão e demonstrativo |
| Aceite | §11, ligado às provas do §10 |
| Invariantes | §9, com códigos de `CONVENTION.md` §2 e aplicação concreta |
| Fora de escopo | §12, com destino explícito para todo complemento |
| Dúvidas | §13; nenhuma aberta |
| Complementos | §12; nenhum requisito descartado |
| UI | §8, com caminho concreto, estados, temas, viewports, provas e skills obrigatórias |

## 15. Referências oficiais datadas

- Secretaria da Economia de Goiás, leiautes do Demonstrativo de Apuração da Restituição ou Complementação do ICMS-ST para regime normal e Simples Nacional, especialmente registro `C002`, consultados em 19/09/2026;
- Guia Prático da EFD ICMS/IPI, versão 3.1.8, registros de devolução e estorno de restituição/complemento, consultado em 19/09/2026;
- Decreto nº 4.852/1997 — RCTE, Anexo VIII, no texto aplicável ao fato gerador;
- fontes normativas e pacote histórico aprovados nas SPEC-029 a SPEC-031.

## 16. Aprovação

Capacidade, eventos, evidências, limite manual, competência, cobertura, cálculo, interface, provas e destinos aprovados pelo PI em 19/09/2026. A implementação deve seguir esta SPEC sem aceitar valor tributário manual, vínculo aproximado, recálculo silencioso, transmissão ou efeito externo.
