# SPEC-019 / F19 — Ciência da Emissão automática

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§2, 3, 5.2, 5.3, 5.4, 10.2, 12, 14, 15, 16 e 20.2
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande e atômica — somente o fluxo completo `resNFe → Ciência → procNFe` produz XML útil para o parse da F18; separar transmissão e recuperação deixaria uma fatia sem resultado operacional
>
> **Ambiente:** Docker local com dublê Sefaz, Signer e certificados de teste; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #21

## 1. Objetivo

Registrar automaticamente a Ciência da Emissão de NF-e modelo 55 capturada como resumo, recuperar o XML completo liberado pela Sefaz e entregá-lo uma única vez ao pipeline documental da F18.

Sucesso significa transformar `resNFe` elegível em `procNFe` recuperável sem aprovação humana, duplicação de evento ou exposição da chave privada, mantendo rejeições, incertezas e retomadas observáveis por empresa.

## 2. Fronteira da fatia

Esta fatia entrega:

- identificação de `resNFe` de NF-e modelo 55 destinado ao CNPJ da empresa;
- orquestração assíncrona e idempotente da Ciência da Emissão, evento `210210`;
- geração e assinatura do evento exclusivamente pelo Signer;
- transmissão pela porta governamental já estabelecida nas F12/F17;
- reconciliação de aceite, duplicidade, resposta perdida e manifestação anterior;
- recuperação posterior do `procNFe` por chave de acesso;
- encaminhamento do XML completo ao pipeline da F18;
- retry exponencial, DLQ, retomada e impedimentos explícitos;
- extensão do painel técnico documental com o estado da Ciência.

A F19 não classifica risco, não sugere manifestação conclusiva, não cria inbox, não exige aprovação humana para a Ciência e não transmite confirmação, desconhecimento ou operação não realizada.

## 3. Comportamento esperado

### 3.1 Elegibilidade

O orquestrador recebe somente referências ao staging da F17. É elegível o item que cumulativamente:

- representa `resNFe` de NF-e modelo 55;
- contém chave de acesso válida;
- identifica a empresa como destinatária;
- ainda não possui `procNFe` completo disponível;
- não possui manifestação conclusiva conhecida;
- não possui Ciência aceita ou reconciliada anteriormente.

CT-e, NF-e completa, evento, cancelamento, documento denegado, espécie divergente e resumo sem identidade válida não disparam Ciência. Esses itens seguem seu fluxo próprio ou assumem impedimento auditável, sem inferência silenciosa.

### 3.2 Ciclo operacional

```text
RESUMO_CAPTURADO ─▶ CIENCIA_PENDENTE ─▶ CIENCIA_EM_ENVIO ─▶ CIENCIA_REGISTRADA
                                                                  │
                                                                  ▼
                                                   XML_COMPLETO_PENDENTE
                                                                  │
                                                                  ▼
                                                     XML_COMPLETO_OBTIDO
                                                                  │
                                                                  ▼
                                                            PARSEADO (F18)
```

Resultados laterais explícitos são `JA_MANIFESTADO`, `XML_COMPLETO_JA_DISPONIVEL`, `RETRY_AGENDADO`, `REJEITADO`, `IMPEDIDO` e `DLQ`. Toda transição é append-only; estado projetado pode ser reconstruído a partir dos eventos.

### 3.3 Ciência automática

A Ciência é automática e não cria tarefa HITL. O evento usa tipo `210210`, versão de layout suportada e sequência válida, vinculado à chave da NF-e e ao CNPJ destinatário.

O Signer recebe apenas o envelope técnico necessário, valida o vínculo do certificado de teste com a empresa, assina o XML e encerra o mTLS. A API, o worker e o navegador nunca recebem chave privada ou senha do certificado.

O primeiro pull de até 90 dias não bloqueia localmente NF-e com mais de dez dias. Toda NF-e elegível é enviada e a resposta oficial do ambiente é a autoridade para aceite ou rejeição. A regra operacional e os códigos aceitos/rejeitados ficam versionados no adaptador, não espalhados pelo domínio.

### 3.4 Idempotência e concorrência

A identidade do ato usa tenant, empresa, chave de acesso, tipo `210210` e sequência. Um comando repetido ou concorrente reutiliza a mesma manifestação lógica e nunca gera novo ato por conveniência de retry.

