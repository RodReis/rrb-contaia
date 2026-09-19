# SPEC-023 / F23 — Dashboard multiempresa com semáforo e drill-down

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§9.1, 9.4, 15 e 16
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande e delimitada — consolida sinais já entregues em uma visão acionável; auditoria transversal permanece em capacidade posterior
>
> **Ambiente:** Docker local, com projeções, fixtures e relógio controlado; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #25

## 1. Objetivo

Entregar o dashboard operacional multiempresa do MVP-1, com semáforo determinístico, indicadores de saúde e drill-down para todos os motivos que compõem o estado de cada empresa.

Sucesso significa permitir que o escritório priorize sua carteira e alcance o fluxo correto de resolução sem esconder pendências simultâneas, inventar risco financeiro ou mostrar verde com dados incompletos.

## 2. Fronteira da fatia

Esta fatia entrega:

- projeção agregada de saúde por empresa ativa;
- semáforo vermelho, amarelo e verde com motivos textuais;
- KPIs de saúde e pendências do MVP-1;
- lista paginada, pesquisável, filtrável e ordenável;
- painel de drill-down com todos os motivos e ações resolutivas;
- atualização idempotente da projeção a partir das fontes existentes;
- indicação explícita de fonte incompleta ou desatualizada;
- interface final nos temas CLARO e ESCURO;
- métricas, trilha de atualização e provas de desempenho.

A F23 não entrega guias, multas estimadas, caixa, eSocial, gráficos novos, mensageria real, histórico analítico, atividade dos agentes ou ledger transversal de auditoria.

## 3. Comportamento

### 3.1 Universo consultável

O dashboard inclui somente empresas `ATIVA` pertencentes à carteira vigente do usuário. O `admin_escritorio` continua submetido à própria carteira nos dados operacionais, conforme F9.

`admin_escritorio`, `contador`, `auxiliar` e `auditor_readonly` consultam as empresas permitidas por carteira e papéis. Ações resolutivas continuam sujeitas à autorização do fluxo de destino; o dashboard não amplia alçada.

Empresa arquivada, vínculo encerrado, usuário suspenso ou empresa de outro tenant não aparece nos totais, na lista, na busca nem no drill-down.

### 3.2 Fontes do semáforo

A projeção consome apenas fatos já produzidos pelas capacidades do MVP-1:

| Fonte | Sinais usados |
|---|---|
| F5 / SPEC-005 | pendências cadastrais ou documentais abertas |
| F11 / SPEC-011 | ausência, desativação, validade e proximidade de vencimento do certificado A1 |
| F17 / SPEC-017 | captura bloqueada por Rejeição 656 ou em falha operacional |
| F21 / SPEC-021 | manifestações conclusivas pendentes de decisão/intervenção |
| F22 / SPEC-022 | obrigações D-3, vencendo hoje, vencidas e cobertura incompleta |

Uma capacidade ainda não implementada em um ambiente de desenvolvimento é fonte indisponível, não ausência de pendência. Fixtures de homologação devem representar todas as fontes.

### 3.3 Regra determinística do semáforo

**Vermelho — crítico:**

- obrigação vencida;
- captura `BLOQUEADO_656` ou `FALHA`;
- certificado A1 ausente, desativado, expirado, ainda não vigente ou inválido.

**Amarelo — atenção:**

- obrigação em D-3 até D0;
- manifestação conclusiva pendente;
- pendência cadastral ou documental aberta;
- certificado válido com menos de 30 dias para vencer;
- cobertura de obrigação incompleta;
- qualquer fonte necessária indisponível, atrasada ou inconsistente.

**Verde — conforme:** somente quando não existir sinal vermelho ou amarelo e todas as fontes necessárias tiverem processamento conhecido e consistente.

A precedência é `VERMELHO > AMARELO > VERDE`. LLM não calcula, altera nem explica a cor. Cada motivo preserva fonte, código estável, gravidade, instante de referência e identidade do registro de origem.

### 3.4 Dados parciais e atualidade

Cada fonte publica ou permite derivar sua última revisão processada. A projeção registra por fonte a revisão esperada, a revisão aplicada, o último processamento e o resultado.

