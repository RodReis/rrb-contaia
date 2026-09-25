# SPEC-044 / F44 — Saldos de abertura contábil

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD §§3, 4.2, 6.2, 6.5, 12, 14, 15 e 16; F39/SPEC-039, F40/SPEC-040, F42/SPEC-042 e F43/SPEC-043
>
> **Estado:** aprovada pelo PI em 24/09/2026
>
> **Tamanho:** Médio — entrada manual e CSV, prévia, aprovação, versionamento, reconstrução do razão, concorrência, auditoria e interface final
>
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #58

## 1. Objetivo

Entregar um único marco de abertura contábil por empresa, com saldos por conta analítica informados manualmente ou por CSV. O contador ou administrador prepara, revisa e aprova uma carga equilibrada; a aprovação cria um movimento contábil próprio, imutável e rastreável que passa a compor o razão e o balancete da F42.

Sucesso significa que o saldo anterior deixa de ser desconhecido a partir da data-base aprovada; nenhuma abertura desequilibrada ou com conta inválida é aplicada; versões substituídas permanecem auditáveis; e períodos já fechados pela F43 nunca são reescritos por uma correção de abertura.

## 2. Fronteira da fatia

Esta fatia entrega:

- um marco de abertura ativo por empresa;
- data-base civil que representa a posição ao fim do dia informado;
- preparação manual e importação CSV com prévia integral;
- saldos devedores ou credores por conta analítica e centro de custo quando exigido pela F39;
- rascunho revisável antes da aprovação;
- validação determinística de contas, centros, duplicidades e equilíbrio;
- aprovação humana por contador ou administrador autorizado;
- movimento contábil próprio `OPENING`, separado dos lançamentos manuais da F40;
- integração transacional e reconstruível com razão e balancete da F42;
- substituição por nova versão controlada, com motivo e preservação da anterior;
- bloqueio de substituição quando existir competência fechada a partir do marco;
- histórico, hash reproduzível, concorrência e auditoria append-only;
- interface final nos temas CLARO e ESCURO.

Não entrega DRE, plano referencial, livros fiscais, SPED Fiscal, ECD, malha preventiva, fechamento em lote, exportação oficial, conversão automática de balancetes de terceiros ou produção.

## 3. Identidade e ciclo de vida

- a unidade é `(tenant, empresa)`;
- cada empresa possui no máximo uma versão ativa de abertura;
- os estados são `DRAFT`, `APPROVED` e `SUPERSEDED`;
- um rascunho pode ser criado manualmente ou por CSV e permanece sem efeito contábil;
- aprovação transforma integralmente o rascunho validado em nova versão ativa;
- uma versão aprovada nunca é editada, apagada ou devolvida a rascunho;
- substituição cria novo rascunho e, após aprovação, marca a versão anterior como `SUPERSEDED` na mesma transação;
- somente a versão `APPROVED` ativa compõe a projeção F42;
- versão cresce monotonicamente por empresa e nunca é reaproveitada;
- rascunhos concorrentes podem existir, mas somente um deles pode vencer a aprovação sobre a versão esperada.

## 4. Data-base e marco inicial

- a data-base é uma data civil `AAAA-MM-DD` e representa a posição encerrada ao fim daquele dia;
- lançamentos operacionais válidos para o razão começam no dia seguinte;
- a data-base deve ser anterior ao primeiro lançamento efetivado da empresa;
- a aprovação define o marco inicial conhecido da F42 como o dia seguinte à data-base;
- uma empresa sem abertura continua exibindo saldo anterior desconhecido, conforme a F42;
- data-base igual ou posterior ao primeiro movimento efetivado é recusada;
- trocar a data-base em nova versão exige as mesmas validações e não pode excluir movimentos existentes do universo projetado;
- datas e valores nunca são inferidos do nome do arquivo ou do relógio do servidor.

## 5. Linhas e equilíbrio

Cada linha da abertura contém:

- conta analítica ativa do catálogo F39;
- centro de custo ativo quando a política da conta o exigir;
- valor de débito ou valor de crédito, em centavos inteiros;
- observação opcional, sem efeito sobre o cálculo;
- origem manual ou número da linha do CSV.

