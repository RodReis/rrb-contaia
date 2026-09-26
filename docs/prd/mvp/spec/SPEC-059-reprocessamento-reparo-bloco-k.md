# SPEC-059 — Reprocessamento e reparo no Bloco K completo

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F59
> **Origem:** PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 26/09/2026

---

## 1. Objetivo

Importar de forma atômica a evidência fiscal de reprocessamento e reparo executados no próprio estabelecimento industrial ou equiparado de autopeças em Goiás, reconciliá-la com o estoque aprovado da F54 e gerar internamente os registros `K260`, `K265` e as correções `K270/K275` com origem `4` para competências iguais ou posteriores a setembro de 2026.

A F59 cobre somente operação em que o produto ou insumo permanece com o mesmo código depois do reprocessamento ou reparo. Ela recebe evidência fiscal de sistema externo em CSV ou JSON canônico, acompanha saída, retorno, consumo e devolução inclusive quando o ciclo atravessa competências, e não mantém ordem, execução, chão de fábrica nem edição operacional dos apontamentos.

A fatia é `Grande` porque precisa manter verificável o ciclo fiscal completo: pacote de origem, operação aberta ou encerrada, reconciliação com estoque, correção, decisão segregada, artefatos, integração e UI. Separar o retorno entre competências ou a correção produziria revisão aprovada sem continuidade fiscal completa.

## 2. Resultado observável

Em `Fiscal -> EFD ICMS/IPI -> Bloco K`, o usuário seleciona estabelecimento e competência e pode:

- consultar aplicabilidade, modalidade completa, pacote normativo e evidências;
- importar pacote CSV ou JSON com manifesto, ordens quando aplicáveis, itens, saídas, retornos, consumos, devoluções e correções;
- declarar explicitamente que não houve operações F59 na competência;
- acompanhar operações abertas que aguardam retorno em competência posterior;
- revisar a prévia de `K260/K265` e, quando aplicável, `K270/K275` com origem `4`;
- acompanhar validação, reconciliação e divergências por operação, item e movimento;
- aprovar ou rejeitar a revisão com segregação de funções;
- baixar arquivo canônico, TXT, manifesto, diagnóstico e relatório da revisão;
- identificar quando a revisão ou a EFD dependente ficou `STALE`.

Uma competência aplicável sem reprocessamento ou reparo continua aplicável: o manifesto declara zero operações, a revisão preserva essa evidência e nenhum registro é fabricado.

## 3. Recorte fiscal

| Eixo | Cobertura |
|---|---|
| Documento | EFD ICMS/IPI, Bloco K completo |
| Registros | `K260`, `K265` e `K270/K275` somente com origem `4` para corrigir essas origens |
| Operação | reprocessamento e reparo no próprio estabelecimento, mantendo o mesmo código do item |
| Estabelecimento | industrial ou equiparado de autopeças |
| UF | Goiás |
| Período | competências a partir de setembro de 2026 |
| Regime | Lucro Presumido quando obrigado; Simples Nacional somente com obrigação comprovada |
| Saída | artefatos internos e composição da EFD F52, sem transmissão |

A aplicabilidade usa pacote oficial versionado, incluindo o Guia Prático EFD ICMS/IPI 3.2.4 e a legislação vigente para a competência. Ausência, conflito ou insuficiência produz `INDETERMINATE`; o sistema não presume obrigação, dispensa, operação, retorno, consumo ou quantidade.

## 4. Dependências e autoridades

- F16 fornece o mecanismo de pacote normativo versionado.
- F52 fornece o ciclo da EFD ICMS/IPI original ou retificadora interna.
- F54 é a autoridade de item, unidade canônica, posição e movimentos de estoque.
- F55 fornece o ciclo comum do Bloco K, modalidade, artefatos e integração.
- F56 fornece produção própria e consumo; a revisão F59 permanece independente.
- O sistema externo é a autoridade dos apontamentos e identificadores de ordem importados.

