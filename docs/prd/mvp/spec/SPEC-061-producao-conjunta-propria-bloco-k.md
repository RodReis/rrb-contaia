# SPEC-061 — Produção conjunta própria no Bloco K completo

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F61
> **Origem:** PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16
> **Tamanho:** Médio
> **Estado:** aprovada pelo PI em 26/09/2026

---

## 1. Objetivo

Importar de forma atômica a evidência fiscal de produção conjunta realizada no próprio estabelecimento industrial ou equiparado de autopeças em Goiás, reconciliá-la com o estoque aprovado da F54 e gerar internamente `K290`, `K291` e `K292` no Bloco K completo para competências iguais ou posteriores a setembro de 2026.

A F61 recebe somente pacote CSV ou JSON de sistema externo. Cada pacote forma revisão própria, imutável e segregada das F56 a F60, com manifesto de completude, declaração explícita de zero operações, diagnóstico, parser independente, revisão humana e integração à EFD da F52. A ContaIA não mantém ordem operacional, planejamento, execução, rateio, rendimento ou chão de fábrica.

## 2. Resultado observável

Em `Fiscal -> EFD ICMS/IPI -> Bloco K`, o usuário seleciona estabelecimento e competência e pode:

- consultar aplicabilidade, modalidade completa, pacote normativo e evidências;
- importar pacote CSV ou JSON com manifesto, ordens de produção conjunta, produtos e insumos;
- declarar explicitamente que não houve produção conjunta própria na competência;
- acompanhar validação, reconciliação, diagnóstico e divergências por ordem, item e movimento;
- revisar a prévia hierárquica de `K290/K291/K292`;
- aprovar ou rejeitar a revisão com segregação de funções;
- baixar arquivo canônico, TXT, manifesto, diagnóstico e relatório;
- identificar quando a revisão ou a EFD dependente ficou `STALE`.

Competência aplicável sem produção conjunta própria exige declaração explícita de zero. A revisão preserva a evidência e não fabrica `K290`, `K291` ou `K292`.

## 3. Recorte fiscal

| Eixo | Cobertura |
|---|---|
| Documento | EFD ICMS/IPI, Bloco K completo |
| Registros | `K290`, `K291` e `K292` |
| Operação | produção conjunta no próprio estabelecimento |
| Estabelecimento | industrial ou equiparado de autopeças |
| UF | Goiás |
| Período | competências a partir de setembro de 2026 |
| Regime | Lucro Presumido quando obrigado; Simples Nacional somente com obrigação comprovada |
| Saída | artefatos internos e composição da EFD F52, sem transmissão |

A aplicabilidade usa pacote oficial versionado e evidência do estabelecimento. Ausência, conflito ou insuficiência produz `INDETERMINATE`; o sistema não presume obrigação, dispensa ou enquadramento.

## 4. Dependências e autoridades

- F16 fornece o mecanismo de pacote normativo versionado.
- F52 fornece o ciclo da EFD ICMS/IPI original ou retificadora interna.
- F54 é a autoridade de item, unidade canônica, posição e movimentos de estoque.
- F55 fornece o ciclo comum do Bloco K, modalidade, artefatos e integração.
- F56 fornece a estrutura `0210`, a produção própria e o consumo comum quando também aplicáveis; sua revisão permanece independente.
- O sistema externo é a autoridade das ordens e dos apontamentos importados de produção conjunta própria.

Nenhuma revisão F61 altera dados das F52, F54, F55 ou F56. Divergência bloqueia o pacote inteiro e volta ao sistema de origem ou à capacidade que detém a autoridade do dado.

## 5. Estados da revisão

`IMPORTED -> VALIDATING -> INDETERMINATE | INVALID | READY_FOR_REVIEW -> APPROVED | REJECTED -> STALE`

- `IMPORTED`: pacote íntegro recebido, ainda não validado;
- `VALIDATING`: schema, completude, regras e reconciliação em processamento;
- `INDETERMINATE`: aplicabilidade ou fundamento normativo insuficiente ou conflitante;
- `INVALID`: pacote estruturalmente inválido ou incompatível com as autoridades;
- `READY_FOR_REVIEW`: validações concluídas e artefatos reproduzíveis;
- `APPROVED`: revisão aceita por aprovador segregado;
- `REJECTED`: revisão rejeitada com motivo obrigatório;
- `STALE`: fonte, autoridade, pacote normativo ou dependência mudou após a revisão.

Estados decididos são imutáveis. Correção ocorre na autoridade de origem e entra por novo pacote integral e nova revisão; nenhuma linha importada é editada na ContaIA.

## 6. Contrato de entrada

O pacote contém, no mínimo:

- versão do schema e identificadores de tenant, empresa, estabelecimento e competência;
- identificação e versão do sistema de origem;
- instante imutável de criação da revisão na origem;
- manifesto com arquivos, hashes, contagens e totais de controle;
- declaração explícita de existência ou ausência de produção conjunta própria;
- para cada ordem: chave estável da origem, identificação documental exigida pelo leiaute e datas de início e término, quando aplicável;
- um ou mais produtos resultantes, com item, quantidade e unidade;
- um ou mais insumos consumidos, com item, quantidade e unidade;
- fatores de conversão versionados quando a unidade informada divergir da unidade canônica;
- vínculos estáveis com os movimentos de estoque correspondentes.

Dados externos entram como `unknown`. Schema, manifesto, hash, cardinalidades, datas, competência, itens, unidades, quantidades, vínculos, contagens e totais são validados antes de criar revisão utilizável.

O mesmo pacote, com o mesmo hash e escopo, é idempotente. Mesmo identificador com conteúdo diferente é conflito auditável e não substitui a revisão anterior.

## 7. Ordem de produção conjunta — K290

Cada ordem válida gera um `K290` conforme campos, hierarquia, cardinalidade e temporalidade do pacote oficial vigente.

Ordem iniciada em competência anterior pode permanecer em andamento quando o leiaute permitir e a cadeia do sistema externo for contínua. A revisão bloqueia lacuna, sobreposição incompatível, encerramento anterior ao início, reabertura indevida ou divergência entre competências.

Bloqueiam a revisão:

- chave de origem ausente, duplicada ou conflitante;
- datas impossíveis ou incompatíveis com a competência e o leiaute;
- ordem sem ao menos um produto e um insumo;
- estabelecimento ou operação divergente do escopo;
- vínculo ausente ou ambíguo com os movimentos da F54;
- quebra da hierarquia ou cardinalidade oficial.

## 8. Produtos e insumos — K291 e K292

Cada produto resultante válido gera `K291`; cada insumo consumido válido gera `K292`, ambos vinculados inequivocamente ao `K290` correspondente.

Bloqueiam a revisão:

- item inexistente, arquivado ou incompatível na F54;
- quantidade ausente, zero, negativa ou com precisão inválida;
- unidade sem conversão válida quando necessária;
- item duplicado de forma incompatível na mesma ordem;
- produto ou insumo sem ordem, ou ordem sem ambas as famílias;
- movimento correspondente inexistente ou divergente na F54.

A ContaIA não escolhe produto principal, calcula rendimento, perda, rateio, equivalência física ou econômica nem redistribui insumos entre produtos. Ela preserva os apontamentos externos e valida sua compatibilidade fiscal e quantitativa.

## 9. Conversão, reconciliação e completude

Quantidade é reconciliada na unidade canônica da F54. Conversão exige fator explícito, positivo, versionado, vigente e aprovado para o item e par de unidades.

Float é proibido. O cálculo usa decimal exato, preserva a precisão interna e arredonda somente na serialização conforme o pacote oficial.

O manifesto prova que o pacote contém toda a produção conjunta própria da competência. Após conversão, qualquer divergência com a F54 bloqueia o pacote inteiro. Não existe tolerância configurável, compensação entre ordens ou itens, saldo implícito, rateio ou ajuste automático.

Ausência de linha não equivale a zero. A declaração explícita de zero integra o manifesto e o hash e não altera a decisão de aplicabilidade.

## 10. Composição, artefatos e hash

A revisão gera:

- fragmento canônico com `K290/K291/K292`, quando houver operações;
- TXT interno na ordem e cardinalidade do leiaute vigente;
- manifesto com escopo, autoridades, versões, contagens, totais, hashes e reconciliação;
- diagnóstico estruturado por ordem, item, movimento e regra;
- relatório legível para revisão humana;
- resultado de parser independente comparado à projeção canônica.

O payload canônico inclui o instante imutável de criação da revisão. Instantes de download ou visualização pertencem somente à auditoria e não alteram o hash. Mesmas entradas, autoridades e pacote normativo produzem os mesmos artefatos e hashes.

## 11. Aprovação e integração

Somente `READY_FOR_REVIEW` pode seguir para `APPROVED` ou `REJECTED`. Importador e preparador não podem aprovar a própria revisão. A aprovação cabe a `contador` ou `admin_escritorio` distinto, dentro da carteira autorizada.

A F52 consome somente revisão F61 `APPROVED`, íntegra, aplicável e não `STALE`. A composição respeita a ordem e as cardinalidades oficiais e convive com as revisões aprovadas das F55 a F60 sem fundir autoridades.

Nova fonte, revisão relevante das F52/F54/F55/F56, conversão ou pacote normativo marca a F61 e a EFD dependente como `STALE`. Não existe recálculo, aprovação ou retificação externa automática.

## 12. Contratos de domínio

### `BlockKJointProductionRevision`

