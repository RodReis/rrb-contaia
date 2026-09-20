# SPEC-035 / F35 — Dossiê interno de decisão do ICMS-ST histórico

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Issue:** #39
> **Estado:** aprovada pelo PI em 19/09/2026
> **Origem:** PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16; F33/SPEC-033; F34/SPEC-034

## 1. Objetivo

Transformar a reconstrução histórica e os acréscimos legais aprovados nas F33/F34 em um dossiê interno de decisão, mantendo restituição e complemento como trilhas independentes, com elegibilidade normativa explícita, revisão humana segregada e prova causal até cada fonte, evidência e decisão.

A fatia formaliza intenção e aprovação interna. Não executa escrituração, apropriação, compensação, transferência, pedido, guia, pagamento, retificação, contestação, protocolo ou transmissão.

## 2. Recorte obrigatório

A F35 herda integralmente o recorte das F33/F34:

- empresas autorizadas do tenant ativo;
- autopeças sujeitas a ICMS-ST em Goiás;
- saídas internas a consumidor final;
- documentos NF-e modelo 55 e NFC-e modelo 65;
- fatos originais entre 27/10/2016 e 28/02/2018;
- regimes `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO`;
- pacote F33 aprovado, íntegro e não superado;
- resultado F34 vinculado ao pacote F33, íntegro e não superado;
- data de referência, regras, atos formais, memória causal e hashes preservados das fontes.

A F35 não recalcula principal nem acréscimos. Divergência exige nova revisão na fatia de origem.

## 3. Entrega e limites

Entrega:

- criação de dossiê a partir de fontes F33/F34 elegíveis;
- trilhas independentes de restituição e complemento;
- catálogo condicionado de destinos internos futuros;
- matriz de elegibilidade por destino, fonte oficial e evidência;
- preparação, revisão, devolução, rejeição e aprovação humana segregada;
- fechamento parcial explícito quando somente uma trilha estiver decidida;
- histórico imutável de revisões, decisões, substituições e justificativas;
- pacote PDF, CSV e JSON com conteúdo coerente e hash reproduzível;
- interface final em `Fiscal -> Resolução tributária`, nos temas CLARO e ESCURO;
- auditoria append-only de toda ação e tentativa negada.

Não entrega:

- novo cálculo ou alteração dos pacotes F33/F34;
- elegibilidade presumida a partir do nome do destino;
- recomendação ou interpretação jurídica por LLM;
- compensação entre restituição e complemento;
- apropriação, compensação, transferência ou pedido efetivo de restituição;
- escrituração, retificação, DARE, guia, pagamento ou baixa;
- contestação, defesa, protocolo, transmissão ou consulta oficial;
- lançamento contábil, partida dobrada ou título financeiro;
- outro segmento, UF, regime, documento, operação ou período;
- produção ou piloto real.

## 4. Fontes e elegibilidade

### 4.1 Fontes F33/F34

O dossiê aceita somente:

- pacote F33 aprovado, íntegro, não superado e com hash válido;
- resultado F34 vinculado exatamente ao pacote F33 selecionado;
- mesmo tenant, empresa, regime e período em ambas as fontes;
- memória causal completa e versões de contrato reconhecidas;
- arquivos privados disponíveis e íntegros.

Fonte rejeitada, superada, adulterada, incompatível ou parcialmente ausente não entra como base decisória.

### 4.2 Resultado indeterminado

Resultado F34 `INDETERMINATE` pode originar dossiê em rascunho para organizar lacunas e evidências. A trilha afetada fica `BLOCKED`, sem aprovação, até que nova revisão F34 determinável substitua a fonte.

Componentes conhecidos permanecem visíveis, mas não autorizam aprovação parcial de uma trilha cujo total seja nulo.

### 4.3 Pacote normativo de destinos

Cada destino depende de pacote normativo oficial, versionado, imutável e aprovado por humano. O pacote registra, no mínimo:

- identificador, versão, vigência e jurisdição;
- destino alcançado e condições de elegibilidade;
- fundamento oficial, URL ou documento, data de consulta e hash;
- regime, operação, período e tipo de crédito ou débito cobertos;
- evidências, autorizações, escriturações e pré-requisitos exigidos;
- autor da importação, aprovador e datas UTC.