Regras:

- exatamente um entre débito e crédito deve ser maior que zero;
- valor zero, negativo, fracionário além de centavos ou simultaneamente devedor e credor é inválido;
- conta sintética, arquivada, inexistente ou de outro tenant/empresa é inválida;
- centro proibido, obrigatório ausente, arquivado ou de outra empresa é inválido;
- a chave lógica `(conta, centro)` não se repete no mesmo rascunho;
- contas sem saldo são omitidas; não se persistem linhas zeradas;
- soma dos débitos deve ser exatamente igual à soma dos créditos;
- o sistema não cria conta transitória, contrapartida, diferença de arredondamento ou natureza por inferência.

## 6. Entrada manual

- usuário autorizado escolhe empresa e data-base e inclui linhas por conta e centro;
- busca de conta retorna apenas contas analíticas ativas permitidas;
- a interface mantém totais de débito, crédito e diferença sempre visíveis;
- salvar rascunho não exige equilíbrio, mas registra todos os impedimentos conhecidos;
- submeter para aprovação exige validação integral e diferença zero;
- edição usa versão esperada; conflito não sobrescreve trabalho concorrente;
- remover linha de rascunho é permitido e auditado; versões aprovadas não admitem remoção.

## 7. Importação CSV e prévia atômica

O CSV usa UTF-8, cabeçalho obrigatório e colunas:

| Coluna | Regra |
|---|---|
| `codigo_conta` | código exato da conta analítica F39 |
| `codigo_centro_custo` | opcional ou obrigatório conforme a política da conta |
| `debito` | valor monetário decimal pt-BR ou vazio |
| `credito` | valor monetário decimal pt-BR ou vazio |
| `observacao` | opcional |

- arquivo limitado a 10 MB e 10.000 linhas de dados;
- prévia valida todas as linhas e apresenta aceitas, rejeitadas e motivos sem aplicar efeito contábil;
- qualquer linha inválida, cabeçalho inválido, duplicidade ou desequilíbrio torna a prévia `INVALID`;
- prévia inválida não cria nem altera linhas do rascunho;
- confirmar prévia `VALID` substitui integralmente as linhas do rascunho alvo na mesma transação;
- confirmação exige o hash do arquivo e a versão esperada da prévia e do rascunho;
- repetir a mesma confirmação com a mesma chave idempotente retorna o mesmo resultado;
- o sistema não aceita importação parcial, XLS, XLSX, ODS, PDF ou imagem nesta fatia;
- erros são coletados por linha; atomicidade não autoriza interromper a validação no primeiro erro.

## 8. Aprovação e movimento de abertura

- `contador` e `admin_escritorio` podem aprovar dentro da carteira autorizada;
- `auxiliar` pode preparar rascunho, mas não aprovar;
- aprovação revalida data-base, catálogo, centros, valores, equilíbrio, versão esperada e ausência de fechamento impeditivo;
- aprovação registra autor humano, instante, correlação, origem, totais, quantidade de linhas e hash canônico;
- na mesma transação, cria a versão aprovada, ativa o movimento `OPENING`, atualiza o marco e reconstrói a projeção F42;
- o movimento de abertura aparece no razão analítico com identificação textual de abertura, versão e data-base;
- o movimento não recebe numeração de lançamento manual F40 e não pode ser cancelado ou estornado pela F40;
- rascunho aprovado por repetição idempotente não gera segunda versão ou segundo movimento;
- falha em qualquer etapa não deixa versão, movimento ou projeção parcial.

## 9. Substituição e reconstrução

- nova versão parte de rascunho independente e exige motivo de substituição na aprovação;
- substituição é recusada se houver competência `CLOSED` ativa cuja data seja posterior à data-base vigente ou proposta;
- competências reabertas não bloqueiam por si; os demais gates continuam aplicáveis;
- a nova abertura deve permanecer anterior ao primeiro movimento operacional efetivado;
- aprovação substitutiva marca a versão anterior como `SUPERSEDED`, ativa a nova e reconstrói todos os períodos abertos afetados;
- reconstrução é determinística, transacional e idempotente;
- versões e movimentos anteriores permanecem consultáveis, mas não participam da projeção corrente;
- divergência de hash ou falha de reconstrução bloqueia a substituição sem alterar a versão ativa.

