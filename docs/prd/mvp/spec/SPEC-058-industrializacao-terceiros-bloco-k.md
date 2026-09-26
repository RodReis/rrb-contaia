# SPEC-058 — Industrialização efetuada por terceiros no Bloco K completo

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F58
> **Origem:** PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 26/09/2026

---

## 1. Objetivo

Importar de forma atômica a evidência fiscal de industrialização efetuada por terceiros para estabelecimento industrial ou equiparado de autopeças em Goiás, reconciliar participante, documentos fiscais, itens, quantidades e movimentos com as autoridades aprovadas e gerar internamente os registros `K250`, `K255` e as correções `K270/K275` restritas a essas origens para competências iguais ou posteriores a setembro de 2026.

A F58 recebe somente evidência fiscal de sistema externo em CSV ou JSON canônico. Ela não mantém pedido, ordem, execução, chão de fábrica, contrato com industrializador nem edição operacional dos apontamentos. Cada pacote forma revisão própria, imutável e segregada das F56 e F57, com manifesto de completude, diagnóstico, parser independente, revisão humana e integração à EFD da F52.

A fatia é `Grande` porque a mesma decisão fiscal precisa permanecer verificável de ponta a ponta: pacote de origem, participante, DF-e, reconciliação com estoque, geração dos registros, correção de apontamento, decisão segregada, artefatos e UI. Separar a correção ou a prova documental produziria uma revisão aprovada sem ciclo completo de retificação ou sem evidência auditável da operação.

## 2. Resultado observável

Em `Fiscal -> EFD ICMS/IPI -> Bloco K`, o usuário seleciona estabelecimento e competência e pode:

- consultar aplicabilidade, modalidade completa, pacote normativo e evidências;
- importar pacote CSV ou JSON com manifesto, participante, DF-e, itens produzidos, insumos consumidos e correções;
- declarar explicitamente que não houve operações F58 na competência;
- acompanhar validação, reconciliação, diagnóstico e divergências por operação, documento e item;
- revisar a prévia de `K250/K255` e, quando aplicável, `K270/K275`;
- aprovar ou rejeitar a revisão com segregação de funções;
- baixar arquivo canônico, TXT, manifesto, diagnóstico e relatório da revisão;
- identificar quando a revisão ou a EFD dependente ficou `STALE`.

Uma competência aplicável sem industrialização efetuada por terceiros continua aplicável: o manifesto declara zero operações, a revisão preserva essa evidência e nenhum registro é fabricado.

## 3. Recorte fiscal

| Eixo | Cobertura |
|---|---|
| Documento | EFD ICMS/IPI, Bloco K completo |
| Registros | `K250`, `K255` e `K270/K275` somente para corrigir essas origens |
| Operação | industrialização efetuada por terceiros, sob a perspectiva do autor da encomenda |
| Estabelecimento | industrial ou equiparado de autopeças |
| UF | Goiás |
| Período | competências a partir de setembro de 2026 |
| Regime | Lucro Presumido quando obrigado; Simples Nacional somente com obrigação comprovada |
| Saída | artefatos internos e composição da EFD F52, sem transmissão |

A aplicabilidade usa pacote oficial versionado e evidência do estabelecimento. Ausência, conflito ou insuficiência de enquadramento produz `INDETERMINATE`; o sistema não presume obrigação, dispensa, participante, consumo ou produção.

## 4. Dependências e autoridades

- F16 fornece o mecanismo de pacote normativo versionado.
- F17/F18 fornecem os DF-e capturados, normalizados e íntegros quando aplicáveis.
- F52 fornece o ciclo da EFD ICMS/IPI original ou retificadora interna.
- F54 é a autoridade de item, unidade canônica, posição e movimentos de estoque.
- F55 fornece o ciclo comum do Bloco K, modalidade, artefatos e integração.
- F56 fornece produção própria e consumo próprios; a revisão F58 permanece independente.
- O sistema externo é a autoridade dos apontamentos importados de produção e consumo em terceiro.

Nenhuma revisão F58 altera dados das F17/F18, F52, F54, F55 ou F56. Divergência bloqueia o pacote inteiro e volta ao sistema de origem ou à capacidade que detém a autoridade do dado.

