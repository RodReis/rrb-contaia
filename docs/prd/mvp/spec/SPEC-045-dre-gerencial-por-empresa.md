# SPEC-045 / F45 — DRE gerencial por empresa

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD §§3, 6.2, 6.5, 7.1, 12, 14, 15 e 16; F39/SPEC-039, F42/SPEC-042, F43/SPEC-043 e F44/SPEC-044
>
> **Estado:** aprovada pelo PI em 25/09/2026
>
> **Tamanho:** Grande — estrutura configurável e versionada por empresa, cálculo sintético/analítico, comparação, exportações, auditoria e interface final; modelos reutilizáveis do escritório foram separados para F46/SPEC-046
>
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #59

## 1. Objetivo

Entregar a Demonstração do Resultado gerencial por empresa, alimentada exclusivamente pelo razão contábil da F42 e apresentada por uma estrutura configurada explicitamente pelo contador. A DRE permite acompanhar competência aberta como prévia e consultar competência fechada de forma reproduzível, nas visões sintética e analítica, mensal e acumulada no exercício.

Sucesso significa que todo valor exibido reconcilia com o razão; nenhuma conta de resultado movimentada é ignorada ou classificada por inferência; competências fechadas preservam a estrutura e os números usados no fechamento; e PDF/CSV somente são emitidos quando a cobertura das contas é integral.

## 2. Fronteira da fatia

Esta fatia entrega:

- uma estrutura de DRE configurável por empresa;
- linhas-base vinculadas explicitamente a contas analíticas de resultado;
- subtotais calculados por operações tipadas e determinísticas;
- rascunho, validação, publicação e versionamento por vigência;
- vínculo de cada conta elegível com exatamente uma linha-base da versão;
- prévia dinâmica para competências abertas;
- resultado reproduzível para competências fechadas;
- visões mensal e acumulada no exercício, sintética e analítica;
- análise vertical e horizontal contra o período equivalente anterior;
- identificação explícita das contas movimentadas sem vínculo;
- exportações PDF executivo e CSV analítico, com hash reproduzível;
- histórico, concorrência otimista e auditoria append-only;
- interface final nos temas CLARO e ESCURO.

Não entrega modelos reutilizáveis do escritório, consolidação multiempresa, orçamento, DFC, projeção de caixa, indicadores Dupont/liquidez, IA preditiva, ECD, plano referencial, livros fiscais, SPED, transmissão ou produção.

## 3. Conceitos e ciclo de vida

### 3.1 Estrutura e versão

- a unidade é `(tenant, empresa)`;
- cada empresa pode ter vários rascunhos, mas no máximo uma versão publicada aplicável a cada competência;
- os estados são `DRAFT`, `ACTIVE` e `SUPERSEDED`;
- um rascunho não afeta consultas nem exportações;
- publicar cria uma versão imutável com competência inicial explícita;
- a versão anterior permanece aplicável até a competência imediatamente anterior à nova vigência;
- uma versão publicada nunca é editada, apagada ou devolvida a rascunho;
- publicar uma nova versão preserva versões e relatórios históricos;
- número da versão cresce monotonicamente por empresa e nunca é reaproveitado;
- somente contador ou administrador autorizado publica;
- concorrência usa `expectedRevision`; publicação sobre revisão vencida falha sem mesclar silenciosamente.

### 3.2 Linhas

Uma estrutura contém árvore ordenada com dois tipos:

- `DETAIL`: linha-base que recebe contas analíticas;
- `SUBTOTAL`: linha calculada por soma ou subtração de linhas anteriores da mesma estrutura.

Cada linha possui código, título, tipo, ordem, nível visual e sinal de apresentação. Regras:

- código é único dentro da versão;
- árvore não aceita ciclo, órfão ou nível inválido;
- `DETAIL` não contém fórmula e pode receber contas;
- `SUBTOTAL` não recebe conta e usa somente referências explícitas a linhas anteriores;
- operadores admitidos são `ADD` e `SUBTRACT`; fórmula textual ou executável é proibida;
- toda referência deve pertencer à mesma versão;
- subtotal sem componente, referência duplicada ou dependência circular bloqueia publicação;
- sinal de apresentação não altera o saldo de origem nem permite dupla contagem.

### 3.3 Vínculo contábil

