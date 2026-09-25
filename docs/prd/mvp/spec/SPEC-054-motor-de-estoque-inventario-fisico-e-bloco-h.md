# SPEC-054 — Motor de estoque, inventário físico e Bloco H

> **Fatia:** F54
> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Origem:** PRD v3.1 §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16 · RF-03
> **Issue:** #68
> **Estado:** aprovado pelo PI em 25/09/2026

## 1. Objetivo

Entregar, por estabelecimento de comércio de autopeças em Goiás, um motor contínuo e auditável de estoque que:

- parte de uma abertura física aprovada, nunca de saldo presumido;
- controla quantidades e custos por item e depósito/localização;
- registra entradas, saídas, devoluções, cancelamentos, transferências, ajustes e posse de terceiros;
- valora o estoque por custo médio móvel ou PEPS, conforme política versionada;
- executa inventário físico com corte, contagem, divergência, ajuste e revisão segregada;
- gera o Bloco H da EFD ICMS/IPI e o integra como fonte versionada da F52/SPEC-052.

O resultado é interno ao Docker local e não executa PVA, assinatura, transmissão, recibo, substituição oficial, pagamento ou efeito perante o Fisco.

## 2. Recorte aprovado

A F54 cobre, numa única exceção `Enorme` aprovada pelo PI:

- comércio de autopeças inequivocamente enquadrado;
- estabelecimentos localizados em Goiás;
- Lucro Presumido e Simples Nacional quando o enquadramento e a obrigação estiverem comprovados;
- fatos e inventários desde setembro de 2026;
- abertura aprovada em data explícita por estabelecimento;
- controle por item e depósito/localização;
- mercadoria própria em poder do estabelecimento ou de terceiros e mercadoria de terceiros em poder do estabelecimento;
- motivos oficiais de inventário `01`, `02`, `03`, `04` e `05`, conforme pacote vigente;
- custo médio móvel e PEPS;
- Bloco H completo aplicável, inclusive H020 quando exigido.

Atividade, UF, período, regime, motivo ou tratamento sem cobertura oficial inequívoca produz `INDETERMINATE`; a F54 não infere obrigação, custo, saldo ou efeito tributário.

## 3. Catálogo e localizações

Cada item de estoque referencia cadastro empresarial aprovado e possui, por vigência:

- código interno estável e descrição;
- unidade de estoque e fatores de conversão aprovados;
- vínculo fiscal aplicável, incluindo código do item usado na EFD;
- política de fracionamento e precisão decimal;
- estado ativo ou arquivado, sem exclusão física;
- depósitos/localizações ativos do estabelecimento;
- indicador de propriedade e posse necessário ao inventário fiscal.

Código, unidade ou conversão usados por movimento efetivado ou inventário aprovado são imutáveis naquela versão. Alteração posterior cria nova vigência e não reescreve histórico.

Localização pertence a exatamente um estabelecimento. Transferência entre localizações do mesmo estabelecimento preserva custo e identidade; transferência entre estabelecimentos exige saída e entrada vinculadas e documentação fiscal quando aplicável.

## 4. Abertura de estoque

O motor só inicia após abertura por estabelecimento, com:

- data-base igual ou posterior a `2026-09-01`;
- itens, localizações, quantidade, propriedade/posse e custo unitário;
- método de valoração vigente;
- origem manual ou CSV com prévia atômica;
- erros por linha sem aceitação parcial silenciosa;
- totalizadores por item, localização e estabelecimento;
- justificativa, autor, revisor e hashes das fontes.

Estados da abertura:

- `DRAFT`: editável pelo preparador;
- `INDETERMINATE`: há fonte, unidade, custo ou enquadramento ausente/conflitante;
- `READY_FOR_REVIEW`: prévia íntegra e congelada;
- `APPROVED`: revisão segregada concluiu e originou os primeiros movimentos;
- `REJECTED`: recusada com motivo;
- `SUPERSEDED`: substituída por revisão posterior antes de qualquer fechamento dependente.

