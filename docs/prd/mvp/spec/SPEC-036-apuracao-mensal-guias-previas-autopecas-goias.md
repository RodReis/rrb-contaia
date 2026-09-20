# SPEC-036 / F36 — Apuração mensal e guias prévias para comércio de autopeças em Goiás

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Issue:** #41
> **Estado:** aprovada pelo PI em 20/09/2026
> **Origem:** PRD §§3, 5.3, 6.1, 6.2, 6.5, 12, 14, 15 e 16; F26/SPEC-026 a F32/SPEC-032

## 1. Objetivo

Apurar competências correntes do comércio de autopeças em Goiás em duas trilhas independentes: DAS completo do Anexo I para empresa optante pelo Simples Nacional e ICMS próprio mensal para empresa no Lucro Presumido. Cada trilha produz memória determinística, revisão humana e rascunho local de guia, sem transmissão ou efeito externo.

A fatia reduz a distância entre documentos fiscais normalizados e a revisão mensal do contador. Ela não declara o débito perante o PGDAS-D ou a Secretaria da Economia de Goiás, não emite documento oficial e não substitui EFD, escrituração ou sistema governamental.

## 2. Recorte obrigatório

- empresas autorizadas do tenant ativo, com estabelecimento e inscrição estadual em Goiás;
- atividade de comércio de autopeças adquiridas para revenda;
- competências a partir de setembro de 2026, alcançadas por pacote normativo aprovado e vigente, sem apuração retroativa anterior;
- documentos NF-e modelo 55 e NFC-e modelo 65 autorizados, normalizados e não superados;
- cancelamentos e devoluções normalizados disponíveis até o fechamento;
- regimes `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO`, processados em trilhas incompatíveis entre si;
- Simples Nacional limitado ao comércio do Anexo I, com cálculo completo do rascunho de DAS;
- Lucro Presumido limitado à apuração mensal do ICMS próprio e ao rascunho de DARE;
- dados complementares declarados, justificados e acompanhados de anexo comprobatório.

O enquadramento tributário, a opção pelo Simples Nacional, a atividade efetiva e a cobertura da regra precisam estar provados para a competência. CNAE isolado, descrição do produto, regra mais recente ou regime cadastrado sem vigência não bastam.

## 3. Entrega e limites

Entrega:

- seleção de empresa, competência e trilha compatível com o regime vigente;
- consolidação de NF-e 55, NFC-e 65, eventos e declarações complementares;
- pré-preenchimento, conferência de lacunas e bloqueio de duplicidades;
- cálculo determinístico por pacote normativo oficial, versionado e aprovado;
- memória causal até documento, declaração, evidência, regra, fórmula e arredondamento;
- preparação, revisão e aprovação humana pelo contador ou `admin_escritorio` autorizado;
- autoaprovação humana permitida: o mesmo contador pode preparar e aprovar, mas o sistema nunca aprova automaticamente;
- rascunhos locais de DAS e DARE, sempre identificados como não oficiais e não pagáveis;
- exportação PDF, CSV e JSON coerente, com JSON canônico e hash reproduzível;
- nova revisão imutável quando documento, declaração, evidência ou regra mudar;
- interface final em `Fiscal -> Apuração Fiscal`, nos temas CLARO e ESCURO;
- auditoria append-only de ações e tentativas negadas.

Não entrega:

- transmissão ao PGDAS-D, PGDAS-A, Sefaz, EFD ou outro serviço oficial;
- emissão, consulta, autenticação, código de barras, linha digitável ou validade oficial de DAS/DARE;
- pagamento, autorização bancária, baixa, parcelamento, compensação ou cobrança;
- escrituração, livro fiscal, SPED, ECD, retificação ou lançamento contábil;
- PIS, Cofins, IRPJ ou CSLL do Lucro Presumido fora da composição do DAS da trilha Simples;
- ICMS-ST, DIFAL, antecipação ou outro recolhimento estadual fora do ICMS próprio da trilha Lucro Presumido;
- indústria, serviço, Lucro Real, MEI, outra atividade, UF ou documento fiscal;
- produção ou piloto real.

## 4. Fontes e pacotes normativos

### 4.1 Pacote do Simples Nacional