- somente conta analítica de resultado, ativa ou historicamente válida, pode ser vinculada;
- uma conta pode alimentar exatamente uma linha `DETAIL` em cada versão;
- conta sintética, patrimonial, inexistente ou de outra empresa é recusada;
- arquivamento posterior da conta não apaga o vínculo histórico;
- centro de custo pode detalhar o valor, mas não muda a linha-base da conta nesta fatia;
- não há rateio de uma conta entre linhas;
- não há classificação automática por nome, código, classe genérica, LLM ou similaridade.

## 4. Vigência e competências

- vigência é uma competência civil `AAAA-MM`;
- a primeira versão pode começar na primeira competência com razão disponível;
- nova versão deve começar após a última competência fechada que já utilizou a versão anterior;
- competência fechada sempre consulta a versão e o snapshot associados ao fechamento da F43;
- reabertura preserva o snapshot anterior no histórico e volta a apresentar prévia dinâmica;
- novo fechamento gera novo snapshot com a versão vigente e hash próprios;
- versão futura não altera prévias anteriores à sua vigência;
- duas versões não podem disputar a mesma competência;
- ausência de versão aplicável impede a DRE e orienta o usuário a configurar e publicar uma estrutura.

## 5. Fonte dos valores e reconciliação

- a única fonte monetária é a projeção do razão da F42;
- abertura aprovada da F44 compõe o razão, mas contas patrimoniais não entram na DRE;
- entram somente movimentos efetivados, cancelamentos e estornos conforme o estado reconhecido pela F42;
- rascunhos da F40/F41 não entram;
- cada valor mantém referência às contas e movimentos que o compõem;
- valores são inteiros em centavos; percentuais são derivados sem float e arredondados apenas para apresentação;
- soma das linhas analíticas deve reconciliar exatamente com o conjunto de contas de resultado movimentadas no período;
- o sistema não cria lançamento, contrapartida ou ajuste para fazer a DRE fechar;
- divergência entre DRE e razão é erro de integridade, nunca aviso descartável.

## 6. Períodos e comparações

O usuário seleciona empresa e competência-base. A consulta oferece:

- `MONTH`: movimentos da competência selecionada;
- `YEAR_TO_DATE`: movimentos de janeiro até a competência selecionada;
- visão `SYNTHETIC`: linhas e subtotais da estrutura;
- visão `ANALYTIC`: linhas, contas vinculadas e valores por conta.

A comparação usa o período equivalente do exercício anterior:

- mês contra o mesmo mês anterior;
- acumulado contra janeiro até o mesmo mês anterior;
- ausência de base comparável retorna `NOT_AVAILABLE`, nunca zero inferido;
- análise horizontal em centavos é `atual - anterior`;
- percentual horizontal com base anterior zero ou mudança de sinal retorna `NOT_APPLICABLE` e conserva os valores absolutos;
- análise vertical usa como denominador a linha-base de receita marcada explicitamente na estrutura;
- exatamente uma linha `DETAIL` ou `SUBTOTAL` deve ser a base de AV;
- denominador zero retorna `NOT_APPLICABLE` sem divisão artificial.

Orçamento, metas e projeções não entram na comparação desta fatia.

## 7. Cobertura e pendências

Antes de apresentar a DRE, o sistema identifica todas as contas de resultado com movimento no período consultado.

- conta movimentada sem vínculo torna o resultado `INCOMPLETE`;
- a tela continua exibindo uma prévia, mas a identifica como incompleta;
- painel de pendências lista conta, descrição, saldo do período e ação para abrir o rascunho da estrutura;
- valor pendente não é inserido numa linha residual e não é ocultado;
- PDF e CSV ficam bloqueados enquanto houver pendência;
- competência não pode ser apresentada como definitiva com pendência de cobertura;
- conta vinculada mais de uma vez é erro estrutural e bloqueia publicação;
- período sem movimento é um estado vazio válido, desde que exista estrutura aplicável.

## 8. Competência aberta e fechada

### 8.1 Aberta

- estado visual `PRÉVIA — COMPETÊNCIA ABERTA`;
- valores refletem a projeção atual do razão;
- inclusão, cancelamento ou estorno efetivado invalida o cache e altera a prévia;
- hash da consulta identifica dados e versão usados, mas não promete imutabilidade;
- exportação é permitida somente com cobertura integral e traz a marca `PRÉVIA`.

### 8.2 Fechada