## 5. Estados da revisão

`IMPORTED -> VALIDATING -> INDETERMINATE | INVALID | READY_FOR_REVIEW -> APPROVED | REJECTED -> STALE`

- `IMPORTED`: pacote íntegro recebido, ainda não validado.
- `VALIDATING`: schema, documentos, regras e reconciliação em processamento.
- `INDETERMINATE`: aplicabilidade ou fundamento normativo insuficiente ou conflitante.
- `INVALID`: pacote estruturalmente inválido ou incompatível com as autoridades.
- `READY_FOR_REVIEW`: validações concluídas e artefatos reproduzíveis.
- `APPROVED`: revisão aceita por aprovador segregado.
- `REJECTED`: revisão rejeitada com motivo obrigatório.
- `STALE`: fonte, documento, autoridade, pacote normativo ou dependência mudou após a revisão.

Estados terminais são imutáveis. Correção ocorre por novo pacote integral e nova revisão; não existe edição ou exclusão de linha importada.

## 6. Contrato de entrada

O pacote contém, no mínimo:

- versão do schema e identificadores de tenant, empresa, estabelecimento e competência;
- identificação e versão do sistema de origem;
- instante imutável de criação da revisão na origem;
- manifesto com arquivos, hashes, contagens e totais de controle;
- declaração explícita de existência ou ausência de operações F58;
- identificação estável do terceiro participante;
- chaves e papéis dos DF-e de remessa, retorno e industrialização aplicáveis;
- para cada produto resultante: data de reconhecimento, item, quantidade e unidade;
- para cada insumo consumido: data de reconhecimento, item, quantidade, unidade e vínculo inequívoco ao produto resultante;
- correções de períodos anteriores com competência, registro e apontamento originais;
- fatores de conversão versionados quando a unidade informada divergir da unidade canônica;
- vínculo estável de cada operação no sistema de origem.

Dados externos entram como `unknown`. Schema, manifesto, hash, cardinalidade, datas, competência, participante, documentos, itens, unidades, quantidades, vínculos, contagens e totais são validados antes de criar revisão utilizável.

O mesmo pacote, com o mesmo hash e escopo, é idempotente. Mesmo identificador com conteúdo diferente é conflito auditável e não substitui a revisão anterior.

## 7. Participante e prova documental

O manifesto identifica o terceiro que executou a industrialização e vincula os DF-e aplicáveis de remessa, retorno e industrialização. O participante e os documentos são evidência auxiliar obrigatória da revisão, ainda que não sejam serializados nos campos de `K250/K255`.

Bloqueiam o pacote:

- participante ausente, arquivado, divergente ou sem identificação estável;
- DF-e obrigatório ausente, cancelado, denegado, inidôneo ou fora do escopo da operação;
- emitente, destinatário, estabelecimento, item, unidade, quantidade ou período incompatível;
- documento reutilizado de forma incompatível entre operações;
- remessa ou retorno sem vínculo inequívoco com a operação importada.

Ausência de DF-e só deixa de bloquear quando pacote normativo oficial versionado comprovar que o documento não se aplica à hipótese concreta. A justificativa, fonte, vigência e decisão integram o manifesto e o hash; ausência comum nunca é tratada como exceção.

## 8. Itens produzidos — K250

Cada produto resultante válido gera `K250` com data de reconhecimento, item produzido e quantidade importada na unidade de controle de estoque.

Bloqueiam a revisão:

- item produzido inexistente, arquivado ou com tipo incompatível;
- data fora da competência;
- quantidade ausente, zero, negativa ou com precisão inválida;
- unidade sem conversão vigente e aprovada;
- movimento de entrada correspondente inexistente ou divergente na F54;
- vínculo ausente com participante, documentos ou sistema de origem;
- duplicidade incompatível da chave fiscal do apontamento.

A ContaIA não calcula rendimento, produção presumida, perda aceitável nem quantidade recebida. O valor vem da origem, é confrontado com as autoridades e não é ajustado para fazer o pacote fechar.

## 9. Insumos consumidos — K255

