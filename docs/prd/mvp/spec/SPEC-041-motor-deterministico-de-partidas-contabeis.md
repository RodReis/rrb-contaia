# SPEC-041 / F41 — Motor determinístico de partidas contábeis

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD §§3, 5.3, 6.2, 6.5, 10.3, 12, 14, 15 e 16; F18/SPEC-018; F36/SPEC-036 a F40/SPEC-040
>
> **Estado:** aprovada pelo PI em 24/09/2026
>
> **Tamanho:** Grande — regras versionadas, duas famílias de origem, geração idempotente, rateio percentual, pendências, autorização, auditoria e interface final
>
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #55

## 1. Objetivo

Entregar o motor determinístico que transforma fatos contábeis aprovados em rascunhos de lançamentos balanceados da F40/SPEC-040. A configuração pertence a uma empresa e usa o catálogo da F39/SPEC-039 para contabilizar documentos fiscais DF-e normalizados e apurações tributárias aprovadas das F36/SPEC-036 a F38/SPEC-038.

Sucesso significa que uma origem elegível encontra exatamente uma regra publicada e vigente, produz um único rascunho reproduzível, com débito igual a crédito e rateio válido, sem efetivação automática. Ausência, ambiguidade ou configuração inválida gera pendência auditável e nenhum lançamento.

## 2. Fronteira da fatia

Esta fatia entrega:

- cadastro, teste, publicação, substituição e arquivamento de regras contábeis por empresa;
- regras separadas para DF-e aprovado e apuração tributária aprovada;
- vigência civil, versão imutável publicada e critérios objetivos de seleção;
- geração idempotente de rascunho da F40, nunca de lançamento efetivado;
- múltiplas partidas de débito e crédito balanceadas;
- rateio percentual por centros de custo analíticos;
- pendência explícita quando não houver regra única e válida;
- rastreabilidade entre origem, versão da regra, tentativa e rascunho;
- acesso por `Empresa -> Regras contábeis` e `Contábil -> Automatização`;
- interface final nos temas CLARO e ESCURO.

Não entrega razão, saldos, balancete, fechamento, reabertura, DRE, livros, SPED, ECD, plano referencial, efetivação automática, classificação por IA, embeddings, Agente Classificador ou origens financeiras e de folha.

## 3. Regra contábil

### 3.1 Identidade e ciclo

Cada regra possui identificador, empresa, nome, família de origem, critérios, vigência inicial e final opcional, versão, estado e linhas de partida.

Estados:

- `DRAFT`: editável e testável, sem efeito na geração operacional;
- `PUBLISHED`: imutável e elegível dentro da vigência;
- `SUPERSEDED`: substituída por nova versão e preservada para reprodução;
- `ARCHIVED`: indisponível para novas origens, preservada no histórico.

Publicar exige nome, critérios, vigência e partidas completos. Alterar regra publicada cria nova versão; nenhuma edição reescreve resultado anterior. Regras são exclusivas da empresa: não há modelo, herança ou sobrescrita do escritório.

### 3.2 Famílias e critérios

`DFE` aceita somente documento fiscal normalizado, autorizado e aprovado no fluxo aplicável. Os critérios podem usar apenas atributos estruturados persistidos, como modelo, direção, tipo de operação, CFOP, natureza, regime, participante, produto/NCM e tratamento tributário aprovado.

`TAX_ASSESSMENT` aceita somente resultado aprovado de F36, F37 ou F38. Os critérios podem usar apenas tipo de apuração, tributo, regime, competência e natureza do valor aprovado.

- a data do fato gerador seleciona a vigência para DF-e;
- a competência seleciona a vigência para apuração;
- texto livre, similaridade, LLM ou ordem de cadastro não participa da seleção;
- critério usa valor normalizado e operador tipado; curingas precisam ser explícitos;
- a simulação informa quais critérios casaram ou falharam, sem publicar nem gerar rascunho.

## 4. Seleção, geração e idempotência

Para cada origem elegível, o motor:

1. carrega o snapshot aprovado da origem e sua empresa;
2. encontra regras publicadas da mesma empresa, família e vigência;
3. avalia todos os critérios determinísticos;
4. exige exatamente uma regra aplicável;
5. calcula partidas e rateios em centavos;
6. valida catálogo, centros e balanceamento pelas regras da F39/F40;
7. cria atomicamente um rascunho F40 e a rastreabilidade da geração.

Resultados:

| Resultado | Efeito |
|---|---|
| `DRAFT_GENERATED` | um rascunho F40 foi criado e vinculado |
| `NO_MATCH` | pendência criada; nenhum rascunho |
| `AMBIGUOUS_MATCH` | pendência criada com as regras concorrentes; nenhum rascunho |
| `INVALID_CONFIGURATION` | pendência criada com diagnóstico; nenhum rascunho |
| `ALREADY_GENERATED` | retorna a geração existente sem duplicar |

A chave idempotente combina tenant, empresa, identidade e versão do snapshot da origem e versão da regra. Concorrência sobre a mesma chave produz no máximo um rascunho. Falha reverte rascunho e geração; a pendência é registrada de modo consistente.

O motor não escolhe regra por prioridade, especificidade presumida ou cadastro mais recente. Nenhuma regra ou mais de uma regra bloqueia a geração até correção da configuração ou nova versão elegível.

## 5. Partidas e rateio

- cada regra possui pelo menos duas linhas e deve fechar débito igual a crédito na simulação e na geração;
- linhas apontam para contas analíticas, completas, ativas e da mesma empresa;
- valores derivam somente dos campos monetários tipados da origem e de operações determinísticas declaradas;
- dinheiro permanece em centavos inteiros; float é proibido;
- uma linha sem rateio segue a política de centro da conta da F39;
- rateio usa centros analíticos ativos da mesma empresa e percentuais tipados que somam exatamente 100%;
- cada parcela resultante vira uma linha explícita do rascunho F40 com um centro;
- divisão usa centavos e método determinístico: piso por parcela e distribuição do resíduo, um centavo por vez, na ordem persistida dos itens de rateio;
- o rateio nunca altera o total da linha nem cria valor zero;
- conta ou centro inválido, percentual incompleto ou resultado desbalanceado produz `INVALID_CONFIGURATION`.

## 6. Mudança da origem e correção

- nova versão aprovada da origem constitui novo snapshot e nunca altera a geração anterior;
- se o rascunho anterior ainda estiver `DRAFT`, ele é marcado como superado, permanece auditável e não pode ser efetivado;
- a nova versão pode gerar um novo rascunho sob nova chave idempotente;
- se o lançamento já estiver `POSTED`, permanece imutável; a correção exige cancelamento ou estorno da F40 e nova geração;
- a F41 não cancela, estorna nem efetiva lançamento automaticamente;
- arquivar ou substituir uma regra não invalida rascunho já gerado; a efetivação revalida conta, centro, origem vigente e estado não superado.

## 7. Autorização e isolamento

O catálogo de permissões recebe, em `Contábil -> Automatização`:

| Ação | Efeito |
|---|---|
| `Consultar` | listar regras, versões, simulações, gerações e pendências |
| `Manter regras` | criar e editar rascunhos de regra e rateios |
| `Publicar regras` | publicar, substituir e arquivar versões |
| `Processar origens` | gerar ou reprocessar rascunhos e tratar pendências |

Padrão inicial:

- `admin_escritorio`: todas as ações dentro do tenant;
- `contador`: todas as ações somente para empresa da carteira ativa;
- `auxiliar`: consultar, simular, processar origens e revisar o rascunho F40 da empresa da carteira, sem publicar regra nem efetivar lançamento;
- `auditor_readonly`: consultar em modo somente leitura dentro da alçada;
- demais papéis: negados por padrão.

Toda consulta e comando revalida usuário, tenant, empresa, carteira e permissão. Regra, origem, conta, centro, geração e rascunho devem pertencer à mesma empresa. Falha de autorização não revela existência ou conteúdo externo à alçada.

## 8. Contratos mínimos

```ts
type AccountingRuleSource = "DFE" | "TAX_ASSESSMENT";
type AccountingRuleStatus = "DRAFT" | "PUBLISHED" | "SUPERSEDED" | "ARCHIVED";
type AccountingGenerationResult =
  | "DRAFT_GENERATED"
  | "NO_MATCH"
  | "AMBIGUOUS_MATCH"
  | "INVALID_CONFIGURATION"
  | "ALREADY_GENERATED";

type AccountingRule = {
  ruleId: string;
  tenantId: string;
  companyId: string;
  name: string;
  source: AccountingRuleSource;
  validFrom: string;
  validUntil: string | null;
  version: number;
  status: AccountingRuleStatus;
  criteria: AccountingRuleCriterion[];
  lines: AccountingRuleLine[];
};

type AccountingRuleLine = {
  side: "DEBIT" | "CREDIT";
  accountId: string;
  amountExpression: string;
  allocation: Array<{ costCenterId: string; percentageBasisPoints: number }>;
  position: number;
};

type AccountingGeneration = {
  generationId: string;
  tenantId: string;
  companyId: string;
  sourceType: AccountingRuleSource;
  sourceId: string;
  sourceVersion: number;
  ruleId: string | null;
  ruleVersion: number | null;
  result: AccountingGenerationResult;
  draftEntryId: string | null;
};
```

