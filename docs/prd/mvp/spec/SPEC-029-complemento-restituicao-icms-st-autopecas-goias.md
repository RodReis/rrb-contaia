# SPEC-029 / F29 — Complemento e restituição do ICMS-ST de autopeças em Goiás

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD v3.1 §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16
>
> **Estado:** aprovada pelo PI em 19/09/2026
>
> **Tamanho:** Grande e delimitada — compara o ICMS-ST presumido na entrada com o ICMS efetivo da venda interna e consolida complemento ou restituição por competência; NFC-e, devolução, saída interestadual, escrituração e efeitos financeiros permanecem em fatias próprias
>
> **Ambiente:** Docker local; fontes oficiais históricas consultadas e empacotadas com vigência explícita; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #33

## 1. Objetivo

Permitir que o escritório calcule, revise e aprove o complemento ou a restituição do ICMS-ST de autopeças vendidas internamente a consumidor final por empresa estabelecida em Goiás, nos regimes `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO`, quando a entrada e a saída estiverem documentalmente comprovadas e o fato gerador estiver entre **27/10/2016 e 28/02/2018**.

A fatia compara, por item, o ICMS-ST presumido recuperado da entrada com o ICMS efetivo da saída. O resultado é consolidado por competência, preservando separadamente os valores brutos de restituição e complemento e o saldo líquido. O cálculo é informativo até aprovação humana e gera somente um demonstrativo oficial em rascunho.

Não há transmissão, escrituração, apropriação de crédito, guia, lançamento contábil, título ou pagamento. Uma linha material indeterminada bloqueia a aprovação e a exportação da competência inteira; o sistema nunca apresenta saldo parcial como fechamento válido.

## 2. Fronteira da fatia

Esta fatia entrega:

- pacote normativo histórico, imutável e versionado, com regras aplicáveis ao período aprovado;
- seleção de vendas internas de autopeças a consumidor final documentadas por NF-e modelo 55;
- recuperação do ICMS da entrada por documento/EFD ou média ponderada mensal auditável;
- cálculo decimal exato da base e do ICMS efetivos da saída;
- classificação por item em `RESTITUTION`, `COMPLEMENT`, `NONE` ou `INDETERMINATE`;
- consolidação mensal dos valores brutos e do saldo líquido;
- bloqueio integral da competência quando existir linha material indeterminada;
- submissão à fila HITL, aprovação por `contador` ou `admin_escritorio` e rejeição motivada;
- geração de demonstrativo em rascunho no leiaute oficial correspondente ao regime;
- interface final na área `Fiscal → Resolução tributária`, nos temas CLARO e ESCURO;
- auditoria append-only de cálculo, bloqueio, submissão, aprovação, rejeição, exportação e reprocessamento.

Não entrega:

- NFC-e modelo 65 ou documento que não esteja persistido e normalizado pelo contrato vigente;
- devolução, cancelamento posterior, estorno proporcional, perda, perecimento ou saída interestadual;
- pauta, PMPF, preço sugerido pelo fabricante ou outro método sem fonte específica para o item;
- operações anteriores a 27/10/2016 ou posteriores a 28/02/2018;
- outros segmentos, UFs de destino, documentos ou regimes;
- preenchimento manual de regra, origem, base, alíquota ou valor calculado;
- transmissão do demonstrativo, EFD, ajuste de apuração, crédito apropriado, guia, lançamento contábil, contas a receber ou pagamento;
- interpretação de legislação por LLM ou atualização automática do pacote.

## 3. Cobertura aprovada

### 3.1 Empresa, documentos e período

O processamento exige:

- empresa ativa, autorizada no tenant e na carteira aplicável;
- estabelecimento vendedor em `GO`;
- regime `SIMPLES_NACIONAL` ou `LUCRO_PRESUMIDO` vigente na competência;
- NF-e modelo 55 de saída autorizada, persistida, não cancelada e destinada a consumidor final em Goiás;
- item de autopeça com produto, NCM, CEST, CFOP, CST ou CSOSN, quantidade, unidade, valor e tributação identificáveis;
- entrada compatível persistida ou escrituração EFD comprovada, com ICMS normal e ICMS-ST recuperáveis;
- pacote publicado e vigente nas datas da entrada e da saída;
- fato gerador da saída entre 27/10/2016 e 28/02/2018, inclusive.

