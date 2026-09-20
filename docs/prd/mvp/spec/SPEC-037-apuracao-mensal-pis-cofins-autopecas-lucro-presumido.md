# SPEC-037 / F37 — Apuração mensal de PIS e Cofins para autopeças no Lucro Presumido

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Issue:** #43
> **Estado:** aprovada pelo PI em 20/09/2026
> **Origem:** PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16; F18/SPEC-018, F30/SPEC-030, F32/SPEC-032 e F36/SPEC-036

## 1. Objetivo

Apurar mensalmente PIS/Pasep e Cofins no regime cumulativo para empresas do Lucro Presumido que comercializam autopeças, em competências de janeiro a dezembro de 2026. A fatia reconcilia documentos fiscais e declarações complementares, aplica regras oficiais versionadas, considera a transição CBS/IBS de 2026 quando comprovadamente aplicável e produz memória, aprovação humana e rascunhos locais separados de DARF.

O resultado é interno e preparatório. Não transmite declaração, não escritura EFD-Contribuições, não emite DARF oficial, não paga tributo e não substitui os sistemas da Receita Federal.

## 2. Recorte obrigatório

- empresa autorizada do tenant ativo, no Lucro Presumido durante toda a competência;
- atividade de comércio de autopeças, sem presumir tratamento apenas por CNAE ou descrição livre;
- competências civis de `2026-01` a `2026-12`, sem apuração anterior ou posterior nesta fatia;
- regime cumulativo de PIS/Pasep e Cofins, sem crédito da não cumulatividade;
- reconhecimento por competência ou caixa conforme opção anual válida e comprovada da empresa;
- NF-e modelo 55 e NFC-e modelo 65 autorizadas, normalizadas e não superadas;
- cancelamentos e devoluções normalizados disponíveis no corte da revisão;
- receitas ou recebimentos ausentes dos documentos fiscais somente por declaração justificada e anexo comprobatório;
- tratamento normal e tratamentos especiais somente quando um pacote oficial aprovado cobrir produto, operação, vigência e condições;
- CBS e IBS de 2026 somente quando obrigação, recolhimento, dispensa e compensação estiverem comprovados por evidência e regra vigente.

Mudança do critério de caixa/competência dentro do ano, regime misto, Lucro Real, atividade não coberta ou pacote incompleto retorna `INDETERMINATE`.

## 3. Entrega e limites

Entrega:

- seleção de empresa e competência de 2026;
- comprovação do Lucro Presumido e do critério anual de reconhecimento da receita;
- consolidação de NF-e, NFC-e, eventos, cancelamentos, devoluções e declarações complementares;
- segregação de receitas por tratamento tributário comprovado;
- cálculo determinístico e independente de PIS/Pasep e Cofins;
- consideração da CBS/IBS de 2026 apenas quando elegível e comprovada;
- memória causal até documento, declaração, evidência, regra, fórmula e arredondamento;
- preparação por usuário autorizado e aprovação humana por `contador` ou `admin_escritorio`;
- rascunhos locais separados de DARF para PIS e Cofins, inequivocamente não oficiais;
- exportação coerente em PDF, CSV e JSON canônico com hash reproduzível;
- nova revisão imutável quando entrada, evidência ou regra mudar;
- interface final em `Fiscal -> Apuração Fiscal`, nos temas CLARO e ESCURO;
- auditoria append-only de ações e tentativas negadas.

Não entrega:

- IRPJ, CSLL, Lucro Real ou regime não cumulativo;
- EFD-Contribuições, DCTF, DCTFWeb ou outra escrituração/declaração;
- transmissão, autenticação, emissão ou consulta de DARF oficial;
- pagamento, baixa, compensação financeira, parcelamento ou conciliação bancária;
- inferência de tratamento monofásico, alíquota zero, substituição, isenção, suspensão ou não incidência sem cobertura oficial;
- competências fora de 2026, outras atividades ou piloto real;
- produção.

## 4. Pacotes normativos

### 4.1 PIS/Pasep e Cofins

O pacote aprovado registra, no mínimo:

- versão, vigência, data de consulta, fontes oficiais e hashes;
- enquadramento no regime cumulativo e condições do Lucro Presumido;
- base de cálculo, exclusões, devoluções, cancelamentos e arredondamento;
- alíquotas e códigos de receita alcançados, sem constantes legais dispersas no código;
- tratamentos normal, monofásico, alíquota zero, substituição, isenção, suspensão e não incidência que estiverem efetivamente cobertos;
- vencimento preliminar e regras para dia não útil;
- evidências exigidas para cada tratamento e critério de receita.

