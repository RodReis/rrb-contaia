# SPEC-051 — Livros e fechamento fiscal

> **Fatia:** F51
> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Issue:** #65
> **Origem:** PRD v3.1 §§3, 5.3, 6.1, 6.2, 6.4, 6.5, 12, 14, 15 e 16; F18/SPEC-018, F30/SPEC-030, F32/SPEC-032, F36/SPEC-036 e F37/SPEC-037
> **Estado:** aprovada pelo PI em 25/09/2026
> **Tamanho:** Enorme — exceção pontual aprovada pelo PI para reunir livros de entradas, saídas e apurações com fechamento e reabertura fiscal no mesmo contrato
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4

## 1. Objetivo

Escriturar, formalizar, fechar e reabrir, por empresa e competência, os livros fiscais de entradas, saídas e apurações do recorte tributário já aprovado para o comércio de autopeças em Goiás.

Sucesso significa que o escritório consegue obter uma versão mensal imutável, reconciliada e reproduzível dos registros fiscais, fechar a competência somente quando todas as fontes estiverem íntegras e reabri-la com justificativa e histórico preservado. A fatia não gera EFD, não transmite obrigação e não cria regra tributária nova.

## 2. Fronteira e exceção de tamanho

A F51 entrega:

- Registro de Entradas e Registro de Saídas mensais;
- Apuração do ICMS para as trilhas alcançadas pela F36;
- Apuração de PIS/Pasep e Cofins para o Lucro Presumido coberto pela F37;
- rastreio dos componentes de PIS/Pasep e Cofins do DAS no Simples Nacional, sem livro federal ou obrigação autônoma;
- rascunho, revisão, formalização, fechamento, reabertura e sucessão de versões;
- reconciliação até documento, evento, declaração, apuração e pacote normativo;
- artefatos PDF, CSV e JSON canônico com hash reproduzível;
- RLS, idempotência, concorrência otimista e auditoria append-only;
- interface final nos temas CLARO e ESCURO.

O PI aprovou expressamente esta fatia como exceção `Enorme`. A exceção vale somente para F51 e não altera a regra geral de decomposição.

Não entram inventário ou estoque, EFD ICMS/IPI, EFD-Contribuições, PVA, assinatura, transmissão, recibo oficial, pagamento, produção ou expansão de cobertura.

## 3. Recorte tributário obrigatório

### 3.1 ICMS e Simples Nacional

- empresas autorizadas com estabelecimento e inscrição estadual em Goiás;
- comércio de autopeças adquiridas para revenda;
- regimes `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO`, em trilhas incompatíveis;
- competências a partir de `2026-09`, sem retroagir a cobertura da F36;
- ICMS próprio do Lucro Presumido e componentes tributários do DAS do Simples conforme revisão aprovada da F36.

### 3.2 PIS/Pasep e Cofins

- somente empresa no Lucro Presumido durante toda a competência;
- regime cumulativo, por caixa ou competência conforme opção anual comprovada na F37;
- competências de `2026-01` a `2026-12`;
- tratamentos e transição CBS/IBS somente conforme revisão aprovada e pacote vigente da F37.

No Simples Nacional, PIS/Pasep e Cofins são apenas componentes rastreáveis da memória do DAS. A F51 não cria EFD-Contribuições, DARF ou livro federal separado para essa trilha.

### 3.3 Documentos e eventos

Entram apenas:

- NF-e modelo 55 e NFC-e modelo 65 autorizadas, normalizadas e não superadas;
- cancelamentos e devoluções normalizados disponíveis no corte;
- declarações complementares vigentes, justificadas e acompanhadas de evidência;
- revisões aprovadas das F36 e F37 compatíveis com empresa, regime e competência;
- pacotes normativos e hashes fotografados pelas capacidades de origem.

CT-e, NFS-e, outros modelos, outras atividades, UFs, regimes ou períodos não são inferidos. Ausência ou conflito retorna `INDETERMINATE`.

## 4. Livros e conteúdo observável

### 4.1 Registro de Entradas

Cada linha identifica documento, emitente, datas civis, operação, CFOP coberto, item, valores contábeis, bases, alíquotas, tributos, ajustes, evento e origem. O total reconcilia com documentos e apurações usados no corte.

### 4.2 Registro de Saídas

Cada linha identifica documento, destinatário quando existente, datas civis, operação, CFOP coberto, item, receita, bases, alíquotas, tributos, ajustes, evento e origem. NFC-e sem destinatário identificado permanece válida quando a capacidade de origem a tiver aceitado.

### 4.3 Apuração do ICMS

A visão do Lucro Presumido reconcilia débitos, créditos, estornos, ajustes, saldo credor anterior e saldo da competência com a revisão aprovada da F36. A visão do Simples apresenta os componentes do DAS e suas segregações aprovadas, sem convertê-los em ICMS autônomo ou DARE.

