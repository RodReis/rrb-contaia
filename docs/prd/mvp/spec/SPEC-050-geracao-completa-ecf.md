# SPEC-050 — Geração completa da ECF

> **Fatia:** F50
> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Origem:** PRD v3.1 §§3, 4.2, 6.2, 6.5, 12, 14, 15 e 16
> **Estado:** aprovada pelo PI em 25/09/2026
> **Tamanho:** Enorme — exceção pontual aprovada pelo PI para reunir a ECF original e retificadora, seus blocos aplicáveis, recuperação da ECD, e-Lalur/e-Lacs, revisão e artefatos no mesmo contrato
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4

## 1. Objetivo

Gerar, por empresa, ano-calendário completo ou situação especial explícita, uma versão interna, determinística, reproduzível e auditável da Escrituração Contábil Fiscal (ECF), consumindo fontes contábeis e tributárias aprovadas e um pacote oficial versionado do leiaute aplicável.

Sucesso significa que o escritório consegue preparar, revisar por pessoa distinta, formalizar e baixar uma ECF original ou retificadora, com todos os blocos e registros aplicáveis ao recorte, acompanhada de manifesto e diagnóstico local, sem inferir obrigação, afirmar validação no PVA, assinar ou transmitir a escrituração.

## 2. Fronteira e exceção de tamanho

A F50 entrega:

- catálogo interno de pacotes oficiais da ECF, versionados e imutáveis;
- geração completa dos blocos e registros obrigatórios, condicionais e facultativos suportados para a cobertura aprovada;
- recuperação versionada da ECD gerada pela F49 e reconciliação com as fontes contábeis;
- apuração fiscal fotografada, incluindo os registros aplicáveis de IRPJ, CSLL, e-Lalur e e-Lacs;
- ECF original e retificadora com histórico imutável e vínculo entre versões;
- análise bloqueante do impacto de alteração da Parte B em períodos posteriores;
- preparação e aprovação por pessoas distintas;
- arquivo `.txt`, manifesto JSON e diagnóstico local de consistência;
- RLS, concorrência otimista, idempotência e auditoria append-only;
- interface final nos temas CLARO e ESCURO.

O PI aprovou expressamente esta fatia como exceção `Enorme` à régua geral Curto/Médio. A exceção vale somente para a F50 e não altera a regra de decomposição das demais capacidades.

Não entram execução do PVA, assinatura digital, transmissão, recibo oficial, produção, atualização para o ano-calendário ordinário de 2026 sem pacote oficial aplicável nem recálculo automático em cascata de ECFs posteriores.

## 3. Usuários e resultado observável

- `admin_escritorio` prepara ou aprova versões de qualquer empresa do tenant, sem acumular os dois papéis na mesma revisão;
- `contador` prepara ou aprova apenas empresas de sua carteira ativa, também sujeito à segregação;
- `auxiliar` prepara rascunho para empresa da carteira delegada, mas não aprova nem formaliza;
- `auditor_readonly` consulta versões, impactos, diagnósticos, manifestos e artefatos sem mutação;
- demais papéis são negados por padrão;
- o preparador enxerga dados ausentes, registros afetados, reconciliações e caminho de correção;
- o aprovador revisa o snapshot exato submetido e decide sobre avisos e impactos;
- a formalização aprovada entrega os três artefatos e preserva todo o histórico.

## 4. Fontes e dependências

A versão formalizada referencia versões imutáveis de:

- cadastro empresarial, regime, responsáveis e situações especiais aprovadas;
- lançamentos, razão, balancetes, saldos de abertura e fechamentos das F39–F44;
- plano referencial publicado da F47;
- livros contábeis formalizados da F48;
- ECD formalizada da F49 e seus hashes;
- apurações de IRPJ e CSLL da F38 quando compatíveis com o período;
- demonstrativo fiscal estruturado de 2025, com valores, memória, fundamento, autoria e evidências, quando a F38 não cobrir o período;
- pacotes oficiais, respostas manuais justificadas e análises de impacto mantidos nesta fatia.

