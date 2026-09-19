# SPEC-028 / F28 — ICMS na entrada histórica de autopeças em Goiás

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD v3.1 §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16
>
> **Estado:** aprovada pelo PI em 19/09/2026
>
> **Tamanho:** Grande e delimitada — determina responsabilidade e calcula por MVA o ICMS devido em entradas históricas de autopeças; pauta, PMPF, guias, escrituração e efeitos financeiros permanecem em fatias próprias
>
> **Ambiente:** Docker local; fontes oficiais históricas consultadas e empacotadas com vigência explícita; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #32

## 1. Objetivo

Permitir que o escritório determine, calcule e submeta à aprovação humana o ICMS devido em NF-e modelo 55 de entrada de autopeças para revenda por empresa estabelecida em Goiás, nos regimes `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO`, quando o fato gerador estiver no intervalo histórico em que a mercadoria e a operação estiveram comprovadamente sujeitas à regra publicada.

A fatia cobre separadamente ICMS-ST devido pelo destinatário, antecipação tributária e responsabilidade solidária por ausência de retenção. O cálculo usa somente MVA original ou ajustada e produz resultado informativo, auditável e reproduzível. Não gera guia, escrituração, lançamento contábil, título a pagar ou pagamento.

O limite superior da cobertura é **28/02/2018**. A partir de **01/03/2018**, autopeças foram excluídas do regime goiano de substituição tributária pelas operações posteriores conforme fonte oficial identificada nesta SPEC. Documento posterior ao corte recebe `NOT_APPLICABLE` para as hipóteses históricas desta fatia; o sistema nunca projeta regra revogada sobre fato atual.

## 2. Fronteira da fatia

Esta fatia entrega:

- pacote normativo histórico, imutável e versionado, com intervalo de vigência por combinação CEST/NCM, operação, regime e UF de origem;
- seleção determinística entre ICMS-ST devido pelo destinatário, antecipação tributária e responsabilidade solidária por falta de retenção;
- cálculo por MVA original ou MVA ajustada, conforme regra oficial aplicável;
- memória de cálculo com base, MVA, alíquotas, deduções, arredondamento, valor em centavos, vencimento, código de recolhimento, regra e fontes;
- decisões independentes por obrigação, sem soma ou cumulação implícita;
- submissão do resultado informativo à fila HITL, aprovação por `contador` ou `admin_escritorio` e rejeição motivada;
- reprocessamento por nova revisão após correção de documento, cadastro ou pacote, sem edição manual do cálculo;
- interface final na área `Fiscal → Resolução tributária`, nos temas CLARO e ESCURO;
- auditoria append-only da publicação, cálculo, indeterminação, submissão, aprovação, rejeição e reprocessamento.

Não entrega:

- fato gerador a partir de 01/03/2018 para autopeças;
- pauta, PMPF ou outra base de cálculo distinta de MVA;
- complemento, restituição, ressarcimento, devolução, perda, perecimento ou saída interestadual posterior;
- outros segmentos, UFs de destino, documentos ou regimes;
- preenchimento manual de regra, evidência ou valor calculado;
- DARE, GNRE, guia, apuração, escrituração, lançamento contábil, contas a pagar ou pagamento;
- interpretação de legislação por LLM ou atualização automática do pacote.

## 3. Cobertura aprovada

### 3.1 Empresa, documento e período

A resolução exige:

- empresa ativa, autorizada no tenant e na carteira aplicável;
- estabelecimento destinatário em `GO`;
- regime `SIMPLES_NACIONAL` ou `LUCRO_PRESUMIDO` vigente na data do fato gerador;
- NF-e modelo 55 autorizada, persistida pela F18 e com direção de entrada;
- finalidade de compra para revenda;
- emitente e destinatário distintos e consistentes com o documento;
- item de autopeça com CFOP, NCM, CEST, CST ou CSOSN e grupo de ICMS identificáveis;
- ausência de retenção válida na NF-e para a hipótese avaliada;
- pacote publicado e vigente na data do fato gerador.

A cobertura começa na primeira vigência comprovada de cada regra curada e termina em 28/02/2018. Não existe data inicial genérica: uma regra só é selecionável dentro do seu próprio intervalo oficial.

Mudança posterior de regime, cadastro, pacote, protocolo ou enquadramento não reescreve snapshot anterior.

### 3.2 Mercadoria e operação

O pacote cobre exclusivamente autopeças enquadradas simultaneamente por:

- segmento CEST correspondente a autopeças;
- combinação CEST/NCM e descrição legal explicitamente publicada;
- vigência da combinação na data do fato gerador;
- compra interna ou interestadual destinada a contribuinte goiano;
- finalidade de revenda;
- hipótese de responsabilidade e método de cálculo publicados.

CEST sozinho, NCM sozinho e descrição livre do produto não selecionam regra. Item não coberto recebe `INDETERMINATE` com o motivo específico; o motor não procura produto parecido e não cai para regra genérica.

### 3.3 Origem interestadual

Entrada interestadual só é resolvida quando a UF de origem, Goiás e a mercadoria estão cobertos por convênio ou protocolo vigente na data do fato gerador, ou quando outra fonte oficial publicada atribui expressamente a responsabilidade ao destinatário goiano naquela operação.

UF sem vínculo normativo comprovado recebe `INDETERMINATE`. O sistema não aplica a regra goiana independentemente do protocolo nem presume responsabilidade pela simples entrada no território.

### 3.4 Hipóteses independentes

O pacote pode produzir, por item, decisões separadas para:

1. `ICMS_ST_RECIPIENT_DUE` — ICMS-ST devido pelo destinatário;
2. `ICMS_ENTRY_ADVANCE` — antecipação tributária na entrada;
3. `ICMS_ST_JOINT_LIABILITY` — responsabilidade solidária pela falta de retenção.

Regra publicada declara se as hipóteses são exclusivas, alternativas ou coexistentes. O motor nunca soma as três por padrão. Duas regras incompatíveis aplicáveis ao mesmo contexto produzem `TAX_TREATMENT_RULE_AMBIGUOUS` e abortam a revisão inteira.

A responsabilidade solidária usa somente fatos presentes na NF-e, nos cadastros versionados e no pacote publicado. Quando depender de pagamento, acordo, decisão, condição do remetente ou outro fato externo não comprovado, a obrigação recebe `INDETERMINATE`.

## 4. Pacote normativo histórico

### 4.1 Fontes obrigatórias

Cada regra publicada aponta, no mínimo:

- Regulamento do Código Tributário do Estado de Goiás, especialmente o Anexo VIII do Decreto nº 4.852/1997, no texto vigente no fato gerador;
- Convênio ICMS nº 92/2015 e atos nacionais de segmentação/CEST correspondentes, somente no intervalo em que cada norma produzir efeitos;
- Protocolo ICMS nº 41/2008, Protocolo ICMS nº 97/2010 e alterações, quando aplicáveis à origem, ao destino e à data;
- decreto, instrução normativa ou ato goiano que inclua, altere ou exclua mercadoria, MVA, responsabilidade, vencimento ou código;
- ato oficial que comprove a exclusão de autopeças com efeitos a partir de 01/03/2018;
- órgão, título, URL oficial, dispositivo, publicação, data de consulta e intervalo de vigência.

A data de corte da curadoria é **19/09/2026**. A implementação revalida as fontes oficiais ao construir o pacote. Fonte inacessível, revogada sem histórico recuperável, sem dispositivo identificável ou sem vigência conhecida impede a publicação da regra afetada.

### 4.2 Conteúdo adicional

Além do contrato das F26 e F27, cada regra contém:

- `taxSegment: "AUTO_PARTS"`;
- combinação explícita de CEST, NCM e descrição legal;
- regimes, CFOPs, grupos CST/CSOSN, origem, destino `GO` e finalidade `RESALE`;
- `liabilityKind` e sua relação de exclusividade ou coexistência;
- `calculationMethod: "MVA_ORIGINAL" | "MVA_ADJUSTED"`;
- MVA e alíquotas representadas com precisão decimal exata;
- componentes que integram ou reduzem a base;
- regra de arredondamento e ordem das operações;
- vencimento e código de recolhimento aplicáveis;
- requisitos documentais, verificações e motivos de indeterminação;
- fixtures positivas, negativas, de origem e de limite de vigência.

Correção de parâmetro, fórmula, fonte ou vigência cria nova versão. Pacote publicado permanece imutável e segue revisão humana, publicação, arquivamento, hash e auditoria definidos na F26.

## 5. Entradas e contratos normalizados

