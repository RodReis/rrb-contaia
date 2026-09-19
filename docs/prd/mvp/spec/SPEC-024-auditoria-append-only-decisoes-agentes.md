# SPEC-024 / F24 — Auditoria append-only e decisões dos agentes

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§2, 3, 5.4, 10.1, 10.2, 10.5, 12, 14, 15 e 16
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande e delimitada — cria o ledger transversal e integra os agentes existentes no MVP-1; o retrofit integral das ações humanas permanece nas fatias que originam cada ação
>
> **Ambiente:** Docker local, com relógio controlado, fixtures e provedores dublados; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #26

## 1. Objetivo

Entregar a trilha operacional imutável do MVP-1 e tornar observáveis as execuções e decisões do Agente de Captura, incluindo a classificação de risco, e do Compliance inicial.

Sucesso significa reconstruir, dentro do escopo autorizado, o encadeamento entre fato gerador, execução do agente, proposta, decisão humana e resultado sem permitir alteração retroativa, esconder falha, expor conteúdo sensível por padrão ou misturar tenants e empresas.

## 2. Fronteira da fatia

Esta fatia entrega:

- ledger transversal append-only para eventos de auditoria;
- registro de execução de agente com prompt, contexto, entrada, saída, ferramentas, modelo, score, custo e resultado;
- correlação com proposta, decisão humana, transmissão e resultado quando existirem;
- integração inicial com as decisões das F20, F21 e F22;
- consulta operacional somente leitura, com filtros, detalhe e compartilhamento por URL;
- payload redigido por padrão e revelação integral condicionada a permissão explícita;
- exportação JSON e CSV do recorte filtrado, acompanhada de manifesto e hash;
- métricas, tracing, alertas e anti-drift do mecanismo de auditoria;
- interface final nos temas CLARO e ESCURO.

A F24 não executa retrofit completo das ações humanas das F1–F23, não cria painel global entre tenants, impersonation, sete agentes, custos agregados de SaaS, inspeção de vetores, retenção produtiva ou certificação externa.

## 3. Comportamento

### 3.1 Evento imutável

Cada fato auditável gera um evento novo. Evento publicado não admite `UPDATE` nem `DELETE`, inclusive por aplicação, worker ou migração ordinária.

O envelope preserva, no mínimo:

- identificador único e versão do esquema;
- `tenant_id` e `empresa_id`;
- tipo, origem e instante do evento;
- ator humano ou técnico e papel efetivo;
- agente, versão, modelo e provedor quando aplicável;
- fato gerador e referências opacas aos registros de origem;
- decisão, estado, score e aprovador quando aplicável;
- ferramentas chamadas e resultado agregado;
- custo e uso medidos, sem estimativa inventada;
- `correlationId`, `causationId` e `idempotencyKey`;
- hash canônico do envelope e hash do payload associado.

Nova informação, correção, expiração de payload ou reconciliação produz outro evento ligado ao anterior. O histórico nunca é reescrito.

### 3.2 Execuções abrangidas

O Agente de Captura registra a classificação híbrida de risco da F20, a proposta de manifestação e o encadeamento com a decisão e transmissão da F21. A Ciência da Emissão automática da F19 permanece correlacionada como ação determinística externa, sem ser apresentada como decisão de LLM.

O Compliance inicial registra a priorização e redação de alertas da F22 quando houver participação de agente. Cálculo de prazo, calendário, prioridade determinística e regra de obrigação continuam identificados como resultado de regra, nunca de LLM.

Falha antes da resposta, timeout, fallback determinístico, abstenção, escalonamento, rejeição de esquema e indisponibilidade do provedor também são eventos observáveis. Ausência de sucesso não pode ser inferida como decisão concluída.

Agentes futuros aderem ao mesmo contrato em suas próprias fatias. A F24 não antecipa Classificador contábil, Conciliador, DP, Copiloto, Coletor ou colaboração multiagente.

### 3.3 Correlação e reconstrução

A consulta reconstrói a linha do tempo por correlação sem copiar o estado autoritativo dos módulos de origem. Cada entrada aponta para o fato gerador e, quando autorizado, para o fluxo responsável.

Concorrência, retry ou entrega repetida com a mesma chave idempotente não duplicam o fato lógico. Eventos distintos de tentativa permanecem visíveis quando representam execuções reais distintas.

Relógio de negócio entra por parâmetro nos testes. O ledger armazena instantes em UTC e apresenta datas em `America/Sao_Paulo`; datas civis preservam o valor de origem.

### 3.4 Integridade