Quem preparou, importou ou alterou a abertura não pode aprová-la. Não pode existir mais de uma abertura aprovada ativa para o mesmo estabelecimento e data-base.

## 5. Movimentos e projeção

### 5.1 Tipos de movimento

O razão de estoque append-only registra:

- `OPENING`: abertura aprovada;
- `PURCHASE_RECEIPT`: entrada por aquisição;
- `SALE_ISSUE`: saída por venda;
- `CUSTOMER_RETURN`: devolução de cliente;
- `SUPPLIER_RETURN`: devolução a fornecedor;
- `TRANSFER_OUT` e `TRANSFER_IN`: transferência vinculada;
- `THIRD_PARTY_OUT` e `THIRD_PARTY_IN`: mudança de posse sem perda de propriedade;
- `COUNT_GAIN` e `COUNT_LOSS`: ajuste aprovado de inventário;
- `REVERSAL`: estorno imutável de movimento anterior;
- `MANUAL_ADJUSTMENT`: exceção documentada e aprovada, sem substituir correção na origem.

Cada movimento contém tenant, empresa, estabelecimento, localização, item, quantidade decimal exata, data civil efetiva, instante de registro, origem, chave idempotente, vínculo documental, autor e hash.

### 5.2 Fontes e idempotência

NF-e modelo 55 da F18, NFC-e modelo 65 da F30 e eventos da F32 alimentam movimentos somente quando normalizados, íntegros e aplicáveis. Cancelamento e devolução geram movimento inverso vinculado; nunca alteram o movimento original.

Chave idempotente mínima: `tenantId + companyId + establishmentId + sourceType + sourceId + sourceRevision + itemId + movementKind`.

Duplicidade, documento conflitante, unidade sem conversão ou origem `STALE` bloqueia a efetivação como `INDETERMINATE`.

### 5.3 Saldo e ordem

A projeção ordena por data efetiva, sequência causal e identificador estável. O mesmo conjunto de movimentos produz os mesmos saldos, camadas de custo e hashes.

Saída maior que o saldo disponível na data efetiva é rejeitada com `STOCK_NEGATIVE_BALANCE`; não há saldo negativo, entrada compensatória ou custo inventado.

Movimento tardio ou corrigido reprocessa deterministicamente as projeções posteriores em rascunho. Versões aprovadas permanecem imutáveis e suas dependências são marcadas `STALE`.

## 6. Valoração

Cada estabelecimento escolhe, por vigência explícita e sem sobreposição, um método:

- `MOVING_WEIGHTED_AVERAGE`: cada entrada recalcula o custo médio exato; saída consome o custo vigente imediatamente anterior;
- `FIFO`: cada entrada cria camada imutável; saída consome primeiro a camada disponível mais antiga.

Dinheiro é inteiro em centavos nos totais; custo unitário, quantidade e fatores de conversão usam decimal exato com escala documentada. Float é proibido.

Troca de método exige nova vigência, inventário de corte aprovado e memória de transição. Nunca recalcula silenciosamente período aprovado. Custo ausente, negativo, incompatível ou incapaz de valorar integralmente uma saída produz `INDETERMINATE`.

Para o H010, o valor unitário fiscal e o `VL_ITEM_IR`, quando aplicável, seguem o pacote oficial e podem divergir do custo operacional somente com memória e fundamento explícitos.

## 7. Inventário físico

### 7.1 Sessão e corte

Uma sessão pertence a um estabelecimento, data de inventário, motivo oficial e escopo total ou parcial permitido pelo pacote. Ao iniciar, fotografa:

- itens e localizações abrangidos;
- saldo teórico, propriedade/posse e custo na data de corte;
- movimentos processados e pendentes;
- política de valoração e pacote normativo;
- responsáveis, fontes e hashes.

Movimento com data efetiva igual ou anterior ao corte e registrado depois da fotografia torna a sessão `STALE` antes da aprovação.

### 7.2 Contagem e divergência

