# SPEC-039 / F39 — Catálogo contábil operacional

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD §§3, 4.2, 6.2, 10.3, 12, 14, 15 e 16; F13/SPEC-013
>
> **Estado:** aprovada pelo PI em 24/09/2026
>
> **Tamanho:** Médio — manutenção manual de dois catálogos hierárquicos, compatibilidade com a importação existente, autorização, auditoria e duas entradas para a mesma interface
>
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #53

## 1. Objetivo

Entregar o catálogo contábil operacional de cada empresa, evoluindo o plano de contas importado pela F13/SPEC-013 e adicionando centros de custo hierárquicos. O contador mantém manualmente os dois catálogos, identifica contas incompletas e define como cada conta analítica aceitará centro de custo nas futuras partidas.

Sucesso significa existir uma fonte única, isolada por tenant e empresa, pronta para ser consumida pelo futuro motor de partidas dobradas sem gerar lançamentos nesta fatia.

## 2. Fronteira da fatia

Esta fatia entrega:

- consulta e manutenção manual do plano de contas existente;
- cadastro hierárquico de centros de custo por empresa;
- criação, edição dos campos mutáveis, reorganização, arquivamento e reativação;
- código imutável e único por empresa em cada catálogo;
- classe contábil separada do saldo normal devedor ou credor;
- política de centro de custo por conta analítica: obrigatório, opcional ou proibido;
- identificação e correção explícita de contas importadas sem classe contábil;
- acesso por `Empresa -> Estrutura contábil` e `Contábil -> Estrutura contábil`;
- histórico e auditoria append-only;
- permissões integradas ao catálogo da F7/F8 e à carteira da F9;
- interface final nos temas CLARO e ESCURO.

Não entrega partidas, lançamentos, saldos, rateios, razão, fechamento, DRE, livros, SPED, ECD, plano referencial, classificação automática ou importação de centros de custo.

## 3. Modelo e regras do plano de contas

### 3.1 Campos

Cada conta possui:

| Campo | Regra |
|---|---|
| Código | obrigatório, imutável e único dentro da empresa |
| Nome | obrigatório e editável |
| Tipo | `ANALYTICAL` ou `SYNTHETIC` |
| Classe | `ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`, `COMPENSATION` ou `OTHER` |
| Saldo normal | `DEBIT` ou `CREDIT`; preserva a natureza devedora/credora importada pela F13 |
| Conta-pai | obrigatória exceto para raiz; pertence à mesma empresa |
| Política de centro de custo | `REQUIRED`, `OPTIONAL` ou `FORBIDDEN` para conta analítica; sempre `FORBIDDEN` para sintética |
| Estado | `ACTIVE`, `INCOMPLETE` ou `ARCHIVED` |

Classe contábil e saldo normal são conceitos distintos. A aplicação não infere classe por código, nome, pai, saldo normal, CNAE ou histórico.

### 3.2 Hierarquia

- uma conta não pode ser pai de si própria nem formar ciclo direto ou indireto;
- conta analítica não pode possuir filhos;
- conta sintética não recebe futura partida nem centro de custo;
- transformar sintética em analítica exige ausência de descendentes ativos;
- transformar analítica em sintética exige ausência de referência contábil que torne a mudança incompatível;
- mover uma conta preserva o código e valida toda a subárvore;
- classe incompatível com a hierarquia bloqueia a operação com diagnóstico estável;
- nenhuma alteração reescreve eventos históricos.

### 3.3 Compatibilidade com a F13

- contas já importadas permanecem com o mesmo identificador e código;
- `devedora/credora` da F13 migra para `normalBalance`, sem ser reinterpretada como classe;
- conta sem classe fica `INCOMPLETE`, visível e editável, mas indisponível para futuras partidas;
- a pendência informa quantas contas exigem classificação e abre a tela filtrada;
- o modelo e o mapeamento da F13 passam a aceitar classe como coluna opcional;
- arquivo legado sem classe continua aceito; as contas aplicadas ficam incompletas até revisão humana;
- reimportação continua atualizando somente os campos autorizados pelo contrato da F13 e nunca altera código;
- conta arquivada continua exigindo reativação explícita antes de nova importação aplicável.