- estado visual `DEFINITIVA — COMPETÊNCIA FECHADA`;
- usa o snapshot reproduzível da F43 e a versão de estrutura registrada no fechamento;
- repetição da consulta e da exportação devolve os mesmos valores e o mesmo hash;
- alteração posterior do catálogo ou publicação de nova estrutura não muda o resultado;
- reabertura e novo fechamento criam nova revisão, preservando a anterior na auditoria.

## 9. Exportações

### 9.1 PDF executivo

Inclui:

- empresa e CNPJ mascarado conforme o contrato visual;
- período, modo mensal/acumulado e estado aberta/fechada;
- versão e vigência da estrutura;
- DRE sintética com atual, anterior, AV e AH;
- indicação de prévia quando aplicável;
- data/hora de geração, autor e hash SHA-256;
- paginação e identificação visual nos temas de impressão definidos pelo frontend.

### 9.2 CSV analítico

Usa UTF-8, cabeçalho estável e uma linha por combinação de linha-base e conta. Contém no mínimo:

`empresa_id`, `competencia_base`, `period_mode`, `statement_version`, `statement_line_code`, `statement_line_title`, `account_code`, `account_name`, `current_cents`, `previous_cents`, `vertical_basis_points`, `horizontal_basis_points`, `report_status` e `report_hash`.

Regras comuns:

- os dois formatos nascem do mesmo resultado canônico;
- conteúdo canônico, versão, período e fontes formam o hash;
- falha parcial não gera arquivo anunciado como válido;
- exportação não é ECD, livro oficial ou artefato para transmissão.

## 10. Interface

Referência de conteúdo e hierarquia:

- `docs/telas/contaia_relat_rios_gerenciais_avan_ados_dre_sint_tica_anal_tica_rf_04/code.html`;
- `docs/telas/contaia_relat_rios_gerenciais_avan_ados_dre_sint_tica_anal_tica_rf_04/screen.png`.

Rotas funcionais:

- `Empresa -> DRE gerencial` abre a consulta da empresa corrente;
- `Contábil -> DRE` exige escolher uma empresa da carteira antes da consulta;
- `Configurar estrutura` abre o editor por empresa sem transformar o relatório em edição inline.

A tela final preserva a direção visual aprovada, mas corrige o protótipo:

- remove orçamento, DFC, projeção de caixa, ECD, IA e indicadores não entregues;
- não exibe valores fictícios nem selos de auditoria sem prova;
- mostra filtros de competência, mensal/acumulado e sintético/analítico;
- mantém totais, AV/AH, versão, estado e cobertura visíveis;
- expande linhas analíticas por teclado e ponteiro;
- informa `N/A` com motivo acessível, não apenas por cor;
- bloqueio de exportação explica e aponta as contas pendentes;
- usa Toast Sonner para confirmação e erro; nunca `alert`.

Estados obrigatórios:

- loading e atualização sem apagar o último resultado válido;
- sem estrutura publicada;
- sem movimento no período;
- prévia aberta completa;
- prévia aberta incompleta;
- fechada definitiva;
- comparação indisponível;
- erro de integridade/reconciliação;
- exportação em andamento, concluída e falha;
- acesso negado e empresa fora da carteira.

Provas visuais obrigatórias seguem `docs/FRONTEND.md` §20.1, nos temas CLARO e ESCURO e nos viewports de desktop e mobile definidos ali. `frontend-design` é obrigatória antes e durante a implementação; `impeccable` é obrigatório no passe final.

## 11. Contratos públicos mínimos

Tipos de domínio esperados:

```ts
type StatementStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';
type StatementLineType = 'DETAIL' | 'SUBTOTAL';
type StatementOperator = 'ADD' | 'SUBTRACT';
type StatementPeriodMode = 'MONTH' | 'YEAR_TO_DATE';
type StatementViewMode = 'SYNTHETIC' | 'ANALYTIC';
type StatementReportStatus = 'COMPLETE' | 'INCOMPLETE';
type ComparisonRate = number | 'NOT_AVAILABLE' | 'NOT_APPLICABLE';

interface StatementQuery {
  companyId: string;
  basePeriod: string;
  periodMode: StatementPeriodMode;
  viewMode: StatementViewMode;
}

interface StatementReport {
  companyId: string;
  basePeriod: string;
  periodMode: StatementPeriodMode;
  viewMode: StatementViewMode;
  statementVersion: number;
  accountingPeriodStatus: 'OPEN' | 'CLOSED';
  reportStatus: StatementReportStatus;
  lines: readonly StatementReportLine[];
  unmappedAccounts: readonly UnmappedResultAccount[];
  hash: string;
}
```

