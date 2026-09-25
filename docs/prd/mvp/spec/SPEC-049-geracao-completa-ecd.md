# SPEC-049 — Geração completa da ECD

> **Fatia:** F49
> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Origem:** PRD v3.1 §§3, 4.2, 6.2, 6.5, 12, 14, 15 e 16
> **Estado:** aprovada pelo PI em 25/09/2026
> **Tamanho:** Enorme — exceção pontual aprovada pelo PI para reunir as formas G, R, A, B e Z, seus auxiliares, demonstrações, signatários e anexos no mesmo contrato
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4

## 1. Objetivo

Gerar, por empresa, exercício civil completo ou situação especial explícita, uma versão interna, determinística, reproduzível e auditável do arquivo da Escrituração Contábil Digital (ECD), consumindo as fontes contábeis aprovadas das F39–F48 e um pacote oficial versionado do leiaute aplicável.

Sucesso significa que o escritório consegue preparar, revisar por pessoa distinta, formalizar e baixar o arquivo texto da ECD nas formas G, R, A, B ou Z, acompanhado de manifesto e diagnóstico local, sem inferir obrigação, afirmar validação no PVA, assinar, registrar ou transmitir a escrituração.

## 2. Fronteira e exceção de tamanho

A F49 entrega:

- catálogo interno de pacotes oficiais da ECD, versionados e imutáveis;
- geração nas formas `G`, `R`, `A`, `B` e `Z` previstas no pacote aplicável;
- estruturas e versões de livros auxiliares necessárias às formas R, A e B;
- leiaute parametrizável e dados auxiliares necessários à forma Z;
- Balanço Patrimonial, DRE contábil e DLPA ou DMPL versionados;
- cadastro versionado de signatários, sem material criptográfico;
- anexos facultativos do registro J800, com integridade e proveniência;
- preparação e aprovação por pessoas distintas;
- arquivo `.txt`, manifesto JSON e diagnóstico local de consistência;
- versões imutáveis, sucessão interna, histórico, RLS e auditoria;
- interface final nos temas CLARO e ESCURO.

O PI aprovou expressamente esta fatia como exceção `Enorme` à régua geral Curto/Médio. A exceção vale somente para a F49 e não altera a regra de decomposição das demais capacidades.

Não entram validação no PVA, assinatura digital, autenticação ou registro oficial dos livros, transmissão, recibo, substituição oficial, Bloco K, inferência de obrigatoriedade ou produção.

## 3. Usuários e resultado observável

- `admin_escritorio` prepara ou aprova versões de qualquer empresa do tenant, sem acumular os dois papéis na mesma revisão;
- `contador` prepara ou aprova apenas empresas de sua carteira ativa, também sujeito à segregação;
- `auxiliar` pode preparar rascunho para empresa da carteira delegada, mas não aprova nem formaliza;
- `auditor_readonly` consulta versões, diagnósticos, manifestos e artefatos sem mutação;
- demais papéis são negados por padrão;
- o preparador enxerga nominalmente dados ausentes, registros afetados e caminho de correção;
- o aprovador revisa o snapshot exato submetido e pode aprovar ou solicitar alterações;
- a formalização aprovada entrega os três artefatos e preserva o histórico completo.

## 4. Fontes e dependências

A versão formalizada referencia versões imutáveis de:

- contas, centros e classificações da F39;
- lançamentos efetivados, cancelamentos e estornos das F40/F41;
- razão e balancetes reconstruíveis da F42;
- snapshots de competências fechadas da F43;
- saldos de abertura aprovados da F44;
- DRE gerencial da F45 somente como insumo comparativo, nunca como demonstração oficial por equivalência;
- plano referencial publicado da F47 quando o pacote exigir vínculo referencial;
- Diário e Razão formalizados da F48;
- pacote oficial, estruturas auxiliares, demonstrações, signatários e anexos mantidos nesta fatia.

Entrada ausente, `STALE`, superada de forma incompatível, fora da vigência ou com hash divergente bloqueia a submissão. A F49 não corrige lançamentos, saldos, fechamentos, livros ou plano referencial.