Fonte ausente, `STALE`, incompatível, fora da vigência ou com hash divergente bloqueia a submissão. A F50 não corrige cadastros, lançamentos, saldos, fechamentos, livros, plano referencial, ECD ou apurações de origem.

## 5. Cobertura empresarial e temporal

- entra empresa no Lucro Presumido;
- empresa do Simples Nacional entra apenas mediante configuração opcional explícita e evidência de aplicabilidade do pacote;
- nenhum fluxo declara obrigação, dispensa ou facultatividade legal;
- outros regimes permanecem fora desta fatia;
- entram o ano-calendário ordinário de 2025 e situações especiais de 2026 cobertas pelo pacote oficial;
- situações especiais suportadas: extinção, cisão parcial, cisão total, fusão e incorporação;
- o ano-calendário ordinário de 2026 permanece `INDETERMINATE` até existir pacote oficial aplicável;
- período, regime, qualificação, situação e fonte sem cobertura exata resultam em `INDETERMINATE`;
- datas de período são civis, sem fuso; instantes operacionais são UTC, exibidos em `America/Sao_Paulo`.

## 6. Pacote oficial versionado

O catálogo inicia no Manual de Orientação do Leiaute 12 da ECF, atualização de 23/07/2026, anexo ao ADE Cofis nº 2/2026, e nas Tabelas Dinâmicas e Planos de Contas Referenciais do Leiaute 12, atualização de 07/09/2026, para ano-calendário 2025 e situações especiais de 2026.

Cada pacote registra identidade, leiaute, revisão, estado, fontes oficiais, datas de publicação e captura, cobertura, arquivos brutos, hashes SHA-256, tabelas, fórmulas, cardinalidades, domínios, ordenação, regras de validação e proveniência da curadoria humana.

Estados: `DRAFT`, `ACTIVE`, `SUPERSEDED` e `REVOKED`.

- só `ACTIVE` inicia nova preparação;
- pacote superado continua reproduzindo versões existentes;
- pacote revogado bloqueia novas formalizações sem apagar histórico;
- revisão oficial nova cria pacote novo e não reescreve o anterior;
- versão do programa PVA não substitui a identidade do leiaute;
- pacote sem cobertura exata retorna `INDETERMINATE`.

## 7. Aplicabilidade de blocos e registros

O motor seleciona blocos e registros exclusivamente pelas regras versionadas do pacote, pelo regime, período, situação, forma de tributação e fatos comprovados. Ele cobre abertura, cadastro, recuperação contábil, plano referencial, saldos, apuração, e-Lalur/e-Lacs, informações econômicas e gerais e encerramento quando aplicáveis.

- registro obrigatório ausente é `BLOCKING`;
- registro condicional só aparece quando a condição oficial fotografada é satisfeita;
- registro facultativo exige decisão explícita e entrada aprovada;
- campo desconhecido não recebe vazio enganoso, zero, código aproximado ou conteúdo gerado por IA;
- cálculo oficial parametrizado usa decimal exato e fórmula versionada;
- ordenação e totalização usam chaves estáveis, nunca instante de download;
- o Simples opcional só produz registros cobertos pelo pacote e pelas evidências fornecidas, sem fabricar apuração de Lucro Presumido.

## 8. Recuperação da ECD e reconciliação

O rascunho seleciona uma versão `FORMALIZED` e não `STALE` da ECD F49 compatível com empresa e período. A recuperação fotografa arquivo, manifesto, pacote, forma, hashes e versão das fontes.

Um parser independente valida estrutura, contagens, totalizadores e hash antes do uso. O conteúdo recuperado reconcilia plano referencial, saldos, demonstrações e resultado contábil com F42–F49. Divergência é bloqueante e precisa ser corrigida na capacidade de origem; a F50 não oferece ajuste manual para mascará-la.

Empresa legalmente dispensada de ECD só prossegue quando o pacote admitir a alternativa e a evidência de aplicabilidade for registrada. Ausência de ECD sem alternativa comprovada resulta em `INDETERMINATE`.

