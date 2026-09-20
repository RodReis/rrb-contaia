# SPEC-038 / F38 — Apuração trimestral de IRPJ e CSLL para autopeças no Lucro Presumido

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Issue:** #44
> **Estado:** aprovada pelo PI em 20/09/2026
> **Origem:** PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16; F18/SPEC-018, F30/SPEC-030, F32/SPEC-032, F36/SPEC-036 e F37/SPEC-037

## 1. Objetivo

Apurar trimestralmente IRPJ e CSLL no Lucro Presumido para empresas que comercializam autopeças, nos quatro trimestres de 2026. A fatia reconcilia receitas, ganhos, ajustes, retenções e antecipações comprovadas, aplica regras oficiais versionadas com suas vigências próprias e produz memória, aprovação humana, plano de quotas e rascunhos locais separados.

O resultado é interno e preparatório. Não transmite declaração, não escritura ECF, não emite DARF oficial, não paga tributo e não executa compensação.

## 2. Recorte obrigatório

- empresa autorizada do tenant ativo, no Lucro Presumido durante todo o trimestre;
- atividade de comércio de autopeças, sem presumir tratamento apenas por CNAE ou descrição livre;
- trimestres civis `2026-Q1`, `2026-Q2`, `2026-Q3` e `2026-Q4`;
- IRPJ, adicional de IRPJ e CSLL apurados separadamente;
- reconhecimento por competência ou caixa conforme opção anual válida e comprovada da empresa;
- NF-e modelo 55 e NFC-e modelo 65 autorizadas, normalizadas e não superadas;
- cancelamentos e devoluções normalizados disponíveis no corte da revisão;
- receitas financeiras, ganhos de capital e demais adições somente com origem, valor, data, natureza, evidência e regra oficial compatível;
- receitas ou recebimentos ausentes dos documentos fiscais somente por declaração justificada e anexo comprobatório;
- retenções e antecipações somente quando documento, período, tributo e elegibilidade estiverem comprovados;
- percentuais de presunção, limites, alíquotas, adicional, deduções e vencimentos definidos pelo pacote normativo vigente em cada trimestre de 2026.

Mudança do critério de caixa/competência dentro do ano, regime misto, Lucro Real, atividade não coberta, receita sem natureza comprovada ou pacote incompleto retorna `INDETERMINATE`.

## 3. Entrega e limites

Entrega:

- seleção de empresa e trimestre de 2026;
- comprovação do Lucro Presumido e do critério anual de reconhecimento da receita;
- consolidação de NF-e, NFC-e, eventos, cancelamentos, devoluções e declarações complementares;
- segregação das receitas por atividade e natureza tributária comprovadas;
- inclusão documentada de receitas financeiras, ganhos de capital e demais adições alcançadas;
- cálculo determinístico e independente de IRPJ, adicional de IRPJ e CSLL;
- dedução de retenções e antecipações comprovadas, sem saldo presumido;
- memória causal até documento, declaração, evidência, regra, fórmula e arredondamento;
- preparação por usuário autorizado e aprovação humana por `contador` ou `admin_escritorio`;
- opção entre quota única e até três quotas quando a regra oficial permitir;
- vencimentos preliminares, acréscimos de quota cobertos e rascunhos locais separados, inequivocamente não oficiais;
- exportação coerente em PDF, CSV e JSON canônico com hash reproduzível;
- nova revisão imutável quando entrada, evidência ou regra mudar;
- interface final em `Fiscal -> Apuração Fiscal`, nos temas CLARO e ESCURO;
- auditoria append-only de ações e tentativas negadas.

Não entrega:

- Lucro Real, Lucro Arbitrado, Simples Nacional ou outra atividade;
- ECF, DCTF, DCTFWeb, PER/DCOMP ou outra escrituração/declaração;
- transmissão, autenticação, emissão ou consulta de DARF oficial;
- compensação, restituição, pagamento, baixa, parcelamento externo ou conciliação bancária;
- inferência de receita, ganho, percentual, dedução ou retenção sem cobertura oficial e prova suficiente;
- períodos fora de 2026, piloto real ou produção.

