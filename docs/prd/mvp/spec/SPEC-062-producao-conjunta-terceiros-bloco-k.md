# SPEC-062 — Produção conjunta efetuada por terceiros no Bloco K completo

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F62
> **Origem:** PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16
> **Tamanho:** Médio
> **Estado:** aprovada pelo PI em 26/09/2026

---

## 1. Objetivo

Importar de forma atômica a evidência fiscal de produção conjunta efetuada por terceiros para estabelecimento industrial ou equiparado de autopeças em Goiás, reconciliar participante, NF-e modelo 55, itens, quantidades e movimentos com as autoridades aprovadas e gerar internamente `K300`, `K301` e `K302` no Bloco K completo para competências iguais ou posteriores a setembro de 2026.

A F62 recebe somente pacote integral CSV ou JSON do sistema do autor da encomenda. Cada pacote forma revisão própria, imutável e segregada das F56 a F61, com manifesto de completude, declaração explícita de zero operações, diagnóstico, parser independente, revisão humana e integração à EFD da F52. A ContaIA não mantém contrato, pedido, ordem operacional, execução, rateio, rendimento ou chão de fábrica.

## 2. Resultado observável

Em `Fiscal -> EFD ICMS/IPI -> Bloco K`, o usuário seleciona estabelecimento e competência e pode:

- consultar aplicabilidade, modalidade completa, pacote normativo e evidências;
- importar pacote CSV ou JSON com manifesto, industrializador, NF-e vinculadas, datas de reconhecimento, produtos e insumos;
- declarar explicitamente que não houve produção conjunta efetuada por terceiros na competência;
- acompanhar validação, reconciliação, diagnóstico e divergências por data, participante, documento e item;
- revisar a prévia hierárquica de `K300/K301/K302`;
- aprovar ou rejeitar a revisão com segregação de funções;
- baixar arquivo canônico, TXT, manifesto, diagnóstico e relatório;
- identificar quando a revisão ou a EFD dependente ficou `STALE`.

Competência aplicável sem operações exige declaração explícita de zero. A revisão preserva a evidência e não fabrica `K300`, `K301` ou `K302`.

## 3. Recorte fiscal

| Eixo | Cobertura |
|---|---|
| Documento | EFD ICMS/IPI, Bloco K completo; NF-e modelo 55 como prova auxiliar |
| Registros | `K300`, `K301` e `K302` |
| Operação | produção conjunta efetuada por terceiros, sob a perspectiva do autor da encomenda |
| Estabelecimento | industrial ou equiparado de autopeças |
| UF | Goiás |
| Período | competências a partir de setembro de 2026 |
| Regime | Lucro Presumido quando obrigado; Simples Nacional somente com obrigação comprovada |
| Saída | artefatos internos e composição da EFD F52, sem transmissão |

A aplicabilidade usa pacote oficial versionado e evidência do estabelecimento. Ausência, conflito ou insuficiência de enquadramento ou prova documental produz `INDETERMINATE`; o sistema não presume obrigação, dispensa, participante, documento, consumo ou produção.

## 4. Dependências e autoridades

- F16 fornece o mecanismo de pacote normativo versionado.
- F17/F18 fornecem as NF-e modelo 55 capturadas, normalizadas e íntegras quando aplicáveis.
- F52 fornece o ciclo da EFD ICMS/IPI original ou retificadora interna.
- F54 é a autoridade de item, unidade canônica, posição e movimentos de estoque.
- F55 fornece o ciclo comum do Bloco K, modalidade, artefatos e integração.
- F58 fornece o padrão aprovado de participante e prova documental para industrialização efetuada por terceiros; sua revisão permanece independente.
- F61 fornece o padrão de produção conjunta própria; sua revisão permanece independente.
- O sistema do autor da encomenda é a autoridade dos apontamentos importados da produção conjunta efetuada por terceiros.

Nenhuma revisão F62 altera dados das capacidades anteriores. Divergência volta ao sistema de origem ou à capacidade que detém a autoridade do dado e bloqueia o pacote inteiro.

## 5. Estados da revisão

`IMPORTED -> VALIDATING -> INDETERMINATE | INVALID | READY_FOR_REVIEW -> APPROVED | REJECTED -> STALE`