## 4. Modelo e regras dos centros de custo

Cada centro de custo possui código imutável, nome, tipo `ANALYTICAL` ou `SYNTHETIC`, pai opcional e estado `ACTIVE` ou `ARCHIVED`.

- código é único dentro da empresa e nunca é reutilizado;
- centro analítico é a única forma utilizável por futura partida;
- centro sintético organiza a árvore e não recebe apropriação;
- centro analítico não possui filhos;
- mover centro valida empresa, ciclo e tipo de toda a subárvore;
- não há compartilhamento ou herança entre empresas do mesmo escritório;
- não há importação CSV, XLSX ou ODS nesta fatia;
- não há rateio, percentual, orçamento, projeto, estabelecimento ou responsável nesta fatia.

## 5. Edição, arquivamento e reativação

- código de conta ou centro é imutável após criação;
- trocar código exige arquivar o item antigo e criar outro;
- nome, campos classificatórios permitidos e pai usam controle de versão otimista;
- arquivar pai com descendente ativo é bloqueado; o usuário trata cada descendente explicitamente;
- arquivar item impede novos vínculos, mas preserva consultas e referências históricas;
- reativação é explícita e revalida unicidade, pai, classe, tipo e política vigente;
- não existe arquivamento em cascata, movimentação automática de filhos nem exclusão física;
- operação concorrente sobre versão superada retorna HTTP 409 sem aplicar alteração parcial.

## 6. Autorização e isolamento

O catálogo de permissões recebe, em `Contábil -> Estrutura contábil`:

| Ação | Efeito |
|---|---|
| `Consultar` | listar árvores, detalhes, estados e histórico |
| `Manter plano de contas` | criar, editar e mover contas |
| `Manter centros de custo` | criar, editar e mover centros |
| `Arquivar e reativar` | alterar ciclo de vida de conta ou centro |

Padrão inicial:

- `admin_escritorio`: todas as ações dentro do tenant;
- `contador`: todas as ações somente para empresa da carteira ativa;
- `auxiliar`: consultar somente empresa da carteira ativa;
- `auditor_readonly`: consultar em modo somente leitura dentro da alçada disponível;
- demais papéis: negados por padrão.

Papéis personalizados recebem somente ações existentes. A API revalida usuário ativo, tenant, empresa, carteira e permissão em todo comando e consulta. Falha de autorização não revela existência, código, nome, hierarquia ou histórico de outro tenant ou empresa.

## 7. Contratos mínimos

```ts
type CatalogItemType = "ANALYTICAL" | "SYNTHETIC";
type AccountClass =
  | "ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "REVENUE"
  | "EXPENSE"
  | "COMPENSATION"
  | "OTHER";
type NormalBalance = "DEBIT" | "CREDIT";
type CostCenterPolicy = "REQUIRED" | "OPTIONAL" | "FORBIDDEN";
type AccountStatus = "ACTIVE" | "INCOMPLETE" | "ARCHIVED";
type CostCenterStatus = "ACTIVE" | "ARCHIVED";

type AccountingAccount = {
  accountId: string;
  tenantId: string;
  companyId: string;
  code: string;
  name: string;
  type: CatalogItemType;
  accountClass: AccountClass | null;
  normalBalance: NormalBalance;
  parentAccountId: string | null;
  costCenterPolicy: CostCenterPolicy;
  status: AccountStatus;
  version: number;
};

type CostCenter = {
  costCenterId: string;
  tenantId: string;
  companyId: string;
  code: string;
  name: string;
  type: CatalogItemType;
  parentCostCenterId: string | null;
  status: CostCenterStatus;
  version: number;
};
```

Devem existir casos de uso tipados para listar árvore, consultar item, criar, editar, mover, arquivar, reativar e consultar histórico. Comandos de alteração recebem a versão conhecida.

Erros HTTP seguem `application/problem+json` e distinguem, no mínimo:

- `ACCOUNTING_CATALOG_CODE_DUPLICATE`;
- `ACCOUNTING_CATALOG_CODE_IMMUTABLE`;
- `ACCOUNTING_CATALOG_PARENT_INVALID`;
- `ACCOUNTING_CATALOG_CYCLE`;
- `ACCOUNTING_CATALOG_ACTIVE_DESCENDANTS`;
- `ACCOUNTING_ACCOUNT_CLASS_REQUIRED`;
- `ACCOUNTING_ACCOUNT_HIERARCHY_INCOMPATIBLE`;
- `ACCOUNTING_ACCOUNT_COST_CENTER_POLICY_INVALID`;
- `ACCOUNTING_CATALOG_VERSION_CONFLICT`;
- `ACCOUNTING_CATALOG_ARCHIVED`;
- `ACCOUNTING_CATALOG_FORBIDDEN`.

## 8. Persistência, concorrência e auditoria

- conta, centro, eventos e histórico possuem `tenant_id` e `empresa_id` obrigatórios, indexados e sob RLS;
- código normalizado possui unicidade por empresa e tipo de catálogo, inclusive após arquivamento;
- integridade hierárquica é validada no domínio e protegida no banco contra referência cruzada;
- caso de uso controla a transação; controller valida entrada e delega;
- criação, edição, movimentação, arquivamento, reativação, conflito e tentativa negada geram evento append-only;
- evento registra autor, instante UTC, correlação, versão anterior e nova versão, sem copiar dado sensível desnecessário;
- leitura da árvore usa ordenação determinística por código e paginação ou carregamento incremental compatível com 10.000 contas;
- nenhum relógio é lido dentro de função de domínio pura; o instante entra por parâmetro.

## 9. Contrato de interface

### 9.1 Acessos

A mesma experiência é composta em duas rotas:

1. `Empresa -> Estrutura contábil`, já contextualizada na empresa;
2. `Contábil -> Estrutura contábil`, com seletor de empresa permitido pela carteira.

As rotas compartilham consultas, comandos, estados e autorização. Não existem duas implementações do catálogo.

### 9.2 Composição

- identificação e troca segura da empresa;
- abas internas `Plano de contas` e `Centros de custo`;
- árvore pesquisável com expansão controlada;
- filtros `Ativos`, `Incompletos` e `Arquivados` quando aplicáveis;
- painel de detalhe e formulário de criação/edição;
- ação explícita para mover, arquivar e reativar;
- contador de contas incompletas com caminho de correção;
- histórico do item;
- indicação clara de código imutável;
- estados de carregamento, vazio, erro, conflito, permissão insuficiente e empresa fora da carteira.

### 9.3 Referências e qualidade

A F39 não possui protótipo dedicado. A interface preserva a aba de plano de contas da F13 e a direção visual do projeto, obedecendo `FRONTEND.md`, `DESIGN-SYSTEM.md`, `docs/design-system/`, `DESIGN-CLARO.md` e `DESIGN-ESCURO.md`.

- temas CLARO e ESCURO completos;
- viewports obrigatórios de 768, 1024 e 1440 px;
- árvore, filtros, menus e formulários operáveis por teclado;
- foco visível e devolvido ao acionador após diálogo;
- mudança de hierarquia anunciada de forma compreensível;
- estado não depende somente de cor ou ícone;
- confirmação de arquivamento não usa `alert`;
- feedback usa estado persistente e Toast Sonner conforme o contrato;
- `frontend-design` orienta a implementação e `impeccable` fecha o passe de acabamento.

## 10. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | código imutável, unicidade, tipos, sete classes, saldo normal, política de centro, ciclo e hierarquia |
| Compatibilidade F13 | migração do saldo normal, conta antiga incompleta, arquivo antigo aceito e classe opcional mapeada |
| Ciclo de vida | arquivar, bloquear pai com filho ativo, reativar, impedir reuso de código e preservar histórico |
| Banco | RLS, empresa/tenant, chaves, versão otimista, integridade hierárquica e append-only |
| Permissões | admin/contador mantêm; auxiliar/auditor consultam; papel personalizado; fora da carteira e outro tenant negados |
| Performance | árvore e pesquisa com 10.000 contas sem carregar toda a hierarquia de forma bloqueante |
| Tela | duas rotas, mesma fonte, estados, CLARO/ESCURO, 768/1024/1440, teclado, foco e leitor de tela |
| E2E | criar hierarquias, editar, mover, bloquear pai, arquivar filhos, arquivar/reativar pai e validar ambos os acessos |
| Contrafactual | código repetido/alterado, ciclo, pai cruzado, classe ausente, versão superada e ação sem permissão |

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

