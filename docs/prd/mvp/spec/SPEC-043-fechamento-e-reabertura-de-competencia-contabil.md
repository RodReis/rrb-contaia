# SPEC-043 / F43 — Fechamento e reabertura de competência contábil

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD §§3, 6.2, 6.5, 12, 14, 15 e 16; F40/SPEC-040 e F42/SPEC-042
>
> **Estado:** aprovada pelo PI em 24/09/2026
>
> **Tamanho:** Médio — ciclo mensal, gates, snapshot reproduzível, concorrência, autorização, auditoria e interface final
>
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #57

## 1. Objetivo

Entregar o fechamento e a reabertura mensal da competência contábil por empresa. O contador ou administrador encerra explicitamente um período íntegro; o sistema preserva um snapshot reproduzível do razão e do balancete da F42, bloqueia operações incompatíveis e mantém cada fechamento e reabertura em trilha append-only.

Sucesso significa que nenhuma competência é fechada fora de sequência, com projeção inconsistente ou lançamentos em rascunho; o fechamento pode ser reproduzido exatamente; competência fechada aceita somente estorno; e apenas administrador pode reabrir com motivo, sem apagar a versão fechada anterior.

## 2. Fronteira da fatia

Esta fatia entrega:

- competência contábil mensal por empresa, com estados `OPEN`, `CLOSED` e `REOPENED`;
- fechamento humano explícito por contador ou administrador autorizado da carteira;
- gates de integridade contábil, ausência de rascunhos e sequência mensal;
- fechamento explícito de competência sem movimentos mediante confirmação adicional;
- snapshot imutável e reproduzível do fechamento;
- bloqueio de novos lançamentos, alteração e cancelamento após o fechamento;
- estorno em competência fechada conforme a F40 e `CONVENTION.md` §5.3;
- reabertura exclusiva de administrador, com motivo obrigatório;
- versionamento de fechamentos sucessivos após reabertura;
- consulta do estado, snapshot e histórico pelas experiências contábeis da F42;
- interface final nos temas CLARO e ESCURO.

Não entrega saldo de abertura, DRE, malha SPED × DF-e × extrato, livros fiscais, SPED Fiscal, ECD, plano referencial, exportação oficial, transmissão ou produção.

## 3. Identidade, estado e sequência

- a unidade do ciclo é `(tenant, empresa, competência AAAA-MM)`;
- competência sem ciclo persistido é considerada `OPEN`, sem inventar fechamento;
- `CLOSED` identifica uma versão ativa de fechamento;
- `REOPENED` registra que a versão fechada anterior foi reaberta e não é mais a versão ativa;
- novo fechamento após reabertura cria versão seguinte; nunca atualiza a versão anterior;
- fechamento é sequencial desde o marco inicial conhecido da F42;
- uma competência só fecha se todas as competências mensais anteriores, desde esse marco, possuírem fechamento ativo;
- competência anterior sem movimentos também precisa de fechamento explícito; o sistema não fecha lacunas automaticamente;
- não existe fechamento global do tenant nem fechamento em lote nesta fatia.

## 4. Gates do fechamento

O fechamento valida, na mesma operação:

1. usuário, tenant, empresa, carteira e permissão;
2. competência válida e ainda aberta;
3. inexistência de competência anterior aberta desde o marco inicial;
4. projeção ativa da F42 com integridade `CONSISTENT`;
5. ausência de lançamento `DRAFT` na competência;
6. igualdade entre totais da projeção e lançamentos fonte efetivados;
7. equilíbrio entre débitos e créditos da competência;
8. ausência de outro fechamento concorrente ativo.

Falha em qualquer gate não cria snapshot, evento de sucesso ou estado parcial. A resposta informa impedimentos objetivos, sem corrigir ou descartar lançamentos silenciosamente.

A malha preventiva SPED × DF-e × extrato não é gate da F43 porque ainda pertence a fatia futura. Sua implementação poderá acrescentar impedimentos antes do fechamento sem invalidar os fechamentos contábeis desta fatia.

## 5. Competência sem movimentos

Competência sem movimentos pode ser fechada para manter a sequência mensal, desde que:

- o usuário confirme explicitamente empresa, competência e ausência de movimentos;
- os demais gates aplicáveis estejam válidos;
- o snapshot registre totais zerados, quantidade zero e a condição `EMPTY_CONFIRMED`;
- a confirmação, autor e instante integrem a trilha.

Não há fechamento automático de mês vazio.

