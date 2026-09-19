# SPEC-027 / F27 — ICMS-ST retido em entradas de autopeças em Goiás

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD v3.1 §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16
>
> **Estado:** aprovada pelo PI em 19/09/2026
>
> **Tamanho:** Médio — amplia a resolução da F26 para um segmento e uma modalidade de ICMS-ST, sem antecipar cálculo do imposto devido, apuração, complemento ou ressarcimento
>
> **Ambiente:** Docker local; fontes oficiais consultadas e empacotadas com vigência explícita; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #29

## 1. Objetivo

Permitir que o escritório reconheça e valide o ICMS-ST já retido pelo fornecedor em itens de autopeças de uma NF-e modelo 55 de entrada para revenda por empresa estabelecida em Goiás, nos regimes `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO`.

Sucesso significa enquadrar o item em uma regra publicada de autopeças, preservar os valores declarados como evidência, validar a presença e a coerência interna dos dados fiscais e explicar o tratamento do ICMS sem transformar a retenção declarada em apuração, crédito apropriado ou imposto novamente devido.

A F27 não recalcula MVA, pauta, base presumida ou obrigação do remetente. Se os dados declarados forem ausentes, contraditórios ou incoerentes, o snapshot é concluído com a dimensão `ICMS` em `INDETERMINATE`; as demais dimensões continuam sendo resolvidas pelas regras aplicáveis da F26.

## 2. Fronteira da fatia

Esta fatia entrega:

- evolução do pacote normativo da F26 com o segmento tipado `AUTO_PARTS`;
- cobertura curada de CEST e NCM de autopeças sujeitos a ICMS-ST em Goiás;
- reconhecimento de ICMS-ST já retido em compra interna ou interestadual para revenda;
- validação dos grupos CST/CSOSN e dos valores de ST declarados por item e no total da NF-e;
- decisão de ICMS com memória, fontes, verificações executadas e inconsistências;
- preservação da resolução das demais dimensões tributárias quando somente o ICMS estiver indeterminado;
- snapshot imutável e comparação entre reprocessamentos, usando os contratos da F26;
- interface final na área `Fiscal → Resolução tributária`, nos temas CLARO e ESCURO;
- auditoria append-only da publicação do pacote, resolução, indeterminação e reprocessamento.

Não entrega:

- cálculo de ICMS-ST devido pelo remetente ou pelo destinatário;
- MVA, MVA ajustada, pauta, PMPF ou base presumida calculada pelo sistema;
- antecipação tributária, solidariedade pela falta de retenção ou recolhimento por operação;
- complemento ou restituição de ICMS-ST;
- ressarcimento, crédito por saída interestadual, devolução, quebra, perda ou perecimento;
- outros segmentos de mercadorias, outras UFs ou outros regimes;
- apuração, escrituração, guia, DARE, GNRE, lançamento contábil ou transmissão;
- interpretação de legislação por LLM ou atualização automática do pacote.

## 3. Cobertura aprovada

### 3.1 Empresa e documento

A resolução exige:

- empresa ativa, autorizada no tenant e na carteira aplicável;
- estabelecimento destinatário em `GO`;
- regime `SIMPLES_NACIONAL` ou `LUCRO_PRESUMIDO` vigente na data do fato gerador;
- NF-e modelo 55 autorizada, persistida pela F18 e com direção de entrada;
- finalidade de compra para revenda;
- emitente e destinatário distintos e consistentes com o documento;
- item com CFOP, NCM, CEST, CST ou CSOSN e grupo de ICMS identificáveis;
- pacote publicado e vigente na data do fato gerador.

Mudança posterior de regime, cadastro, pacote ou enquadramento não reescreve snapshot anterior.

### 3.2 Mercadoria

O pacote inicial cobre exclusivamente autopeças enquadradas simultaneamente por:

- segmento CEST correspondente a autopeças;
- combinação CEST/NCM explicitamente publicada no pacote;
- vigência da combinação na data do fato gerador;
- operação interna ou interestadual destinada a contribuinte goiano;
- compra para revenda com retenção declarada pelo fornecedor.

CEST sozinho não prova enquadramento. NCM sozinho não prova enquadramento. Descrição livre do produto não seleciona regra e não corrige combinação divergente.

Item fora da lista publicada recebe `INDETERMINATE` para ICMS com o motivo `TAX_ST_PRODUCT_OUT_OF_COVERAGE`. O motor não procura produto parecido e não cai para regra genérica.