Ausência, lacuna, conflito ou cobertura parcial retorna `INDETERMINATE`. O sistema não converte possibilidade genérica em direito aplicável ao caso.

## 5. Trilhas e destinos controlados

### 5.1 Restituição

Destinos catalogados:

- `APPROPRIATION` — preparação para apropriação futura;
- `COMPENSATION` — preparação para compensação futura;
- `TRANSFER` — preparação para transferência futura;
- `REFUND_REQUEST` — preparação para pedido futuro de restituição.

Cada opção permanece desabilitada até que o pacote normativo aprovado prove sua aplicabilidade às fontes e evidências do dossiê.

### 5.2 Complemento

Destinos catalogados:

- `GUIDE_PAYMENT` — preparação futura de guia e pagamento;
- `RECTIFICATION_BOOKKEEPING` — preparação futura de retificação e escrituração;
- `DISPUTE_ANALYSIS` — encaminhamento para análise humana de eventual contestação.

`DISPUTE_ANALYSIS` não declara cabimento jurídico, não cria defesa e não inicia processo. Apenas registra encaminhamento interno sustentado por motivo e evidência.

### 5.3 Independência

Não existe compensação automática entre as trilhas. Saldo comparativo pode ser exibido apenas como informação derivada, sem alterar valores, destinos ou decisões.

Uma trilha pode ser decidida enquanto a outra permanece `PENDING`, `RETURNED_FOR_EVIDENCE` ou `BLOCKED`. O pacote consolidado declara explicitamente o fechamento parcial.

## 6. Preparação e decisão humana

- `auxiliar`, quando autorizado, pode preparar dossiê e anexar evidências;
- `contador` e `admin_escritorio` podem preparar, revisar, devolver, rejeitar e aprovar;
- `auditor_readonly` consulta fontes, decisões, auditoria e artefatos sem mutar;
- demais papéis são negados por padrão;
- quem preparou ou alterou materialmente a revisão não pode aprovar a mesma trilha;
- o aprovador deve ser outro `contador` ou `admin_escritorio` com carteira ativa;
- cada decisão exige justificativa objetiva, destino quando aprovada e referência às evidências consideradas;
- devolução identifica lacunas e preserva a revisão anterior;
- rejeição não apaga nem altera fontes ou decisões anteriores.

As decisões permitidas por trilha são:

- `APPROVED` — destino futuro elegível selecionado e aprovado internamente;
- `REJECTED` — trilha rejeitada com motivo registrado;
- `RETURNED_FOR_EVIDENCE` — devolvida ao preparador com lacunas explícitas;
- `BLOCKED` — impedida por indeterminação, fonte inelegível ou regra ausente;
- `PENDING` — ainda sem decisão.

## 7. Contrato de resultado

```ts
type FiscalUseDestination =
  | "APPROPRIATION"
  | "COMPENSATION"
  | "TRANSFER"
  | "REFUND_REQUEST"
  | "GUIDE_PAYMENT"
  | "RECTIFICATION_BOOKKEEPING"
  | "DISPUTE_ANALYSIS";

type FiscalUseTrackStatus =
  | "PENDING"
  | "RETURNED_FOR_EVIDENCE"
  | "APPROVED"
  | "REJECTED"
  | "BLOCKED";

type FiscalUseDossierStatus =
  | "DRAFT"
  | "IN_REVIEW"
  | "PARTIALLY_DECIDED"
  | "DECIDED"
  | "BLOCKED_INDETERMINATE"
  | "POSSIBLY_OUTDATED"
  | "SUPERSEDED";

type FiscalUseTrackDecision = {
  status: FiscalUseTrackStatus;
  principalCents: number;
  legalAccrualsCents: number | null;
  totalCents: number | null;
  destination: FiscalUseDestination | null;
  rulePackageVersion: string | null;
  evidenceIds: readonly string[];
  reason: string | null;
  preparedBy: string;
  decidedBy: string | null;
  decidedAtUtc: string | null;
};

type FiscalUseDossier = {
  dossierId: string;
  tenantId: string;
  companyId: string;
  sourceReconstructionPackageId: string;
  sourceLegalAccrualResultId: string;
  regime: "SIMPLES_NACIONAL" | "LUCRO_PRESUMIDO";
  restitution: FiscalUseTrackDecision;
  complement: FiscalUseTrackDecision;
  status: FiscalUseDossierStatus;
  contractVersion: string;
  canonicalJsonHash: string;
  generatedAtUtc: string;
};
```