O hash é calculado sobre representação canônica versionada. A leitura e a exportação verificam o hash do envelope e, quando o payload ainda existe, o hash do payload.

Hash divergente, referência ausente ou sequência causal impossível não são corrigidos silenciosamente: geram incidente, métrica e estado explícito de integridade inválida. A aplicação não afirma integridade criptográfica além do que foi verificado.

Append-only é garantido por privilégios restritos, políticas de banco, caminho de escrita dedicado e teste automático de anti-drift. Hash isolado não substitui essas garantias.

### 3.5 Retenção do payload

Ledger e payload possuem ciclos de vida separados:

- o ledger mantém permanentemente metadados, referências, hashes, decisão e resultado;
- prompt, contexto, entrada e saída integrais ficam em armazenamento separado e append-only durante a retenção;
- após 12 meses, o payload pode ser anonimizado ou descartado pelo processo de retenção;
- o processo nunca altera nem remove o evento original do ledger;
- anonimização ou descarte gera novo evento com instante, executor, política aplicada e hash anterior;
- a tela passa a indicar **Conteúdo expirado**, preservando metadados e prova de existência.

A F24 prova o comportamento com relógio controlado. Política e infraestrutura produtivas continuam no gate de produção.

### 3.6 Acesso e conteúdo sensível

`admin_escritorio` e `auditor_readonly` consultam a tela transversal somente para empresas da carteira vigente. Nenhum desses papéis atravessa tenant ou carteira.

`contador`, `auxiliar`, `dp` e demais papéis não acessam a tela transversal nesta fatia; continuam vendo apenas a evidência prevista nos fluxos próprios.

Prompt, contexto, entrada e saída aparecem redigidos por padrão. A API devolve representação redigida, não conteúdo integral ocultado apenas por CSS.

Revelar conteúdo integral exige permissão específica, justificativa e confirmação. A revelação gera evento append-only com ator, alvo, instante e finalidade. Segredos, chave privada, senha de certificado e credencial nunca são persistidos nem revelados.

### 3.7 Consulta e exportação

A listagem é paginada e ordenada no servidor. Permite filtrar por período, empresa, ator, agente, tipo de decisão, estado, integridade e `correlationId`. Filtros, ordenação, página e item selecionado permanecem na URL.

A ordenação padrão é instante decrescente, identificador como desempate estável. O detalhe apresenta linha causal, metadados, ferramentas, decisão, aprovação, resultado, hashes e estado do payload.

A exportação JSON ou CSV contém exatamente o universo autorizado e filtrado no momento da solicitação. O manifesto registra filtros normalizados, instante, solicitante, quantidade, revisão e hash do arquivo. Exportar e baixar são eventos auditáveis.

Conteúdo integral só entra na exportação quando a permissão e a finalidade de revelação forem satisfeitas; do contrário, o arquivo usa o mesmo redaction da tela.

## 4. Invariantes globais tocados

| Invariante | Aplicação na F24 |
|---|---|
| `I-1` | ledger, payload e referências carregam `tenant_id` e `empresa_id`, indexados e sob RLS |
| `I-2` | consulta, detalhe, revelação e exportação sem tenant, carteira e papel válidos não retornam dados |
| `I-4` | cálculos e decisões determinísticas são identificados como regras; LLM não recebe autoria de cálculo fiscal |
| `I-5` | proposta do agente e aprovação humana permanecem eventos distintos; Ciência da Emissão é a exceção já contratada |
| `I-6` | ledger não admite `UPDATE` ou `DELETE`; correção e descarte são novos eventos |
| `I-9` | idempotência impede duplicação do fato auditável e preserva tentativas externas reais |
| `I-10` | trilha não armazena chave privada, senha ou credencial do Signer |
| `I-11` | instantes e datas civis preservam a semântica temporal da origem |

## 5. Contrato de interface

### 5.1 Referências

Referências concretas:

- `docs/telas/contaia_plataforma_de_agentes_de_ia_trilha_de_auditoria_rf_07/` para hierarquia, tabela densa, detalhe de execução e leitura de integridade;
- `docs/telas/DESIGN-CLARO.md` e `docs/telas/DESIGN-ESCURO.md` para direção visual;
- `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md`, que vencem conteúdo fictício, promessas jurídicas e capacidades futuras do protótipo.

A implementação remove KPIs produtivos, sete agentes, custos globais, vetores, políticas legais e números simulados que não pertencem ao MVP-1.

### 5.2 Layout e responsividade