Falha, lacuna ou atraso conhecido força amarelo com o motivo **Dados incompletos ou desatualizados**. A interface identifica a fonte afetada e o último processamento conhecido. O sistema nunca mantém verde confiando silenciosamente em um retrato anterior.

Recuperada a fonte, a mesma projeção é recalculada. Reprocessamento, concorrência ou entrega repetida do mesmo evento não duplica motivos nem contadores.

### 3.5 KPIs

O topo apresenta:

- total de empresas monitoradas;
- quantidade de empresas vermelhas, amarelas e verdes;
- obrigações vencidas e em D-3;
- manifestações pendentes;
- bloqueios de captura;
- empresas com certificado bloqueante ou próximo do vencimento.

Contadores de empresas por cor formam partição do universo consultável. Contadores de pendências podem se sobrepor porque uma empresa pode possuir vários motivos. Os rótulos deixam essa diferença explícita.

Não entram valores de multa, guias, caixa, eSocial, economia estimada ou percentuais de cobertura não provados.

### 3.6 Lista e ordenação

A lista apresenta empresa, CNPJ mascarado, regime, estado textual do semáforo, motivo mais urgente, contagem total de motivos, próxima data relevante e última atualização.

A ordenação padrão é:

1. vermelho antes de amarelo antes de verde;
2. bloqueio ou vencimento mais urgente;
3. menor prazo restante;
4. maior quantidade de motivos abertos;
5. razão social e identificador como desempate estável.

Busca por razão social ou CNPJ e filtros por cor, regime, tipo de motivo e fonte são executados no servidor. Filtro, ordenação, página, tamanho da página e empresa selecionada permanecem na URL.

### 3.7 Drill-down e ação resolutiva

Selecionar uma empresa abre painel com todos os motivos que contribuíram para a cor, agrupados por gravidade e fonte. O painel mostra estado, data relevante, descrição objetiva e atualização da origem.

Cada motivo oferece link direto ao fluxo já existente:

- pendência cadastral/documental → Central da F5 filtrada pela empresa e causa;
- certificado → cofre da F11 na empresa;
- captura → painel operacional da F17;
- manifestação → inbox da F21 filtrada pela empresa e item;
- obrigação → agenda da F22 filtrada pela empresa e ocorrência.

O dashboard não resolve, confirma nem altera o fato de origem. Ao retornar do fluxo, preserva filtros, página e posição. Se o fato mudou, a consulta atualizada prevalece.

## 4. Invariantes

| Invariante | Aplicação na F23 |
|---|---|
| `I-1` | projeção e motivos carregam `tenant_id` e `empresa_id`, indexados e sob RLS |
| `I-2` | consulta sem tenant, carteira ou papel válido não retorna agregado nem contagem |
| `I-3` | projeção não substitui o fato de origem; links sempre retornam ao módulo responsável |
| `I-4` | cor, precedência, contadores e ordenação são determinísticos e não usam LLM |
| `I-6` | dados incompletos nunca resultam em verde |
| `I-9` | evento repetido, reprocessamento e concorrência não duplicam motivo ou contador |
| `I-11` | datas civis preservam a origem; atualizações usam instante e exibição `America/Sao_Paulo` |

Cor nunca é a única representação. Estado, motivo e ação são textuais e acessíveis.

## 5. Contrato de interface

### 5.1 Referências

Referências concretas:

- `docs/telas/contaia_dashboard_multi_empresa_rf_06/` para hierarquia, KPIs, tabela e fila de ação;
- `docs/telas/contaia_dashboard_multi_empresa_vis_o_de_riscos_tema_dark_carbon/` para o tema escuro e leitura de risco;
- `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md`, que vencem conteúdo fictício, módulos futuros e defeitos dos protótipos.

A implementação não replica números, empresas, multas, módulos ou promessas simuladas das imagens de referência.

### 5.2 Layout e responsividade

Em 1440 px, KPIs e tabela ocupam a visão principal e o drill-down abre lateralmente. Em 1024 px, os KPIs reorganizam sem rolagem horizontal da página e o painel mantém leitura completa. Em 768 px, a tabela vira composição responsiva definida pelo contrato do frontend e o detalhe é empilhado após a seleção.