`APPROVED` significa somente aprovação interna da intenção e do destino futuro. Não significa crédito reconhecido, débito confessado, guia emitida, escrituração realizada, pagamento autorizado ou pedido protocolado.

Erros seguem `application/problem+json` e distinguem, no mínimo:

- `ICMS_ST_DOSSIER_SOURCE_INELIGIBLE`;
- `ICMS_ST_DOSSIER_SOURCE_HASH_MISMATCH`;
- `ICMS_ST_DOSSIER_SOURCE_INDETERMINATE`;
- `ICMS_ST_DOSSIER_DESTINATION_NOT_SUPPORTED`;
- `ICMS_ST_DOSSIER_DESTINATION_RULE_MISSING`;
- `ICMS_ST_DOSSIER_DESTINATION_INDETERMINATE`;
- `ICMS_ST_DOSSIER_EVIDENCE_INCOMPLETE`;
- `ICMS_ST_DOSSIER_SELF_APPROVAL_FORBIDDEN`;
- `ICMS_ST_DOSSIER_DECISION_CONFLICT`;
- `ICMS_ST_DOSSIER_SUPERSEDED`;
- `ICMS_ST_DOSSIER_EXPORT_HASH_MISMATCH`.

## 8. Idempotência, revisão e exportação

A chave idempotente considera tenant, empresa, fontes F33/F34, versões e hashes dos pacotes normativos, evidências, decisões por trilha e versão do contrato.

Alteração em fonte, regra, evidência ou decisão gera nova revisão e supera a anterior sem apagá-la. Repetir as mesmas entradas reproduz o JSON canônico e o hash.

PDF, CSV e JSON incluem:

- identificação do dossiê e das fontes F33/F34;
- regime, período original e data de referência;
- trilhas separadas, valores e estados;
- destinos avaliados, habilitados, bloqueados e respectivos fundamentos;
- evidências, lacunas, preparadores, revisores e aprovadores;
- justificativas, fechamento parcial e histórico de substituições;
- versões, geração UTC, contrato e hash canônico.

## 9. Autorização, isolamento e auditoria

Dossiês, trilhas, regras, evidências, decisões, arquivos e auditoria possuem `tenant_id` e `empresa_id`, usam RLS, carteira ativa e storage privado.

O `super-admin` global não lê dados fiscais do tenant por esse papel.

Auditoria append-only registra criação, edição, anexação, seleção, revisão, devolução, rejeição, aprovação, tentativa de autoaprovação, exportação, download, reprodução, invalidação, superação e erro. Logs e métricas não carregam XML integral, documento completo, CPF/CNPJ completo nem conteúdo fiscal sensível.

## 10. Contrato de interface

A F35 evolui `Fiscal -> Resolução tributária`:

1. selecionar fontes F33/F34 elegíveis;
2. visualizar integridade, estados e cobertura;
3. abrir rascunho e organizar lacunas quando houver indeterminação;
4. revisar trilhas de restituição e complemento separadamente;
5. comparar destinos e fundamentos sem recomendação automática;
6. anexar e revisar evidências;
7. devolver, rejeitar ou aprovar cada trilha;
8. impedir autoaprovação e explicar a segregação exigida;
9. exportar PDF, CSV e JSON, inclusive com fechamento parcial;
10. consultar histórico, substituições e auditoria.

Estados obrigatórios: vazio, carregando, fonte inelegível, hash divergente, indeterminado, rascunho bloqueado, em preparação, em revisão, evidência incompleta, destino sem fundamento, devolvido, parcialmente decidido, decidido, rejeitado, exportando, exportado, possivelmente desatualizado, superado, falha recuperável e falha terminal. Estado nunca depende apenas de cor.