- outbox e registro do ato são confirmados na mesma unidade transacional;
- somente uma execução ativa pode transmitir a identidade;
- timeout depois do envio assume resultado incerto, nunca sucesso nem falha definitiva;
- nova tentativa preserva a mesma identidade e reconcilia a resposta anterior;
- resposta oficial de duplicidade ou evento já registrado é sucesso somente quando identidade e protocolo puderem ser conciliados;
- manifestação conclusiva anterior encerra o fluxo como `JA_MANIFESTADO`, sem enviar Ciência posterior;
- `procNFe` já disponível encerra a necessidade de Ciência e segue para a F18.

### 3.5 Respostas, falhas e retomada

O adaptador classifica respostas em aceite, duplicidade reconciliável, falha transitória, rejeição definitiva e resultado incerto. Código, motivo sanitizado, protocolo, ambiente, instante e `correlationId` são preservados.

Falhas transitórias de rede, Signer ou Sefaz usam backoff exponencial e no máximo três tentativas automáticas. Exaurido o limite, a execução vai para DLQ. Rejeição definitiva não recebe retry cego. Retomada técnica autorizada reabre a execução preservando todas as tentativas anteriores e a mesma identidade lógica.

### 3.6 Recuperação do XML completo

Depois da Ciência aceita ou reconciliada, a F19 agenda a busca do `procNFe` por chave de acesso na mesma porta DF-e. A recuperação:

- respeita limites, bloqueios e política temporal do conector da F17;
- não retrocede nem avança artificialmente `ultNSU`;
- tolera atraso entre o registro do evento e a disponibilização do XML;
- repete a consulta com backoff enquanto o resultado permanecer transitório;
- grava a nova origem no staging sem substituir o `resNFe` anterior;
- publica uma única referência ao `procNFe` para a F18.

O `resNFe` permanece como evidência de origem. Somente o `procNFe` completo é considerado entrada de NF-e para normalização fiscal definitiva, itens, tributos e IBS/CBS na F18.

### 3.7 Auditoria e métricas

Cada tentativa registra tenant, empresa, chave mascarada, identidade do ato, origem, versão do layout, ambiente, início, fim, duração, resultado, código, protocolo quando houver e `correlationId`.

Métricas mínimas cobrem fila, idade do resumo, latência até Ciência, latência até XML completo, aceites, duplicidades conciliadas, manifestações anteriores, rejeições por código, resultados incertos, retries e DLQ. XML assinado, certificado, senha e chave privada não entram em logs ou métricas.

## 4. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | manifestação, execução, outbox, origem e auditoria possuem `tenant_id` e `empresa_id`, indexados e sob RLS |
| `I-2` | consulta, retomada e detalhe exigem tenant, empresa e carteira válidos |
| `I-5` | Ciência é a única manifestação automática; nenhum evento conclusivo é transmitido nesta fatia |
| `I-6` | comandos, tentativas, respostas e transições formam trilha append-only |
| `I-7` | resumo, protocolo e XML recuperado não são apagados; correção ocorre por novo evento |
| `I-9` | transmissão e recuperação externas são idempotentes por identidade lógica |
| `I-10` | certificado e chave privada permanecem exclusivamente no cofre e no Signer |
| `I-11` | emissão permanece data civil; instantes técnicos usam UTC e exibição `America/Sao_Paulo` |

## 5. Contrato de interface

### 5.1 Superfície mínima

A lista e o detalhe técnico documental entregues pela F18 passam a mostrar:

- estado textual da Ciência e do XML completo;
- protocolo e ambiente quando disponíveis;
- última tentativa, próxima tentativa e quantidade de tentativas;
- motivo sanitizado de rejeição, impedimento ou DLQ;
- vínculo entre resumo, Ciência e XML completo;
- ação de retomada técnica para `admin_escritorio`, `contador` e `auxiliar` da carteira quando o estado permitir;
- histórico somente leitura para `auditor_readonly`.

Não existe botão para aprovar Ciência, escolher manifestação conclusiva ou editar protocolo. Score, risco e proposta pertencem à F20; inbox, justificativa humana e aprovação pertencem à capacidade posterior própria.

### 5.2 Estados obrigatórios

- resumo aguardando Ciência;
- envio em andamento;
- Ciência registrada;
- XML completo aguardando disponibilização;
- XML completo obtido e encaminhado;
- já manifestado;
- XML já disponível;
- retry agendado;
- rejeição definitiva;
- resultado incerto em reconciliação;
- DLQ e retomada solicitada;
- acesso negado.

