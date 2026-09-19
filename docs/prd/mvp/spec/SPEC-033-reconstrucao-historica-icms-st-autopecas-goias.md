# SPEC-033 / F33 — Reconstrução histórica do ICMS-ST de autopeças em Goiás

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD v3.1 §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16
>
> **Estado:** aprovada pelo PI em 19/09/2026
>
> **Tamanho:** Grande e delimitada — consolida o histórico aprovado pelas F29/F31/F32 em pacote auditável por regime, sem nova apuração, transmissão, escrituração, apropriação, guia, contabilidade ou efeito financeiro
>
> **Ambiente:** Docker local; documentos reais necessários estão autorizados localmente; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #37

## 1. Objetivo

Permitir que o escritório reconstrua, confira e entregue internamente a memória histórica do ICMS-ST de autopeças em Goiás já calculada e aprovada pelas F29, F31 e F32, separando principal por regime e preservando prova causal até documento, item, revisão, regra e evento posterior.

A F33 não refaz a F29. Ela não recalcula a diferença entre base presumida e base efetiva, não altera vínculo, não decide evento posterior e não cria valor tributário novo. A fatia transforma revisões aprovadas em um dossiê imutável e reproduzível, com leitura regulatória distinta para `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO`.

A cobertura permanece limitada a autopeças em operações internas a consumidor final em Goiás, documentadas por NF-e modelo 55 ou NFC-e modelo 65, com fato gerador da saída original entre **27/10/2016 e 28/02/2018**, nos regimes `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO`.

## 2. Fronteira da fatia

Esta fatia entrega:

- seleção de competências históricas cobertas pelas revisões aprovadas das F29/F31/F32;
- reconstrução consolidada por empresa, regime, competência e documento fiscal;
- totais brutos de restituição, complemento, estornos posteriores e saldo líquido de principal;
- memória causal até documento de saída, item, entrada usada como fonte, regra, revisão e evento posterior;
- pacote exportável em PDF, CSV e JSON, com hash e versão de geração;
- adapter de apresentação para `LUCRO_PRESUMIDO`, com memória de EFD/ajuste histórico apenas como rascunho auditável;
- adapter de apresentação para `SIMPLES_NACIONAL`, com memória de Livro Registro de Entradas, saldo transportado e destinos possíveis apenas como rascunho auditável;
- status explícito `BLOQUEADO_POR_ACRESCIMOS_LEGAIS` quando qualquer uso externo depender de juros, multa, atualização ou data efetiva de lançamento/pagamento;
- interface final na mesma área `Fiscal -> Resolução tributária`, nos temas CLARO e ESCURO;
- auditoria append-only da seleção, geração, download, invalidação e reprodução do pacote.

Não entrega:

- nova apuração de ICMS-ST;
- alteração de fórmula, vínculo, MVA, alíquota, CEST, NCM, evento posterior ou competência definidos nas F29/F31/F32;
- cálculo de acréscimos legais, juros, multa, atualização monetária, penalidade ou data efetiva de lançamento/pagamento;
- escrituração definitiva em EFD, Livro Registro de Entradas, DAS, DARE, SPED ou outro livro oficial;
- transmissão, protocolo, consulta oficial, retificação, compensação, transferência, pedido de restituição ou pagamento;
- apropriação de crédito, débito especial, guia, lançamento contábil, título financeiro ou baixa;
- inclusão de saída original fora do recorte, outro segmento, outra UF, outro regime, outro modelo documental ou outro período;
- interpretação jurídica ou cálculo por LLM;
- produção ou piloto real.

## 3. Fontes e elegibilidade

A reconstrução consome somente revisões:

- `APPROVED`;
- não `STALE`;
- não substituídas por revisão posterior aprovada;
- vinculadas a empresa e tenant autorizados;
- pertencentes às F29, F31 ou F32;
- com memória material suficiente para reproduzir documento, item, regra, valores de principal e hashes.

Revisão `PENDING_REVIEW`, `REJECTED`, `STALE`, inválida, parcialmente gerada ou sem memória causal não entra no pacote. O sistema não preenche lacuna com estimativa, média nova, valor manual, PDF, DANFE, descrição textual ou inferência por IA.