Tratamento não coberto nunca recebe alíquota padrão. A competência fica `INDETERMINATE`, ainda que seja possível exibir componentes conhecidos.

### 4.2 Transição CBS/IBS de 2026

O pacote de transição registra:

- obrigações acessórias aplicáveis à empresa e à competência;
- condição e evidência de dispensa de recolhimento;
- valores efetivamente recolhidos de CBS e IBS, quando houver;
- regra, limite e ordem de compensação com PIS/Pasep e Cofins;
- eventual saldo não compensado, sem baixa ou aproveitamento automático fora da fatia.

Ausência de prova não equivale a zero, dispensa ou direito de compensação. O sistema não calcula nem presume obrigação de CBS/IBS fora da cobertura aprovada.

### 4.3 Governança

- somente pacote importado e aprovado por `contador` ou `admin_escritorio` calcula;
- alteração normativa cria versão nova e preserva resultados anteriores;
- pacote conflitante, parcialmente aplicável ou sem fonte oficial bloqueia a revisão;
- LLM pode explicar saída estruturada, mas não escolhe regra, alíquota, segregação, evidência ou compensação.

## 5. Entradas e reconciliação

Entradas obrigatórias:

- empresa, regime vigente, atividade, competência e opção anual por caixa ou competência;
- documentos normalizados, itens, eventos, cancelamentos e devoluções;
- pacote normativo aprovado compatível com empresa, atividade e competência;
- corte documental e autoria da revisão;
- declarações complementares justificadas e anexadas;
- evidências da transição CBS/IBS quando essa trilha for aplicável.

No critério de competência, receitas são reconhecidas conforme fato e documento cobertos. No critério de caixa, cada recebimento precisa de data civil, valor, origem e vínculo com documento ou declaração; a falta do módulo financeiro é suprida somente por declaração comprovada, nunca por estimativa.

Declaração complementar é append-only. Correção cria nova declaração, supera a anterior e torna a revisão aprovada `POSSIBLY_OUTDATED`.

## 6. Cálculo e indeterminação

O motor calcula separadamente:

1. receita bruta reconciliada;
2. exclusões e ajustes cobertos;
3. bases segregadas por tratamento;
4. PIS/Pasep bruto por componente;
5. Cofins bruta por componente;
6. compensações CBS/IBS comprovadas e atribuídas conforme regra aprovada;
7. valores líquidos preliminares de PIS/Pasep e Cofins;
8. vencimentos e rascunhos locais separados.

Dinheiro usa centavos inteiros. Taxas usam decimal escalado. Cada componente expõe regra, versão, fonte, entradas, fórmula, arredondamento e resultado.

Ausência, inconsistência, duplicidade, conflito ou cobertura parcial produz `INDETERMINATE`, com códigos de lacuna e ações necessárias. É proibido:

- completar receita por média, estimativa ou período anterior;
- usar alíquota ou tratamento mais recente como fallback;
- considerar documento ausente como receita zero;
- presumir que produto de autopeças é ou não monofásico apenas por descrição;
- apresentar resultado parcial como tributo devido;
- compensar CBS/IBS sem prova de recolhimento e elegibilidade;
- misturar PIS/Pasep e Cofins em um único valor sem memória individual.

## 7. Preparação, aprovação e revisão

- `auxiliar` autorizado prepara, declara e anexa evidências, mas não aprova;
- `contador` e `admin_escritorio` com carteira ativa preparam, revisam, devolvem, rejeitam e aprovam;
- `auditor_readonly` consulta fontes, revisões, artefatos e auditoria;
- demais papéis são negados por padrão;
- o mesmo contador ou admin pode preparar e aprovar manualmente a revisão;
- aprovação exige justificativa, confirmação das declarações e aceite explícito de que os DARFs são rascunhos;
- revisão `INDETERMINATE` não pode ser aprovada nem exportada como guia pronta;
- nenhuma aprovação é automática, otimista ou inferida por ausência de interação.

Estados: `DRAFT`, `INCOMPLETE`, `INDETERMINATE`, `READY_FOR_REVIEW`, `APPROVED`, `REJECTED`, `POSSIBLY_OUTDATED` e `SUPERSEDED`.

## 8. Contrato de resultado