A questão P-02 do `STATUS.md` é resolvida nesta fatia: em 768 px sobrevivem empresa, estado textual, motivo principal e ação de abrir detalhe; CNPJ, regime, contadores e datas ficam no conteúdo expandido, sem perda de informação.

### 5.3 Estados obrigatórios

A interface cobre:

- loading inicial e atualização em segundo plano;
- carteira vazia;
- nenhuma empresa após filtros;
- erro total;
- dados parciais por fonte;
- vermelho, amarelo e verde;
- múltiplos motivos na mesma empresa;
- painel sem permissão para executar a ação de destino;
- conteúdo longo, paginação e retorno preservado.

Atualização por foco e invalidação explícita seguem `docs/FRONTEND.md`. Não existe sucesso otimista nem cor calculada somente no cliente.

### 5.4 Acessibilidade e acabamento

KPIs, filtros, tabela responsiva, painel e links funcionam por teclado, preservam foco e possuem nomes acessíveis. Estado usa texto e ícone além da cor. Mudanças relevantes são anunciadas sem produzir ruído a cada atualização.

Temas CLARO e ESCURO e viewports de 768, 1024 e 1440 px são obrigatórios. A implementação usa `frontend-design` antes/durante e `impeccable` no acabamento, com comparação visual conforme `docs/FRONTEND.md` §20.1.

## 6. Arquitetura e contratos

### 6.1 Componentes

- **Adaptadores de fonte:** traduzem fatos existentes para sinais canônicos sem mudar os módulos de origem.
- **Projetor de saúde:** aplica precedência, deduplicação e agregação por empresa.
- **Consulta do dashboard:** aplica RLS, carteira, filtros, ordenação, paginação e KPIs no servidor.
- **Web:** hidrata a consulta crítica e representa os estados finais.

### 6.2 Projeção

A projeção pré-calculada mantém, no mínimo, empresa, cor, quantidade por gravidade/fonte, motivo prioritário, próxima data relevante, revisões das fontes e último processamento.

Os motivos mantêm referência opaca ao fato de origem, não uma cópia autoritativa de seu conteúdo. Alteração ou encerramento na origem recalcula a empresa afetada. Um reconciliador periódico detecta drift e reprocessa sem duplicidade.

### 6.3 API

A consulta de resumo retorna KPIs do universo filtrado e revisão global do retrato. A consulta paginada retorna empresa, cor, motivo prioritário, contadores, datas e atualização. O detalhe retorna todos os motivos e destinos autorizados.

Respostas são paginadas e ordenadas no servidor. Erros seguem `application/problem+json` com `type`, `title`, `status`, `code` e `correlationId`.

### 6.4 Observabilidade

Métricas mínimas cobrem empresas projetadas, distribuição por cor, motivos por fonte, latência de projeção, eventos deduplicados, reconciliações, drift, fontes incompletas, duração da consulta e tempo de renderização.

Logs estruturados usam identificadores opacos e `correlationId`; não registram XML, certificado, segredo ou dado pessoal desnecessário.

## 7. Testes obrigatórios

| Categoria | Cenários mínimos |
|---|---|
| Regras | precedência das cores, todos os sinais, múltiplos motivos, desempates e impossibilidade de verde parcial |
| Banco | projeção, deduplicação, concorrência, reconciliação, RLS, carteira e índices |
| API | KPIs, filtros, busca, ordenação, paginação, detalhe e negação entre escopos |
| Tela | KPIs, tabela responsiva, URL, drill-down, retorno e estados nos dois temas e três viewports |
| E2E | fato nasce na origem → empresa muda de cor → usuário abre motivo → navega ao fluxo → resolve → dashboard recalcula |
| Segurança | outro tenant, fora da carteira, empresa arquivada e papel sem ação não vazam dados nem ampliam alçada |
| Performance | 500 empresas com dados agregados carregam o dashboard completo em menos de 3 segundos |
| Contrafactual | fonte indisponível não preserva verde; um motivo não oculta outros; projeção não altera a origem |

As provas usam Docker local, fixtures determinísticas e relógio controlado. Desempenho produtivo, integrações reais e infraestrutura de produção permanecem `not_run` até os gates próprios.

## 8. Critérios de aceite