## 10. Autorização e isolamento

O catálogo de permissões recebe, em `Contábil -> Saldos de abertura`:

| Ação | Efeito |
|---|---|
| `Consultar` | consultar rascunhos, versão ativa e histórico |
| `Preparar` | criar e editar rascunho manual ou importar CSV |
| `Aprovar` | aprovar primeira versão ou substituição |

Padrão inicial:

- `admin_escritorio`: consultar, preparar e aprovar dentro do tenant;
- `contador`: consultar, preparar e aprovar somente empresa da carteira ativa;
- `auxiliar`: consultar e preparar somente empresa da carteira ativa;
- `auditor_readonly`: consultar em modo somente leitura dentro da alçada;
- demais papéis: negados por padrão.

Toda consulta e comando revalida usuário, tenant, empresa, carteira e permissão. Falha não revela conta, centro, saldo, data-base ou existência de empresa fora da alçada.

## 11. Contratos mínimos

```ts
type OpeningBalanceStatus = "DRAFT" | "APPROVED" | "SUPERSEDED";
type OpeningBalanceSource = "MANUAL" | "CSV";

type OpeningBalanceLine = {
  accountId: string;
  costCenterId: string | null;
  debitCents: number;
  creditCents: number;
  note: string | null;
};

type OpeningBalanceVersion = {
  openingBalanceId: string;
  tenantId: string;
  companyId: string;
  version: number;
  status: OpeningBalanceStatus;
  baseDate: string;
  source: OpeningBalanceSource;
  debitCents: number;
  creditCents: number;
  contentHash: string;
  approvedBy: string | null;
  approvedAt: string | null;
};
```

Comandos de importação, aprovação e substituição recebem `Idempotency-Key`, empresa e versão esperada. Substituição recebe motivo obrigatório. Consultas retornam rascunho, impedimentos, totais, versão ativa e histórico.

Erros HTTP seguem `application/problem+json` e distinguem, no mínimo:

- `OPENING_BALANCE_BASE_DATE_INVALID`;
- `OPENING_BALANCE_MOVEMENT_EXISTS`;
- `OPENING_BALANCE_ACCOUNT_INVALID`;
- `OPENING_BALANCE_COST_CENTER_INVALID`;
- `OPENING_BALANCE_DUPLICATE_LINE`;
- `OPENING_BALANCE_LINE_INVALID`;
- `OPENING_BALANCE_UNBALANCED`;
- `OPENING_BALANCE_CSV_INVALID`;
- `OPENING_BALANCE_CLOSED_PERIOD_EXISTS`;
- `OPENING_BALANCE_REPLACEMENT_REASON_REQUIRED`;
- `OPENING_BALANCE_CONFLICT`;
- `OPENING_BALANCE_FORBIDDEN`.

## 12. Persistência, concorrência e auditoria

- rascunho, versões, linhas, prévias e eventos possuem tenant e empresa obrigatórios, indexados e sob RLS;
- unicidade parcial protege uma única versão aprovada ativa por empresa;
- aprovação usa compare-and-swap da versão ativa e do rascunho;
- chave idempotente é única por empresa, operação e versão esperada;
- versões aprovadas, linhas aprovadas, movimentos, hashes e eventos não aceitam `UPDATE` nem `DELETE`;
- rascunho pode ser alterado por versão otimista e mantém eventos de mudança;
- tentativa negada relevante, importação, aprovação, substituição e conflito geram evento append-only;
- evento registra ator, instante, correlação, empresa, versão, data-base, origem, resultado, impedimentos e motivo quando aplicável;
- canonicalização, equilíbrio e hash são funções puras; banco, rede e relógio entram por adaptadores ou parâmetros.

## 13. Invariantes globais tocados