`amountExpression` não é código arbitrário: usa uma gramática fechada, versionada e validada pelo domínio, limitada a campos monetários permitidos e operações aritméticas determinísticas. Percentual usa pontos-base inteiros; 100% equivale a `10000`.

Erros HTTP seguem `application/problem+json` e distinguem, no mínimo:

- `ACCOUNTING_RULE_NO_MATCH`;
- `ACCOUNTING_RULE_AMBIGUOUS_MATCH`;
- `ACCOUNTING_RULE_INVALID_CONFIGURATION`;
- `ACCOUNTING_RULE_VERSION_CONFLICT`;
- `ACCOUNTING_RULE_IMMUTABLE`;
- `ACCOUNTING_RULE_SOURCE_INELIGIBLE`;
- `ACCOUNTING_RULE_ALLOCATION_INVALID`;
- `ACCOUNTING_GENERATION_ALREADY_EXISTS`;
- `ACCOUNTING_GENERATION_FORBIDDEN`.

## 9. Persistência, concorrência e auditoria

- regras, versões, critérios, linhas, rateios, gerações, pendências e eventos possuem tenant e empresa obrigatórios, indexados e sob RLS;
- versão publicada é imutável e preserva os identificadores de conta e centro usados;
- unicidade da chave idempotente é protegida no banco;
- geração e criação do rascunho F40 ocorrem na mesma transação;
- caso de uso controla a transação; controller somente valida entrada e delega;
- criação, edição, simulação, publicação, substituição, arquivamento, geração, pendência, reprocessamento, conflito e tentativa negada relevante geram evento append-only;
- evento registra autor, instante UTC, correlação, origem e versão, regra e versão, resultado e rascunho quando existir;
- funções de domínio não acessam banco, rede ou relógio; dados e instante entram por parâmetro.

## 10. Contrato de interface

### 10.1 Acessos e composição

A mesma experiência é composta em duas rotas:

1. `Empresa -> Regras contábeis`, contextualizada na empresa;
2. `Contábil -> Automatização`, com seletor de empresa permitido pela carteira.

As rotas compartilham consultas, comandos e autorização. A experiência contém:

- abas `Regras`, `Simulação`, `Gerações` e `Pendências`;
- lista de regras com origem, vigência, versão e estado;
- editor de critérios e grade de partidas/rateios;
- totais de débito, crédito, diferença e percentual por linha;
- simulação com origem selecionada e explicação critério a critério;
- detalhe da geração ligando origem, regra versionada e rascunho F40;
- pendências por ausência, ambiguidade ou configuração inválida, sem botão de escolha oportunista;
- ações de criar versão, publicar, substituir, arquivar, simular e reprocessar;
- estados de carregamento, vazio, erro, conflito, permissão insuficiente, empresa fora da carteira e sucesso.

### 10.2 Referências e qualidade

A F41 não possui protótipo dedicado. A interface compõe a direção do módulo `Plano & Partidas Dobradas`, sem copiar defeitos do protótipo, e obedece `FRONTEND.md`, `DESIGN-SYSTEM.md`, `docs/design-system/`, `DESIGN-CLARO.md` e `DESIGN-ESCURO.md`.

- temas CLARO e ESCURO completos;
- viewports obrigatórios de 768, 1024 e 1440 px;
- editor, tabelas, abas, diálogos e ações operáveis por teclado;
- foco visível e devolvido ao acionador;
- falha de critério e diferença contábil não dependem somente de cor;
- confirmação não usa `alert`; feedback usa Toast Sonner e estado persistente;
- `frontend-design` orienta a implementação e `impeccable` fecha o acabamento.

## 11. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | vigência, família, critérios tipados, versão imutável, regra por empresa e balanceamento |
| Origens | DF-e aprovado e F36–F38 aprovadas; origem pendente, rejeitada ou de outra empresa bloqueada |
| Seleção | exatamente uma regra, nenhuma regra e múltiplas regras sem precedência implícita |
| Rateio | 100%, pontos-base, centavos, resíduo determinístico, centro inválido e valor zero |
| Idempotência | repetição, concorrência, nova versão da origem e rollback sem rascunho órfão |
| Integração F39/F40 | contas/centros válidos, rascunho balanceado e efetivação exclusivamente pela F40 |
| Banco | RLS, empresa/tenant, chave idempotente, atomicidade e append-only |
| Permissões | contador/admin mantêm; auxiliar simula/processa; auditor consulta; outra carteira é negada |
| Tela | duas rotas, quatro abas, estados, CLARO/ESCURO, 768/1024/1440, teclado, foco e leitor de tela |
| E2E | publicar regra, simular, gerar rascunho, revisar na F40, provocar pendência e reprocessar |
| Contrafactual | regra cruzada, duas regras, soma diferente de 100%, origem alterada e conta arquivada |