### 5.3 Responsividade, acessibilidade e prova

- temas CLARO e ESCURO completos;
- viewports de 768, 1024 e 1440 px;
- tabela adapta colunas conforme a decisão P-02 antes da implementação, sem ocultar estado ou impedimento;
- detalhe, histórico e retomada são operáveis por teclado e possuem foco visível;
- estado nunca depende somente de cor;
- datas e horas seguem `FRONTEND.md`;
- `frontend-design`, `gstack:design-review` e `impeccable` são obrigatórias conforme `FRONTEND.md` §20.1.

A referência concreta é `docs/telas/contaia_triagem_de_captura_df_e_inbox_de_manifesta_o_rf_02/`, limitada à linguagem visual da grade e do detalhe documental. A inbox e suas ações não entram.

## 6. Arquitetura e contratos públicos

### 6.1 Componentes e fluxo

```text
staging F17 (`resNFe`) ─▶ orquestrador F19 ─▶ outbox ─▶ Signer ─▶ Sefaz
                                │                                  │
                                │                           protocolo/resposta
                                │                                  │
                                └──────── reconciliação ◀──────────┘
                                             │
                                             ▼
                                 consulta por chave de acesso
                                             │
                                             ▼
                                  staging F17 (`procNFe`)
                                             │
                                             ▼
                                      pipeline F18
```

O domínio conhece a manifestação e seus estados, mas não SOAP, biblioteca XML, fila ou certificado. A porta de manifestação e a porta de distribuição são versionadas; adaptadores Sefaz e dublê local obedecem ao mesmo contrato.

### 6.2 Contratos internos

O comando de Ciência contém identificadores, chave, tipo, sequência, versão, ambiente e `correlationId`; nunca contém segredo. O resultado discriminado contém categoria, código oficial, motivo sanitizado, protocolo opcional, instante e possibilidade de retry.

O comando de recuperação referencia a manifestação aceita e a chave. A publicação para F18 ocorre somente quando o envelope for reconhecido como `procNFe` completo e coerente com empresa e chave esperadas.

### 6.3 Endpoints mínimos

```text
GET  /companies/:companyId/fiscal-documents/:documentId/acknowledgement
GET  /companies/:companyId/fiscal-documents/:documentId/acknowledgement/attempts
POST /companies/:companyId/fiscal-documents/:documentId/acknowledgement/reprocessing
```

Os endpoints somente consultam ou retomam o fluxo automático; não permitem criar evento arbitrário. Respostas respeitam carteira e RLS. Erros usam `application/problem+json`.

### 6.4 Códigos de erro estáveis

- `FISCAL_ACK_NOT_ELIGIBLE`;
- `FISCAL_ACK_ALREADY_CONCLUSIVE`;
- `FISCAL_ACK_IDENTITY_INVALID`;
- `FISCAL_ACK_CERTIFICATE_UNAVAILABLE`;
- `FISCAL_ACK_SIGNER_UNAVAILABLE`;
- `FISCAL_ACK_RESULT_UNCERTAIN`;
- `FISCAL_ACK_REJECTED`;
- `FISCAL_ACK_RETRY_EXHAUSTED`;
- `FISCAL_ACK_REPROCESS_ALREADY_QUEUED`;
- `FISCAL_FULL_XML_PENDING`;
- `FISCAL_FULL_XML_MISMATCH`;
- `FISCAL_ACK_ACCESS_DENIED`.

## 7. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | elegibilidade de `resNFe`, exclusão de CT-e/`procNFe`, manifestação anterior e estados |
| Assinatura | evento `210210` válido, certificado correto e segredo sentinela ausente fora do Signer |
| Idempotência | comando repetido, concorrência, timeout após envio, duplicidade oficial e protocolo reconciliado |
| Banco | RLS, unicidade da identidade, outbox atômico, append-only e ausência de exclusão física |
| Fila | três tentativas, backoff, resultado incerto, DLQ, retomada e crash entre etapas |
| Conector | aceite, rejeição definitiva, indisponibilidade, NF-e antiga e códigos desconhecidos seguros |
| Recuperação | atraso de disponibilização, consulta repetida, chave divergente e publicação única para F18 |
| Autorização | carteira válida retoma; auditor consulta; outro tenant/empresa é negado |
| Tela | todos os estados, detalhe, histórico, retomada, temas, viewports, teclado e foco |
| E2E | `resNFe → 210210 → protocolo → procNFe → F18`, integralmente em Docker local |
| Contrafactual | CT-e não manifesta, evento conclusivo não dispara, resposta perdida não duplica e XML divergente não segue |

