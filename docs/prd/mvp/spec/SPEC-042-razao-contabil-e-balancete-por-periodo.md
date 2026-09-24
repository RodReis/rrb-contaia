# SPEC-042 / F42 — Razão contábil e balancete por período

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD §§3, 6.2, 6.5, 12, 14, 15 e 16; F39/SPEC-039 a F41/SPEC-041
>
> **Estado:** aprovada pelo PI em 24/09/2026
>
> **Tamanho:** Médio — projeção persistida, razão analítico, balancete, cancelamento/estorno, reconstrução, autorização, auditoria e interface final
>
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #56

## 1. Objetivo

Entregar o razão contábil e o balancete por período de cada empresa a partir dos lançamentos efetivados da F40/SPEC-040, sejam eles preparados manualmente ou gerados pela F41/SPEC-041. O lançamento efetivado permanece fonte de verdade; o razão é uma projeção persistida, transacional, idempotente e reconstruível.

Sucesso significa que cada partida efetivada aparece uma única vez no razão, os movimentos consolidam saldo anterior, débitos, créditos e saldo final por conta, cancelamentos e estornos produzem efeitos rastreáveis e a projeção pode ser comprovada integralmente contra as fontes imutáveis.

## 2. Fronteira da fatia

Esta fatia entrega:

- movimento analítico do razão por empresa, conta, centro opcional, competência e data contábil;
- projeção síncrona e atômica na efetivação, cancelamento ou estorno de lançamento F40;
- consolidação mensal persistida por conta e centro opcional;
- balancete por intervalo de competências com saldo anterior, débitos, créditos e saldo final;
- consolidação das contas sintéticas a partir das contas analíticas descendentes, sem dupla contagem;
- verificação e reconstrução administrativa da projeção a partir dos lançamentos fonte;
- rastreabilidade do movimento até lançamento, partida e evento de origem;
- acesso por `Empresa -> Razão contábil` e `Contábil -> Razão`;
- interface final nos temas CLARO e ESCURO.

Não entrega carga ou importação de saldos de abertura, fechamento ou reabertura de competência, DRE, livros fiscais, SPED Fiscal, ECD, plano referencial, exportação PDF/CSV, origem financeira ou folha.

## 3. Fonte de verdade e marco inicial

- somente partida de lançamento F40 efetivado participa do razão;
- rascunho, descarte e tentativa de efetivação falha não produzem movimento;
- a identidade idempotente do movimento combina empresa, lançamento e partida fonte;
- cada movimento preserva os identificadores da conta e do centro usados no lançamento, além do código e nome exibíveis pelo catálogo histórico;
- a projeção nunca altera cabeçalho, partidas, estado ou auditoria do lançamento fonte;
- o marco inicial da empresa é o primeiro lançamento efetivado disponível no sistema;
- saldo anterior ao marco inicial é desconhecido, não zero comprovado;
- consultas e interface exibem o marco inicial e não afirmam posição contábil completa anterior a ele;
- F42 não cria lançamento especial nem importa saldo de abertura.

## 4. Projeção do razão

### 4.1 Movimento analítico

Cada partida efetivada produz um movimento com empresa, competência, data contábil, conta analítica, centro opcional, lado, valor em centavos, lançamento, número contábil, partida fonte e posição.

- o movimento herda competência e data do lançamento;
- valor é inteiro positivo em centavos; lado permanece `DEBIT` ou `CREDIT`;
- conta e centro devem pertencer à mesma empresa do lançamento;
- movimento não é editado nem excluído fisicamente;
- ordenação determinística usa data contábil, número do lançamento, posição da partida e identificador;
- histórico, referência e complemento da partida podem ser exibidos, mas não alteram o cálculo.

### 4.2 Atomicidade e idempotência

A efetivação F40 e a projeção correspondente ocorrem na mesma transação controlada pelo caso de uso. Se qualquer movimento ou saldo não puder ser projetado, a efetivação inteira falha e nenhum número contábil ou projeção parcial permanece.

Repetir o processamento da mesma partida retorna o movimento existente sem duplicar débito, crédito ou saldo. Unicidade é protegida no banco e concorrência sobre a mesma fonte produz uma única projeção.

## 5. Cancelamento, estorno e retroatividade

