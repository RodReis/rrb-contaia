# SPEC-017 / F17 — Captura DF-e por NSU

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§3, 4.5, 5.1, 5.4, 14, 15 e 16
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande e atômica — entrega captura operável, consulta sob demanda, controle temporal, idempotência e recuperação; parse fiscal, manifestação e inbox permanecem em fatias próprias
>
> **Ambiente:** Docker local com dublê DF-e mTLS; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #19

## 1. Objetivo

Entregar a captura observável de NF-e modelo 55 e CT-e distribuídos contra cada CNPJ, controlada por estado de NSU, sem consulta antecipada, duplicação ou avanço inconsistente.

Sucesso significa capturar lotes pelo mesmo fluxo automático e sob demanda, respeitar o `tempoMedio`, recuperar falhas com retry e DLQ e deixar cada item em staging opaco para a próxima fatia, sem interpretar ou persistir definitivamente o XML fiscal.

## 2. Fronteira da fatia

Esta fatia entrega:

- estado persistido por tenant, empresa e CNPJ com `ultNSU`, `maxNSU`, `tempoMedio` e próximo instante permitido;
- agendamento derivado desse estado, nunca de cron fixo por CNPJ;
- consulta automática e consulta sob demanda autorizada pelo mesmo fluxo de fila;
- lote de até 50 NSUs por chamada;
- porta interna versionada para Distribuição DF-e e conector para dublê local mTLS;
- idempotência por CNPJ, NSU e chave de acesso quando disponibilizada;
- staging imutável e opaco do conteúdo bruto capturado;
- retry exponencial, DLQ e alerta deduplicado após três falhas consecutivas;
- bloqueio por Rejeição 656 e auditoria/métricas operacionais da captura.

A F17 não entrega parse fiscal, hash de integridade do XML, armazenamento fiscal definitivo, retenção de cinco anos, IBS/CBS, Ciência da Emissão, inbox, sugestão ou transmissão de manifestação.

## 3. Comportamento esperado

### 3.1 Estado por CNPJ

Cada CNPJ ativo possui um único estado de captura dentro de seu tenant e empresa:

- `ultNSU`: último NSU duravelmente aceito;
- `maxNSU`: maior NSU informado pelo provedor;
- `tempoMedio`: intervalo mínimo devolvido na última resposta válida;
- `nextAllowedAt`: primeiro instante em que uma nova chamada pode sair;
- estado operacional: `PRONTO`, `AGUARDANDO`, `CAPTURANDO`, `BLOQUEADO_656`, `FALHA` ou `DESATIVADO`;
- falhas consecutivas, último sucesso, último erro e versão otimista.

O caso de uso recebe o relógio por parâmetro. Instantes são persistidos em UTC. Atualização concorrente usa bloqueio transacional ou comparação de versão; nunca existem duas chamadas simultâneas para o mesmo CNPJ.

### 3.2 Agendamento por estado

Uma captura só é elegível quando:

- empresa e CNPJ estão ativos;
- existe certificado A1 de teste vigente e finalidade DF-e operacional;
- não existe captura em andamento;
- `nextAllowedAt` foi alcançado;
- não existe bloqueio 656 vigente.

Se `ultNSU < maxNSU`, o próximo lote é agendado para o primeiro instante permitido. Se `ultNSU = maxNSU`, a próxima verificação continua derivada do `tempoMedio` recebido. Nenhum cron rígido por CNPJ pode ignorar o estado.

### 3.3 Captura automática e sob demanda

A captura automática agenda comandos elegíveis. A consulta sob demanda pode ser iniciada por `admin_escritorio` para empresa do tenant e por `contador` ou `auxiliar` para empresa de sua carteira ativa.

O comando manual:

- entra na mesma fila da captura automática;
- não ultrapassa `nextAllowedAt`, bloqueio, rate limit ou exclusão mútua;
- reutiliza uma execução já pendente para o mesmo CNPJ;
- retorna estado aceito, aguardando, bloqueado ou já em processamento, sem chamar o conector pela API.

`auditor_readonly` apenas consulta estado e histórico.

### 3.4 Porta DF-e e Signer

O worker nunca chama provedor diretamente. Ele envia ao Signer a operação DF-e tipada, com identidade técnica, contexto, certificado e chave idempotente. O Signer usa a porta interna versionada e o adaptador configurado.

Nesta fatia existe somente o adaptador do dublê local mTLS. A porta não expõe URL livre nem nomes comerciais. Ela recebe CNPJ, `ultNSU`, limite máximo de 50 e `correlationId`; retorna código da resposta, lote ordenado, `ultNSU`, `maxNSU`, `tempoMedio` e metadados sanitizados.