```ts
type PisCofinsRevenueRecognition = "ACCRUAL" | "CASH";

type PisCofinsAssessmentStatus =
  | "DRAFT"
  | "INCOMPLETE"
  | "INDETERMINATE"
  | "READY_FOR_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "POSSIBLY_OUTDATED"
  | "SUPERSEDED";

type ContributionComponent = {
  contribution: "PIS_PASEP" | "COFINS";
  treatmentCode: string;
  baseCents: number;
  rateScaled: string | null;
  grossAmountCents: number | null;
  transitionOffsetCents: number;
  netAmountCents: number | null;
  ruleId: string;
  sourceIds: readonly string[];
};

type PisCofinsAssessment = {
  assessmentId: string;
  tenantId: string;
  companyId: string;
  competence: string;
  revenueRecognition: PisCofinsRevenueRecognition;
  status: PisCofinsAssessmentStatus;
  rulePackageVersion: string;
  transitionPackageVersion: string | null;
  components: readonly ContributionComponent[];
  pisPayableCents: number | null;
  cofinsPayableCents: number | null;
  gapCodes: readonly string[];
  preparedBy: string;
  approvedBy: string | null;
  approvedAtUtc: string | null;
  contractVersion: string;
  canonicalJsonHash: string;
  revisionCreatedAtUtc: string;
};
```

Competência e vencimento são datas civis; instantes são UTC. `revisionCreatedAtUtc` é imutável e integra o JSON canônico. O instante de download fica apenas na auditoria.

Erros seguem `application/problem+json` e distinguem, no mínimo:

- `PIS_COFINS_REGIME_MISMATCH`;
- `PIS_COFINS_RECOGNITION_OPTION_MISSING`;
- `PIS_COFINS_RECOGNITION_OPTION_CONFLICT`;
- `PIS_COFINS_RULE_MISSING`;
- `PIS_COFINS_RULE_CONFLICT`;
- `PIS_COFINS_TREATMENT_UNSUPPORTED`;
- `PIS_COFINS_REVENUE_RECONCILIATION_FAILED`;
- `PIS_COFINS_EVIDENCE_REQUIRED`;
- `PIS_COFINS_TRANSITION_EVIDENCE_MISSING`;
- `PIS_COFINS_TRANSITION_OFFSET_INVALID`;
- `PIS_COFINS_INDETERMINATE`;
- `PIS_COFINS_REVISION_CONFLICT`;
- `PIS_COFINS_SUPERSEDED`;
- `PIS_COFINS_EXPORT_HASH_MISMATCH`.

## 9. Idempotência e artefatos

A chave idempotente considera tenant, empresa, competência, critério anual, documentos e eventos com hashes, declarações e evidências, pacotes normativos, dados CBS/IBS e versão do contrato.

PDF, CSV, JSON e rascunhos de DARF derivam do mesmo JSON canônico. Repetir as mesmas entradas reproduz conteúdo, bytes e hash. Os rascunhos não contêm código de barras, linha digitável, autenticação ou aparência que os confunda com documento oficial.

## 10. Autorização, isolamento e auditoria

Apurações, componentes, documentos, declarações, evidências, regras, revisões, artefatos e auditoria possuem `tenant_id` e `empresa_id`, índices e RLS. Carteira ativa é validada em todo comando e download.

Storage é privado e URL assinada tem validade curta. Auditoria append-only registra criação, edição, declaração, anexo, cálculo, revisão, devolução, rejeição, aprovação, exportação, download, invalidação, superação e tentativa negada. Logs e métricas não carregam XML integral, anexo, CPF/CNPJ completo ou memória fiscal sensível.

## 11. Contrato de interface

A F37 evolui `Fiscal -> Apuração Fiscal` com:

1. seleção de empresa e competência de 2026;
2. identificação do Lucro Presumido e do critério anual de receita;
3. reconciliação de documentos, eventos, receitas e recebimentos;
4. declaração complementar com justificativa e anexo;
5. segregação por tratamento de PIS/Pasep e Cofins;
6. painel específico da transição CBS/IBS de 2026;
7. memória de cálculo e lacunas acionáveis;
8. revisão e aprovação humana explícita;
9. exportação de PDF, CSV, JSON e rascunhos separados quando elegível;
10. histórico de revisões e diferenciação inequívoca entre rascunho local e DARF oficial.

Estados obrigatórios: vazio, carregando, sem documentos, opção anual ausente, reconciliação divergente, declaração incompleta, evidência ausente, tratamento não coberto, transição CBS/IBS incompleta, regra ausente, regra conflitante, indeterminado, pronto para revisão, aprovado, rejeitado, exportando, exportado, possivelmente desatualizado, superado, falha recuperável e falha terminal. Estado nunca depende apenas de cor.

A referência de conteúdo e fluxo é `docs/telas/contaia_apura_o_fiscal_tribut_ria_reforma_ibs_cbs_rf_03/`. Não copiar KPIs fictícios, transmissão, guias oficiais, escrituração ou cobertura fora da fatia. Aparência e comportamento obedecem `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md`.