## 5. Cobertura empresarial e temporal

- entram empresas no Lucro Presumido;
- empresa do Simples Nacional entra somente quando o usuário declara configuração opcional e apresenta o pacote aplicável;
- nenhum fluxo declara obrigação, dispensa ou facultatividade legal da entrega;
- outro regime permanece fora desta fatia;
- o recorte é `ORDINARY_YEAR`, de 1º de janeiro a 31 de dezembro, ou `SPECIAL_PERIOD`, contínuo, dentro do exercício e com tipo e justificativa explícitos;
- todas as competências alcançadas precisam estar fechadas, contínuas e íntegras;
- período sem movimento, data incompatível ou situação sem cobertura oficial retorna diagnóstico bloqueante;
- ausência de evidência suficiente resulta em `INDETERMINATE`, nunca em seleção aproximada.

Datas do período são civis, sem fuso. Instantes operacionais são UTC e exibidos em `America/Sao_Paulo`.

## 6. Pacote oficial versionado

O catálogo inicia com o Manual de Orientação do Leiaute 9 da ECD, atualização de janeiro de 2026, anexo ao ADE Cofis nº 1/2026. Cada pacote registra:

- identificador, leiaute, revisão e estado;
- fonte oficial, data de publicação e data de captura;
- exercícios, situações, regimes e formas cobertas;
- tabelas, regras de cardinalidade, tamanhos, tipos, domínios e ordenação;
- arquivos-fonte e hash SHA-256;
- registros obrigatórios, condicionais e facultativos suportados;
- proveniência da curadoria e revisão humana.

Estados: `DRAFT`, `ACTIVE`, `SUPERSEDED` e `REVOKED`.

- só `ACTIVE` inicia nova preparação;
- pacote superado continua reproduzindo versões existentes;
- pacote revogado bloqueia novas formalizações sem apagar artefatos;
- revisão nova cria pacote novo e não reescreve o anterior;
- versão do PVA não é versão do leiaute e não integra este catálogo;
- pacote sem cobertura exata retorna `INDETERMINATE`.

## 7. Formas de escrituração

O rascunho fixa exatamente uma forma:

| Forma | Contrato mínimo nesta fatia |
|---|---|
| `G` | Livro Diário completo, sustentado pelos lançamentos e livros formais |
| `R` | Diário com escrituração resumida e um ou mais livros auxiliares vinculados |
| `A` | Diário auxiliar com os vínculos, totais e identificação previstos no pacote |
| `B` | Livro de balancetes diários e balanços com períodos e totalizações reproduzíveis |
| `Z` | Razão auxiliar com leiaute parametrizável, campos, tipos e dados fotografados |

Para cada forma:

- a estrutura exigida pelo pacote precisa existir e estar publicada;
- cabeçalho, abertura, encerramento, totalizadores e contagem de linhas são gerados pelo motor, não digitados livremente;
- registros condicionais surgem somente quando sua condição documentada é satisfeita;
- registro facultativo exige suporte explícito nesta SPEC e entrada aprovada;
- dado desconhecido não é preenchido com vazio enganoso, zero ou texto aproximado;
- ordenação usa chaves contábeis e identidades estáveis, nunca instante de download.

## 8. Livros auxiliares e forma Z

### 8.1 Estruturas auxiliares

Cada estrutura pertence à empresa e ao exercício, define forma compatível, finalidade, código, título, campos, ordenação, totalizadores e vínculo com Diário/Razão. Estados: `DRAFT`, `PUBLISHED` e `SUPERSEDED`.

Publicação cria versão imutável. Alteração exige novo rascunho e nova versão. A estrutura não altera lançamentos nem livros da F48.

### 8.2 Conteúdo auxiliar

O conteúdo deriva de lançamentos efetivados e fontes contábeis fotografadas. Transformações são determinísticas, tipadas e versionadas. Campo sem origem declarada bloqueia publicação; expressão livre ou código executável fornecido pelo usuário é proibido.