- [ ] Dashboard contém somente empresas ativas da carteira vigente e nunca mistura tenants.
- [ ] Vermelho, amarelo e verde seguem exatamente as fontes e precedência desta SPEC.
- [ ] Certificado bloqueante torna a empresa vermelha; certificado válido a menos de 30 dias torna-a amarela.
- [ ] Fonte incompleta ou desatualizada torna a empresa amarela e impede verde.
- [ ] KPIs distinguem empresas por cor de contagens sobreponíveis de pendências.
- [ ] Ordenação padrão prioriza urgência operacional com desempate estável.
- [ ] Drill-down apresenta todos os motivos e leva ao fluxo correto sem alterar a origem.
- [ ] Filtros, ordenação, paginação e seleção permanecem na URL.
- [ ] Reprocessamento e concorrência não duplicam motivos ou contadores.
- [ ] Fixture com 500 empresas carrega em menos de 3 segundos no Docker local.
- [ ] Interface final é provada nos dois temas, três viewports, estados e acessibilidade exigidos.
- [ ] Testes de regras, banco, API, tela e E2E publicam evidência vinculada à SPEC-023 e à issue #25.

## 9. Limites do Code

- Sempre: reutilizar fatos das fontes, aplicar carteira/RLS no servidor, preservar motivos simultâneos e medir 500 empresas.
- Perguntar antes: criar quarta cor, nova fonte, nova prioridade, gráfico, ação mutável no dashboard ou regra financeira.
- Nunca: inferir multa, ocultar fonte incompleta, calcular saúde apenas no cliente, ampliar alçada ou copiar números fictícios do protótipo.

## 10. Destinos preservados

| Capacidade não entregue | Destino obrigatório |
|---|---|
| Auditoria append-only e observabilidade transversal das decisões dos agentes | MVP-1 · capacidade própria posterior, ainda sem número reservado |
| Guias, penalidades completas e apuração | MVP-2 · fatias próprias de RF-03 |
| Caixa consolidado e eventos eSocial | MVP-3 |
| Mensageria oficial e comunicação ativa | MVP-3; provedor produtivo no gate pós-MVP-4 |
| Infraestrutura e desempenho produtivos | gate de produção posterior ao MVP-4 |

## 11. Decisões do PI

| Tema | Decisão |
|---|---|
| Recorte | semáforo multiempresa e drill-down; auditoria transversal não entra |
| Prioridade | urgência operacional, prazo, quantidade de pendências e desempate estável |
| KPIs | saúde, obrigações, manifestações e bloqueios já existentes no MVP-1 |
| Drill-down | painel com todos os motivos e link para cada fluxo de origem |
| Dados parciais | amarelo explícito, com fonte e último processamento |
| Certificado | ausente/desativado/expirado/futuro/inválido é vermelho; válido a menos de 30 dias é amarelo |

## 12. Gate de conformidade

| Verificação | Resultado |
|---|---|
| Fatia e origem | F23/SPEC-023 · MVP-1 · PRD §§9.1, 9.4, 15 e 16 |
| Fronteira | dashboard acionável; auditoria transversal permanece separada |
| Regras | fontes, cores, precedência, atualidade, KPIs, ordenação e drill-down definidos |
| Persistência | projeção derivada, revisões, idempotência, reconciliação, RLS e carteira |
| Falhas | dados parciais explícitos; verde impedido; origem preservada |
| Integrações | somente módulos locais já previstos; nenhuma integração externa nova |
| Provas | regras, banco, API, UI, E2E, segurança, performance e contrafactuais |
| Contrato de UI | §5, com referências, estados, temas, viewports e resolução da P-02 |

Não há pergunta aberta. A issue única é #25 e pode permanecer em `proplan:backlog` até entrar entre os cinco próximos cards.

## 13. Referências

- PRD v3.1 §§9.1 e 9.4: dashboard multiempresa, semáforo, ação direta e desempenho.
- `docs/CONVENTION.md`: certificado, alertas e invariantes do domínio.
- F5, F11, F17, F21 e F22: fontes autoritativas dos sinais consolidados.
- `docs/FRONTEND.md` e `docs/DESIGN-SYSTEM.md`: contrato final da interface.

## 14. Aprovação

Recorte, fontes, semáforo, precedência, indicadores, ordenação, drill-down, dados parciais, certificado, interface, provas e destinos aprovados pelo PI em 18/09/2026.
