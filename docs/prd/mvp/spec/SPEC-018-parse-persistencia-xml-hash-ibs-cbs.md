# SPEC-018 / F18 — Parse e persistência de XML, hash e IBS/CBS

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§3, 5.3, 5.4, 6.1, 6.5, 12, 14, 15 e 16
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande e atômica — fecha o fluxo vertical do staging da F17 até o documento fiscal persistido e verificável; ciência, triagem e manifestação permanecem em fatias próprias
>
> **Ambiente:** Docker local com object storage e fixtures de NF-e/CT-e; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #20

## 1. Objetivo

Transformar o conteúdo opaco de NF-e modelo 55 e CT-e capturado pela F17 em documento fiscal normalizado, íntegro, recuperável e apto ao consumo das capacidades posteriores.

Sucesso significa preservar exatamente o XML recebido, comprovar sua integridade por hash, normalizar os dados fiscais sem duplicação, persistir IBS/CBS quando aplicável e tornar falhas ou lacunas explicitamente reprocessáveis, sem acoplar o parse ao avanço do NSU.

## 2. Fronteira da fatia

Esta fatia entrega:

- pipeline assíncrono e idempotente depois do staging da F17;
- armazenamento definitivo dos bytes originais no object storage local;
- hash SHA-256 calculado sobre os bytes originais, sem canonicalização;
- validação segura de envelope, espécie, layout e estrutura XML;
- parse e normalização de NF-e modelo 55 e CT-e;
- persistência de itens, totais, tributos e campos IBS/CBS disponíveis;
- estados explícitos para XML inválido, layout não suportado, IBS/CBS pendente, conflito e falha;
- reprocessamento controlado a partir do original preservado;
- painel técnico por empresa para consultar processamento, metadados, integridade e original.

A F18 não altera `ultNSU`, não captura NFS-e, não executa Ciência da Emissão, não classifica risco e não cria inbox ou qualquer outra manifestação.

## 3. Comportamento esperado

### 3.1 Entrada e desacoplamento da captura

Cada item de staging duravelmente aceito pela F17 publica um comando idempotente de processamento. A mensagem contém somente identificadores e metadados necessários: tenant, empresa, item de staging, CNPJ, NSU, chave de acesso quando disponível, espécie declarada, versão e `correlationId`.

O pipeline da F18 não controla nem retrocede o cursor de captura. Falha de parse, persistência ou storage não invalida o lote já capturado; mantém o item observável e reprocessável até resultado terminal ou intervenção autorizada.

### 3.2 Preservação do original e hash

Antes de publicar um documento normalizado, o processador:

1. lê o conteúdo opaco do staging com limite de tamanho configurado;
2. rejeita DTD, entidades externas, referências de rede e expansão de entidades;
3. grava exatamente os bytes recebidos no repositório fiscal definitivo;
4. calcula SHA-256 sobre esses mesmos bytes;
5. registra localização opaca, hash, algoritmo, tamanho, media type, origem, instante e `correlationId`.

O caminho físico do objeto não é contrato público e não é exposto ao navegador. Recuperação passa por autorização da aplicação e recalcula o hash antes de declarar o arquivo íntegro.

Falha antes da confirmação do banco não publica documento parcial. Objeto gravado sem confirmação transacional fica detectável para reconciliação; registro confirmado nunca aponta silenciosamente para objeto ausente.

### 3.3 Identidade e idempotência

A identidade funcional do documento usa tenant, empresa, espécie e chave de acesso. O vínculo com CNPJ e NSU de origem é preservado.

- mesma origem, chave e hash reutiliza o documento e a execução existente;
- mesmo XML recebido por outro NSU válido acrescenta a origem sem duplicar documento, itens ou tributos;
- mesma chave com hash diferente, espécie incompatível ou conteúdo fiscal divergente gera `CONFLITO` bloqueante;
- ausência ou invalidade da chave não é corrigida por inferência silenciosa;
- reprocessamento preserva histórico, versão anterior do parser e resultado de cada tentativa;
- documento fiscal e original não são apagados: erro ou supersessão altera estado por evento auditável.

### 3.4 Validação e layouts

O parser identifica a espécie e a versão pelo conteúdo, confrontando-as com o envelope da captura. NF-e modelo diferente de 55, CT-e não suportado, XML de outra família ou divergência entre envelope e conteúdo não são aceitos como documento normalizado.

O XML deve estar bem-formado e compatível com um layout explicitamente suportado e versionado. Validação estrutural usa schemas/fixtures versionados no repositório; rede externa não é consultada durante o parse.

Um XML íntegro com layout ainda não suportado:

- conserva original e hash;
- assume `PENDENTE_LAYOUT`;
- não fica apto à apuração nem às manifestações posteriores;
- pode ser reprocessado quando uma nova versão do parser for disponibilizada.

XML malformado ou estruturalmente inválido assume `XML_INVALIDO`, com erros sanitizados e sem conteúdo integral nos logs.

### 3.5 Normalização fiscal

O documento normalizado persiste, no mínimo:

- espécie, modelo, versão do layout, chave de acesso e protocolo quando presente;
- emitente e destinatário com identificadores fiscais e localização declarada;
- data civil de emissão e demais datas relevantes sem conversão indevida de fuso;
- itens com código, descrição, quantidade, unidade e valores;
- totais do documento e bases/valores tributários presentes;
- referências a documentos, eventos ou protocolos contidos no XML;
- situação do processamento, versão do parser, hash e vínculo com todas as origens de captura.

Dinheiro e tributos são representados em unidade decimal exata conforme a escala fiscal de origem; float é proibido. A conversão para centavos só ocorre onde o domínio representar valor monetário com duas casas sem perda. Ausente, zero e não aplicável permanecem estados distintos.

### 3.6 IBS/CBS

Para documentos emitidos em ou após 03/08/2026, o parser procura e persiste os grupos e valores IBS/CBS definidos pelo layout suportado, mantendo origem por item e totalizadores quando existirem.

- campos presentes e válidos ficam disponíveis ao motor tributário versionado;
- ausência ou incompletude esperada não inventa zero nem cálculo substituto;
- o documento é preservado e normalizado com estado `PENDENTE_IBS_CBS`;
- documento pendente não é anunciado como apto à apuração;
- revisão ou reprocessamento posterior preserva a trilha anterior.

Documentos anteriores ao marco temporal podem não conter IBS/CBS sem gerar pendência. A F18 não calcula imposto nem decide regra de vigência: apenas normaliza o conteúdo recebido.

### 3.7 Estados e reprocessamento

Cada origem de processamento transita por eventos append-only entre:

- `PENDENTE`;
- `PROCESSANDO`;
- `PROCESSADO`;
- `PENDENTE_LAYOUT`;
- `PENDENTE_IBS_CBS`;
- `XML_INVALIDO`;
- `CONFLITO`;
- `FALHA`.

Falhas transitórias de storage, banco ou worker usam retry exponencial e a mesma chave idempotente. Exaurido o limite técnico, ficam em DLQ e `FALHA`. XML inválido, layout não suportado e conflito não recebem retry cego.

`admin_escritorio`, `contador` e `auxiliar` podem solicitar reprocessamento dentro da carteira; `auditor_readonly` consulta. Reprocessar nunca modifica o XML original, apaga tentativa anterior ou cria segundo documento para a mesma identidade.

### 3.8 Auditoria e métricas

Cada tentativa registra, em trilha append-only:

- tenant, empresa, origem, ator quando humano e identidade técnica;
- versão do parser e layout identificado;
- hash esperado e resultado da verificação, sem conteúdo XML;
- início, fim, duração, resultado, código estável e `correlationId`;
- documento reutilizado, criado, pendente, conflitante ou falho;
- quantidade de itens e grupos fiscais processados, sem dados sensíveis desnecessários.

Métricas mínimas cobrem fila, duração, throughput, duplicados evitados, pendências por causa, falhas, DLQ, conflitos e divergências de integridade.

## 4. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | documentos, origens, itens, tributos, execuções e auditoria possuem `tenant_id` e `empresa_id`, indexados e sob RLS |
| `I-2` | consulta, download, validação e reprocessamento exigem contexto de tenant, empresa e carteira |
| `I-3` | valores fiscais não usam float; persistência preserva precisão e escala |
| `I-4` | parser não calcula tributo nem usa LLM; somente extrai dados para o motor versionado |
| `I-6` | tentativas, transições, conflitos e verificações de integridade são append-only |
| `I-7` | XML e documento fiscal não são excluídos fisicamente; estado e histórico permanecem recuperáveis |
| `I-8` | o marco de IBS/CBS usa a data de emissão do documento, não o relógio atual |
| `I-9` | comando, persistência e reprocessamento são idempotentes por identidade, origem e hash |
| `I-11` | data civil permanece sem fuso; instantes técnicos usam UTC e exibição `America/Sao_Paulo` |

## 5. Contrato de interface

### 5.1 Superfície mínima

A seção operacional de captura da empresa passa a oferecer um painel técnico de processamento documental para:

- listar documentos e origens com estado, espécie, emissão, chave mascarada, NSU e última tentativa;
- filtrar processados, pendentes, inválidos, conflitos e falhas;
- abrir metadados normalizados e resumo de IBS/CBS sem função de apuração;
- validar novamente o hash e mostrar resultado textual;
- baixar o XML original por fluxo autorizado e auditado;
- solicitar reprocessamento quando permitido.

Não existem sugestão, score, manifestação, aprovação fiscal ou grade de inbox nesta fatia.

### 5.2 Estados obrigatórios

- carregando com skeleton;
- fila vazia;
- pendente e processando;
- processado e íntegro;
- IBS/CBS pendente;
- layout não suportado;
- XML inválido;
- conflito de chave/hash;
- falha transitória e DLQ;
- integridade confirmada e divergente;
- download indisponível;
- reprocessamento solicitado, deduplicado e concluído;
- acesso negado.

### 5.3 Responsividade, acessibilidade e prova

- temas CLARO e ESCURO completos;
- viewports de 768, 1024 e 1440 px;
- tabela adapta colunas conforme decisão P-02 antes da implementação, sem ocultar estado ou ação principal;
- filtros, detalhes, validação, download e reprocessamento operáveis por teclado, com foco visível;
- estado e integridade nunca dependem somente de cor;
- valores, datas e horas seguem `FRONTEND.md`;
- `frontend-design`, `gstack:design-review` e `impeccable` aplicados conforme `FRONTEND.md` §20.1.

A referência concreta é `docs/telas/contaia_triagem_de_captura_df_e_inbox_de_manifesta_o_rf_02/`, limitada à linguagem visual da grade documental e do detalhe. Ações de triagem e manifestação presentes no protótipo não entram.

## 6. Arquitetura e contratos públicos

### 6.1 Fluxo

```text
staging opaco F17 ─▶ fila de processamento ─▶ preserva bytes + SHA-256
                                             │
                                             ▼
                                  valida espécie/layout/schema
                                             │
                  ┌──────────────────────────┼─────────────────────────┐
                  ▼                          ▼                         ▼
          normaliza documento       pendência reprocessável     inválido/conflito
                  │                          │                         │
                  └──────────────────────────┴─────────────────────────┘
                                             ▼
                                  estado + auditoria + métricas
```

### 6.2 Contratos internos

O comando de processamento e o resultado são tipados e versionados. O parser recebe bytes, espécie esperada e contexto técnico; devolve documento normalizado ou falha discriminada. O domínio não conhece biblioteca XML, ORM, fila ou object storage.

O adaptador de XML é substituível e seleciona parser por espécie e versão. Schemas, mapeamentos e versão do parser são explícitos para permitir reprocessamento determinístico e comparação entre versões.

### 6.3 Endpoints mínimos

```text
GET  /companies/:companyId/fiscal-documents
GET  /companies/:companyId/fiscal-documents/:documentId
POST /companies/:companyId/fiscal-documents/:documentId/integrity-checks
GET  /companies/:companyId/fiscal-documents/:documentId/original
POST /companies/:companyId/fiscal-documents/:documentId/reprocessing
```

Listagens são paginadas e ordenadas por emissão e captura, com desempate estável. O download usa resposta autorizada de curta duração ou streaming controlado, nunca caminho direto do storage. Erros seguem `application/problem+json`.

### 6.4 Códigos de erro estáveis

- `FISCAL_XML_INVALID`;
- `FISCAL_XML_UNSAFE`;
- `FISCAL_XML_TOO_LARGE`;
- `FISCAL_LAYOUT_UNSUPPORTED`;
- `FISCAL_DOCUMENT_TYPE_MISMATCH`;
- `FISCAL_DOCUMENT_IDENTITY_INVALID`;
- `FISCAL_DOCUMENT_CONFLICT`;
- `FISCAL_DOCUMENT_INTEGRITY_MISMATCH`;
- `FISCAL_IBS_CBS_INCOMPLETE`;
- `FISCAL_ORIGINAL_UNAVAILABLE`;
- `FISCAL_REPROCESS_ALREADY_QUEUED`;
- `FISCAL_DOCUMENT_ACCESS_DENIED`.

