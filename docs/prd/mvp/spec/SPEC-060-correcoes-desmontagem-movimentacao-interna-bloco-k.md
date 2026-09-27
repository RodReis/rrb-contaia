# SPEC-060 — Correções de desmontagem e movimentação interna no Bloco K

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F60
> **Origem:** PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16
> **Tamanho:** Médio
> **Estado:** aprovada pelo PI em 26/09/2026

---

## 1. Objetivo

Importar de forma atômica correções de apontamentos de desmontagem e movimentação interna anteriormente aprovados pela F57, reconciliá-las com a revisão original e com o estoque aprovado da F54 e gerar internamente `K270/K275` com origem `3` para `K210/K215` e origem `5` para `K220`, em competências iguais ou posteriores a setembro de 2026.

A F60 cria revisão própria, imutável e vinculada à F57 original. Ela não reabre, edita, apaga nem substitui a revisão corrigida, não altera automaticamente o estoque ou o sistema externo e não exige declaração de zero quando nenhuma correção existe.

## 2. Resultado observável

Em `Fiscal -> EFD ICMS/IPI -> Bloco K`, o usuário seleciona estabelecimento e competência e pode:

- consultar aplicabilidade, modalidade completa, pacote normativo e evidências;
- importar pacote CSV ou JSON com manifesto e correções de origem `3` e/ou `5`;
- identificar a revisão F57, a operação, o registro e o item originalmente apontados;
- comparar quantidade original, correções anteriores e resultado após a nova correção;
- acompanhar validação, reconciliação, diagnóstico e divergências;
- revisar a prévia de `K270/K275` na hierarquia oficial;
- aprovar ou rejeitar a revisão com segregação de funções;
- baixar arquivo canônico, TXT, manifesto, diagnóstico e relatório;
- identificar quando a revisão ou a EFD dependente ficou `STALE`.

Ausência de revisão F60 significa somente que não há correção conhecida para a competência. O sistema não cria manifesto de zero, não presume completude e não fabrica `K270/K275`.

## 3. Recorte fiscal

| Eixo | Cobertura |
|---|---|
| Documento | EFD ICMS/IPI, Bloco K completo |
| Registros | `K270/K275` |
| Origens | `3` para `K210/K215`; `5` para `K220` |
| Estabelecimento | industrial ou equiparado de autopeças |
| UF | Goiás |
| Período | competências a partir de setembro de 2026 |
| Regime | Lucro Presumido quando obrigado; Simples Nacional somente com obrigação comprovada |
| Saída | artefatos internos e composição da EFD F52, sem transmissão |

A aplicabilidade usa pacote oficial versionado e evidência do estabelecimento. Ausência, conflito ou insuficiência produz `INDETERMINATE`; o sistema não presume obrigação, dispensa, origem, item, quantidade ou vínculo.

## 4. Dependências e autoridades

- F16 fornece o mecanismo de pacote normativo versionado.
- F52 fornece o ciclo da EFD ICMS/IPI original ou retificadora interna.
- F54 é a autoridade de item, unidade canônica, posição e movimentos de estoque.
- F55 fornece o ciclo comum do Bloco K, modalidade, artefatos e integração.
- F57 é a autoridade dos apontamentos `K210/K215/K220` e da revisão original.
- O sistema externo é a autoridade da evidência que motivou a correção.

Nenhuma revisão F60 altera dados das F52, F54, F55 ou F57. Divergência bloqueia o pacote inteiro e volta ao sistema de origem ou à capacidade que detém a autoridade do dado.

## 5. Estados da revisão

`IMPORTED -> VALIDATING -> INDETERMINATE | INVALID | READY_FOR_REVIEW -> APPROVED | REJECTED -> STALE`