Cada produto `K250` possui um ou mais insumos `K255` quando houver consumo, preservando data de reconhecimento, item, quantidade e vínculo ao produto resultante conforme o leiaute vigente.

Bloqueiam a revisão:

- `K255` órfão ou ligado ambiguamente a mais de um produto;
- item inexistente, arquivado ou incompatível;
- data fora da competência ou incompatível com a operação;
- quantidade ausente, zero, negativa ou com precisão inválida;
- unidade sem conversão vigente e aprovada;
- movimento de saída correspondente inexistente ou divergente na F54;
- insumo ou quantidade incompatível com os DF-e e apontamentos vinculados;
- quebra da hierarquia ou cardinalidade do pacote oficial.

A F58 não presume consumo pelo cadastro de produto, por fórmula técnica, por diferença de estoque ou pelo documento fiscal isolado.

## 10. Correções — K270 e K275

`K270/K275` entram na F58 somente quando corrigirem apontamentos `K250/K255` cobertos por revisão F58 anterior. O pacote informa competência, registro, chave e valores originais, correção pretendida e evidência que a sustenta.

Bloqueiam a correção:

- origem inexistente, não aprovada, `STALE` ou pertencente a outra capacidade;
- vínculo ambíguo com apontamento anterior;
- tentativa de usar correção como ajuste genérico de estoque;
- alteração sem documento e movimento reconciliados;
- duplicidade ou sobreposição incompatível com correção anterior;
- tentativa de apagar a revisão ou o apontamento original.

A correção preserva a revisão anterior, integra nova revisão imutável e compõe somente EFD interna original ou retificadora permitida pela F52. Ela não corrige fonte externa, DF-e ou estoque automaticamente.

## 11. Conversão, reconciliação e atomicidade

Quantidade é reconciliada na unidade canônica da F54. Conversão exige fator explícito, positivo, versionado, vigente e previamente aprovado para o item e par de unidades.

Float é proibido. O cálculo usa decimal exato, preserva a precisão interna e arredonda somente na serialização conforme o pacote oficial.

Qualquer divergência de participante, documento, item, vínculo, conversão, quantidade ou movimento bloqueia o pacote inteiro. Não existe aprovação parcial, exclusão local de linha, tolerância configurável, compensação entre operações, saldo implícito ou ajuste automático.

## 12. Composição, artefatos e hash

A revisão gera:

- fragmento canônico com `K250/K255` e correções `K270/K275` aplicáveis;
- TXT interno na ordem e cardinalidade do leiaute vigente;
- manifesto com escopo, participante, documentos, autoridades, versões, contagens, hashes e resultado da reconciliação;
- diagnóstico estruturado por operação, documento, item e regra;
- relatório legível para revisão humana;
- resultado de parser independente comparado à projeção canônica.

O payload canônico inclui o instante imutável de criação da revisão. Instantes de download ou visualização pertencem apenas à auditoria e não alteram o hash.

Mesmo conjunto de entradas, autoridades e pacote normativo produz os mesmos artefatos e hashes.

## 13. Aprovação e integração

Somente `READY_FOR_REVIEW` pode seguir para `APPROVED` ou `REJECTED`. Importador e preparador não podem aprovar a própria revisão. A aprovação cabe a `contador` ou `admin_escritorio` distinto, dentro da carteira autorizada.

A F52 consome somente revisão F58 `APPROVED`, íntegra, aplicável e não `STALE`. A composição respeita ordem e cardinalidades oficiais e convive com revisões aprovadas das F55, F56 e F57 sem fundir autoridades.

Nova fonte, documento, revisão relevante das F52/F54/F55/F56, conversão ou pacote normativo marca a F58 e a EFD dependente como `STALE`. Não existe recálculo, aprovação ou retificação externa automática.

## 14. Contratos de domínio

### `ThirdPartyManufacturingRevision`

- identifica tenant, empresa, estabelecimento, competência e pacote;
- referencia hashes e versões das autoridades consumidas;
- mantém estado, versão otimista, autor, aprovador e motivo de rejeição;
- é imutável após decisão.

### `ThirdPartyManufacturingOperation`

