# SPEC-053 — Geração completa da EFD-Contribuições

> **Fatia:** F53
> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Issue:** [#67](https://github.com/RodReis/rrb-contaia/issues/67)
> **Origem:** PRD v3.1 §§3, 5.3, 6.1, 6.2, 6.4, 6.5, 12, 14, 15 e 16
> **Dependências:** F16, F18, F30, F32, F37 e F51
> **Ambiente:** Docker local, sem produção ([ADR-012](../../../adr/ADR-012-ambiente-local-ate-ultimo-mvp.md))
> **Estado:** aprovada pelo PI em 25/09/2026
> **Tamanho:** Enorme — exceção pontual aprovada pelo PI para reunir arquivo completo, consolidação na matriz, original, retificadora, parser independente, revisão segregada e CPRB no mesmo contrato

## 1. Objetivo

Gerar internamente a EFD-Contribuições completa, centralizada na matriz e por competência, para empresas de comércio de autopeças no Lucro Presumido cumulativo durante 2026.

Sucesso significa produzir uma versão original ou retificadora imutável, revisada por pessoa distinta, estrutural e aritmeticamente validada, reconciliada com as fontes aprovadas e acompanhada de TXT, manifesto e diagnóstico reproduzíveis. A fatia também decide de forma auditável a dispensa do Simples Nacional e apura a CPRB somente quando atividade, receita, vigência e tratamento possuírem cobertura oficial inequívoca.

A fatia não executa PVA, assinatura, transmissão, recibo, substituição oficial, pagamento nem qualquer efeito externo.

## 2. Fronteira e exceção de tamanho

A F53 entrega:

- enquadramento mensal evidenciado da obrigação;
- decisão `NOT_APPLICABLE` para período integralmente abrangido pelo Simples Nacional, sem gerar TXT;
- consolidação dos estabelecimentos autorizados em uma escrituração da matriz;
- seleção do pacote normativo vigente;
- geração de todos os blocos e registros aplicáveis ao recorte;
- apuração da CPRB para receitas e atividades de autopeças inequivocamente cobertas;
- arquivo original e retificador internos;
- parser independente e reconciliação com as fontes fechadas;
- revisão humana segregada;
- TXT, manifesto JSON e diagnóstico JSON reproduzíveis;
- interface final em `Fiscal -> EFD-Contribuições`.

O PI aprovou expressamente esta fatia como exceção `Enorme`. A exceção vale somente para F53 e não altera a régua geral de decomposição.

Não entram Lucro Real, regime não cumulativo, atividade diversa de autopeças, competência fora de 2026, PVA, assinatura, transmissão, recibo, substituição oficial, pagamento ou produção.

## 3. Recorte tributário obrigatório

### 3.1 Empresa, estabelecimentos e período

- empresa autorizada do tenant ativo;
- atividade de comércio de autopeças, sem enquadramento apenas por descrição livre ou CNAE isolado;
- competências mensais de `2026-01` a `2026-12`;
- uma escrituração centralizada no estabelecimento matriz por empresa, competência, finalidade e versão;
- estabelecimentos consolidados identificados individualmente, com suas fontes, versões e hashes;
- livros da F51 em estado `CLOSED`, íntegros e não `STALE` para todas as fontes exigíveis.

Ausência, duplicidade ou conflito na identificação da matriz ou dos estabelecimentos abrangidos produz `INDETERMINATE`.

### 3.2 Lucro Presumido cumulativo

- empresa no Lucro Presumido durante toda a competência;
- PIS/Pasep e Cofins no regime cumulativo;
- reconhecimento por caixa ou competência conforme opção anual válida e comprovada da F37;
- apurações de PIS/Pasep e Cofins aprovadas e separadas;
- tratamentos especiais e transição CBS/IBS somente sob pacote oficial aplicável e evidência aprovada.

Regime misto, mudança não sustentada do critério anual, fonte incompleta ou regra conflitante resulta em `INDETERMINATE`.

### 3.3 Simples Nacional

ME ou EPP no Simples Nacional durante toda a competência recebe decisão `NOT_APPLICABLE`, com:

- período abrangido pelo regime;
- referência oficial vigente;
- evidência e justificativa;
- responsável, revisor, instante e hash da decisão.

`NOT_APPLICABLE` não produz TXT vazio, escrituração facultativa, versão original ou retificadora. Regime ausente, misto ou conflitante produz `INDETERMINATE`; a dispensa nunca é presumida.

### 3.4 CPRB

A F53 apura e escritura CPRB somente quando houver correspondência inequívoca entre atividade, receita, produto ou serviço, período e pacote oficial vigente para o recorte de autopeças.

A apuração mantém separados:

- receitas totais e receitas alcançadas;
- exclusões, ajustes e estornos comprovados;
- base de cálculo por tratamento;
- alíquota e fundamento vigentes;
- contribuição bruta, ajustes e valor final;
- memória por estabelecimento e consolidação na matriz.

CPRB aplicável sem fonte integral, regra vigente ou segregação de receita produz `INDETERMINATE` e bloqueia a escrituração. A F53 não presume não aplicação, alíquota zero ou receita fora da base.

## 4. Enquadramento evidenciado

Cada empresa mantém revisões imutáveis de enquadramento com:

- matriz e estabelecimentos abrangidos;
- regime tributário e vigência;
- obrigação ou dispensa da EFD-Contribuições;
- critério anual de reconhecimento de receita;
- aplicabilidade da CPRB e tratamentos cobertos;
- referências oficiais, datas de consulta e anexos comprobatórios;
- justificativa, autor, revisor, hash e instante imutável de criação.

O cadastro é manual e local. Não há consulta automática à Receita Federal. Contador ou administrador aprova a revisão; vigências aprovadas não podem se sobrepor de modo contraditório.

Enquadramento ausente, vencido, conflitante, fora da competência ou sem evidência produz `INDETERMINATE`.

## 5. Pacote normativo e vigência

O gerador seleciona exatamente um pacote oficial versionado compatível com a competência, o regime e o enquadramento. O pacote contém, com proveniência e hash:

- leiaute e Guia Prático da EFD-Contribuições;
- tabelas, códigos, tipos de operação e regras vigentes;
- obrigatoriedade, dispensa, cardinalidade e validação por registro e campo;
- regras cumulativas de PIS/Pasep e Cofins;
- regras de CPRB cobertas para autopeças;
- regras de transição CBS/IBS aplicáveis em 2026;
- vigência e fixtures oficiais ou sintéticas aprovadas.

Pacote ausente, ambíguo, `STALE`, incompatível ou fora da vigência bloqueia a geração. Nova versão do pacote não altera artefato aprovado; invalida apenas rascunhos dependentes e exige nova revisão.

## 6. Cobertura de blocos e registros

A versão inclui todos os blocos e registros aplicáveis segundo pacote, regime, enquadramento e fontes cobertas, incluindo, quando exigidos:

- Bloco 0: abertura, identificação, estabelecimentos e referências;
- Blocos A, C, D e F: documentos, operações e demais receitas cobertas;
- Bloco M: apuração de PIS/Pasep e Cofins;
- Bloco P: CPRB, quando aplicável e integralmente coberta;
- Bloco 1: complementos exigidos e cobertos;
- Bloco 9: controle, totalização e encerramento.

Ausência legitimamente não aplicável é registrada no manifesto com fundamento no pacote e no enquadramento. Registro aplicável sem fonte, cobertura ou decisão aprovada bloqueia a versão como `INDETERMINATE`.

## 7. Fontes, consolidação e reconciliação

A geração fotografa por identificador, versão e hash:

- empresa, matriz, estabelecimentos e cadastros fiscais aprovados;
- enquadramento evidenciado;
- pacote normativo;
- livros fechados da F51;
- NF-e modelo 55 e NFC-e modelo 65 normalizadas, com eventos posteriores;
- apurações aprovadas da F37;
- fontes e memória da CPRB da seção 3.4;
- declarações e ajustes manuais aprovados nas capacidades de origem.

A consolidação preserva a origem por estabelecimento e elimina duplicidade por chave fiscal estável. Documento, total, tratamento ou ajuste não é corrigido dentro da geração; divergência retorna ao produtor da informação e bloqueia a aprovação.

A reconciliação comprova:

- estabelecimentos esperados e efetivamente consolidados;
- documentos presentes, ausentes, cancelados e devolvidos;
- receitas, bases, contribuições, ajustes, estornos e saldos;
- correspondência de PIS/Pasep e Cofins com F37 e F51;
- correspondência da CPRB com sua memória aprovada;
- contagens, totalizadores e encerramento;
- ausência de duplicação, omissão ou compensação silenciosa entre contribuições.

## 8. Finalidade e versões

### 8.1 Original

A primeira versão aprovada da competência tem finalidade `ORIGINAL`. Antes da aprovação, nova geração substitui somente o rascunho e preserva a auditoria. Depois da aprovação, qualquer correção exige `RETIFICADORA`.

### 8.2 Retificadora

A retificadora exige:

- referência à versão aprovada anterior;
- justificativa obrigatória;
- nova fotografia de fontes e novo hash;
- diagnóstico das diferenças por bloco, registro, estabelecimento e total;
- nova revisão segregada.

A aprovação interna marca a versão anterior como `SUPERSEDED`, sem afirmar substituição perante o Fisco. Não há prazo, protocolo ou autorização oficial nesta fatia.

## 9. Estados e transições

- `DRAFT`: geração em preparação;
- `INDETERMINATE`: falta ou conflito de fonte, enquadramento, pacote ou regra;
- `READY_FOR_REVIEW`: validações locais passaram e artefatos foram congelados;
- `APPROVED`: segunda pessoa aprovou a versão imutável;
- `REJECTED`: revisão recusada com motivo;
- `STALE`: fonte ou pacote fotografado mudou ou perdeu compatibilidade;
- `SUPERSEDED`: versão aprovada substituída por retificadora interna posterior;
- `NOT_APPLICABLE`: dispensa do Simples Nacional aprovada, sem TXT.

Somente `READY_FOR_REVIEW` pode ir a `APPROVED` ou `REJECTED`. `NOT_APPLICABLE` nasce de decisão própria revisada e não participa do ciclo de arquivos. Os demais estados bloqueantes não liberam artefato para uso externo.

## 10. Geração, parser e artefatos

O gerador puro recebe fontes fotografadas, pacote e instante explícito. Os mesmos insumos produzem os mesmos registros, ordem, totalizadores e hash lógico.

Um parser independente reabre o TXT e valida:

- codificação, delimitadores, hierarquia e ordem;
- tipo, tamanho e formato de campos;
- tabelas, chaves e referências;
- obrigatoriedade e cardinalidade;
- contagens, totalizadores e encerramento;
- reconciliação com manifesto, fontes e estabelecimentos.

Cada versão congelada produz:

- `efd-contribuicoes.txt` canônico;
- `manifesto.json` com identidade, finalidade, matriz, estabelecimentos, regime, pacote, fontes, cobertura e hash;
- `diagnostico.json` com validações, reconciliações, bloqueios e diferenças da retificadora.

O hash lógico exclui instante de download e inclui apenas conteúdo imutável, inclusive `revisionCreatedAtUtc`.

Uma decisão `NOT_APPLICABLE` produz somente manifesto e diagnóstico da dispensa, nunca `efd-contribuicoes.txt`.

## 11. Aprovação segregada

- auxiliar pode preparar e consultar conforme carteira;
- contador e administrador podem preparar, revisar e aprovar;
- quem preparou, alterou ou consolidou a versão não pode aprová-la;
- aprovação exige confirmação explícita de matriz, estabelecimentos, regime, finalidade, pacote, cobertura e diagnósticos;
- a decisão `NOT_APPLICABLE` também exige revisor distinto;
- tentativa negada é auditada.

Não existe autoaprovação, aprovação em lote ou exceção por ausência de segundo revisor.

## 12. Autorização, isolamento e auditoria

Todas as consultas e mutações aplicam tenant, empresa, matriz, estabelecimentos e carteira. RLS protege enquadramentos, versões, artefatos e auditoria.

Eventos append-only incluem enquadramento, decisão de dispensa, criação, consolidação, geração, bloqueio, congelamento, revisão, rejeição, aprovação, desatualização, supersessão e download, com ator, papel, correlação, origem, antes/depois, motivo e hashes.

Chave idempotente mínima: `tenantId + companyId + matrixEstablishmentId + competence + purpose + sourceSetHash + rulesetHash`.

Concorrência usa versão otimista. Aprovação e supersessão são atômicas; não pode haver duas versões aprovadas ativas para a mesma empresa, competência e finalidade.

## 13. Contratos de domínio

```ts
type EfdContributionsPurpose = "ORIGINAL" | "RECTIFYING";
type EfdContributionsObligation =
  | "REQUIRED"
  | "NOT_APPLICABLE"
  | "INDETERMINATE";
type EfdContributionsTaxRegime =
  | "PRESUMED_PROFIT_CUMULATIVE"
  | "SIMPLES_NACIONAL";
type EfdContributionsRevenueRecognition = "ACCRUAL" | "CASH";
type EfdContributionsCoverage =
  | "APPLICABLE"
  | "NOT_APPLICABLE"
  | "BLOCKED"
  | "COMPLETE";

type CprbAssessment = {
  competence: string;
  applicability: "APPLICABLE" | "NOT_APPLICABLE" | "INDETERMINATE";
  coveredRevenueCents: bigint;
  calculationBaseCents: bigint;
  contributionCents: bigint;
  sourceRevisionIds: string[];
  rulesetHash: string;
};
```

Valores monetários usam inteiros em centavos; alíquotas usam decimal exato. Dados externos entram como `unknown` e só passam aos contratos após validação.

Códigos estáveis incluem:

- `EFD_CONTRIBUTIONS_MATRIX_MISSING`;
- `EFD_CONTRIBUTIONS_ESTABLISHMENT_CONFLICT`;
- `EFD_CONTRIBUTIONS_REGIME_MISMATCH`;
- `EFD_CONTRIBUTIONS_OBLIGATION_INDETERMINATE`;
- `EFD_CONTRIBUTIONS_RULESET_MISSING`;
- `EFD_CONTRIBUTIONS_SOURCE_STALE`;
- `EFD_CONTRIBUTIONS_RECONCILIATION_FAILED`;
- `EFD_CONTRIBUTIONS_CPRB_INDETERMINATE`;
- `EFD_CONTRIBUTIONS_REVIEWER_CONFLICT`;
- `EFD_CONTRIBUTIONS_HASH_MISMATCH`.

## 14. Contrato de interface

A F53 cria `Fiscal -> EFD-Contribuições`, ligada à Escrituração Fiscal da F51.

A tela oferece:

- seleção de empresa e competência;
- resumo da matriz, estabelecimentos, regime, finalidade e pacote;
- decisão de obrigação ou dispensa;
- estado das fontes e da consolidação;
- cobertura por bloco e registro;
- apuração separada de PIS/Pasep, Cofins e CPRB;
- diagnósticos acionáveis;
- comparação da retificadora com a versão anterior;
- histórico imutável de versões, decisões e revisões;
- ações de gerar, congelar, revisar, aprovar, rejeitar e baixar conforme papel e estado.

O conteúdo parte da central de escrituração/SPED em `docs/telas/`, sem copiar transmissão, recibos, indicadores fictícios ou ações fora da fatia. Aparência e comportamento obedecem `FRONTEND.md`, `DESIGN-SYSTEM.md` e `docs/design-system/`.

Temas CLARO e ESCURO são obrigatórios, com responsividade, teclado, foco visível, contraste, leitor de tela, movimento reduzido e estados de carregamento, vazio, bloqueio, erro, sucesso, dispensa e desatualização. Mensagens usam Toast Sonner; nunca `alert`.

## 15. Invariantes

| ID | Invariante |
|---|---|
| I-1 | tenant, empresa e estabelecimentos nunca se misturam |
| I-2 | somente competências de `2026-01` a `2026-12` são elegíveis |
| I-3 | a escrituração é centralizada na matriz e preserva a origem por estabelecimento |
| I-4 | somente livros F51 `CLOSED` e não `STALE` alimentam a geração |
| I-5 | Lucro Presumido usa regime cumulativo e opção anual comprovada |
| I-6 | Simples Nacional aprovado como dispensado produz `NOT_APPLICABLE`, nunca TXT |
| I-7 | exatamente um pacote vigente e compatível governa a versão |
| I-8 | CPRB aplicável sem fonte e regra completas produz `INDETERMINATE` |
| I-9 | registro obrigatório sem fonte íntegra produz `INDETERMINATE` |
| I-10 | versão aprovada é imutável e reproduzível |
| I-11 | retificadora referencia versão anterior e não implica substituição oficial |
| I-12 | preparador não aprova a mesma versão nem a própria dispensa |
| I-13 | TXT, manifesto e diagnóstico compartilham o mesmo hash lógico |
| I-14 | nenhum fluxo executa PVA, assinatura, transmissão, recibo ou pagamento |

## 16. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Regras | vigência, obrigação, dispensa, caixa/competência, original/retificadora e `INDETERMINATE` |
| Regimes | Lucro Presumido cumulativo; Simples `NOT_APPLICABLE`; regimes mistos ou conflitantes |
| Consolidação | matriz válida, filiais completas, origem preservada, duplicidade e estabelecimento ausente |
| CPRB | aplicável, não aplicável, regra ausente, receita não segregada e totalização por estabelecimento |
| Fontes | livro aberto, fechado, `STALE`, hash divergente, documento ausente e ajuste incompatível |
| Gerador | determinismo, ordem, campos, tabelas, cardinalidades, contagens e totalizadores |
| Parser | rejeição independente de hierarquia, formato, referência, cardinalidade e soma inválidos |
| Aprovação | segregação positiva e negativa, rejeição, imutabilidade e supersessão atômica |
| Banco | RLS, carteira, idempotência, concorrência e append-only |
| Artefatos | TXT, manifesto e diagnóstico coincidem em fontes, cobertura, totais e hash |
| Contrafactuais | sem TXT para Simples; sem Lucro Real, PVA, assinatura, transmissão, recibo ou pagamento |
| Tela | CLARO/ESCURO, viewports, estados, teclado, foco, contraste, leitor de tela e movimento reduzido |
| E2E | fontes fechadas -> enquadramento -> consolidação -> geração -> parser -> revisão -> aprovação -> retificadora |

## 17. Critérios de aceite

- [ ] Geração limitada ao comércio de autopeças, Lucro Presumido cumulativo e competências de 2026.
- [ ] Uma escrituração mensal da matriz consolida e rastreia todos os estabelecimentos abrangidos.
- [ ] Simples Nacional aprovado como dispensado gera `NOT_APPLICABLE`, manifesto e diagnóstico, sem TXT.
- [ ] PIS/Pasep e Cofins permanecem separados e reconciliados com F37/F51.
- [ ] CPRB só é calculada e escriturada sob cobertura oficial inequívoca; lacuna produz `INDETERMINATE`.
- [ ] Todos os blocos e registros aplicáveis e cobertos são gerados conforme pacote vigente.
- [ ] Registro obrigatório sem fonte ou decisão aprovada bloqueia a versão.
- [ ] TXT passa pelo parser independente e reconcilia integralmente com fontes fotografadas.
- [ ] Original e retificadora são imutáveis, vinculadas e reproduzíveis.
- [ ] Preparador e aprovador são pessoas distintas.
- [ ] TXT, manifesto e diagnóstico compartilham o mesmo hash lógico.
- [ ] RLS, carteira, auditoria, idempotência e concorrência possuem provas positivas e negativas.
- [ ] Interface final comprova temas, responsividade, estados e acessibilidade.
- [ ] Nenhum fluxo implementa Lucro Real, PVA, assinatura, transmissão, recibo, pagamento ou efeito externo.

## 18. Fora de escopo e destinos

| Item | Destino obrigatório |
|---|---|
| Lucro Real e regime não cumulativo | fatia própria de expansão de PIS/Pasep e Cofins do MVP-2 |
| Atividade, receita ou tratamento de CPRB fora do comércio de autopeças coberto | fatia própria de expansão da CPRB no MVP-2 |
| Competências posteriores a 2026 e novos leiautes | fatia própria de expansão temporal e normativa do MVP-2 |
| PVA e validação no programa oficial | fatia própria de validação oficial da EFD-Contribuições no MVP-2 |
| Assinatura, transmissão, recibo e substituição oficial | fatia própria de entrega oficial da EFD-Contribuições no MVP-2 |
| Correção de documento, livro ou apuração de origem | capacidades produtoras F18, F30, F32, F37 e F51 |
| Malha SPED x DF-e x extrato | fatia própria de malha preventiva após F52/F53 e fontes financeiras |

## 19. Dúvidas resolvidas

- Regime: Lucro Presumido cumulativo; Simples Nacional apenas como decisão de dispensa evidenciada.
- Período: janeiro a dezembro de 2026.
- Consolidação: uma escrituração centralizada na matriz, com rastreio por estabelecimento.
- Cobertura: todos os blocos e registros aplicáveis, condicionados a fontes aprovadas.
- Finalidades: original e retificadora internas.
- CPRB: incluída somente para atividades e receitas de autopeças inequivocamente cobertas.
- Alçada: revisão segregada obrigatória para arquivo e decisão de dispensa.
- Interface: tela própria em `Fiscal -> EFD-Contribuições`.
- Tamanho: exceção `Enorme` expressamente aprovada e restrita à F53.
- Questões abertas: **Nenhuma**.

## 20. Gate de conformidade documental

- **Identidade:** F53/SPEC-053, MVP-2, issue #67 e origem no PRD declarados.
- **Comportamento:** obrigação, dispensa, pacote, consolidação, CPRB, geração, parser, revisão e versões são observáveis.
- **Aceite:** critérios verificáveis cobrem regras, banco, artefatos, tela e E2E.
- **Invariantes:** isolamento, vigência, centralização, determinismo e segregação estão explícitos.
- **Limites:** não há Lucro Real, PVA, assinatura, transmissão, recibo, pagamento ou efeito externo.
- **Destinos:** todos os complementos têm capacidade futura nomeada.
- **UI:** tela final, temas, estados, acessibilidade e responsividade fazem parte da fatia.
- **Tamanho:** exceção `Enorme` aprovada somente para F53.

## 21. Referências normativas consultadas

- Receita Federal, EFD-Contribuições — prazos e obrigatoriedade, atualizado em 20/07/2026: <https://www.gov.br/receitafederal/pt-br/canais_atendimento/fale-conosco/empresa/sped/efd-contribuicoes/efd-contribuicoes-prazos-e-obrigatoriedade-da-efd-contribuicoes>;
- Receita Federal, centralização da EFD-Contribuições na matriz, atualizado em 13/04/2026: <https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/perguntas-frequentes/sped/efd-contribuicoes/efdc/a-efd-contribuicoes-deve-ser-entregue>;
- Receita Federal, procedimento para transmissão sem obrigatoriedade, atualizado em 13/04/2026: <https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/perguntas-frequentes/sped/efd-contribuicoes/efdc/qual-procedimento-adotar-ao-transmitir>;
- SPED, manuais e Guia Prático da EFD-Contribuições: <https://sped.rfb.gov.br/item/show/1989>.

## 22. Aprovação

Recorte aprovado pelo PI em 25/09/2026 para criação da issue, commit e publicação documental na `main`.