Nenhuma revisão F59 altera dados das F52, F54, F55 ou F56. Divergência bloqueia o pacote inteiro e volta ao sistema de origem ou à capacidade que detém a autoridade do dado.

## 5. Estados da revisão e da operação

Revisão:

`IMPORTED -> VALIDATING -> INDETERMINATE | INVALID | READY_FOR_REVIEW -> APPROVED | REJECTED -> STALE`

- `IMPORTED`: pacote íntegro recebido, ainda não validado;
- `VALIDATING`: schema, regras, vínculos e reconciliação em processamento;
- `INDETERMINATE`: aplicabilidade ou fundamento normativo insuficiente ou conflitante;
- `INVALID`: pacote estruturalmente inválido ou incompatível com as autoridades;
- `READY_FOR_REVIEW`: validações concluídas e artefatos reproduzíveis;
- `APPROVED`: revisão aceita por aprovador segregado;
- `REJECTED`: revisão rejeitada com motivo obrigatório;
- `STALE`: fonte, autoridade, pacote normativo ou dependência mudou após a revisão.

Operação:

- `OPEN`: saída escriturada sem retorno concluído; exige `COD_OP_OS` estável;
- `CLOSED`: retorno informado e reconciliado;
- `CORRECTED`: nova revisão aprovou correção da operação, preservando a origem.

Estados decididos são imutáveis. Correção ocorre por novo pacote integral e nova revisão; não existe edição ou exclusão de linha importada.

## 6. Contrato de entrada

O pacote contém, no mínimo:

- versão do schema e identificadores de tenant, empresa, estabelecimento e competência;
- identificação e versão do sistema de origem;
- instante imutável de criação da revisão na origem;
- manifesto com arquivos, hashes, contagens e totais de controle;
- declaração explícita de existência ou ausência de operações F59;
- identificador estável da operação e `COD_OP_OS` quando existente ou obrigatório;
- item reprocessado ou reparado, sempre com o mesmo código antes e depois;
- datas e quantidades de saída e, quando ocorrido, de retorno;
- mercadorias consumidas e/ou retornadas, com quantidades e unidades;
- correções de períodos anteriores com competência, registro e apontamento originais;
- fatores de conversão versionados quando a unidade informada divergir da unidade canônica.

Dados externos entram como `unknown`. Schema, manifesto, hash, chaves, datas, competências, itens, unidades, quantidades, vínculos, contagens e totais são validados antes de criar revisão utilizável.

O mesmo pacote, com o mesmo hash e escopo, é idempotente. Mesmo identificador com conteúdo diferente é conflito auditável e não substitui a revisão anterior.

## 7. Reprocessamento e reparo — K260

Cada operação válida gera `K260` com item, data e quantidade de saída e, quando ocorrido, data e quantidade de retorno.

Regras obrigatórias:

- a operação ocorre no próprio estabelecimento informante;
- o item mantém o mesmo código antes e depois;
- datas e quantidades são reconciliadas com movimentos imutáveis da F54;
- retorno, quando informado, ocorre em data igual ou posterior à saída;
- saída e retorno usam a unidade de controle de estoque da F54;
- operação sem retorno na competência permanece `OPEN` e exige `COD_OP_OS` estável;
- o retorno posterior referencia inequivocamente a mesma operação aberta.

Bloqueiam a revisão: execução externa, troca de código, item inexistente ou arquivado, quantidade negativa ou com precisão inválida, unidade sem conversão aprovada, retorno sem saída, operação aberta sem ordem, ordem reutilizada de forma incompatível, movimento ausente ou divergente e retorno duplicado.

A ContaIA não cria ordem nem presume rendimento, perda, consumo, retorno ou encerramento. Ausência de retorno não equivale a zero nem encerra a operação.

## 8. Mercadorias consumidas ou retornadas — K265

Cada `K265` pertence inequivocamente a um `K260` e informa mercadoria consumida, retornada ou ambas. Pelo menos `QTD_CONS` ou `QTD_RET` deve estar preenchida; nenhuma quantidade pode ser negativa.

Bloqueiam a revisão:

- registro órfão ou vínculo ambíguo;
- mercadoria com o mesmo código do item reprocessado ou reparado;
- tipo de item incompatível com o leiaute vigente;
- quantidade negativa, precisão inválida ou ambos os campos ausentes;
- unidade sem conversão vigente e aprovada;
- movimento correspondente inexistente ou divergente na F54;
- consumo ou retorno incompatível com a competência e a operação vinculada.

A F59 não infere consumo por ficha técnica, diferença de estoque ou histórico. O pacote externo informa o apontamento e a ContaIA apenas valida e reconcilia.

## 9. Ciclo entre competências

Uma saída pode permanecer aberta para competência posterior somente quando o pacote identifica `COD_OP_OS`. A revisão aprovada registra o vínculo, a competência da saída e o saldo quantitativo pendente.

Quando o retorno ocorre:

- o novo pacote referencia a operação aberta e sua revisão aprovada;
- a data pertence à competência corrente e não antecede a saída;
- movimentos e unidades reconciliam exatamente com a F54;
- a operação só passa a `CLOSED` quando o retorno informado estiver integralmente comprovado e reconciliado.

Pacote posterior ausente, duplicado, conflitante ou ligado a revisão `STALE` não encerra a operação. Nenhum fechamento é inferido pela passagem do tempo.

## 10. Correções — K270 e K275

`K270/K275` entram na F59 somente com origem `4` e quando corrigem `K260/K265` cobertos por revisão F59 anterior. O pacote informa competência, ordem quando aplicável, registro, item, apontamento original, correção positiva ou negativa e evidência correspondente.

Bloqueiam a correção:

- origem diferente de `4`;
- apontamento inexistente, não aprovado, `STALE` ou pertencente a outra capacidade;
- correção fora das regras temporais ou de inventário do pacote oficial;
- correções positiva e negativa simultâneas;
- vínculo ambíguo, duplicidade ou sobreposição incompatível;
- tentativa de usar correção como ajuste genérico de estoque ou apagar a origem.

A correção preserva a revisão anterior, integra nova revisão imutável e reavalia o estado quantitativo da operação aberta ou encerrada. Ela não corrige a fonte externa nem o estoque automaticamente.

## 11. Conversão, reconciliação e atomicidade

Quantidade é reconciliada na unidade canônica da F54. Conversão exige fator explícito, positivo, versionado, vigente e aprovado para o item e par de unidades.

Float é proibido. O cálculo usa decimal exato, preserva a precisão interna e arredonda somente na serialização conforme o pacote oficial.

Qualquer divergência de item, ordem, vínculo, data, conversão, quantidade ou movimento bloqueia o pacote inteiro. Não existe aprovação parcial, exclusão local de linha, tolerância configurável, compensação entre operações, saldo implícito ou ajuste automático.

## 12. Composição, artefatos e hash

A revisão gera:

- fragmento canônico com `K260/K265` e correções `K270/K275` de origem `4`;
- TXT interno na ordem e cardinalidade do leiaute vigente;
- manifesto com escopo, operações abertas e encerradas, autoridades, versões, contagens, hashes e reconciliação;
- diagnóstico estruturado por operação, item, movimento e regra;
- relatório legível para revisão humana;
- resultado de parser independente comparado à projeção canônica.

O payload canônico inclui o instante imutável de criação da revisão. Instantes de download ou visualização pertencem apenas à auditoria e não alteram o hash. Mesmas entradas, autoridades e pacote normativo produzem os mesmos artefatos e hashes.

## 13. Aprovação e integração

Somente `READY_FOR_REVIEW` pode seguir para `APPROVED` ou `REJECTED`. Importador e preparador não podem aprovar a própria revisão. A aprovação cabe a `contador` ou `admin_escritorio` distinto, dentro da carteira autorizada.

A F52 consome somente revisão F59 `APPROVED`, íntegra, aplicável e não `STALE`. A composição respeita ordem e cardinalidades oficiais e convive com revisões aprovadas das F55 a F58 sem fundir autoridades.