## 9. Apuração fiscal, e-Lalur e e-Lacs

- no Lucro Presumido, valores trimestrais de 2026 reconciliam com a revisão aprovada da F38 quando a situação especial for compatível;
- para o ano-calendário 2025, ainda não coberto pela F38, o preparador registra demonstrativo fiscal estruturado por trimestre, com receita, base, percentuais, deduções, IRPJ, adicional e CSLL, sempre acompanhado de memória, fundamento oficial, autoria e evidências;
- o demonstrativo de 2025 é entrada fotografada para a ECF: a F50 valida formato, vigência, somas e reconciliação contábil, mas não cria regra tributária nova nem recalcula tributo sem pacote versionado aplicável;
- adições, exclusões, compensações, saldos da Parte A e controles da Parte B exigem origem, fundamento, vigência, valor e evidência versionada;
- saldo inicial da Parte B precisa reconciliar com a última ECF aplicável quando existente;
- cálculo derivado não aceita edição direta; correção ocorre na origem ou em resposta manual expressamente permitida pelo pacote;
- prejuízo fiscal, base negativa, incentivo, operação ou tratamento sem cobertura comprovada resulta em `INDETERMINATE`;
- LLM pode explicar uma pendência, mas nunca classifica fato, escolhe código ou calcula valor fiscal.

## 10. Original e retificadora

Modalidades: `ORIGINAL` e `RECTIFYING`.

A original não aceita referência a recibo anterior. A retificadora exige identificação e evidência da entrega anterior, vínculo com a última versão conhecida e motivo estruturado; nesta fatia o recibo é somente dado de entrada comprovado, não é obtido nem validado remotamente.

Cada retificadora:

- substitui integralmente a versão interna anterior para comparação, sem apagá-la;
- apresenta diferenças por bloco, registro, campo, valor e origem;
- preserva cadeia de versões, autoria, motivo, hashes e evidências;
- não afirma que a substituição ocorreu no ambiente oficial;
- não reutiliza silenciosamente aprovação da versão anterior.

## 11. Impacto da Parte B em períodos posteriores

Se uma retificadora alterar saldo, criação, baixa, transferência ou relacionamento de controle da Parte B, o sistema identifica todas as ECFs posteriores conhecidas potencialmente afetadas.

Para cada período posterior, pessoa autorizada registra análise `IMPACTED`, `NOT_IMPACTED` ou `INDETERMINATE`, justificativa e evidência. `IMPACTED` ou `INDETERMINATE` sem plano de correção mantém a retificadora bloqueada para aprovação.

A F50 não recalcula nem formaliza automaticamente períodos posteriores. Cada correção posterior ocorre como nova retificadora no próprio período, preservando revisão e aprovação independentes.

## 12. Ciclo de vida e segregação

Estados: `DRAFT`, `READY_FOR_REVIEW`, `CHANGES_REQUESTED`, `FORMALIZED`, `STALE` e `SUPERSEDED`.

1. o preparador fixa empresa, período, situação, regime, modalidade e pacote;
2. seleciona fontes, completa respostas permitidas e gera diagnóstico;
3. na retificadora, compara versões e conclui análises de impacto;
4. submete snapshot imutável para revisão;
5. pessoa distinta aprova ou solicita alterações com motivo;
6. aprovação agenda formalização idempotente;
7. a formalização revalida entradas e grava artefatos atomicamente.

O preparador nunca aprova a própria revisão. Mudança em pacote, fonte, resposta, evidência ou análise invalida prévia e revisão abertas.

## 13. Diagnóstico, formalização e artefatos

O diagnóstico usa `BLOCKING`, `WARNING` e `INFO`, com código estável, localização, origem e caminho de correção. `WARNING` exige ciência explícita e permanece visível ao aprovador.

Cada versão formalizada produz:

1. arquivo ECF `.txt` conforme codificação, delimitadores e encerramentos do pacote;
2. manifesto JSON com cobertura, modalidade, fontes, versões, contagens, hashes, autorias e `revisionCreatedAtUtc`;
3. diagnóstico local com regras executadas, reconciliações, avisos aceitos e impactos analisados.

Os artefatos são imutáveis e possuem SHA-256. O hash canônico usa `revisionCreatedAtUtc`, nunca instante de download. Downloads posteriores devolvem os mesmos bytes. Parser independente reconstrói blocos e confirma contagens e totalizadores; essa prova não substitui o PVA.

## 14. Autorização, RLS e auditoria

- toda entidade persistida possui `tenant_id` e `empresa_id` quando aplicável;
- políticas de RLS usam contexto de sessão e carteira ativa;
- worker opera com identidade técnica estreita e contexto explícito;
- mutações não aceitam tenant livre nem empresa fora da autorização;
- preparação, recuperação, diagnóstico, submissão, análise de impacto, decisão, formalização, sucessão e download geram auditoria append-only;
- auditoria registra autor, papel, empresa, período, modalidade, pacote, revisão, hashes, resultado, instante UTC e `correlationId`;
- negativa de acesso não revela existência de outra empresa ou tenant.

## 15. Interface

A rota canônica é `Fiscal -> Central ECF`, com entrada contextual por `Empresa -> Obrigações -> ECF` e por `Contábil -> ECD -> Preparar ECF`.

A direção visual parte de `docs/telas/contaia_central_de_escritura_o_sped_ecd_malha_fiscal_preventiva_rf_03/code.html`, adaptada para ECF e corrigida para remover alegação de conformidade total, PVA pronto, assinatura ou transmissão.

A central organiza: identificação; pacote e cobertura; recuperação da ECD; blocos e registros; IRPJ/CSLL e e-Lalur/e-Lacs; comparação da retificadora; impacto posterior; consistência; revisão; artefatos e histórico.

Estados obrigatórios: loading com último estado válido, vazio, pacote ausente, `INDETERMINATE`, fonte incompatível, ECD divergente, rascunho parcial, diagnóstico em execução, bloqueios, avisos, revisão pendente, alterações solicitadas, impacto posterior pendente, aprovação, formalização, conflito, falha, `STALE`, superada, acesso negado e empresa fora da carteira.

Toast Sonner confirma operações, sem `alert`. A tela segue `docs/FRONTEND.md`, `docs/DESIGN-SYSTEM.md` e `docs/design-system/`, nos temas CLARO/ESCURO e viewports 768/1024/1440, com teclado, foco, contraste e anúncios. `frontend-design` é obrigatória antes e durante a implementação; `impeccable` é obrigatório no acabamento.

## 16. Contratos públicos mínimos

Tipos: `EcfLayoutPackage`, `EcfDraft`, `EcfSourceSnapshot`, `EcfRecoveredEcd`, `EcfRecord`, `EcfTaxControl`, `EcfPriorReceiptEvidence`, `EcfRectificationDiff`, `EcfSubsequentPeriodImpact`, `EcfReview`, `EcfIssue`, `EcfRevision` e `EcfArtifact`.

Operações: consultar pacotes e cobertura; criar, consultar, atualizar e descartar rascunho; selecionar e validar fontes; recuperar ECD; manter respostas e evidências permitidas; gerar diagnóstico e prévia; comparar retificadora; registrar análises posteriores; submeter, solicitar alterações e aprovar; formalizar idempotentemente; consultar versão e histórico; baixar artefato autorizado.

Falhas seguem `application/problem+json`. Códigos mínimos: `ECF_PACKAGE_INDETERMINATE`, `ECF_SOURCE_STALE`, `ECF_PERIOD_UNSUPPORTED`, `ECF_ECD_REQUIRED`, `ECF_ECD_DIVERGENT`, `ECF_RECORD_INCOMPLETE`, `ECF_TAX_RECONCILIATION_FAILED`, `ECF_PRIOR_RECEIPT_REQUIRED`, `ECF_PART_B_IMPACT_PENDING`, `ECF_REVIEW_SELF_APPROVAL`, `ECF_REVIEW_EXPIRED`, `ECF_FORMALIZATION_CONFLICT` e `ECF_ARTIFACT_DIVERGENT`.

