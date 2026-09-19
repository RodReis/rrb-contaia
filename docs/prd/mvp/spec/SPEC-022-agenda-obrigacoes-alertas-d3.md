# SPEC-022 / F22 — Agenda de obrigações e alertas D-3

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§6.3, 6.5, 9.1, 10.5, 15, 16 e Anexo B.1
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande e delimitada — entrega agenda mínima, uma regra inicial e alertas locais; motor completo e canais reais permanecem nos destinos já aprovados
>
> **Ambiente:** Docker local, com relógio, calendário e canais externos dublados; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #24

## 1. Objetivo

Entregar uma agenda operacional mínima de obrigações por empresa, com regras versionadas, vencimento ajustado por dia útil, baixa manual auditada e alerta evolutivo a partir de D-3.

Sucesso significa permitir que o escritório veja quais obrigações são exigíveis, quando vencem, por que se aplicam e quem deve agir, sem inventar cobertura, duplicar alertas ou antecipar apuração, guia, transmissão e mensageria produtiva.

## 2. Fronteira da fatia

Esta fatia entrega:

- catálogo versionado de regras genéricas de obrigação;
- regra inicial `DAS_SIMPLES` para empresas do Simples Nacional;
- calendário versionado de feriados nacionais, estaduais e municipais;
- geração idempotente de ocorrências por empresa e competência;
- avaliação determinística de aplicabilidade e dependências;
- agenda em lista e calendário, com filtros e detalhe;
- baixa manual auditada e reabertura por novo evento;
- um alerta evolutivo por ocorrência a partir de D-3;
- notificação in-app e outbox local dublada para e-mail e WhatsApp;
- trilha, métricas e estados explícitos de cobertura incompleta.

A F22 não entrega apuração, geração de guia, transmissão de obrigação, cálculo completo de penalidade, catálogo nacional exaustivo, rascunho de entrega, dashboard multiempresa consolidado ou canal externo real.

## 3. Comportamento esperado

### 3.1 Catálogo versionado

O `super-admin` local pode criar uma regra em rascunho, validar, publicar e arquivar. Regra publicada é imutável; correção cria nova versão com nova vigência. O histórico preserva autor, instante e conteúdo publicado.

Cada versão contém, no mínimo:

- código estável e nome;
- regimes, UFs e CNAEs aplicáveis;
- periodicidade e competência;
- dia nominal de vencimento;
- política de ajuste para dia útil;
- pré-requisitos e dependências;
- prioridade base;
- `vigente_de` e `vigente_ate`;
- estrutura declarativa de penalidade, quando conhecida.

A regra seed `DAS_SIMPLES` usa periodicidade mensal, dia nominal 20, ajuste para o dia útil antecessor e aplicabilidade ao regime `SIMPLES_NACIONAL`. Ela prova o fluxo, mas não afirma cobertura de todas as obrigações do regime.

### 3.2 Calendário de dias úteis

Feriado é dado versionado com data civil, abrangência `NACIONAL`, `ESTADUAL` ou `MUNICIPAL`, UF e município quando aplicáveis, nome, vigência e fonte interna identificável.

O vencimento é calculado sem converter data civil para instante. Sábado, domingo ou feriado aplicável recua sucessivamente até o primeiro dia útil anterior.

Se a regra exigir cobertura estadual ou municipal inexistente, a ocorrência fica em `COBERTURA_INCOMPLETA`. A interface mostra a lacuna e não presume prazo correto, não cria comunicação externa e não permite que essa empresa seja considerada saudável.

### 3.3 Aplicabilidade e geração

Para cada competência, o motor seleciona a versão vigente pela data de referência e avalia empresa, regime, UF, CNAE e pré-requisitos conhecidos. Regra incompatível não gera pendência e registra diagnóstico consultável.

A identidade lógica combina `tenant_id`, `empresa_id`, código da obrigação, competência e versão da regra. Reprocessamento, concorrência ou retomada reutiliza a mesma ocorrência.