O pacote aprovado registra, no mínimo:

- versão, vigência, data de consulta, fontes oficiais e hashes;
- faixas, alíquotas nominais, parcelas a deduzir e repartição do Anexo I;
- fórmula da alíquota efetiva e regras de RBT12, início de atividade e sublimite quando aplicável;
- segregações de receita alcançadas, inclusive substituição tributária, tributação monofásica, antecipação com encerramento, exportação e demais hipóteses oficialmente cobertas;
- tributos integrantes do DAS e parcelas excluídas em cada segregação;
- vencimento, arredondamento e regras de indisponibilidade ou lacuna.

O sistema calcula um rascunho completo do DAS somente quando todas as receitas da competência e os 12 meses necessários estiverem cobertos. Falta de histórico, segregação, opção válida ou regra aplicável retorna `INDETERMINATE`.

### 4.2 Pacote de ICMS próprio de Goiás

O pacote aprovado registra, no mínimo:

- versão, vigência, data de consulta, fontes oficiais e hashes;
- operações e CFOPs cobertos, base, alíquota, débito, crédito e estorno;
- saldo credor anterior, ajustes permitidos e evidências exigidas;
- regras de fechamento, vencimento e código de receita alcançado;
- fórmula e arredondamento de cada componente.

Benefício fiscal, crédito presumido, redução, diferimento, incentivo ou ajuste não coberto pelo pacote aprovado retorna `INDETERMINATE`; nunca é presumido como zero nem aplicado por aproximação.

### 4.3 Governança das regras

- somente pacote importado e aprovado por `contador` ou `admin_escritorio` pode calcular;
- alteração normativa cria versão nova e não modifica resultado anterior;
- pacote conflitante, parcialmente aplicável ou sem fonte oficial bloqueia a trilha;
- LLM pode explicar conteúdo já estruturado, mas não escolhe regra, segregação, crédito, alíquota ou valor.

## 5. Entradas e declarações complementares

### 5.1 Entradas comuns

- empresa, regime vigente e competência `YYYY-MM`;
- documentos normalizados, itens, eventos, cancelamentos e devoluções;
- pacote normativo aprovado compatível com empresa, regime, atividade e competência;
- data e autoria do corte documental usado na revisão.

### 5.2 Simples Nacional

- RBT12 detalhada por mês, mercado interno e externo;
- receita da competência reconciliada com NF-e/NFC-e;
- receita não representada pelos documentos disponíveis, com justificativa e anexo;
- segregação por natureza tributária, com origem e evidência;
- situação da opção, início de atividade e sublimite aplicável.

### 5.3 Lucro Presumido

- débitos e créditos documentais cobertos;
- saldo credor anterior proveniente de revisão aprovada;
- ajustes, estornos e valores não documentais, sempre declarados com justificativa e anexo;
- evidência de que operações excluídas foram tratadas em trilha própria ou permanecem bloqueadas.

Declaração complementar é append-only. Correção gera nova declaração que supera a anterior e obriga nova revisão da competência.

## 6. Cálculo e indeterminação

### 6.1 DAS completo do Anexo I

A trilha calcula RBT12, faixa, alíquota efetiva, base por segregação, valor por tributo e total do rascunho de DAS. O total inclui todos os tributos aplicáveis ao Anexo I no recorte, não apenas ICMS.

Cada parcela expõe entradas, fórmula, regra, versão e resultado em centavos. Receita sujeita a tratamento não coberto bloqueia o total; o sistema pode exibir componentes conhecidos, mas não apresenta total parcial como DAS devido.

### 6.2 ICMS próprio e rascunho de DARE

A trilha calcula débitos, créditos, estornos, ajustes cobertos, saldo anterior, saldo transportável e ICMS próprio a recolher. Resultado credor não gera rascunho pagável; permanece como saldo para revisão posterior.

ICMS-ST, DIFAL, antecipação e componentes não cobertos permanecem separados e não são compensados silenciosamente com o ICMS próprio.

### 6.3 Resultado indeterminado

Ausência, inconsistência, duplicidade, conflito ou cobertura parcial produz `INDETERMINATE`, com códigos de lacuna e ações necessárias. É proibido:

- completar dado por média, estimativa ou valor histórico;
- usar alíquota padrão ou regra mais recente por fallback;
- tratar documento ausente como receita zero;
- transformar valor parcial em guia pronta;
- compensar saldo entre as duas trilhas.

## 7. Preparação, aprovação e fechamento

- `auxiliar` autorizado prepara, declara dados e anexa evidências, mas não aprova;
- `contador` e `admin_escritorio` com carteira ativa preparam, revisam, devolvem, rejeitam e aprovam;
- `auditor_readonly` consulta fontes, revisões, artefatos e auditoria;
- demais papéis são negados por padrão;
- o mesmo contador ou admin pode preparar e aprovar manualmente a revisão;
- aprovação exige justificativa, confirmação das declarações e aceite explícito de que a guia é rascunho;
- nenhuma aprovação é automática, otimista ou inferida por ausência de interação;
- trilha `INDETERMINATE` não pode ser aprovada nem exportada como guia pronta.

Estados da revisão:

- `DRAFT`, `INCOMPLETE`, `INDETERMINATE`, `READY_FOR_REVIEW`, `APPROVED`, `REJECTED`, `POSSIBLY_OUTDATED` e `SUPERSEDED`.

## 8. Contrato de resultado

```ts
type MonthlyAssessmentKind =
  | "SIMPLES_NACIONAL_DAS"
  | "LUCRO_PRESUMIDO_ICMS_DARE";

type MonthlyAssessmentStatus =
  | "DRAFT"
  | "INCOMPLETE"
  | "INDETERMINATE"
  | "READY_FOR_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "POSSIBLY_OUTDATED"
  | "SUPERSEDED";

type TaxAmountComponent = {
  code: string;
  baseCents: number;
  rateScaled: string | null;
  amountCents: number | null;
  ruleId: string;
  sourceIds: readonly string[];
};

type MonthlyTaxAssessment = {
  assessmentId: string;
  tenantId: string;
  companyId: string;
  competence: string;
  kind: MonthlyAssessmentKind;
  status: MonthlyAssessmentStatus;
  rulePackageVersion: string;
  components: readonly TaxAmountComponent[];
  totalCents: number | null;
  gapCodes: readonly string[];
  preparedBy: string;
  approvedBy: string | null;
  approvedAtUtc: string | null;
  contractVersion: string;
  canonicalJsonHash: string;
  revisionCreatedAtUtc: string;
};
```

Dinheiro usa centavos inteiros. Taxas são decimais escalados, nunca `number` binário usado diretamente no cálculo. Competência é data civil mensal; instantes são UTC.

`revisionCreatedAtUtc` é fixado uma única vez na criação da revisão e integra o JSON canônico. O instante operacional de cada download fica somente na auditoria, fora dos arquivos exportados, do payload canônico e do hash; por isso, reexportar a mesma revisão reproduz conteúdo, bytes e `canonicalJsonHash`.

Erros seguem `application/problem+json` e distinguem, no mínimo:

- `MONTHLY_ASSESSMENT_REGIME_MISMATCH`;
- `MONTHLY_ASSESSMENT_RULE_MISSING`;
- `MONTHLY_ASSESSMENT_RULE_CONFLICT`;
- `MONTHLY_ASSESSMENT_DOCUMENT_GAP`;
- `MONTHLY_ASSESSMENT_DUPLICATE_DOCUMENT`;
- `MONTHLY_ASSESSMENT_EVIDENCE_REQUIRED`;
- `MONTHLY_ASSESSMENT_RBT12_INCOMPLETE`;
- `MONTHLY_ASSESSMENT_REVENUE_RECONCILIATION_FAILED`;
- `MONTHLY_ASSESSMENT_INDETERMINATE`;
- `MONTHLY_ASSESSMENT_REVISION_CONFLICT`;
- `MONTHLY_ASSESSMENT_SUPERSEDED`;
- `MONTHLY_ASSESSMENT_EXPORT_HASH_MISMATCH`.

## 9. Idempotência, revisão e artefatos

A chave idempotente considera tenant, empresa, competência, trilha, documentos e eventos com hashes, declarações e evidências, pacote normativo, saldo anterior e versão do contrato.