O motor deve atingir 95% de linhas e 100% dos invariantes documentados, conforme ADR-008.

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

## 12. Critérios de aceite verificáveis

- [ ] Regra pertence a uma empresa e não herda configuração do escritório ou de outra empresa.
- [ ] Somente versão publicada, vigente e da família correta participa da geração.
- [ ] DF-e e apuração tributária não compartilham critérios incompatíveis.
- [ ] Uma única regra aplicável gera exatamente um rascunho F40 balanceado.
- [ ] Nenhuma regra ou múltiplas regras geram pendência e nenhum rascunho.
- [ ] Repetição e concorrência não duplicam geração nem rascunho.
- [ ] Rateios somam 100%, preservam o total em centavos e distribuem resíduo deterministicamente.
- [ ] Conta e centro inválidos bloqueiam toda a geração sem mutação parcial.
- [ ] Auxiliar pode simular, processar e revisar rascunho, mas não publicar regra nem efetivar.
- [ ] Contador/admin publicam versões e efetivam o rascunho somente pelo fluxo da F40.
- [ ] Nova versão da origem supera rascunho ainda não efetivado sem apagar histórico.
- [ ] Origem já efetivada exige cancelamento/estorno explícito antes da nova contabilização.
- [ ] Origem, regra, tentativa, pendência e rascunho possuem rastreabilidade append-only.
- [ ] RLS e carteira bloqueiam leitura e escrita cruzada entre tenants e empresas.
- [ ] Tela final passa por CLARO/ESCURO, 768/1024/1440, teclado, foco, acessibilidade e acabamento.
- [ ] Jornada E2E roda no Docker local com `correlationId` observável.

## 13. Limites e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Razão, saldos e balancete | futura fatia nominal de razão contábil |
| Fechamento, bloqueio e reabertura de competência | futura fatia nominal de fechamento contábil |
| Classificação assistida, embeddings e histórico aprendido | fatia própria do Agente Classificador |
| Contas a pagar/receber, extratos, Open Finance, Pix e conciliação | fatias próprias do RF-04 |
| Folha e eventos de departamento pessoal | fatias próprias do MVP-3 |
| DRE gerencial | fatia de relatórios alimentada pelo futuro razão |
| Livros, SPED Fiscal, ECD e plano referencial | fatias próprias de escrituração |
| Operação produtiva | gate de Produção após o MVP-4 |

Nenhum número posterior a F41/SPEC-041 é reservado por estes destinos. É proibido usar a existência da F41 para afirmar que há saldo, razão, fechamento, escrituração, classificação por IA ou integração financeira.

## 14. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Capacidade | motor determinístico de partidas contábeis |
| Origens | DF-e aprovados e apurações tributárias aprovadas das F36–F38 |
| Resultado | rascunho para revisão; nenhuma efetivação automática |
| Rateio | percentual por centro, fechando 100% |
| Ausência ou conflito | pendência sem lançamento; não há prioridade implícita |
| Configuração | exclusiva por empresa, sem herança do escritório |
| Interface | duas rotas compartilhando a mesma experiência |
| Produção | permanece fora, no gate posterior ao MVP-4 |

**Questões abertas:** nenhuma.

## 15. Gate dos oito itens obrigatórios

| Item | Evidência nesta SPEC |
|---|---|
| Fatia, MVP e Slice | cabeçalho e §§1–2 |
| Comportamento observável | §§3–6 |
| Aceite verificável | §§11–12 |
| Invariantes tocados | §§4–9 |
| Fora de escopo | §§2 e 13 |
| Dúvidas resolvidas | §14; nenhuma aberta |
| Destino do complemento | §13 |
| Contrato de UI | §10, com rotas, estados, temas, viewports e provas |

## 16. Aprovação

Fronteira, origens, regras, seleção, rascunho, rateio, idempotência, autorização, interface, provas e destinos aprovados pelo PI em 24/09/2026. A implementação deve seguir esta SPEC sem criar regra contábil ou de produto adicional; lacuna material volta ao PI.