## 17. Concorrência e falhas

- rascunho usa revisão otimista;
- submissão fotografa revisão e hashes;
- aprovação concorrente ou vencida retorna conflito;
- formalização usa chave idempotente por empresa, período, modalidade e snapshot;
- retry não duplica versão nem artefato;
- falha de fila ou storage permanece observável e nunca vira `pass`;
- download valida contexto, versão, tipo, tamanho e hash;
- divergência de artefato bloqueia download e gera incidente auditável.

## 18. Invariantes globais tocados

| Invariante de `CONVENTION.md` §2 | Aplicação na F50 |
|---|---|
| I-1 Tenant e empresa | toda tabela transacional possui `tenant_id` e `empresa_id`, indexados e sob RLS |
| I-2 Contexto obrigatório | consulta sem contexto de tenant não retorna existência nem conteúdo |
| I-3 Dinheiro em centavos | valores monetários usam inteiro em centavos; `float` é proibido |
| I-4 Motor versionado | cálculo fiscal e contábil usa regra versionada; LLM nunca calcula |
| I-5 Aprovação humana | formalização exige aprovação humana registrada e segregada |
| I-6 Trilha append-only | decisões, versões, impactos e downloads não são reescritos nem apagados |
| I-7 Valor não se apaga | valor fiscal ou contábil é preservado e sucedido por nova versão |
| I-8 Vigência do fato | regra tributária é escolhida pela data do fato e cobertura do pacote |
| I-9 Idempotência externa | embora não haja transmissão, formalização e futuros adaptadores preservam chave idempotente |
| I-10 Chave privada isolada | a F50 não acessa certificado, chave privada ou Signer |
| I-11 Datas e fuso | datas civis não têm fuso; instantes são UTC e exibidos em `America/Sao_Paulo` |
| I-12 Reprodução | o mesmo snapshot de período fechado reproduz os mesmos bytes e hashes |

Além disso, versão formalizada nunca é alterada ou apagada; preparador e aprovador são pessoas distintas; retificadora preserva a original; impacto pendente da Parte B bloqueia aprovação; diagnóstico local nunca é rotulado como validação PVA.

## 19. Testes e evidências

### 19.1 Regras e banco

- cobertura exata para 2025 e situações especiais de 2026;
- bloqueio do ano-calendário ordinário de 2026;
- seleção de registros por regime, período, situação e fato comprovado;
- recuperação íntegra, ausente, incompatível e divergente da ECD;
- reconciliação com razão, plano referencial, F38 quando temporalmente compatível e demonstrativo evidenciado de 2025;
- original sem recibo anterior e retificadora com evidência obrigatória;
- diferenças da retificadora e análise de Parte B;
- bloqueio enquanto período posterior estiver `IMPACTED` ou `INDETERMINATE` sem plano;
- segregação, transições, concorrência, RLS e negativas entre tenants/empresas;
- rollback integral e repetição idempotente.

### 19.2 Artefatos e UI

- fixture oficial curada gera TXT parseável, manifesto e diagnóstico coerentes;
- mesma entrada reproduz bytes e hashes idênticos;
- corrupção de artefato é detectada;
- E2E cobre original, retificadora, impacto posterior, aprovação segregada e downloads;
- prova visual compara referência e implementação nos temas CLARO/ESCURO e viewports 768/1024/1440;
- estados, teclado, foco, contraste, anúncios e Toast são verificados;
- passe final de `impeccable` e smoke ao vivo com Playwright são registrados.

Execução de PVA, assinatura e transmissão são `not_run`, nunca `pass`.

## 20. Critérios de aceite