Se uma competência possui revisão aprovada, mas existe evidência posterior ainda não resolvida, o pacote deve:

- manter a revisão aprovada como fonte histórica;
- marcar a competência como `POSSIVELMENTE_DESATUALIZADA`;
- bloquear qualquer status de prontidão externa;
- apontar a evidência que exige reprocessamento pela fatia competente.

## 4. Reconstrução do principal

O principal é derivado de linhas aprovadas das F29/F31/F32:

```text
restituicao_bruta = soma(restituicao_original_aprovada)
complemento_bruto = soma(complemento_original_aprovado)
estorno_restituicao = soma(estorno_de_restituicao_aprovado)
estorno_complemento = soma(estorno_de_complemento_aprovado)

restituicao_liquida_principal = restituicao_bruta - estorno_restituicao
complemento_liquido_principal = complemento_bruto - estorno_complemento
saldo_liquido_principal = restituicao_liquida_principal - complemento_liquido_principal
```

Restituição e complemento permanecem separados em todas as camadas. O saldo líquido é visão derivada para leitura, nunca substitui os totais brutos.

Cada linha consolidada preserva:

- competência civil da saída ou do evento posterior;
- regime tributário;
- documento fiscal, modelo, chave, item e produto;
- revisão de origem e versão da regra;
- valor de restituição, complemento e estorno em centavos inteiros;
- relação causal com entrada, saída, NFC-e incluída e devolução/cancelamento quando houver;
- estado da revisão de origem;
- hash do documento, hash da memória e hash do pacote.

Dinheiro usa centavos inteiros. Quantidade usa decimal exato ou inteiro escalado. Float é proibido.

## 5. Saídas por regime

### 5.1 Lucro Presumido

Para contribuinte em regime de débito e crédito, o pacote apresenta o principal histórico como memória de ajustes possíveis, sem gerar arquivo transmissível.

A saída deve separar:

- valores principais a restituir;
- valores principais a complementar;
- estornos posteriores;
- competência original do fato;
- competência histórica de referência para lançamento, quando aplicável;
- códigos e registros EFD somente como orientação de memória auditável, nunca como escrituração pronta.

A fatia pode exibir referências a `E111`, `C197`, `C176`, `C190`, `GO020175` e `GO050017` quando derivadas da fonte normativa aplicável, mas deve rotular o artefato como **rascunho interno não transmissível**.

Qualquer linha que dependa de acréscimos legais fica `BLOQUEADO_POR_ACRESCIMOS_LEGAIS` e aponta F34/SPEC-034 como destino obrigatório.

### 5.2 Simples Nacional

Para contribuinte optante pelo Simples Nacional, o pacote apresenta o principal histórico como memória de Livro Registro de Entradas e controle de saldo, sem compensar nem escolher destino.

A saída deve separar:

- saldo transportado de período anterior, quando vier de revisão aprovada;
- valor principal a restituir ou complementar;
- estornos posteriores;
- saldo a transportar;
- destinos juridicamente possíveis como categorias informativas, sem executar compensação, transferência, pedido de restituição ou DARE.

Qualquer conversão para compensação no DAS, cálculo por percentual efetivo, ressarcimento ao substituto, transferência, pedido em moeda corrente, DARE específico ou acréscimo legal fica fora desta fatia.

## 6. Pacote exportável

Cada geração produz um pacote imutável composto por:

- `PDF`: dossiê de leitura humana, com capa, escopo, período, regime, totais, bloqueios, fontes e trilha;
- `CSV`: linhas analíticas para conferência em planilha, sem XML integral;
- `JSON`: contrato canônico versionado, com totais, linhas, hashes, origem e status.

O pacote possui:

- identificador único;
- `tenant_id` e `empresa_id`;
- período coberto;
- regime;
- lista de revisões consumidas;
- lista de competências excluídas e motivo;
- versão do contrato;
- hash de conteúdo;
- data/hora de geração em UTC e exibição em `America/Sao_Paulo`;
- usuário responsável pela geração.