- `IMPORTED`: pacote íntegro recebido, ainda não validado;
- `VALIDATING`: schema, regras, vínculos e reconciliação em processamento;
- `INDETERMINATE`: aplicabilidade ou fundamento normativo insuficiente ou conflitante;
- `INVALID`: pacote estruturalmente inválido ou incompatível com as autoridades;
- `READY_FOR_REVIEW`: validações concluídas e artefatos reproduzíveis;
- `APPROVED`: revisão aceita por aprovador segregado;
- `REJECTED`: revisão rejeitada com motivo obrigatório;
- `STALE`: fonte, autoridade, pacote normativo ou dependência mudou após a revisão.

Estados decididos são imutáveis. Uma nova correção cria outra revisão F60 e preserva toda a cadeia anterior.

## 6. Contrato de entrada

O pacote contém, no mínimo:

- versão do schema e identificadores de tenant, empresa, estabelecimento e competência de escrituração;
- identificação e versão do sistema de origem;
- instante imutável de criação da revisão na origem;
- manifesto com arquivos, hashes, contagens e totais de controle;
- revisão F57 original, sua competência e seu hash aprovado;
- origem `3` ou `5`, registro, operação, item e apontamento originais;
- quantidade de correção positiva ou negativa, nunca ambas;
- evidência e justificativa da correção;
- fatores de conversão versionados quando a unidade informada divergir da unidade canônica.

Dados externos entram como `unknown`. Schema, manifesto, hash, chaves, competências, origem, registros, itens, unidades, quantidades, vínculos, contagens e totais são validados antes de criar revisão utilizável.

O mesmo pacote, com o mesmo hash e escopo, é idempotente. Mesmo identificador com conteúdo diferente é conflito auditável e não substitui a revisão anterior.

## 7. Correções de origem 3 — K210 e K215

Origem `3` corrige exclusivamente apontamentos `K210/K215` de revisão F57 anterior, aprovada e não `STALE`.

A correção identifica inequivocamente a desmontagem, o item desmontado ou resultante e o apontamento original. Datas e identificação da ordem seguem as regras temporais e de preenchimento do pacote oficial vigente.

Bloqueiam a revisão:

- referência a registro diferente de `K210/K215`;
- revisão F57 inexistente, não aprovada, `STALE` ou de outro estabelecimento;
- operação, item ou apontamento original inexistente ou ambíguo;
- quantidade positiva e negativa simultâneas, negativa ou com precisão inválida;
- correção duplicada ou sobreposta de forma incompatível;
- tentativa de corrigir operação ou estoque fora da cadeia da F57.

## 8. Correções de origem 5 — K220

Origem `5` corrige exclusivamente apontamentos `K220` de revisão F57 anterior, aprovada e não `STALE`.

O `K270` representa a correção do item de origem da movimentação interna e o `K275`, a correção do item de destino, preservando a relação entre ambos e as quantidades reconciliadas.

Bloqueiam a revisão:

- referência a registro diferente de `K220`;
- ausência ou ambiguidade dos itens de origem e destino;
- tentativa de usar a correção como ajuste genérico, transferência entre estabelecimentos ou substituto de outro registro;
- divergência de unidade, quantidade ou movimento em relação à F54 e à revisão F57;
- qualquer condição bloqueante comum da origem `3`.

## 9. Temporalidade, cadeia e supersessão

Cada correção informa a competência do apontamento original e a competência em que será escriturada. O pacote normativo vigente define as combinações temporais permitidas e os campos obrigatórios.

A revisão F60 calcula o resultado acumulado a partir do apontamento original e de todas as correções F60 aprovadas anteriores. Ela bloqueia:

- referência a revisão rejeitada, superada ou `STALE`;
- lacuna, bifurcação ou ciclo na cadeia de correções;
- correção que produza estado quantitativo impossível ou incompatível com a F54;
- composição concorrente sobre a mesma versão sem controle otimista.

Uma nova revisão aprovada torna a anterior histórica, sem apagá-la. A EFD consome somente a ponta aprovada e atual de cada cadeia.