Repetir as mesmas entradas reproduz JSON e hash. Alteração relevante marca a revisão aprovada como `POSSIBLY_OUTDATED`; novo cálculo cria revisão imutável e, quando aprovada, supera a anterior. Nenhum histórico é sobrescrito.

PDF, CSV e JSON incluem:

- empresa, regime, atividade, competência e corte documental;
- reconciliação de documentos, receitas, declarações e evidências;
- memória por componente, regra, fórmula, versão e fonte;
- lacunas, bloqueios, justificativa, preparador e aprovador;
- total, vencimento preliminar e identificação do rascunho;
- contrato, criação imutável da revisão e hash canônico.

PDF e CSV derivam deterministicamente do mesmo JSON canônico e usam `revisionCreatedAtUtc` como o único instante exibido. O momento de download aparece somente na auditoria. O rascunho não contém código de barras, linha digitável, autenticação ou aparência que o confunda com documento oficial.

## 10. Autorização, isolamento e auditoria

Apurações, componentes, documentos vinculados, declarações, evidências, regras, revisões, artefatos e auditoria possuem `tenant_id` e `empresa_id`, índices e RLS. Carteira ativa é validada em todo comando e download.

O `super-admin` global não lê dados fiscais por esse papel. Storage é privado e URL assinada tem validade curta.

Auditoria append-only registra criação, edição, declaração, anexação, cálculo, revisão, devolução, rejeição, aprovação, exportação, download, reprodução, invalidação, superação e tentativa negada. Logs e métricas não carregam XML integral, anexo, CPF/CNPJ completo ou memória fiscal sensível.

## 11. Contrato de interface

A F36 evolui `Fiscal -> Apuração Fiscal` com:

1. seleção de empresa e competência;
2. identificação clara do regime e da trilha aplicável;
3. reconciliação de NF-e/NFC-e, eventos e receitas;
4. formulário de declaração complementar com justificativa e anexo;
5. memória de cálculo por componente e fundamento;
6. painel de lacunas e resultado `INDETERMINATE` acionável;
7. revisão e aprovação humana explícita;
8. exportação de PDF, CSV e JSON apenas quando elegível;
9. histórico de revisões, mudanças e artefatos;
10. diferenciação inequívoca entre rascunho local e guia oficial.

Estados obrigatórios: vazio, carregando, sem documentos, reconciliação divergente, declaração incompleta, evidência ausente, regra ausente, regra conflitante, indeterminado, pronto para revisão, aprovado, rejeitado, exportando, exportado, possivelmente desatualizado, superado, falha recuperável e falha terminal. Estado nunca depende apenas de cor.

A referência de conteúdo e fluxo é `docs/telas/contaia_apura_o_fiscal_tribut_ria_reforma_ibs_cbs_rf_03/`, sem copiar KPIs fictícios, transmissão PGDAS, guias oficiais, partidas dobradas ou cobertura tributária fora desta fatia. Aparência e comportamento obedecem `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md`.

A implementação usa `frontend-design` antes e durante a construção e `impeccable` no acabamento. A PR prova comparação com o protótipo, CLARO/ESCURO, 768/1024/1440 px, teclado, foco, contraste, leitor de tela e redução de movimento conforme `FRONTEND.md` §20.1.

## 12. Invariantes globais tocados

| Código | Aplicação nesta fatia |
|---|---|
| `I-1` | todas as tabelas transacionais possuem tenant, empresa, índices e RLS |
| `I-2` | operação sem contexto e carteira válidos não retorna dados nem executa comando |
| `I-3` | dinheiro usa centavos e taxa usa decimal escalado; nenhum float monetário |
| `I-4` | cálculo deriva exclusivamente de regras aprovadas; LLM não calcula nem escolhe tratamento |
| `I-5` | aprovação humana nunca transmite, emite ou paga guia |
| `I-6` | declarações, revisões, aprovações e auditoria são append-only |
| `I-7` | revisão superada permanece consultável com motivo e substituta |
| `I-8` | resultado deriva da regra vigente na competência, nunca da data de processamento |
| `I-9` | mesma entrada reproduz resultado, artefatos e hash |
| `I-10` | as duas trilhas não misturam nem compensam saldos |
| `I-11` | competência e vencimento são datas civis; instantes são UTC |
| `I-12` | artefatos derivam do JSON canônico e explicitam que são rascunhos locais |