### 8.3 Leiaute parametrizável Z

A forma Z mantém:

- definição ordenada de campos, rótulo, tipo, tamanho, precisão e obrigatoriedade;
- origem determinística de cada campo;
- parâmetros de impressão e visualização aceitos pelo pacote;
- linhas auxiliares e totalizadores;
- hash separado da definição e do conteúdo.

Mudança de definição invalida prévias e revisões abertas.

## 9. Demonstrações contábeis

A F49 cria versões próprias, reconciliadas com F42/F43, para:

- Balanço Patrimonial;
- DRE contábil;
- DLPA ou DMPL, conforme escolha explícita e cobertura do pacote.

Cada versão fixa empresa, período, estrutura hierárquica, contas componentes, sinais, saldos, linhas calculadas, notas e hash. A DRE gerencial da F45 pode ser comparada ou copiada como ponto de partida sanitizado, mas a publicação exige vínculos contábeis explícitos e independentes.

Regras:

- cada linha possui identidade estável, nível, ordem e tipo;
- total calculado não aceita edição direta;
- BP reconcilia ativos, passivos e patrimônio líquido;
- DRE reconcilia contas de resultado antes e depois do encerramento aplicável;
- DLPA/DMPL reconcilia saldo inicial, fatos declarados e saldo final do patrimônio líquido;
- divergência, conta sem destino obrigatório ou período incompatível bloqueia submissão;
- versão publicada é imutável e alteração cria sucessora.

## 10. Signatários sem assinatura

O cadastro de signatários pertence à empresa, possui vigência civil e versões imutáveis. Tipos mínimos:

- `ACCOUNTANT`, com nome, CPF, CRC, UF, qualificação e vigência;
- `LEGAL_REPRESENTATIVE`, com nome, CPF, qualificação, vigência e fundamento cadastral.

O rascunho seleciona versões vigentes e fotografa seus dados para os registros aplicáveis. CPF, qualificação ou registro exigido ausente ou inválido bloqueia submissão.

Esta fatia não armazena certificado, procuração, senha, chave privada ou assinatura. A presença do registro de signatário não significa que o arquivo esteja assinado.

## 11. Anexos J800

O rascunho aceita anexos facultativos somente quando o pacote permitir. Cada anexo registra:

- título, finalidade, ordem e nome sanitizado;
- tipo de conteúdo permitido e tamanho dentro do limite configurado;
- arquivo original, conteúdo codificado exigido pelo leiaute e hash SHA-256;
- autor, instante UTC e proveniência;
- verificação antimalware e resultado.

Arquivo executável, tipo divergente, conteúdo malformado, hash incompatível ou varredura inconclusiva bloqueiam submissão. Reordenar, substituir ou remover anexo invalida prévia e revisão. O arquivo original e o conteúdo incorporado permanecem vinculados à versão formalizada.

## 12. Ciclo de vida e segregação

Estados da versão:

- `DRAFT`: editável pelo preparador;
- `READY_FOR_REVIEW`: snapshot imutável aguardando revisor;
- `CHANGES_REQUESTED`: devolvido com motivo obrigatório;
- `FORMALIZED`: aprovado e materializado com artefatos imutáveis;
- `STALE`: formalizado cuja fonte foi posteriormente reaberta, superada ou invalidada;
- `SUPERSEDED`: versão interna sucedida por outra formalizada para o mesmo recorte e finalidade.

Fluxo:

1. preparador cria o rascunho e fixa empresa, recorte, regime, forma e pacote;
2. mantém auxiliares, demonstrações, signatários e anexos;
3. gera diagnóstico e prévia sem validade;
4. submete o snapshot para revisão;
5. pessoa distinta aprova ou solicita alterações;
6. aprovação válida agenda a formalização idempotente;
7. formalização revalida todas as entradas e grava os artefatos atomicamente.

O preparador não aprova a própria revisão, mesmo se também for `admin_escritorio`. Mudança em qualquer entrada após a submissão invalida o snapshot; não existe aprovação parcial ou silenciosamente reaproveitada.

