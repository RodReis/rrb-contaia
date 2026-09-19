# SPEC-026 / F26 — Resolução tributária de entradas NF-e em Goiás

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD v3.1 §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16
>
> **Estado:** aprovada pelo PI em 19/09/2026
>
> **Tamanho:** Grande e delimitada — amplia o motor da F16, publica um pacote normativo inicial e resolve entradas persistidas pela F18; apuração, guias e exceções tributárias permanecem em fatias próprias
>
> **Ambiente:** Docker local; fontes oficiais consultadas e empacotadas com vigência explícita; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #28

## 1. Objetivo

Permitir que o escritório processe os itens de uma NF-e modelo 55 de entrada de empresa estabelecida em Goiás e obtenha uma resolução tributária determinística, explicável e reproduzível para empresas do Simples Nacional e do Lucro Presumido.

Sucesso significa selecionar exatamente uma regra publicada para cada dimensão tributária coberta, informar o tratamento aplicável e a elegibilidade de crédito, preservar a memória da decisão em snapshot versionado e abster-se explicitamente quando a operação estiver fora da cobertura ou não possuir dados suficientes.

A F26 não apura competência, não calcula imposto a recolher, não gera guia, não cria lançamento contábil e não substitui revisão profissional. Valor destacado no documento, tratamento da entrada e tributo devido pelo destinatário são conceitos distintos.

## 2. Fronteira da fatia

Esta fatia entrega:

- evolução tipada do catálogo e avaliador da F16 para seleção por contexto fiscal;
- importação, validação, revisão e publicação imutável de pacote normativo curado;
- pacote inicial para destinatários `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO` estabelecidos em Goiás;
- resolução de compras internas e interestaduais para revenda em NF-e modelo 55 persistida pela F18;
- tratamento e elegibilidade por item para `ICMS`, `PIS`, `COFINS`, `IBS_UF`, `IBS_MUN` e `CBS`, somente quando a fonte e a vigência do pacote permitirem;
- estado explícito de indeterminação para lacuna, ambiguidade, dado ausente ou condição não suportada;
- snapshot imutável de cada processamento e histórico de reprocessamentos;
- interface final de cobertura, processamento, resultado, memória e comparação de revisões;
- auditoria append-only do ciclo do pacote e das resoluções.

Não entrega:

- apuração mensal, saldo, compensação, crédito acumulado, débito ou imposto a recolher;
- DAS, DARF ou qualquer guia;
- substituição tributária, DIFAL, incidência monofásica, importação, benefício fiscal, devolução ou transferência;
- outras UFs, outros regimes, CT-e, NFS-e, NFC-e ou documento não persistido pela F18;
- coleta automática de legislação, interpretação por LLM ou atualização silenciosa;
- cobertura da transição IBS/CBS até 2033 além do que estiver explicitamente vigente no pacote inicial.

## 3. Cobertura tributária aprovada

### 3.1 Empresa destinatária

A resolução exige empresa ativa com:

- `tenantId` e `companyId` válidos no contexto da requisição;
- estabelecimento destinatário em `GO`;
- regime tributário `SIMPLES_NACIONAL` ou `LUCRO_PRESUMIDO` vigente na data do fato gerador;
- inscrições e dados cadastrais necessários disponíveis;
- usuário autorizado e empresa dentro da carteira, quando aplicável.

Mudança de regime ou UF não reescreve snapshots anteriores. O contexto usado fica congelado em cada revisão.

### 3.2 Documento e operação

Entram na cobertura inicial:

- NF-e modelo 55 autorizada e persistida pela F18;
- direção de entrada para o destinatário;
- compra interna ou interestadual para revenda;
- item com data do fato gerador, CFOP, NCM, CST ou CSOSN, origem e destino identificáveis;
- emitente e destinatário distintos e consistentes com o documento.

Qualquer uma destas condições retira o item da cobertura inicial:

- substituição tributária;
- DIFAL;
- tributação monofásica;
- importação;
- benefício, incentivo, redução ou crédito presumido não modelado pelo pacote;
- devolução, retorno, remessa ou transferência;
- uso, consumo ou ativo imobilizado;
- documento cancelado, denegado ou sem autorização válida;
- combinação de CFOP, NCM, CST/CSOSN ou origem não reconhecida.

Item fora da cobertura recebe `INDETERMINATE`, lista os motivos e aponta a capacidade posterior necessária. O motor nunca cai para uma alíquota genérica.

### 3.3 Resultado por dimensão tributária

Para cada item e tributo, a resolução informa:

- estado `APPLICABLE`, `NOT_APPLICABLE` ou `INDETERMINATE`;
- elegibilidade `ALLOWED`, `BLOCKED`, `INDETERMINATE` ou `NOT_RELEVANT`;
- regra e versão selecionadas;
- pacote, jurisdição e intervalo de vigência;
- fatos normalizados usados na seleção;
- justificativa estruturada e referências normativas;
- dados ausentes e condições fora da cobertura;
- valor declarado no documento, quando existir, sem sobrescrevê-lo;
- avisos de transição IBS/CBS aplicáveis à data e ao regime.

`ALLOWED` significa elegibilidade segundo a regra publicada para a operação coberta; não constitui apropriação, lançamento ou saldo de crédito. A efetivação pertence à apuração posterior.

## 4. Pacote normativo curado

### 4.1 Identidade e conteúdo

Cada pacote possui:

- identificador e versão semântica estáveis;
- revisão do schema do pacote;
- jurisdição `BR` e `GO`;
- regimes cobertos;
- documentos, direções e finalidades cobertos;
- data de corte da curadoria;
- vigência inicial e final opcional;
- matriz de cobertura e exclusões;
- fontes oficiais com órgão, título, URL, dispositivo, publicação, consulta e vigência;
- regras tipadas;
- fixtures de conformidade;
- hash SHA-256 do conteúdo canônico;
- autor da importação, revisor e instantes do ciclo de vida.

O pacote inicial usa como data de corte **19/09/2026**. A implementação deve revalidar as fontes oficiais no momento de construir o pacote; a data não congela legislação futura nem autoriza usar conteúdo revogado.

### 4.2 Ciclo de vida

```text
IMPORTADO ── validar ──▶ VALIDADO ── revisar ──▶ REVISADO ── publicar ──▶ PUBLICADO ──▶ ARQUIVADO
```

- importação cria versão nova e não altera pacote anterior;
- validação verifica schema, catálogo, fontes, vigências, conflitos, cobertura e fixtures;
- revisão humana registra responsável e declaração de conferência;
- publicação exige validação e revisão concluídas;
- pacote publicado é imutável;
- correção exige nova versão, com diff em relação à anterior;
- arquivamento impede novos processamentos fora da vigência, mas preserva reprodução histórica;
- no máximo uma versão publicada pode cobrir a mesma combinação de jurisdição, regime, documento, operação e data;
- rollback operacional seleciona outra versão publicada válida; nunca modifica pacote histórico.

Pacote não revisado ou com fonte inacessível, revogada, sem dispositivo ou sem vigência conhecida não pode ser publicado como oficial.

### 4.3 Autoria e atualização

O `super-admin` local importa e publica pacotes, preservando o contrato da F16. Não existe crawler, scraping, monitoramento automático de diário oficial nem regra produzida por LLM nesta fatia.

A interface e a API nunca descrevem o pacote como “legislação completa”. Exibem cobertura, exclusões e data de corte. Nova norma ou alteração material exige nova versão curada.

## 5. Seleção determinística

### 5.1 Entradas tipadas

O seletor usa somente catálogos e campos tipados:

- data do fato gerador;
- regime vigente do destinatário;
- UF de origem e destino;
- modelo e direção do documento;
- finalidade da aquisição;
- CFOP;
- NCM;
- CST ou CSOSN;
- indicador de substituição tributária;
- indicadores de importação, monofásico, benefício, devolução e transferência;
- tributo solicitado.

