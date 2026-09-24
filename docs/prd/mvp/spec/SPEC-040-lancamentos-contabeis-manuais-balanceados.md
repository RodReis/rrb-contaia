# SPEC-040 / F40 — Lançamentos contábeis manuais balanceados

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD §§3, 6.2, 6.5, 12, 14, 15 e 16; F39/SPEC-039
>
> **Estado:** aprovada pelo PI em 24/09/2026
>
> **Tamanho:** Médio — ciclo de rascunho e efetivação, partidas balanceadas, numeração concorrente, cancelamento, estorno, autorização, auditoria e interface final
>
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #54

## 1. Objetivo

Entregar o lançamento contábil manual por empresa sobre o catálogo da F39/SPEC-039. Auxiliares preparam rascunhos; contadores e administradores validam e efetivam partidas dobradas balanceadas, numeradas de forma sequencial e imutáveis após a efetivação.

Sucesso significa registrar manualmente um fato contábil com débito igual a crédito, contas e centros válidos, isolamento por tenant e empresa, autorização por carteira e trilha append-only. Esta fatia cria a fonte transacional para o futuro razão, mas ainda não calcula saldos nem fecha competências.

## 2. Fronteira da fatia

Esta fatia entrega:

- criação, edição e descarte auditado de rascunhos;
- efetivação atômica de lançamentos manuais balanceados;
- múltiplas partidas de débito e crédito no mesmo lançamento;
- numeração sequencial por empresa e exercício no instante da efetivação;
- validação do plano de contas e da política de centro de custo da F39;
- cancelamento controlado quando permitido e estorno referenciado nos demais casos;
- histórico e auditoria append-only;
- permissões integradas ao catálogo da F7/F8 e à carteira da F9;
- acesso por `Empresa -> Lançamentos contábeis` e `Contábil -> Lançamentos`;
- interface final nos temas CLARO e ESCURO.

Não entrega geração automática por documento fiscal ou financeiro, rateio por múltiplos centros, razão, saldo, fechamento ou reabertura de competência, DRE, livros, SPED, ECD, plano referencial, anexos ou classificação assistida.

## 3. Identidade e modelo

### 3.1 Cabeçalho

Cada lançamento possui:

| Campo | Regra |
|---|---|
| Identificador | UUID interno, imutável e disponível desde o rascunho |
| Empresa | obrigatória, imutável e pertencente ao tenant |
| Competência | mês civil `AAAA-MM`, obrigatório |
| Data contábil | data civil obrigatória e pertencente à competência informada |
| Histórico | texto obrigatório, normalizado e não vazio |
| Referência | texto opcional para identificar origem externa ou documental, sem criar vínculo estruturado |
| Número | nulo no rascunho; sequencial por empresa e exercício após efetivação |
| Estado | `DRAFT`, `POSTED`, `DISCARDED`, `CANCELLED` ou `REVERSED` |
| Versão | controle otimista enquanto o lançamento estiver em rascunho |

O exercício da numeração é o ano da data contábil. Empresa, identificador, número e exercício nunca mudam após a efetivação.

### 3.2 Partidas

Cada partida possui conta contábil, lado `DEBIT` ou `CREDIT`, valor inteiro positivo em centavos, complemento opcional e zero ou um centro de custo.

- lançamento efetivado possui pelo menos duas partidas;
- cada partida informa exatamente um lado; não existe valor negativo, zero ou débito e crédito simultâneos;
- soma dos débitos deve ser exatamente igual à soma dos créditos;
- conta deve ser analítica, ativa, completa e da mesma empresa;
- conta sintética, incompleta ou arquivada bloqueia a efetivação;
- centro deve ser analítico, ativo e da mesma empresa;
- política `REQUIRED` exige um centro, `OPTIONAL` aceita zero ou um e `FORBIDDEN` rejeita centro;
- partidas não são compartilhadas entre lançamentos nem entre empresas;
- ordem visual das partidas é persistida de modo determinístico e não altera o resultado contábil.

Não há rateio percentual ou automático. Distribuição manual exige partidas explícitas e independentes, cada uma com seu próprio valor e, quando permitido, centro.

## 4. Ciclo de vida

### 4.1 Rascunho

- criação gera `DRAFT` com UUID e sem número contábil;
- autor autorizado pode alterar cabeçalho e partidas enquanto a versão conhecida for atual;
- salvamento de rascunho permite desbalanceamento temporário, mas mantém tipos, centavos e referências válidas;
- descarte exige motivo não vazio, muda o estado para `DISCARDED`, preserva conteúdo e não consome número;
- rascunho descartado não pode ser restaurado, editado ou efetivado;
- não existe exclusão física.