## 7. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | identificação, estados, marco de 03/08/2026, ausência distinta de zero e política de layout |
| Segurança XML | XML malformado, DTD, XXE, entidade expansiva, referência externa e limite de tamanho |
| Parse NF-e | cabeçalho, partes, itens, totais, tributos, referências, datas e IBS/CBS em fixtures versionadas |
| Parse CT-e | cabeçalho, partes, componentes, totais, tributos, referências, datas e IBS/CBS em fixtures versionadas |
| Banco | RLS, precisão decimal, unicidade, origens múltiplas, append-only e ausência de exclusão física |
| Storage/hash | bytes preservados, SHA-256 reproduzível, recuperação, objeto ausente, adulteração e reconciliação de órfão |
| Idempotência | mesma origem, mesmo XML em outro NSU, comando repetido, reprocessamento e conflito de hash/chave |
| Fila | retry, exclusão concorrente, DLQ, retomada e nova versão do parser |
| Autorização | carteira ativa opera; auditor consulta; outro tenant/empresa e URL direta são negados |
| Tela | estados, filtros, detalhes, integridade, download, reprocessamento, temas, viewports, teclado e foco |
| E2E | captura F17 → staging → original/hash → parse → documento → recuperação com hash validado |
| Performance | lote de 10.000 XMLs processado em menos de 15 minutos no ambiente de referência do `AUDIT.md` |
| Contrafactual | hash adulterado, chave igual com conteúdo diferente, envelope divergente, crash entre storage e banco e segredo sentinela |

## 8. Critérios de aceite verificáveis

- [ ] Todo item elegível da F17 gera no máximo um processamento ativo, sem interferir no cursor NSU.
- [ ] Bytes originais de NF-e 55 e CT-e são recuperáveis e produzem o mesmo SHA-256 armazenado.
- [ ] XML inseguro ou acima do limite é contido sem acesso a rede, arquivo local ou expansão de entidade.
- [ ] NF-e 55 e CT-e suportados geram documentos, itens, totais e tributos normalizados com precisão.
- [ ] Reprocessar conteúdo idêntico não duplica documento, origem, itens nem grupos tributários.
- [ ] Mesma chave com conteúdo divergente gera conflito bloqueante e auditável.
- [ ] Layout íntegro não suportado preserva original, fica pendente e pode ser reprocessado.
- [ ] XML inválido preserva evidência e erro sanitizado sem publicar documento apto.
- [ ] Documento emitido desde 03/08/2026 sem IBS/CBS esperado fica `PENDENTE_IBS_CBS`, sem inventar valores.
- [ ] Documento anterior ao marco não gera pendência apenas pela ausência de IBS/CBS.
- [ ] Documento pendente, inválido ou conflitante não é exposto como apto à apuração ou manifestação.
- [ ] Falha entre storage e banco não deixa registro confirmado irrecuperável nem objeto órfão invisível.
- [ ] Download, verificação e reprocessamento respeitam tenant, empresa, carteira e auditoria.
- [ ] Logs, métricas e erros não contêm XML integral nem URL física do objeto.
- [ ] O pipeline processa 10.000 XMLs em menos de 15 minutos no ambiente de referência.
- [ ] Painel técnico prova os estados e ações nos dois temas e três viewports.
- [ ] Testes de regras, banco, tela e E2E publicam evidência vinculada à SPEC-018 e à issue.

## 9. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Captura e parse de NFS-e padrão nacional | MVP-1 · capacidade própria de NFS-e a decompor; não usa a fila NSU da F17 |
| Parse de eventos e protocolos de manifestação | MVP-1 · capacidade de Ciência da Emissão e capacidade de inbox/manifestações, conforme o evento |
| Ciência da Emissão automática | MVP-1 · próxima capacidade RF-02 a numerar |
| Inbox, score e aprovação das demais manifestações | MVP-1 · capacidade própria RF-02 a numerar |
| Cálculo, apuração e regras completas de IBS/CBS | motor base F16; apuração no MVP-2 e transição completa no MVP-4 |
| Correção ou edição manual do conteúdo fiscal | não permitida; nova origem ou reprocessamento preserva o original e a trilha |
| Object storage, chaves e retenção produtivos | gate de Produção posterior ao MVP-4 |

## 10. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Formatos | NF-e modelo 55 e CT-e vindos da F17 |
| NFS-e e eventos | não criar parsers sem fluxo; recebem destino explícito em capacidades posteriores |
| Arquitetura | pipeline assíncrono desacoplado do worker e do cursor da F17 |
| IBS/CBS ausente | persistir com pendência e impedir estado apto à apuração |
| Layout desconhecido | preservar original e deixar pendente para reprocessamento |
| Interface | painel técnico na empresa; não antecipar inbox ou manifestação |
| Integridade | SHA-256 dos bytes originais, recuperável e verificável |
| Ambiente | Docker local, sem produção |

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

## 12. Aprovação

Fronteira, formatos, pipeline, identidade, hash, IBS/CBS, falhas, reprocessamento, interface, provas e destinos aprovados pelo PI em 18/09/2026. A implementação deve manter separadas captura NSU, Ciência da Emissão, inbox e demais manifestações.
