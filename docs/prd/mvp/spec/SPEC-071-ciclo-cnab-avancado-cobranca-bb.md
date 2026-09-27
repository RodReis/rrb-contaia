# SPEC-071 — Ciclo CNAB avançado de cobrança do Banco do Brasil

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F71
> **Origem:** PRD §§3, 5.3, 6.5, 7.1, 9.1, 10.4, 12, 13.2, 14, 15 e 16
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 27/09/2026

---

## 1. Objetivo

Estender o núcleo local da F70 com o ciclo avançado de cobrança por arquivos CNAB 240 e CNAB 400 do Banco do Brasil. A fatia prepara, revisa e gera instruções de alteração de vencimento, concessão de desconto, protesto, sustação e baixa de registro para cobranças F70 confirmadas, importa os retornos correspondentes e mantém o estado bancário observado.

A F71 não transmite arquivo, consulta o banco, movimenta dinheiro nem altera automaticamente o título F68. O estado bancário confirmado pelo retorno é evidência externa observada; vencimento, desconto, saldo, situação e baixa do título permanecem sob autoridade da F68.

## 2. Resultado observável

Em `Financeiro -> CNAB de cobrança -> Instruções`, o usuário pode:

- consultar cobranças F70 com registro confirmado e seu estado bancário observado;
- selecionar cobranças elegíveis e escolher um único tipo de instrução por lote;
- informar explicitamente os parâmetros exigidos em cada item;
- validar cobertura, elegibilidade, campos, posições, sequência e conflitos antes de gerar;
- preparar e submeter a instrução para revisão segregada;
- aprovar, gerar e baixar o arquivo local, o manifesto e os hashes reproduzíveis;
- importar retorno BB 240 ou 400 e consultar confirmações, rejeições e divergências;
- visualizar o estado bancário atualizado e a eventual divergência em relação ao título F68;
- consultar arquivo, retorno, extração, decisões, conflitos e trilha append-only.

Gerar instrução não significa enviá-la ao banco. Confirmação bancária de alteração, desconto ou baixa de registro não modifica a parcela F68.

## 3. Dependências e autoridades

| Fonte | Autoridade consumida |
|---|---|
| F7–F10 | usuário, papel, carteira, isolamento e RLS |
| F24 | auditoria append-only e evidência íntegra |
| F68 | compromisso, parcela, vencimento, saldo, situação, baixa e estorno |
| F70 | perfil BB, registro de cobrança, leiaute, remessa, retorno, ocorrência e identificação bancária |
| F71 | instrução avançada, parâmetros, lote, retorno associado e estado bancário observado |

A F68 permanece autoridade financeira. A F70 permanece autoridade para o registro inicial e sua identidade bancária. A F71 acrescenta eventos bancários posteriores sem reescrever nenhuma das duas origens.

## 4. Fontes técnicas e cobertura

O pacote técnico versionado da F71 registra URL, título, versão identificável, data de consulta, hash e vigência operacional das fontes oficiais do Banco do Brasil usadas pela F70, complementadas pelas tabelas BB de comandos e ocorrências para:

- alteração de vencimento;
- concessão, alteração ou cancelamento de desconto quando o leiaute e a carteira cobrirem a modalidade;
- pedido de protesto;
- sustação de protesto;
- baixa de registro de cobrança.

A cobertura é restrita ao banco `001`, aos perfis BB e às versões CNAB 240/400 comprovadas por manual e fixtures aprovadas. Código, parâmetro, combinação, carteira ou versão sem cobertura resulta em `INDETERMINATE`; a F71 não aproxima semântica nem presume equivalência entre leiautes.

## 5. Elegibilidade

Uma cobrança só recebe instrução quando:

- pertence ao mesmo tenant, empresa, carteira e perfil BB do lote;
- foi criada pela F70 e possui confirmação bancária inequívoca de registro;
- mantém identificação bancária íntegra e registro ativo no estado observado;
- referencia parcela F68 existente, sem apagar divergências posteriores;
- não possui outra instrução gerada aguardando confirmação ou rejeição definitiva;
- admite o comando no leiaute, versão, carteira e estado bancário atuais.