```ts
type TaxLiabilityKind =
  | "ICMS_ST_RECIPIENT_DUE"
  | "ICMS_ENTRY_ADVANCE"
  | "ICMS_ST_JOINT_LIABILITY";

type TaxCalculationMethod = "MVA_ORIGINAL" | "MVA_ADJUSTED";

type TaxCalculationInput = {
  operationAmountCents: number;
  freightAmountCents: number;
  insuranceAmountCents: number;
  otherExpensesAmountCents: number;
  discountAmountCents: number;
  ownIcmsAmountCents: number | null;
  originState: string;
  destinationState: "GO";
};

type TaxCalculationMemory = {
  liabilityKind: TaxLiabilityKind;
  method: TaxCalculationMethod;
  calculationBaseCents: number;
  mvaBasisPoints: number;
  internalRateBasisPoints: number;
  interstateRateBasisPoints: number | null;
  deductionsCents: number;
  amountDueCents: number;
  dueDate: string;
  revenueCode: string;
  formulaVersion: string;
  steps: readonly string[];
};

type TaxCalculationApprovalStatus =
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED";
```

Os nomes refletem fatos normalizados. O adaptador mantém rastreabilidade até os campos originais da NF-e e registra a origem de cada componente.

Dinheiro usa centavos inteiros. MVA e alíquotas usam pontos-base ou unidade racional equivalente. Float é proibido. `dueDate` é data civil; eventos usam UTC.

## 6. Seleção e cálculo

### 6.1 Ordem determinística

O motor:

1. valida empresa, documento, regime, finalidade e período;
2. seleciona combinação CEST/NCM e descrição legal vigente;
3. confirma a cobertura da origem e do protocolo, quando interestadual;
4. avalia separadamente cada `liabilityKind`;
5. exige exatamente uma regra compatível por obrigação;
6. congela os componentes normalizados usados;
7. executa a fórmula versionada do pacote com aritmética decimal exata;
8. produz memória, verificações, fontes, vencimento e código;
9. submete resultados calculados à revisão humana.

O código da aplicação não contém alíquota, MVA, vencimento ou código de receita como fallback. Esses parâmetros pertencem ao pacote publicado e à vigência selecionada.

### 6.2 Resultado por obrigação

Cada obrigação recebe:

- `APPLICABLE`, `NOT_APPLICABLE` ou `INDETERMINATE`;
- hipótese e método de cálculo, quando aplicáveis;
- valor devido e memória completa, quando determinado;
- regra, pacote, vigência, justificativa e fontes;
- verificações executadas e motivos de indeterminação;
- estado de aprovação, quando houver valor calculado.

Uma obrigação indeterminada não apaga outra decisão válida. Documento posterior a 28/02/2018 recebe `NOT_APPLICABLE` para estas hipóteses históricas, com a fonte da exclusão. Ausência de MVA, alíquota, vencimento, código, protocolo ou evidência material produz `INDETERMINATE` e nenhum valor aprovável.

### 6.3 Arredondamento e reprodutibilidade

O pacote define a escala intermediária, a ordem das operações e o arredondamento final em centavos. Mesma entrada congelada, pacote, regra e versão de fórmula produzem o mesmo valor e a mesma memória.

Atualização de biblioteca ou implementação não altera snapshots históricos. Qualquer correção cria nova versão de fórmula e novo pacote; reprocessamento cria nova revisão comparável.

## 7. Aprovação humana

O cálculo concluído é informativo até aprovação:

- `auxiliar` autorizado pode processar e submeter;
- `contador` ou `admin_escritorio`, dentro da carteira aplicável, pode aprovar ou rejeitar;
- `auditor_readonly` consulta, mas não decide;
- demais papéis são negados por padrão.

Rejeição exige motivo. O usuário não edita base, alíquota, MVA, dedução, vencimento, código ou valor devido. Divergência é corrigida na NF-e, no cadastro ou em nova versão do pacote e então reprocessada.

Aprovação não gera efeito financeiro ou externo nesta fatia. Ela registra que um humano com alçada revisou o resultado informativo e a memória apresentados.

## 8. Snapshot, reprocessamento e concorrência

A F28 reutiliza `TaxTreatmentSnapshot` e acrescenta por obrigação:

- hipótese, método e relação com outras obrigações;
- entrada congelada e origem de cada componente;
- memória de cálculo e versão da fórmula;
- vencimento e código de recolhimento;
- verificações, motivos e fontes;
- estado, autor e instante da submissão, aprovação ou rejeição;
- hash do documento, pacote, regra e memória.

Reprocessamento sempre cria revisão nova e exige motivo quando mudar pacote, documento, cadastro ou normalização. Mesma chave idempotente com a mesma entrada devolve o mesmo snapshot; conteúdo divergente com a mesma chave produz conflito.