Nova fonte, revisão relevante das F52/F54/F55/F56, conversão ou pacote normativo marca a F59 e a EFD dependente como `STALE`. Não existe recálculo, aprovação ou retificação externa automática.

## 14. Contratos de domínio

### `ReprocessingRepairRevision`

- identifica tenant, empresa, estabelecimento, competência e pacote;
- referencia hashes e versões das autoridades consumidas;
- mantém estado, versão otimista, autor, aprovador e motivo de rejeição;
- é imutável após decisão.

### `ReprocessingRepairOperation`

- mantém chave da origem, ordem quando aplicável, item, saída, retorno e estado;
- preserva vínculo entre competências;
- não é editável na ContaIA.

### `ReprocessingRepairMaterial`

- mantém item, quantidades consumida e retornada e unidade;
- referencia a operação e os movimentos reconciliados da F54;
- não é editável na ContaIA.

### `ReprocessingRepairCorrection`

- identifica competência, revisão, registro e apontamento originais;
- usa origem `4` e mantém valores corrigidos e evidências;
- nunca substitui nem apaga a origem.

### `ReprocessingRepairZeroDeclaration`

- declara ausência de operações F59 na competência aplicável;
- integra manifesto, aprovação e hash da revisão;
- não altera a decisão de aplicabilidade.

## 15. Autorização, isolamento e auditoria

- `auxiliar`: importa e consulta dentro da carteira; não aprova;
- `contador`: importa, revisa e aprova revisão preparada por outro usuário;
- `admin_escritorio`: mesmas ações dentro do tenant, preservada a segregação;
- `auditor_readonly`: consulta revisões e artefatos; não altera estado;
- `cliente_portal` e demais papéis sem permissão fiscal: acesso negado.

Toda tabela transacional possui `tenant_id` e `empresa_id`, obrigatórios e sob RLS. Consulta sem contexto não retorna dados. Importação, validação, conflito, decisão, download, mudança de estado operacional e propagação de `STALE` entram em auditoria append-only.

## 16. Concorrência e falhas

- alteração concorrente usa versão otimista e retorna HTTP 409;
- pacote parcial, hash divergente ou manifesto incompatível falha atomicamente;
- timeout ou indisponibilidade preserva o último estado consistente e permite retentativa idempotente;
- erro segue `application/problem+json` com código estável e `correlationId`;
- nenhuma falha parcial cria fragmento consumível pela F52 nem encerra operação aberta.

## 17. Invariantes globais tocados

| Invariante | Aplicação na F59 |
|---|---|
| I-1 | revisões, operações, materiais e correções carregam `tenant_id` e `empresa_id`, indexados e sob RLS |
| I-2 | ausência de contexto retorna conjunto vazio |
| I-4 | validação e reconciliação são determinísticas; LLM não calcula nem decide aplicabilidade |
| I-5 | integração fiscal exige aprovação humana registrada |
| I-6 | trilha e decisões são append-only |
| I-7 | revisão, operação e correção fiscal não são apagadas |
| I-8 | pacote normativo é selecionado pela competência do fato e da correção |
| I-9 | importação e composição são idempotentes |
| I-11 | competência e datas fiscais são civis; timestamps são exibidos em `America/Sao_Paulo` |
| I-12 | mesmas entradas e versões reproduzem artefatos e hashes |

## 18. Contrato de UI

A tela parte de `docs/telas/contaia_central_de_escritura_o_sped_ecd_malha_fiscal_preventiva_rf_03/` para conteúdo, fluxo, hierarquia e densidade, sem copiar transmissão, recibo ou indicadores fictícios.

Em `Fiscal -> EFD ICMS/IPI -> Bloco K`, apresenta:

- seletor de estabelecimento e competência;
- aplicabilidade, modalidade, vigência e evidências;
- card próprio para reprocessamento e reparo;
- importação por arquivo, manifesto e declaração explícita de zero;
- operações abertas e encerradas, com ordem, saída, retorno e competência;
- materiais consumidos e retornados;
- correções de origem `4` vinculadas aos apontamentos originais;
- divergências e vínculos com F52/F54/F55/F56;
- histórico de revisões, decisão e estado `STALE`;
- ações de revisar, aprovar, rejeitar e baixar artefatos conforme permissão.