- [ ] Leiaute 12 e tabelas oficiais possuem fonte, revisão, cobertura e hashes.
- [ ] Lucro Presumido e Simples opcional são tratados sem inferir obrigação.
- [ ] Ano-calendário 2025 e situações especiais cobertas de 2026 são aceitos; 2026 ordinário é `INDETERMINATE`.
- [ ] Todos os registros aplicáveis são gerados a partir de regras e fontes versionadas.
- [ ] ECD recuperada reconcilia com as fontes contábeis e divergência bloqueia.
- [ ] O demonstrativo fiscal de 2025 é estruturado, evidenciado, reconciliado e não convertido em cálculo tributário presumido.
- [ ] Original e retificadora preservam versões, evidências e comparação completa.
- [ ] Alteração da Parte B bloqueia aprovação até revisar períodos posteriores.
- [ ] Preparador e aprovador são pessoas distintas.
- [ ] TXT, manifesto e diagnóstico são imutáveis, parseáveis e reproduzíveis.
- [ ] RLS, auditoria, concorrência e idempotência possuem provas positivas e negativas.
- [ ] Interface final comprova temas, responsividade, estados e acessibilidade.
- [ ] Nenhum fluxo executa PVA, assinatura ou transmissão.

## 21. Fora de escopo e destinos

| Item | Destino obrigatório |
|---|---|
| Execução e validação no PVA | fatia própria de validação local de ECF do MVP-2 |
| Assinatura digital e transmissão oficial | fatias próprias de entrega oficial de obrigações do MVP-2, ainda em Docker local |
| Recibo obtido do serviço oficial | mesma capacidade futura de transmissão da ECF no MVP-2 |
| Ano-calendário ordinário de 2026 e leiautes posteriores | atualização oficial versionada desta capacidade quando houver pacote aplicável |
| Lucro Real, Arbitrado, imunes e isentas | fatias próprias de expansão de regimes e apurações do MVP-2 |
| Recálculo automático em cascata | fatia própria de gestão multiexercício de retificações no MVP-2 |
| Correção de ECD, razão, plano referencial ou apuração já coberta | capacidades de origem F38–F49; demonstrativo fiscal de 2025 é corrigido por nova versão evidenciada na F50 |
| Produção, credenciais e storage gerenciados | gate de Produção posterior ao MVP-4 |

## 22. Dúvidas resolvidas

- A F50 entrega a ECF completa e é exceção `Enorme` aprovada pelo PI.
- Cobertura: ano-calendário 2025 e situações especiais de 2026.
- Regimes: Lucro Presumido e Simples Nacional opcional, sem inferir obrigação.
- Modalidades: original e retificadora.
- Fronteira: arquivo interno; sem PVA, assinatura ou transmissão.
- Alteração da Parte B bloqueia aprovação até revisão humana dos períodos posteriores.
- Questões abertas: **Nenhuma**.

## 23. Gate de conformidade documental

- **Identidade:** F50/SPEC-050, MVP-2 e origem no PRD declarados no cabeçalho.
- **Comportamento:** geração interna observável de ECF original e retificadora completa.
- **Aceite:** critérios verificáveis por regras, banco, artefatos, E2E e prova visual.
- **Invariantes:** seção 18 relaciona os invariantes globais tocados e sua aplicação.
- **Fora de escopo:** seção 21 nomeia cada complemento e seu destino.
- **Dúvidas:** decisões do PI registradas; nenhuma questão aberta.
- **UI:** referência concreta, estados, temas, viewports e skills obrigatórias definidos.
- **Tamanho:** exceção `Enorme` expressamente aprovada e restrita à F50.

## 24. Fontes oficiais consultadas

- Receita Federal, Manual de Orientação do Leiaute 12 da ECF, atualização de 23/07/2026, ano-calendário 2025 e situações especiais de 2026, anexo ao ADE Cofis nº 2/2026;
- SPED, Tabelas Dinâmicas e Planos de Contas Referenciais do Leiaute 12, atualização de 07/09/2026;
- Receita Federal, programa validador ECF 12.2.7, consultado em 25/09/2026, usado apenas como referência de ecossistema e não como componente desta fatia.
