# SPEC-034 / F34 — Acréscimos legais da reconstrução histórica do ICMS-ST em Goiás

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Issue:** #38
> **Estado:** aprovada pelo PI em 19/09/2026
> **Origem:** PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16; F33/SPEC-033

## 1. Objetivo

Aplicar acréscimos legais à reconstrução histórica do principal de ICMS-ST de autopeças em Goiás produzida e aprovada pela F33, mantendo separadas as trilhas de restituição e complemento e preservando prova causal até cada regra, índice, vigência e ato formal utilizado.

A fatia remove somente o bloqueio por acréscimos legais quando todos os componentes forem determináveis. O resultado continua sendo rascunho interno para revisão humana, sem efeito fiscal, contábil ou financeiro externo.

## 2. Recorte obrigatório

A F34 herda integralmente o recorte da F33:

- empresas autorizadas do tenant ativo;
- autopeças sujeitas a ICMS-ST em Goiás;
- saídas internas a consumidor final;
- documentos NF-e modelo 55 e NFC-e modelo 65;
- fatos originais entre 27/10/2016 e 28/02/2018;
- regimes `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO`;
- pacote F33 aprovado, íntegro, não superado e com memória causal completa;
- cálculo até uma data civil de referência explicitamente informada pelo usuário.

Não recalcula o principal das F29/F31/F32/F33 e não aceita principal manual, estimado ou extraído de PDF, DANFE ou LLM.

## 3. Entrega e limites

Entrega:

- seleção de pacote F33 elegível e data de referência;
- juros e atualização monetária separados para restituição e complemento quando a regra aprovada determinar;
- multa de mora aplicável ao complemento;
- penalidade por infração somente quando sustentada por ato formal importado;
- linha do tempo legal por intervalo de vigência;
- memória mensal de principal, base, taxa, índice, fórmula, arredondamento e fundamento;
- pacote PDF, CSV e JSON com hash reproduzível;
- interface final em `Fiscal -> Resolução tributária`, nos temas CLARO e ESCURO;
- auditoria append-only da importação, aprovação, cálculo, revisão, exportação, reprodução, invalidação e superação.

Não entrega:

- novo cálculo do principal ou alteração de revisão F33;
- inferência automática de infração, autuação ou penalidade;
- taxa, índice, faixa, fundamento ou valor legal digitado manualmente;
- consulta normativa ao vivo durante o cálculo;
- escrituração definitiva, apropriação, compensação, transferência ou pedido de restituição;
- DAS, DARE, guia, transmissão, protocolo, retificação ou pagamento;
- lançamento contábil, partida dobrada, título financeiro ou baixa;
- outro segmento, UF, regime, documento, operação ou período original;
- interpretação jurídica ou cálculo por LLM;
- produção ou piloto real.

## 4. Fontes elegíveis

### 4.1 Pacote de principal

O cálculo aceita somente pacote da F33 que esteja:

- `READY_FOR_INTERNAL_REVIEW` ou `BLOCKED_BY_LEGAL_ACCRUALS`;
- aprovado internamente;
- não superado;
- com hash canônico válido;
- vinculado ao tenant, empresa e regime do pedido;
- composto apenas por revisões aprovadas das F29/F31/F32;
- acompanhado da memória por competência exigida pela F33.

Pacote parcial, desatualizado, rejeitado, sem memória ou com hash divergente não entra no cálculo.

### 4.2 Pacote normativo

Taxas, índices, faixas, fórmulas, termos iniciais, limites e regras de arredondamento entram exclusivamente por pacote normativo oficial versionado, imutável e aprovado por humano.

Cada item contém, no mínimo:

- identificador e versão;
- tipo de componente legal;
- início e fim de vigência;
- fundamento oficial e data de consulta;
- fórmula, taxa, índice ou tabela aplicável;
- precisão e regra de arredondamento;
- hash da fonte e do conteúdo canônico;
- autor da importação, aprovador e datas UTC.

Consulta online pode apoiar a curadoria do pacote, mas nunca ocorre no cálculo. Pacote pendente, rejeitado, superado, com lacuna ou sobreposição conflitante produz `INDETERMINATE`.

### 4.3 Ato formal para penalidade

Penalidade por infração só pode ser calculada a partir de auto de infração, intimação, decisão ou outro ato formal importado, íntegro e aprovado. O ato deve fornecer ou sustentar:

- órgão emissor, número, tipo e data;
- empresa e período alcançado;
- tipificação e fundamento;
- base, percentual, valor mínimo, redução e marcos processuais aplicáveis;
- arquivo privado, hash e vínculo com o pacote F33.

Ausência, ilegibilidade, conflito ou cobertura parcial do ato não equivale a penalidade zero: o componente e o resultado global ficam `INDETERMINATE`.

## 5. Política temporal e cálculo