| Invariante | Aplicação na F44 |
|---|---|
| I-1 | tabelas transacionais carregam tenant e empresa, com índices e RLS |
| I-2 | consulta sem tenant não retorna abertura, linha, prévia ou evento |
| I-3 | débitos, créditos e diferenças usam centavos inteiros, sem float |
| I-4 | equilíbrio, projeção e reconstrução são determinísticos; LLM não calcula |
| I-5 | abertura só produz efeito após aprovação humana registrada |
| I-6 | versões aprovadas, movimentos e trilha são append-only |
| I-7 | abertura aprovada não é apagada; substituição preserva o histórico |
| I-9 | importação, aprovação e substituição são idempotentes |
| I-11 | data-base é civil; instantes seguem UTC e exibição em `America/Sao_Paulo` |
| I-12 | reconstruir com a mesma abertura e lançamentos produz o mesmo razão e balancete |

## 14. Contrato de interface

### 14.1 Acessos e composição

A experiência integra as rotas contábeis existentes:

1. `Empresa -> Razão contábil -> Saldo de abertura`, contextualizada na empresa;
2. `Contábil -> Saldos de abertura`, com seletor de empresa permitido pela carteira.

As rotas compartilham dados e autorização. A interface contém:

- estado atual, data-base, versão, origem, autor e hash;
- grade manual com conta, centro, débito, crédito, observação e erro por linha;
- totais fixos de débito, crédito e diferença;
- upload CSV, resumo da prévia e download do relatório de erros;
- impedimentos persistentes e ação de correção;
- diálogo de aprovação nomeando empresa, data-base, totais e quantidade de linhas;
- diálogo de substituição com motivo obrigatório e impacto explicado;
- histórico de versões com comparação de totais e data-base;
- ligação para visualizar o movimento `OPENING` no razão;
- estados de carregamento, vazio, rascunho, prévia válida, prévia inválida, desequilibrado, pronto para aprovação, aprovado, substituído, conflito, bloqueado por fechamento e permissão insuficiente.

### 14.2 Referências e qualidade

Não existe protótipo dedicado. A composição usa `docs/telas/contaia_central_de_escritura_o_sped_ecd_malha_fiscal_preventiva_rf_03/` somente como referência de conteúdo e fluxo; `FRONTEND.md`, `DESIGN-SYSTEM.md`, `docs/design-system/`, `DESIGN-CLARO.md` e `DESIGN-ESCURO.md` vencem seus defeitos conhecidos.

- temas CLARO e ESCURO completos;
- viewports obrigatórios de 768, 1024 e 1440 px;
- empresa e rascunho ficam na URL quando aplicável;
- grade, upload, prévia, histórico e diálogos operam por teclado;
- foco visível e devolvido ao acionador;
- estados e diferença não dependem somente de cor;
- valores seguem máscara monetária pt-BR e são enviados em centavos;
- Toast Sonner informa sucesso e falha; erros por linha e impedimentos persistem na tela;
- `frontend-design` orienta a implementação e `impeccable` fecha o acabamento.

## 15. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | data-base, linha devedora/credora, duplicidade, equilíbrio e substituição |
| CSV | UTF-8, cabeçalho, limites, formatos monetários, erros completos e atomicidade |
| Integração | aprovação cria `OPENING`, atualiza F42 e preserva lançamentos F40/F41 |
| Reconstrução | mesma fonte gera mesmos totais e hash; nova versão recompõe períodos abertos |
| Concorrência | duas aprovações, aprovação × edição e substituições concorrentes |
| Banco | RLS, chaves cruzadas, versão ativa única, idempotência e append-only |
| Permissões | admin/contador aprovam; auxiliar prepara; auditor consulta |
| Tela | duas rotas, grade, CSV, histórico, CLARO/ESCURO, 768/1024/1440, teclado e foco |
| E2E | preparar manualmente, importar CSV, aprovar, consultar no razão e substituir |
| Contrafactual | conta sintética/arquivada, centro inválido, desequilíbrio, movimento anterior, fechamento e outro tenant |

As funções de validação, equilíbrio, canonicalização e hash devem atingir 95% de linhas e 100% dos invariantes documentados, conforme ADR-008.

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

## 16. Critérios de aceite verificáveis