## 13. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Regras Simples | RBT12, seis faixas, alíquota efetiva, início de atividade, sublimite, segregações, repartição e total do DAS |
| Regras ICMS | débitos, créditos, estornos, ajustes, saldo credor anterior, saldo devedor e ausência de compensação externa |
| Indeterminação | regra, documento, histórico, receita, segregação ou evidência ausente bloqueia aprovação |
| Reconciliação | NF-e/NFC-e, cancelamento, devolução, duplicidade e declaração complementar com anexo |
| Aprovação | auxiliar não aprova; contador/admin pode preparar e aprovar manualmente; sistema nunca autoaprova |
| Banco | RLS, carteira, idempotência, append-only, revisão, superação e storage privado |
| Exportação | PDF, CSV e JSON coincidem em entradas, componentes, total, versões e hash |
| Contrafactuais | nenhuma transmissão, guia oficial, pagamento, escrituração, estimativa ou mistura de trilhas |
| Tela | CLARO/ESCURO, 768/1024/1440, estados, teclado, foco, contraste, leitor de tela e movimento reduzido |
| E2E | documentos -> reconciliação -> declaração/evidência -> cálculo -> aprovação -> exportação -> mudança -> nova revisão |

Fixtures oficiais ou sintéticas rastreáveis cobrem ambos os regimes, faixas do Anexo I, segregações suportadas, saldo credor/devedor, regra aplicável e ausente, divergência documental, autoaprovação humana e revisão superada. Integração oficial é `not_run`, nunca `pass`.

## 14. Critérios de aceite

- [ ] Regime e atividade vigentes selecionam exatamente uma trilha; incompatibilidade bloqueia o cálculo.
- [ ] Simples Nacional calcula rascunho completo do DAS do Anexo I, discriminado por tributo e segregação.
- [ ] Lucro Presumido calcula somente ICMS próprio e rascunho local de DARE.
- [ ] NF-e 55, NFC-e 65, cancelamentos e devoluções não são duplicados nem ignorados silenciosamente.
- [ ] RBT12, receitas ausentes, segregações e ajustes exigem origem; dado complementar exige justificativa e anexo.
- [ ] Ausência, conflito ou cobertura parcial retorna `INDETERMINATE`, sem estimativa ou alíquota padrão.
- [ ] As trilhas nunca misturam ou compensam saldos.
- [ ] Contador/admin pode preparar e aprovar manualmente; nenhuma aprovação é automática.
- [ ] Mudança posterior gera nova revisão e preserva integralmente a anterior.
- [ ] PDF, CSV e JSON derivam do mesmo conteúdo canônico e reproduzem o mesmo hash.
- [ ] Rascunhos não contêm elemento pagável nem se apresentam como guia oficial.
- [ ] Nenhuma ação transmite, escritura, paga, baixa, parcela ou registra efeito externo.
- [ ] RLS, carteira, storage privado e auditoria impedem vazamento, mutação destrutiva e duplicidade.
- [ ] Testes de regras, banco, tela e E2E publicam evidência vinculada à SPEC-036 e à issue #41.
- [ ] Interface final prova ambos os temas, responsividade, estados e acessibilidade exigidos.

## 15. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Transmissão PGDAS-D/PGDAS-A e emissão oficial de DAS | fatia própria de integração do Simples Nacional no MVP-2 |
| EFD, emissão oficial de DARE e escrituração de ICMS | fatias próprias de escrituração e integração estadual no MVP-2 |
| Pagamento, baixa, parcelamento e conciliação | capacidades financeiras próprias do MVP-2 |
| PIS/Cofins, IRPJ e CSLL do Lucro Presumido | fatias próprias de apuração federal no MVP-2 |
| ICMS-ST, DIFAL, antecipação e demais recolhimentos | fatias tributárias próprias do MVP-2 |
| Partidas dobradas, razão, SPED e ECD | capacidades contábeis próprias do MVP-2 |
| Outros anexos, atividades, regimes, UFs e documentos | fatias próprias de expansão tributária do MVP-2 |
| Produção e piloto real | gate posterior ao MVP-4 |