### 5.1 Data de referência

O usuário informa `data_referencia`, sem horário. Ela não pode anteceder o primeiro termo inicial aplicável nem ultrapassar a última data coberta pelos pacotes normativos aprovados.

A data de geração não substitui a data de referência. Repetir o pedido com as mesmas entradas produz o mesmo resultado, mesmo em outro dia.

### 5.2 Linha do tempo legal

O motor divide o intervalo entre termo inicial e data de referência em trechos contíguos. Cada trecho usa somente a regra vigente naquele intervalo. Mudança normativa não é aplicada retroativamente nem ignorada.

Para cada componente, a memória registra:

```text
valor_do_trecho = aplicar(
  principal_ou_base_do_trecho,
  regra_versionada,
  inicio_inclusivo,
  fim_inclusivo,
  precisao,
  arredondamento
)

valor_do_componente = soma(valor_do_trecho)
```

O motor não presume capitalização, cumulação, termo inicial, incidência cruzada ou prioridade. Tudo deve existir no pacote normativo aprovado.

### 5.3 Trilhas independentes

O resultado preserva, sem compensação automática:

- principal de restituição;
- atualização da restituição;
- juros da restituição;
- total da restituição;
- principal de complemento;
- atualização do complemento;
- juros do complemento;
- multa de mora do complemento;
- penalidade formal por infração, quando determinável;
- total do complemento;
- saldo comparativo derivado, apenas informativo.

O saldo comparativo não autoriza compensação, aproveitamento, pagamento ou qualquer lançamento.

### 5.4 Determinação parcial

Componentes conhecidos permanecem visíveis quando outro estiver indeterminado. Porém:

- `total_cents` fica `null` para a trilha afetada;
- o pacote global fica `INDETERMINATE`;
- a interface lista a lacuna, o intervalo e a evidência necessária;
- PDF, CSV e JSON carregam o mesmo estado e não apresentam estimativa substitutiva.

## 6. Resultado e estados

```ts
type LegalAccrualComponent =
  | "MONETARY_UPDATE"
  | "LATE_INTEREST"
  | "LATE_PAYMENT_FINE"
  | "INFRACTION_PENALTY";

type LegalAccrualResultStatus =
  | "READY_FOR_INTERNAL_REVIEW"
  | "INDETERMINATE"
  | "POSSIBLY_OUTDATED"
  | "SUPERSEDED";

type LegalAccrualTrack = {
  principalCents: number;
  monetaryUpdateCents: number | null;
  lateInterestCents: number | null;
  latePaymentFineCents: number | null;
  infractionPenaltyCents: number | null;
  totalCents: number | null;
};

type LegalAccrualResult = {
  resultId: string;
  tenantId: string;
  companyId: string;
  sourcePackageId: string;
  referenceDate: string;
  regime: "SIMPLES_NACIONAL" | "LUCRO_PRESUMIDO";
  restitution: LegalAccrualTrack;
  complement: LegalAccrualTrack;
  rulePackageVersion: string;
  formalActIds: readonly string[];
  status: LegalAccrualResultStatus;
  canonicalJsonHash: string;
  generatedAtUtc: string;
};
```

`READY_FOR_INTERNAL_REVIEW` significa apenas que os acréscimos desta fatia são determináveis. Não significa aptidão para escrituração, guia, transmissão, pagamento ou apropriação.

Erros seguem `application/problem+json` e distinguem, no mínimo:

- `ICMS_ST_ACCRUAL_SOURCE_PACKAGE_INELIGIBLE`;
- `ICMS_ST_ACCRUAL_SOURCE_HASH_MISMATCH`;
- `ICMS_ST_ACCRUAL_REFERENCE_DATE_INVALID`;
- `ICMS_ST_ACCRUAL_RULE_PACKAGE_NOT_APPROVED`;
- `ICMS_ST_ACCRUAL_RULE_TIMELINE_GAP`;
- `ICMS_ST_ACCRUAL_RULE_TIMELINE_CONFLICT`;
- `ICMS_ST_ACCRUAL_FORMAL_ACT_REQUIRED`;
- `ICMS_ST_ACCRUAL_FORMAL_ACT_INVALID`;
- `ICMS_ST_ACCRUAL_COMPONENT_INDETERMINATE`;
- `ICMS_ST_ACCRUAL_RESULT_SUPERSEDED`;
- `ICMS_ST_ACCRUAL_EXPORT_HASH_MISMATCH`.

## 7. Idempotência, revisão e exportação

A chave idempotente considera tenant, empresa, pacote F33, data de referência, versão do pacote normativo, atos formais e versão do contrato de cálculo.

Mudança em qualquer entrada gera resultado novo e marca o anterior como superado, sem apagar histórico. Mesmo conjunto de entradas reproduz o JSON canônico e o hash.

PDF, CSV e JSON incluem:

- identificação do resultado e da fonte F33;
- regime, período original e data de referência;
- trilhas separadas de restituição e complemento;
- memória por competência, componente e trecho de vigência;
- pacotes normativos, fontes oficiais e atos formais;
- lacunas e estados indeterminados;
- versão do contrato, hash, geração UTC e usuário responsável.

## 8. Autorização, isolamento e auditoria

- `admin_escritorio` e `contador` importam evidências, selecionam fonte, calculam, revisam e exportam;
- `auxiliar` prepara importação e cálculo quando autorizado, sem aprovar pacote normativo ou ato formal;
- `auditor_readonly` consulta resultado, fontes, trilha e downloads, sem mutar;
- `super-admin` global não lê dados fiscais do tenant por esse papel;
- demais papéis são negados por padrão.

Resultados, trechos, pacotes, atos, arquivos e auditoria possuem `tenant_id` e `empresa_id`, usam RLS, carteira ativa e storage privado.

Auditoria append-only registra importação, aprovação, rejeição, seleção, cálculo, revisão, exportação, download, reprodução, invalidação, superação e erro, sem XML integral, documento completo, CPF/CNPJ completo ou conteúdo fiscal sensível em logs e métricas.

## 9. Contrato de interface

A F34 evolui a tela da F33 em `Fiscal -> Resolução tributária`:

1. selecionar pacote F33 elegível;
2. informar data de referência;
3. visualizar cobertura normativa e lacunas;
4. importar e revisar ato formal quando houver penalidade;
5. calcular trilhas de restituição e complemento;
6. inspecionar linha do tempo, fórmulas, fontes e arredondamentos;
7. revisar componentes determinados e indeterminados;
8. gerar e reproduzir PDF, CSV e JSON;
9. consultar histórico de resultados e substituições.

Estados obrigatórios: vazio, carregando, fonte inelegível, data inválida, cobertura normativa incompleta, ato formal necessário, calculando, indeterminado, pronto para revisão interna, exportando, exportado, possivelmente desatualizado, superado, falha recuperável e falha terminal. Estado nunca depende apenas de cor.

A referência de conteúdo e fluxo permanece `docs/telas/contaia_apura_o_fiscal_tribut_ria_reforma_ibs_cbs_rf_03/`. Aparência e comportamento obedecem `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md`.

A implementação usa `frontend-design` antes e durante a construção e `impeccable` no acabamento. A PR prova comparação com o protótipo, CLARO/ESCURO, 768/1024/1440 px, teclado, foco, contraste, leitor de tela e redução de movimento conforme `FRONTEND.md` §20.1.

## 10. Invariantes globais tocados

| Código | Aplicação nesta fatia |
|---|---|
| `I-1` | resultados, regras, atos, trechos, arquivos e auditoria possuem tenant e empresa, índices e RLS |
| `I-2` | cálculo e exportação sem contexto válido não retornam dados nem executam comando |
| `I-3` | dinheiro usa centavos inteiros; taxas e índices usam precisão declarada, sem float monetário |
| `I-4` | cálculo é determinístico e baseado em pacotes aprovados; LLM não calcula nem interpreta norma |
| `I-5` | resultado é rascunho interno sem efeito externo |
| `I-6` | fontes, resultados e auditoria são append-only |
| `I-7` | resultado superado permanece consultável com motivo e substituto |
| `I-8` | termo inicial deriva da regra e do fato aprovado, nunca da data de geração |
| `I-9` | mesma entrada reproduz resultado e hash |
| `I-10` | F34 não assina nem transmite obrigação |
| `I-11` | datas civis não têm fuso; instantes são UTC e exibidos em `America/Sao_Paulo` |
| `I-12` | JSON canônico e hash cobrem entradas, regras, atos e memória de cálculo |

## 11. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Regras | juros e atualização nas duas trilhas; multa de mora no complemento; penalidade somente com ato formal |
| Temporal | troca de regra, taxa e índice nas fronteiras de vigência, sem lacuna ou retroatividade silenciosa |
| Indeterminação | ausência, conflito ou cobertura parcial mantém componentes conhecidos e anula o total afetado |
| Fontes | pacote F33 e pacote normativo aprovados entram; pendente, rejeitado, superado ou adulterado não entra |
| Precisão | centavos, precisão declarada, arredondamento por regra e soma reproduzível |
| Banco | RLS, carteira, idempotência, append-only, superação e storage privado |
| Exportação | PDF, CSV e JSON coincidem em linhas, totais, lacunas, versões e hash |
| Contrafactuais | transmissão, escrituração, apropriação, guia, pagamento e cálculo manual são bloqueados |
| Tela | CLARO/ESCURO, 768/1024/1440, estados, teclado, foco, contraste, leitor de tela e movimento reduzido |
| E2E | pacote F33 aprovado -> data -> regras -> ato formal -> cálculo -> revisão -> exportação -> reprodução -> superação |