Em 1440 px, filtros, tabela e detalhe lateral formam a visão principal. Em 1024 px, o detalhe mantém leitura completa sem rolagem horizontal da página. Em 768 px, a listagem preserva instante, agente/ator, decisão, estado de integridade e ação de detalhe; metadados restantes ficam no conteúdo expandido.

A tabela usa paginação explícita. O detalhe pode apresentar linha cronológica, mas não usa infinite scroll sem âncora estável.

### 5.3 Estados obrigatórios

A interface cobre:

- loading inicial e atualização em segundo plano;
- trilha vazia e nenhum resultado após filtros;
- erro total e erro parcial de detalhe;
- execução concluída, em falha, em fallback, abstida e escalada;
- decisão pendente, aprovada e rejeitada;
- integridade válida, inválida e não verificável;
- payload redigido, revelado, indisponível e expirado;
- acesso negado e carteira vazia;
- exportação preparando, concluída e falha.

### 5.4 Acessibilidade e acabamento

Filtros, tabela, linha causal, detalhe, confirmação de revelação e exportação funcionam por teclado e preservam foco. Estado usa texto e ícone além de cor. Conteúdo técnico longo possui leitura e cópia controladas sem quebrar o layout.

Temas CLARO e ESCURO e viewports de 768, 1024 e 1440 px são obrigatórios. A implementação usa `frontend-design` antes/durante e `impeccable` no acabamento, com comparação visual conforme `docs/FRONTEND.md` §20.1.

## 6. Arquitetura e contratos

### 6.1 Componentes

- **Audit writer:** único caminho de inserção, normaliza o envelope, aplica idempotência e calcula hashes.
- **Ledger:** eventos imutáveis, ordenáveis e correlacionáveis, protegidos por RLS e privilégios.
- **Payload store:** conteúdo integral separado, com redaction, revelação autorizada e retenção de 12 meses.
- **Instrumentação de agentes:** publica início, ferramenta, resposta, validação, decisão, fallback e falha.
- **Consulta e exportação:** aplicam o mesmo universo de autorização, filtros e verificação de integridade.
- **Web:** representa estados finais sem recalcular autoria, decisão ou integridade no cliente.

### 6.2 Interfaces públicas

O contrato de escrita recebe envelope versionado e payload opcional, exige chave idempotente, contexto de tenant/empresa e correlação. Retorna o identificador imutável e hashes calculados.

A consulta paginada retorna metadados redigidos e estado de integridade. O detalhe retorna linha causal e referências autorizadas. A revelação integral é uma operação própria, nunca parâmetro casual da listagem.

A exportação é assíncrona, cria artefato com validade limitada e manifesto verificável. Erros seguem `application/problem+json` com `type`, `title`, `status`, `code` e `correlationId`.

### 6.3 Observabilidade

Métricas mínimas cobrem eventos gravados, duplicatas evitadas, latência de escrita, falhas, integridade inválida, payloads expirados, revelações, exportações, custo e latência por agente/modelo e fallback.

Tracing preserva `correlationId` entre API, fila, worker, pipeline de IA e Signer. Logs estruturados usam identificadores opacos e nunca repetem prompt, resposta, XML, certificado ou segredo.

## 7. Testes obrigatórios

| Categoria | Cenários mínimos |
|---|---|
| Regras | canonicalização, hash, correção como novo evento, autoria determinística/LLM e linha causal |
| Banco | proibição de `UPDATE`/`DELETE`, privilégios, anti-drift, idempotência, concorrência, RLS e carteira |
| Retenção | payload ativo, expiração em 12 meses, evento de descarte e ledger preservado |
| API | filtros, paginação, detalhe, redaction, revelação autorizada, exportação e erros padronizados |
| Tela | listagem, URL, detalhe, linha causal e todos os estados nos dois temas e três viewports |
| E2E | fato → agente → proposta → decisão humana → resultado → consulta → exportação verificada |
| Segurança | outro tenant, fora da carteira, papel sem acesso, segredo e payload integral não vazam |
| Integridade | adulteração simulada, hash divergente, payload ausente e referência quebrada ficam explícitos |
| Contrafactual | falha não vira sucesso; regra não vira decisão de LLM; expiração não apaga evidência |

As provas usam Docker local, fixtures determinísticas, relógio controlado e provedores dublados. Retenção, escala e segurança produtivas permanecem `not_run` até os gates próprios.

## 8. Critérios de aceite

