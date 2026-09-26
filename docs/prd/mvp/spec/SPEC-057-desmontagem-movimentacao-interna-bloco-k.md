# SPEC-057 — Desmontagem e movimentação interna no Bloco K completo

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F57
> **Origem:** PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16
> **Tamanho:** Médio
> **Estado:** aprovada pelo PI em 26/09/2026

---

## 1. Objetivo

Importar de forma atômica a evidência fiscal de desmontagem de mercadorias e de outras movimentações internas de estoque para estabelecimento industrial ou equiparado de autopeças em Goiás, reconciliá-la com o estoque aprovado da F54 e gerar internamente os registros `K210`, `K215` e `K220` do Bloco K completo para competências iguais ou posteriores a setembro de 2026.

A F57 recebe somente evidência fiscal de sistema externo em CSV ou JSON canônico. Ela não mantém ordem, execução, chão de fábrica nem edição operacional dos apontamentos. Cada pacote forma revisão própria, imutável e segregada da F56, com manifesto de completude, diagnóstico, parser independente, revisão humana e integração à EFD da F52.

## 2. Resultado observável

Em `Fiscal -> EFD ICMS/IPI -> Bloco K`, o usuário seleciona estabelecimento e competência e pode:

- consultar aplicabilidade, modalidade completa, pacote normativo e evidências;
- importar pacote CSV ou JSON com manifesto, desmontagens, itens resultantes e movimentações internas;
- declarar explicitamente que não houve operações F57 na competência;
- acompanhar validação, reconciliação, diagnóstico e divergências por operação e item;
- revisar a prévia dos registros `K210`, `K215` e `K220`;
- aprovar ou rejeitar a revisão com segregação de funções;
- baixar arquivo canônico, manifesto, diagnóstico e relatório da revisão;
- identificar quando a revisão ou a EFD dependente ficou `STALE`.

Uma competência aplicável sem desmontagem ou movimentação interna continua aplicável: o manifesto declara zero operações, a revisão preserva essa evidência e nenhum `K210`, `K215` ou `K220` é fabricado.

## 3. Recorte fiscal

| Eixo | Cobertura |
|---|---|
| Documento | EFD ICMS/IPI, Bloco K completo |
| Registros | `K210`, `K215` e `K220` |
| Estabelecimento | industrial ou equiparado de autopeças |
| UF | Goiás |
| Período | competências a partir de setembro de 2026 |
| Regime | Lucro Presumido quando obrigado; Simples Nacional somente com obrigação comprovada |
| Saída | artefatos internos e composição da EFD F52, sem transmissão |

A aplicabilidade usa pacote oficial versionado e evidência do estabelecimento. Ausência, conflito ou insuficiência de enquadramento produz `INDETERMINATE`; o sistema não presume obrigação nem dispensa.

## 4. Dependências e autoridades

- F16 fornece o mecanismo de pacote normativo versionado.
- F52 fornece o ciclo da EFD ICMS/IPI original ou retificadora interna.
- F54 é a autoridade de item, unidade canônica, posição e movimentos de estoque.
- F55 fornece o ciclo comum do Bloco K, modalidade, artefatos e integração.
- F56 fornece produção própria e consumo quando a composição da competência também os exigir; a revisão F57 permanece independente.
- O sistema externo é a autoridade dos apontamentos importados de desmontagem e movimentação interna.

Nenhuma revisão F57 altera dados da F54, F55 ou F56. Divergência bloqueia a revisão e volta ao sistema de origem ou à capacidade que detém a autoridade do dado.

## 5. Estados da revisão

`IMPORTED -> VALIDATING -> INDETERMINATE | INVALID | READY_FOR_REVIEW -> APPROVED | REJECTED -> STALE`

- `IMPORTED`: pacote íntegro recebido, ainda não validado.
- `VALIDATING`: schema, completude, regras e reconciliação em processamento.
- `INDETERMINATE`: aplicabilidade ou fundamento normativo insuficiente ou conflitante.
- `INVALID`: pacote estruturalmente inválido ou incompatível com as autoridades.
- `READY_FOR_REVIEW`: validações concluídas e artefatos reproduzíveis.
- `APPROVED`: revisão aceita por aprovador segregado.
- `REJECTED`: revisão rejeitada com motivo obrigatório.
- `STALE`: fonte, autoridade, pacote normativo ou dependência mudou após a revisão.

Estados terminais são imutáveis. Correção ocorre por novo pacote integral e nova revisão; não existe edição de linha importada.

## 6. Contrato de entrada

O pacote contém, no mínimo:

- versão do schema e identificadores de tenant, empresa, estabelecimento e competência;
- identificação e versão do sistema de origem;
- instante imutável de criação da revisão na origem;
- manifesto com arquivos, hashes, contagens e totais de controle;
- declaração explícita de existência ou ausência de desmontagens;
- declaração explícita de existência ou ausência de movimentações internas;
- para desmontagem: data, item de origem, quantidade de origem e itens resultantes com respectivas quantidades;
- para movimentação interna: data, item de origem, item de destino e respectivas quantidades;
- unidades informadas e fatores de conversão versionados quando divergirem da unidade canônica;
- vínculo estável de cada operação no sistema de origem.

Dados externos entram como `unknown`. Schema, manifesto, hash, cardinalidade, datas, competência, itens, unidades, quantidades, vínculos, contagens e totais são validados antes de criar revisão utilizável.

O mesmo pacote, com o mesmo hash e escopo, é idempotente. Mesmo identificador com conteúdo diferente é conflito auditável e não substitui a revisão anterior.

## 7. Desmontagem — K210 e K215

Cada desmontagem válida gera um `K210` para o item de origem e um ou mais `K215` para os itens resultantes, respeitando a hierarquia e a cardinalidade do pacote oficial vigente.

Bloqueiam a revisão:

- item de origem ou resultante inexistente, arquivado ou incompatível na F54;
- quantidade ausente, zero, negativa ou com precisão inválida;
- data fora da competência;
- operação sem ao menos um item resultante;
- item resultante duplicado de forma incompatível;
- unidade sem conversão válida;
- vínculo que não possa ser reconciliado com os movimentos imutáveis da F54;
- quebra da hierarquia ou cardinalidade oficial entre `K210` e `K215`.

A ContaIA não calcula rendimento industrial, perda aceitável, equivalência econômica nem composição técnica. Diferença quantitativa entre origem e resultantes só é aceita quando o movimento correspondente estiver íntegro na F54 e o pacote oficial permitir a representação; a aplicação não cria ajuste para fechar a operação.

## 8. Outras movimentações internas — K220

Cada movimentação válida gera `K220` conforme o leiaute vigente, preservando data, item de origem, item de destino e quantidades importadas.

Bloqueiam a revisão:

- origem ou destino ausente, igual ou incompatível;
- item desconhecido, arquivado ou fora do estabelecimento;
- quantidade ausente, zero, negativa ou incompatível com a precisão permitida;
- data fora da competência;
- conversão ausente, conflitante ou fora da vigência;
- movimento correspondente inexistente ou divergente na F54;
- tentativa de usar `K220` como ajuste genérico de estoque, transferência entre estabelecimentos ou substituto de registro específico.

A F57 não infere a natureza da movimentação. O pacote de origem deve declará-la e a validação apenas confirma sua compatibilidade com `K220` e com o estoque aprovado.

## 9. Conversão e reconciliação

Quantidade é reconciliada na unidade canônica da F54. Conversão exige fator explícito, positivo, versionado, vigente e previamente aprovado para o item e par de unidades.

Float é proibido. O cálculo usa decimal exato, preserva a precisão interna e arredonda somente na serialização conforme o pacote oficial.

Após conversão, qualquer divergência com a F54 bloqueia o pacote inteiro. Não existe tolerância configurável, compensação entre operações, saldo implícito ou ajuste automático.

## 10. Composição, artefatos e hash

A revisão gera:

- fragmento canônico do Bloco K com `K210/K215/K220`, quando houver operações;
- manifesto com escopo, autoridades, versões, contagens, hashes e resultado da reconciliação;
- diagnóstico estruturado por operação, item e regra;
- relatório legível para revisão humana;
- resultado de parser independente comparado à projeção canônica.

O payload canônico inclui o instante imutável de criação da revisão. Instantes de download ou visualização pertencem apenas à auditoria e não alteram o hash.

Mesmo conjunto de entradas, autoridades e pacote normativo produz os mesmos artefatos e hashes.

## 11. Aprovação e integração

Somente `READY_FOR_REVIEW` pode seguir para `APPROVED` ou `REJECTED`. Importador e preparador não podem aprovar a própria revisão. A aprovação cabe a `contador` ou `admin_escritorio` distinto, dentro da carteira autorizada.

A F52 consome somente revisão F57 `APPROVED`, íntegra, aplicável e não `STALE`. A composição respeita a ordem e as cardinalidades do pacote oficial e convive com as revisões aprovadas de F55 e F56 sem fundi-las em uma única autoridade.

Nova fonte, revisão F54/F55/F56 relevante, conversão ou pacote normativo marca a F57 e a EFD dependente como `STALE`. Não existe recálculo, aprovação ou retificação externa automática.

## 12. Contratos de domínio

### `BlockKSpecialOperationRevision`