## 4. Pacotes normativos

### 4.1 IRPJ e CSLL

O pacote aprovado registra, no mínimo:

- versão, vigência, data de consulta, fontes oficiais e hashes;
- condições de opção e permanência no Lucro Presumido;
- percentuais de presunção por tributo, atividade, natureza e faixa de receita;
- alterações aplicáveis em 2026, com vigências independentes para IRPJ e CSLL;
- composição da receita bruta, exclusões, devoluções, vendas canceladas e descontos incondicionais;
- tratamento de receitas financeiras, ganhos de capital e demais adições;
- alíquota do IRPJ, limite e alíquota do adicional e alíquota da CSLL;
- retenções e antecipações dedutíveis, seus limites e períodos de atribuição;
- códigos de receita alcançados, sem constantes legais dispersas no código;
- vencimento, quota única, quantidade máxima de quotas, valor mínimo, acréscimos e ajuste para dia não útil;
- evidências exigidas para cada natureza, ajuste e dedução.

Regra ou natureza não coberta nunca recebe percentual padrão. O trimestre fica `INDETERMINATE`, ainda que seja possível exibir componentes conhecidos.

### 4.2 Governança

- somente pacote importado e aprovado por `contador` ou `admin_escritorio` calcula;
- alteração normativa cria versão nova e preserva resultados anteriores;
- pacote conflitante, parcialmente aplicável ou sem fonte oficial bloqueia a revisão;
- regra de IRPJ não é reutilizada para CSLL sem cobertura explícita, e vice-versa;
- LLM pode explicar saída estruturada, mas não escolhe regra, percentual, natureza, dedução, quota ou vencimento.

## 5. Entradas e reconciliação

Entradas obrigatórias:

- empresa, regime vigente, atividade, trimestre e opção anual por caixa ou competência;
- documentos normalizados, itens, eventos, cancelamentos e devoluções;
- pacote normativo aprovado compatível com empresa, atividade e trimestre;
- corte documental e autoria da revisão;
- declarações complementares justificadas e anexadas;
- evidências de receitas financeiras, ganhos, adições, retenções e antecipações declaradas.

No critério de competência, receitas são reconhecidas conforme fato e documento cobertos. No critério de caixa, cada recebimento precisa de data civil, valor, origem e vínculo com documento ou declaração. A falta do módulo financeiro é suprida somente por declaração comprovada, nunca por estimativa.

Declaração complementar é append-only. Correção cria nova declaração, supera a anterior e torna a revisão aprovada `POSSIBLY_OUTDATED`.

## 6. Cálculo e indeterminação

O motor calcula separadamente:

1. receitas reconciliadas por mês, atividade e natureza;
2. exclusões e ajustes cobertos;
3. bases presumidas de IRPJ e CSLL por componente e vigência;
4. adições diretas às bases, quando cobertas;
5. IRPJ normal;
6. adicional de IRPJ sobre o limite proporcional aplicável;
7. CSLL;
8. retenções e antecipações comprovadas por tributo;
9. saldos preliminares de IRPJ e CSLL;
10. quota única ou plano de até três quotas, vencimentos e acréscimos cobertos.

Dinheiro usa centavos inteiros. Taxas e percentuais usam decimal escalado. Cada componente expõe regra, versão, fonte, entradas, fórmula, arredondamento e resultado.

Ausência, inconsistência, duplicidade, conflito ou cobertura parcial produz `INDETERMINATE`, com códigos de lacuna e ações necessárias. É proibido:

- completar receita por média, estimativa ou período anterior;
- usar percentual, limite, alíquota ou vencimento mais recente como fallback;
- considerar documento ausente como receita zero;
- classificar receita financeira, ganho ou adição apenas pela descrição livre;
- apresentar resultado parcial como tributo devido;
- deduzir retenção ou antecipação sem prova e vínculo ao tributo correto;
- compensar saldo fiscal ou crédito externo nesta fatia;
- misturar IRPJ e CSLL em valor único sem memória individual.

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
type CorporateTaxRevenueRecognition = "ACCRUAL" | "CASH";

type CorporateTaxAssessmentStatus =
  | "DRAFT"
  | "INCOMPLETE"
  | "INDETERMINATE"
  | "READY_FOR_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "POSSIBLY_OUTDATED"
  | "SUPERSEDED";

type CorporateTaxKind = "IRPJ" | "IRPJ_ADDITIONAL" | "CSLL";

type CorporateTaxComponent = {
  tax: CorporateTaxKind;
  activityCode: string;
  revenueNatureCode: string;
  grossRevenueCents: number;
  adjustmentCents: number;
  presumptionRateScaled: string | null;
  presumedBaseCents: number | null;
  directAdditionCents: number;
  taxRateScaled: string | null;
  grossTaxCents: number | null;
  ruleId: string;
  sourceIds: readonly string[];
};

type CorporateTaxDeduction = {
  tax: "IRPJ" | "CSLL";
  kind: "WITHHOLDING" | "ADVANCE_PAYMENT";
  amountCents: number;
  evidenceId: string;
  ruleId: string;
};

type CorporateTaxInstallment = {
  tax: "IRPJ" | "CSLL";
  installmentNumber: number;
  principalCents: number;
  additionCents: number;
  totalCents: number;
  dueDate: string;
  draftArtifactId: string | null;
};