- `IMPORTED`: pacote íntegro recebido, ainda não validado;
- `VALIDATING`: schema, documentos, regras e reconciliação em processamento;
- `INDETERMINATE`: aplicabilidade, fundamento normativo ou prova documental insuficiente ou conflitante;
- `INVALID`: pacote estruturalmente inválido ou incompatível com as autoridades;
- `READY_FOR_REVIEW`: validações concluídas e artefatos reproduzíveis;
- `APPROVED`: revisão aceita por aprovador segregado;
- `REJECTED`: revisão rejeitada com motivo obrigatório;
- `STALE`: fonte, documento, autoridade, pacote normativo ou dependência mudou após a revisão.

Estados decididos são imutáveis. Correção ocorre na autoridade de origem e entra por novo pacote integral e nova revisão; nenhuma linha importada é editada na ContaIA.

## 6. Contrato de entrada

O pacote contém, no mínimo:

- versão do schema e identificadores de tenant, empresa, estabelecimento e competência;
- identificação e versão do sistema do autor da encomenda;
- instante imutável de criação da revisão na origem;
- manifesto com arquivos, hashes, contagens e totais de controle;
- declaração explícita de existência ou ausência de operações F62;
- identificação estável do terceiro industrializador;
- chaves, papéis e vínculos das NF-e modelo 55 de remessa, retorno, industrialização, complemento e cancelamento aplicáveis;
- para cada data de reconhecimento: chave estável da origem e data da produção ocorrida no terceiro;
- um ou mais produtos resultantes, com item, quantidade e unidade;
- um ou mais insumos consumidos, com item, quantidade, unidade e código substituto quando exigido pelo leiaute;
- fatores de conversão versionados quando a unidade informada divergir da unidade canônica;
- vínculos estáveis com os movimentos de estoque correspondentes.

Dados externos entram como `unknown`. Schema, manifesto, hash, cardinalidades, competência, participante, documentos, datas, itens, unidades, quantidades, vínculos, contagens e totais são validados antes de criar revisão utilizável.

O mesmo pacote, com o mesmo hash e escopo, é idempotente. Mesmo identificador com conteúdo diferente é conflito auditável e não substitui a revisão anterior.

## 7. Participante e prova documental

O manifesto identifica o terceiro industrializador e vincula as NF-e modelo 55 aplicáveis de remessa, retorno, industrialização, complemento e cancelamento. Participante e documentos são evidências auxiliares obrigatórias, ainda que não sejam serializados nos campos de `K300/K301/K302`.

Produzem `INDETERMINATE`:

- NF-e exigida pela hipótese concreta ausente ou cadeia documental incompleta;
- papel fiscal, vínculo entre documentos ou correspondência com a operação sem prova suficiente;
- conflito entre pacote normativo, documento e operação que não permita concluir a regra aplicável.

Produzem `INVALID`:

- participante ausente, arquivado, divergente ou sem identificação estável;
- NF-e cancelada, denegada, inidônea ou incompatível com o escopo declarado;
- emitente, destinatário, estabelecimento, item, unidade, quantidade ou período incompatível;
- documento reutilizado de forma incompatível entre operações;
- remessa, retorno, complemento ou cancelamento vinculado ambiguamente.

Ausência de NF-e só deixa de exigir prova quando pacote normativo oficial versionado demonstrar que o documento não se aplica à hipótese concreta. Justificativa, fonte, vigência e decisão integram manifesto e hash; ausência comum nunca é tratada como zero ou exceção presumida.

## 8. Reconhecimento da produção — K300

Cada data de reconhecimento válida gera um `K300`, conforme campos, hierarquia e cardinalidade do pacote oficial vigente.

Bloqueiam a revisão:

- chave de origem ausente, duplicada ou conflitante;
- data impossível, fora da competência ou incompatível com documentos e movimentos;
- `K300` sem ao menos um produto `K301` e um insumo `K302`;
- participante ou operação divergente do escopo;
- vínculo ausente ou ambíguo com os movimentos da F54;
- quebra da hierarquia ou cardinalidade oficial.

## 9. Produtos e insumos — K301 e K302

Cada produto resultante válido gera `K301`; cada insumo consumido válido gera `K302`, ambos vinculados inequivocamente ao `K300` correspondente.

Bloqueiam a revisão:

- item inexistente, arquivado ou incompatível na F54;
- quantidade ausente, zero, negativa ou com precisão inválida;
- unidade sem conversão válida quando necessária;
- item duplicado de forma incompatível na mesma data de reconhecimento;
- produto ou insumo órfão, ou `K300` sem ambas as famílias;
- movimento correspondente inexistente ou divergente na F54;
- item, quantidade ou vínculo incompatível com as NF-e e os apontamentos importados;
- código de insumo substituído ausente, inválido ou incoerente quando o leiaute o exigir.

A ContaIA não escolhe produto principal, calcula rendimento, perda, rateio, equivalência física ou econômica nem redistribui insumos entre produtos. Ela preserva os apontamentos externos e valida sua compatibilidade fiscal, documental e quantitativa.

## 10. Conversão, reconciliação e completude

Quantidade é reconciliada na unidade canônica da F54. Conversão exige fator explícito, positivo, versionado, vigente e aprovado para o item e par de unidades.

Float é proibido. O cálculo usa decimal exato, preserva a precisão interna e arredonda somente na serialização conforme o pacote oficial.

O manifesto prova que o pacote contém toda a produção conjunta efetuada por terceiros na competência. Qualquer divergência de participante, documento, item, vínculo, conversão, quantidade ou movimento bloqueia o pacote inteiro. Não existe aprovação parcial, exclusão local de linha, tolerância configurável, compensação entre operações, saldo implícito, rateio ou ajuste automático.

Ausência de linha não equivale a zero. A declaração explícita de zero integra o manifesto e o hash e não altera a decisão de aplicabilidade.

## 11. Composição, artefatos e hash

A revisão gera:

- fragmento canônico com `K300/K301/K302`, quando houver operações;
- TXT interno na ordem e cardinalidade do leiaute vigente;
- manifesto com escopo, participante, documentos, autoridades, versões, contagens, totais, hashes e reconciliação;
- diagnóstico estruturado por data, participante, documento, item, movimento e regra;
- relatório legível para revisão humana;
- resultado de parser independente comparado à projeção canônica.

O payload canônico inclui o instante imutável de criação da revisão. Instantes de download ou visualização pertencem somente à auditoria e não alteram o hash. Mesmas entradas, autoridades e pacote normativo produzem os mesmos artefatos e hashes.

## 12. Aprovação e integração

Somente `READY_FOR_REVIEW` pode seguir para `APPROVED` ou `REJECTED`. Importador e preparador não podem aprovar a própria revisão. A aprovação cabe a `contador` ou `admin_escritorio` distinto, dentro da carteira autorizada.

A F52 consome somente revisão F62 `APPROVED`, íntegra, aplicável e não `STALE`. A composição respeita ordem e cardinalidades oficiais e convive com revisões aprovadas das F55 a F61 sem fundir autoridades.

Nova fonte, documento, revisão relevante das F17/F18/F52/F54/F55/F58/F61, conversão ou pacote normativo marca a F62 e a EFD dependente como `STALE`. Não existe recálculo, aprovação ou retificação externa automática.

## 13. Contratos de domínio

### `BlockKThirdPartyJointProductionRevision`

- identifica tenant, empresa, estabelecimento, competência e pacote;
- referencia industrializador, NF-e, hashes e versões das autoridades consumidas;
- mantém estado, versão otimista, autor, aprovador e motivo de rejeição;
- é imutável após decisão.

### `ThirdPartyJointProductionEntry`

- mantém chave da origem, data de reconhecimento, participante e documentos;
- possui um ou mais produtos e um ou mais insumos vinculados;
- referencia os movimentos reconciliados da F54;
- não é editável na ContaIA.

### `ThirdPartyJointProductionZeroDeclaration`

- declara ausência de produção conjunta efetuada por terceiros na competência;
- integra o manifesto e o hash da revisão;
- não altera a decisão de aplicabilidade.

## 14. Autorização, isolamento e auditoria

- `auxiliar`: importa e consulta dentro da carteira; não aprova;
- `contador`: importa, revisa e aprova revisão preparada por outro usuário;
- `admin_escritorio`: mesmas ações dentro do tenant, preservada a segregação;
- `auditor_readonly`: consulta revisões e artefatos; não altera estado;
- `cliente_portal` e demais papéis sem permissão fiscal: acesso negado.

Toda tabela transacional possui `tenant_id` e `empresa_id`, obrigatórios e sob RLS. Consulta sem contexto não retorna dados. Importação, validação, conflito, decisão, download e propagação de `STALE` entram em auditoria append-only.