Operações necessárias:

- criar/clonar rascunho a partir da versão ativa da própria empresa;
- manter linhas, componentes e vínculos no rascunho;
- validar integralmente o rascunho;
- publicar com `expectedRevision` e competência inicial;
- listar versões e consultar uma versão histórica sem editá-la;
- consultar relatório pelo contrato acima;
- exportar PDF ou CSV por chave idempotente do relatório.

Erros de domínio têm códigos estáveis, incluindo no mínimo:

- `STATEMENT_STRUCTURE_NOT_FOUND`;
- `STATEMENT_STRUCTURE_INVALID`;
- `STATEMENT_VERSION_CONFLICT`;
- `STATEMENT_PERIOD_OVERLAP`;
- `STATEMENT_ACCOUNT_NOT_ELIGIBLE`;
- `STATEMENT_ACCOUNT_ALREADY_MAPPED`;
- `STATEMENT_COVERAGE_INCOMPLETE`;
- `STATEMENT_RECONCILIATION_FAILED`;
- `STATEMENT_COMPARISON_NOT_AVAILABLE`.

HTTP segue `application/problem+json` com `type`, `title`, `status`, `code` e `correlationId`. DTO externo é validado antes de chegar ao domínio; DTO não é entidade de persistência.

## 12. Segurança, autorização e auditoria

- toda entidade transacional possui `tenant_id` e `empresa_id`, sob RLS;
- consulta sem contexto retorna nada;
- colaborador acessa somente empresas de sua carteira;
- leitor autorizado consulta e exporta;
- contador ou administrador mantém rascunho e publica;
- publicar, substituir versão e exportar registram autor, instante, empresa, versão, período, hash e correlation ID;
- trilha é append-only;
- conteúdo financeiro não aparece em log técnico;
- nenhuma mutação aceita `tenant_id` ou `empresa_id` livres fora do contexto autorizado.

## 13. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| I-1 | estruturas, vínculos, resultados e exportações carregam `tenant_id` e `empresa_id`, indexados e sob RLS |
| I-2 | estrutura e DRE não retornam dados sem contexto válido de tenant/empresa |
| I-3 | todos os valores são inteiros em centavos; razões usam representação decimal controlada, nunca float monetário |
| I-4 | estrutura, agregação, AV, AH e reconciliação são determinísticas; LLM não calcula nem classifica conta |
| I-6 | publicação, substituição, consulta fechada e exportação deixam trilha append-only |
| I-7 | versão publicada, vínculo histórico e resultado fechado não são apagados |
| I-11 | competência usa `AAAA-MM`; instante de auditoria é armazenado em UTC e exibido em `America/Sao_Paulo` |
| I-12 | competência fechada reproduz versão, valores, comparação e hash exatamente |

## 14. Testes e evidências

### 14.1 Regras

- valida árvore, operadores, referência anterior, ausência de ciclo e base única de AV;
- recusa conta inelegível, duplicada ou de outra empresa;
- calcula linhas, subtotais, mensal, acumulado, AV e AH em centavos;
- retorna `NOT_AVAILABLE` e `NOT_APPLICABLE` nos casos definidos;
- detecta cobertura incompleta sem linha residual;
- preserva histórico e vigência ao publicar nova versão;
- bloqueia publicação concorrente com revisão vencida.

### 14.2 Banco

- RLS positiva e negativa para tenant, empresa e carteira;
- unicidade de versão/competência e de conta por versão;
- concorrência real de publicação em transações independentes;
- imutabilidade de versão publicada e trilha append-only;
- reconstrução do resultado a partir da F42 e snapshot da F43;
- hash idêntico para o mesmo fechamento e diferente quando fonte ou versão muda.

### 14.3 API

- valida DTOs, autorização e `expectedRevision`;
- retorna `application/problem+json` com códigos estáveis;
- não mistura empresa, competência ou versão;
- bloqueia exportação quando `INCOMPLETE`;
- PDF e CSV usam o mesmo resultado canônico;
- reexecução idempotente não duplica artefato lógico.

### 14.4 Tela e E2E