### 4.4 Apuração de PIS/Pasep e Cofins

Somente para Lucro Presumido, a visão reconcilia receitas ou recebimentos, tratamentos, bases, alíquotas, valores, transição CBS/IBS comprovada e rascunhos locais da F37. PIS/Pasep e Cofins permanecem separados.

## 5. Unidade, identidade e estados

A unidade é `(tenant, empresa, competência, regime)`. Uma competência possui um conjunto coerente de livros aplicáveis ao regime e ao período. Não existe fechamento parcial por livro.

```ts
type FiscalBookSetStatus =
  | "DRAFT"
  | "READY_FOR_REVIEW"
  | "FORMALIZED"
  | "CLOSED"
  | "STALE"
  | "REOPENED"
  | "SUPERSEDED";

type FiscalBookKind =
  | "ENTRIES"
  | "EXITS"
  | "ICMS_ASSESSMENT"
  | "PIS_ASSESSMENT"
  | "COFINS_ASSESSMENT";
```

- `DRAFT`: versão editável apenas quanto a metadados e justificativas permitidas; linhas fiscais derivam das fontes;
- `READY_FOR_REVIEW`: todas as validações locais passaram;
- `FORMALIZED`: versão imutável aprovada por pessoa autorizada;
- `CLOSED`: competência bloqueada e snapshot final emitido;
- `STALE`: origem mudou ou deixou de ser compatível; não pode alimentar EFD;
- `REOPENED`: fechamento anterior preservado, competência novamente aberta;
- `SUPERSEDED`: versão substituída por formalização posterior.

Estado de uma versão nunca regride. Reabertura cria evento e ciclo novos; não altera o snapshot fechado.

## 6. Preparação e formalização

`auxiliar` autorizado pode preparar, reconciliar, justificar e submeter, mas não formaliza nem fecha. `contador` da carteira e `admin_escritorio` podem preparar, formalizar e fechar manualmente. A mesma pessoa pode preparar e aprovar; o sistema nunca aprova automaticamente.

Formalizar exige:

- conjunto completo de livros aplicáveis;
- fontes vigentes e hashes íntegros;
- revisões aprovadas das apurações aplicáveis;
- reconciliação sem diferença inexplicada;
- nenhuma lacuna `INDETERMINATE`;
- confirmação humana explícita.

A formalização fotografa fontes, regras, linhas, totais, justificativas, evidências e `revisionCreatedAtUtc`.

## 7. Fechamento mensal

Fechar exige versão `FORMALIZED`, não `STALE`, e ausência de competência anterior elegível ainda aberta na mesma trilha. A primeira competência coberta por cada trilha inicia sua própria sequência: `2026-09` para ICMS/DAS e `2026-01` para PIS/Cofins do Lucro Presumido.

O fechamento:

1. repete as validações de integridade dentro da transação;
2. grava número sequencial por empresa, regime e competência;
3. persiste snapshot, manifesto, hashes e versões das fontes;
4. bloqueia formalizações concorrentes e mutações incompatíveis;
5. publica artefatos derivados do mesmo JSON canônico.

Fechamento não transmite, não declara tributo e não torna rascunho de guia oficial.

## 8. Reabertura e correção

`contador` da carteira e `admin_escritorio` podem reabrir. A operação exige justificativa textual, confirmação explícita e concorrência otimista.

A reabertura:

- preserva integralmente o fechamento anterior;
- registra ator, instante UTC, motivo, correlação e versão afetada;
- marca como `STALE` os consumidores dependentes que ainda não tenham efeito externo;
- bloqueia a operação enquanto houver competência posterior fechada na mesma trilha; as posteriores precisam ser reabertas da mais recente para a mais antiga;
- exige nova formalização e novo fechamento após a correção.

## 9. Desatualização e indeterminação

Documento, evento, declaração, evidência, pacote ou apuração alterados depois do corte marcam a versão dependente como `STALE`. O sistema identifica a origem e a ação necessária; não recalcula nem fecha silenciosamente.

Retorna `INDETERMINATE` e bloqueia formalização quando houver:

- documento ou evento ausente, duplicado, superado ou incompatível;
- revisão de apuração ausente, não aprovada ou desatualizada;
- pacote ausente, conflitante ou fora da vigência;
- divergência entre documentos, declarações, livros e apurações;
- operação, tratamento, documento, período, regime ou UF sem cobertura.

Nenhuma lacuna recebe zero, média, estimativa, alíquota padrão ou regra mais recente como fallback.

## 10. Idempotência, concorrência e artefatos

A chave idempotente considera tenant, empresa, competência, regime, hashes de documentos e eventos, declarações e evidências, revisões das F36/F37, pacotes normativos e versão do contrato.