Dependências são avaliadas por empresa e competência. O detalhe apresenta a sequência de entrega; dependência pendente impede que a ocorrência dependente seja anunciada como pronta, mas não a oculta.

### 3.4 Estados da ocorrência

Estados observáveis:

- `PENDENTE`: exigível e ainda sem baixa;
- `BLOQUEADA_POR_DEPENDENCIA`: exigível, mas com predecessora pendente;
- `ENTREGUE`: baixa manual registrada;
- `VENCIDA`: vencimento ultrapassado sem baixa;
- `NAO_EXIGIVEL`: pré-requisito conhecido não atendido;
- `COBERTURA_INCOMPLETA`: falta dado necessário para calcular com segurança.

Transições são eventos auditáveis. Arquivar regra ou alterar dados da empresa não apaga ocorrências históricas.

### 3.5 Baixa e reabertura

`admin_escritorio`, `contador` e `auxiliar` com carteira vigente podem registrar baixa manual. `auditor_readonly` apenas consulta.

A baixa exige data civil da entrega e referência textual do protocolo, recibo ou evidência usada pelo escritório. O sistema registra autor e horário; não declara validação por órgão externo.

Reabertura exige motivo e cria novo evento. A baixa anterior permanece na trilha. Não existe exclusão física nem edição silenciosa do histórico.

### 3.6 Alerta evolutivo e destinatários

Uma ocorrência pendente cria no máximo um alerta lógico. Ele nasce em D-3 com prioridade `ALTA`, atualiza diariamente os dias restantes e torna-se `CRITICA` em D0 ou após o vencimento. Antes de D-3, a ocorrência aparece na agenda sem notificação ativa.

Os destinatários são:

- usuários com papel operacional e carteira vigente para a empresa;
- todos os `admin_escritorio` ativos do tenant.

Usuário sem carteira, suspenso, arquivado ou de outro tenant não recebe nem consulta o alerta. Mudança de carteira recalcula destinatários futuros sem reescrever o histórico.

Baixa encerra o alerta. Reabertura reutiliza sua identidade lógica, atualiza o estado e não cria duplicata.

### 3.7 Notificação in-app e outbox dublada

O alerta integra o sino e o histórico de notificações da F6. Na mesma transação lógica, cria mensagens de outbox para adaptadores locais de e-mail e WhatsApp.

Cada item de outbox preserva canal, destinatário, payload versionado, identidade idempotente, tentativa, estado, erro sanitizado e `correlationId`. Os dublês locais comprovam geração e entrega técnica, sem conta oficial, provedor ou comunicação com pessoa real.

Falha de um canal não transforma os demais em falha nem duplica o alerta. Retry reutiliza a mesma identidade. Esgotamento fica visível para intervenção.

## 4. Invariantes globais tocados

| Invariante | Aplicação na F22 |
|---|---|
| `I-1` | regra, calendário, ocorrência, baixa, alerta e outbox carregam tenant/empresa quando aplicável, com RLS e carteira |
| `I-4` | exigibilidade, vencimento, prioridade e dependências são determinísticos; LLM não calcula nem muda prazo |
| `I-6` | versões publicadas, ocorrências, baixas, reaberturas e entregas de canal preservam trilha auditável |
| `I-7` | ocorrência e histórico não são apagados; correção ocorre por versão ou novo evento |
| `I-8` | a versão da regra é escolhida pela vigência da competência, não pela data de execução |
| `I-9` | geração de ocorrência e entrega por canal são idempotentes |
| `I-11` | competência e vencimento são datas civis; instante de auditoria usa `America/Sao_Paulo` na exibição |

## 5. Contrato de interface

### 5.1 Referência e composição

A agenda usa como referência concreta a área de obrigações e riscos de `docs/telas/contaia_dashboard_multi_empresa_rf_06/` e `docs/telas/contaia_dashboard_multi_empresa_vis_o_de_riscos_tema_dark_carbon/`, sem implementar nesta fatia o dashboard consolidado completo.