## 15. Concorrência e falhas

- alteração concorrente usa versão otimista e retorna HTTP 409;
- pacote parcial, hash divergente ou manifesto incompatível falha atomicamente;
- timeout ou indisponibilidade preserva o último estado consistente e permite retentativa idempotente;
- erro segue `application/problem+json` com código estável e `correlationId`;
- nenhuma falha parcial cria fragmento consumível pela F52.

## 16. Invariantes globais tocados

| Invariante | Aplicação na F62 |
|---|---|
| I-1 | revisões, entradas e itens carregam `tenant_id` e `empresa_id`, indexados e sob RLS |
| I-2 | ausência de contexto retorna conjunto vazio |
| I-4 | validação e reconciliação são determinísticas; LLM não calcula nem decide aplicabilidade |
| I-5 | integração fiscal exige aprovação humana registrada |
| I-6 | trilha e decisões são append-only |
| I-7 | revisão e apontamento fiscal não são apagados |
| I-8 | pacote normativo e conversões são selecionados pela vigência da competência |
| I-9 | importação, geração, parser e integração são idempotentes |
| I-11 | competência e datas fiscais são civis; timestamps são exibidos em `America/Sao_Paulo` |
| I-12 | mesmas entradas e versões reproduzem artefatos e hashes |

## 17. Contrato de UI

A tela parte de `docs/telas/contaia_central_de_escritura_o_sped_ecd_malha_fiscal_preventiva_rf_03/` para conteúdo, fluxo, hierarquia e densidade, sem copiar transmissão, recibo ou indicadores fictícios.

Em `Fiscal -> EFD ICMS/IPI -> Bloco K`, apresenta:

- seletor de estabelecimento e competência;
- aplicabilidade, modalidade, vigência e evidências;
- card próprio para produção conjunta efetuada por terceiros;
- importação por arquivo e resumo do manifesto;
- declaração explícita de zero operações;
- industrializador e NF-e vinculadas com estado de reconciliação;
- tabela hierárquica por data, produtos e insumos;
- divergências, bloqueios e vínculos com as autoridades;
- histórico de revisões, decisão e estado `STALE`;
- ações de revisar, aprovar, rejeitar e baixar artefatos conforme permissão.

Estados obrigatórios: carregando, vazio sem pacote, zero declarado, importando, validando, indeterminado, inválido, pronto para revisão, aprovado, rejeitado, `STALE`, erro recuperável e acesso negado.

A implementação entrega temas CLARO e ESCURO, viewports de 375, 768, 1280 e 1536 px, navegação por teclado, foco visível, semântica, contraste e mensagens por Toast/Sonner. `frontend-design` é usada antes e durante a implementação; `impeccable`, no acabamento. A PR prova comparação com o protótipo, responsividade, estados, acessibilidade e o passe final de `FRONTEND.md` §20.1.

## 18. Critérios de aceite verificáveis

| Categoria | Prova obrigatória |
|---|---|
| Recorte | Goiás, autopeças, modalidade completa, regime, competência e aplicabilidade comprovados; insuficiência resulta em `INDETERMINATE` |
| Entrada | CSV/JSON do encomendante, schema, manifesto, hash, idempotência, pacote parcial e identificador conflitante |
| Documentos | industrializador e NF-e 55 de remessa/retorno e eventos aplicáveis reconciliados; lacuna produz `INDETERMINATE` |
| Reconhecimento | `K300` válido para a data, com ao menos um produto e um insumo |
| Produtos | um ou mais `K301` válidos e vinculados ao `K300` |
| Insumos | um ou mais `K302` válidos e vinculados ao `K300` |
| Reconciliação | quantidades exatas contra F54 e documentos após conversão versionada, sem tolerância, rateio ou ajuste |
| Ausência | declaração explícita de zero gera revisão aprovável e nenhum registro fictício |
| Atomicidade | qualquer divergência bloqueia o pacote inteiro; não há aprovação parcial nem exclusão local |
| Artefatos | TXT, manifesto, diagnóstico, relatório, parser independente e hashes reproduzíveis |
| Banco | RLS, carteira, concorrência, append-only e propagação de `STALE` |
| Integração | F52 consome somente revisão F62 aprovada, íntegra e atual |
| UI | temas, quatro viewports, estados, teclado, foco, contraste e acabamento comprovados |

## 19. Provas exigidas