Repetir as mesmas entradas reproduz linhas, totais, JSON e hash. Dinheiro usa centavos inteiros; taxas usam decimal escalado. Competências e datas fiscais são civis; instantes de auditoria são UTC.

PDF executivo, CSV analítico e JSON canônico incluem identidade, recorte, corte documental, livros, totais, reconciliação, lacunas, fontes, versões, atores, estados e hash. O instante imutável é `revisionCreatedAtUtc`; download aparece apenas na auditoria.

## 11. Autorização, isolamento e auditoria

Conjuntos, livros, linhas, fontes, justificativas, evidências, versões, fechamentos, reaberturas, artefatos e auditoria possuem `tenant_id` e `empresa_id`, índices e RLS. Carteira ativa é validada em toda leitura, comando e download.

`auditor_readonly` consulta histórico e artefatos; demais papéis são negados por padrão. `super-admin` não lê dados fiscais por esse papel.

A auditoria append-only registra geração, reconciliação, submissão, devolução, formalização, fechamento, reabertura, superção, exportação, download, desatualização e tentativa negada. Storage é privado e URLs assinadas têm validade curta.

## 12. Contrato de interface

A F51 cria `Fiscal -> Escrituração Fiscal`, usando como referência de conteúdo e fluxo `docs/telas/contaia_central_de_escritura_o_sped_ecd_malha_fiscal_preventiva_rf_03/`, sem copiar transmissão, KPIs fictícios ou cobertura fora da fatia.

A experiência inclui:

1. seleção de empresa, competência e regime;
2. estado da cadeia mensal e bloqueios de sequência;
3. abas de entradas, saídas e apurações aplicáveis;
4. reconciliação e lacunas acionáveis;
5. detalhe causal até a fonte;
6. submissão, formalização e fechamento explícitos;
7. reabertura com justificativa e impacto nas competências posteriores;
8. histórico imutável e comparação entre versões;
9. exportação PDF/CSV/JSON;
10. distinção inequívoca entre livro interno e obrigação oficial.

Estados obrigatórios: vazio, carregando, sem documentos, origem incompleta, reconciliação divergente, regra ausente, indeterminado, rascunho, pronto para revisão, formalizado, fechado, reabrindo, reaberto, desatualizado, superado, exportando, exportado, falha recuperável e falha terminal. Estado nunca depende apenas de cor.

Aparência e comportamento obedecem `docs/FRONTEND.md`, `docs/DESIGN-SYSTEM.md` e `docs/design-system/`. A implementação usa `frontend-design` antes e durante a construção e `impeccable` no acabamento. A PR prova CLARO/ESCURO, 768/1024/1440 px, teclado, foco, contraste, leitor de tela e redução de movimento.

## 13. Invariantes

| ID | Invariante |
|---|---|
| I-1 | toda linha pertence ao tenant, empresa, competência, regime, livro e versão corretos |
| I-2 | livros derivam somente de fontes cobertas e fotografadas |
| I-3 | o conjunto de livros aplicáveis formaliza e fecha atomicamente |
| I-4 | versão formalizada ou fechada nunca é editada nem apagada |
| I-5 | reabertura preserva o fechamento anterior e exige justificativa |
| I-6 | competências fecham em sequência por trilha |
| I-7 | origem alterada produz `STALE`, nunca correção silenciosa |
| I-8 | lacuna ou conflito produz `INDETERMINATE`, nunca valor inferido |
| I-9 | PIS/Cofins do Simples permanecem componentes do DAS, sem obrigação autônoma |
| I-10 | PIS/Pasep e Cofins do Lucro Presumido permanecem separados |
| I-11 | mesmos insumos reproduzem livros, artefatos e hash |
| I-12 | nenhuma ação gera EFD, transmite, paga ou produz efeito externo |

## 14. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Regras | janelas por trilha, regimes, documentos, componentes do DAS e PIS/Cofins separados |
| Reconciliação | entradas, saídas, cancelamentos, devoluções, declarações e apurações |
| Indeterminação | fonte, regra, evidência ou cobertura ausente bloqueia formalização |
| Ciclo | rascunho, formalização, fechamento sequencial, `STALE`, reabertura e nova versão |
| Autorização | auxiliar não fecha; contador/admin fecham e reabrem; tentativas negadas auditadas |
| Banco | RLS, carteira, atomicidade, idempotência, concorrência e append-only |
| Artefatos | PDF, CSV e JSON coincidem em linhas, totais, fontes, versões e hash |
| Contrafactuais | sem inventário, EFD, PVA, assinatura, transmissão, pagamento ou fallback |
| Tela | CLARO/ESCURO, viewports, estados, teclado, foco, contraste, leitor de tela e movimento reduzido |
| E2E | fontes -> livros -> reconciliação -> formalização -> fechamento -> exportação -> alteração -> reabertura -> nova versão |