Geração repetida com o mesmo snapshot, revisões e versão de contrato reproduz o mesmo JSON canônico e o mesmo hash. Mudança em revisão de origem, regra, evento posterior ou versão de exportação gera pacote novo e marca o anterior como superado, sem apagar histórico.

## 7. Contratos de domínio

Os nomes são referência funcional; o Code pode ajustá-los sem alterar o contrato:

```ts
type HistoricalIcmsStPackageStatus =
  | "READY_FOR_INTERNAL_REVIEW"
  | "POSSIBLY_OUTDATED"
  | "BLOCKED_BY_LEGAL_ACCRUALS"
  | "SUPERSEDED";

type HistoricalIcmsStRegimeOutput = "SIMPLES_NACIONAL" | "LUCRO_PRESUMIDO";

type HistoricalIcmsStPackage = {
  packageId: string;
  tenantId: string;
  companyId: string;
  regime: HistoricalIcmsStRegimeOutput;
  periodStart: string;
  periodEnd: string;
  sourceRevisionIds: readonly string[];
  status: HistoricalIcmsStPackageStatus;
  grossRestitutionCents: number;
  grossComplementCents: number;
  reversedRestitutionCents: number;
  reversedComplementCents: number;
  netRestitutionPrincipalCents: number;
  netComplementPrincipalCents: number;
  netPrincipalBalanceCents: number;
  canonicalJsonHash: string;
  generatedAtUtc: string;
};
```

Erros seguem `application/problem+json`. Os fluxos distinguem, no mínimo:

- `ICMS_ST_HISTORY_SOURCE_REVISION_NOT_APPROVED`;
- `ICMS_ST_HISTORY_SOURCE_REVISION_STALE`;
- `ICMS_ST_HISTORY_SOURCE_MEMORY_MISSING`;
- `ICMS_ST_HISTORY_PERIOD_PARTIAL`;
- `ICMS_ST_HISTORY_REGIME_UNSUPPORTED`;
- `ICMS_ST_HISTORY_PACKAGE_SUPERSEDED`;
- `ICMS_ST_HISTORY_LEGAL_ACCRUALS_REQUIRED`;
- `ICMS_ST_HISTORY_EXPORT_HASH_MISMATCH`.

Idempotência considera tenant, empresa, regime, período, revisões de origem, versão do contrato e hash da seleção. Mesmo pedido reutiliza o pacote; seleção divergente gera pacote novo ou conflito explícito.

## 8. Autorização, isolamento e auditoria

- `admin_escritorio` e `contador` selecionam competências, geram, invalidam por nova origem e exportam pacotes de empresas autorizadas;
- `auxiliar` consulta e prepara pacote quando autorizado, sem invalidar pacote aprovado internamente;
- `auditor_readonly` consulta pacote, trilha, fontes e downloads, sem mutar;
- `super-admin` global não lê dados fiscais do tenant por esse papel;
- demais papéis são negados por padrão.

Pacotes, linhas, hashes, revisões consumidas e arquivos exportados possuem `tenant_id` e `empresa_id`, ficam sob RLS e respeitam carteira ativa. Arquivos usam storage privado, hash e autorização na leitura.

Auditoria append-only registra seleção, geração, download, reprodução, invalidação, superação e erro. Logs e métricas não contêm XML integral, CPF/CNPJ completo, conteúdo fiscal sensível ou arquivo exportado.

## 9. Contrato de interface

A F33 compõe a tela das F29/F31/F32 em `Fiscal -> Resolução tributária`, sem módulo paralelo:

1. seleção de empresa, regime e período histórico;
2. visão de competências elegíveis, parciais, desatualizadas e bloqueadas;
3. totais brutos, estornos e saldo líquido principal;
4. alternância entre visão `Lucro Presumido` e `Simples Nacional`;
5. drill-down por competência, documento, item, revisão e evento posterior;
6. marcador claro de `BLOQUEADO_POR_ACRESCIMOS_LEGAIS` quando aplicável;
7. geração do pacote PDF/CSV/JSON;
8. verificação de hash e reprodução;
9. histórico de pacotes gerados e superados.