## 13. Prévia, diagnóstico e formalização

A prévia:

- calcula registros, blocos, contagens, totalizadores e hashes de entrada;
- executa regras locais do pacote e reconciliações contábeis;
- retorna problemas com código, severidade, campo ou registro, origem e caminho de correção;
- nunca é persistida como arquivo formal nem anunciada como validada no PVA;
- expira quando pacote, fontes, estrutura, demonstração, signatário ou anexo muda.

O diagnóstico usa severidades `BLOCKING`, `WARNING` e `INFO`. `BLOCKING` impede submissão e formalização; `WARNING` exige ciência explícita do preparador e fica visível ao aprovador; `INFO` é explicativo.

A formalização é transacional e idempotente. Repetição da mesma chave e mesmo snapshot devolve o resultado anterior; chave com conteúdo diferente retorna conflito. Falha não publica versão parcial nem artefato incompleto.

## 14. Artefatos e reprodução

Cada versão formalizada produz:

1. arquivo ECD `.txt`, com codificação, delimitadores, quebras e encerramentos definidos pelo pacote;
2. manifesto JSON, com empresa, período, regime, forma, pacote, versões de entrada, contagens, hashes, autorias e `revisionCreatedAtUtc`;
3. diagnóstico local, com regras executadas, resultados, avisos aceitos e reconciliações.

Os três artefatos são imutáveis e possuem SHA-256. O hash canônico usa `revisionCreatedAtUtc`, nunca o instante do download. Downloads posteriores devolvem os mesmos bytes.

Um parser independente lê o `.txt`, reconstrói blocos e registros e confirma contagens e totalizadores contra o manifesto. Essa prova não substitui o PVA.

## 15. Sucessão interna e obsolescência

- correção de fonte exige corrigir a capacidade de origem, fechar novamente e preparar nova versão;
- a versão anterior não é apagada nem reescrita;
- nova formalização para o mesmo recorte torna a anterior `SUPERSEDED`;
- reabertura ou divergência posterior torna a versão afetada `STALE` e bloqueia seu uso como entrada futura;
- nenhum arquivo desta fatia é rotulado como ECD substituta oficial;
- recibo, hash oficial anterior e termo de verificação para substituição não são aceitos nesta fatia.

## 16. Autorização, RLS e auditoria

- toda entidade persistida possui `tenant_id` e `empresa_id` quando aplicável;
- políticas de RLS usam contexto de sessão e carteira ativa;
- serviço e worker operam sob identidade técnica estreita e contexto explícito;
- mutações não aceitam tenant livre nem empresa fora do contexto autorizado;
- preparação, submissão, pedido de alteração, aprovação, formalização, sucessão, download e negativas relevantes geram auditoria append-only;
- auditoria registra autor, papel no fluxo, empresa, recorte, forma, pacote, revisão, versões, hashes, resultado, instante UTC e `correlationId`;
- auditoria nunca registra conteúdo integral de anexo nem dado criptográfico.

## 17. Interface

A rota canônica é `Contábil -> Central ECD`, com entrada contextual também por `Empresa -> Estrutura contábil -> ECD`.

A direção visual parte de `docs/telas/contaia_central_de_escritura_o_sped_ecd_malha_fiscal_preventiva_rf_03/code.html`, corrigindo o protótipo: remove versão fixa de PVA, alegação de “PVA pronto”, conformidade de 100% e ações de assinar ou transmitir.

A central organiza etapas persistentes:

1. Dados — empresa, exercício/situação, regime, forma e pacote;
2. Livros auxiliares — estruturas, vínculos, cobertura e forma Z;
3. Demonstrações — BP, DRE e DLPA/DMPL com reconciliação;
4. Signatários — vigência, qualificação e completude;
5. Anexos — J800, ordem, integridade e varredura;
6. Consistência — bloqueios, avisos, registros e totalizadores;
7. Revisão — preparador, aprovador, snapshot e decisões;
8. Artefatos — versão, estado, hashes, downloads e histórico.