### 4.2 Efetivação

A efetivação ocorre em uma única transação:

1. revalida usuário, tenant, empresa, carteira e permissão;
2. bloqueia o rascunho e verifica sua versão;
3. valida cabeçalho, contas, centros, partidas e balanceamento;
4. reserva o próximo número da empresa e exercício sob controle concorrente;
5. grava número, instante, efetivador e estado `POSTED`;
6. registra o evento append-only correspondente.

Qualquer falha reverte toda a transação. Número não é reservado antecipadamente, não é reaproveitado e não fica consumido por tentativa falha.

Após `POSTED`, cabeçalho e partidas são imutáveis. Efetivação não calcula saldo, não alimenta razão materializado e não transmite obrigação.

### 4.3 Cancelamento e estorno

- lançamento `POSTED` pode ser cancelado somente quando a competência estiver aberta e não houver transmissão ou vínculo externo que exija preservação por estorno;
- cancelamento exige motivo, autor autorizado e evento; não remove nem altera partidas;
- lançamento cancelado fica `CANCELLED` e seu número permanece ocupado;
- fora da condição de cancelamento, a correção ocorre por novo lançamento de estorno;
- estorno referencia obrigatoriamente um lançamento `POSTED`, replica as partidas com lados invertidos, recebe data, competência, número e autoria próprios e é efetivado atomicamente;
- lançamento original passa a `REVERSED` somente após o estorno efetivado; ambos permanecem consultáveis;
- não se estorna duas vezes o mesmo lançamento nem se estorna lançamento descartado, cancelado ou já estornado;
- esta fatia consulta o estado de competência disponível, mas não entrega fechamento ou reabertura.

## 5. Numeração e concorrência

- sequência é independente por `tenant_id`, `empresa_id` e exercício;
- primeiro número do exercício é `1` e a apresentação pode aplicar preenchimento visual sem alterar o valor armazenado;
- alocação usa proteção transacional que impeça duplicidade sob efetivações concorrentes;
- somente transação confirmada avança a sequência;
- números de lançamentos cancelados ou estornados não são removidos nem reutilizados;
- conflitos de versão ou concorrência retornam HTTP 409 sem mutação parcial;
- listagem ordena por exercício e número, com desempate determinístico por identificador.

## 6. Autorização e isolamento

O catálogo de permissões recebe, em `Contábil -> Lançamentos`:

| Ação | Efeito |
|---|---|
| `Consultar` | listar lançamentos, partidas e histórico |
| `Preparar rascunho` | criar, editar e descartar rascunhos |
| `Efetivar` | validar e transformar rascunho em lançamento imutável |
| `Cancelar e estornar` | executar correção contábil permitida |

Padrão inicial:

- `admin_escritorio`: todas as ações dentro do tenant;
- `contador`: todas as ações somente para empresa da carteira ativa;
- `auxiliar`: consultar e preparar rascunho somente para empresa da carteira ativa;
- `auditor_readonly`: consultar em modo somente leitura dentro da alçada disponível;
- demais papéis: negados por padrão.

Não há segregação obrigatória entre criador e efetivador: contador ou administrador pode efetivar o próprio rascunho. Autoria e efetivação são eventos separados. A API revalida alçada em todo comando e consulta; falha não revela dados de outro tenant ou empresa.

## 7. Contratos mínimos

```ts
type AccountingEntryStatus =
  | "DRAFT"
  | "POSTED"
  | "DISCARDED"
  | "CANCELLED"
  | "REVERSED";
type AccountingEntrySide = "DEBIT" | "CREDIT";

type AccountingEntryLine = {
  lineId: string;
  accountId: string;
  side: AccountingEntrySide;
  amountCents: number;
  costCenterId: string | null;
  memo: string | null;
  position: number;
};

type AccountingEntry = {
  entryId: string;
  tenantId: string;
  companyId: string;
  fiscalYear: number;
  entryNumber: number | null;
  accountingDate: string;
  competence: string;
  history: string;
  externalReference: string | null;
  status: AccountingEntryStatus;
  reversalOfEntryId: string | null;
  version: number;
  lines: AccountingEntryLine[];
};
```

`amountCents` é inteiro seguro, positivo e validado; float é proibido. Devem existir casos de uso tipados para criar, editar, descartar, efetivar, cancelar, estornar, listar, consultar detalhe e histórico.