Não existe expressão livre, script, `eval`, precedência oculta, URL fornecida pelo cliente ou regra executável enviada pelo navegador.

### 5.2 Resultado único e abstenção

Uma combinação coberta seleciona exatamente uma regra por tributo. Zero regras aplicáveis produz `INDETERMINATE` por ausência de cobertura. Duas ou mais regras aplicáveis produzem erro de integridade e impedem a conclusão do snapshot.

Especificidade não resolve colisão. Ordem de importação, data de criação e versão mais recente não funcionam como desempate.

Dados fiscais ausentes ou contraditórios também produzem `INDETERMINATE`. O usuário recebe o campo, a origem esperada e o caminho de correção; não pode preencher arbitrariamente um dado já presente na NF-e.

### 5.3 Precisão e relógio

Dinheiro permanece em centavos inteiros. Percentuais e fatores usam representação decimal exata ou racional. Float é proibido.

A data do fato gerador seleciona regime, pacote e regra. O “agora” entra por parâmetro somente para operações administrativas e auditoria. Reprocessar hoje um documento histórico com a mesma versão reproduz a mesma resolução.

## 6. Snapshot e reprocessamento

Cada processamento concluído cria um snapshot imutável contendo:

- tenant, empresa, documento e item;
- revisão sequencial por documento;
- contexto cadastral congelado;
- hash da entrada fiscal normalizada;
- pacote, versão e hash;
- regras selecionadas por tributo;
- decisões, elegibilidades, justificativas e fontes;
- valores declarados usados apenas como evidência;
- condições indeterminadas e dados faltantes;
- usuário ou identidade técnica, instante e `correlationId`.

Reprocessamento sempre cria revisão nova. A revisão anterior permanece consultável e comparável. Repetir a mesma solicitação com a mesma chave idempotente devolve o mesmo snapshot.

Mudança de pacote, regime, cadastro ou normalização exige motivo de reprocessamento. O diff mostra fatos, regras e decisões alterados. Nenhuma revisão cria apuração, crédito apropriado, guia ou lançamento.

## 7. Autorização e auditoria

- `super-admin`: importa, valida, revisa, publica e arquiva pacotes; não acessa dados fiscais de tenant por esse papel global.
- `admin_escritorio` e `contador`: processam, reprocessam e consultam documentos das empresas autorizadas.
- `auxiliar`: consulta e processa quando a permissão fiscal estiver presente; não publica pacote.
- `auditor_readonly`: consulta snapshots, memória, fontes e histórico; não processa nem altera.
- demais papéis: negados por padrão.

Pacotes são globais; documentos e snapshots pertencem obrigatoriamente a tenant e empresa e ficam sob RLS de dois níveis.

Eventos append-only registram importação, validação, revisão, publicação, arquivamento, processamento, abstenção, falha, reprocessamento e consulta de fonte. O evento não duplica XML completo nem conteúdo integral de norma.

## 8. Contrato de interface

### 8.1 Referência e composição

Referência principal:

- `docs/telas/contaia_apura_o_fiscal_tribut_ria_reforma_ibs_cbs_rf_03/screen.png`;
- `docs/telas/contaia_apura_o_fiscal_tribut_ria_reforma_ibs_cbs_rf_03/code.html`.

A F26 compõe a área `Fiscal → Resolução tributária` sem reintroduzir apuração, guias, fechamento ou KPIs que ainda não existem.

A experiência possui duas visões:

1. **Pacotes normativos**, exclusiva do `super-admin`: cobertura, fontes, validações, diff, revisão e publicação.
2. **Documentos resolvidos**, por tenant: fila de NF-e, cobertura, resultado por item, memória e revisões.

### 8.2 Lista e detalhe

