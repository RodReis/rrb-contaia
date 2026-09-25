# SPEC-048 — Livros contábeis formais por empresa

> **Fatia:** F48
> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Origem:** PRD v3.1 §§3, 4.2, 6.2, 6.5, 12, 14, 15 e 16
> **Estado:** aprovada pelo PI em 25/09/2026

## 1. Objetivo

Entregar a formalização interna, reproduzível e auditável do Livro Diário Geral e do Livro Razão Analítico de cada empresa, para exercício civil completo ou situação especial, consumindo exclusivamente lançamentos efetivados, saldos de abertura aprovados e competências fechadas pelas F40–F44.

A fatia produz representação humana em PDF e dados abertos equivalentes em CSV e JSON. Não gera ECD, assinatura digital, autenticação, registro em Junta Comercial, validação em PVA, transmissão ou qualquer efeito oficial externo.

## 2. Usuários e resultado observável

- `admin_escritorio` seleciona qualquer empresa do tenant, valida o período, consulta a prévia e formaliza os livros;
- `contador` executa as mesmas ações apenas para empresa de sua carteira ativa;
- `auxiliar` e `auditor_readonly` consultam versões e artefatos conforme alçada, sem formalizar;
- demais papéis são negados por padrão;
- o usuário identifica nominalmente cada impedimento antes de formalizar;
- uma formalização bem-sucedida entrega Diário, Razão, termos, paginação, número do livro, hashes e histórico imutável.

## 3. Dependências e fonte contábil

A versão formal deriva somente de:

- catálogo e identidades imutáveis de contas e centros da F39;
- lançamentos efetivados, cancelamentos e estornos da F40/F41;
- razão persistido e reconstruível da F42;
- snapshots mensais fechados e sequência de competências da F43;
- saldo de abertura aprovado e movimento `OPENING` da F44.

O plano referencial da F47 não é pré-requisito dos livros desta fatia. A F48 não cria nem corrige conta, centro, lançamento, saldo, competência ou vínculo referencial.

## 4. Recorte temporal

Cada solicitação fixa empresa e um dos recortes:

- `ORDINARY_YEAR`: 1º de janeiro a 31 de dezembro de um exercício civil;
- `SPECIAL_PERIOD`: intervalo civil contínuo dentro de um exercício, associado a tipo e justificativa informados pelo usuário.

Todas as competências mensais alcançadas precisam estar fechadas, sem lacuna, e seus snapshots precisam permanecer íntegros. Situação especial, datas ou motivo não são inferidos de cadastro, regime, evento societário ou histórico.

Período sem movimento pode ser pré-visualizado, mas não é formalizado: retorna diagnóstico explícito `ACCOUNTING_BOOK_NO_ENTRIES`. Datas civis não sofrem conversão de fuso.

## 5. Conteúdo do Livro Diário Geral

O Diário apresenta, em ordem determinística por data contábil, número sequencial do lançamento e identidade estável:

- data, número, histórico e origem do lançamento;
- linhas de débito e crédito com código e nome fotografados da conta;
- centro de custo quando presente;
- valor monetário decimal exato;
- referência a cancelamento ou estorno, sem apagar o lançamento original;
- totais por lançamento, competência e período;
- saldo de abertura como movimento próprio quando pertencente ao recorte.

Cada lançamento permanece indivisível na ordenação e na paginação lógica. Empate usa identidade estável, nunca instante de download.

## 6. Conteúdo do Livro Razão Analítico

O Razão apresenta uma seção por conta analítica movimentada, ordenada pelo código imutável da F39, contendo:

- identificação fotografada da conta e natureza contábil;
- saldo anterior ao início do recorte;
- data, lançamento, histórico, centro, contrapartida quando determinável, débito, crédito e saldo após cada movimento;
- cancelamentos e estornos rastreáveis;
- totais de débito, crédito e saldo final da conta;
- totalizadores reconciliados com o Diário e com os snapshots da F43.

Ausência de contrapartida unitária, como em lançamento composto, é apresentada de forma explícita e não produz associação inventada.

## 7. Termos e responsáveis

O PDF contém termo de abertura antes da primeira página de conteúdo e termo de encerramento após a última. Ambos fotografam:

- razão social, CNPJ e endereço cadastral da empresa;
- tipo, número, período e quantidade de páginas do livro;
- exercício ou tipo e justificativa da situação especial;
- nome, CPF, CRC e UF do contador responsável;
- versão, hash canônico e instante de formalização em UTC;
- declaração inequívoca de que se trata de formalização interna sem assinatura, autenticação, registro ou transmissão oficial.

Empresa ou contador com dado obrigatório ausente ou inválido bloqueiam a formalização. A prévia lista campo, origem cadastral e caminho de correção; nenhum dado é inferido ou preenchido no contexto dos livros.

## 8. Prévia e formalização

A prévia:

- valida autorização, período, competências, snapshots, saldos, cadastro e existência de movimentos;
- calcula contagens, totais, paginação prevista e hashes de entrada;
- exibe impedimentos e avisos nominalmente;
- pode gerar amostra visual marcada como `PRÉVIA — SEM VALIDADE`;
- não reserva número, não cria versão e não altera estado contábil.

A formalização exige prévia válida, confirmação humana e `expectedRevision`. Na mesma transação lógica:

- revalida todas as entradas e hashes;
- reserva o próximo número do tipo de livro na empresa;
- cria a versão imutável;
- fixa conteúdo, termos, paginação, fontes e `revisionCreatedAtUtc`;
- marca como `SUPERSEDED` a versão formal anterior do mesmo tipo e recorte, quando existir;
- registra auditoria append-only.

Falha em qualquer etapa não consome número nem deixa artefato parcial.

## 9. Numeração e versões

- Diário e Razão mantêm sequências independentes, monotônicas e contínuas por empresa;
- a sequência não reinicia por exercício ou situação especial;
- número só é atribuído na formalização concluída;
- número formalizado nunca é reutilizado, mesmo após superação;
- cada tipo e recorte possui no máximo uma versão `FORMALIZED` corrente;
- versões anteriores passam a `SUPERSEDED`, permanecem consultáveis e preservam seu número;
- não existe edição, exclusão física nem retorno de versão formalizada a prévia.

Diário e Razão do mesmo pedido são formalizados atomicamente como um conjunto, mas recebem números de suas sequências próprias.

## 10. Reabertura e correção

Uma versão formalizada nunca é reescrita. Corrigir conteúdo exige:

1. reabrir na F43 a competência afetada;
2. corrigir por lançamento de estorno ou novo lançamento permitido pelas fatias contábeis;
3. fechar novamente toda competência aberta do intervalo;
4. gerar nova prévia e formalizar versão sucessora.

A reabertura não apaga nem altera livros existentes. Ela marca a versão corrente afetada como `STALE` para nova utilização operacional, preservando sua condição histórica e os artefatos originais. A versão só passa a `SUPERSEDED` quando uma sucessora é formalizada.

## 11. Artefatos e reprodução

Cada versão produz:

- PDF/A ou PDF determinístico conforme a biblioteca aprovada na implementação, com Diário, Razão e termos;
- CSV separado para Diário e Razão, em UTF-8, com cabeçalho versionado;
- JSON canônico contendo metadados, termos, movimentos, totalizadores e proveniência;
- manifesto com hashes SHA-256 de cada artefato e hash canônico do conjunto.

PDF, CSV e JSON representam o mesmo conjunto de movimentos e totalizadores. Metadados operacionais de download não entram no conteúdo canônico. Repetir a geração para a mesma versão produz os mesmos hashes; o instante imutável usado é `revisionCreatedAtUtc`, não o horário do download.

## 12. Autorização, isolamento e auditoria

- versões, prévias e artefatos carregam `tenant_id` e `empresa_id`, indexados e sob RLS;
- consulta sem tenant ou fora da empresa autorizada retorna nada;
- mutações não aceitam tenant ou empresa livre fora do contexto autorizado;
- prévia, formalização, conflito, download e tentativa negada relevante geram auditoria append-only;
- auditoria registra autor, empresa, período, tipos, versões, números, hashes, resultado, instante UTC e `correlationId`;
- download não altera hash, versão ou estado do livro;
- nenhum evento afirma validade, entrega ou registro oficial.