Estados obrigatórios: vazio, carregando, seleção incompleta, sem revisões elegíveis, parcial, possivelmente desatualizado, bloqueado por acréscimos legais, pronto para revisão interna, exportando, exportado, superado, falha recuperável e falha terminal. Estado nunca depende apenas de cor.

A referência de conteúdo, fluxo, hierarquia e densidade é `docs/telas/contaia_apura_o_fiscal_tribut_ria_reforma_ibs_cbs_rf_03/`. Aparência, componentes, estados, acessibilidade e correções seguem `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md`.

A implementação usa `frontend-design` antes e durante a construção e `impeccable` no acabamento. A PR prova comparação com o protótipo, CLARO/ESCURO, 768/1024/1440 px, teclado, foco, contraste, leitor de tela e redução de movimento conforme `FRONTEND.md` §20.1.

## 10. Invariantes globais tocados

Aplicação concreta dos códigos globais de `docs/CONVENTION.md`:

| Código | Aplicação nesta fatia |
|---|---|
| `I-1` | pacotes, linhas, arquivos, seleção e auditoria possuem `tenant_id` e `empresa_id`, `NOT NULL`, índices e RLS |
| `I-2` | geração e exportação sem contexto de tenant não retornam dados nem executam comando |
| `I-3` | restituição, complemento, estorno e saldo usam centavos inteiros; quantidade usa precisão declarada, sem float para dinheiro |
| `I-4` | reconstrução usa motor determinístico e revisões aprovadas; LLM não calcula, não vincula e não interpreta regra |
| `I-5` | pacote é rascunho interno; qualquer efeito fiscal externo depende de fatia posterior e aprovação específica |
| `I-6` | seleção, pacote, arquivo e auditoria são append-only, sem `UPDATE` ou `DELETE` destrutivo |
| `I-7` | pacote superado permanece consultável com motivo e substituto |
| `I-8` | competência deriva do fato ou evento aprovado na origem; data de geração não desloca competência |
| `I-9` | geração é reentrante por hash de seleção e versão do contrato |
| `I-10` | F33 não manipula certificado nem assina/transmite obrigação |
| `I-11` | competências e datas civis não têm fuso; data/hora de geração é UTC e exibida em `America/Sao_Paulo` |
| `I-12` | mesmo snapshot, revisões e versão reproduzem o mesmo JSON canônico e hash |

## 11. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Regras | principal de restituição, complemento, estornos, saldo líquido e separação bruta por competência |
| Fontes | revisões aprovadas entram; `STALE`, `REJECTED`, parcial ou sem memória não entram |
| Regime | adapters de Simples Nacional e Lucro Presumido apresentam campos próprios sem misturar contratos |
| Contrafactuais | tentativa de transmitir, escriturar, apropriar crédito, gerar guia ou compensar retorna bloqueio estável |
| Banco | RLS, carteira, idempotência, pacote superado, storage privado e append-only |
| Exportação | PDF, CSV e JSON batem totais, linhas, status e hashes; JSON canônico é reproduzível |
| Auditoria | seleção, geração, download, invalidação e reprodução geram trilha sem conteúdo fiscal sensível |
| Tela | CLARO/ESCURO, 768/1024/1440, estados, teclado, foco, contraste, leitor de tela e movimento reduzido |
| E2E | aprovar F29/F31/F32 -> gerar pacote -> conferir totais -> exportar PDF/CSV/JSON -> reproduzir hash -> invalidar por nova revisão |

Fixtures oficiais ou sintéticas rastreáveis cobrem os dois regimes, NF-e, NFC-e, devolução, cancelamento, competência parcial e bloqueio por acréscimos legais. Ausência de integração ou prova real é `not_run`, nunca `pass`.

## 12. Critérios de aceite