Estados obrigatórios incluem loading preservando último estado válido, ausência de pacote, `INDETERMINATE`, fonte incompleta, rascunho parcial, diagnóstico em execução, bloqueios, avisos, revisão pendente, alterações solicitadas, aprovação, formalização, conflito, falha, `STALE`, superada, acesso negado e empresa fora da carteira.

Toast Sonner confirma operações, sem `alert`. A interface segue `docs/FRONTEND.md`, `docs/DESIGN-SYSTEM.md` e `docs/design-system/`, com temas CLARO/ESCURO, viewports 768/1024/1440, teclado, foco, contraste e anúncios. `frontend-design` é obrigatória antes e durante a implementação; `impeccable` é obrigatório no acabamento final.

## 18. Contratos públicos mínimos

### 18.1 Tipos

- `EcdLayoutPackage`: identidade, revisão, cobertura, fonte, hashes, regras e estado;
- `EcdDraft`: empresa, recorte, regime, forma, pacote, revisão e estado;
- `AuxiliaryBookStructure` e `AuxiliaryBookVersion`: definição, conteúdo, vínculos e hashes;
- `ParameterizedLedgerLayout`: campos, tipos, origens, ordem e totalizadores;
- `AccountingStatementVersion`: tipo `BALANCE_SHEET`, `INCOME_STATEMENT`, `DLPA` ou `DMPL`, linhas e reconciliação;
- `EcdSignatoryVersion`: tipo, qualificação, dados, vigência e versão;
- `EcdAttachment`: metadados, ordem, varredura, hash e referência do conteúdo;
- `EcdReview`: preparador, aprovador, snapshot, decisão e motivo;
- `EcdIssue`: código estável, severidade, localização, origem e correção;
- `EcdRevision`: estado, versões consumidas, `revisionCreatedAtUtc` e hashes;
- `EcdArtifact`: tipo, nome, tamanho, hash e referência opaca.

### 18.2 Operações

- listar pacotes e consultar cobertura exata;
- criar, consultar, atualizar e descartar rascunho;
- manter, publicar e consultar estruturas auxiliares e demonstrações;
- manter signatários e anexos;
- gerar prévia e diagnóstico;
- submeter para revisão, solicitar alterações e aprovar;
- formalizar idempotentemente;
- consultar versão vigente e histórico;
- baixar artefato por referência autorizada.

Falhas seguem `application/problem+json` com `type`, `title`, `status`, `code` e `correlationId`. Códigos mínimos incluem `ECD_PACKAGE_INDETERMINATE`, `ECD_SOURCE_STALE`, `ECD_PERIOD_NOT_CLOSED`, `ECD_FORM_UNSUPPORTED`, `ECD_AUXILIARY_INCOMPLETE`, `ECD_STATEMENT_UNBALANCED`, `ECD_SIGNATORY_INCOMPLETE`, `ECD_ATTACHMENT_INVALID`, `ECD_REVIEW_SELF_APPROVAL`, `ECD_REVIEW_EXPIRED`, `ECD_FORMALIZATION_CONFLICT` e `ECD_ARTIFACT_DIVERGENT`.

## 19. Concorrência, filas e falhas

- rascunho usa revisão otimista;
- submissão fotografa revisão e hashes das entradas;
- aprovação concorrente ou vencida retorna conflito;
- formalização é processada por worker com chave idempotente por empresa, recorte, forma e snapshot;
- uma versão formalizada corrente por empresa, recorte e finalidade é garantida no banco;
- retry reutiliza resultado terminal e não duplica artefatos;
- indisponibilidade de storage, fila ou scanner deixa operação em falha observável, nunca `pass`;
- download valida tenant, empresa, versão, tipo, tamanho e hash;
- artefato divergente é bloqueado e gera incidente auditável.

## 20. Invariantes