## 6. Snapshot reproduzível

Cada fechamento preserva, no mínimo:

- tenant, empresa, competência e versão do fechamento;
- versão ativa da projeção F42;
- marco inicial conhecido;
- totais de débito e crédito, quantidade de movimentos e lançamentos;
- balancete por conta com saldo anterior, débitos, créditos, saldo final e natureza;
- condição normal ou competência vazia confirmada;
- autor, instante UTC, correlação e permissões verificadas;
- hash determinístico do conteúdo canônico.

O snapshot é imutável e append-only. Recalcular com as mesmas fontes e versões produz o mesmo conteúdo e hash. Divergência posterior é exibida como inconsistência; nunca reescreve o fechamento histórico.

Valores monetários usam inteiros em centavos. Competência é data civil `AAAA-MM`; instantes são UTC no banco e `America/Sao_Paulo` na exibição.

## 7. Efeito sobre lançamentos

Enquanto houver fechamento ativo:

- novo lançamento com competência fechada é negado;
- rascunho existente não pode ser efetivado naquela competência;
- lançamento efetivado não pode ser cancelado;
- cabeçalho e partidas continuam imutáveis;
- estorno continua permitido e cria lançamento próprio com lados invertidos, referência, autor e motivo;
- o estorno integra razão e balancete da F42 sem apagar o snapshot fechado;
- a interface sinaliza que o saldo corrente pós-estorno pode divergir do snapshot e exige reabertura para novo fechamento.

O caso de uso da F40 consulta o ciclo da competência no servidor; ocultar ação na interface não substitui autorização ou bloqueio de domínio.

## 8. Reabertura e novo fechamento

- somente `admin_escritorio` autorizado para a empresa pode reabrir;
- motivo textual é obrigatório, normalizado e registrado integralmente;
- reabertura exige versão ativa `CLOSED` e compare-and-swap dessa versão;
- repetição idempotente com a mesma chave retorna o mesmo resultado;
- concorrência entre reabrir e fechar produz um único vencedor e conflito explícito para a outra operação;
- reabrir altera o ciclo corrente para `REOPENED`, preservando snapshot, hash e eventos anteriores;
- após reabertura, lançamentos novos e cancelamentos voltam a seguir as regras da F40;
- fechar novamente cria versão seguinte e novo snapshot integral;
- reabrir uma competência anterior não reabre automaticamente competências posteriores: a operação é recusada enquanto existir fechamento posterior ativo, evitando quebrar a sequência.

## 9. Autorização e isolamento

O catálogo de permissões recebe, em `Contábil -> Fechamento`:

| Ação | Efeito |
|---|---|
| `Consultar` | consultar estado, snapshot e histórico |
| `Fechar competência` | executar gates e criar fechamento |
| `Reabrir competência` | reabrir versão ativa com motivo |

Padrão inicial:

- `admin_escritorio`: consultar, fechar e reabrir dentro do tenant;
- `contador`: consultar e fechar somente empresa da carteira ativa;
- `auxiliar`: consultar somente empresa da carteira ativa;
- `auditor_readonly`: consultar em modo somente leitura dentro da alçada;
- demais papéis: negados por padrão.

Toda consulta e comando revalida usuário, tenant, empresa, carteira e permissão. Falha não revela existência, totais ou estado de empresa fora da alçada.

## 10. Contratos mínimos

```ts
type AccountingPeriodStatus = "OPEN" | "CLOSED" | "REOPENED";
type AccountingCloseKind = "REGULAR" | "EMPTY_CONFIRMED";

type AccountingPeriodClose = {
  closeId: string;
  tenantId: string;
  companyId: string;
  competence: string;
  version: number;
  ledgerProjectionVersion: number;
  kind: AccountingCloseKind;
  debitCents: number;
  creditCents: number;
  movementCount: number;
  entryCount: number;
  contentHash: string;
  closedBy: string;
  closedAt: string;
};

type AccountingPeriodCycle = {
  companyId: string;
  competence: string;
  status: AccountingPeriodStatus;
  activeCloseId: string | null;
  latestVersion: number;
};
```

Comandos de fechamento e reabertura recebem `Idempotency-Key`, empresa, competência e versão esperada. Reabertura recebe também motivo. Consultas retornam o ciclo, a versão ativa, versões anteriores e impedimentos calculados.

Erros HTTP seguem `application/problem+json` e distinguem, no mínimo:

- `ACCOUNTING_PERIOD_INVALID`;
- `ACCOUNTING_PERIOD_SEQUENCE_GAP`;
- `ACCOUNTING_PERIOD_ALREADY_CLOSED`;
- `ACCOUNTING_PERIOD_DRAFTS_EXIST`;
- `ACCOUNTING_LEDGER_INCONSISTENT`;
- `ACCOUNTING_PERIOD_UNBALANCED`;
- `ACCOUNTING_EMPTY_CONFIRMATION_REQUIRED`;
- `ACCOUNTING_PERIOD_LATER_CLOSE_EXISTS`;
- `ACCOUNTING_REOPEN_REASON_REQUIRED`;
- `ACCOUNTING_PERIOD_CONFLICT`;
- `ACCOUNTING_PERIOD_FORBIDDEN`.

## 11. Persistência, concorrência e auditoria

- ciclo, fechamentos, linhas do snapshot e eventos possuem tenant e empresa obrigatórios, indexados e sob RLS;
- unicidade parcial protege uma única versão ativa por empresa e competência;
- versão cresce monotonicamente por empresa e competência;
- snapshot e ativação confirmam na mesma transação controlada pelo caso de uso;
- chave de idempotência é única por empresa, competência, operação e versão esperada;
- compare-and-swap impede fechamento ou reabertura sobre estado vencido;
- snapshot, hash e eventos não aceitam `UPDATE` nem `DELETE`;
- tentativa negada relevante, fechamento, reabertura e conflito geram evento append-only;
- evento registra ator, instante, correlação, empresa, competência, versão, resultado, impedimentos e motivo quando aplicável;
- funções de validação e hash não acessam banco, rede ou relógio; fontes e instante entram por parâmetro.

## 12. Invariantes globais tocados

| Invariante | Aplicação na F43 |
|---|---|
| I-1 | tabelas transacionais carregam tenant e empresa, com índices e RLS |
| I-2 | consulta sem tenant não retorna ciclo, snapshot ou evento |
| I-3 | totais e saldos usam centavos inteiros, sem float |
| I-4 | gates, totais e hash são determinísticos; LLM não decide nem calcula |
| I-6 | snapshots e trilha de fechamento/reabertura são append-only |
| I-7 | fechamento e registro contábil nunca são apagados |
| I-11 | competência é data civil e instantes respeitam a convenção de fuso |
| I-12 | snapshot fechado é reproduzível pelas fontes e versões registradas |

## 13. Contrato de interface

### 13.1 Acessos e composição

A experiência integra as rotas da F42:

1. `Empresa -> Razão contábil -> Fechamentos`, contextualizada na empresa;
2. `Contábil -> Fechamentos`, com seletor de empresa permitido pela carteira.

As rotas compartilham dados e autorização. A interface contém:

- linha mensal com competência, estado textual, totais, versão e autor;
- indicação de lacuna anterior e impedimentos do gate;
- detalhe do snapshot, hash, versão da projeção e histórico;
- ação `Fechar competência` somente para usuário autorizado;
- ação `Reabrir competência` somente para administrador;
- diálogo de fechamento nomeando empresa e competência;
- confirmação adicional e inequívoca para competência sem movimentos;
- diálogo de reabertura com motivo obrigatório e efeito explicado;
- estados de carregamento, vazio, erro, aberto, bloqueado, fechado, reaberto, conflito e permissão insuficiente.

### 13.2 Referências e qualidade

Não existe protótipo dedicado. A composição usa `docs/telas/contaia_central_de_escritura_o_sped_ecd_malha_fiscal_preventiva_rf_03/` somente como referência de conteúdo e fluxo; `FRONTEND.md`, `DESIGN-SYSTEM.md`, `docs/design-system/`, `DESIGN-CLARO.md` e `DESIGN-ESCURO.md` vencem seus defeitos conhecidos.

- temas CLARO e ESCURO completos;
- viewports obrigatórios de 768, 1024 e 1440 px;
- empresa e competência ficam na URL quando aplicável;
- tabela, histórico e diálogos operam por teclado;
- foco visível e devolvido ao acionador;
- estados não dependem somente de cor;
- Toast Sonner informa sucesso e falha; impedimentos persistem na tela;
- `frontend-design` orienta a implementação e `impeccable` fecha o acabamento.