A implementação usa `frontend-design` antes e durante a construção e `impeccable` no acabamento. A PR prova comparação com o protótipo, CLARO/ESCURO, 768/1024/1440 px, teclado, foco, contraste, leitor de tela e redução de movimento conforme `FRONTEND.md` §20.1.

## 12. Invariantes globais tocados

| Código | Aplicação nesta fatia |
|---|---|
| `I-1` | toda tabela transacional possui tenant, empresa, índices e RLS |
| `I-2` | operação sem contexto e carteira válidos não retorna dados nem executa comando |
| `I-3` | dinheiro usa centavos e taxa usa decimal escalado; nenhum float monetário |
| `I-4` | cálculo deriva exclusivamente de regras aprovadas; LLM não calcula nem escolhe tratamento |
| `I-5` | aprovação humana nunca transmite declaração, emite DARF ou paga tributo |
| `I-6` | declarações, evidências, revisões, aprovações e auditoria são append-only |
| `I-7` | revisão superada permanece consultável com motivo e substituta |
| `I-8` | resultado deriva da regra vigente na competência, nunca da data de processamento |
| `I-9` | exportação e reprodução são idempotentes; não há efeito externo nesta fatia |
| `I-11` | competência, recebimento e vencimento são datas civis; instantes são UTC |
| `I-12` | mesma entrada reproduz valores, artefatos e hash |

## 13. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Regras | regime cumulativo, bases, alíquotas versionadas, exclusões, cancelamentos, devoluções e arredondamento |
| Reconhecimento | caixa e competência; opção anual ausente, conflitante ou alterada bloqueia a revisão |
| Tratamentos | normal, especial coberto e especial não coberto sem fallback |
| Transição 2026 | dispensa, recolhimento e compensação comprovados; falta de prova retorna `INDETERMINATE` |
| Reconciliação | NF-e/NFC-e, eventos, duplicidade, receita/recebimento complementar e anexo |
| Aprovação | auxiliar não aprova; contador/admin aprova manualmente; sistema nunca autoaprova |
| Banco | RLS, carteira, idempotência, append-only, revisão, superação e storage privado |
| Exportação | PDF, CSV, JSON e rascunhos coincidem em entradas, componentes, totais, versões e hash |
| Contrafactuais | nenhuma transmissão, escrituração, DARF oficial, pagamento, estimativa ou compensação sem prova |
| Tela | CLARO/ESCURO, 768/1024/1440, estados, teclado, foco, contraste, leitor de tela e movimento reduzido |
| E2E | documentos/declaracão -> reconciliação -> cálculo -> aprovação -> exportação -> mudança -> nova revisão |

Fixtures oficiais ou sintéticas rastreáveis cobrem caixa e competência, tratamento normal e especial, cancelamento, devolução, divergência documental, CBS/IBS dispensada/recolhida/não comprovada, regra aplicável/ausente e revisão superada. Integração oficial é `not_run`, nunca `pass`.

## 14. Critérios de aceite

- [ ] Somente empresa elegível no Lucro Presumido e no comércio de autopeças entra na apuração.
- [ ] A competência pertence a 2026 e usa a opção anual comprovada por caixa ou competência.
- [ ] NF-e, NFC-e, eventos e declarações são reconciliados sem duplicidade ou omissão silenciosa.
- [ ] PIS/Pasep e Cofins são calculados separadamente por tratamento coberto e regra versionada.
- [ ] Tratamento especial sem cobertura oficial retorna `INDETERMINATE`, sem aplicar alíquota padrão.
- [ ] CBS/IBS de 2026 só altera o resultado com obrigação, recolhimento e elegibilidade comprovados.
- [ ] Ausência, conflito ou cobertura parcial nunca produz valor apresentado como tributo devido.
- [ ] Contador/admin pode preparar e aprovar manualmente; nenhuma aprovação é automática.
- [ ] Mudança posterior gera nova revisão e preserva integralmente a anterior.
- [ ] PDF, CSV, JSON e rascunhos derivam do mesmo conteúdo canônico e reproduzem o mesmo hash.
- [ ] Rascunhos de PIS e Cofins permanecem separados e não contêm elemento pagável ou oficial.
- [ ] Nenhuma ação transmite, escritura, emite, paga, baixa, parcela ou compensa financeiramente.
- [ ] RLS, carteira, storage privado e auditoria impedem vazamento, mutação destrutiva e duplicidade.
- [ ] Testes de regras, banco, tela e E2E publicam evidência vinculada à SPEC-037 e à issue #43.
- [ ] Interface final prova ambos os temas, responsividade, estados e acessibilidade exigidos.