- [ ] A reconstrução consome somente revisões aprovadas e não superadas das F29/F31/F32.
- [ ] Revisão `STALE`, rejeitada, pendente, parcial ou sem memória causal não entra no pacote.
- [ ] Restituição, complemento, estornos e saldo líquido principal batem exatamente com as revisões de origem.
- [ ] Restituição e complemento permanecem em campos separados; saldo líquido é somente derivado.
- [ ] Saídas de Simples Nacional e Lucro Presumido são separadas e não geram escrituração definitiva.
- [ ] Pacote PDF, CSV e JSON possui linhas, totais, fontes, status e hash reproduzível.
- [ ] Qualquer dependência de acréscimos legais bloqueia uso externo e aponta F34/SPEC-034.
- [ ] Não existe transmissão, retificação, apropriação, guia, lançamento contábil, título ou pagamento.
- [ ] Pacote superado permanece consultável e vinculado ao substituto.
- [ ] RLS, carteira, idempotência, storage privado e auditoria impedem vazamento ou duplicidade.
- [ ] Testes de regras, banco, tela e E2E publicam evidência vinculada à SPEC-033 e à issue #37.
- [ ] Interface final prova ambos os temas, responsividade, estados e acessibilidade exigidos.

## 13. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Acréscimos legais, juros, multa, atualização e data efetiva de lançamento/pagamento | F34 / SPEC-034 |
| Escrituração EFD definitiva, Livro Registro de Entradas definitivo e SPED | capacidades próprias de obrigações e livros fiscais do MVP-2 |
| Apropriação de crédito, débito especial e compensação | capacidades próprias de apuração e uso fiscal do MVP-2, após F34 quando aplicável |
| DAS, DARE, guia, pagamento e contas a pagar/receber | capacidades fiscal e financeira posteriores do MVP-2 |
| Lançamento contábil e partida dobrada | capacidades contábeis próprias do MVP-2 |
| Retificação, protocolo, transmissão, pedido de restituição e consulta oficial | capacidades próprias de obrigação fiscal e gate posterior aplicável |
| Outros segmentos, UFs, regimes, documentos e períodos de saída | fatias próprias de expansão tributária do MVP-2 |
| Produção, consulta oficial e piloto real | gate posterior ao MVP-4 |

Nenhum complemento foi descartado. A F33 encerra somente a reconstrução auditável do principal histórico já aprovado.

## 14. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Capacidade | apuração tributária, redirecionada para reconstrução histórica para não duplicar F29 |
| Vertical | ICMS-ST de autopeças em Goiás |
| Efeito | rascunho interno sem transmissão ou efeito fiscal externo |
| Base | somente revisões aprovadas das F29/F31/F32 |
| Apresentação | totais brutos separados e saldo líquido derivado |
| Regimes | Simples Nacional e Lucro Presumido na mesma fatia |
| Uso histórico | reconstrução auditável, não retificação atual |
| Acréscimos legais | separar em F34/SPEC-034 |
| Artefato | pacote PDF + CSV + JSON |

**Questões abertas:** nenhuma.

## 15. Gate dos oito itens obrigatórios

| Verificação | Evidência nesta SPEC |
|---|---|
| Identidade | cabeçalho, MVP-2, F33/SPEC-033 e origem no PRD |
| Comportamento | §§1–6, observável por seleção, reconstrução, pacote e hash |
| Aceite | §12, ligado às provas do §11 |
| Invariantes | §10, com códigos de `CONVENTION.md` §2 e aplicação concreta |
| Fora de escopo | §13, com destino explícito para todo complemento |
| Dúvidas | §14; nenhuma aberta |
| Complementos | §13; nenhum requisito descartado |
| UI | §9, com caminho concreto, estados, temas, viewports, provas e skills obrigatórias |

## 16. Referências oficiais datadas

- Instrução Normativa nº 1.558/2023-GSE, Secretaria da Economia de Goiás, consultada em 19/09/2026;
- Decreto nº 10.202/2023, Governo do Estado de Goiás, consultado em 19/09/2026;
- Guia Prático da EFD ICMS/IPI, versão vigente consultada em 19/09/2026;
- fontes normativas e pacote histórico aprovados nas SPEC-029 a SPEC-032.

## 17. Aprovação

Capacidade, vertical, efeito, base, apresentação, regimes, uso histórico, separação dos acréscimos legais, artefato, provas e destinos aprovados pelo PI em 19/09/2026. A implementação deve seguir esta SPEC sem recalcular a F29, sem aceitar valor manual, sem transmitir, sem escriturar, sem apropriar crédito/débito e sem produzir efeito fiscal, contábil ou financeiro externo.