Fixtures oficiais ou sintéticas rastreáveis cobrem ambos os regimes, as janelas distintas, cancelamento, devolução, divergência, origem alterada, sequência, concorrência e reabertura. Integração oficial é `not_run`, nunca `pass`.

## 15. Critérios de aceite

- [ ] A competência seleciona exatamente os livros aplicáveis ao regime e à janela aprovada.
- [ ] Entradas e saídas reconciliam NF-e/NFC-e, eventos e declarações sem duplicação ou omissão silenciosa.
- [ ] ICMS reconcilia com F36 e PIS/Cofins do Lucro Presumido reconciliam com F37.
- [ ] Componentes federais do Simples permanecem dentro do DAS e não geram livro autônomo.
- [ ] Ausência, conflito ou cobertura parcial retorna `INDETERMINATE`.
- [ ] O conjunto formaliza e fecha atomicamente, em sequência mensal.
- [ ] Contador/admin podem preparar, formalizar e fechar manualmente; auxiliar não aprova.
- [ ] Contador/admin podem reabrir com justificativa; o fechamento anterior permanece consultável.
- [ ] Mudança de origem marca consumidores como `STALE` e exige nova versão.
- [ ] PDF, CSV e JSON canônico são reproduzíveis e compartilham o mesmo hash lógico.
- [ ] RLS, carteira, auditoria, idempotência e concorrência possuem provas positivas e negativas.
- [ ] Interface final comprova temas, responsividade, estados e acessibilidade.
- [ ] Nenhum fluxo implementa inventário, EFD, transmissão, pagamento ou produção.

## 16. Fora de escopo e destinos

| Item | Destino obrigatório |
|---|---|
| Geração interna da EFD ICMS/IPI | F52/SPEC-052, fatia própria do MVP-2 |
| Geração interna da EFD-Contribuições | F53/SPEC-053, fatia própria do MVP-2 |
| Inventário, estoque, movimentação e valoração | fatia própria de estoque e Livro Registro de Inventário do MVP-2 |
| PVA, assinatura, transmissão, recibo e retificação oficial | fatias próprias de validação e entrega oficial das respectivas EFDs no MVP-2 |
| Expansão de UF, atividade, regime, período, documento ou tratamento | fatias próprias de expansão tributária do MVP-2 |
| Pagamento, baixa, parcelamento e conciliação bancária | capacidades financeiras do RF-04 no MVP-2 |
| Malha SPED × DF-e × extrato | fatia própria de malha preventiva do MVP-2, após F52/F53 e fontes financeiras |
| Produção, credenciais e storage gerenciados | gate de Produção posterior ao MVP-4 |

## 17. Dúvidas resolvidas

- Livros: entradas, saídas, apuração do ICMS e apurações separadas de PIS/Pasep e Cofins.
- Regimes: ICMS-GO para Simples Nacional e Lucro Presumido; PIS/Cofins autônomos somente para Lucro Presumido.
- Simples: PIS/Cofins apenas como componentes do DAS.
- Períodos: herdados por trilha, sem ampliar cobertura.
- Documentos: NF-e 55 e NFC-e 65, com eventos e declarações comprovadas.
- Ciclo: inclui fechamento e reabertura fiscal completos.
- Alçada: contador e admin podem reabrir; a mesma pessoa pode preparar e aprovar manualmente.
- Tamanho: exceção `Enorme` restrita à F51.
- Destinos: F52 para EFD ICMS/IPI e F53 para EFD-Contribuições.
- Questões abertas: **Nenhuma**.

## 18. Gate de conformidade documental

- **Identidade:** F51/SPEC-051, MVP-2, issue #65 e origem no PRD declarados.
- **Comportamento:** livros, formalização, fechamento e reabertura observáveis.
- **Aceite:** critérios verificáveis por regras, banco, artefatos, tela e E2E.
- **Invariantes:** seção 13 define isolamento, imutabilidade, sequência e indeterminação.
- **Fora de escopo:** seção 16 nomeia cada complemento e seu destino.
- **Dúvidas:** decisões do PI registradas; nenhuma questão aberta.
- **UI:** referência, estados, temas, viewports e skills obrigatórias definidos.
- **Tamanho:** exceção `Enorme` expressamente aprovada e restrita à F51.

## 19. Aprovação

Capacidade, livros, tributos, regimes, UF, atividade, documentos, períodos, fontes, ciclo, alçadas, artefatos, interface, limites, tamanho e destinos aprovados pelo PI em 25/09/2026. A implementação deve seguir esta SPEC sem ampliar cobertura, inferir dado fiscal ou produzir efeito externo.