### 3.3 Modalidade de ST

A F27 cobre somente substituição tributária pela operação posterior quando a retenção já estiver declarada no documento de entrada.

Não estão cobertas:

- operação anterior;
- concomitante;
- mercadoria sem retenção em que o destinatário possa ser responsável solidário;
- remetente sujeito a regime especial não modelado;
- retenção suspensa por decisão judicial;
- importação;
- benefício, incentivo, redução ou crédito presumido;
- devolução, retorno, remessa, transferência, uso, consumo ou ativo imobilizado.

Essas condições produzem `INDETERMINATE` para ICMS e apontam a capacidade posterior necessária.

## 4. Pacote normativo

### 4.1 Fontes obrigatórias

Cada regra publicada aponta, no mínimo:

- Regulamento do Código Tributário do Estado de Goiás, especialmente o Anexo VIII do Decreto nº 4.852/1997, no texto vigente consultado;
- Convênio ICMS nº 142/2018 e alterações vigentes;
- convênio ou protocolo aplicável à combinação de origem, destino e segmento, quando exigido;
- ato goiano que inclua, exclua ou altere a mercadoria, CEST, NCM ou vigência;
- órgão, título, URL oficial, dispositivo, publicação, data de consulta e intervalo de vigência.

A data de corte inicial da curadoria é **19/09/2026**. A implementação revalida todas as fontes oficiais ao construir o pacote. Fonte inacessível, revogada, sem dispositivo identificável ou sem vigência conhecida impede a publicação da regra afetada.

### 4.2 Conteúdo adicional

Além do contrato da F26, a versão do pacote contém:

- `taxSegment: "AUTO_PARTS"`;
- combinações explícitas de CEST e NCM;
- grupos CST/CSOSN aceitos para retenção declarada;
- origens admitidas e destino `GO`;
- finalidade `RESALE`;
- modalidade `ICMS_ST_WITHHELD_BY_SUPPLIER`;
- requisitos documentais por grupo de ICMS;
- verificações de coerência aplicáveis;
- fixtures positivas, negativas e de limite de vigência;
- exclusões e capacidades posteriores correspondentes.

A correção de lista, vigência ou requisito documental cria nova versão. Pacote publicado permanece imutável e segue validação, revisão humana, publicação, arquivamento, hash e auditoria definidos na F26.

## 5. Entradas normalizadas

Para a dimensão ICMS, o contexto acrescenta:

```ts
type TaxProductSegment = "AUTO_PARTS";

type IcmsStDeclaredEvidence = {
  cest: string | null;
  ncm: string;
  taxGroup: string;
  taxableBaseCents: number | null;
  rateBasisPoints: number | null;
  retainedAmountCents: number | null;
};
```

Os nomes refletem o fato normalizado; o adaptador da NF-e mantém rastreabilidade até os campos originais, incluindo `CEST`, `NCM`, grupo CST/CSOSN, `vBCST`, `pICMSST` e `vICMSST` quando existentes.

Dinheiro usa centavos inteiros. A alíquota declarada usa representação decimal exata normalizada em pontos-base ou unidade racional equivalente. Float é proibido.

O navegador não envia CEST, NCM ou valor substituto para corrigir silenciosamente um dado presente na NF-e. Correção do documento pertence ao fluxo documental correspondente e um novo processamento cria revisão nova.

## 6. Validação declarativa

### 6.1 Verificações

O motor valida, sem recalcular a obrigação tributária:

1. presença dos campos exigidos pelo grupo CST/CSOSN;
2. formato e domínio de NCM, CEST e grupo tributário;
3. combinação CEST/NCM publicada e vigente;
4. compatibilidade do grupo CST/CSOSN com retenção já realizada;
5. valores monetários não negativos e dentro da escala aceita;
6. alíquota declarada não negativa e dentro do domínio representável;
7. soma dos valores `vICMSST` dos itens igual ao total declarado de ICMS-ST do documento, com comparação exata em centavos;
8. ausência de indicadores mutuamente incompatíveis com o recorte da fatia.

A F27 não afirma que `vICMSST` é juridicamente correto a partir de `vBCST` e `pICMSST`, porque essa conclusão exigiria reconstituir MVA, pauta, ICMS próprio, benefício e responsabilidade do substituto. A interface chama o resultado de **coerência dos dados declarados**, nunca de conferência integral do imposto.