| ID | Invariante |
|---|---|
| I-1 | toda entidade empresarial persiste tenant e empresa e respeita RLS |
| I-2 | consulta ou mutação sem contexto autorizado não retorna existência nem conteúdo |
| I-3 | valores contábeis usam decimal exato; `float` é proibido |
| I-4 | um pacote só é aplicado à cobertura oficial declarada; ausência vira `INDETERMINATE` |
| I-5 | registros e totalizadores derivam deterministicamente de entradas versionadas |
| I-6 | preparador e aprovador de uma revisão são pessoas distintas |
| I-7 | versão formalizada, artefatos e proveniência são imutáveis e nunca apagados |
| I-8 | correção cria versão sucessora e preserva integralmente a anterior |
| I-9 | formalização é idempotente e não publica resultado parcial |
| I-10 | nenhum fluxo acessa certificado, chave privada ou executa assinatura |
| I-11 | datas civis não têm fuso; instantes são UTC e exibidos em `America/Sao_Paulo` |
| I-12 | hashes usam o instante imutável da revisão, não o download |
| I-13 | diagnóstico local nunca é apresentado como validação PVA |
| I-14 | F49 não altera lançamentos, saldos, fechamentos, plano referencial ou livros F48 |

## 21. Testes e evidências

### 21.1 Regras

- seleciona pacote somente por cobertura exata;
- gera G, R, A, B e Z com registros obrigatórios e condicionais aplicáveis;
- rejeita forma sem estrutura auxiliar publicada;
- reconcilia BP, DRE e DLPA/DMPL com razão e snapshots;
- rejeita signatário incompleto, J800 inválido e autoaprovação;
- invalida prévia e revisão quando qualquer entrada muda;
- preserva bytes, contagens, totalizadores e hashes em regeneração equivalente.

### 21.2 Banco e autorização

- RLS e carteira isolam tenant e empresa em todas as entidades;
- restrições impedem duas versões correntes e revisão pelo preparador;
- concorrência não duplica formalização nem artefato;
- auditoria append-only preserva transições, decisões e negativas;
- versão formalizada não aceita update ou delete.

### 21.3 Artefatos

- golden files por forma e cenário;
- parser independente executa round-trip do TXT;
- manifesto confere pacote, fontes, contagens e hashes;
- download repetido retorna bytes idênticos;
- bit alterado no TXT, manifesto, diagnóstico ou anexo é detectado;
- teste negativo prova ausência de assinatura, recibo e alegação de PVA.

### 21.4 Tela e E2E

- prepara cada uma das cinco formas;
- mantém auxiliares, demonstrações, signatários e J800;
- bloqueia e orienta pendências nominalmente;
- submete, recusa autoaprovação, aprova com outro usuário e formaliza;
- consulta versão vigente, `STALE`, superada e histórico;
- baixa e confere os três artefatos;
- cobre loading, vazio, `INDETERMINATE`, falha, conflito, acesso negado e empresa fora da carteira;
- prova temas CLARO/ESCURO, 768/1024/1440, teclado, foco, contraste e anúncios;
- compara capturas com a referência e evidencia a remoção das alegações indevidas do protótipo.

Comandos obrigatórios:

```bash
pnpm lint
pnpm typecheck
pnpm test:regras
pnpm test:banco
pnpm test:tela
pnpm test:e2e
pnpm build
pnpm docker:up
pnpm docker:ps
```

## 22. Critérios de aceite

- [ ] Lucro Presumido e Simples opcional são tratados sem inferir obrigação legal.
- [ ] Exercício completo e situação especial usam períodos contínuos e integralmente fechados.
- [ ] Pacote oficial versionado inicia no Leiaute 9/ADE Cofis nº 1/2026 e preserva fonte e hash.
- [ ] Formas G, R, A, B e Z são geradas somente com seus pré-requisitos completos.
- [ ] Livros auxiliares e leiaute parametrizável possuem versões imutáveis e origem determinística.
- [ ] BP, DRE contábil e DLPA/DMPL reconciliam com razão, saldos e fechamentos.
- [ ] Contador e representante legal são versionados e fotografados sem assinatura digital.
- [ ] J800 preserva ordem, conteúdo, varredura, proveniência e hash.
- [ ] Preparador e aprovador são pessoas distintas e revisão vencida não formaliza.
- [ ] TXT, manifesto e diagnóstico são imutáveis, reproduzíveis e coerentes entre si.
- [ ] Parser independente confirma estrutura, contagens e totalizadores do TXT.
- [ ] Sucessão interna preserva versões anteriores e nunca afirma substituição oficial.
- [ ] RLS, carteira, idempotência e auditoria impedem vazamento, duplicação e reescrita.
- [ ] Nenhuma operação valida no PVA, assina, registra, transmite ou produz Bloco K.
- [ ] UI final segue a referência corrigida, os dois temas e as provas de `FRONTEND.md` §20.1.
- [ ] Relatórios de regras, banco, API, artefatos, tela e E2E são rastreáveis à SPEC-049 e à issue #63.