A contagem aceita digitação e CSV com prévia atômica. Cada linha registra item, localização, quantidade contada, unidade, responsável e instante.

A revisão apresenta, sem compensação entre itens ou localizações:

- saldo teórico e contado;
- diferença quantitativa e monetária;
- custo usado e método;
- origem da posse/propriedade;
- justificativa e evidências;
- movimento de ajuste proposto.

Estoque físico zerado é uma contagem válida e explícita; ausência de linha não equivale a zero.

### 7.3 Aprovação segregada

- auxiliar pode preparar e contar conforme carteira;
- contador e administrador podem preparar, revisar e aprovar;
- preparador, importador ou contador da sessão não pode aprová-la;
- aprovação cria atomicamente os ajustes `COUNT_GAIN`/`COUNT_LOSS` e uma versão imutável do inventário;
- rejeição exige motivo e não efetiva ajustes;
- tentativa negada é auditada.

## 8. Motivos e pacote normativo

O inventário suporta somente motivos comprovados pelo pacote oficial vigente:

- `01`: final do período;
- `02`: mudança da forma de tributação da mercadoria;
- `03`: baixa cadastral, paralisação temporária ou situação oficialmente equivalente;
- `04`: alteração de regime de pagamento ou condição do contribuinte;
- `05`: determinação do Fisco.

O pacote versionado registra leiaute, Guia Prático nacional, orientação de Goiás, vigência, prazo de apresentação, escopo total/parcial, registros obrigatórios, tabelas, validações e regras do H020.

Pacote ausente, ambíguo, incompatível, fora da vigência ou incapaz de sustentar o motivo produz `INDETERMINATE`. Inventário parcial só é permitido quando a regra aplicável o autorizar e identificar inequivocamente os itens abrangidos.

## 9. Bloco H e integração com a F52

Uma versão aprovada do inventário pode originar uma revisão do Bloco H para a competência de apresentação determinada pelo pacote.

O gerador puro cobre:

- `H001`: abertura e indicador de movimento;
- `H005`: data, valor total e motivo do inventário;
- `H010`: item, unidade, quantidade, valor unitário, propriedade/posse, participante e valor para IR quando aplicável;
- `H020`: base e complemento de ICMS quando exigidos pela regra vigente;
- `H990`: totalização e encerramento.

O parser independente reabre os registros e valida hierarquia, tipos, escalas, cardinalidades, códigos, somas, propriedade/posse, participantes e totalizadores.

Cada revisão produz:

- `bloco-h.txt` canônico;
- `manifesto.json` com inventário, motivo, pacote, fontes, cobertura e hash;
- `diagnostico.json` com validações, reconciliação, bloqueios e diferenças.

A F52 consome somente revisão `APPROVED`, íntegra e não `STALE`. O Bloco H não é transmitido isoladamente nesta fatia; sua inclusão em EFD original ou retificadora segue o ciclo da F52.

Documento tardio que afete posição ou custo anterior preserva o inventário aprovado, marca inventário, Bloco H e EFD dependentes como `STALE` e exige nova revisão segregada e, quando aplicável, EFD retificadora interna.

## 10. Estados e transições

- `DRAFT`: preparação ou contagem em andamento;
- `INDETERMINATE`: fonte, saldo, custo, regra ou enquadramento ausente/conflitante;
- `READY_FOR_REVIEW`: fotografia e artefatos congelados;
- `APPROVED`: versão imutável aprovada por pessoa distinta;
- `REJECTED`: revisão recusada com motivo;
- `STALE`: movimento, fonte, cadastro ou pacote dependente mudou;
- `SUPERSEDED`: nova revisão aprovada substituiu a anterior internamente.

Somente `READY_FOR_REVIEW` pode ir a `APPROVED` ou `REJECTED`. `APPROVED` nunca volta a rascunho. Correção cria revisão vinculada, preserva a anterior e propaga desatualização às dependências.

## 11. Autorização, isolamento e auditoria