- cancelamento permitido pela F40 não apaga o movimento original;
- o cancelamento cria ajuste compensatório auditável, na mesma competência e data contábil do lançamento cancelado, anulando exatamente cada partida original;
- a identidade do ajuste referencia movimento e evento de cancelamento e também é idempotente;
- estorno segue a F40: o original permanece e o novo lançamento efetivado projeta seus próprios movimentos de lados invertidos;
- lançamento marcado `REVERSED` não é retirado do razão, pois seu efeito é anulado pelo lançamento de estorno;
- lançamento retroativo em competência aberta atualiza o consolidado do mês correspondente; saldos anteriores e finais consultados são recalculados pela sequência de competências;
- F42 não decide se uma competência aceita lançamento, cancelamento ou estorno: consome a decisão de ciclo vigente da F40 e da futura fatia de fechamento.

## 6. Saldos e balancete

### 6.1 Consolidação mensal

A projeção mantém, por empresa, conta analítica, centro opcional e competência:

- total de débitos do mês;
- total de créditos do mês;
- quantidade de movimentos;
- versão da projeção e instante da última atualização.

Saldo anterior e saldo final são derivados de todos os consolidados disponíveis até o limite consultado. Não se persiste saldo corrido por movimento, evitando reescrita histórica quando entrar lançamento retroativo.

### 6.2 Convenção de saldo

- cálculo canônico usa `débitos - créditos` em centavos inteiros;
- valor positivo representa posição devedora; negativo, credora; zero, sem saldo;
- a apresentação usa o saldo normal da F39 para exibir natureza, sem inverter ou ocultar o valor canônico;
- conta sintética soma uma única vez todas as contas analíticas descendentes vigentes no catálogo consultado;
- nenhuma partida é lançada diretamente em conta sintética;
- filtro por centro inclui somente movimentos daquele centro; opção `Sem centro` é distinta de `Todos`;
- totais gerais fecham débito e crédito no período, sem depender de arredondamento.

### 6.3 Balancete

Para cada conta dentro do intervalo solicitado, o balancete apresenta código, nome, classe, nível, saldo anterior, débitos, créditos, saldo final e natureza final. A visão pode incluir ou ocultar contas sem movimento e saldo zero, sem alterar o resultado.

O balancete não é fechamento, livro oficial nem artefato apto a ECD. Enquanto não houver carga de abertura, representa somente o universo de lançamentos disponíveis desde o marco inicial declarado.

## 7. Verificação e reconstrução

- verificação compara quantidade, débitos e créditos por empresa, competência, conta e centro entre lançamentos fonte e projeção;
- resultado é `CONSISTENT` ou `INCONSISTENT`, com diferenças objetivas e sem correção silenciosa;
- reconstrução é comando administrativo explícito, por empresa, executado somente no Docker local nesta etapa;
- a reconstrução calcula uma nova versão isolada a partir das fontes, valida totais e somente então troca atomicamente a versão ativa;
- falha preserva integralmente a projeção anterior;
- consultas veem uma única versão consistente, nunca estado parcialmente reconstruído;
- verificação e reconstrução são idempotentes, correlacionadas e auditadas;
- reconstruir não cria, cancela, estorna nem modifica lançamento fonte.

## 8. Autorização e isolamento

O catálogo de permissões recebe, em `Contábil -> Razão`:

| Ação | Efeito |
|---|---|
| `Consultar` | consultar razão, balancete, detalhe e marco inicial |
| `Verificar integridade` | comparar projeção com os lançamentos fonte |
| `Reconstruir projeção` | reconstruir e ativar atomicamente uma versão consistente |

Padrão inicial:

- `admin_escritorio`: todas as ações dentro do tenant;
- `contador`: consultar e verificar somente empresa da carteira ativa;
- `auxiliar`: consultar somente empresa da carteira ativa;
- `auditor_readonly`: consultar em modo somente leitura dentro da alçada;
- demais papéis: negados por padrão.

Toda consulta e comando revalida usuário, tenant, empresa, carteira e permissão. Conta, centro, lançamento, movimento e saldo devem pertencer à mesma empresa. Falha de autorização não revela existência ou totais externos à alçada.

## 9. Contratos mínimos

```ts
type LedgerSide = "DEBIT" | "CREDIT";
type LedgerMovementKind = "POSTING" | "CANCELLATION_ADJUSTMENT";
type LedgerIntegrityStatus = "CONSISTENT" | "INCONSISTENT";

type AccountingLedgerMovement = {
  movementId: string;
  tenantId: string;
  companyId: string;
  entryId: string;
  entryLineId: string;
  adjustmentOfMovementId: string | null;
  competence: string;
  accountingDate: string;
  accountId: string;
  costCenterId: string | null;
  side: LedgerSide;
  amountCents: number;
  kind: LedgerMovementKind;
  position: number;
};

type AccountingMonthlyBalance = {
  tenantId: string;
  companyId: string;
  competence: string;
  accountId: string;
  costCenterId: string | null;
  debitCents: number;
  creditCents: number;
  movementCount: number;
  projectionVersion: number;
};

type TrialBalanceLine = {
  accountId: string;
  openingBalanceCents: number;
  debitCents: number;
  creditCents: number;
  closingBalanceCents: number;
  closingNature: "DEBIT" | "CREDIT" | "ZERO";
};
```