Documento fora da janela recebe `NOT_APPLICABLE`. A data inicial não autoriza projetar regra anterior à própria vigência; cada regra continua selecionável somente no seu intervalo oficial.

Mudança posterior de regime, documento, cadastro, pacote ou normalização não reescreve revisão aprovada. Reprocessamento cria nova revisão comparável.

### 3.2 Mercadoria e operação

O pacote cobre exclusivamente autopeças enquadradas simultaneamente por:

- segmento CEST correspondente a autopeças;
- combinação CEST/NCM e descrição legal vigente;
- venda interna em Goiás a consumidor final;
- item adquirido com ICMS-ST presumido comprovável;
- unidade comercial normalizada e quantidade compatível com o estoque de origem;
- regra de base efetiva e alíquota publicada para a data da saída.

CEST sozinho, NCM sozinho e descrição livre não selecionam regra. Mercadoria sem combinação comprovada recebe `INDETERMINATE`. O motor não procura produto semelhante e não usa regra genérica.

### 3.3 Documento de saída

A F29 aceita somente NF-e modelo 55. A inclusão da NFC-e modelo 65 depende de fatia própria de ingestão, validação, persistência e normalização, porque o contrato atual das F16, F18 e F26 não a suporta.

Venda cancelada antes do processamento não participa da competência. Cancelamento, devolução ou estorno ocorrido depois da saída pertence à fatia de eventos posteriores; sua presença bloqueia a linha nesta fatia para evitar saldo incorreto.

### 3.4 Materialidade e fechamento

Toda linha selecionada para a competência é material. Não existe tolerância monetária, amostragem ou exclusão manual. Se qualquer linha estiver `INDETERMINATE`, a competência fica `BLOCKED`, sem aprovação e sem exportação.

Linhas `NONE` permanecem no demonstrativo e na memória para provar que a comparação foi executada. Corrigir documento, cadastro, unidade ou pacote exige reprocessamento da competência inteira.

## 4. Pacote normativo histórico

### 4.1 Fontes obrigatórias

Cada regra publicada aponta, no mínimo:

- Regulamento do Código Tributário do Estado de Goiás, Decreto nº 4.852/1997, especialmente o Anexo VIII, no texto vigente no fato gerador;
- Decreto nº 10.202/2023 e Instrução Normativa nº 1.558/2023-GSE, inclusive os leiautes oficiais do demonstrativo para regime normal e Simples Nacional, somente quanto ao reconhecimento e à forma de demonstrar operações abrangidas pelo período;
- ato oficial que fundamente o marco de 27/10/2016 e a metodologia aplicável;
- Protocolo ICMS nº 41/2008, Protocolo ICMS nº 97/2010 e alterações aplicáveis às autopeças;
- Decretos nº 9.108/2017 e nº 9.147/2018 e o ato oficial que comprove a exclusão das autopeças da ST a partir de 01/03/2018;
- regra oficial de base, alíquota, benefício e arredondamento vigente na entrada e na saída;
- órgão, título, URL oficial, dispositivo, publicação, data de consulta e intervalo de vigência.

Fontes oficiais iniciais verificadas para a curadoria:

- [Demonstrativo de Apuração da Restituição ou Complementação do ICMS-ST — Regime Normal](https://goias.gov.br/economia/wp-content/uploads/sites/45/2012/08/Demonstrativo_de_Apuracao_da_Restituicao_ou_Complementacao_do_ICMS_ST_Regime_Normal-124.pdf);
- [Demonstrativo de Apuração Mensal da Restituição ou Complementação do ICMS-ST — Simples Nacional](https://goias.gov.br/economia/wp-content/uploads/sites/45/2012/08/Demonstrativo_de_Apuracao_Mensal_da_Restituicao_ou_Complementacao_do_ICMS_ST_Simples_Nacional_20230801-199.pdf);
- [Manual oficial de exclusão de mercadorias da substituição tributária](https://goias.gov.br/economia/wp-content/uploads/sites/45/2018/03/manual-de-exclusAo-de-mercadorias-da-st-versao-2-3a7.pdf).

A data de corte da curadoria é **19/09/2026**. A implementação revalida as fontes oficiais ao construir o pacote. Fonte inacessível, sem dispositivo identificável, sem histórico recuperável ou sem vigência conhecida impede a publicação da regra afetada.

### 4.2 Conteúdo adicional

Além do contrato das F26 a F28, cada regra contém:

- `taxSegment: "AUTO_PARTS"`;
- combinação explícita de CEST, NCM e descrição legal;
- regimes, CFOPs, grupos CST/CSOSN, destino `GO` e consumidor final;
- método admitido para recuperar o ICMS da entrada;
- regra de unidade, conversão e precisão de quantidade;
- componentes da base efetiva, alíquota e benefício aplicáveis à saída;
- ordem das operações, escala intermediária e arredondamento final;
- layout de demonstrativo aplicável ao regime;
- requisitos documentais, verificações e motivos de indeterminação;
- fixtures positivas, negativas, de fronteira temporal, unidade e estoque.

Correção de parâmetro, fórmula, fonte ou vigência cria nova versão. Pacote publicado permanece imutável e segue revisão humana, publicação, arquivamento, hash e auditoria definidos na F26.

## 5. Entradas e contratos normalizados

```ts
type IcmsStRecoveryOrigin =
  | "DIRECT_DOCUMENT"
  | "EFD_RECORDED"
  | "MONTHLY_WEIGHTED_AVERAGE";

type IcmsStDifferenceKind =
  | "RESTITUTION"
  | "COMPLEMENT"
  | "NONE"
  | "INDETERMINATE";

type IcmsStSettlementLine = {
  outputDocumentId: string;
  outputItemId: string;
  productId: string;
  normalizedUnit: string;
  quantityScaled: bigint;
  recoveryOrigin: IcmsStRecoveryOrigin;
  presumedBaseCents: number;
  effectiveBaseCents: number;
  inputIcmsCents: number;
  inputIcmsStCents: number;
  effectiveIcmsCents: number;
  differenceKind: IcmsStDifferenceKind;
  restitutionCents: number;
  complementCents: number;
  ruleId: string;
  formulaVersion: string;
  sourceIds: readonly string[];
  blockingReasonCodes: readonly string[];
};

type IcmsStMonthlySettlementStatus =
  | "PROCESSING"
  | "BLOCKED"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED";

type IcmsStMonthlySettlement = {
  tenantId: string;
  companyId: string;
  competence: string;
  regime: "SIMPLES_NACIONAL" | "LUCRO_PRESUMIDO";
  revision: number;
  status: IcmsStMonthlySettlementStatus;
  grossRestitutionCents: number;
  grossComplementCents: number;
  netAmountCents: number;
  packageId: string;
  documentSetHash: string;
  lines: readonly IcmsStSettlementLine[];
};
```

Dinheiro usa centavos inteiros. Quantidade usa inteiro escalado com escala e unidade explícitas. Alíquotas, fatores e médias usam decimal exato ou representação racional equivalente. Float é proibido. Competência é `YYYY-MM`; eventos usam UTC e datas fiscais são civis.

## 6. Recuperação do ICMS da entrada

### 6.1 Ordem determinística

Para cada item de saída, o motor:

1. procura vínculo direto válido com item de entrada e sua escrituração;
2. se houver vínculo único e coerente, usa `DIRECT_DOCUMENT` ou `EFD_RECORDED`;
3. sem vínculo unitário, calcula média ponderada mensal por empresa, produto, unidade normalizada e competência das entradas elegíveis;
4. congela documentos, quantidades, valores, regra e origem utilizados;
5. impede consumo de quantidade acima do estoque comprovado;
6. produz memória reproduzível da atribuição.

Vínculo direto válido prevalece sobre média ponderada. Dois vínculos incompatíveis, divergência entre documento e EFD, estoque insuficiente, produto não identificado ou unidade não conversível produzem `INDETERMINATE`.

### 6.2 Média ponderada mensal

A média ponderada considera somente entradas elegíveis do mesmo produto normalizado, empresa, unidade e competência, descontadas as quantidades já atribuídas diretamente. A memória registra numerador, denominador, documentos participantes, conversões e arredondamento.

Quantidade zero ou negativa, denominador zero, mistura de unidades sem fator oficial ou cadastro versionado e saldo físico incompatível bloqueiam a linha. O sistema não cria estoque presumido nem transporta média de outra empresa.

## 7. Cálculo e consolidação

### 7.1 Cálculo por item

Para cada linha elegível:

1. determina a base e o ICMS da entrada conforme a origem comprovada;
2. determina a base efetiva da saída e aplica a alíquota e o benefício vigentes;
3. calcula o ICMS efetivo com decimal exato;
4. compara `effectiveIcmsCents` com a soma recuperável do ICMS normal e ICMS-ST da entrada atribuída;
5. classifica a diferença sem compensação implícita entre linhas;
6. registra fórmula, passos, fontes e hashes.

Se o ICMS efetivo for menor, a diferença absoluta é `restitutionCents`. Se for maior, a diferença é `complementCents`. Igualdade produz `NONE`. Ausência de qualquer componente material produz `INDETERMINATE` e valores nulos, nunca zero inferido.

### 7.2 Consolidação mensal

Com todas as linhas determinadas:

- `grossRestitutionCents` soma somente restituições;
- `grossComplementCents` soma somente complementos;
- `netAmountCents` é complemento bruto menos restituição bruta;
- linhas `NONE` permanecem listadas;
- o demonstrativo preserva os totais brutos mesmo quando o saldo líquido for zero.

Uma única linha `INDETERMINATE` muda a competência para `BLOCKED`. Não existe aprovação parcial, exclusão manual de linha nem limiar de materialidade.

### 7.3 Arredondamento e reprodutibilidade

O pacote define escala intermediária, ordem das operações e arredondamento final em centavos. Mesmos documentos congelados, pacote, regra, unidade, origem e fórmula produzem o mesmo item, os mesmos totais e o mesmo arquivo.

Atualização de biblioteca ou implementação não altera revisão anterior. Correção cria nova versão de fórmula e novo pacote; reprocessamento cria nova revisão mensal.

## 8. Aprovação humana e demonstrativo

- `auxiliar` autorizado pode processar e submeter competência sem bloqueios;
- `contador` ou `admin_escritorio`, dentro da carteira aplicável, pode aprovar ou rejeitar;
- `auditor_readonly` consulta memória, fontes, demonstrativos e histórico;
- demais papéis são negados por padrão.

Rejeição exige motivo. O usuário não edita origem, estoque, base, alíquota, benefício, diferença ou total. Divergência é corrigida no documento, EFD, cadastro ou pacote e então reprocessada.

Após aprovação, o sistema gera um demonstrativo em rascunho no leiaute oficial correspondente ao regime, com encoding, separadores, registros, campos obrigatórios e totais validados. O arquivo recebe hash e referência à revisão. Alteração posterior invalida o rascunho anterior e exige nova aprovação.

O rascunho não é transmitido e não cria escrituração, crédito, débito, guia ou lançamento. A interface o identifica explicitamente como **Rascunho — sem efeito fiscal**.

## 9. Snapshot, concorrência e auditoria

O fechamento mensal congela:

- conjunto e hash dos documentos de entrada e saída;
- vínculos diretos, registros EFD e médias ponderadas;
- unidades, fatores, quantidades e estoque atribuído;
- pacote, regras, fórmulas, vigências e fontes;
- linhas, totais brutos, saldo líquido e motivos de bloqueio;
- autor e instante do processamento, submissão, aprovação, rejeição e exportação;
- hash do demonstrativo gerado.

Mesma chave idempotente com a mesma entrada devolve a mesma revisão. Conteúdo divergente com a mesma chave produz conflito. Documento alterado durante o processamento retorna HTTP 409 e nenhuma revisão parcial persiste.

Submeter, aprovar ou rejeitar exige a revisão esperada. Decisão concorrente ou aprovação de revisão superada retorna conflito. Eventos append-only registram processamento, bloqueio, submissão, aprovação, rejeição, exportação e reprocessamento sem duplicar XML integral.

## 10. Autorização e isolamento

- `super-admin` mantém o pacote global sem acessar dados fiscais de tenant por esse papel;
- `admin_escritorio` e `contador` processam, submetem, aprovam, rejeitam, exportam e consultam empresas autorizadas;
- `auxiliar` processa, consulta e submete quando possui permissão fiscal, mas nunca aprova ou exporta versão aprovada;
- `auditor_readonly` consulta sem mutar;
- demais papéis são negados por padrão.

Documentos, atribuições de estoque, cálculos, tarefas HITL, snapshots e demonstrativos possuem `tenant_id` e `empresa_id`, ficam sob RLS e respeitam a carteira do colaborador. O `super-admin` global não lê dados fiscais pelo papel de manutenção do pacote.

## 11. Contrato de interface

A F29 compõe as visões existentes, sem criar módulo paralelo:

1. **Resolução tributária:** filtro por empresa, competência, regime e estado do fechamento.
2. **Linhas da competência:** produto, documento de saída, quantidade, origem da entrada, ICMS presumido, ICMS efetivo, diferença e estado.
3. **Memória:** documentos participantes, média ponderada, conversões, estoque, regra, fórmula, passos e fontes.
4. **Consolidado:** restituição bruta, complemento bruto, saldo líquido, contagem de linhas e bloqueios.
5. **Fila HITL:** submissão, comparação entre revisões, aprovação e rejeição motivada.
6. **Demonstrativo:** prévia validada, hash e download do rascunho aprovado.

A interface usa a tela de apuração fiscal de `docs/telas/` como referência de conteúdo, fluxo, hierarquia e densidade. `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md` corrigem a aparência e o comportamento. Não há KPI inventado nem promessa de crédito disponível.

Estados obrigatórios: carregando, vazio, erro, processando, bloqueado, pendente de revisão, aprovado, rejeitado e rascunho invalidado. Valores e identificadores fiscais usam números tabulares. Estado nunca depende apenas de cor.

Entrega final obrigatória em CLARO e ESCURO, com provas em 768, 1024 e 1440 px, navegação por teclado, foco visível, contraste, leitor de tela e redução de movimento. `frontend-design` orienta a implementação e `impeccable` executa o passe final de acabamento.

## 12. API e persistência

O contrato HTTP expõe operações equivalentes a:

- listar competências e revisões;
- processar ou reprocessar uma competência com revisão documental esperada e chave idempotente;
- consultar linhas, memória, bloqueios e fontes;
- submeter revisão determinável;
- aprovar ou rejeitar a revisão esperada;
- gerar e baixar o rascunho aprovado pelo hash esperado.

Respostas de erro seguem `application/problem+json` com `type`, `title`, `status`, `code` e `correlationId`. Códigos estáveis cobrem, no mínimo, competência bloqueada, documento concorrente, revisão superada, unidade incompatível, estoque insuficiente, origem ambígua, regra ambígua e rascunho invalidado.

O caso de uso controla a transação. Controller apenas valida e delega. DTO não é entidade. Restrições impedem mutação de pacote publicado, revisão, linha, aprovação, demonstrativo ou evento e impedem chave idempotente divergente.

## 13. Invariantes

| ID | Invariante |
|---|---|
| `I-1` | todo documento, cálculo, revisão, demonstrativo e evento transacional possui tenant e empresa sob RLS |
| `I-2` | LLM nunca seleciona regra, atribui estoque, calcula valor ou altera memória |
| `I-3` | dinheiro não usa float; quantidade, fator e alíquota usam precisão explícita |
| `I-4` | linha material indeterminada bloqueia a competência inteira |
| `I-5` | restituição e complemento brutos permanecem separados mesmo quando o saldo líquido é zero |
| `I-6` | vínculo direto válido prevalece sobre média ponderada; conflito nunca é resolvido silenciosamente |
| `I-7` | usuário não edita cálculo; correção exige nova revisão |
| `I-8` | aprovação não transmite nem produz efeito fiscal, contábil ou financeiro |
| `I-9` | revisão aprovada, rascunho e evento são imutáveis e auditáveis |
| `I-10` | operação fora de 27/10/2016 a 28/02/2018 não recebe cálculo desta fatia |

## 14. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Regras | restituição, complemento, igualdade, arredondamento, vínculo direto, EFD, média ponderada, conversão de unidade, estoque e fronteiras temporais |
| Contrafactuais | outro segmento, UF, regime, NFC-e, devolução, saída interestadual, data fora da janela, pauta/PMPF e benefício sem fonte |
| Banco | RLS, carteira, imutabilidade, revisão sequencial, idempotência, concorrência e append-only |
| Fechamento | uma linha indeterminada bloqueia o mês; correção gera nova revisão; totais brutos e saldo permanecem reproduzíveis |
| Exportação | leiautes por regime, campos, separadores, encoding, totais, hash e rejeição de arquivo parcial |
| Autorização | auxiliar não aprova; contador/admin aprovam; auditor só lê; super-admin global não lê dados do tenant |
| Tela | CLARO/ESCURO, 768/1024/1440, loading/empty/error/blocked/success, teclado, foco, contraste e leitor de tela |
| E2E | processar → bloquear ou consolidar → submeter → aprovar/rejeitar → gerar e baixar rascunho |

Fixtures oficiais ou sintéticas rastreáveis cobrem os dois regimes e cada origem de recuperação. Ausência de ambiente, fonte ou prova real é `not_run`, nunca `pass`.

## 15. Critérios de aceite

- [ ] Somente autopeças, empresas em Goiás, regimes aprovados, NF-e 55 e janela aprovada entram no cálculo.
- [ ] Vínculo direto/EFD e média ponderada mensal produzem memória auditável e reproduzível.
- [ ] Estoque insuficiente, unidade incompatível, origem ou regra ambígua resultam em `INDETERMINATE`.
- [ ] Restituição, complemento e igualdade são calculados por item com decimal exato.
- [ ] Totais brutos e saldo líquido mensal permanecem separados e rastreáveis.
- [ ] Uma linha indeterminada bloqueia aprovação e exportação da competência inteira.
- [ ] Auxiliar submete e não aprova; contador ou admin aprovam ou rejeitam com motivo.
- [ ] Demonstrativo aprovado é apenas rascunho validado e não produz efeito externo.
- [ ] Reprocessamento cria revisão nova; idempotência não duplica efeito; concorrência retorna conflito.
- [ ] RLS e carteira impedem acesso cruzado; super-admin global não lê dados fiscais por esse papel.
- [ ] LLM não participa da seleção, atribuição, cálculo, consolidação ou exportação.
- [ ] Interface final prova ambos os temas, responsividade, estados e acessibilidade.

## 16. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| NFC-e modelo 65 | fatia própria de ingestão, validação, persistência e normalização; depois amplia este cálculo |
| Devolução, cancelamento posterior e estorno proporcional | capacidade própria de eventos posteriores do MVP-2 |
| Saída interestadual | capacidade própria de ressarcimento do MVP-2 |
| Pauta, PMPF e preço sugerido | fatia própria somente se houver segmento e fonte oficial aplicáveis |
| Outros segmentos, UFs e regimes | fatias próprias de expansão do motor tributário no MVP-2 |
| Transmissão do demonstrativo | capacidade própria de obrigação e entrega do MVP-2 |
| EFD, ajuste, crédito apropriado e lançamento contábil | capacidades de apuração, escrituração e contabilidade do MVP-2 |
| Guia, contas a receber/pagar e pagamento | capacidades fiscal e financeira posteriores do MVP-2 |
| Produção e piloto real | gate posterior ao MVP-4 |

Nenhum complemento foi descartado. Uma apuração futura não pode tratar competência bloqueada como resolvida nem apropriar saldo sem a capacidade correspondente.

## 17. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Capacidade | complemento e restituição de ICMS-ST de autopeças |
| Período | 27/10/2016 a 28/02/2018, inclusive |
| Operação | venda interna a consumidor final |
| Regimes | Simples Nacional e Lucro Presumido |
| Origem da entrada | documento/EFD e média ponderada mensal |
| Granularidade | item e consolidado mensal |
| Falha | item material indeterminado bloqueia o mês inteiro |
| Saída | demonstrativo oficial em rascunho, sem transmissão ou efeito fiscal |
| Documento | somente NF-e 55; NFC-e 65 recebe fatia própria |
| Interface | compõe Resolução tributária e fila HITL; não cria módulo paralelo |

## 18. Matriz de cobertura

| Requisito | Cobertura |
|---|---|
| Identidade | complemento/restituição histórica de ICMS-ST de autopeças em Goiás |
| Comportamento | recuperar entrada, calcular saída, comparar, consolidar, revisar e exportar rascunho |
| Aceite | §15, com provas por categoria no §14 |
| Invariantes | §13, incluindo fail-closed, RLS, determinismo e ausência de efeito externo |
| Fora de escopo | §16, todos com destino explícito |
| Dúvidas resolvidas | §17, sem decisão de produto pendente |
| Contrato de UI | §11, tela final nos dois temas e estados obrigatórios |
| Rastreabilidade | PRD §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16; MVP-2; issue #33 |