- identifica tenant, empresa, estabelecimento, competência e pacote;
- referencia hashes e versões das autoridades consumidas;
- mantém estado, versão otimista, autor, aprovador e motivo de rejeição;
- é imutável após decisão.

### `JointProductionOrder`

- mantém chave da origem, identificação fiscal e intervalo temporal aplicável;
- possui um ou mais `JointProductionOutput` e um ou mais `JointProductionInput`;
- referencia os movimentos reconciliados da F54;
- não é editável na ContaIA.

### `JointProductionZeroDeclaration`

- declara ausência de produção conjunta própria na competência;
- integra o manifesto e o hash da revisão;
- não altera a decisão de aplicabilidade.

## 13. Autorização, isolamento e auditoria

- `auxiliar`: importa e consulta dentro da carteira; não aprova;
- `contador`: importa, revisa e aprova revisão preparada por outro usuário;
- `admin_escritorio`: mesmas ações dentro do tenant, preservada a segregação;
- `auditor_readonly`: consulta revisões e artefatos; não altera estado;
- `cliente_portal` e demais papéis sem permissão fiscal: acesso negado.

Toda tabela transacional possui `tenant_id` e `empresa_id`, obrigatórios e sob RLS. Consulta sem contexto não retorna dados. Importação, validação, conflito, decisão, download e propagação de `STALE` entram em auditoria append-only.

## 14. Concorrência e falhas

- alteração concorrente usa versão otimista e retorna HTTP 409;
- pacote parcial, hash divergente ou manifesto incompatível falha atomicamente;
- timeout ou indisponibilidade preserva o último estado consistente e permite retentativa idempotente;
- erro segue `application/problem+json` com código estável e `correlationId`;
- nenhuma falha parcial cria fragmento consumível pela F52.

## 15. Invariantes globais tocados

| Invariante | Aplicação na F61 |
|---|---|
| I-1 | revisões, ordens e itens carregam `tenant_id` e `empresa_id`, indexados e sob RLS |
| I-2 | ausência de contexto retorna conjunto vazio |
| I-4 | validação e reconciliação são determinísticas; LLM não calcula nem decide aplicabilidade |
| I-5 | integração fiscal exige aprovação humana registrada |
| I-6 | trilha e decisões são append-only |
| I-7 | revisão e apontamento fiscal não são apagados |
| I-8 | pacote normativo e conversões são selecionados pela vigência da competência |
| I-9 | importação, geração, parser e integração são idempotentes |
| I-11 | competência e datas fiscais são civis; timestamps são exibidos em `America/Sao_Paulo` |
| I-12 | mesmas entradas e versões reproduzem artefatos e hashes |

## 16. Contrato de UI

A tela parte de `docs/telas/contaia_central_de_escritura_o_sped_ecd_malha_fiscal_preventiva_rf_03/` para conteúdo, fluxo, hierarquia e densidade, sem copiar transmissão, recibo ou indicadores fictícios.

Em `Fiscal -> EFD ICMS/IPI -> Bloco K`, apresenta:

- seletor de estabelecimento e competência;
- aplicabilidade, modalidade, vigência e evidências;
- card próprio para produção conjunta no estabelecimento;
- importação por arquivo e resumo do manifesto;
- declaração explícita de zero operações;
- tabela hierárquica de ordens, produtos e insumos;
- divergências, bloqueios e vínculos com F52/F54/F55/F56;
- histórico de revisões, decisão e estado `STALE`;
- ações de revisar, aprovar, rejeitar e baixar artefatos conforme permissão.

Estados obrigatórios: carregando, vazio sem pacote, zero declarado, importando, validando, indeterminado, inválido, pronto para revisão, aprovado, rejeitado, `STALE`, erro recuperável e acesso negado.

A implementação entrega temas CLARO e ESCURO, viewports de 375, 768, 1280 e 1536 px, navegação por teclado, foco visível, semântica, contraste e mensagens por Toast/Sonner. `frontend-design` é usada antes e durante a implementação; `impeccable`, no acabamento. A PR prova comparação com o protótipo, responsividade, estados, acessibilidade e o passe final de `FRONTEND.md` §20.1.

## 17. Critérios de aceite verificáveis

| Categoria | Prova obrigatória |
|---|---|
| Recorte | Goiás, autopeças, modalidade completa, regime, competência e aplicabilidade comprovados; insuficiência resulta em `INDETERMINATE` |
| Entrada | CSV/JSON, schema, manifesto, hash, idempotência, pacote parcial e identificador conflitante |
| Ordem | `K290` válido, concluído ou em andamento quando permitido, com cadeia temporal contínua |
| Produtos | um ou mais `K291` válidos e vinculados à ordem |
| Insumos | um ou mais `K292` válidos e vinculados à ordem |
| Reconciliação | quantidades exatas contra F54 após conversão versionada, sem tolerância, rateio ou ajuste |
| Ausência | declaração explícita de zero gera revisão aprovável e nenhum registro fictício |
| Atomicidade | qualquer divergência bloqueia o pacote inteiro; não há aprovação parcial nem exclusão local |
| Artefatos | TXT, manifesto, diagnóstico, relatório, parser independente e hashes reproduzíveis |
| Banco | RLS, carteira, concorrência, append-only e propagação de `STALE` |
| Integração | F52 consome somente revisão F61 aprovada, íntegra e atual |
| UI | temas, quatro viewports, estados, teclado, foco, contraste e acabamento comprovados |