Todas as consultas e mutações aplicam tenant, empresa, estabelecimento, localização e carteira. RLS protege cadastros, políticas, movimentos, projeções, contagens, versões e artefatos.

Eventos append-only incluem criação e arquivamento de localização, abertura, importação, validação, movimento, bloqueio, estorno, transferência, início e corte de contagem, divergência, ajuste proposto, revisão, rejeição, aprovação, desatualização, supersessão, geração e download.

Concorrência usa versão otimista. Efetivação de movimento, transferência pareada, aprovação de abertura, aprovação de inventário e supersessão são atômicas.

## 12. Contratos de domínio

```ts
type StockValuationMethod = "MOVING_WEIGHTED_AVERAGE" | "FIFO";

type StockMovementKind =
  | "OPENING"
  | "PURCHASE_RECEIPT"
  | "SALE_ISSUE"
  | "CUSTOMER_RETURN"
  | "SUPPLIER_RETURN"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "THIRD_PARTY_OUT"
  | "THIRD_PARTY_IN"
  | "COUNT_GAIN"
  | "COUNT_LOSS"
  | "REVERSAL"
  | "MANUAL_ADJUSTMENT";

type InventoryReason = "01" | "02" | "03" | "04" | "05";
type InventoryOwnership =
  | "OWNED_IN_POSSESSION"
  | "OWNED_WITH_THIRD_PARTY"
  | "THIRD_PARTY_IN_POSSESSION";

type StockRevisionState =
  | "DRAFT"
  | "INDETERMINATE"
  | "READY_FOR_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "STALE"
  | "SUPERSEDED";

type StockQuantity = { value: string; unitCode: string };
type UnitCost = { decimalValue: string; currency: "BRL" };
```

Dados externos entram como `unknown` e só passam aos contratos após validação.

Códigos estáveis incluem:

- `STOCK_OPENING_MISSING`;
- `STOCK_LOCATION_MISMATCH`;
- `STOCK_UNIT_CONVERSION_MISSING`;
- `STOCK_DUPLICATE_MOVEMENT`;
- `STOCK_NEGATIVE_BALANCE`;
- `STOCK_COST_INDETERMINATE`;
- `STOCK_MOVEMENT_OUT_OF_ORDER`;
- `INVENTORY_COUNT_INCOMPLETE`;
- `INVENTORY_REASON_UNSUPPORTED`;
- `INVENTORY_REVIEWER_CONFLICT`;
- `INVENTORY_SOURCE_STALE`;
- `EFD_BLOCK_H_RULESET_MISSING`;
- `EFD_BLOCK_H_RECONCILIATION_FAILED`;
- `EFD_BLOCK_H_HASH_MISMATCH`.

## 13. Contrato de interface

A F54 cria `Estoque` com:

- posição por estabelecimento, localização, item, propriedade/posse e data;
- razão de movimentos com origem e custo;
- camadas PEPS ou memória de custo médio;
- abertura manual/CSV e sua revisão;
- cadastro e transferência entre localizações;
- sessões de inventário, importação de contagem e divergências;
- revisão segregada, histórico e diagnósticos;
- artefatos e estado do Bloco H.

Em `Fiscal -> EFD ICMS/IPI`, a F52 passa a exibir a revisão do Bloco H, cobertura, competência de apresentação, hash e bloqueios.

O conteúdo parte da central fiscal/contábil e padrões de tabelas operacionais existentes em `docs/telas/`; não copia transmissão, recibos ou indicadores fictícios do protótipo. Aparência e comportamento obedecem `FRONTEND.md`, `DESIGN-SYSTEM.md` e `docs/design-system/`.

Temas CLARO e ESCURO são obrigatórios, com desktop, tablet e mobile, teclado, foco visível, contraste, leitor de tela, movimento reduzido e estados de carregamento, vazio, bloqueio, erro, sucesso, revisão, rejeição, desatualização e ausência de estoque. Mensagens usam Toast Sonner; nunca `alert`.