## 10. Conversão, reconciliação e atomicidade

Quantidade é reconciliada na unidade canônica da F54. Conversão exige fator explícito, positivo, versionado, vigente e aprovado para o item e par de unidades.

Float é proibido. O cálculo usa decimal exato, preserva a precisão interna e arredonda somente na serialização conforme o pacote oficial.

Qualquer divergência de origem, revisão, operação, item, data, conversão, quantidade ou movimento bloqueia o pacote inteiro. Não existe aprovação parcial, exclusão local de linha, tolerância configurável, compensação entre correções, saldo implícito ou ajuste automático.

## 11. Composição, artefatos e hash

A revisão gera:

- fragmento canônico com `K270/K275` e origem `3` e/ou `5`;
- TXT interno na ordem e cardinalidade do leiaute vigente;
- manifesto com escopo, revisão F57 corrigida, cadeia, autoridades, versões, contagens, hashes e reconciliação;
- diagnóstico estruturado por correção, operação, item, movimento e regra;
- relatório legível com comparação antes/depois;
- resultado de parser independente comparado à projeção canônica.

O payload canônico inclui o instante imutável de criação da revisão. Instantes de download ou visualização pertencem somente à auditoria e não alteram o hash. Mesmas entradas, autoridades e pacote normativo produzem os mesmos artefatos e hashes.

## 12. Aprovação e integração

Somente `READY_FOR_REVIEW` pode seguir para `APPROVED` ou `REJECTED`. Importador e preparador não podem aprovar a própria revisão. A aprovação cabe a `contador` ou `admin_escritorio` distinto, dentro da carteira autorizada.

A F52 consome somente revisão F60 `APPROVED`, íntegra, aplicável e não `STALE`, na ponta atual da cadeia. A composição respeita ordem e cardinalidades oficiais e convive com revisões aprovadas das F55 a F59 sem fundir autoridades.

Nova fonte, revisão relevante das F52/F54/F55/F57, conversão ou pacote normativo marca a F60 e a EFD dependente como `STALE`. Não existe recálculo, aprovação ou retificação externa automática.

## 13. Contratos de domínio

### `BlockKSpecialOperationCorrectionRevision`

- identifica tenant, empresa, estabelecimento, competência e pacote;
- referencia a revisão F57 corrigida e a revisão F60 anterior quando existir;
- mantém hashes e versões das autoridades consumidas;
- mantém estado, versão otimista, autor, aprovador e motivo de rejeição;
- é imutável após decisão.

### `BlockKSpecialOperationCorrection`

- mantém origem `3` ou `5`, competência, registro, operação, item e apontamento originais;
- mantém quantidade positiva ou negativa e evidência;
- referencia os movimentos reconciliados da F54;
- nunca substitui nem apaga a origem.

Não existe entidade de declaração de zero para a F60.

## 14. Autorização, isolamento e auditoria

- `auxiliar`: importa e consulta dentro da carteira; não aprova;
- `contador`: importa, revisa e aprova revisão preparada por outro usuário;
- `admin_escritorio`: mesmas ações dentro do tenant, preservada a segregação;
- `auditor_readonly`: consulta revisões e artefatos; não altera estado;
- `cliente_portal` e demais papéis sem permissão fiscal: acesso negado.

Toda tabela transacional possui `tenant_id` e `empresa_id`, obrigatórios e sob RLS. Consulta sem contexto não retorna dados. Importação, validação, conflito, decisão, download, supersessão e propagação de `STALE` entram em auditoria append-only.

## 15. Concorrência e falhas

- alteração concorrente usa versão otimista e retorna HTTP 409;
- pacote parcial, hash divergente ou manifesto incompatível falha atomicamente;
- timeout ou indisponibilidade preserva o último estado consistente e permite retentativa idempotente;
- erro segue `application/problem+json` com código estável e `correlationId`;
- nenhuma falha parcial cria fragmento consumível pela F52.