A referência de conteúdo e fluxo permanece `docs/telas/contaia_apura_o_fiscal_tribut_ria_reforma_ibs_cbs_rf_03/`. Aparência e comportamento obedecem `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md`.

A implementação usa `frontend-design` antes e durante a construção e `impeccable` no acabamento. A PR prova comparação com o protótipo, CLARO/ESCURO, 768/1024/1440 px, teclado, foco, contraste, leitor de tela e redução de movimento conforme `FRONTEND.md` §20.1.

## 11. Invariantes globais tocados

| Código | Aplicação nesta fatia |
|---|---|
| `I-1` | dossiês, regras, evidências, decisões, arquivos e auditoria possuem tenant e empresa, índices e RLS |
| `I-2` | operação sem contexto válido não retorna dados nem executa comando |
| `I-3` | dinheiro usa centavos inteiros; nenhum float monetário |
| `I-4` | elegibilidade é determinística e baseada em pacote aprovado; LLM não decide nem interpreta norma |
| `I-5` | decisão é interna e não produz efeito externo |
| `I-6` | fontes, revisões, decisões e auditoria são append-only |
| `I-7` | revisão superada permanece consultável com motivo e substituta |
| `I-8` | estado e destino derivam das fontes e regras versionadas, nunca da data de geração |
| `I-9` | mesma entrada reproduz resultado e hash |
| `I-10` | F35 não assina, protocola nem transmite obrigação |
| `I-11` | datas civis não têm fuso; instantes são UTC e exibidos em `America/Sao_Paulo` |
| `I-12` | JSON canônico e hash cobrem fontes, regras, evidências e decisões |

## 12. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Regras | decisões independentes, fechamento parcial, justificativas e destinos condicionados |
| Segregação | preparador não aprova a própria trilha; outro contador/admin autorizado aprova |
| Indeterminação | F34 indeterminada cria rascunho bloqueado e impede aprovação da trilha afetada |
| Elegibilidade | destino só habilita com pacote oficial aprovado e integralmente aplicável |
| Fontes | fontes íntegras entram; rejeitadas, superadas, incompatíveis ou adulteradas não entram |
| Banco | RLS, carteira, idempotência, append-only, superação e storage privado |
| Exportação | PDF, CSV e JSON coincidem em estados, decisões, fundamentos, versões e hash |
| Contrafactuais | compensação automática e todo efeito fiscal, contábil, financeiro ou processual são bloqueados |
| Tela | CLARO/ESCURO, 768/1024/1440, estados, teclado, foco, contraste, leitor de tela e movimento reduzido |
| E2E | F33/F34 -> preparação -> devolução ou decisão por trilha -> segundo aprovador -> exportação -> superação |

Fixtures oficiais ou sintéticas rastreáveis cobrem os dois regimes, ambas as trilhas, todos os destinos catalogados, regra aplicável e ausente, autoaprovação, decisão parcial e fonte superada. Ausência de prova real é `not_run`, nunca `pass`.

## 13. Critérios de aceite

- [ ] Somente fontes F33/F34 aprovadas, íntegras, compatíveis e não superadas sustentam decisão.
- [ ] Resultado F34 indeterminado pode gerar rascunho, mas bloqueia a aprovação da trilha afetada.
- [ ] Restituição e complemento permanecem independentes e nunca são compensados automaticamente.
- [ ] Cada destino só habilita com fundamento oficial versionado, aprovado e aplicável ao caso.
- [ ] Ausência, lacuna ou conflito de fundamento retorna `INDETERMINATE`, sem presunção.
- [ ] Quem preparou ou alterou materialmente a revisão não aprova a mesma trilha.
- [ ] Aprovação, rejeição e devolução exigem justificativa e autoria auditável.
- [ ] Uma trilha pode fechar enquanto a outra permanece pendente, devolvida ou bloqueada.
- [ ] Encaminhamento para análise de contestação não declara cabimento nem inicia processo.
- [ ] Mesmo conjunto de entradas reproduz JSON e hash; mudança gera nova revisão.
- [ ] PDF, CSV e JSON coincidem com o conteúdo canônico e explicitam fechamento parcial.
- [ ] Nenhuma decisão produz escrituração, apropriação, compensação, transferência, pedido, guia, pagamento, retificação, contestação ou transmissão.
- [ ] RLS, carteira, storage privado e auditoria impedem vazamento, mutação destrutiva e duplicidade.
- [ ] Testes de regras, banco, tela e E2E publicam evidência vinculada à SPEC-035 e à issue #39.
- [ ] Interface final prova ambos os temas, responsividade, estados e acessibilidade exigidos.