## 13. Interface

A tela é acessada por:

- `Empresa -> Estrutura contábil -> Livros contábeis`;
- `Contábil -> Livros contábeis`, com seleção prévia de empresa acessível.

A direção visual parte de `docs/telas/contaia_central_de_escritura_o_sped_ecd_malha_fiscal_preventiva_rf_03/code.html`, usando a área de Livro Diário e Razão, sem reproduzir as alegações de PVA, ECD pronta ou transmissão do protótipo.

A interface contém:

- empresa, exercício, tipo de período e intervalo;
- diagnóstico das competências e dos snapshots consumidos;
- checklist cadastral da empresa e do contador;
- totalizadores e reconciliação Diário × Razão;
- prévia paginada dos termos e de amostras dos livros;
- confirmação explícita de formalização interna;
- downloads independentes e manifesto;
- histórico com números, versões, estados, hashes e motivo de superação.

Estados obrigatórios:

- loading inicial e atualização preservando último estado válido;
- sem movimentos, período incompleto, competência aberta e snapshot divergente;
- cadastro incompleto com caminho de correção;
- prévia gerando, válida, inválida e expirada;
- formalização em andamento, concluída, conflito e falha;
- versão vigente, `STALE`, `SUPERSEDED` e histórico vazio;
- geração ou download indisponível;
- acesso negado e empresa fora da carteira.

Toast Sonner confirma operações, sem `alert` e sem substituir o estado persistente. Temas CLARO/ESCURO, viewports 768/1024/1440, teclado, foco, contraste e anúncios seguem `docs/FRONTEND.md` §20.1. `frontend-design` é obrigatória antes e durante a implementação; `impeccable` é obrigatório no passe final.

## 14. Contratos públicos mínimos

```ts
type AccountingBookType = 'GENERAL_JOURNAL' | 'GENERAL_LEDGER';
type AccountingBookPeriodType = 'ORDINARY_YEAR' | 'SPECIAL_PERIOD';
type AccountingBookStatus = 'FORMALIZED' | 'STALE' | 'SUPERSEDED';

interface AccountingBookPeriod {
  type: AccountingBookPeriodType;
  startDate: string;
  endDate: string;
  specialSituationType: string | null;
  specialSituationReason: string | null;
}

interface AccountingBookVersion {
  bookVersionId: string;
  companyId: string;
  bookType: AccountingBookType;
  bookNumber: number;
  version: number;
  period: AccountingBookPeriod;
  status: AccountingBookStatus;
  pageCount: number;
  canonicalSha256: string;
  revisionCreatedAtUtc: string;
  revision: number;
}

interface AccountingBookSet {
  bookSetId: string;
  companyId: string;
  period: AccountingBookPeriod;
  journal: AccountingBookVersion;
  ledger: AccountingBookVersion;
  manifestSha256: string;
}
```

Operações necessárias:

- validar elegibilidade e listar impedimentos;
- criar e consultar prévia sem efeito;
- formalizar Diário e Razão atomicamente com `expectedRevision`;
- listar e consultar conjuntos e versões históricas;
- baixar PDF, CSV, JSON e manifesto por versão autorizada;
- consultar auditoria relacionada.

Erros de domínio incluem no mínimo:

- `ACCOUNTING_BOOK_PERIOD_INVALID`;
- `ACCOUNTING_BOOK_PERIOD_NOT_CLOSED`;
- `ACCOUNTING_BOOK_PERIOD_GAP`;
- `ACCOUNTING_BOOK_SNAPSHOT_MISMATCH`;
- `ACCOUNTING_BOOK_NO_ENTRIES`;
- `ACCOUNTING_BOOK_REGISTRATION_INCOMPLETE`;
- `ACCOUNTING_BOOK_NOT_RECONCILED`;
- `ACCOUNTING_BOOK_PREVIEW_EXPIRED`;
- `ACCOUNTING_BOOK_VERSION_CONFLICT`;
- `ACCOUNTING_BOOK_FORBIDDEN`.

HTTP segue `application/problem+json` com `type`, `title`, `status`, `code` e `correlationId`. DTO externo é validado antes do domínio e nunca é entidade de persistência.