## 16. Invariantes globais tocados

| Invariante | Aplicação na F60 |
|---|---|
| I-1 | revisões e correções carregam `tenant_id` e `empresa_id`, indexados e sob RLS |
| I-2 | ausência de contexto retorna conjunto vazio |
| I-4 | validação e reconciliação são determinísticas; LLM não calcula nem decide aplicabilidade |
| I-5 | integração fiscal exige aprovação humana registrada |
| I-6 | trilha e decisões são append-only |
| I-7 | revisão e correção fiscal não são apagadas |
| I-8 | pacote normativo é selecionado pelas competências do fato e da correção |
| I-9 | importação e composição são idempotentes |
| I-11 | competências são datas civis; timestamps são exibidos em `America/Sao_Paulo` |
| I-12 | mesmas entradas e versões reproduzem artefatos e hashes |

## 17. Contrato de UI

A tela parte de `docs/telas/contaia_central_de_escritura_o_sped_ecd_malha_fiscal_preventiva_rf_03/` para conteúdo, fluxo, hierarquia e densidade, sem copiar transmissão, recibo ou indicadores fictícios.

Em `Fiscal -> EFD ICMS/IPI -> Bloco K`, apresenta:

- seletor de estabelecimento e competência;
- aplicabilidade, modalidade, vigência e evidências;
- card próprio para correções de desmontagem e movimentação interna;
- importação por arquivo e resumo do manifesto;
- filtros por origem `3` e `5`;
- revisão F57, operação, itens e apontamentos originais;
- comparação antes/depois e cadeia de correções;
- divergências e vínculos com F52/F54/F55/F57;
- histórico de revisões, decisão e estado `STALE`;
- ações de revisar, aprovar, rejeitar e baixar artefatos conforme permissão.

Estados obrigatórios: carregando, vazio sem correção, importando, validando, indeterminado, inválido, pronto para revisão, aprovado, rejeitado, `STALE`, erro recuperável e acesso negado.

A implementação entrega temas CLARO e ESCURO, viewports de 375, 768, 1280 e 1536 px, navegação por teclado, foco visível, semântica, contraste e mensagens por Toast/Sonner. `frontend-design` é usada antes e durante a implementação; `impeccable`, no acabamento. A PR prova comparação com o protótipo, responsividade, estados, acessibilidade e o passe final de `FRONTEND.md` §20.1.

## 18. Critérios de aceite verificáveis

| Categoria | Prova obrigatória |
|---|---|
| Recorte | Goiás, autopeças, modalidade completa, regime, competência e aplicabilidade comprovados; insuficiência resulta em `INDETERMINATE` |
| Entrada | CSV/JSON, schema, manifesto, hash, idempotência, pacote parcial e identificador conflitante |
| Origem 3 | corrige somente `K210/K215` de F57 aprovada, com operação e item originais inequívocos |
| Origem 5 | corrige somente `K220`; `K270` representa a origem e `K275`, o destino |
| Quantidade | exatamente uma correção positiva ou negativa, decimal exato e conversão versionada |
| Cadeia | revisão própria vinculada à F57, histórico preservado, ponta única e supersessão imutável |
| Ausência | nenhuma declaração de zero e nenhum registro fictício |
| Atomicidade | qualquer divergência bloqueia o pacote inteiro; não há aprovação parcial nem exclusão local |
| Artefatos | TXT, manifesto, diagnóstico, relatório, parser independente e hashes reproduzíveis |
| Banco | RLS, carteira, concorrência, append-only, supersessão e propagação de `STALE` |
| Integração | F52 consome somente a ponta F60 aprovada, íntegra e atual |
| UI | temas, quatro viewports, estados, teclado, foco, contraste e acabamento comprovados |

## 19. Provas exigidas