## 18. Provas exigidas

- testes de regras para aplicabilidade, manifesto, ordem, produtos, insumos, temporalidade, conversão, reconciliação, zero declarado, composição e `STALE`;
- testes de banco para atomicidade, idempotência, RLS, append-only, segregação e concorrência;
- testes de artefatos e parser independente com fixtures válidas e inválidas;
- testes de tela para permissões, estados, tabela hierárquica e downloads;
- E2E da importação à integração na EFD, incluindo zero operações, ordem em andamento e divergência bloqueante;
- prova visual nos dois temas e viewports definidos.

## 19. Fora de escopo e destinos obrigatórios

| Item | Destino obrigatório |
|---|---|
| Produção conjunta efetuada por terceiros (`K300/K301/K302`) | capacidade própria posterior do MVP-2, sem F/SPEC reservada antecipadamente |
| Correção ou substituição da fonte importada | correção ocorre no sistema de origem e entra por nova revisão integral |
| Cálculo de rateio, rendimento, perda ou equivalência econômica | excluído da F61; somente poderá entrar por nova capacidade com regra de produto aprovada |
| ERP, ordem operacional, planejamento, execução ou chão de fábrica | excluído pelo PRD §1.5 |
| Integração genérica com ERP/WMS | capacidade própria de integrações de estoque do MVP-2 |
| Lote, validade e número de série | capacidade própria de rastreabilidade avançada de estoque do MVP-2 |
| Outras UFs, segmentos e períodos | expansão fiscal própria do MVP-2 |
| Lucro Real e não cumulatividade | capacidades tributárias próprias do MVP-2 |
| PVA, assinatura, transmissão, recibo e substituição oficial | capacidade própria de entrega oficial após geração interna validada |
| Produção, piloto, pagamento ou efeito fiscal externo | gate de produção posterior ao MVP-4 |

## 20. Dúvidas resolvidas

| Pergunta | Decisão do PI em 26/09/2026 |
|---|---|
| Qual capacidade ocupa F61/SPEC-061? | produção conjunta no próprio estabelecimento |
| Quais registros entram? | `K290/K291/K292`; `K300/K301/K302` ficam em fatia posterior |
| Qual é a fonte? | pacote externo CSV/JSON; não há lançamento manual |
| Ausência exige declaração de zero? | sim; a declaração integra manifesto e hash sem fabricar registros |
| Como reconciliar? | validar quantidades importadas contra a F54, sem rateio ou rendimento calculado pela ContaIA |
| Qual é o modelo de revisão? | revisão própria, imutável e independente das F56 a F60 |
| Qual recorte fiscal? | Goiás, autopeças, estabelecimento industrial/equiparado, desde setembro/2026; Lucro Presumido quando obrigado e Simples somente com obrigação comprovada |
| Há questões abertas? | Nenhuma |

## 21. Gate de conformidade documental

- **Identidade:** F61/SPEC-061, MVP-2 e origem no PRD estão explícitos.
- **Comportamento:** importação, validação, reconciliação, revisão e integração são observáveis.
- **Aceite:** regras, banco, artefatos, tela e E2E possuem provas verificáveis.
- **Invariantes:** I-1, I-2, I-4 a I-9, I-11 e I-12 estão aplicados.
- **Limites:** não há terceiros, edição da origem, rateio, ERP, PVA ou efeito externo.
- **Dúvidas:** todas as decisões do PI foram registradas; não há questão aberta.
- **Destinos:** todo complemento aponta capacidade nomeada ou exclusão normativa.
- **UI:** caminho, estados, temas, viewports, acessibilidade e skills estão explícitos.
- **Tamanho:** Médio; produção conjunta em terceiros permanece separada.

## 22. Referências normativas consultadas

- SPED, Guia Prático EFD ICMS/IPI versão 3.2.2: <https://sped.rfb.gov.br/arquivo/download/8112>;
- CONFAZ, Ajuste SINIEF 02/2009 e alterações: <https://www.confaz.fazenda.gov.br/legislacao/ajustes/2009/AJ_002_09>.

## 23. Aprovação

Recorte aprovado pelo PI em 26/09/2026 para criação da issue, commit e push direto na `main`.