type CorporateTaxAssessment = {
  assessmentId: string;
  tenantId: string;
  companyId: string;
  quarter: "2026-Q1" | "2026-Q2" | "2026-Q3" | "2026-Q4";
  revenueRecognition: CorporateTaxRevenueRecognition;
  status: CorporateTaxAssessmentStatus;
  rulePackageVersion: string;
  components: readonly CorporateTaxComponent[];
  deductions: readonly CorporateTaxDeduction[];
  installments: readonly CorporateTaxInstallment[];
  irpjPayableCents: number | null;
  csllPayableCents: number | null;
  gapCodes: readonly string[];
  preparedBy: string;
  approvedBy: string | null;
  approvedAtUtc: string | null;
  contractVersion: string;
  canonicalJsonHash: string;
  revisionCreatedAtUtc: string;
};
```

Trimestre, competência e vencimento são datas civis; instantes são UTC. `revisionCreatedAtUtc` é imutável e integra o JSON canônico. O instante de download fica apenas na auditoria.

Erros seguem `application/problem+json` e distinguem, no mínimo:

- `CORPORATE_TAX_REGIME_MISMATCH`;
- `CORPORATE_TAX_QUARTER_UNSUPPORTED`;
- `CORPORATE_TAX_RECOGNITION_OPTION_MISSING`;
- `CORPORATE_TAX_RECOGNITION_OPTION_CONFLICT`;
- `CORPORATE_TAX_RULE_MISSING`;
- `CORPORATE_TAX_RULE_CONFLICT`;
- `CORPORATE_TAX_REVENUE_NATURE_UNSUPPORTED`;
- `CORPORATE_TAX_REVENUE_RECONCILIATION_FAILED`;
- `CORPORATE_TAX_EVIDENCE_REQUIRED`;
- `CORPORATE_TAX_DEDUCTION_INVALID`;
- `CORPORATE_TAX_INSTALLMENT_INVALID`;
- `CORPORATE_TAX_INDETERMINATE`;
- `CORPORATE_TAX_REVISION_CONFLICT`;
- `CORPORATE_TAX_SUPERSEDED`;
- `CORPORATE_TAX_EXPORT_HASH_MISMATCH`.

## 9. Quotas, idempotência e artefatos

A escolha entre quota única e parcelamento é explícita e pertence à revisão aprovada. O sistema oferece somente combinações permitidas pelo pacote normativo, sem converter quota local em parcelamento fiscal externo.

A chave idempotente considera tenant, empresa, trimestre, critério anual, documentos e eventos com hashes, declarações e evidências, pacote normativo, deduções, escolha de quotas e versão do contrato.

PDF, CSV, JSON e rascunhos derivam do mesmo JSON canônico. Repetir as mesmas entradas reproduz conteúdo, bytes e hash. Os rascunhos não contêm código de barras, linha digitável, autenticação ou aparência que os confunda com documento oficial.

## 10. Autorização, isolamento e auditoria

Apurações, componentes, documentos, declarações, evidências, regras, revisões, quotas, artefatos e auditoria possuem `tenant_id` e `empresa_id`, índices e RLS. Carteira ativa é validada em todo comando e download.

Storage é privado e URL assinada tem validade curta. Auditoria append-only registra criação, edição, declaração, anexo, cálculo, revisão, devolução, rejeição, aprovação, escolha de quotas, exportação, download, invalidação, superação e tentativa negada. Logs e métricas não carregam XML integral, anexo, CPF/CNPJ completo ou memória fiscal sensível.

## 11. Contrato de interface

A F38 evolui `Fiscal -> Apuração Fiscal` com:

1. seleção de empresa e trimestre de 2026;
2. identificação do Lucro Presumido e do critério anual de receita;
3. reconciliação mensal e trimestral de documentos, eventos, receitas e recebimentos;
4. declaração complementar com justificativa e anexo;
5. segregação por atividade e natureza;
6. memória separada de IRPJ, adicional e CSLL;
7. retenções e antecipações comprovadas por tributo;
8. lacunas acionáveis e comparação entre os trimestres sem transformar tendência em regra;
9. revisão e aprovação humana explícita;
10. escolha entre quota única e até três quotas quando elegível;
11. exportação de PDF, CSV, JSON e rascunhos separados;
12. histórico de revisões e diferenciação inequívoca entre rascunho local e DARF oficial.

Estados obrigatórios: vazio, carregando, sem documentos, opção anual ausente, reconciliação divergente, declaração incompleta, evidência ausente, natureza não coberta, regra ausente, regra conflitante, dedução inválida, indeterminado, pronto para revisão, aprovado, rejeitado, configurando quotas, quota inválida, exportando, exportado, possivelmente desatualizado, superado, falha recuperável e falha terminal. Estado nunca depende apenas de cor.

A referência de conteúdo e fluxo é `docs/telas/contaia_apura_o_fiscal_tribut_ria_reforma_ibs_cbs_rf_03/`. Não copiar KPIs fictícios, transmissão, guias oficiais, escrituração ou cobertura fora da fatia. Aparência e comportamento obedecem `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md`.

A implementação usa `frontend-design` antes e durante a construção e `impeccable` no acabamento. A PR prova comparação com o protótipo, CLARO/ESCURO, 768/1024/1440 px, teclado, foco, contraste, leitor de tela e redução de movimento conforme `FRONTEND.md` §20.1.

## 12. Invariantes globais tocados

| Código | Aplicação nesta fatia |
|---|---|
| `I-1` | toda tabela transacional possui tenant, empresa, índices e RLS |
| `I-2` | operação sem contexto e carteira válidos não retorna dados nem executa comando |
| `I-3` | dinheiro usa centavos e taxa usa decimal escalado; nenhum float monetário |
| `I-4` | cálculo deriva exclusivamente de regras aprovadas; LLM não calcula nem classifica receita |
| `I-5` | aprovação humana nunca transmite declaração, emite DARF ou paga tributo |
| `I-6` | declarações, evidências, revisões, aprovações e auditoria são append-only |
| `I-7` | revisão superada permanece consultável com motivo e substituta |
| `I-8` | resultado deriva da regra vigente no trimestre, nunca da data de processamento |
| `I-9` | exportação e reprodução são idempotentes; não há efeito externo nesta fatia |
| `I-11` | trimestre, competência e vencimento são datas civis; instantes são UTC |
| `I-12` | mesma entrada reproduz valores, quotas, artefatos e hash |

## 13. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Regras | quatro trimestres de 2026, vigências distintas, percentuais de presunção, alíquotas, adicional, limites e arredondamento |
| Reconhecimento | caixa e competência; opção anual ausente, conflitante ou alterada bloqueia a revisão |
| Receitas | vendas, receitas financeiras, ganhos, adições e natureza não coberta sem fallback |
| Reconciliação | NF-e/NFC-e, eventos, duplicidade, receita/recebimento complementar e anexo |
| Deduções | retenção e antecipação válidas, duplicadas, incompatíveis e sem prova |
| Quotas | quota única, duas e três quotas; limites, vencimentos, acréscimos e configuração inválida |
| Aprovação | auxiliar não aprova; contador/admin aprova manualmente; sistema nunca autoaprova |
| Banco | RLS, carteira, idempotência, append-only, revisão, superação e storage privado |
| Exportação | PDF, CSV, JSON e rascunhos coincidem em entradas, componentes, totais, versões, quotas e hash |
| Contrafactuais | nenhuma transmissão, escrituração, DARF oficial, compensação, pagamento ou estimativa |
| Tela | CLARO/ESCURO, 768/1024/1440, estados, teclado, foco, contraste, leitor de tela e movimento reduzido |
| E2E | documentos/declaração -> reconciliação -> cálculo -> aprovação -> quotas -> exportação -> mudança -> nova revisão |

Fixtures oficiais ou sintéticas rastreáveis cobrem caixa e competência, atividades e naturezas distintas, cancelamento, devolução, receita financeira, ganho de capital, retenção, antecipação, regra aplicável/ausente, adicional, quotas e revisão superada. Integração oficial é `not_run`, nunca `pass`.

## 14. Critérios de aceite

- [ ] Somente empresa elegível no Lucro Presumido e no comércio de autopeças entra na apuração.
- [ ] O trimestre pertence a 2026 e usa a opção anual comprovada por caixa ou competência.
- [ ] NF-e, NFC-e, eventos e declarações são reconciliados sem duplicidade ou omissão silenciosa.
- [ ] Receitas são segregadas por atividade e natureza com evidência rastreável.
- [ ] IRPJ, adicional e CSLL são calculados separadamente por regra e vigência próprias.
- [ ] As mudanças normativas de 2026 são aplicadas no tributo e trimestre corretos.
- [ ] Receitas financeiras, ganhos e adições sem cobertura suficiente retornam `INDETERMINATE`.
- [ ] Retenções e antecipações só reduzem o tributo correto mediante prova e elegibilidade.
- [ ] Ausência, conflito ou cobertura parcial nunca produz valor apresentado como tributo devido.
- [ ] Contador/admin pode preparar e aprovar manualmente; nenhuma aprovação é automática.
- [ ] Quota única ou até três quotas respeitam limites, vencimentos e acréscimos do pacote aprovado.
- [ ] Mudança posterior gera nova revisão e preserva integralmente a anterior.
- [ ] PDF, CSV, JSON e rascunhos derivam do mesmo conteúdo canônico e reproduzem o mesmo hash.
- [ ] Rascunhos permanecem separados por tributo e não contêm elemento pagável ou oficial.
- [ ] Nenhuma ação transmite, escritura, emite, compensa, paga, baixa ou parcela externamente.
- [ ] RLS, carteira, storage privado e auditoria impedem vazamento, mutação destrutiva e duplicidade.
- [ ] Testes de regras, banco, tela e E2E publicam evidência vinculada à SPEC-038 e à issue correspondente.
- [ ] Interface final prova ambos os temas, responsividade, estados e acessibilidade exigidos.

## 15. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Lucro Real, Lucro Arbitrado e demais atividades | fatias próprias de expansão tributária no MVP-2 |
| ECF, DCTF, DCTFWeb e demais declarações | fatias próprias de escrituração/obrigação no MVP-2 |
| Emissão oficial e transmissão de DARF | fatia própria de integração federal no MVP-2 |
| PER/DCOMP, créditos e compensações externas | fatia própria de compensação tributária no MVP-2 |
| Pagamento, baixa, parcelamento externo e conciliação | capacidades financeiras próprias do MVP-2 |
| Partidas dobradas e razão contábil | fatias próprias de contabilidade no MVP-2 |
| Períodos fora de 2026 e outras naturezas não cobertas | fatias próprias de expansão tributária do MVP-2 |
| Produção e piloto real | gate posterior ao MVP-4 |

Nenhum complemento foi descartado.

## 16. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Capacidade | apuração federal de IRPJ e CSLL |
| Regime/atividade | Lucro Presumido para comércio de autopeças |
| Período | quatro trimestres de 2026 |
| Receita | caixa ou competência conforme opção anual comprovada |
| Abrangência | vendas, receitas financeiras, ganhos e demais adições somente com prova e regra oficial |
| Deduções | retenções e antecipações comprovadas; compensações externas não entram |
| Saída | apuração, aprovação, PDF/CSV/JSON, quota única ou até três quotas e rascunhos separados |
| Efeito externo | nenhum |

**Questões abertas:** nenhuma.

### 16.1 Régua de tamanho

**Classificação aprovada:** Grande, com alvo de até aproximadamente dois dias de implementação.

O plano técnico deve medir o trabalho antes de codificar. Se não for possível manter o limite reutilizando contratos das F16, F18, F30, F32, F36 e F37, a implementação não começa: volta ao PI para dividir a fatia em novas SPECs, preservando IRPJ, CSLL e quotas sem sufixos.

## 17. Gate dos oito itens obrigatórios

| Verificação | Evidência nesta SPEC |
|---|---|
| Identidade | cabeçalho, MVP-2, F38/SPEC-038, issue #44 e origem exata |
| Comportamento | §§3–10, observável por reconciliação, cálculo, aprovação, quotas, exportação e revisão |
| Aceite | §14, ligado às provas do §13 |
| Invariantes | §12, com aplicação concreta dos códigos globais |
| Fora de escopo | §15, com destino explícito |
| Dúvidas | §16; nenhuma aberta |
| Complementos | §15; nenhum requisito descartado |
| UI | §11, com caminho, estados, temas, viewports e provas |

## 18. Referências oficiais datadas

- Receita Federal, IRPJ, consultado em 20/09/2026: <https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/IRPJ>;
- Receita Federal, CSLL, consultado em 20/09/2026: <https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/CSLL>;
- Instrução Normativa RFB nº 1.700/2017, consolidada até a IN RFB nº 2.315/2026, consultada em 20/09/2026: <https://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=81268>;
- Lei nº 9.249/1995, consultada em 20/09/2026: <https://www.planalto.gov.br/ccivil_03/leis/l9249.htm>;
- Lei nº 9.430/1996, texto compilado, consultada em 20/09/2026: <https://www.planalto.gov.br/ccivil_03/leis/l9430compilada.htm>;
- Receita Federal, Perguntas e Respostas — Redução dos Incentivos e Benefícios Tributários, versão 3, consultada em 20/09/2026: <https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/beneficios-fiscais/perguntas-e-respostas-reducao-dos-incentivos-e-beneficios-tributarios-v3-final.pdf>.

## 19. Aprovação

Capacidade, regime, atividade, período, critério de receita, abrangência, deduções, saídas, quotas, limites e destinos aprovados pelo PI em 20/09/2026. A implementação deve seguir esta SPEC sem presumir receita, regra, percentual, dedução ou vencimento e sem apresentar rascunho local como DARF oficial.