- testes de regras para aplicabilidade, origens `3` e `5`, temporalidade, cadeia, quantidades, conversão, reconciliação, composição e `STALE`;
- testes de banco para atomicidade, idempotência, RLS, append-only, segregação, supersessão e concorrência;
- testes de artefatos e parser independente com fixtures válidas e inválidas;
- testes de tela para permissões, estados, comparação, cadeia e downloads;
- E2E da importação à integração na EFD, incluindo ambas as origens e divergência bloqueante;
- prova visual nos dois temas e viewports definidos.

## 20. Fora de escopo e destinos obrigatórios

| Item | Destino obrigatório |
|---|---|
| Produção conjunta (`K290` a `K302`) | capacidade própria posterior do MVP-2 para produção conjunta no Bloco K completo |
| Correções de F56, F58 ou F59 | permanecem nas próprias capacidades; a F60 aceita somente origens da F57 |
| Alteração automática da F54, F57 ou do sistema externo | correção ocorre na autoridade de origem e entra por nova evidência |
| ERP, ordem, planejamento, execução ou chão de fábrica | excluído pelo PRD §1.5 |
| Integração genérica com ERP/WMS | capacidade própria de integrações de estoque do MVP-2 |
| Lote, validade e número de série | capacidade própria de rastreabilidade avançada de estoque do MVP-2 |
| Outras UFs, segmentos e períodos | expansão fiscal própria do MVP-2 |
| Lucro Real e não cumulatividade | capacidades tributárias próprias do MVP-2 |
| PVA, assinatura, transmissão, recibo e substituição oficial | capacidade própria de entrega oficial após geração interna validada |
| Produção, piloto, pagamento ou efeito fiscal externo | gate de produção posterior ao MVP-4 |

## 21. Dúvidas resolvidas

| Pergunta | Decisão do PI em 26/09/2026 |
|---|---|
| Qual capacidade ocupa F60/SPEC-060? | correções das operações da F57 |
| Quais origens entram? | origem `3` para `K210/K215` e origem `5` para `K220` |
| Qual é o modelo de revisão? | revisão própria, imutável e vinculada à F57 original |
| Ausência exige declaração de zero? | não; correção é eventual e a ausência não fabrica evidência |
| Qual é a fonte? | pacote externo CSV/JSON com manifesto e evidência da correção |
| Como tratar divergência? | bloquear o pacote inteiro |
| Qual recorte fiscal? | Goiás, autopeças, estabelecimento industrial/equiparado, desde setembro/2026; Lucro Presumido quando obrigado e Simples somente com obrigação comprovada |
| Há questões abertas? | Nenhuma |

## 22. Gate de conformidade documental

- **Identidade:** F60/SPEC-060, MVP-2 e origem no PRD estão explícitos.
- **Comportamento:** importação, vínculo, validação, reconciliação, revisão e integração são observáveis.
- **Aceite:** regras, banco, artefatos, tela e E2E possuem provas verificáveis.
- **Invariantes:** I-1, I-2, I-4 a I-9, I-11 e I-12 estão aplicados.
- **Limites:** não há edição da origem, ERP, produção conjunta, PVA ou efeito externo.
- **Dúvidas:** todas as decisões do PI foram registradas; não há questão aberta.
- **Destinos:** todo complemento aponta capacidade nomeada ou exclusão normativa.
- **UI:** caminho, estados, temas, viewports, acessibilidade e skills estão explícitos.
- **Tamanho:** Médio; a fatia cobre somente a lacuna de correções da F57.

## 23. Referências normativas consultadas

- SPED, Guia Prático EFD ICMS/IPI versão 3.2.2: <https://sped.rfb.gov.br/arquivo/download/8112>;
- CONFAZ, Ajuste SINIEF 02/2009 e alterações: <https://www.confaz.fazenda.gov.br/legislacao/ajustes/2009/AJ_002_09>.

## 24. Aprovação

Recorte aprovado pelo PI em 26/09/2026 para criação da issue, commit e push direto na `main`.