Alteração do documento durante o processamento produz HTTP 409 e nenhuma revisão parcial persiste. Aprovar ou rejeitar exige a revisão esperada; decisão concorrente sobre revisão superada também produz conflito.

## 9. Autorização e auditoria

Aplicam-se os papéis e a separação global/tenant das F26 e F27:

- `super-admin` mantém o pacote global sem acessar dados fiscais de tenant por esse papel;
- `admin_escritorio` e `contador` processam, submetem, aprovam, rejeitam e consultam empresas autorizadas;
- `auxiliar` processa, consulta e submete quando possui permissão fiscal, mas nunca aprova;
- `auditor_readonly` consulta snapshot, memória, fontes e histórico;
- demais papéis são negados por padrão.

Documentos, cálculos, tarefas HITL e snapshots permanecem sob RLS de tenant e empresa. Eventos append-only registram publicação, cálculo, indeterminação, submissão, aprovação, rejeição e reprocessamento sem duplicar XML integral ou texto completo da norma.

## 10. Contrato de interface

A F28 compõe as visões existentes, sem criar módulo paralelo:

1. **Pacotes normativos:** cobertura histórica, combinações CEST/NCM, UFs, protocolos, hipóteses, parâmetros, fórmulas, fontes, vigência, fixtures, diff e publicação.
2. **Documentos resolvidos:** obrigações separadas, memória de cálculo, fontes, estados HITL e comparação entre revisões.

No detalhe do item, a seção de ICMS informa textualmente:

- selo “Regra histórica” e intervalo de vigência;
- cada hipótese avaliada e se é exclusiva, alternativa ou coexistente;
- base, MVA, alíquotas, deduções, fórmula, arredondamento e valor devido;
- vencimento e código de recolhimento como informação, sem botão de emissão;
- campos, verificações, regra, fonte e data de corte;
- estado `Pendente de revisão`, `Aprovado`, `Rejeitado`, `Indeterminado` ou `Não aplicável`, sem depender somente de cor;
- aviso de que a aprovação não gera guia, escrituração, título ou pagamento.

Estados obrigatórios:

- carregando com skeleton;
- cálculo determinado por MVA original;
- cálculo determinado por MVA ajustada;
- três hipóteses exibidas separadamente;
- fato posterior à exclusão;
- UF sem protocolo aplicável;
- parâmetro, fonte ou evidência ausente;
- ambiguidade de regra;
- pendente de revisão, aprovado e rejeitado com motivo;
- documento alterado ou revisão concorrente;
- acesso negado;
- falha técnica com preservação do último snapshot.

A referência visual permanece `docs/telas/contaia_apura_o_fiscal_tribut_ria_reforma_ibs_cbs_rf_03/`, corrigida por `docs/FRONTEND.md`, `docs/DESIGN-SYSTEM.md` e `docs/design-system/`.

Provas obrigatórias: temas CLARO e ESCURO; viewports 768, 1024 e 1440 px; teclado, foco visível e retorno de foco; tabelas responsivas; nomes acessíveis; redução de movimento; `frontend-design` antes e durante a implementação; `impeccable` no passe final.

## 11. API e erros observáveis

Os endpoints versionados de pacote, resolução e comparação das F26/F27 passam a aceitar e devolver as novas hipóteses e memórias. Submissão, aprovação e rejeição reutilizam o contrato da fila HITL do domínio; não nasce uma segunda fila fiscal.

Códigos adicionais:

- `TAX_HISTORICAL_PERIOD_OUT_OF_SCOPE`;
- `TAX_ORIGIN_PROTOCOL_NOT_FOUND`;
- `TAX_LIABILITY_EVIDENCE_MISSING`;
- `TAX_LIABILITY_RELATION_CONFLICT`;
- `TAX_MVA_NOT_FOUND`;
- `TAX_RATE_NOT_FOUND`;
- `TAX_DUE_DATE_NOT_FOUND`;
- `TAX_REVENUE_CODE_NOT_FOUND`;
- `TAX_CALCULATION_INPUT_INVALID`;
- `TAX_CALCULATION_REVIEW_CONFLICT`;
- `TAX_CALCULATION_MANUAL_OVERRIDE_FORBIDDEN`.

Indeterminações aparecem dentro da decisão tributária. Falhas de contrato, autorização, concorrência, ambiguidade ou infraestrutura usam `application/problem+json`, com `type`, `title`, `status`, `code` e `correlationId`.

## 12. Persistência e transação

Persistem separadamente:

- regras históricas, parâmetros, fórmulas e vínculos de protocolo no pacote;
- entrada normalizada congelada e origem dos componentes;
- decisão e memória por obrigação;
- tarefa HITL, submissão, aprovação ou rejeição;
- snapshot, revisão, idempotência e eventos append-only.

O caso de uso controla a transação. Indeterminação explicada é resultado válido; ambiguidade de regras aborta a revisão inteira. Restrições impedem mutação de pacote publicado, fórmula, snapshot, decisão HITL ou evento, duplicidade de revisão e idempotência divergente.

## 13. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | documento, cálculo, tarefa HITL, snapshot e evento possuem `tenant_id` e `empresa_id`, indexados e sob RLS |
| `I-2` | contexto sem tenant ou empresa não consulta, calcula nem aprova dados fiscais |
| `I-3` | dinheiro usa centavos e percentuais usam precisão decimal exata; float é proibido |
| `I-4` | seleção e cálculo são determinísticos; LLM não interpreta norma nem calcula imposto |
| `I-5` | resultado informativo exige aprovação humana registrada; não há autoaprovação |
| `I-6` | pacotes, fórmulas, snapshots, decisões HITL e eventos publicados são append-only |
| `I-7` | pacote publicado, snapshot, decisão e evento não são apagados nem alterados |
| `I-8` | regra, protocolo, MVA e alíquota são selecionados pela data do fato gerador |
| `I-9` | processamento e decisão repetidos com a mesma chave não duplicam efeito |
| `I-11` | fato gerador e vencimento usam data civil; eventos usam UTC |
| `I-12` | mesma entrada, pacote, regra e fórmula reproduzem decisão, valor e memória |

## 14. Estratégia de testes

| Categoria | Prova mínima |
|---|---|
| Regras | Simples e Presumido; operação interna e interestadual; três hipóteses; MVA original e ajustada |
| Vigência | primeira vigência de cada regra; 28/02/2018 coberto; 01/03/2018 não aplicável |
| Origem | UF com protocolo vigente, UF sem protocolo e alteração de protocolo no tempo |
| Cálculo | base, componentes, MVA, alíquotas, deduções, ordem, escala e arredondamento exatos |
| Independência | obrigação indeterminada não apaga outra válida; hipóteses não são somadas implicitamente |
| Pacote | schema, hash, fonte, fórmula, conflito, fixture, revisão, publicação imutável e arquivamento |
| Banco | RLS, imutabilidade, revisão sequencial, idempotência, concorrência e append-only |
| Aprovação | auxiliar submete e não aprova; contador/admin aprovam; rejeição exige motivo; override é proibido |
| API | tipos versionados, comparação e Problem Details com códigos estáveis |
| Tela | claro/escuro, 768/1024/1440, estados, teclado, foco, leitor de tela e redução de movimento |
| E2E | publicar pacote → processar NF-e histórica → revisar → aprovar/rejeitar → corrigir → reprocessar → comparar |

Contrafactuais obrigatórios:

- descrição contém “autopeça”, mas CEST/NCM não está publicado;
- documento de 28/02/2018 é comparado a documento de 01/03/2018;
- origem interestadual não participa do protocolo vigente;
- falta MVA, alíquota, vencimento ou código;
- responsabilidade solidária depende de fato externo não comprovado;
- duas hipóteses exclusivas tentam coexistir;
- cálculo com MVA ajustada usa alíquotas históricas da origem e de Goiás;
- tentativa de editar o valor calculado é recusada;
- rejeição sem motivo é recusada;
- pacote futuro não altera snapshot histórico;
- outro tenant, empresa fora da carteira e `super-admin` global não leem o cálculo;
- falha técnica preserva o último snapshot.

## 15. Critérios de aceite