A lista de documentos mostra empresa, emitente, chave mascarada, emissão, regime, quantidade de itens, pacote, revisão e estado textual. Filtros: empresa, período, regime, estado da resolução e presença de indeterminação.

O detalhe mostra:

- contexto da empresa e do documento;
- cobertura e exclusões do pacote;
- itens com CFOP, NCM, CST/CSOSN e origem;
- decisão e elegibilidade por tributo;
- memória estruturada e fontes;
- dados faltantes e caminho de correção;
- comparação entre valor declarado e tratamento resolvido, sem afirmar divergência jurídica automática;
- histórico e comparação de revisões;
- ação de reprocessar com motivo.

Estado e elegibilidade nunca dependem somente de cor. `INDETERMINATE` não aparece como erro técnico nem como tratamento aprovado.

### 8.3 Estados e acessibilidade

Estados obrigatórios:

- carregando com skeleton;
- sem pacote publicado;
- sem documentos elegíveis;
- pacote importado, inválido, validado, revisado, publicado e arquivado;
- processamento em andamento;
- resolução integral;
- resolução parcialmente indeterminada;
- item fora da cobertura;
- dado fiscal ausente;
- regra ausente;
- ambiguidade de regras;
- documento alterado durante o processamento;
- conflito de revisão;
- acesso negado;
- falha técnica com preservação do último snapshot.

Provas obrigatórias:

- temas CLARO e ESCURO;
- viewports 768, 1024 e 1440 px;
- teclado, foco visível, retorno de foco e ordem previsível;
- tabelas responsivas com acesso ao detalhe sem ocultar estado ou ação;
- processamento assíncrono anunciado sem excesso;
- fontes, decisões e avisos com nomes acessíveis;
- redução de movimento respeitada;
- `frontend-design` antes e durante a implementação e `impeccable` no passe final, conforme `FRONTEND.md` §20.1.

## 9. Contratos internos e API

### 9.1 Tipos mínimos

```ts
type TaxRegime = "SIMPLES_NACIONAL" | "LUCRO_PRESUMIDO";

type TaxDimension =
  | "ICMS"
  | "PIS"
  | "COFINS"
  | "IBS_UF"
  | "IBS_MUN"
  | "CBS";

type TaxTreatmentStatus =
  | "APPLICABLE"
  | "NOT_APPLICABLE"
  | "INDETERMINATE";

type CreditEligibility =
  | "ALLOWED"
  | "BLOCKED"
  | "INDETERMINATE"
  | "NOT_RELEVANT";

type TaxTreatmentDecision = {
  tax: TaxDimension;
  status: TaxTreatmentStatus;
  creditEligibility: CreditEligibility;
  ruleId: string | null;
  reasons: readonly string[];
  missingInputs: readonly string[];
  sourceIds: readonly string[];
};

type TaxTreatmentSnapshot = {
  id: string;
  tenantId: string;
  companyId: string;
  fiscalDocumentId: string;
  revision: number;
  packageId: string;
  packageVersion: string;
  packageHash: string;
  inputHash: string;
  decisions: readonly TaxTreatmentDecision[];
  correlationId: string;
  createdAt: string;
};
```

### 9.2 Endpoints mínimos

```text
GET  /tax-rule-packages
POST /tax-rule-packages/import
GET  /tax-rule-packages/:id
POST /tax-rule-packages/:id/validate
POST /tax-rule-packages/:id/review
POST /tax-rule-packages/:id/publish
POST /tax-rule-packages/:id/archive

POST /fiscal-documents/:id/tax-treatment-resolutions
GET  /fiscal-documents/:id/tax-treatment-resolutions
GET  /fiscal-documents/:id/tax-treatment-resolutions/:revision
GET  /fiscal-documents/:id/tax-treatment-resolutions/compare
```

Importação aceita arquivo no schema fixado pelo backend; o navegador não envia regra avulsa executável. Processamento aceita `expectedDocumentRevision`, pacote opcional quando autorizado, motivo de reprocessamento e chave idempotente.