Valores monetários são inteiros seguros em centavos; float é proibido. Consultas recebem empresa, período e filtros tipados, usam paginação determinística no razão e retornam o marco inicial aplicável.

Erros HTTP seguem `application/problem+json` e distinguem, no mínimo:

- `LEDGER_PERIOD_INVALID`;
- `LEDGER_SOURCE_INVALID`;
- `LEDGER_PROJECTION_CONFLICT`;
- `LEDGER_PROJECTION_INCONSISTENT`;
- `LEDGER_REBUILD_IN_PROGRESS`;
- `LEDGER_REBUILD_FAILED`;
- `LEDGER_FORBIDDEN`.

## 10. Persistência, concorrência e auditoria

- movimentos, consolidados, versões de projeção e eventos possuem tenant e empresa obrigatórios, indexados e sob RLS;
- unicidade protege movimento por empresa, partida fonte e tipo, inclusive ajuste de cancelamento;
- consolidado mensal usa chave única por empresa, competência, conta, centro opcional e versão;
- atualização de movimento e consolidado ocorre na transação do evento fonte;
- versão ativa da projeção troca atomicamente após reconstrução válida;
- criação de movimento, ajuste, conflito, verificação, reconstrução, ativação e tentativa negada relevante geram evento append-only;
- evento registra autor ou processo, instante UTC, correlação, empresa, fonte, versão, resultado e diferenças quando aplicável;
- funções de cálculo não acessam banco, rede ou relógio; fontes, catálogo, período e instante entram por parâmetro.

## 11. Contrato de interface

### 11.1 Acessos e composição

A mesma experiência é composta em duas rotas:

1. `Empresa -> Razão contábil`, contextualizada na empresa;
2. `Contábil -> Razão`, com seletor de empresa permitido pela carteira.

As rotas compartilham consultas, estados e autorização. A experiência contém:

- abas `Razão` e `Balancete`;
- seletor de período por competências e indicação persistente do marco inicial;
- filtros de conta, centro, lado e texto do histórico/referência;
- razão paginado com data, número, conta, centro, histórico, débito e crédito;
- detalhe lateral com lançamento, partida e eventos relacionados;
- balancete hierárquico com expansão de contas sintéticas e totais;
- alternância entre todas as contas e somente contas com movimento ou saldo;
- indicação explícita de saldo devedor, credor ou zero, sem depender somente de cor;
- estados de carregamento, vazio, erro, projeção inconsistente, reconstrução, permissão insuficiente e empresa fora da carteira.

A reconstrução não aparece para contador, auxiliar ou auditor. Para administrador, exige confirmação com empresa e período afetado, apresenta o resultado da verificação e nunca usa `alert`.

### 11.2 Referências e qualidade

A F42 não possui protótipo dedicado. A interface segue `FRONTEND.md`, `DESIGN-SYSTEM.md`, `docs/design-system/`, `DESIGN-CLARO.md` e `DESIGN-ESCURO.md`.

- temas CLARO e ESCURO completos;
- viewports obrigatórios de 768, 1024 e 1440 px;
- filtros ficam na URL e a consulta é compartilhável dentro da autorização;
- tabela, árvore, paginação, detalhe e diálogo são operáveis por teclado;
- foco visível e devolvido ao acionador após diálogo;
- valores usam `R$` e natureza textual em PT-BR;
- Toast Sonner informa ações; inconsistência permanece visível até resolução;
- `frontend-design` orienta a implementação e `impeccable` fecha o acabamento.

## 12. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | movimento por partida, convenção débito-crédito, saldo anterior/final e natureza |
| Projeção | atomicidade com F40, idempotência, concorrência, retroatividade e ausência de parcial |
| Ciclo | rascunho/descarte sem efeito, efetivação com efeito, cancelamento compensado e estorno como novo lançamento |
| Balancete | contas analíticas, consolidação sintética sem dupla contagem, centro específico, sem centro e todos |
| Integridade | verificação consistente/inconsistente, reconstrução válida, falha preservando versão anterior |
| Banco | RLS, chaves cruzadas, unicidade, versão ativa e append-only |
| Permissões | admin reconstrói; contador verifica; auxiliar/auditor consultam; outro tenant e fora da carteira são negados |
| Tela | duas rotas, URL, estados, CLARO/ESCURO, 768/1024/1440, teclado, foco e leitor de tela |
| E2E | efetivar, consultar razão, conferir balancete, cancelar ou estornar e observar ajuste |
| Contrafactual | duplicação, partida inválida, projeção divergente, período inválido e ação sem permissão |