### 6.2 Resultado

```ts
type TaxEvidenceCheckStatus = "VALID" | "INVALID" | "NOT_CHECKED";

type TaxEvidenceCheck = {
  code: string;
  status: TaxEvidenceCheckStatus;
  fields: readonly string[];
  reasons: readonly string[];
};
```

Para ICMS:

- regra única e todas as verificações obrigatórias válidas: `APPLICABLE`;
- mercadoria ou operação comprovadamente não sujeita ao tratamento da regra publicada: `NOT_APPLICABLE`;
- campo ausente, combinação não coberta, divergência ou condição excluída: `INDETERMINATE`;
- duas ou mais regras aplicáveis: `TAX_TREATMENT_RULE_AMBIGUOUS`, abortando a revisão inteira conforme a F26.

Uma inconsistência declarativa não é erro técnico. O snapshot é concluído, lista campos e motivos e preserva decisões válidas de PIS, COFINS, IBS_UF, IBS_MUN e CBS.

## 7. Tratamento e elegibilidade

A decisão de ICMS apresenta:

- estado do tratamento;
- modalidade `ICMS_ST_WITHHELD_BY_SUPPLIER` quando aplicável;
- elegibilidade de crédito segundo a regra publicada;
- CEST, NCM e grupo tributário usados;
- base, alíquota e valor retido exatamente como declarados;
- verificações realizadas;
- regra, pacote, vigência, justificativa e fontes;
- campos ausentes, inconsistências e condições fora da cobertura.

`ALLOWED`, `BLOCKED`, `INDETERMINATE` ou `NOT_RELEVANT` continuam significando elegibilidade na resolução, não apropriação. A F27 não gera saldo, crédito escritural, lançamento ou direito automático.

## 8. Snapshot, reprocessamento e concorrência

A F27 reutiliza o `TaxTreatmentSnapshot` da F26 e acrescenta à memória da decisão ICMS:

- segmento e combinação CEST/NCM;
- evidência declarada normalizada;
- verificações e respectivos resultados;
- hash do documento e do pacote;
- motivos de indeterminação.

Reprocessamento sempre cria revisão nova e exige motivo quando mudar pacote, documento, cadastro ou normalização. Mesma chave idempotente com a mesma entrada devolve o mesmo snapshot; conteúdo divergente com a mesma chave produz conflito.

Alteração do documento durante o processamento produz HTTP 409 e nenhuma revisão parcial persiste. Comparação entre revisões destaca mudança de evidência, regra, verificação e decisão.

## 9. Autorização e auditoria

Aplicam-se os papéis da F26:

- `super-admin` mantém o pacote global sem acessar dados fiscais de tenant por esse papel;
- `admin_escritorio` e `contador` processam, reprocessam e consultam empresas autorizadas;
- `auxiliar` processa e consulta quando possui permissão fiscal;
- `auditor_readonly` consulta snapshot, memória, fonte e histórico;
- demais papéis são negados por padrão.

Documentos e snapshots permanecem sob RLS de tenant e empresa. Eventos append-only registram publicação do pacote, resolução aplicável, indeterminação, falha e reprocessamento sem duplicar XML integral ou texto completo da norma.

## 10. Contrato de interface

A F27 compõe as duas visões da F26, sem criar módulo paralelo:

1. **Pacotes normativos:** cobertura de autopeças, combinações CEST/NCM, fontes, vigência, fixtures, diff e publicação.
2. **Documentos resolvidos:** identificação de ICMS-ST retido, evidência declarada, coerência, tratamento, memória, fontes e revisões.

No detalhe do item, a seção de ICMS informa textualmente:

- “ICMS-ST retido pelo fornecedor” quando aplicável;
- base, alíquota e valor **declarados na NF-e**;
- “Dados declarados coerentes” ou “Tratamento indeterminado”, sem depender somente de cor;
- cada verificação, campo e motivo;
- cobertura do pacote e data de corte;
- aviso de que a resolução não recalcula o imposto nem constitui crédito ou apuração.

Estados obrigatórios:

- carregando com skeleton;
- item coberto e coerente;
- CEST ausente;
- combinação CEST/NCM não coberta;
- grupo CST/CSOSN incompatível;
- valor obrigatório ausente;
- total dos itens divergente do documento;
- condição excluída;
- ambiguidade de regra;
- documento alterado durante o processamento;
- acesso negado;
- falha técnica com preservação do último snapshot.