## 11. Critérios de aceite verificáveis

- [ ] Plano importado pela F13 aparece sem duplicação e preserva código e saldo normal.
- [ ] Conta antiga sem classe fica `INCOMPLETE` e não recebe classe inferida.
- [ ] Usuário autorizado classifica conta incompleta numa das sete classes.
- [ ] Conta e centro podem ser criados, editados, movidos, arquivados e reativados manualmente.
- [ ] Código não pode ser alterado nem reutilizado após arquivamento.
- [ ] Ciclo, pai de outra empresa e conta/centro analítico com filhos são bloqueados.
- [ ] Pai com descendente ativo não pode ser arquivado e nenhum filho é alterado implicitamente.
- [ ] Conta analítica define centro de custo obrigatório, opcional ou proibido; sintética permanece proibida.
- [ ] Conflito de versão retorna 409 e não aplica alteração parcial.
- [ ] As duas rotas exibem e alteram a mesma estrutura, respeitando empresa e carteira.
- [ ] Admin e contador mantêm; auxiliar e auditor consultam; demais ações são negadas por padrão.
- [ ] RLS impede leitura e escrita cruzada entre tenants e empresas.
- [ ] Toda alteração e tentativa negada relevante fica na auditoria append-only.
- [ ] Tela final passa por CLARO/ESCURO, 768/1024/1440, teclado, foco, acessibilidade e acabamento.
- [ ] Jornada E2E roda integralmente no Docker local com `correlationId` observável.

## 12. Limites e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Partidas, lançamentos e validação débito = crédito | fatia própria do motor de partidas dobradas |
| Rateio por múltiplos centros | fatia contábil própria, junto ao lançamento que o consumir |
| Razão, saldos e fechamento de competência | fatia própria posterior ao motor de partidas |
| DRE gerencial | fatia de relatórios alimentada pelo razão |
| Plano referencial e DE-PARA conta/centro | fatia de ECD, com tabelas oficiais versionadas |
| Livros, SPED Fiscal e ECD | fatias próprias de escrituração |
| Agente Classificador, embeddings e histórico aprendido | fatia própria do Agente Classificador |
| Importação de centros de custo | fora da F39; nova fatia somente se priorizada pelo PI |
| Operação produtiva | gate de Produção após o MVP-4 |

É proibido nesta fatia gerar lançamento, saldo, rateio, escrituração ou indicação de compatibilidade com ECD apenas porque o catálogo existe.

## 13. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Fronteira | catálogo completo; partidas ficam para a fatia seguinte |
| Centros | hierárquicos e isolados por empresa |
| Código | imutável após criação |
| Arquivamento do pai | bloqueado enquanto houver descendente ativo |
| Interface | acesso pela empresa e pelo módulo Contábil, reutilizando a mesma tela |
| Operadores | admin e contador mantêm; auxiliar e auditor consultam |
| Importação de centros | não entra; manutenção manual |
| Política por conta | centro obrigatório, opcional ou proibido |
| Plano referencial | deferido para a fatia de ECD |
| Contas legadas | classe obrigatória com pendência, sem inferência |
| Classes | ativo, passivo, patrimônio líquido, receita, despesa, compensação e outros |

**Questões abertas:** nenhuma.

## 14. Gate dos oito itens obrigatórios

| Item | Evidência nesta SPEC |
|---|---|
| Fatia, MVP e Slice | cabeçalho e §§1–2 |
| Comportamento observável | §§3–5 |
| Aceite verificável | §§10–11 |
| Invariantes tocados | §§6 e 8 |
| Fora de escopo | §§2 e 12 |
| Dúvidas resolvidas | §13; nenhuma aberta |
| Destino do complemento | §12 |
| Contrato de UI | §9, com rotas, estados, temas, viewports e provas |

## 15. Aprovação

Fronteira, modelo, ciclo de vida, autorização, interface, compatibilidade, provas e destinos aprovados pelo PI em 24/09/2026. A implementação deve seguir esta SPEC sem criar regra contábil ou de produto adicional; lacuna material volta ao PI.