Estados obrigatórios: carregando, vazio sem pacote, zero declarado, importando, validando, indeterminado, inválido, operação aberta, operação encerrada, pronto para revisão, aprovado, rejeitado, `STALE`, erro recuperável e acesso negado.

A implementação entrega temas CLARO e ESCURO, viewports de 375, 768, 1280 e 1536 px, navegação por teclado, foco visível, semântica, contraste e mensagens por Toast/Sonner. `frontend-design` é usada antes e durante a implementação; `impeccable`, no acabamento. A PR prova comparação com o protótipo, responsividade, estados, acessibilidade e o passe final de `FRONTEND.md` §20.1.

## 19. Critérios de aceite verificáveis

| Categoria | Prova obrigatória |
|---|---|
| Recorte | Goiás, autopeças, próprio estabelecimento, mesmo código, regime, competência e aplicabilidade comprovados; insuficiência resulta em `INDETERMINATE` |
| Entrada | CSV/JSON, schema, manifesto, hash, idempotência, pacote parcial e identificador conflitante |
| K260 | item, ordem, saída, retorno, datas, quantidades, unidade e movimentos válidos |
| K265 | vínculo ao K260, item distinto, consumo/retorno, tipo, unidade e movimentos válidos |
| Multiperíodo | saída aberta exige ordem; retorno posterior referencia a origem e encerra somente com prova integral e reconciliação |
| Correção | `K270/K275` com origem `4`, vinculados somente a F59 anterior e preservando a origem |
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
| Reprocessamento ou reparo fora do estabelecimento | não usar `K260`; expansão fiscal própria do MVP-2 somente se fonte oficial definir registro aplicável |
| Troca do código do item durante o processo | capacidade fiscal própria posterior do MVP-2 conforme registro oficial aplicável |
| Correções de F57 ainda não cobertas | capacidade própria posterior do MVP-2 para correções de operações especiais |
| Produção conjunta (`K290` a `K302`) | capacidade própria posterior do MVP-2 |
| ERP, ordem, planejamento, execução ou chão de fábrica | excluído pelo PRD §1.5; F59 apenas importa identificador e evidência fiscal externos |
| Integração genérica com ERP/WMS | capacidade própria de integrações de estoque do MVP-2 |
| Lote, validade e número de série | capacidade própria de rastreabilidade avançada de estoque do MVP-2 |
| Outras UFs, segmentos e períodos | expansão fiscal própria do MVP-2 |
| Lucro Real e não cumulatividade | capacidades tributárias próprias do MVP-2 |
| PVA, assinatura, transmissão, recibo e substituição oficial | capacidade própria de entrega oficial após geração interna validada |
| Produção, piloto, pagamento ou efeito fiscal externo | gate de produção posterior ao MVP-4 |

## 21. Dúvidas resolvidas

| Pergunta | Decisão do PI em 26/09/2026 |
|---|---|
| Qual capacidade ocupa F59/SPEC-059? | reprocessamento e reparo, `K260/K265` |
| Correções entram na fatia? | sim, `K270/K275` somente com origem `4` para apontamentos F59 |
| Quais operações entram? | reprocessamento e reparo no próprio estabelecimento, mantendo o mesmo código |
| Qual é a fonte dos apontamentos? | pacote externo CSV/JSON com manifesto, reconciliação e zero explícito |
| Operações podem atravessar competências? | sim; saída sem retorno exige ordem e o retorno posterior referencia a operação aberta |
| Qual recorte fiscal? | Goiás, autopeças, estabelecimento industrial/equiparado, desde setembro/2026; Lucro Presumido quando obrigado e Simples somente com obrigação comprovada |
| Como tratar divergência? | bloquear o pacote inteiro |
| Qual ciclo de revisão? | mesmo ciclo da F58, com segregação de funções |
| Há questões abertas? | Nenhuma |