## 14. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Apropriação, compensação, transferência e pedido efetivos | fatias próprias de uso fiscal do MVP-2 |
| Escrituração, retificação, SPED e livros fiscais | capacidades próprias de escrituração do MVP-2 |
| DARE, guia, pagamento, parcelamento e baixa | capacidades fiscal e financeira posteriores do MVP-2 |
| Contestação, defesa, protocolo e acompanhamento processual | fatia própria após decisão normativa e de produto |
| Lançamento contábil e partida dobrada | capacidades contábeis próprias do MVP-2 |
| Outros segmentos, UFs, regimes, documentos e períodos | fatias próprias de expansão tributária do MVP-2 |
| Produção e piloto real | gate posterior ao MVP-4 |

Nenhum complemento foi descartado. A F35 encerra somente a decisão interna rastreável sobre destinos futuros.

## 15. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Resultado | dossiê de decisão interna |
| Estrutura | restituição e complemento em duas trilhas independentes |
| Decisões | aprovar, rejeitar ou devolver para evidência |
| Artefatos | PDF, CSV e JSON |
| Segregação | preparador não aprova a própria trilha |
| Indeterminação | permite rascunho bloqueado, sem aprovação da trilha afetada |
| Destino | aprovação seleciona destino futuro controlado, sem executá-lo |
| Catálogo | opções amplas, condicionadas por pacote normativo oficial aprovado |
| Contestação | somente encaminhamento para análise, sem declarar cabimento |
| Fechamento | parcial explícito quando apenas uma trilha estiver decidida |

**Questões abertas:** nenhuma.

## 16. Gate dos oito itens obrigatórios

| Verificação | Evidência nesta SPEC |
|---|---|
| Identidade | cabeçalho, MVP-2, F35/SPEC-035 e issue #39 |
| Comportamento | §§1–9, observável por preparação, revisão, decisão, exportação e hash |
| Aceite | §13, ligado às provas do §12 |
| Invariantes | §11, com aplicação concreta dos códigos globais |
| Fora de escopo | §14, com destino explícito |
| Dúvidas | §15; nenhuma aberta |
| Complementos | §14; nenhum requisito descartado |
| UI | §10, com caminho, estados, temas, viewports e provas |

## 17. Referências oficiais datadas

- Decreto nº 10.202/2023 e Instrução Normativa nº 1.558/2023-GSE, consultados em 19/09/2026;
- Guia Prático da Escrituração Fiscal Digital de Goiás, versão 5.7, especialmente as hipóteses condicionadas de compensação e transferência de crédito, consultado em 19/09/2026;
- serviço oficial de Pagamento e Parcelamento de Tributos da Secretaria da Economia de Goiás, inclusive geração de DARE vinculada aos dados da EFD quando aplicável, consultado em 19/09/2026;
- pacotes normativos oficiais aprovados e vinculados a cada destino avaliado;
- pacotes históricos aprovados das F33/SPEC-033 e F34/SPEC-034.

## 18. Aprovação

Dossiê interno, trilhas independentes, decisões humanas, artefatos, segregação, rascunho bloqueado, catálogo condicionado, fechamento parcial, provas e destinos aprovados pelo PI em 19/09/2026. A implementação deve seguir esta SPEC sem presumir elegibilidade, sem compensar trilhas, sem autoaprovação e sem produzir efeito fiscal, contábil, financeiro ou processual externo.