- mantém chave da origem, participante, documentos, data e produto resultante;
- possui um ou mais consumos vinculados quando aplicável;
- não é editável na ContaIA.

### `ThirdPartyConsumedInput`

- mantém item, data, quantidade, unidade e vínculo inequívoco ao produto resultante;
- referencia o movimento reconciliado da F54;
- não é editável na ContaIA.

### `ThirdPartyManufacturingCorrection`

- identifica competência, revisão, registro e apontamento originais;
- mantém valores corrigidos, evidências e vínculos de reconciliação;
- nunca substitui nem apaga a origem.

### `ThirdPartyZeroOperationDeclaration`

- declara ausência de operações F58 na competência aplicável;
- integra manifesto, aprovação e hash da revisão;
- não altera a decisão de aplicabilidade.

## 15. Autorização, isolamento e auditoria

- `auxiliar`: importa e consulta dentro da carteira; não aprova.
- `contador`: importa, revisa e aprova revisão preparada por outro usuário.
- `admin_escritorio`: mesmas ações dentro do tenant, preservada a segregação.
- `auditor_readonly`: consulta revisões e artefatos; não altera estado.
- `cliente_portal` e demais papéis sem permissão fiscal: acesso negado.

Toda tabela transacional possui `tenant_id` e `empresa_id`, ambos obrigatórios e sob RLS. Consulta sem contexto não retorna dados. Importação, validação, conflito, decisão, download e propagação de `STALE` entram em auditoria append-only.

## 16. Concorrência e falhas

- alteração concorrente usa versão otimista e retorna HTTP 409 em conflito;
- pacote parcial, hash divergente ou manifesto incompatível falha atomicamente;
- timeout ou indisponibilidade preserva o último estado consistente e permite retentativa idempotente;
- erro segue `application/problem+json` com código estável e `correlationId`;
- nenhuma falha parcial cria fragmento consumível pela F52.

## 17. Invariantes globais tocados

| Invariante | Aplicação na F58 |
|---|---|
| I-1 | revisões, operações, consumos e correções carregam `tenant_id` e `empresa_id`, indexados e sob RLS |
| I-2 | ausência de contexto retorna conjunto vazio |
| I-4 | validação e reconciliação são determinísticas; LLM não calcula nem decide aplicabilidade |
| I-5 | integração fiscal exige aprovação humana registrada |
| I-6 | trilha e decisões são append-only |
| I-7 | revisão, apontamento e correção fiscal não são apagados |
| I-8 | pacote normativo é selecionado pela competência do fato e da correção |
| I-9 | importação e composição são idempotentes |
| I-11 | competência e datas fiscais são civis; timestamps são exibidos em `America/Sao_Paulo` |
| I-12 | mesma entrada e mesmas versões reproduzem artefatos e hashes |

## 18. Contrato de UI

A tela parte de `docs/telas/contaia_central_de_escritura_o_sped_ecd_malha_fiscal_preventiva_rf_03/` para conteúdo, fluxo, hierarquia e densidade, sem copiar transmissão, recibo ou indicadores fictícios.

Em `Fiscal -> EFD ICMS/IPI -> Bloco K`, apresenta:

- seletor de estabelecimento e competência;
- aplicabilidade, modalidade, vigência e evidências;
- card próprio para industrialização efetuada por terceiros;
- importação por arquivo e resumo do manifesto;
- declaração explícita de zero operações;
- participante e DF-e vinculados com estado de reconciliação;
- tabela hierárquica de produtos e insumos consumidos;
- correções vinculadas aos apontamentos originais;
- divergências, bloqueios e vínculos com F52/F54/F55/F56;
- histórico de revisões, decisão e estado `STALE`;
- ações de revisar, aprovar, rejeitar e baixar artefatos conforme permissão.

Estados obrigatórios: carregando, vazio sem pacote, zero declarado, importando, validando, indeterminado, inválido, pronto para revisão, aprovado, rejeitado, `STALE`, erro recuperável e acesso negado.