- [ ] Ledger rejeita alteração e exclusão e o anti-drift comprova os privilégios esperados.
- [ ] Eventos carregam tenant, empresa, autoria, causa, correlação, resultado e hashes verificáveis.
- [ ] Retry e concorrência não duplicam o fato lógico nem ocultam tentativas reais distintas.
- [ ] F20, F21 e F22 publicam os eventos aplicáveis sem atribuir cálculo determinístico ao LLM.
- [ ] Falha, timeout, fallback, abstenção e rejeição de esquema aparecem explicitamente.
- [ ] `admin_escritorio` e `auditor_readonly` consultam somente empresas da carteira vigente.
- [ ] Demais papéis não acessam a tela transversal nem payload integral.
- [ ] Payload aparece redigido por padrão e toda revelação integral exige permissão, justificativa e auditoria.
- [ ] Expiração após 12 meses remove somente o payload e cria evento sem alterar o ledger.
- [ ] Exportação JSON/CSV respeita filtros e autorização e inclui manifesto e hash verificáveis.
- [ ] Filtros, ordenação, paginação e seleção permanecem na URL.
- [ ] Interface final é provada nos dois temas, três viewports, estados e acessibilidade exigidos.
- [ ] Testes publicam evidência vinculada à SPEC-024 e à issue #26.

## 9. Limites do Code

- Sempre: registrar falhas, separar ledger de payload, aplicar carteira/RLS no servidor, redigir na API e verificar integridade.
- Perguntar antes: ampliar papéis, alterar retenção, expor conteúdo integral sem confirmação, criar painel global, registrar novo tipo de dado sensível ou incorporar agente futuro.
- Nunca: atualizar ou apagar evento, esconder falha, atribuir cálculo ao LLM, registrar segredo, confiar em redaction apenas visual ou exportar além do filtro autorizado.

## 10. Destinos preservados

| Capacidade não entregue | Destino obrigatório |
|---|---|
| Adesão integral das ações humanas das F1–F23 | cada fatia de origem e correções próprias, usando o contrato transversal da F24 |
| Classificador contábil, Conciliador e Compliance completo | MVP-2 · fatias próprias |
| DP, Copiloto e Coletor Ativo | MVP-3 · fatias próprias |
| Colaboração multiagente e predição | MVP-4 · fatias próprias |
| Impersonation e auditoria global entre tenants | MVP-4, junto ao super-admin |
| Retenção, storage imutável e escala produtivos | gate de produção posterior ao MVP-4 |

## 11. Decisões do PI

| Tema | Decisão |
|---|---|
| Fronteira | agentes do MVP-1 e ledger base; sem retrofit integral das ações humanas |
| Interface | trilha operacional somente leitura, não o painel completo de IA do protótipo |
| Acesso | `admin_escritorio` e `auditor_readonly`, limitados à carteira |
| Conteúdo | redigido por padrão; revelação integral exige permissão e gera auditoria |
| Exportação | JSON/CSV do recorte filtrado, com manifesto e hash |
| Retenção | ledger permanente e payload separado, expirável após 12 meses com evento de descarte |

## 12. Gate de conformidade

| Verificação | Resultado |
|---|---|
| Fatia e origem | F24/SPEC-024 · MVP-1 · PRD §§2, 3, 5.4, 10.1, 10.2, 10.5, 12, 14, 15 e 16 |
| Fronteira | ledger transversal e agentes existentes; capacidades futuras preservadas |
| Regras | autoria, causalidade, idempotência, integridade, retenção e redaction definidos |
| Persistência | ledger imutável e payload separado sob RLS e carteira |
| Falhas | falha, fallback, expiração e integridade inválida permanecem explícitos |
| Integrações | F20, F21 e F22; nenhuma integração externa nova |
| Provas | regras, banco, retenção, API, UI, E2E, segurança, integridade e contrafactuais |
| Contrato de UI | §5, com referência concreta, estados, temas, viewports e acabamento |

Não há pergunta aberta. A issue única é #26 e permanece em `proplan:backlog` até entrar entre os cinco próximos cards.

## 13. Referências

- PRD v3.1 §§2, 3, 5.4, 10.1, 10.2, 10.5 e 12.
- `docs/ARCHITECTURE.md` §§5.2 e 12.
- `docs/CONVENTION.md` §2, invariantes globais.
- F20, F21 e F22: fontes iniciais de decisões e resultados.
- `docs/FRONTEND.md` e `docs/DESIGN-SYSTEM.md`: contrato final da interface.

## 14. Aprovação

Fronteira, atores, acesso, redaction, revelação, exportação, retenção, interface, provas e destinos aprovados pelo PI em 18/09/2026.