Erros seguem `application/problem+json`, com `type`, `title`, `status`, `code` e `correlationId`.

### 9.3 Códigos de erro estáveis

- `TAX_PACKAGE_INVALID`;
- `TAX_PACKAGE_SOURCE_INVALID`;
- `TAX_PACKAGE_NOT_REVIEWED`;
- `TAX_PACKAGE_OVERLAPPING_COVERAGE`;
- `TAX_PACKAGE_IMMUTABLE`;
- `TAX_PACKAGE_NOT_APPLICABLE`;
- `TAX_TREATMENT_INPUT_INCOMPLETE`;
- `TAX_TREATMENT_OUT_OF_COVERAGE`;
- `TAX_TREATMENT_RULE_AMBIGUOUS`;
- `TAX_TREATMENT_DOCUMENT_CONFLICT`;
- `TAX_TREATMENT_VERSION_CONFLICT`;
- `TAX_TREATMENT_FORBIDDEN`.

## 10. Persistência e transação

Persistem separadamente:

- pacote, versão, hash, cobertura e ciclo de vida;
- fontes normativas e dispositivos;
- regras tipadas e fixtures de conformidade;
- revisão e declaração humana;
- contexto normalizado congelado;
- snapshot por documento, revisão e item;
- decisão por tributo, memória, fontes e motivos;
- chaves idempotentes;
- eventos append-only.

O caso de uso controla a transação. Publicação só conclui quando pacote, fontes, regras, fixtures, revisão e auditoria forem persistidos. Processamento só conclui o snapshot quando todos os itens produzirem decisão válida ou indeterminação explicada; ambiguidade de regra aborta a revisão inteira.

Restrições de banco impedem mutação de pacote publicado, mutação de snapshot, revisão duplicada, chave idempotente divergente e acesso cruzado. DTO nunca é entidade de persistência.

## 11. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | documentos, snapshots, decisões e eventos transacionais possuem `tenant_id` e `empresa_id`, indexados e sob RLS |
| `I-2` | contexto sem tenant ou empresa não retorna nem processa dados fiscais |
| `I-3` | dinheiro usa centavos inteiros e percentuais usam precisão decimal exata; float é proibido |
| `I-4` | seleção e decisão são determinísticas; LLM não interpreta norma nem calcula tratamento |
| `I-6` | pacotes publicados, snapshots e eventos são append-only |
| `I-7` | pacote publicado e snapshot não são apagados nem alterados |
| `I-8` | pacote, regime e regra são selecionados pela data do fato gerador |
| `I-9` | importação e processamento repetidos com a mesma chave não duplicam efeito |
| `I-11` | fato gerador e vigência usam data civil; eventos usam UTC |
| `I-12` | mesma entrada, pacote e regra reproduzem a mesma decisão e memória |

## 12. Erros observáveis

| Situação | Resultado |
|---|---|
| empresa fora de Goiás ou regime diferente | `INDETERMINATE` por ausência de cobertura, sem regra substituta |
| documento que não seja NF-e 55 de entrada | recusado antes da resolução |
| ST, DIFAL, monofásico ou outra exceção | item `INDETERMINATE`, com motivo específico |
| CFOP, NCM ou CST/CSOSN ausente | item `INDETERMINATE`; dado faltante identificado |
| nenhuma regra no pacote | `INDETERMINATE`, sem alíquota padrão |
| duas regras aplicáveis | erro de integridade; snapshot não é concluído |
| fonte sem dispositivo ou vigência | pacote não publica |
| pacote posterior ao fato | não substitui pacote vigente na data do fato |
| documento muda durante o processamento | HTTP 409; nenhuma revisão parcial persiste |
| repetição idempotente | devolve o mesmo snapshot |
| usuário fora da carteira | negação sem revelar conteúdo |
| falha técnica | mantém último snapshot e informa `correlationId` |

## 13. Estratégia de testes