## 8. Critérios de aceite verificáveis

- [ ] Todo `resNFe` elegível gera no máximo uma Ciência lógica automática, sem tarefa HITL.
- [ ] CT-e, `procNFe`, cancelamento e manifestação conclusiva anterior não geram evento `210210`.
- [ ] Evento é assinado pelo Signer com certificado vinculado à empresa; segredo sentinela não aparece fora dele.
- [ ] Comandos repetidos ou concorrentes reutilizam identidade, tentativa e protocolo sem duplicar ato externo.
- [ ] Timeout depois do envio permanece incerto até reconciliação; não é convertido em sucesso presumido.
- [ ] Duplicidade oficial só é aceita quando evento, empresa, chave e protocolo são conciliáveis.
- [ ] NF-e antiga é enviada sem bloqueio local; aceite ou rejeição segue a resposta do ambiente.
- [ ] Falhas transitórias fazem até três tentativas exponenciais; rejeição definitiva não recebe retry cego.
- [ ] Exaustão envia para DLQ e retomada preserva histórico e identidade lógica.
- [ ] Ciência aceita agenda recuperação do XML completo sem alterar artificialmente o cursor NSU.
- [ ] Atraso na disponibilização do XML mantém estado pendente e consulta reprocessável.
- [ ] `procNFe` divergente de empresa ou chave é bloqueado e auditado.
- [ ] XML completo válido é publicado uma única vez para a F18; o `resNFe` original permanece recuperável.
- [ ] Painel técnico mostra estado, protocolo, tentativas, impedimento e histórico nos dois temas e três viewports.
- [ ] RLS e carteira negam consulta e retomada entre tenants ou empresas.
- [ ] Testes de regras, banco, tela e E2E publicam evidência vinculada à SPEC-019 e à issue #21.

## 9. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Score, análise de risco e sugestão conclusiva | MVP-1 · F20 / SPEC-020, sem aprovação ou transmissão |
| Inbox, aprovação, confirmação, desconhecimento e operação não realizada | MVP-1 · capacidade própria posterior, sempre após aprovação humana registrada |
| Agenda do prazo de manifestação conclusiva | MVP-1 · capacidade de agenda mínima e alertas D-3 a numerar |
| Ciência ou eventos equivalentes de CT-e | não pertencem ao contrato de Ciência da Emissão da NF-e; qualquer evento CT-e exige capacidade própria aprovada pelo PI |
| Captura e parse de NFS-e | MVP-1 · capacidade própria de NFS-e a decompor |
| Conector externo real e evidência oficial | `[MVP1][GATE]` de homologação não produtiva |
| Certificado, storage e infraestrutura produtivos | gate de Produção posterior ao MVP-4 |

## 10. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Sequência | `resNFe → Ciência → procNFe → F18`; resumo não é documento fiscal parseado definitivamente |
| Arquitetura | orquestrador assíncrono próprio entre captura e parse |
| Escopo fiscal | somente NF-e modelo 55; CT-e não recebe Ciência da Emissão |
| NF-e antiga | transmitir quando elegível e acatar a resposta da Sefaz, sem corte local de dez dias |
| Aprovação | Ciência automática, sem HITL, sob qualquer score |
| Interface | estender painel técnico da F18; não criar tela própria nem antecipar inbox |
| Retry | três tentativas exponenciais, reconciliação e DLQ |
| Ambiente | Docker local; homologação externa no GATE do MVP-1 |

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
| Contrato de UI | §5, com referência concreta, estados, temas, viewports e provas |

## 12. Referências normativas

- Portal Nacional da NF-e, Nota Técnica 2020.001 v1.60: Ciência `210210`, natureza não conclusiva e prazos vigentes.
- Manual de Orientação do Contribuinte, serviço `NFeDistribuicaoDFe`: `resNFe`, `procNFe` e liberação após manifestação.
- Schemas oficiais de Manifestação do Destinatário e Distribuição DF-e, versionados no adaptador da implementação.

## 13. Aprovação

Fronteira, sequência, elegibilidade, automatismo, idempotência, reconciliação, recuperação do XML, falhas, interface, provas e destinos aprovados pelo PI em 18/09/2026.