Remessa apenas gerada, registro rejeitado, liquidado, já baixado, identificação externa digitada manualmente, perfil arquivado ou cobrança de outro banco não é elegível. Divergência material entre F68, F70 e o estado bancário bloqueia a geração e exige revisão; ela nunca é vencida por confirmação genérica.

## 6. Tipos de instrução e parâmetros

Cada item possui exatamente um tipo e parâmetros explícitos. Nenhum valor é preenchido silenciosamente pelo perfil ou copiado da F68.

### 6.1 Alteração de vencimento

Exige nova data civil válida, diferente da observada no banco e aceita pela combinação de leiaute, carteira e estado. A data é um pedido bancário; mesmo confirmada, não altera o vencimento F68.

### 6.2 Desconto

Exige modalidade coberta, valor em centavos ou percentual na precisão admitida, data-limite e demais campos exigidos pelo manual. Valor negativo, acima do saldo aplicável, combinação incompleta ou modalidade não coberta bloqueia o item. O desconto bancário observado não cria baixa nem reduz saldo F68.

### 6.3 Protesto e sustação

Pedido de protesto exige prazo e parâmetros explícitos aceitos pelo perfil. Sustação exige estado observado compatível e referência ao protesto confirmado ou em curso quando o manual assim exigir. A F71 não cria regra cartorial nem afirma protesto ou sustação sem retorno coberto.

### 6.4 Baixa de registro

Baixa de registro encerra a cobrança no estado bancário observado quando confirmada. Não cancela, liquida nem arquiva o título F68 e não produz `Settlement`.

## 7. Instrução, lote e serialização

`CollectionInstruction` representa o pedido imutável por cobrança, com tipo, parâmetros, snapshot do estado bancário anterior, referência F68/F70, pacote técnico e versão.

`CollectionInstructionBatch` agrupa uma ou mais instruções do mesmo tipo, tenant, empresa, perfil, leiaute, versão, convênio e carteira. Tipos mistos e contextos incompatíveis no mesmo arquivo são proibidos.

Estados persistidos do lote:

`DRAFT -> PENDING_REVIEW -> APPROVED -> GENERATED -> AWAITING_RETURN`

Transições alternativas:

- `DRAFT | PENDING_REVIEW -> REJECTED`, com motivo;
- `DRAFT | PENDING_REVIEW -> STALE`, quando elegibilidade, perfil, pacote ou estado bancário mudar;
- `AWAITING_RETURN -> CONFIRMED | BANK_REJECTED | CONFLICT | INDETERMINATE` conforme retorno;
- nova tentativa após rejeição cria outro lote relacionado e preserva o anterior.

A geração atômica produz arquivo de largura fixa, manifesto, hashes, versão do serializador e relatório independente por registro e posição. Sequências, contagens, totais, encoding e finais de linha seguem o perfil e o pacote técnico.

## 8. Exclusão mútua, ordem e idempotência

Existe no máximo uma instrução gerada sem desfecho definitivo por cobrança. Enquanto estiver `AWAITING_RETURN`, qualquer nova geração para o mesmo registro retorna HTTP 409, sem criar fila oculta nem escolher precedência.

A identidade lógica considera cobrança F70, estado bancário anterior, tipo, parâmetros canônicos, perfil versionado, leiaute e sequência. Repetir a mesma identidade retorna o registro existente. Mesmo identificador com conteúdo diferente é conflito.

A sequência é alocada transacionalmente somente na geração bem-sucedida. Falha não publica arquivo parcial nem libera indevidamente a cobrança. Retorno atrasado ou fora de ordem é preservado e classificado como conflito; nunca regride silenciosamente estado confirmado mais recente.

## 9. Importação, correspondência e retorno