Erros HTTP seguem `application/problem+json` e distinguem, no mínimo:

- `ACCOUNTING_ENTRY_UNBALANCED`;
- `ACCOUNTING_ENTRY_LINE_INVALID`;
- `ACCOUNTING_ENTRY_ACCOUNT_INVALID`;
- `ACCOUNTING_ENTRY_COST_CENTER_REQUIRED`;
- `ACCOUNTING_ENTRY_COST_CENTER_FORBIDDEN`;
- `ACCOUNTING_ENTRY_COST_CENTER_INVALID`;
- `ACCOUNTING_ENTRY_COMPETENCE_INVALID`;
- `ACCOUNTING_ENTRY_IMMUTABLE`;
- `ACCOUNTING_ENTRY_VERSION_CONFLICT`;
- `ACCOUNTING_ENTRY_CANCELLATION_FORBIDDEN`;
- `ACCOUNTING_ENTRY_REVERSAL_FORBIDDEN`;
- `ACCOUNTING_ENTRY_FORBIDDEN`.

## 8. Persistência, transação e auditoria

- lançamento, partidas, sequência, eventos e histórico possuem contexto obrigatório de tenant e empresa, indexado e sob RLS;
- banco impede referência a conta, centro ou lançamento de outra empresa;
- unicidade protege número por empresa e exercício, desconsiderando rascunhos sem número;
- caso de uso controla a transação; controller valida entrada e delega;
- criação, edição, descarte, efetivação, cancelamento, estorno, conflito e tentativa negada relevante geram evento append-only;
- evento registra autor, instante UTC, correlação, ação, estado anterior e novo, número quando existente e motivo aplicável;
- a auditoria não reescreve eventos nem copia dado sensível desnecessário;
- funções de domínio não leem banco, rede ou relógio; estado necessário e instante entram por parâmetro.

## 9. Contrato de interface

### 9.1 Acessos

A mesma experiência é composta em duas rotas:

1. `Empresa -> Lançamentos contábeis`, já contextualizada na empresa;
2. `Contábil -> Lançamentos`, com seletor de empresa permitido pela carteira.

As rotas compartilham consultas, comandos, estados e autorização. Não existem duas implementações do lançamento.

### 9.2 Composição

- identificação e troca segura da empresa;
- seletor de competência e filtros por estado;
- lista com data, número ou indicação de rascunho, histórico, totais e estado;
- formulário de cabeçalho e grade editável de partidas;
- busca de conta exibindo código, nome, classe, estado e política de centro;
- busca de centro limitada à empresa e aos centros analíticos ativos;
- totais de débito, crédito e diferença atualizados sem usar float;
- ações explícitas para salvar rascunho, descartar, efetivar, cancelar e estornar;
- detalhe imutável do lançamento efetivado e histórico de eventos;
- estados de carregamento, vazio, erro, conflito, permissão insuficiente, empresa fora da carteira, catálogo inválido e sucesso.

### 9.3 Referências e qualidade

A F40 não possui protótipo dedicado. A interface segue a direção visual aprovada e obedece `FRONTEND.md`, `DESIGN-SYSTEM.md`, `docs/design-system/`, `DESIGN-CLARO.md` e `DESIGN-ESCURO.md`.

- temas CLARO e ESCURO completos;
- viewports obrigatórios de 768, 1024 e 1440 px;
- grade, seletores, diálogos e ações operáveis por teclado;
- foco visível e devolvido ao acionador após diálogo;
- totais e diferença são anunciados de forma compreensível;
- estado não depende somente de cor ou ícone;
- confirmações não usam `alert`;
- feedback usa Toast Sonner e estado persistente conforme o contrato;
- `frontend-design` orienta a implementação e `impeccable` fecha o passe de acabamento.

## 10. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | lados exclusivos, centavos positivos, mínimo de partidas, igualdade débito/crédito e competência/data |
| Catálogo F39 | conta analítica/ativa/completa e política `REQUIRED`, `OPTIONAL` e `FORBIDDEN` de centro |
| Ciclo de vida | rascunho editável, descarte auditado, efetivação imutável, cancelamento permitido/bloqueado e estorno único |
| Numeração | sequência por empresa/exercício, concorrência, rollback sem lacuna e não reutilização |
| Banco | RLS, empresa/tenant, chaves cruzadas, versão otimista, atomicidade e append-only |
| Permissões | auxiliar prepara; contador/admin efetivam e corrigem; auditor consulta; fora da carteira e outro tenant são negados |
| Tela | duas rotas, mesma fonte, estados, CLARO/ESCURO, 768/1024/1440, teclado, foco e leitor de tela |
| E2E | criar rascunho, corrigir diferença, efetivar, consultar número, descartar outro rascunho e cancelar/estornar |
| Contrafactual | desbalanceamento, zero/negativo, conta inválida, centro incompatível, versão superada e ação sem permissão |