- identifica tenant, empresa, estabelecimento, competência e pacote;
- referencia hashes e versões das autoridades consumidas;
- mantém estado, versão otimista, autor, aprovador e motivo de rejeição;
- é imutável após decisão.

### `DisassemblyOperation`

- mantém chave da origem, data, item e quantidade desmontada;
- possui um ou mais `DisassemblyOutput` vinculados;
- não é editável na ContaIA.

### `InternalMovementOperation`

- mantém chave da origem, data, itens de origem e destino e quantidades;
- não substitui transferência entre estabelecimentos nem ajuste de inventário;
- não é editável na ContaIA.

### `BlockKZeroOperationDeclaration`

- declara separadamente ausência de desmontagem e de movimentação interna;
- integra o manifesto e o hash da revisão;
- não altera a decisão de aplicabilidade.

## 13. Autorização, isolamento e auditoria

- `auxiliar`: importa e consulta dentro da carteira; não aprova.
- `contador`: importa, revisa e aprova revisão preparada por outro usuário.
- `admin_escritorio`: mesmas ações dentro do tenant, preservada a segregação.
- `auditor_readonly`: consulta revisões e artefatos; não altera estado.
- `cliente_portal` e demais papéis sem permissão fiscal: acesso negado.

Toda tabela transacional possui `tenant_id` e `empresa_id`, ambos obrigatórios e sob RLS. Consulta sem contexto não retorna dados. Importação, validação, conflito, decisão, download e propagação de `STALE` entram em auditoria append-only.

## 14. Concorrência e falhas

- alteração concorrente usa versão otimista e retorna HTTP 409 em conflito;
- pacote parcial, hash divergente ou manifesto incompatível falha atomicamente;
- timeout ou indisponibilidade preserva o último estado consistente e permite retentativa idempotente;
- erro segue `application/problem+json` com código estável e `correlationId`;
- nenhuma falha parcial cria fragmento consumível pela F52.

## 15. Invariantes globais tocados

| Invariante | Aplicação na F57 |
|---|---|
| I-1 | revisões e operações carregam `tenant_id` e `empresa_id`, indexados e sob RLS |
| I-2 | ausência de contexto retorna conjunto vazio |
| I-4 | validação e reconciliação são determinísticas; LLM não calcula nem decide aplicabilidade |
| I-5 | integração fiscal exige aprovação humana registrada |
| I-6 | trilha e decisões são append-only |
| I-7 | revisão fiscal não é apagada; nova revisão substitui apenas como versão corrente |
| I-8 | pacote normativo é selecionado pela competência da operação |
| I-9 | importação e composição são idempotentes |
| I-11 | competência e datas de operação são datas civis; timestamps são exibidos em `America/Sao_Paulo` |
| I-12 | mesma entrada e mesmas versões reproduzem artefatos e hashes |

## 16. Contrato de UI

A tela parte de `docs/telas/contaia_central_de_escritura_o_sped_ecd_malha_fiscal_preventiva_rf_03/` para conteúdo, fluxo, hierarquia e densidade, sem copiar transmissão, recibo ou indicadores fictícios.

Em `Fiscal -> EFD ICMS/IPI -> Bloco K`, apresenta:

- seletor de estabelecimento e competência;
- aplicabilidade, modalidade, vigência e evidências;
- card próprio para desmontagem e movimentação interna;
- importação por arquivo e resumo do manifesto;
- declaração explícita de zero operações;
- tabela hierárquica de desmontagens e itens resultantes;
- tabela de movimentações internas;
- divergências, bloqueios e vínculos com F54/F55/F56;
- histórico de revisões, decisão e estado `STALE`;
- ações de revisar, aprovar, rejeitar e baixar artefatos conforme permissão.

Estados obrigatórios: carregando, vazio sem pacote, zero declarado, importando, validando, indeterminado, inválido, pronto para revisão, aprovado, rejeitado, `STALE`, erro recuperável e acesso negado.

A implementação entrega temas CLARO e ESCURO, viewports de 375, 768, 1280 e 1536 px, navegação por teclado, foco visível, semântica, contraste e mensagens por Toast/Sonner. `frontend-design` é usada antes e durante a implementação; `impeccable`, no acabamento. A PR prova comparação com o protótipo, responsividade, estados, acessibilidade e o passe final de `FRONTEND.md` §20.1.

## 17. Critérios de aceite