| Categoria | Prova mínima |
|---|---|
| Regras | Simples e Presumido, operação interna e interestadual, limites de vigência, resultado único e abstenção |
| Pacote | schema, hash, fontes, cobertura, fixtures, diff, revisão, publicação imutável e arquivamento |
| Banco | RLS, imutabilidade, revisão sequencial, idempotência, concorrência e append-only |
| Documentos | NF-e 55 válida, documento não autorizado, cancelado, revisão concorrente e item incompleto |
| Cobertura | revenda geral aceita; ST, DIFAL, monofásico, importação, benefício, devolução, transferência, uso/consumo e ativo ficam indeterminados |
| Vigência | regra futura não altera documento histórico; pacote vigente reproduz decisão anterior |
| Autorização | super-admin mantém pacote sem ler documento; papéis fiscais operam carteira; auditor só consulta |
| API | importação, comandos explícitos, paginação, comparação e Problem Details estáveis |
| Tela | pacotes, fila, detalhe, memória, fontes, revisões, temas, viewports, teclado, foco e contraste |
| E2E | importar → validar → revisar → publicar → processar NF-e → consultar memória → publicar nova versão → reprocessar → comparar |
| Segurança | arquivo de pacote malicioso, regra livre, outro tenant, XXE herdado da entrada, segredo sentinela e norma integral não vazam |
| Contrafactual | indeterminação não vira aplicável; valor destacado não vira imposto devido; elegibilidade não cria crédito ou lançamento |

As fixtures normativas guardam expectativa e referência, mas não substituem a revalidação da fonte oficial na montagem do pacote. Integração produtiva e resultado fiscal real permanecem `not_run`.

## 14. Critérios de aceite

- [ ] Pacote inicial cobre Simples Nacional e Lucro Presumido para destinatário em Goiás nas operações gerais aprovadas.
- [ ] Cada regra publicada aponta fonte oficial, dispositivo, vigência e data de consulta.
- [ ] Pacote passa por importação, validação, revisão humana e publicação imutável.
- [ ] Cobertura e exclusões são visíveis e não usam o rótulo “legislação completa”.
- [ ] Empresa, regime e pacote são selecionados pela data do fato gerador.
- [ ] NF-e da F18 é resolvida por item com fatos fiscais normalizados.
- [ ] Cada dimensão retorna tratamento, elegibilidade, regra, memória e fontes.
- [ ] Ausência de regra ou dado produz `INDETERMINATE`; nunca regra ou alíquota padrão.
- [ ] Ambiguidade impede concluir o snapshot.
- [ ] ST, DIFAL, monofásico, importação, benefício, devolução e transferência não recebem tratamento geral incorreto.
- [ ] Valor declarado não é sobrescrito nem apresentado como imposto devido pelo destinatário.
- [ ] Elegibilidade não cria apropriação, saldo, apuração, guia ou lançamento.
- [ ] Reprocessamento cria revisão nova e preserva integralmente a anterior.
- [ ] Mesma entrada, pacote e chave idempotente não duplicam snapshot.
- [ ] RLS e carteira impedem acesso cruzado; super-admin global não lê dados fiscais por esse papel.
- [ ] Auditoria registra ciclo do pacote e processamento sem duplicar XML ou norma integral.
- [ ] API usa Problem Details e códigos estáveis.
- [ ] Interface final cobre CLARO/ESCURO, 768/1024/1440 px, estados, teclado, foco e acessibilidade.
- [ ] A PR registra `frontend-design`, comparação visual e passe final de `impeccable`.
- [ ] CI publica provas de regras, banco, tela e E2E vinculadas à SPEC-026 e à issue.

## 15. Limites do Code

- Sempre: preferir abstenção a inferência, congelar contexto e pacote, preservar revisões e citar fontes.
- Perguntar antes: ampliar regime, UF, documento, finalidade, exceção, tributo, fonte ou significado de elegibilidade.
- Nunca: interpretar norma com LLM, usar regra livre, inventar alíquota, calcular imposto a recolher, apropriar crédito, ocultar lacuna ou chamar pacote inicial de cobertura nacional completa.