- [ ] Cada empresa possui no máximo uma versão aprovada ativa de abertura.
- [ ] Data-base representa o fim do dia e antecede todo movimento operacional efetivado.
- [ ] Entrada manual e CSV validam somente contas analíticas ativas e centros permitidos.
- [ ] CSV inválido informa todos os erros encontrados e não altera parcialmente o rascunho.
- [ ] Linha possui débito ou crédito positivo, nunca ambos; linhas zeradas não são persistidas.
- [ ] Aprovação é recusada enquanto débitos e créditos diferirem por qualquer centavo.
- [ ] Apenas contador ou administrador da alçada aprova; auxiliar somente prepara.
- [ ] Aprovação cria movimento próprio `OPENING`, imutável e visível no razão.
- [ ] Razão e balancete acumulam movimentos posteriores sobre a abertura ativa.
- [ ] Repetição idempotente não duplica versão, linha, movimento ou projeção.
- [ ] Substituição exige motivo, preserva versões anteriores e reconstrói períodos abertos.
- [ ] Existência de competência fechada afetada bloqueia a substituição.
- [ ] RLS e carteira impedem consulta e comando entre tenants ou empresas não autorizadas.
- [ ] As duas rotas usam a mesma fonte e autorização.
- [ ] Tela final passa por CLARO/ESCURO, 768/1024/1440, teclado, foco, acessibilidade e acabamento.
- [ ] Jornada E2E roda integralmente no Docker local com `correlationId` observável.

## 17. Limites e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| DRE gerencial | fatia própria de relatórios do MVP-2 alimentada pelo razão estabilizado |
| Plano referencial | fatia própria de escrituração contábil do MVP-2 |
| Livros fiscais, SPED Fiscal e ECD | fatias próprias de escrituração do MVP-2 |
| Conversão automática de balancetes ou formatos de terceiros | fatia própria de migração contábil, se priorizada pelo PI |
| XLSX, ODS, PDF e imagem | fatia própria de expansão da entrada de abertura, se priorizada pelo PI |
| Malha SPED × DF-e × extrato | fatia própria de malha preventiva do MVP-2 |
| Fechamento em lote | fatia posterior, condicionada à operação multiempresa |
| Exportação PDF/CSV e pacote oficial | fatia de relatórios ou escrituração que definir o artefato |
| Produção | gate posterior ao MVP-4 |

Nenhum número posterior a F44/SPEC-044 é reservado por estes destinos. A F44 não transforma razão ou balancete em livro oficial e não cria saldo, diferença ou contrapartida por inferência.

## 18. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Capacidade | saldos de abertura contábil |
| Entrada | manual e CSV |
| Unidade | um marco por empresa |
| Aplicação | somente após revisão e aprovação |
| Correção | nova versão controlada; edição da versão ativa é proibida |
| Aprovação | `admin_escritorio` ou `contador` dentro da alçada |
| CSV | prévia atômica; qualquer erro impede aplicação parcial |
| Data-base | posição ao fim do dia anterior ao início dos movimentos |
| Razão | movimento próprio `OPENING`, sem fingir lançamento manual F40 |
| Produção | permanece fora, no gate posterior ao MVP-4 |

**Questões abertas:** nenhuma.

## 19. Gate dos oito itens obrigatórios

| Item | Evidência nesta SPEC |
|---|---|
| Fatia, MVP e Slice | cabeçalho e §§1–2 |
| Comportamento observável | §§3–9 |
| Aceite verificável | §§15–16 |
| Invariantes tocados | §13, com I-1, I-2, I-3, I-4, I-5, I-6, I-7, I-9, I-11 e I-12 |
| Fora de escopo | §§2 e 17 |
| Dúvidas resolvidas | §18; nenhuma aberta |
| Destino do complemento | §17 |
| Contrato de UI | §14, com rotas, estados, temas, viewports e provas |

## 20. Aprovação

Capacidade, entrada manual e CSV, unidade por empresa, revisão, aprovação, versionamento, prévia atômica, data-base, movimento `OPENING`, interface, provas e destinos aprovados pelo PI em 24/09/2026. A implementação deve seguir esta SPEC sem inferir contrapartida, diferença, escrituração oficial ou formato adicional; lacuna material volta ao PI.