A rota própria apresenta:

- cabeçalho com competência e cobertura;
- alternância entre lista e calendário;
- filtros por empresa, obrigação, competência, estado e prioridade;
- detalhe com regra, vencimento nominal/ajustado, aplicabilidade, dependências e trilha;
- ação de baixa ou reabertura conforme alçada;
- acesso ao estado da notificação e dos canais dublados.

Filtros, ordenação, paginação e ocorrência selecionada permanecem representáveis na URL.

### 5.2 Estados e linguagem

A UI cobre `loading`, vazio, erro, dados parciais, cobertura incompleta, sem obrigações aplicáveis, pendente, bloqueada, D-3, vence hoje, vencida, entregue, canal em retry e canal esgotado.

Data nominal e ajustada aparecem separadas quando diferentes. Cor nunca é a única informação. A interface não usa “entregue ao governo” para baixa manual; usa “baixa registrada pelo escritório”.

Toast Sonner confirma ações, mas a mudança permanece visível no estado da página. Não existe `alert` nativo nem sucesso otimista antes da confirmação do servidor.

Temas CLARO e ESCURO e viewports de 768, 1024 e 1440 px são obrigatórios. A implementação usa `frontend-design` antes/durante e `impeccable` no acabamento, conforme `docs/FRONTEND.md` §20.1.

### 5.3 Acessibilidade

Lista, calendário, filtros, detalhe e diálogos funcionam por teclado, preservam foco e possuem nomes acessíveis. Prioridade e estado têm texto e ícone. Erros ficam associados ao campo e são anunciados.

## 6. Arquitetura e contratos públicos

### 6.1 Unidades

- **Catálogo de obrigações:** mantém rascunhos e versões publicadas.
- **Calendário útil:** resolve dias não úteis por abrangência e versão.
- **Gerador de ocorrências:** materializa competências aplicáveis de forma idempotente.
- **Agenda:** consulta ocorrências sob RLS e carteira.
- **Baixa:** registra entrega declarada e reabertura sem apagar eventos.
- **Alertador D-3:** atualiza prioridade e destinatários a partir do relógio recebido por parâmetro.
- **Outbox de canais:** entrega payloads a adaptadores locais idempotentes.

### 6.2 Entradas e saídas

Funções de cálculo recebem explicitamente regra, empresa, competência, calendário e data de referência; não acessam banco, rede ou relógio.

Comandos de publicação, baixa, reabertura e reprocessamento incluem versão esperada e `correlationId`. Conflito de versão devolve `application/problem+json` com `type`, `title`, `status`, `code` e `correlationId`.

Consultas são paginadas e ordenadas no servidor. O retorno separa vencimento nominal, vencimento ajustado, dias restantes, cobertura, estado, dependências e origem da regra.

### 6.3 Observabilidade

Métricas mínimas cobrem ocorrências geradas, não exigíveis, cobertura incompleta, D-3, vencidas, baixas, reaberturas, alertas ativos, destinatários, entregas por canal, retries e esgotamentos.

Logs estruturados carregam identificadores opacos e `correlationId`; não carregam conteúdo integral de evidência, dados pessoais desnecessários ou segredo de integração.

## 7. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | vigência, aplicabilidade, competência, dia útil, dependência, prioridade e estados |
| Banco | imutabilidade publicada, histórico, idempotência, concorrência, RLS e carteira |
| Integração | geração agendada, notificação F6, outbox, canais dublados, retry e esgotamento |
| Tela | lista/calendário, filtros na URL, detalhe, baixa, cobertura e estados nos dois temas e três viewports |
| E2E | DAS mensal até baixa, vencimento com feriado e alerta D-3 com falha parcial de canal |
| Segurança | outro tenant e usuário fora da carteira negados; destinatários recalculados corretamente |
| Acessibilidade | teclado, foco, nomes, anúncios e informação independente de cor |
| Performance | consulta paginada e geração em lote dentro dos RNFs aplicáveis |
| Contrafactual | regra futura não muda passado; lacuna não vira prazo; retry não duplica; baixa não afirma transmissão |