Fixtures oficiais ou sintéticas rastreáveis cobrem os dois regimes, ambas as trilhas, mudanças normativas, lacuna, conflito, ato formal válido e inválido. Ausência de prova real é `not_run`, nunca `pass`.

## 12. Critérios de aceite

- [ ] Somente pacote F33 aprovado, íntegro e não superado é consumido.
- [ ] A data de referência é explícita e não depende da data de geração.
- [ ] Restituição e complemento permanecem em trilhas independentes.
- [ ] Cada trecho aplica apenas regra aprovada vigente no respectivo intervalo.
- [ ] Juros, atualização, multa de mora e penalidade permanecem componentes separados.
- [ ] Penalidade por infração só é calculada com ato formal importado e aprovado.
- [ ] Falta ou conflito de regra/evidência retorna `INDETERMINATE`, sem estimativa.
- [ ] Valores conhecidos permanecem visíveis, mas total afetado fica nulo.
- [ ] Mesmo conjunto de entradas reproduz JSON e hash; mudança gera nova revisão.
- [ ] PDF, CSV e JSON coincidem com a memória canônica.
- [ ] Resultado pronto continua restrito à revisão interna.
- [ ] Não existe transmissão, escrituração, apropriação, guia, pagamento, contabilidade ou financeiro.
- [ ] RLS, carteira, storage privado e auditoria impedem vazamento, mutação destrutiva ou duplicidade.
- [ ] Testes de regras, banco, tela e E2E publicam evidência vinculada à SPEC-034 e à issue #38.
- [ ] Interface final prova ambos os temas, responsividade, estados e acessibilidade exigidos.

## 13. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Escrituração EFD, Livro Registro de Entradas e SPED | capacidades próprias de obrigações e livros fiscais do MVP-2 |
| Apropriação, compensação, transferência e pedido de restituição | capacidades próprias de apuração e uso fiscal do MVP-2 |
| DAS, DARE, guia e pagamento | capacidades fiscal e financeira posteriores do MVP-2 |
| Lançamento contábil e partida dobrada | capacidades contábeis próprias do MVP-2 |
| Retificação, protocolo, transmissão e consulta oficial | capacidades próprias e gate posterior aplicável |
| Outros segmentos, UFs, regimes, documentos e períodos | fatias próprias de expansão tributária do MVP-2 |
| Produção e piloto real | gate posterior ao MVP-4 |

Nenhum complemento foi descartado. A F34 encerra somente o cálculo auditável dos acréscimos legais sobre a reconstrução F33.

## 14. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Abrangência | restituição e complemento, em trilhas separadas |
| Data final | data de referência informada e versionada |
| Multas | multa de mora e penalidade por infração dentro da fatia |
| Evidência da penalidade | somente ato formal importado e aprovado |
| Ausência de evidência | `INDETERMINATE`, nunca zero ou estimativa |
| Fonte de taxas | pacote oficial versionado e aprovado |
| Política temporal | linha do tempo legal por vigência |
| Efeito | pronto somente para revisão interna |
| Artefato | PDF + CSV + JSON com hash reproduzível |

**Questões abertas:** nenhuma.

## 15. Gate dos oito itens obrigatórios

| Verificação | Evidência nesta SPEC |
|---|---|
| Identidade | cabeçalho, MVP-2, F34/SPEC-034 e issue #38 |
| Comportamento | §§1–7, observável por seleção, cálculo, memória, exportação e hash |
| Aceite | §12, ligado às provas do §11 |
| Invariantes | §10, com aplicação concreta dos códigos globais |
| Fora de escopo | §13, com destino explícito |
| Dúvidas | §14; nenhuma aberta |
| Complementos | §13; nenhum requisito descartado |
| UI | §9, com caminho, estados, temas, viewports e provas |

## 16. Referências oficiais datadas

- Decreto nº 10.202/2023, especialmente o §5º do art. 42 do Anexo VIII do RCTE, consultado em 19/09/2026;
- Instrução Normativa nº 1.558/2023-GSE, consultada em 19/09/2026;
- Lei nº 11.651/1991, Código Tributário do Estado de Goiás, e alterações aplicáveis, consultada em 19/09/2026;
- pacotes normativos oficiais aprovados e vinculados a cada execução;
- pacote histórico aprovado da F33/SPEC-033.

## 17. Aprovação

Abrangência, data de referência, multas, evidência formal, pacote normativo, linha do tempo legal, efeito interno, artefatos, provas e destinos aprovados pelo PI em 19/09/2026. A implementação deve seguir esta SPEC sem recalcular o principal, sem inferir penalidade, sem taxa manual, sem consulta ao vivo durante o cálculo e sem produzir efeito fiscal, contábil ou financeiro externo.