NF-e modelo 55 e CT-e são aceitos. NFS-e não usa esta captura por NSU e não entra na F17.

### 3.5 Lote, staging e avanço atômico

Cada item do lote guarda:

- tenant, empresa e CNPJ;
- NSU;
- chave de acesso quando fornecida pelo envelope;
- espécie declarada pelo provedor;
- referência opaca ao conteúdo bruto em staging;
- instante de disponibilização quando fornecido e instante de captura;
- execução e `correlationId` de origem.

O conteúdo bruto é gravado sem interpretação fiscal. O commit do lote e o avanço de `ultNSU`, `maxNSU`, `tempoMedio` e `nextAllowedAt` formam uma única unidade lógica. Se o staging ou banco falhar antes do commit, o cursor não avança. Reprocessar o lote completa itens ausentes e reutiliza os existentes.

O staging não substitui o repositório fiscal: hash, validação, retenção e recuperação do XML pertencem à próxima fatia.

### 3.6 Idempotência e consistência

A identidade primária de captura é tenant + empresa + CNPJ + NSU. Quando a chave de acesso estiver disponível, ela também é única no mesmo tenant e empresa.

- mesmo NSU e mesma chave reutilizam o item;
- mesmo NSU com chave diferente, ou mesma chave com NSU incompatível, gera conflito observável e não avança o cursor além do ponto inconsistente;
- repetição de comando pendente não cria chamada paralela;
- repetição após resultado terminal reutiliza o resultado;
- `ultNSU` nunca diminui e nunca ultrapassa o último item duravelmente aceito;
- lote fora de ordem, acima de 50 itens ou com cursor incoerente é recusado integralmente.

### 3.7 `tempoMedio`, rate limit e Rejeição 656

Após resposta válida, `nextAllowedAt` é calculado a partir do término da chamada mais o `tempoMedio` informado. Nenhuma origem, inclusive consulta manual, pode antecipá-lo.

O rate limit compartilhado por tenant e órgão complementa a trava por CNPJ. O instante efetivo de execução é o maior entre as duas restrições.

Rejeição 656:

- não é tratada como lote vazio;
- bloqueia somente o CNPJ afetado por no mínimo uma hora e pelo prazo maior informado pelo provedor;
- não avança `ultNSU`;
- registra incidente e alerta operacional deduplicado;
- impede captura automática e sob demanda durante o bloqueio;
- exige uma nova execução normal após o desbloqueio, sem bypass manual.

### 3.8 Falhas, retry, DLQ e recuperação

Timeout, indisponibilidade transitória do Signer ou do dublê e falha de comunicação recebem até três tentativas totais com backoff exponencial e jitter. A mesma chave idempotente acompanha todas as tentativas.

- sucesso zera falhas consecutivas e encerra alerta aberto;
- terceira falha move a execução para DLQ, marca o CNPJ como `FALHA` e emite um alerta deduplicado;
- novas falhas do mesmo incidente não duplicam alerta;
- reprocessamento autorizado da DLQ preserva execução, contexto e tentativas anteriores;
- certificado ausente ou inválido, resposta estrutural inválida e conflito de lote são falhas definitivas sem retry cego.

### 3.9 Auditoria e métricas

Cada execução registra em trilha append-only:

- origem automática ou manual e ator originador quando aplicável;
- tenant, empresa, CNPJ e identidade técnica;
- cursor de entrada e cursores retornados;
- quantidade recebida, criada e deduplicada;
- início, fim, latência, tentativa e resultado;
- `tempoMedio`, `nextAllowedAt`, código estável e `correlationId`;
- abertura, recuperação ou bloqueio de incidente.

Logs, traces, respostas e alertas não contêm XML, certificado, segredo ou conteúdo integral do lote. Métricas mínimas cobrem duração, volume, duplicados evitados, atraso da fila, falhas, DLQ e Rejeição 656.

## 4. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | estado, staging, execução e auditoria possuem `tenant_id` e `empresa_id`, indexados e sob RLS |
| `I-2` | nenhuma consulta ou captura ocorre sem contexto de tenant, empresa e carteira válida quando humana |
| `I-6` | execuções, tentativas, incidentes e eventos de captura são append-only |
| `I-9` | comando, chamada, NSU e chave de acesso impedem repetição de efeito e duplicação |
| `I-10` | worker e API nunca recebem material A1; saída autenticada continua restrita ao Signer |
| `I-11` | instantes usam UTC e exibição `America/Sao_Paulo`; o relógio entra por parâmetro |

## 5. Contrato de interface

### 5.1 Superfície mínima

A F17 não cria inbox nem dashboard multiempresa. Ela acrescenta uma seção operacional de captura no contexto da empresa, suficiente para:

- visualizar estado, `ultNSU`, `maxNSU`, última captura e próximo instante permitido;
- identificar espera normal, captura em andamento, falha e bloqueio 656 por texto, não somente cor;
- iniciar consulta sob demanda quando autorizado;
- consultar histórico paginado de execuções sem conteúdo fiscal;
- acessar ação de resolução para certificado ou Signer indisponível entregue pelas F11/F12.

A interface não mostra XML, IBS/CBS, manifestação, score, quantidade fiscal interpretada nem promessa de sincronização oficial.

### 5.2 Estados obrigatórios

- carregando com skeleton;
- nunca consultado;
- pronto;
- aguardando `tempoMedio`;
- consulta enfileirada e em andamento;
- sem novos documentos;
- lote capturado;
- repetição deduplicada;
- certificado ou Signer indisponível;
- falha transitória com nova tentativa;
- falha após três tentativas e DLQ;
- bloqueio 656 com instante mínimo de liberação;
- conflito de lote;
- histórico vazio ou indisponível;
- acesso negado.

### 5.3 Responsividade, acessibilidade e prova

- temas CLARO e ESCURO completos;
- viewports de 768, 1024 e 1440 px;
- consulta manual e histórico operáveis por teclado, com foco visível;
- atualização assíncrona anunciada sem excesso;
- data e hora exibidas em `America/Sao_Paulo` com rótulo inequívoco;
- estado nunca depende somente de cor;
- `frontend-design`, `gstack:design-review` e `impeccable` aplicados conforme `FRONTEND.md` §20.1.

A referência visual é a linguagem operacional de `docs/telas/contaia_triagem_de_captura_df_e_inbox_de_manifesta_o_rf_02/`, usando apenas o recorte de status de captura. A grade documental, triagem e manifestações permanecem ausentes.

## 6. Arquitetura e contratos públicos

### 6.1 Fluxo

```text
agendador por estado ─┐
consulta autorizada ──┴─▶ fila captura DF-e ─▶ worker ─▶ Signer ─▶ porta DF-e
                                               ▲                    │
                                               └── dublê local mTLS ┘
                                                        │
                                         staging opaco + cursor atômico
```

### 6.2 Mensagem e porta internas

A mensagem carrega `tenantId`, `companyId`, CNPJ, origem, chave idempotente e `correlationId`. O contrato não contém certificado, segredo, URL ou conteúdo fiscal.

A resposta da porta diferencia sucesso com lote, sucesso sem novos itens, Rejeição 656, falha transitória e falha definitiva. `tempoMedio` é uma duração tipada e validada; valor ausente, negativo ou inválido torna a resposta não confiável e impede avanço.

### 6.3 Endpoints mínimos

```text
GET  /companies/:companyId/dfe-capture
POST /companies/:companyId/dfe-capture/queries
GET  /companies/:companyId/dfe-capture/runs
```

Listagem de execuções é paginada, mais recente primeiro. O POST apenas agenda ou reutiliza comando; não espera a chamada externa. Erros seguem `application/problem+json`.

### 6.4 Códigos de erro estáveis

- `DFE_CAPTURE_NOT_READY`;
- `DFE_QUERY_TOO_EARLY`;
- `DFE_CAPTURE_ALREADY_QUEUED`;
- `DFE_CONSUMO_INDEVIDO`;
- `DFE_CERTIFICATE_UNAVAILABLE`;
- `DFE_SIGNER_UNAVAILABLE`;
- `DFE_PROVIDER_UNAVAILABLE`;
- `DFE_RESPONSE_INVALID`;
- `DFE_BATCH_INVALID`;
- `DFE_CAPTURE_CONFLICT`;
- `DFE_CAPTURE_ACCESS_DENIED`.

## 7. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | elegibilidade, `nextAllowedAt`, lote máximo, monotonicidade do cursor e classificação de falhas |
| Banco | RLS, unicidade de NSU/chave, avanço atômico, versão concorrente, append-only e staging opaco |
| Fila | deduplicação, exclusão por CNPJ, retry exponencial, jitter, DLQ e reprocessamento |
| Signer/mTLS | worker autorizado alcança dublê; API e identidade inválida não alcançam; segredos não vazam |
| Tempo | `tempoMedio` zero, positivo e alterado; nenhuma chamada antes do limite |
| Lote | vazio, parcial, 50 itens, múltiplos lotes, repetido, fora de ordem, conflito e resposta inválida |
| 656 | bloqueio isolado por CNPJ, alerta único, cursor preservado e retomada após o prazo |
| Autorização | admin do tenant e carteira ativa operam; auditor consulta; contexto cruzado é negado |
| Tela | estados, consulta, histórico, temas, viewports, teclado, foco e atualização assíncrona |
| E2E | empresa com A1 de teste → agendamento → mTLS → lote → repetição idempotente → avanço até `maxNSU` |
| Contrafactual | outro tenant/CNPJ, chamada antecipada, duas execuções concorrentes, falha entre staging e cursor e segredo sentinela |