A implementação usa obrigatoriamente `frontend-design` antes e durante a construção e `impeccable` no acabamento, com comparação visual e provas de `FRONTEND.md` §20.1.

## 14. Invariantes globais tocados

| Invariante | Aplicação na F54 |
|---|---|
| I-1 | toda entidade transacional carrega `tenant_id` e `empresa_id`, além de estabelecimento/localização quando aplicável |
| I-2 | consulta sem contexto de tenant não retorna catálogo, saldo, movimento, contagem ou artefato |
| I-3 | totais monetários usam centavos; custos e quantidades usam decimal exato, nunca float |
| I-4 | custo, saldo, motivo fiscal e Bloco H são determinados por motores versionados; LLM não calcula |
| I-5 | abertura, ajuste de inventário e Bloco H exigem aprovação humana segregada |
| I-6 | movimentos e auditoria são append-only; correção ocorre por estorno ou nova revisão |
| I-7 | item, movimento, inventário ou artefato fiscal não é apagado; arquiva-se ou sucede-se |
| I-8 | regra e motivo do inventário usam a vigência da data do fato |
| I-9 | movimentos por fonte, transferências e geração são idempotentes |
| I-11 | datas de movimento, abertura, corte e competência são datas civis; instantes seguem o fuso de exibição aprovado |
| I-12 | recálculo com as mesmas fontes, ordem e política reproduz saldo, custo e Bloco H |

## 15. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Abertura | manual/CSV, atomicidade, zero explícito, custo ausente, duplicidade e aprovação segregada |
| Movimentos | compra, venda, devoluções, cancelamento, estorno, transferência, terceiros e idempotência |
| Saldo | ordem causal, unidade/conversão, bloqueio negativo, movimento tardio e reconstrução determinística |
| Valoração | média móvel, camadas PEPS, consumo parcial, arredondamento exato, troca de método e custo indeterminado |
| Inventário | motivos 01–05, total/parcial, corte, contagem, divergência, ajuste, rejeição e supersessão |
| Bloco H | H001/H005/H010/H020/H990, cardinalidade, propriedade/posse, somas, parser e hash |
| Integração | fontes F18/F30/F32, inventário aprovado -> F52, desatualização e retificadora |
| Banco | RLS, carteira, estabelecimento, localização, concorrência, idempotência e append-only |
| Contrafactuais | sem saldo negativo, custo inventado, ajuste automático, PVA, transmissão, recibo ou Bloco K |
| Tela | CLARO/ESCURO, viewports, estados, teclado, foco, contraste, leitor de tela e movimento reduzido |
| E2E | abertura -> movimentos -> contagem -> ajuste -> aprovação -> Bloco H -> EFD F52 |

## 16. Critérios de aceite

- [ ] Abertura aprovada estabelece o primeiro saldo sem reconstrução presumida.
- [ ] Saldos são isolados por tenant, empresa, estabelecimento, localização, item e propriedade/posse.
- [ ] Todos os movimentos previstos são imutáveis, idempotentes e rastreáveis à origem.
- [ ] Saída sem saldo suficiente é bloqueada e não cria compensação automática.
- [ ] Custo médio móvel e PEPS produzem memória reproduzível com decimal exato.
- [ ] Troca de método exige vigência e inventário de corte, sem reescrever período aprovado.
- [ ] Inventários cobrem motivos 01–05 somente sob pacote oficial aplicável.
- [ ] Contagem e divergência exigem revisão segregada antes do ajuste.
- [ ] H001, H005, H010, H020 aplicável e H990 passam pelo parser independente.
- [ ] Bloco H reconcilia quantidade, valor, posse/propriedade e totalizadores com o inventário aprovado.
- [ ] A F52 consome somente revisão aprovada, íntegra e não `STALE`.
- [ ] Documento tardio preserva histórico e exige revisão/retificadora quando afetar versão aprovada.
- [ ] RLS, carteira, auditoria append-only, concorrência e segregação possuem provas positivas e negativas.
- [ ] Interface final comprova temas, responsividade, estados, acessibilidade e acabamento.
- [ ] Nenhum fluxo executa PVA, assinatura, transmissão, recibo, pagamento, Bloco K ou efeito externo.