O relógio é controlável nos testes. Datas civis cobrem sábado, domingo, feriado nacional, estadual e municipal e mudança de ano.

## 8. Critérios de aceite verificáveis

- [ ] Regra `DAS_SIMPLES` publicada gera ocorrência mensal somente para empresa aplicável.
- [ ] Regra publicada é imutável e nova vigência não altera ocorrência histórica.
- [ ] Fim de semana e feriado aplicável ajustam o vencimento ao dia útil antecessor.
- [ ] Falta de calendário necessário produz `COBERTURA_INCOMPLETA`, sem prazo presumido.
- [ ] Reprocessamento e concorrência não duplicam ocorrência, alerta ou outbox.
- [ ] Dependência pendente aparece em ordem e bloqueia prontidão sem ocultar a ocorrência.
- [ ] Em D-3 nasce um alerta `ALTA`; em D0 ou vencido o mesmo alerta vira `CRITICA`.
- [ ] Somente carteira vigente e admins ativos recebem e consultam o alerta.
- [ ] Baixa manual registra data, referência, autor e instante sem afirmar aceite externo.
- [ ] Reabertura exige motivo e preserva a baixa anterior.
- [ ] Notificação in-app e canais dublados têm resultado independente por destinatário e canal.
- [ ] UI final existe nos dois temas e três viewports, com estados e acessibilidade comprovados.
- [ ] Testes de regras, banco, integração, tela e E2E publicam evidência vinculada à SPEC-022 e à issue.

## 9. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Catálogo completo por regime, UF e CNAE | MVP-2 · motor completo de obrigações |
| Penalidades completas, juros e estimativa financeira | MVP-2 · Compliance completo e motor de obrigações |
| Apuração, guia, escrituração e transmissão | MVP-2 · fatias próprias de RF-03 |
| Rascunhos de entrega pelo Agente Compliance | MVP-2 · Compliance completo |
| Dashboard multiempresa, KPIs e semáforo consolidado | MVP-1 · capacidade própria posterior |
| Canal oficial, comunicação real e histórico com cliente | MVP-3 · canal ativo; provedor produtivo no gate pós-MVP-4 |
| Cobertura nacional exaustiva e atualização regulatória produtiva | MVP-2 e gate de produção aplicável |

## 10. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Capacidade | F22 recebe Agenda mínima de obrigações e alertas D-3 |
| Catálogo inicial | DAS + mecanismo genérico de regras versionadas |
| Dia útil | fins de semana e feriados nacionais, estaduais e municipais versionados |
| Baixa | manual, auditada e reabrível por novo evento |
| Destinatários | usuários da carteira e admins ativos do tenant |
| Recorrência | um alerta evolutivo por ocorrência, sem duplicata diária |
| Canais | in-app + outbox local dublada para e-mail e WhatsApp |
| Ambiente | Docker local; nenhum envio ou provedor produtivo |

**Questões abertas:** nenhuma.

## 11. Gate dos oito itens obrigatórios

| Item | Evidência nesta SPEC |
|---|---|
| Fatia, MVP e Slice | cabeçalho e §§1–2 |
| Comportamento observável | §§3 e 5 |
| Aceite verificável | §§7–8 |
| Invariantes tocados | §4 |
| Fora de escopo | §9 |
| Dúvidas resolvidas | §10; nenhuma aberta |
| Destino do complemento | §9 |
| Contrato de UI | §5, com referências, estados, temas, viewports e provas |

## 12. Aprovação

Fronteira, catálogo inicial, calendário, estados, baixa, destinatários, alerta evolutivo, canais dublados, interface, provas e destinos aprovados pelo PI em 18/09/2026.