## 16. Fora desta fatia e destino

| Item | Destino |
|---|---|
| ST, DIFAL, monofásico, importação, benefícios, devoluções e transferências em Goiás | MVP-2, fatia própria de exceções a numerar antes da apuração que dependa delas |
| Uso, consumo e ativo imobilizado | MVP-2, fatia própria de tratamento de aquisições a numerar |
| Demais UFs e Lucro Real | MVP-2, expansão progressiva do catálogo em fatias próprias |
| Apuração por competência e apropriação efetiva | MVP-2, fatia de apuração determinística posterior |
| DAS, DARF e demais guias | MVP-2, fatias próprias de geração e aprovação |
| Partidas, razão, fechamento, SPED e ECD | MVP-2, fatias contábeis e fiscais próprias |
| Transição completa IBS/CBS até 2033 | MVP-4, conforme rastreabilidade aprovada |
| Coleta automática e monitoramento normativo | fora da F26; eventual adoção exige decisão do PI, ADR e SPEC própria |
| Dados, integrações e validação produtivos | gate de produção posterior ao MVP-4 |

Nenhum complemento acima foi descartado. Uma apuração futura não pode tratar condição indeterminada como resolvida enquanto a fatia correspondente não existir.

## 17. Decisões do PI

| Tema | Decisão |
|---|---|
| Posição | primeira fatia do MVP-2 |
| Fronteira | motor completo de seleção + pacote oficial inicial; sem apuração ou guia |
| Fonte | pacote versionado com curadoria e revisão humana; sem coleta automática |
| Regimes | Simples Nacional e Lucro Presumido |
| Jurisdição | Goiás |
| Documento | entradas de NF-e modelo 55 |
| Operação inicial | compras internas e interestaduais para revenda |
| Saída | tratamento e elegibilidade, com memória; sem imposto devido estimado |
| Exceções | operação geral primeiro; exceções mantidas em fatias posteriores obrigatórias |
| Histórico | snapshot versionado; reprocessamento cria revisão nova |

## 18. Gate de conformidade

| Verificação | Resultado |
|---|---|
| Identidade | F26/SPEC-026 · MVP-2 · PRD §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16 |
| Comportamento | pacote curado → publicação → resolução por item → snapshot → comparação |
| Aceite | critérios ligados a regras, banco, documento, tela e E2E |
| Invariantes | I-1 a I-4, I-6 a I-9, I-11 e I-12 aplicados explicitamente |
| Fora de escopo | apuração, guias, exceções, expansão territorial e produção possuem destino |
| Dúvidas | decisões do PI registradas; questões abertas: nenhuma |
| Complementos | nenhuma condição excluída foi descartada; destinos estão no §16 |
| UI | referência concreta, estados, temas, viewports, acessibilidade, `frontend-design` e `impeccable` |

## 19. Referências oficiais datadas

- Receita Federal — Orientações da Reforma Tributária do Consumo, consultada em 19/09/2026: <https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-da-reforma-tributaria>.
- Receita Federal — Orientações para 2026, atualizadas em 06/05/2026: <https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-2026>.
- Secretaria da Economia de Goiás — Legislação tributária, consultada em 19/09/2026: <https://goias.gov.br/economia/categoria/institucional/legislacao/>.
- Secretaria da Economia de Goiás — NF-e, atualizada em 23/04/2026: <https://goias.gov.br/economia/nf-e-nota-fiscal-eletronica/>.

As URLs orientam a curadoria, mas não bastam sozinhas: cada regra do pacote deve apontar o ato e o dispositivo específicos que sustentam sua decisão.

## 20. Aprovação

Fronteira, regimes, jurisdição, documento, operação, fonte, saída, exceções, histórico, interface, provas e destinos aprovados pelo PI em 19/09/2026.