- configura, valida e publica estrutura por empresa;
- consulta aberta/fechada, mensal/acumulada e sintética/analítica;
- expande contas e rastreia valor até o razão;
- apresenta pendências e bloqueio de exportação;
- exporta PDF/CSV quando completo;
- cobre vazio, loading, erro, N/A, acesso negado e concorrência;
- prova temas CLARO/ESCURO, responsividade, teclado, foco, contraste e anúncios;
- compara capturas com o protótipo e registra correções de débito visual.

## 15. Critérios de aceite

- [ ] Estrutura por empresa possui rascunho, validação, publicação, vigência e histórico imutável.
- [ ] Cada conta de resultado participa de no máximo uma linha-base por versão; nenhuma classificação é inferida.
- [ ] DRE mensal e acumulada reconcilia exatamente com o razão da F42.
- [ ] Visões sintética e analítica mostram atual, anterior, AV e AH com regras explícitas para N/A.
- [ ] Competência aberta é marcada como prévia dinâmica; fechada reproduz snapshot, versão e hash da F43.
- [ ] Conta movimentada sem vínculo aparece como pendência, torna o relatório incompleto e bloqueia PDF/CSV.
- [ ] PDF e CSV completos nascem do mesmo resultado e carregam versão, período, estado e hash.
- [ ] RLS e carteira impedem leitura, edição ou exportação cruzada entre tenants e empresas.
- [ ] Trilha append-only registra publicação, substituição e exportação.
- [ ] UI final segue as referências concretas, os dois temas e todas as provas de `FRONTEND.md` §20.1.
- [ ] Relatórios de regras, banco, API, tela e E2E ficam rastreáveis à SPEC-045 e à issue #59.

## 16. Fora de escopo e destino obrigatório

| Complemento | Destino obrigatório |
|---|---|
| Modelos reutilizáveis do escritório e aplicação como cópia independente por empresa | F46 / SPEC-046, fatia própria do MVP-2 |
| Consolidação de DRE entre empresas | capacidade própria de relatórios multiempresa do MVP-2 |
| Orçamento e comparação realizado × orçado | fatia própria de planejamento financeiro do MVP-2 |
| DFC, fluxo projetado 30/60/90 e indicadores Dupont/liquidez | fatias próprias do RF-04 no MVP-2 |
| IA preditiva ou explicativa | fatia própria após dados e métricas aprovados; nunca substitui cálculo determinístico |
| Plano referencial, livros fiscais, SPED Fiscal e ECD | fatias próprias de escrituração do MVP-2 |
| Exportação XLSX ou artefato oficial | fatia própria que definir contrato e validador |
| Produção | gate de Produção posterior ao MVP-4 |

F46/SPEC-046 é o próximo par reservado pelo PI para preservar o complemento aprovado; sua SPEC e sua issue serão criadas separadamente, após as decisões próprias da fatia.

## 17. Dúvidas resolvidas pelo PI

- A capacidade escolhida para F45 é a DRE gerencial.
- A estrutura é configurável, não inferida por classe nem fixa para todo o produto.
- F45 trabalha por empresa; modelos do escritório ficam em F46 e serão aplicados como cópia independente, sem herança automática.
- A comparação é realizado contra período equivalente anterior; orçamento fica em fatia própria.
- Competências abertas e fechadas são consultáveis, distinguindo prévia dinâmica de resultado reproduzível.
- Exportações desta fatia são PDF e CSV.
- Cada conta alimenta exatamente uma linha-base; rateio entre linhas fica fora.
- Conta movimentada sem vínculo torna a prévia incompleta e bloqueia exportação.
- Mudança de estrutura cria nova versão por vigência e não reescreve período fechado.
- Publicação é explícita por contador ou administrador; não exige dupla aprovação.
- Questões abertas: **Nenhuma**.

## 18. Gate de conformidade

| Verificação | Evidência |
|---|---|
| Identidade | cabeçalho e §§1–2 |
| Comportamento observável | §§3–10 |
| Aceite verificável | §§14–15 |
| Invariantes | §13, com I-1, I-2, I-3, I-4, I-6, I-7, I-11 e I-12 |
| Fora de escopo | §16 |
| Dúvidas resolvidas | §17, sem questão aberta |
| Complementos rastreados | §16, incluindo F46/SPEC-046 nominal |
| UI | §10, com caminhos concretos, estados, temas, viewports e skills obrigatórias |