A referência visual permanece `docs/telas/contaia_apura_o_fiscal_tribut_ria_reforma_ibs_cbs_rf_03/`, corrigida pelos contratos de `docs/FRONTEND.md`, `docs/DESIGN-SYSTEM.md` e `docs/design-system/`.

Provas obrigatórias: temas CLARO e ESCURO; viewports 768, 1024 e 1440 px; teclado, foco visível e retorno de foco; tabelas responsivas; nomes acessíveis; redução de movimento; `frontend-design` antes e durante a implementação; `impeccable` no passe final.

## 11. API e erros observáveis

Não são criados endpoints novos. Os endpoints de pacote e resolução da F26 passam a aceitar e devolver os tipos versionados desta fatia.

Códigos adicionais:

- `TAX_ST_CEST_MISSING`;
- `TAX_ST_PRODUCT_OUT_OF_COVERAGE`;
- `TAX_ST_TAX_GROUP_UNSUPPORTED`;
- `TAX_ST_DECLARED_FIELD_MISSING`;
- `TAX_ST_DECLARED_VALUE_INVALID`;
- `TAX_ST_DOCUMENT_TOTAL_MISMATCH`;
- `TAX_ST_OPERATION_OUT_OF_COVERAGE`.

Indeterminações aparecem dentro da decisão tributária. Falhas de contrato, autorização, concorrência, ambiguidade ou infraestrutura usam `application/problem+json`, com `type`, `title`, `status`, `code` e `correlationId`.

## 12. Persistência e transação

Persistem separadamente:

- segmento e combinações CEST/NCM versionadas no pacote;
- requisitos documentais e verificações tipadas;
- evidência declarada normalizada no contexto congelado;
- resultados das verificações por item;
- decisão ICMS, memória e fontes;
- snapshot, idempotência e eventos append-only.

O caso de uso controla a transação. Indeterminação explicada é resultado válido; ambiguidade de regras aborta a revisão inteira. Restrições impedem mutação de pacote publicado, snapshot ou evento e impedem duplicidade de revisão e idempotência divergente.

## 13. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | documento, snapshot, decisão e evento transacional possuem `tenant_id` e `empresa_id`, indexados e sob RLS |
| `I-2` | contexto sem tenant ou empresa não consulta nem resolve dados fiscais |
| `I-3` | valores declarados usam centavos e percentuais usam precisão decimal exata; float é proibido |
| `I-4` | enquadramento e validação são determinísticos; LLM não interpreta norma nem decide tratamento |
| `I-6` | pacotes publicados, snapshots e eventos são append-only |
| `I-7` | pacote publicado e snapshot não são apagados nem alterados |
| `I-8` | pacote, combinação e regra são selecionados pela data do fato gerador |
| `I-9` | processamento repetido com a mesma chave não duplica snapshot |
| `I-11` | fato gerador e vigência usam data civil; eventos usam UTC |
| `I-12` | mesma entrada, pacote e regra reproduzem decisão, verificações e memória |

## 14. Estratégia de testes

| Categoria | Prova mínima |
|---|---|
| Regras | Simples e Presumido; operação interna e interestadual; CEST/NCM coberto; limites de vigência |
| Pacote | schema, hash, fonte, lista versionada, conflito, fixture, revisão, publicação imutável e arquivamento |
| Documento | grupos suportados, campo ausente, valor negativo, escala inválida e total divergente |
| Resultado parcial | ICMS indeterminado com as demais dimensões preservadas |
| Contrafactuais | outro segmento, outra UF, outra finalidade, ST não retido, devolução, benefício, importação e monofásico |
| Banco | RLS, imutabilidade, revisão sequencial, idempotência, concorrência e append-only |
| Autorização | pacote global sem leitura fiscal; carteira respeitada; auditor somente leitura |
| API | tipos versionados, paginação e Problem Details com códigos estáveis |
| Tela | claro/escuro, 768/1024/1440, estados, teclado, foco, leitor de tela e redução de movimento |
| E2E | publicar pacote → processar NF-e → consultar memória → reprocessar → comparar revisões |

Contrafactuais obrigatórios:

- descrição contém “autopeça”, mas CEST/NCM não está publicado;
- CEST publicado com NCM incompatível;
- `vICMSST` dos itens não fecha com o total do documento;
- ICMS indeterminado não apaga decisão válida de outro tributo;
- pacote futuro não altera documento histórico;
- outro tenant, empresa fora da carteira e `super-admin` global não leem o snapshot;
- reenvio idempotente não cria revisão adicional;
- falha técnica preserva o último snapshot.

## 15. Critérios de aceite

- [ ] Pacote publicado cobre autopeças por combinação explícita CEST/NCM, vigência e fonte oficial.
- [ ] Cobertura contempla Simples Nacional e Lucro Presumido, operações internas e interestaduais para destinatário em Goiás.
- [ ] Somente compra para revenda com ICMS-ST já retido entra na regra desta fatia.
- [ ] Sistema valida campos, domínios, escala, grupo tributário e fechamento do total declarado sem recalcular a obrigação.
- [ ] CEST ou NCM isolado não seleciona regra.
- [ ] Descrição livre não seleciona nem corrige enquadramento.
- [ ] Divergência produz ICMS `INDETERMINATE`, com campos e motivos, sem abortar as demais dimensões.
- [ ] Ambiguidade de regra impede concluir a revisão.
- [ ] Valores são apresentados como declarados na NF-e, nunca como imposto recalculado ou crédito apropriado.
- [ ] Snapshot congela evidência, verificações, pacote, regra, memória e fontes.
- [ ] Reprocessamento cria revisão nova; idempotência não duplica efeito.
- [ ] RLS e carteira impedem acesso cruzado; `super-admin` global não lê documento fiscal por esse papel.
- [ ] Auditoria registra o ciclo sem duplicar XML ou norma integral.
- [ ] Interface final cobre CLARO/ESCURO, 768/1024/1440 px, estados, teclado, foco e acessibilidade.
- [ ] PR registra `frontend-design`, comparação visual e passe final de `impeccable`.
- [ ] CI publica provas de regras, banco, tela e E2E vinculadas à SPEC-027 e à issue.

## 16. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| ICMS-ST devido pelo destinatário, antecipação e solidariedade por ausência de retenção | capacidade própria de expansão tributária do MVP-2 |
| MVA, pauta, PMPF e recálculo da retenção | capacidade própria de cálculo de ICMS-ST do MVP-2 |
| Complemento e restituição pela diferença entre base presumida e realizada | capacidade própria de complemento/restituição de ICMS-ST do MVP-2 |
| Ressarcimento, devolução, saída interestadual, perda e perecimento | capacidade própria de ressarcimento e eventos posteriores do MVP-2 |
| Outros segmentos sujeitos a ST | fatias próprias de expansão por segmento do MVP-2 |
| Outras UFs e regimes | fatias próprias de expansão territorial e por regime do MVP-2 |
| Apuração, guia, escrituração e lançamento | capacidades de apuração e escrituração do MVP-2 |
| Transição integral IBS/CBS até 2033 | MVP-4, conforme PRD e RASTREABILIDADE |
| Produção e validação com tráfego produtivo | gate de produção posterior ao MVP-4 |

Nenhum complemento foi descartado. A apuração futura não pode converter ICMS indeterminado em valor resolvido enquanto a capacidade correspondente não existir.

## 17. Decisões do PI

| Decisão | Resultado aprovado em 19/09/2026 |
|---|---|
| Tema da F27 | ICMS-ST em Goiás |
| Modalidade inicial | entrada com ST já retido pelo fornecedor |
| Regimes | Simples Nacional e Lucro Presumido |
| Segmento inicial | autopeças |
| Limite da validação | presença e coerência declarativa, sem recalcular retenção |
| Divergência | ICMS `INDETERMINATE`; demais dimensões continuam |

Questões abertas: **Nenhuma.**

## 18. Gate de conformidade documental

| Verificação | Evidência |
|---|---|
| Identidade | F27/SPEC-027 · MVP-2 · PRD §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16 |
| Comportamento | §§1–10, observável no pacote, processamento e detalhe do item |
| Aceite | §15, com provas de regras, banco, tela e E2E |
| Invariantes | §13 |
| Fora de escopo | §16 |
| Dúvidas | §17, nenhuma aberta |
| Complementos | §16, todos preservados no MVP-2 ou destino já aprovado |
| UI | §10, referência concreta, estados, temas, viewports e skills obrigatórias |