Nenhum complemento foi descartado. A F36 entrega somente cálculo mensal interno, aprovação humana e rascunhos locais das duas trilhas aprovadas.

## 16. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Capacidade | apuração tributária |
| Tributo inicial | ICMS em Goiás, sem limitar o DAS aos componentes estaduais |
| Regimes | Simples Nacional e Lucro Presumido em trilhas separadas |
| Documentos | NF-e 55 e NFC-e 65 |
| Saída | apuração e guia em rascunho local |
| Simples | DAS completo do Anexo I, não mera estimativa da parcela de ICMS |
| Atividade | comércio de autopeças |
| Período | competências a partir de setembro de 2026, sem apuração retroativa anterior |
| Complementos | documentos fiscais mais declaração justificada com anexo |
| Aprovação | autoaprovação humana permitida; automação continua proibida |
| Artefatos | PDF, CSV e JSON |
| Reabertura | nova revisão imutável que supera a anterior |

**Questões abertas:** nenhuma.

### 16.1 Régua de tamanho

**Classificação aprovada:** Grande, com alvo de até aproximadamente dois dias de implementação.

A manutenção das duas trilhas na mesma fatia foi uma decisão explícita do PI após ser oferecida a divisão em duas SPECs. A justificativa técnica é que seleção de competência, ingestão documental, declarações/evidências, autorização, revisão imutável, exportação e interface formam um único fluxo vertical compartilhado; somente as estratégias determinísticas de cálculo e a apresentação do rascunho variam por regime.

O plano técnico deve medir o trabalho antes de codificar. Se não for possível manter o limite de Grande reutilizando os contratos das F16, F18 e F26–F32, a implementação não começa: volta ao PI para partir a fatia em novas SPECs, preservando integralmente ambas as trilhas e sem sufixos.

## 17. Gate dos oito itens obrigatórios

| Verificação | Evidência nesta SPEC |
|---|---|
| Identidade | cabeçalho, MVP-2, F36/SPEC-036 e issue #41 |
| Comportamento | §§3–10, observável por reconciliação, cálculo, aprovação, exportação e revisão |
| Aceite | §14, ligado às provas do §13 |
| Invariantes | §12, com aplicação concreta dos códigos globais |
| Fora de escopo | §15, com destino explícito |
| Dúvidas | §16; nenhuma aberta |
| Complementos | §15; nenhum requisito descartado |
| UI | §11, com caminho, estados, temas, viewports e provas |

## 18. Referências oficiais datadas

- Lei Complementar nº 123/2006, especialmente arts. 13 e 18 e Anexo I, versão oficial consultada em 20/09/2026: <https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm>;
- Portal do Simples Nacional, Manual do PGDAS-D, consultado em 20/09/2026: <https://www8.receita.fazenda.gov.br/simplesnacional/controles/pagina.aspx?id=9ffecb1f-1b06-4366-8ae8-226f178bc3e6>;
- Serviço oficial “Emitir DAS para pagamento de tributos do Simples Nacional”, consultado em 20/09/2026: <https://www.gov.br/pt-br/servicos/emitir-das-para-pagamento-de-tributos-do-simples-nacional>;
- Instrução Normativa nº 155/94-GSF, consolidada pela Secretaria da Economia de Goiás, consultada em 20/09/2026: <https://appasp.economia.go.gov.br/Legislacao/arquivos/secretario/in/IN_0155_1994.htm>;
- Sistema de Arrecadação da Secretaria da Economia de Goiás, aviso sobre ICMS mensal apurado e geração baseada em EFD, consultado em 20/09/2026: <https://arr.economia.go.gov.br/arr-www/view/entradaContribuinte.jsf>.

## 19. Aprovação

Recorte, regimes, documentos, atividade, períodos, entradas, aprovação, artefatos, reabertura, limites e destinos aprovados pelo PI em 20/09/2026. A implementação deve seguir esta SPEC sem presumir dado, regra ou cobertura, sem misturar as trilhas e sem apresentar rascunho local como guia oficial.