- [ ] Aplicabilidade distingue `APPLICABLE`, `NOT_APPLICABLE` e `INDETERMINATE` com evidência versionada.
- [ ] CSV e JSON canônicos produzem a mesma revisão e os mesmos artefatos.
- [ ] Pacote parcial, adulterado ou estruturalmente inválido é rejeitado atomicamente.
- [ ] Reimportação idêntica é idempotente; chave repetida com conteúdo diferente gera conflito.
- [ ] Desmontagem válida gera `K210` com seus `K215` na hierarquia oficial.
- [ ] Movimentação válida gera `K220` sem ser usada como ajuste genérico ou transferência entre estabelecimentos.
- [ ] Toda quantidade é reconciliada sem tolerância com a F54, após conversão versionada quando necessária.
- [ ] Manifesto com zero operações gera revisão aprovável e nenhum registro fictício.
- [ ] Parser independente confirma registros, cardinalidades, contagens e valores serializados.
- [ ] Aprovação segregada e rejeição motivada preservam histórico imutável.
- [ ] Alteração de fonte, autoridade ou regra propaga `STALE` à revisão e à EFD dependente.
- [ ] F52 consome somente revisão aprovada, íntegra, aplicável e atual.
- [ ] RLS, carteira, concorrência e auditoria têm provas positivas e negativas.
- [ ] Interface final comprova ambos os temas, quatro viewports, estados, acessibilidade e acabamento.

## 18. Provas exigidas

- testes de regras para aplicabilidade, manifesto, desmontagem, movimentação, conversão, reconciliação, zero declarado, composição e `STALE`;
- testes de banco para atomicidade, idempotência, RLS, append-only, segregação e concorrência;
- testes de artefatos e parser independente com fixtures válidas e inválidas;
- testes de tela para permissões, estados, tabelas hierárquicas e downloads;
- E2E da importação à integração na EFD, incluindo zero operações e divergência bloqueante;
- prova visual nos dois temas e viewports definidos.

## 19. Fora de escopo e destinos obrigatórios

| Item | Destino obrigatório |
|---|---|
| Industrialização efetuada por terceiros (`K250/K255`) | capacidade própria posterior do MVP-2, sem F/SPEC reservada antecipadamente |
| Reprocessamento/reparo (`K260/K265`) | capacidade própria posterior do MVP-2, sem F/SPEC reservada antecipadamente |
| Produção conjunta (`K290` a `K302`) | capacidade própria posterior do MVP-2, sem F/SPEC reservada antecipadamente |
| ERP, ordem, planejamento, execução ou chão de fábrica | excluído pelo PRD §1.5 |
| Integração genérica com ERP/WMS | capacidade própria de integrações de estoque do MVP-2 |
| Lote, validade e número de série | capacidade própria de rastreabilidade avançada de estoque do MVP-2 |
| Outras UFs, segmentos e períodos | expansão fiscal própria do MVP-2 |
| PVA, assinatura, transmissão, recibo e substituição oficial | capacidades próprias posteriores do MVP-2 e gate produtivo quando aplicável |

## 20. Dúvidas resolvidas

- Identidade: F57/SPEC-057.
- Fatiamento: F57 cobre somente desmontagem e movimentação interna; demais famílias terão novas fatias.
- Fonte: somente importação CSV/JSON de sistema externo; não há lançamento manual.
- Recorte: industrial ou equiparado de autopeças em Goiás desde setembro/2026.
- Revisão: unidade própria, independente da F56 e composta na mesma EFD.
- Ausência: exige declaração explícita de zero operações e não vira `NOT_APPLICABLE`.
- Reconciliação: F54 é autoridade e não existe tolerância ou ajuste automático.
- Efeito: artefatos internos, sem PVA, assinatura ou transmissão.
- Questões abertas: nenhuma.

## 21. Gate de conformidade documental

- **Identidade:** F57/SPEC-057, MVP-2 e origem no PRD estão explícitos.
- **Comportamento:** importação, validação, reconciliação, revisão e integração são observáveis.
- **Aceite:** regras, banco, artefatos, tela e E2E possuem provas verificáveis.
- **Invariantes:** I-1, I-2, I-4 a I-9, I-11 e I-12 estão aplicados.
- **Limites:** não há ERP, edição manual, demais operações especiais, PVA ou efeito externo.
- **Dúvidas:** todas as decisões do PI foram registradas; não há questão aberta.
- **Destinos:** todo complemento aponta capacidade nomeada ou exclusão normativa.
- **UI:** caminho, estados, temas, viewports, acessibilidade e skills estão explícitos.
- **Tamanho:** Médio; as demais famílias de operações especiais foram separadas.

## 22. Referências normativas consultadas

- SPED, Guia Prático EFD ICMS/IPI versão 3.2.2: <https://sped.rfb.gov.br/arquivo/download/8112>;
- CONFAZ, Ajuste SINIEF 02/2009 e alterações: <https://www.confaz.fazenda.gov.br/legislacao/ajustes/2009/AJ_002_09>.

## 23. Aprovação

Recorte aprovado pelo PI em 26/09/2026 para criação da issue, commit e push direto na `main`.