## 17. Fora de escopo e destinos

| Item | Destino obrigatório |
|---|---|
| Produção, consumo específico e Bloco K | fatia própria de produção e Bloco K do MVP-2 |
| Lote, validade e número de série | fatia própria de rastreabilidade avançada de estoque do MVP-2 |
| Integração genérica com ERP/WMS externo | fatia própria de integrações de estoque do MVP-2 |
| Atividades diferentes de autopeças ou estabelecimentos fora de Goiás | fatias próprias de expansão por atividade e UF do MVP-2 |
| Períodos anteriores a setembro/2026 ou novos leiautes | fatia própria de expansão temporal e normativa do MVP-2 |
| Lucro Real e tratamentos federais adicionais | fatia própria de expansão de regimes do MVP-2 |
| PVA e validação no programa oficial | fatia própria de validação oficial da EFD ICMS/IPI do MVP-2 |
| Assinatura, transmissão, recibo e substituição oficial | fatia própria de entrega oficial da EFD ICMS/IPI do MVP-2 |
| Malha SPED x DF-e x extrato | fatia própria de malha preventiva após as fontes financeiras do MVP-2 |

## 18. Dúvidas resolvidas

- Capacidade: motor contínuo de estoque, inventário físico e Bloco H na mesma fatia.
- Tamanho: exceção `Enorme` expressamente aprovada e restrita à F54.
- Recorte: comércio de autopeças em Goiás, desde setembro/2026, alinhado à F52.
- Regimes: Lucro Presumido e Simples Nacional quando aplicáveis e evidenciados.
- Marco inicial: abertura aprovada por estabelecimento; sem reconstrução presumida.
- Granularidade: item por depósito/localização, incluindo propriedade e posse de terceiros.
- Valoração: custo médio móvel e PEPS por política versionada.
- Saldo negativo: efetivação bloqueada, sem ajuste automático.
- Contagem: manual/CSV, divergência justificada e revisão segregada.
- Motivos: `01` a `05`, com escopo total/parcial definido pelo pacote vigente.
- Retroatividade: nova revisão e EFD retificadora interna; histórico aprovado não é reescrito.
- Interface: módulo `Estoque` e integração visível em `Fiscal -> EFD ICMS/IPI`.
- Questões abertas: **Nenhuma**.

## 19. Gate de conformidade documental

- **Identidade:** F54/SPEC-054, MVP-2, issue #68 e origem no PRD declarados.
- **Comportamento:** abertura, movimentos, saldo, custo, contagem, ajuste e Bloco H são observáveis.
- **Aceite:** critérios verificáveis cobrem regras, banco, artefatos, tela e E2E.
- **Invariantes:** I-1 a I-9, I-11 e I-12 estão aplicados explicitamente.
- **Limites:** não há Bloco K, rastreabilidade por lote/serial, PVA, transmissão ou efeito externo.
- **Destinos:** todo complemento aponta uma capacidade futura nomeada do MVP-2.
- **UI:** caminhos, estados, temas, viewports, acessibilidade e skills obrigatórias estão explícitos.
- **Tamanho:** exceção `Enorme` aprovada somente para F54.

## 20. Referências normativas consultadas

- SPED, Guia Prático EFD ICMS/IPI versão 3.2.2, atualizado em 11/02/2026: <https://sped.rfb.gov.br/arquivo/download/8112>;
- Secretaria da Economia de Goiás, portal da EFD e guias aplicáveis: <https://goias.gov.br/economia/efd/>;
- Secretaria da Economia de Goiás, orientações de escrituração do Bloco H: <https://goias.gov.br/economia/informativo-escrituracao/>.

## 21. Aprovação

Recorte aprovado pelo PI em 25/09/2026 para criação da issue, commit e publicação documental na `main`.