- testes de regras para aplicabilidade, manifesto, documentos, reconhecimento, produtos, insumos, conversão, reconciliação, zero declarado, composição e `STALE`;
- testes de banco para atomicidade, idempotência, RLS, append-only, segregação e concorrência;
- testes de artefatos e parser independente com fixtures válidas e inválidas;
- testes de tela para permissões, estados, tabela hierárquica, prova documental e downloads;
- E2E da importação à integração na EFD, incluindo zero operações, NF-e ausente, cancelamento e divergência bloqueante;
- prova visual nos dois temas e viewports definidos.

## 20. Fora de escopo e destinos obrigatórios

| Item | Destino obrigatório |
|---|---|
| Correção ou substituição da fonte importada | correção ocorre no sistema do encomendante e entra por nova revisão integral |
| Correções específicas de `K300/K301/K302` não cobertas pelo leiaute vigente | capacidade própria posterior do MVP-2, condicionada a fonte oficial e recorte aprovados |
| Cálculo de rateio, rendimento, perda ou equivalência econômica | capacidade própria posterior somente com regra de produto aprovada |
| ERP, contrato, pedido, ordem operacional, planejamento, execução ou chão de fábrica | excluído pelo PRD §1.5 |
| Integração genérica com ERP/WMS | capacidade própria de integrações de estoque do MVP-2 |
| Lote, validade e número de série | capacidade própria de rastreabilidade avançada de estoque do MVP-2 |
| Outras UFs, segmentos e períodos | expansão fiscal própria do MVP-2 |
| Lucro Real e não cumulatividade | capacidades tributárias próprias do MVP-2 |
| PVA, assinatura, transmissão, recibo e substituição oficial | capacidade própria de entrega oficial após geração interna validada |
| Produção, piloto, pagamento ou efeito fiscal externo | gate de produção posterior ao MVP-4 |

## 21. Dúvidas resolvidas

| Pergunta | Decisão do PI em 26/09/2026 |
|---|---|
| Qual capacidade ocupa F62/SPEC-062? | produção conjunta efetuada por terceiros |
| Quais registros entram? | `K300/K301/K302` |
| Qual é a fonte? | pacote integral CSV/JSON do sistema do autor da encomenda; não há lançamento manual |
| Qual prova é obrigatória? | reconciliação com F54 e NF-e modelo 55 vinculadas; lacuna documental produz `INDETERMINATE` |
| Ausência exige declaração de zero? | sim; a declaração integra manifesto e hash sem fabricar registros |
| Como reconciliar? | validar participante, documentos e quantidades importadas contra as autoridades, sem tolerância, rateio ou ajuste |
| Qual é o modelo de revisão? | revisão própria, imutável e independente das F56 a F61 |
| Qual recorte fiscal? | Goiás, autopeças, estabelecimento industrial/equiparado, desde setembro/2026; Lucro Presumido quando obrigado e Simples somente com obrigação comprovada |
| Há questões abertas? | Nenhuma |

## 22. Gate de conformidade documental

- **Identidade:** F62/SPEC-062, MVP-2 e origem no PRD estão explícitos.
- **Comportamento:** importação, validação documental, reconciliação, revisão e integração são observáveis.
- **Aceite:** regras, banco, artefatos, tela e E2E possuem provas verificáveis.
- **Invariantes:** I-1, I-2, I-4 a I-9, I-11 e I-12 estão aplicados.
- **Limites:** não há edição da origem, rateio, ERP, PVA ou efeito externo.
- **Dúvidas:** todas as decisões do PI foram registradas; não há questão aberta.
- **Destinos:** todo complemento aponta capacidade nomeada ou exclusão normativa.
- **UI:** caminho, estados, temas, viewports, acessibilidade e skills estão explícitos.
- **Tamanho:** Médio; reaproveita autoridades existentes e mantém integrações e correções futuras separadas.

## 23. Referências normativas consultadas

- SPED, Guia Prático EFD ICMS/IPI versão 3.2.2: <https://sped.rfb.gov.br/arquivo/download/8112>;
- CONFAZ, Ajuste SINIEF 02/2009 e alterações: <https://www.confaz.fazenda.gov.br/legislacao/ajustes/2009/AJ_002_09>.

## 24. Aprovação

Recorte aprovado pelo PI em 26/09/2026 para criação da issue, commit e push direto na `main`.