O motor de partidas deve atingir 95% de linhas e 100% dos invariantes documentados, conforme ADR-008.

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

- [ ] Auxiliar autorizado cria e edita rascunho, mas não consegue efetivá-lo.
- [ ] Contador ou administrador efetiva o próprio rascunho sem exigir segundo aprovador.
- [ ] Rascunho pode ficar temporariamente desbalanceado e não recebe número nem efeito contábil.
- [ ] Descarte exige motivo, preserva conteúdo e histórico e não consome número.
- [ ] Efetivação exige pelo menos duas partidas e débito exatamente igual a crédito.
- [ ] Valores zero, negativos, fracionários ou fora do inteiro seguro são bloqueados.
- [ ] Conta sintética, incompleta, arquivada ou de outra empresa é bloqueada.
- [ ] Centro respeita a política da conta e deve ser analítico, ativo e da mesma empresa.
- [ ] Número nasce somente na efetivação e permanece sequencial e único sob concorrência.
- [ ] Falha de efetivação não aplica mutação parcial nem consome número.
- [ ] Lançamento efetivado não pode ser editado nem excluído.
- [ ] Cancelamento só ocorre na condição permitida, preserva número e exige motivo.
- [ ] Estorno cria novo lançamento balanceado com lados invertidos e referência obrigatória ao original.
- [ ] RLS e carteira impedem leitura e escrita cruzada entre tenants e empresas.
- [ ] As duas rotas operam sobre a mesma fonte e respeitam a mesma autorização.
- [ ] Toda ação e tentativa negada relevante fica na auditoria append-only.
- [ ] Tela final passa por CLARO/ESCURO, 768/1024/1440, teclado, foco, acessibilidade e acabamento.
- [ ] Jornada E2E roda integralmente no Docker local com `correlationId` observável.

## 12. Limites e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Razão, saldos e fechamento/reabertura de competência | fatia contábil própria posterior à F40 |
| Rateio percentual ou por múltiplos centros | fatia contábil própria |
| Geração por documento fiscal ou financeiro | fatias de integração/classificação que consumirão o motor da F40 |
| Agente Classificador, embeddings e histórico aprendido | fatia própria do Agente Classificador |
| Anexos e vínculo documental estruturado | fatia de integração documental; F40 guarda apenas referência textual opcional |
| DRE gerencial | fatia de relatórios alimentada pelo futuro razão |
| Livros, SPED Fiscal, ECD e plano referencial | fatias próprias de escrituração |
| Operação produtiva | gate de Produção após o MVP-4 |

É proibido usar a existência da F40 para afirmar que há saldo, razão, fechamento, escrituração, classificação automática ou compatibilidade com ECD.

## 13. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Origem | lançamento manual; automação fica fora |
| Ciclo | rascunho editável seguido de efetivação imutável |
| Centro de custo | zero ou um por partida; rateio fica fora |
| Numeração | atribuída apenas ao efetivar |
| Operadores | auxiliar rascunha; contador/admin efetivam; auditor consulta |
| Segregação | contador/admin podem efetivar o próprio rascunho |
| Interface | acesso pela empresa e pelo módulo Contábil, reutilizando a mesma tela |
| Evidência | histórico obrigatório e referência opcional; sem anexo obrigatório |
| Descarte | preservado com motivo e auditoria, sem exclusão física |

**Questões abertas:** nenhuma.

## 14. Gate dos oito itens obrigatórios

| Item | Evidência nesta SPEC |
|---|---|
| Fatia, MVP e Slice | cabeçalho e §§1–2 |
| Comportamento observável | §§3–5 |
| Aceite verificável | §§10–11 |
| Invariantes tocados | §§4–8 |
| Fora de escopo | §§2 e 12 |
| Dúvidas resolvidas | §13; nenhuma aberta |
| Destino do complemento | §12 |
| Contrato de UI | §9, com rotas, estados, temas, viewports e provas |

## 15. Aprovação

Fronteira, ciclo, partidas, numeração, autorização, interface, evidência, descarte, provas e destinos aprovados pelo PI em 24/09/2026. A implementação deve seguir esta SPEC sem criar regra contábil ou de produto adicional; lacuna material volta ao PI.