## 15. Persistência, concorrência e determinismo

- prévia, conjunto, versões por tipo, sequência, artefatos e manifesto são persistidos separadamente;
- a prévia guarda revisão esperada e hashes dos snapshots, cadastros e movimentos;
- confirmação revalida tudo antes de reservar os dois números;
- números, versões e troca de estados são transacionais;
- concorrência real para a mesma empresa não duplica número nem produz duas versões correntes do mesmo recorte;
- ordenação canônica usa data contábil, sequência do lançamento e identidade estável;
- valores usam decimal exato, nunca `float`;
- hash inclui período, conteúdo, termos fotografados, paginação, versão e `revisionCreatedAtUtc`;
- alteração cadastral posterior não reescreve termo formalizado;
- nenhuma operação altera lançamentos, razão, saldo de abertura ou snapshot de fechamento.

## 16. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| I-1 | prévias, conjuntos, versões e artefatos possuem tenant e empresa, indexados e sob RLS |
| I-2 | consulta e download respeitam tenant, empresa e carteira; ausência de contexto não vaza dados |
| I-3 | valores monetários usam inteiro em centavos no domínio e formatação decimal exata nos artefatos; `float` é proibido |
| I-4 | ordenação, totalização, paginação e hashes são determinísticos; LLM não compõe livro nem corrige dado |
| I-5 | formalização interna exige confirmação humana explícita e não produz efeito externo |
| I-6 | formalização, superação, download e negativas relevantes deixam trilha append-only |
| I-7 | versão formalizada, termos, artefatos e proveniência não são apagados ou reescritos |
| I-11 | períodos usam datas civis; instantes são UTC e exibidos em `America/Sao_Paulo` |
| I-12 | snapshots, cadastros fotografados e `revisionCreatedAtUtc` reproduzem os artefatos no futuro |

## 17. Testes e evidências

### 17.1 Regras

- aceita exercício completo e situação especial explícita;
- rejeita período inválido, lacuna, competência aberta e snapshot divergente;
- rejeita formalização sem movimentos ou com cadastro obrigatório incompleto;
- ordena Diário e Razão deterministicamente;
- reconcilia débitos, créditos e saldos entre livros e snapshots;
- trata lançamento composto sem inventar contrapartida;
- reserva sequências independentes e nunca reutiliza número;
- preserva versão anterior após reabertura e cria sucessora somente após novo fechamento.

### 17.2 Banco

- RLS positiva e negativa entre tenants e empresas;
- carteira do contador e leitura dos demais papéis;
- concorrência real das sequências e da formalização;
- unicidade da versão corrente por tipo e recorte;
- atomicidade do conjunto Diário/Razão;
- imutabilidade de versões, termos, artefatos e manifesto;
- auditoria append-only e hash reproduzível.

### 17.3 API e artefatos

- prévia não reserva número nem cria versão;
- alteração entre prévia e confirmação expira a prévia;
- PDF, CSV e JSON têm os mesmos movimentos e totais;
- nova descarga mantém hashes;
- manifesto detecta artefato divergente;
- retorna problemas com códigos estáveis;
- não expõe artefato fora do tenant, empresa ou carteira.

### 17.4 Tela e E2E

- seleciona exercício ordinário e situação especial;
- diagnostica fechamento, movimentos e cadastro;
- bloqueia e orienta cada pendência nominal;
- mostra prévia marcada sem validade;
- formaliza atomicamente e oferece os quatro downloads;
- consulta versão vigente, `STALE`, superada e histórico;
- cobre loading, vazio, falha, conflito, acesso negado e empresa fora da carteira;
- prova temas CLARO/ESCURO, 768/1024/1440, teclado, foco, contraste e anúncios;
- compara capturas com a referência e registra a remoção das alegações oficiais indevidas do protótipo.

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

## 18. Critérios de aceite