## 15. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| IRPJ e CSLL do Lucro Presumido | fatia própria de apuração federal no MVP-2 |
| Lucro Real e regime não cumulativo de PIS/Cofins | fatias próprias de expansão tributária no MVP-2 |
| Tratamentos especiais não cobertos pelo pacote inicial | fatias próprias de expansão por produto/operação no MVP-2 |
| EFD-Contribuições, DCTF e demais declarações | fatias próprias de escrituração/obrigação no MVP-2 |
| Emissão oficial e transmissão de DARF | fatia própria de integração federal no MVP-2 |
| Pagamento, baixa, parcelamento e conciliação | capacidades financeiras próprias do MVP-2 |
| CBS a partir de 2027 e transição completa do consumo | fatias próprias de IBS/CBS no MVP-2 e complemento no MVP-4 |
| Outras atividades, regimes, períodos e documentos | fatias próprias de expansão tributária do MVP-2 |
| Produção e piloto real | gate posterior ao MVP-4 |

Nenhum complemento foi descartado.

## 16. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Capacidade | apuração federal |
| Tributos | PIS/Pasep e Cofins mensais |
| Regime/atividade | Lucro Presumido para comércio de autopeças |
| Período | todas as competências de 2026 |
| Receita | caixa ou competência conforme opção anual comprovada |
| Entradas | documentos fiscais mais declaração justificada com anexo |
| Tratamentos especiais | calcular apenas cobertura oficial aprovada; lacuna bloqueia |
| Transição | integrar compensação CBS/IBS de 2026 somente com prova suficiente |
| Saída | apuração, aprovação, PDF/CSV/JSON e rascunhos separados de DARF |
| Efeito externo | nenhum |

**Questões abertas:** nenhuma.

### 16.1 Régua de tamanho

**Classificação aprovada:** Grande, com alvo de até aproximadamente dois dias de implementação.

O plano técnico deve medir o trabalho antes de codificar. Se não for possível manter o limite reutilizando contratos das F16, F18, F30, F32 e F36, a implementação não começa: volta ao PI para dividir a fatia em novas SPECs, preservando PIS/Pasep, Cofins e a transição de 2026 sem sufixos.

## 17. Gate dos oito itens obrigatórios

| Verificação | Evidência nesta SPEC |
|---|---|
| Identidade | cabeçalho, MVP-2, F37/SPEC-037 e issue #43 |
| Comportamento | §§3–10, observável por reconciliação, cálculo, aprovação, exportação e revisão |
| Aceite | §14, ligado às provas do §13 |
| Invariantes | §12, com aplicação concreta dos códigos globais |
| Fora de escopo | §15, com destino explícito |
| Dúvidas | §16; nenhuma aberta |
| Complementos | §15; nenhum requisito descartado |
| UI | §11, com caminho, estados, temas, viewports e provas |

## 18. Referências oficiais datadas

- Lei nº 9.718/1998, texto compilado, consultado em 20/09/2026: <https://www.planalto.gov.br/ccivil_03/leis/l9718compilada.htm>;
- Receita Federal, PIS/Pasep e Cofins, consultado em 20/09/2026: <https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/pis-pasep-cofins>;
- Receita Federal, EFD-Contribuições, atualizado em 29/07/2026 e consultado em 20/09/2026: <https://www.gov.br/pt-br/servicos/entregar-escrituracao-fiscal-digital-da-contribuicao-para-o-pis-pasep-e-da-cofins-efd-contribuicoes>;
- Receita Federal, Entenda a Reforma Tributária do Consumo, atualizado em 03/07/2026 e consultado em 20/09/2026: <https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/entenda>;
- Receita Federal, Orientações da Reforma Tributária para 2026, atualizado em 06/05/2026 e consultado em 20/09/2026: <https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-2026>;
- Lei Complementar nº 214/2025, texto compilado, consultado em 20/09/2026: <https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214compilado.htm>;
- Receita Federal, Códigos de Receita, consultado em 20/09/2026: <https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/pagamentos-e-parcelamentos/codigos-de-receita>.

## 19. Aprovação

Capacidade, tributos, regime, atividade, período, critério de receita, entradas, tratamentos, transição CBS/IBS, saídas, limites e destinos aprovados pelo PI em 20/09/2026. A implementação deve seguir esta SPEC sem presumir dado, regra, cobertura, dispensa ou compensação e sem apresentar rascunho local como DARF oficial.