A F71 reutiliza a preservação imutável, validação estrutural e extração versionada da F70. O retorno é relacionado deterministicamente por identificadores do lote e item, perfil, convênio, carteira, identificação bancária, tipo de comando e estado anterior.

Resultados de correspondência:

- `UNIQUE_MATCH`: uma instrução e uma cobrança compatíveis;
- `NO_MATCH`: retorno preservado sem efeito;
- `MULTIPLE_MATCHES`: candidatos expostos, sem escolha automática;
- `CONFLICT`: identidade existe, mas comando, parâmetros, empresa, estado ou ordem divergem;
- `INDETERMINATE`: código, regra ou evidência insuficiente.

Somente `UNIQUE_MATCH` com código coberto aplica automaticamente confirmação ou rejeição ao estado bancário observado. Conflito, multiplicidade, ausência ou indeterminação nunca atualizam o estado.

## 10. Estado bancário observado

`ObservedBankCollectionState` é uma projeção reconstruível dos eventos F70/F71 confirmados. Ela registra, quando coberto, vencimento bancário, desconto vigente, situação de protesto, situação do registro, identificadores e última ocorrência aplicada.

A projeção é atualizada automaticamente por retorno válido e inequivocamente conciliado. Cada atualização referencia o evento bruto, o pacote técnico e o estado anterior; reprocessamento idempotente produz o mesmo resultado.

Divergências com a F68 são exibidas e auditadas, sem sincronização automática. Mudança financeira correspondente exige fluxo próprio da F68 ou fatia futura explicitamente aprovada.

## 11. Autorização e segregação

- `auxiliar`: seleciona cobranças, informa parâmetros, prepara lote e importa retorno; não aprova nem gera arquivo final;
- `gestor_financeiro`: aprova ou rejeita lote e gera artefato dentro da carteira, desde que não o tenha preparado;
- `admin_escritorio`: mesmas ações no tenant, preservada a segregação;
- `contador`: consulta instruções, retornos, divergências e trilha; não executa instrução;
- `auditor_readonly`: consulta e exporta evidência sem mutação;
- `cliente_portal` e papéis sem permissão: acesso negado;
- `super-admin` local: mantém infraestrutura, sem decidir cobrança empresarial.

Download do arquivo gerado é auditado. A atualização automática do estado observado decorre apenas de retorno coberto; não substitui a aprovação humana exigida para preparar o arquivo de instrução.

## 12. Isolamento, concorrência e falhas

- entidades transacionais carregam `tenant_id` e `empresa_id`, índices e RLS;
- toda consulta valida empresa e carteira no servidor;
- submissão, aprovação, geração, importação e aplicação usam versão otimista;
- lote, arquivo, manifesto e hashes persistem atomicamente;
- retorno inválido não produz evento funcional nem estado parcial;
- falha preserva o último estado íntegro e permite retentativa explícita;
- erro segue `application/problem+json` com código estável e `correlationId`.

## 13. Auditoria

Seleção, edição de parâmetro, submissão, aprovação, rejeição, geração, download, importação, validação, extração, correspondência, aplicação, conflito, reprocessamento e tentativa negada geram evento append-only.

Cada evento registra tenant, empresa, cobrança, instrução, autor, papel, instante, `correlationId`, estado anterior e posterior, pacote técnico, resultado, motivo e referências F68/F70. Arquivos, parâmetros, retornos e decisões não são apagados fisicamente.

## 14. Invariantes globais tocados