A implementação entrega temas CLARO e ESCURO, viewports de 375, 768, 1280 e 1536 px, navegação por teclado, foco visível, semântica, contraste e mensagens por Toast/Sonner. `frontend-design` é usada antes e durante a implementação; `impeccable`, no acabamento. A PR prova comparação com o protótipo, responsividade, estados, acessibilidade e o passe final de `FRONTEND.md` §20.1.

## 19. Critérios de aceite verificáveis

| Categoria | Prova obrigatória |
|---|---|
| Recorte | Goiás, autopeças, estabelecimento, regime, competência e aplicabilidade comprovados; insuficiência resulta em `INDETERMINATE` |
| Entrada | CSV/JSON, schema, manifesto, hash, idempotência, pacote parcial e identificador conflitante |
| Documentos | participante, remessa, retorno e industrialização reconciliados; ausência só aceita com não aplicabilidade oficial comprovada |
| K250 | item, data, quantidade, unidade, movimento de entrada, documento e chave fiscal válidos |
| K255 | vínculo ao produto, item, data, quantidade, unidade, movimento de saída e cardinalidade válidos |
| Correção | `K270/K275` vinculados somente a `K250/K255` F58 anteriores; origem e revisão preservadas |
| Zero | competência aplicável sem operação gera declaração, revisão e manifesto, sem fabricar registros |
| Atomicidade | qualquer divergência bloqueia o pacote inteiro; não há aprovação parcial nem exclusão local |
| Artefatos | TXT, manifesto, diagnóstico, relatório, parser independente e hashes reproduzíveis |
| Banco | RLS, carteira, concorrência, append-only, supersessão e propagação de `STALE` |
| Autorização | preparador não aprova; papéis permitidos e negados são cobertos |
| UI | comparação visual, CLARO/ESCURO, quatro viewports, estados, teclado, foco e contraste |
| Integração | F52 consome somente revisão `APPROVED`, íntegra e não `STALE`; nenhuma operação externa ocorre |

## 20. Fora de escopo e destinos obrigatórios

| Item | Destino obrigatório |
|---|---|
| Reprocessamento/reparo (`K260/K265`) | capacidade própria posterior do MVP-2, sem F/SPEC reservada antecipadamente |
| Correções de F57 ainda não cobertas | capacidade própria posterior do MVP-2 para correções de operações especiais, sem F/SPEC reservada antecipadamente |
| Produção conjunta (`K290` a `K302`) | capacidade própria posterior do MVP-2, sem F/SPEC reservada antecipadamente |
| ERP, pedido, ordem, planejamento, execução, contrato ou chão de fábrica | excluído pelo PRD §1.5 |
| Integração genérica com ERP/WMS | capacidade própria de integrações de estoque do MVP-2 |
| Lote, validade e número de série | capacidade própria de rastreabilidade avançada de estoque do MVP-2 |
| Outras UFs, segmentos e períodos | expansão fiscal própria do MVP-2 |
| Lucro Real e não cumulatividade | capacidades tributárias próprias do MVP-2 |
| PVA, assinatura, transmissão, recibo e substituição oficial | capacidade própria de entrega oficial após geração interna validada |
| Produção, piloto, pagamento ou efeito fiscal externo | gate de produção posterior ao MVP-4 |

## 21. Dúvidas resolvidas

| Pergunta | Decisão do PI em 26/09/2026 |
|---|---|
| Qual capacidade ocupa F58/SPEC-058? | industrialização efetuada por terceiros, `K250/K255` |
| Qual é a fonte dos apontamentos? | pacote externo CSV/JSON com conciliação |
| Qual recorte fiscal? | mesmo recorte da F57: Goiás, autopeças, estabelecimento industrial/equiparado, desde setembro/2026; Lucro Presumido quando obrigado e Simples somente com obrigação comprovada |
| Como tratar divergência? | bloquear o pacote inteiro |
| Correções entram na fatia? | sim, `K270/K275` somente para origens `K250/K255` da F58 |
| Qual prova identifica o terceiro? | participante e DF-e vinculados, salvo não aplicabilidade oficial comprovada |
| Qual ciclo de revisão? | mesmo ciclo da F57, com segregação de funções |
| Como tratar competência aplicável sem operação? | declaração explícita de zero |
| Há questões abertas? | Nenhuma |