## 14. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | ciclo, sequência, mês vazio, gates, bloqueio e versões sucessivas |
| Snapshot | totais, balancete, canonicalização, hash e reprodução exata |
| Integração | fechamento com F42, bloqueios na F40 e estorno permitido |
| Concorrência | dois fechamentos, fechar × reabrir e idempotência |
| Banco | RLS, chaves cruzadas, versão ativa única e append-only |
| Permissões | contador fecha; admin fecha/reabre; auxiliar/auditor consultam |
| Tela | duas rotas, URL, estados, CLARO/ESCURO, 768/1024/1440, teclado e foco |
| E2E | fechar, negar novo lançamento, estornar, reabrir e fechar nova versão |
| Contrafactual | lacuna, rascunho, projeção divergente, desequilíbrio, conflito e outro tenant |

As funções de gate, canonicalização e hash devem atingir 95% de linhas e 100% dos invariantes documentados, conforme ADR-008.

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

## 15. Critérios de aceite verificáveis

- [ ] Fechamento só ocorre por ação explícita de contador ou administrador autorizado.
- [ ] Competência com projeção inconsistente, rascunho, desequilíbrio ou lacuna anterior não fecha.
- [ ] Competência vazia só fecha após confirmação específica e registra `EMPTY_CONFIRMED`.
- [ ] Snapshot preserva versão da projeção, totais, balancete, autor, instante e hash.
- [ ] Recalcular as mesmas fontes produz conteúdo e hash idênticos.
- [ ] Fechamento repetido ou concorrente não cria duas versões ativas.
- [ ] Competência fechada recusa novo lançamento, efetivação de rascunho e cancelamento.
- [ ] Estorno em competência fechada permanece permitido, rastreável e sem apagar o snapshot.
- [ ] Somente administrador reabre, com motivo obrigatório e sem fechamento posterior ativo.
- [ ] Reabertura preserva a versão anterior; novo fechamento cria versão seguinte.
- [ ] RLS e carteira impedem consulta e comando entre tenants ou empresas não autorizadas.
- [ ] As duas rotas usam a mesma fonte e autorização.
- [ ] Tela final passa por CLARO/ESCURO, 768/1024/1440, teclado, foco, acessibilidade e acabamento.
- [ ] Jornada E2E roda integralmente no Docker local com `correlationId` observável.

## 16. Limites e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Carga ou importação de saldos de abertura | fatia contábil própria do MVP-2 |
| DRE gerencial | fatia de relatórios alimentada pelo razão estabilizado |
| Malha SPED × DF-e × extrato como gate adicional | fatia própria de malha preventiva do MVP-2 |
| Fechamento em lote | fatia posterior, condicionada à operação multiempresa |
| Livros fiscais, SPED Fiscal, ECD e plano referencial | fatias próprias de escrituração do MVP-2 |
| Exportação PDF/CSV e pacote oficial | fatia de relatórios ou escrituração que definir o artefato |
| Produção | gate posterior ao MVP-4 |

Nenhum número posterior a F43/SPEC-043 é reservado por estes destinos. A F43 não declara saldo anterior desconhecido como zero comprovado e não transforma snapshot interno em livro ou escrituração oficial.

## 17. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Capacidade | fechamento e reabertura de competência contábil |
| Gate nesta fatia | integridade contábil, ausência de rascunhos e sequência; malha completa fica posterior |
| Sequência | competências anteriores precisam estar fechadas desde o marco inicial conhecido |
| Mês vazio | pode fechar somente com confirmação humana explícita |
| Reabertura | exclusiva de administrador, com motivo e preservação de todas as versões |
| Produção | permanece fora, no gate posterior ao MVP-4 |

**Questões abertas:** nenhuma.

## 18. Gate dos oito itens obrigatórios

| Item | Evidência nesta SPEC |
|---|---|
| Fatia, MVP e Slice | cabeçalho e §§1–2 |
| Comportamento observável | §§3–8 |
| Aceite verificável | §§14–15 |
| Invariantes tocados | §12, com I-1, I-2, I-3, I-4, I-6, I-7, I-11 e I-12 |
| Fora de escopo | §§2 e 16 |
| Dúvidas resolvidas | §17; nenhuma aberta |
| Destino do complemento | §16 |
| Contrato de UI | §13, com rotas, estados, temas, viewports e provas |

## 19. Aprovação

Fronteira, gates, sequência, competência vazia, snapshot, bloqueios, estorno, reabertura, autorização, interface, provas e destinos aprovados pelo PI em 24/09/2026. A implementação deve seguir esta SPEC sem inferir saldo de abertura, malha, escrituração ou regra contábil adicional; lacuna material volta ao PI.