- [ ] Pacote publicado cobre somente regras históricas comprovadas de autopeças, com início próprio e término máximo em 28/02/2018.
- [ ] Documento a partir de 01/03/2018 recebe `NOT_APPLICABLE` para a cobertura histórica, com fonte da exclusão.
- [ ] Cobertura contempla Simples Nacional e Lucro Presumido, operações internas e interestaduais para destinatário em Goiás.
- [ ] Entrada interestadual exige protocolo ou fundamento oficial vigente para a origem e a data.
- [ ] ICMS-ST do destinatário, antecipação e solidariedade são decididos e apresentados separadamente.
- [ ] Regra publicada define exclusividade ou coexistência; não há soma implícita.
- [ ] Cálculo usa somente MVA original ou ajustada, parâmetros versionados e aritmética decimal exata.
- [ ] Memória expõe componentes, fórmula, arredondamento, valor, vencimento, código, regra e fontes.
- [ ] Ausência material produz `INDETERMINATE` e nenhum valor aprovável.
- [ ] Fato externo não comprovado não é presumido para estabelecer solidariedade.
- [ ] Resultado é informativo e não gera guia, escrituração, lançamento, título ou pagamento.
- [ ] `auxiliar` submete e não aprova; `contador` ou `admin_escritorio` aprovam ou rejeitam.
- [ ] Rejeição exige motivo; cálculo não aceita edição manual; correção exige nova revisão.
- [ ] Snapshot congela entrada, pacote, regra, fórmula, memória, aprovação e fontes.
- [ ] RLS e carteira impedem acesso cruzado; `super-admin` global não lê documento fiscal por esse papel.
- [ ] Interface final cobre CLARO/ESCURO, 768/1024/1440 px, estados, teclado, foco e acessibilidade.
- [ ] PR registra `frontend-design`, comparação visual e passe final de `impeccable`.
- [ ] CI publica provas de regras, banco, tela e E2E vinculadas à SPEC-028 e à issue.

## 16. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Pauta e PMPF | capacidade própria de cálculo de ICMS-ST do MVP-2 |
| Complemento e restituição pela diferença entre base presumida e realizada | capacidade própria de complemento/restituição de ICMS-ST do MVP-2 |
| Ressarcimento, devolução, saída interestadual, perda e perecimento | capacidade própria de ressarcimento e eventos posteriores do MVP-2 |
| Outros segmentos sujeitos a ST | fatias próprias de expansão por segmento do MVP-2 |
| Outras UFs de destino e outros regimes | fatias próprias de expansão territorial e por regime do MVP-2 |
| Guia DARE/GNRE, apuração, escrituração e lançamento | capacidades próprias de guia, apuração e escrituração do MVP-2 |
| Título a pagar e pagamento | capacidades financeiras próprias do MVP-2 |
| Cobertura atual de autopeças após 28/02/2018 | não existe nesta fatia; eventual nova incidência exige fonte, vigência e SPEC próprias |
| Transição integral IBS/CBS até 2033 | MVP-4, conforme PRD e RASTREABILIDADE |
| Produção e validação com tráfego produtivo | gate de produção posterior ao MVP-4 |

Nenhum complemento foi descartado. A apuração futura não pode transformar obrigação indeterminada em valor resolvido enquanto a capacidade ou a fonte correspondente não existir.

## 17. Decisões do PI

| Decisão | Resultado aprovado em 19/09/2026 |
|---|---|
| Tema da F28 | ICMS devido em entradas históricas de autopeças em Goiás |
| Regimes | Simples Nacional e Lucro Presumido |
| Documento e operação | NF-e 55 de entrada, interna e interestadual, para revenda em Goiás |
| Hipóteses | ICMS-ST do destinatário, antecipação e solidariedade por falta de retenção |
| Mercadoria | somente autopeças cobertas por CEST/NCM e descrição legal publicados |
| Resultado | determinar e calcular separadamente, com memória, vencimento e código |
| Evidência de solidariedade | somente NF-e, cadastros versionados e pacote publicado |
| Método nesta fatia | MVA original ou ajustada; pauta e PMPF ficam para novas SPECs |
| Efeito operacional | informativo e sujeito à aprovação; sem guia, lançamento ou financeiro |
| Aprovação | `contador` ou `admin_escritorio`; `auxiliar` apenas submete |
| Divergência | rejeitar com motivo, corrigir a origem e reprocessar; override proibido |
| Ausência material | obrigação `INDETERMINATE`, sem valor aprovável |
| Período histórico | primeira vigência comprovada de cada regra até 28/02/2018 |
| Origem interestadual | somente UF com vínculo normativo vigente e comprovado |

Questões abertas: **Nenhuma.**

## 18. Gate de conformidade documental

| Verificação | Evidência |
|---|---|
| Identidade | F28/SPEC-028 · MVP-2 · PRD §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16 |
| Comportamento | §§1–10, observável no pacote, cálculo, aprovação e detalhe do item |
| Aceite | §15, com provas de regras, banco, tela e E2E |
| Invariantes | §13 |
| Fora de escopo | §16 |
| Dúvidas | §17, nenhuma aberta |
| Complementos | §16, todos preservados no MVP-2 ou destino já aprovado |
| UI | §10, referência concreta, estados, temas, viewports e skills obrigatórias |