| Invariante | Aplicação na F71 |
|---|---|
| I-1 | instruções, lotes, retornos e projeções carregam tenant e empresa, índices e RLS |
| I-2 | consulta sem contexto de empresa e carteira não retorna dado bancário ou financeiro |
| I-3 | valores monetários usam inteiros em centavos; percentual usa precisão explícita, nunca float |
| I-4 | elegibilidade, serialização, correspondência e projeção são determinísticas; LLM não decide |
| I-5 | arquivo de instrução exige aprovação humana segregada |
| I-6 | pedidos, arquivos, retornos, estados e decisões preservam histórico append-only |
| I-7 | registro financeiro F68 e evidência bancária não são apagados nem reescritos |
| I-9 | geração, importação e aplicação de retorno são idempotentes |
| I-11 | vencimento e limites são datas civis; timestamps exibem `America/Sao_Paulo` |
| I-12 | mesmos eventos e pacote técnico reproduzem arquivo e estado bancário observado |

## 15. Contrato de UI

A UI amplia `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/` e a tela CNAB da F70 com a aba `Instruções`. O contexto de empresa, perfil BB, leiaute, cobrança e retornos é preservado.

A aba apresenta cobranças elegíveis, tipo único do lote, parâmetros por item, validações, resumo, revisão segregada, geração, download, upload de retorno, estado bancário observado, divergências com F68, conflitos e histórico.

Estados obrigatórios: carregando, vazio, sem registro confirmado, inelegível, rascunho, pendente de revisão, desatualizado, aprovado, gerando, aguardando retorno, confirmado, rejeitado pelo banco, instrução já em voo, retorno fora de ordem, sem correspondência, múltiplos candidatos, conflito, código não suportado, `INDETERMINATE`, erro recuperável, conflito de versão e acesso negado.

A implementação entrega temas CLARO e ESCURO, viewports de 375, 768, 1280 e 1536 px, teclado, foco, semântica, contraste, máscaras de data e R$, confirmação e Toast/Sonner. `frontend-design` é obrigatória antes e durante a implementação; `impeccable`, no acabamento. A PR prova comparação visual, responsividade, estados e acessibilidade conforme `FRONTEND.md` §20.1.

## 16. Critérios de aceite verificáveis

| Categoria | Prova obrigatória |
|---|---|
| Elegibilidade | somente registro F70 confirmado, ativo e coberto aceita instrução |
| Cobertura | alteração de vencimento, desconto, protesto, sustação e baixa geram somente sob manual/fixture compatível |
| Parâmetros | todos são explícitos por item; ausência, combinação inválida ou limite excedido bloqueia geração |
| Lote | contém um único tipo, perfil, leiaute, versão, convênio e carteira |
| Exclusão mútua | cobrança com instrução em voo rejeita nova geração com conflito estável |
| CNAB 240/400 | registros, posições, sequências, contagens, totais, encoding e hashes são válidos e reproduzíveis |
| Retorno | confirmação/rejeição única atualiza a projeção; demais correspondências não produzem efeito |
| Autoridade | nenhuma confirmação altera automaticamente título, saldo, vencimento ou baixa F68 |
| Idempotência | repetição não duplica lote, sequência, retorno, evento nem atualização de estado |
| Autorização | auxiliar prepara; gestor/admin aprovam; contador e auditor consultam |
| Banco de dados | RLS, carteira, atomicidade, concorrência e append-only são provados |
| UI | aba Instruções prova dois temas, quatro viewports, estados, teclado, foco e contraste |
| Efeito externo | nenhum teste transmite arquivo, usa credencial bancária ou afirma execução real |

## 17. Provas exigidas

- fixtures BB versionadas de remessa e retorno para os cinco tipos em CNAB 240 e 400, somente onde houver cobertura oficial;
- testes parametrizados de códigos, campos, posições, preenchimento, datas, valores, percentuais, sequências, contagens e totais;
- parser independente do gerador para validar arquivo, manifesto e hashes;
- testes negativos para registro não confirmado, estado incompatível, perfil arquivado, parâmetro ausente, combinação sem cobertura e divergência F68/F70;
- testes de exclusão mútua, nova tentativa após rejeição e retorno duplicado, atrasado ou fora de ordem;
- testes de correspondência para candidato único, nenhum, múltiplos, conflito e `INDETERMINATE`;
- testes de banco para RLS, carteira, sequência concorrente, atomicidade, idempotência, projeção e auditoria;
- E2E do registro confirmado F70 até arquivo local e do retorno até atualização exclusiva do estado bancário observado;
- prova visual nos dois temas e quatro viewports.