## 8. Critérios de aceite verificáveis

- [ ] Estado de NSU existe separadamente por tenant, empresa e CNPJ e é protegido por RLS.
- [ ] Nenhuma chamada sai antes de `nextAllowedAt` nem durante bloqueio 656.
- [ ] Consulta automática e sob demanda percorrem a mesma fila, Signer e controles.
- [ ] Cada chamada solicita e aceita no máximo 50 NSUs.
- [ ] NF-e modelo 55 e CT-e do dublê são aceitos como conteúdo opaco; NFS-e é recusada.
- [ ] Lote e cursor são confirmados atomicamente; falha parcial não perde documento nem avança `ultNSU`.
- [ ] Reprocessamento não duplica NSU, chave de acesso, item de staging ou chamada concorrente.
- [ ] Conflito NSU/chave é observável e não é resolvido silenciosamente.
- [ ] Rejeição 656 pausa apenas o CNPJ afetado por no mínimo uma hora, alerta e preserva o cursor.
- [ ] Falhas transitórias usam três tentativas totais; a terceira envia à DLQ e alerta uma vez.
- [ ] Recuperação zera falhas consecutivas e encerra o incidente sem apagar o histórico.
- [ ] Worker chama o dublê somente pelo Signer; API, navegador e fila não recebem segredo A1.
- [ ] Auditoria e métricas não contêm XML ou material criptográfico.
- [ ] Seção operacional prova estados, consulta e histórico nos dois temas e três viewports.
- [ ] Testes de regras, banco, tela e E2E publicam evidência vinculada à SPEC-017 e à issue.

## 9. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Parse e normalização de NF-e, CT-e, NFS-e e eventos | MVP-1 · próxima capacidade RF-02 a numerar |
| XML fiscal definitivo, hash, retenção e recuperação | mesma capacidade de parse e persistência do MVP-1 |
| Campos IBS/CBS persistidos | mesma capacidade de parse e persistência do MVP-1; motor completo no MVP-4 |
| Ciência da Emissão automática | MVP-1 · capacidade própria RF-02 a numerar |
| Inbox e aprovação das demais manifestações | MVP-1 · capacidade própria RF-02 a numerar |
| NFS-e padrão nacional | MVP-1 · capacidade própria de captura NFS-e a decompor; não usa NSU DF-e |
| Conector direto Sefaz e via alternativa por intermediário | `[MVP1][GATE]` de homologação não produtiva, sobre a porta criada nesta fatia |
| Integração comercial ou contratação de provedor | decisão específica do PI antes do GATE; não é presumida pela porta técnica |
| Dashboard multiempresa e semáforo | MVP-1 · capacidade própria RF-06 a numerar |
| Infraestrutura e material produtivos | gate de Produção posterior ao MVP-4 |

## 10. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Fronteira | captura por NSU, idempotência e `tempoMedio`, sem absorver todo o fluxo DF-e |
| Documentos | NF-e modelo 55 e CT-e |
| Conector da fatia | porta interna e dublê local mTLS |
| Prova externa | GATE do MVP-1, não F17 |
| Via alternativa | mesma porta; integração real somente no GATE após decisão aplicável |
| Operação | captura automática e consulta sob demanda |
| Falhas | retry exponencial, três tentativas totais, DLQ e alerta deduplicado |
| Persistência | staging opaco; parse, hash e repositório fiscal na próxima capacidade |
| Interface | somente estado operacional, consulta e histórico; sem inbox antecipada |
| Ambiente | Docker local, sem produção |

**Questões abertas:** nenhuma.

## 11. Gate dos oito itens obrigatórios

| Item | Evidência nesta SPEC |
|---|---|
| Fatia, MVP e Slice | cabeçalho e §§1–2 |
| Comportamento observável | §3 |
| Aceite verificável | §§7–8 |
| Invariantes tocados | §4 |
| Fora de escopo | §9 |
| Dúvidas resolvidas | §10; nenhuma aberta |
| Destino do complemento | §9 |
| Contrato de UI | §5, com referência concreta, estados, temas, viewports e provas |

## 12. Aprovação

Fronteira, conectores, operação, idempotência, falhas, staging, interface, provas e destinos aprovados pelo PI em 18/09/2026. A implementação deve manter separadas as capacidades posteriores de parse, manifestação, inbox, agenda, compliance, dashboard e auditoria dos agentes.