## 23. Fora de escopo e destino obrigatório

| Complemento | Destino obrigatório |
|---|---|
| Validação no PVA e correções orientadas pelo validador | fatia própria de validação da ECD no MVP-2 |
| Assinatura digital da ECD | fatia própria de assinatura da ECD no MVP-2, consumindo o Signer da F12 |
| Autenticação ou registro oficial de livros | fatia própria de registro oficial de livros no MVP-2 |
| Transmissão, recibo e substituição oficial | fatia própria de entrega e substituição da ECD no MVP-2 |
| Escrituração consolidada e Bloco K | fatia própria de consolidação societária e ECD consolidada no MVP-2 |
| Inferência de obrigatoriedade, dispensa ou prazo | motor completo de obrigações do MVP-2 |
| Livros fiscais e SPED Fiscal | fatias próprias de livros fiscais e SPED Fiscal do MVP-2 |
| ECF, Lalur, Lacs e recuperação da ECD | fatias próprias de IRPJ/CSLL e ECF do MVP-2 |
| Outros regimes além de Lucro Presumido e Simples opcional | expansão contábil por regime em fatias próprias do MVP-2 |
| Storage, credenciais, retenção e operação produtivos | gate de Produção posterior ao MVP-4 |

## 24. Dúvidas resolvidas pelo PI

- A F49 gera o arquivo ECD, sem PVA, assinatura ou transmissão.
- Entram Lucro Presumido e Simples Nacional opcional, sem inferência de obrigação.
- O recorte é exercício completo ou situação especial explícita.
- O leiaute usa pacote oficial versionado, iniciando no Leiaute 9/ADE Cofis nº 1/2026.
- Entram as formas G, R, A, B e Z e seus modelos auxiliares.
- A F49 é uma exceção `Enorme` explicitamente autorizada pelo PI.
- Entram BP, DRE contábil e DLPA/DMPL próprios; a DRE gerencial não é equivalente automática.
- Bloco K não entra.
- Signatários usam cadastro próprio versionado, sem assinatura.
- Correção gera versão interna sucessora, não ECD substituta oficial.
- Preparador e aprovador são pessoas distintas.
- Artefatos são TXT, manifesto JSON e diagnóstico local.
- A UI é uma Central ECD dedicada.
- Anexos J800 entram com integridade e proveniência.
- Questões abertas: **Nenhuma**.

## 25. Gate de conformidade

| Verificação | Evidência |
|---|---|
| Identidade | cabeçalho e §§1–2 |
| Comportamento observável | §§3–15 |
| Aceite verificável | §§21–22 |
| Invariantes | §20 |
| Fora de escopo | §23, com destinos nomeados |
| Dúvidas resolvidas | §24, sem questão aberta |
| Contratos públicos | §§18–19 |
| UI | §17, com referência, estados, temas, viewports e skills obrigatórias |

## 26. Aprovação

Fronteira, cobertura, pacote, cinco formas, auxiliares, demonstrações, signatários, J800, segregação, artefatos, sucessão interna, interface, provas, destinos e exceção de tamanho aprovados pelo PI em 25/09/2026. A implementação deve seguir esta SPEC sem inferir obrigação, alegar validação PVA ou produzir assinatura, registro, transmissão ou efeito oficial externo; lacuna material volta ao PI.