As funções de cálculo de saldo e consolidação devem atingir 95% de linhas e 100% dos invariantes documentados, conforme ADR-008.

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

## 13. Critérios de aceite verificáveis

- [ ] Cada partida efetivada aparece exatamente uma vez no razão da própria empresa.
- [ ] Rascunho, descarte e efetivação falha não alteram razão ou saldo.
- [ ] Efetivação e projeção confirmam ou revertem juntas, inclusive sob concorrência.
- [ ] Cancelamento preserva o movimento original e cria ajuste compensatório idempotente.
- [ ] Estorno preserva o original e projeta o novo lançamento com lados invertidos.
- [ ] Lançamento retroativo atualiza a competência correta sem reescrever movimentos anteriores.
- [ ] Balancete apresenta saldo anterior, débitos, créditos e saldo final por conta.
- [ ] Conta sintética consolida descendentes uma única vez e nunca recebe movimento direto.
- [ ] Filtro por centro distingue centro específico, `Sem centro` e `Todos`.
- [ ] Valores usam centavos inteiros e totais de débito e crédito não dependem de arredondamento.
- [ ] Interface e API declaram o marco inicial e não inferem saldo anterior desconhecido.
- [ ] Verificação detecta qualquer divergência objetiva entre fonte e projeção.
- [ ] Reconstrução falha não troca a versão ativa; reconstrução válida produz resultado idêntico à fonte.
- [ ] RLS e carteira impedem leitura e comando cruzados entre tenants e empresas.
- [ ] As duas rotas operam sobre a mesma fonte e respeitam a mesma autorização.
- [ ] Tela final passa por CLARO/ESCURO, 768/1024/1440, teclado, foco, acessibilidade e acabamento.
- [ ] Jornada E2E roda integralmente no Docker local com `correlationId` observável.

## 14. Limites e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Carga ou importação de saldos de abertura | fatia contábil própria posterior à F42 |
| Fechamento, bloqueio e reabertura de competência | fatia contábil própria posterior à F42 |
| DRE gerencial | fatia de relatórios alimentada pelo razão estabilizado |
| Livros fiscais, SPED Fiscal, ECD e plano referencial | fatias próprias de escrituração |
| Exportação PDF/CSV e pacote oficial | fatia de relatórios ou escrituração que definir o artefato |
| Origens financeiras, folha e demais automações | fatias próprias dos domínios de origem |
| Operação produtiva | gate de Produção após o MVP-4 |

Nenhum número posterior a F42/SPEC-042 é reservado por estes destinos. É proibido usar a existência da F42 para afirmar que há saldo anterior ao marco inicial, competência fechada, DRE, livro, SPED ou ECD.

## 15. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Capacidade | razão analítico e balancete por período |
| Modelo | projeção persistida, transacional, idempotente e reconstruível |
| Fonte | somente lançamentos efetivados pelas F40/F41 |
| Saldo inicial | não entra; a interface declara o marco inicial disponível |
| Saída consolidada | saldo anterior, débitos, créditos e saldo final por conta |
| Correção | cancelamento gera ajuste; estorno entra como novo lançamento |
| Fechamento | permanece em fatia própria posterior |
| Produção | permanece fora, no gate posterior ao MVP-4 |

**Questões abertas:** nenhuma.

## 16. Gate dos oito itens obrigatórios

| Item | Evidência nesta SPEC |
|---|---|
| Fatia, MVP e Slice | cabeçalho e §§1–2 |
| Comportamento observável | §§3–7 |
| Aceite verificável | §§12–13 |
| Invariantes tocados | §§4–10 |
| Fora de escopo | §§2 e 14 |
| Dúvidas resolvidas | §15; nenhuma aberta |
| Destino do complemento | §14 |
| Contrato de UI | §11, com rotas, estados, temas, viewports e provas |

## 17. Aprovação

Fronteira, projeção, fonte, marco inicial, razão, balancete, cancelamento, estorno, reconstrução, autorização, interface, provas e destinos aprovados pelo PI em 24/09/2026. A implementação deve seguir esta SPEC sem inferir saldo anterior, fechamento ou regra contábil adicional; lacuna material volta ao PI.