## 18. Fora de escopo e destinos obrigatórios

| Item | Destino obrigatório |
|---|---|
| CNAB 240 de pagamento de boletos e tributos | fatia própria de pagamentos CNAB no MVP-2 |
| CNAB 240 de folha sem execução | fatia própria de validação de arquivo de folha no MVP-2, sem antecipar RF-05 |
| Bancos diferentes do Banco do Brasil | adaptadores bancários próprios no MVP-2, com manual oficial e fixtures aprovadas |
| API Cora para cobrança, pagamento, extrato e webhooks | fatia própria de integração bancária por API no MVP-2 |
| Transmissão, SFTP, API, consulta ou confirmação online | integração bancária própria; produção somente após o MVP-4 |
| Atualização automática do título F68 a partir da instrução bancária | fatia própria de sincronização financeiro-bancária no MVP-2 |
| Emissão visual, consulta externa e segunda via de boleto | fatia própria de integração bancária no MVP-2 |
| Aging e fluxo de caixa 30/60/90 | fatia própria de aging e fluxo projetado no MVP-2 |
| Open Finance, ITP, Pix e conciliação multi-critério | fatias próprias do MVP-2 |
| Cadastro mestre e deduplicação de contrapartes | fatia própria de contrapartes financeiras no MVP-2 |
| Baixa automática e lançamento contábil automático | fatias próprias de conciliação e integração financeiro-contábil no MVP-2 |

## 19. Dúvidas resolvidas

| Pergunta | Decisão do PI em 27/09/2026 |
|---|---|
| Qual capacidade ocupa F71/SPEC-071? | ciclo CNAB avançado de cobrança |
| Quais instruções entram? | alteração de vencimento, desconto, protesto, sustação e baixa de registro |
| Qual banco e leiautes? | Banco do Brasil, CNAB 240 e CNAB 400 |
| Qual cobrança é elegível? | somente registro F70 confirmado e ainda ativo |
| Como agrupar? | lote homogêneo por tipo, perfil, leiaute e versão |
| Pode haver instruções simultâneas? | não; uma instrução em voo por cobrança |
| De onde vêm os parâmetros? | explícitos por item, sem defaults silenciosos |
| O retorno precisa de revisão? | retorno válido e único atualiza automaticamente apenas o estado bancário observado |
| O retorno altera a F68? | não; divergências são exibidas e qualquer mudança financeira segue fluxo próprio |
| Onde aparece? | aba `Instruções` na tela CNAB da F70 |
| Há transmissão ou efeito externo? | não; arquivos e retornos são operados localmente |
| Há questões abertas? | Nenhuma |

## 20. Gate de conformidade documental

- **Identidade:** F71/SPEC-071, MVP-2 e origem no PRD estão explícitos.
- **Comportamento:** instrução, lote, geração, retorno e projeção bancária são observáveis.
- **Aceite:** regras, arquivos, integrações F68/F70, banco, autorização, tela e E2E têm provas verificáveis.
- **Invariantes:** I-1 a I-7, I-9, I-11 e I-12 aplicáveis estão declarados.
- **Limites:** não há pagamento, folha, outro banco, transmissão, alteração automática da F68 ou baixa financeira.
- **Dúvidas:** todas as decisões do PI estão registradas; não há questão aberta.
- **Destinos:** cada complemento aponta capacidade, fatia e MVP obrigatórios.
- **UI:** referência, estados, temas, viewports, acessibilidade e skills estão explícitos.
- **Tamanho:** Grande; os cinco comandos compartilham elegibilidade, geração, retorno e projeção, formando uma única vertical auditável.

## 21. Aprovação

Recorte aprovado pelo PI em 27/09/2026 para criação da issue, commit e push direto na `main`.