- [ ] Diário Geral e Razão Analítico são gerados para exercício ou situação especial com intervalo contínuo e integralmente fechado.
- [ ] O conjunto usa somente movimentos efetivados, saldo de abertura e snapshots reproduzíveis das F40–F44.
- [ ] Período sem movimento, competência aberta, lacuna ou divergência bloqueiam formalização com diagnóstico explícito.
- [ ] Termos fotografam empresa e contador; campo obrigatório ausente bloqueia sem inferência.
- [ ] Prévia é sem efeito, identificada como tal e expira quando qualquer entrada relevante muda.
- [ ] Diário e Razão são formalizados atomicamente, com números próprios, sequenciais, monotônicos e não reutilizáveis.
- [ ] Versão formalizada é imutável; reabertura a torna `STALE` sem apagar artefatos e correção exige sucessora após novo fechamento.
- [ ] PDF, CSV e JSON representam o mesmo conteúdo; manifesto e hashes são reproduzíveis.
- [ ] Admin e contador formalizam conforme tenant e carteira; demais papéis respeitam leitura ou negação.
- [ ] RLS e auditoria impedem vazamento e preservam todas as decisões relevantes.
- [ ] Nenhuma operação assina, autentica, registra, valida em PVA, gera ECD ou transmite livro.
- [ ] UI final segue a referência concreta, os dois temas e todas as provas de `FRONTEND.md` §20.1.
- [ ] Relatórios de regras, banco, API, artefatos, tela e E2E ficam rastreáveis à SPEC-048 e à issue correspondente.

## 19. Fora de escopo e destino obrigatório

| Complemento | Destino obrigatório |
|---|---|
| Geração dos registros e arquivo ECD | fatia própria de geração da ECD do MVP-2 |
| Validação no PVA e correções orientadas pelo validador | fatia própria de validação da ECD do MVP-2 |
| Assinatura digital de livros ou ECD | fatia própria de assinatura da ECD do MVP-2, consumindo o Signer da F12 |
| Autenticação, registro em Junta Comercial ou órgão competente | fatia própria de registro oficial de livros do MVP-2 |
| Transmissão, recibo e substituição oficial da ECD | fatia própria de entrega da ECD do MVP-2 |
| Livros fiscais e SPED Fiscal | fatias próprias de livros fiscais e SPED Fiscal do MVP-2 |
| Lalur, Lacs, ECF e recuperação da ECD pela ECF | fatias próprias de IRPJ/CSLL e ECF do MVP-2 |
| Razão auxiliar com formato ou exigência externa específica | fatia própria de livros auxiliares do MVP-2 |
| Atualização cadastral da empresa ou contador | capacidade cadastral própria; a F48 apenas diagnostica e consome o dado aprovado |
| Armazenamento produtivo, retenção legal externa e credenciais reais | gate de Produção posterior ao MVP-4 |

## 20. Dúvidas resolvidas pelo PI

- F48 cobre livros contábeis antes da geração da ECD.
- Entram Livro Diário Geral e Livro Razão Analítico.
- O recorte é exercício completo ou situação especial explícita.
- Os artefatos são PDF, CSV e JSON, acompanhados de manifesto.
- A formalização é somente interna, sem assinatura, registro ou transmissão oficial.
- Correção exige reabertura, novo fechamento e versão sucessora; a anterior é preservada.
- A numeração é automática, monotônica por empresa e tipo e nunca reutilizada.
- Dado obrigatório ausente nos termos bloqueia formalização.
- Termos exigem empresa e contador responsável, com CPF, CRC e UF quando aplicáveis.
- Questões abertas: **Nenhuma**.

## 21. Gate de conformidade

| Verificação | Evidência |
|---|---|
| Identidade | cabeçalho e §§1–2 |
| Comportamento observável | §§3–13 |
| Aceite verificável | §§17–18 |
| Invariantes | §16 |
| Fora de escopo | §19, com destinos nomeados |
| Dúvidas resolvidas | §20, sem questão aberta |
| Contratos públicos | §§14–15 |
| UI | §13, com referência concreta, estados, temas, viewports e skills obrigatórias |

## 22. Aprovação

Fronteira, livros, período, artefatos, termos, responsáveis, numeração, ciclo corretivo, autorização, interface, provas e destinos aprovados pelo PI em 25/09/2026. A implementação deve seguir esta SPEC sem afirmar validade oficial, preencher cadastro ausente ou gerar efeito externo; lacuna material volta ao PI.
