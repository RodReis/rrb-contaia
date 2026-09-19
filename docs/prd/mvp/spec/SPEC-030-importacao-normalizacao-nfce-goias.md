# SPEC-030 / F30 — Importação e normalização de NFC-e modelo 65 em Goiás

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
>
> **Origem:** PRD v3.1 §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16
>
> **Estado:** aprovada pelo PI em 19/09/2026
>
> **Tamanho:** Grande e delimitada — importa lotes exportados do Portal Goiás, ERP ou emissor, valida e normaliza NFC-e modelo 65 e seus protocolos de autorização/cancelamento; emissão, RPA, consulta remota e efeitos tributários permanecem fora da fatia
>
> **Ambiente:** Docker local; arquivos reais necessários estão autorizados localmente; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #34

## 1. Objetivo

Permitir que o escritório importe XMLs de NFC-e modelo 65 emitidas por estabelecimento de Goiás, preserve o original, valide sua autenticidade offline e normalize documentos, itens, tributos, autorização e cancelamento para consumo seguro pelas capacidades fiscais posteriores.

O usuário seleciona a empresa e envia XML individual ou ZIP sem senha, obtido por exportação assistida do Portal Goiás, ERP ou emissor. Cada arquivo é processado de forma independente: documentos válidos são persistidos automaticamente, arquivos rejeitados não descartam os demais e o lote termina com relatório auditável por item.

A fatia não automatiza o portal estadual, não emite NFC-e, não consulta a Sefaz por chave, não calcula tributo e não reprocessa silenciosamente a F29. Quando um documento novo ou cancelado puder alterar uma competência já processada, a revisão fica desatualizada e exige reprocessamento humano explícito.

## 2. Fronteira da fatia

Esta fatia entrega:

- importação assíncrona de XML individual e ZIP sem senha;
- suporte versionado aos layouts NFC-e `3.10` e `4.00`;
- validação segura de XML, modelo 65, UF `GO`, empresa emitente, chave de acesso, assinatura e protocolo;
- preservação dos bytes originais e SHA-256 no repositório fiscal da F18;
- normalização de cabeçalho, emitente, destinatário quando informado, itens, totais, pagamentos e tributos presentes;
- persistência dos grupos IBS/CBS quando existentes no layout suportado, sem cálculo ou inferência;
- importação e vinculação de protocolo de autorização e evento de cancelamento;
- aceitação parcial do lote com resultado e código estável por arquivo;
- idempotência, conflito explícito, reprocessamento técnico e relatório para download;
- integração documental com a F29 por sinalização de competência desatualizada;
- interface final em `Documentos fiscais`, nos temas CLARO e ESCURO;
- auditoria append-only de upload, processamento, reuso, rejeição, conflito, cancelamento e reprocessamento.

Não entrega:

- emissão, autorização, inutilização ou cancelamento de NFC-e;
- automação de navegador, scraping, CAPTCHA ou sessão do Portal Goiás;
- consulta remota individual ou em lote por chave de acesso;
- conector direto com ERP ou emissor específico;
- NFC-e emitida por estabelecimento fora de Goiás;
- layouts diferentes de `3.10` e `4.00`;
- NFC-e em contingência ainda não autorizada, DANFE, imagem, PDF, QR Code isolado ou chave sem XML;
- eventos diferentes de autorização e cancelamento;
- cálculo, complemento, restituição, estorno, escrituração, guia, lançamento contábil ou efeito financeiro;
- reprocessamento automático de competência tributária;
- interpretação de legislação ou XML por LLM.

## 3. Entrada e cobertura

### 3.1 Origem assistida

O Portal Goiás é origem documental assistida: o usuário autenticado fora do ContaIA exporta os arquivos e os envia ao sistema. O ContaIA não recebe certificado para navegar no portal, não automatiza telas e não promete recuperar acervo histórico por API inexistente no contrato desta fatia.

ERP e emissor são origens declaradas do mesmo upload. A F30 não cria adaptador proprietário; todos convergem para os mesmos XMLs oficiais e para as mesmas validações.

### 3.2 Formatos

Cada tentativa aceita:

- um XML;
- um ZIP sem senha contendo XMLs em qualquer ordem;
- NFC-e autorizada em `nfeProc`/`procNFe` compatível com o schema suportado;
- evento oficial de cancelamento acompanhado de identidade suficiente para vínculo.

Arquivo criptografado, ZIP aninhado, entrada não XML, caminho absoluto, travessia de diretório, link simbólico, compressão excessiva ou conteúdo acima dos limites configurados é rejeitado antes do parse. Limites de bytes, quantidade e razão de compressão são decisões técnicas do Code, documentadas e testadas; precisam comportar a meta transversal de 10.000 XMLs em menos de 15 minutos no ambiente de referência.

### 3.3 Empresa e UF

A empresa é selecionada antes do upload. Documento apto exige:

- modelo `65`;
- emitente estabelecido em `GO`;
- CNPJ do emitente correspondente à empresa selecionada;
- chave de acesso coerente com UF, modelo, CNPJ, série, número, emissão e dígito verificador;
- ambiente de autorização identificado;
- layout `3.10` ou `4.00` explicitamente suportado.

Arquivo de outra empresa, tenant, UF ou modelo é rejeitado por item e nunca realocado automaticamente. O usuário precisa iniciar nova tentativa no contexto correto.

## 4. Validação e autenticidade offline

### 4.1 Ordem de validação

Para cada arquivo, o worker:

1. aplica limites de arquivo e compactação antes de expandir;
2. rejeita DTD, entidades externas, referências de rede e expansão de entidades;
3. identifica XML, namespace, tipo, modelo e versão;
4. valida contra schema oficial versionado no repositório;
5. recompõe e valida a chave de acesso;
6. confere empresa, CNPJ emitente e UF;
7. verifica a assinatura XML e sua cadeia criptográfica disponível;
8. confere protocolo, chave, ambiente, digest e código de autorização;
9. preserva os bytes originais e calcula SHA-256;
10. normaliza o documento ou evento e publica o resultado do arquivo.

Um XML bem-formado sem prova completa não é promovido a documento apto. A ausência de consulta remota é exibida como característica da prova offline, não como validação online da situação atual na Sefaz.

### 4.2 Layouts

O parser suporta:

- `3.10`, necessário ao período histórico de 27/10/2016 a 28/02/2018 da F29;
- `4.00`, incluindo extensões oficiais reconhecidas pelo pacote de schemas adotado.

O layout é selecionado pelo conteúdo, nunca pela data presumida ou pelo nome do arquivo. Documento de versão desconhecida assume `UNSUPPORTED_LAYOUT`, preserva evidência da tentativa e não é exposto como apto.

Schemas e mapeamentos são versionados. Alterar parser ou schema cria versão nova; reprocessamento preserva tentativas e resultados anteriores.

### 4.3 Autorização e cancelamento

Uma NFC-e apta possui protocolo de autorização coerente com o documento assinado. O evento de cancelamento:

- precisa ter schema e assinatura válidos;
- precisa referenciar uma NFC-e da mesma empresa e ambiente;
- é idempotente por chave, tipo, sequência, protocolo e hash;
- pode chegar antes do documento, permanecendo pendente de vínculo;
- torna o documento `CANCELLED` quando conciliado;
- não apaga o original nem calcula estorno.

Evento divergente, sem identidade verificável ou de outra empresa é rejeitado. Evento válido ainda sem documento permanece observável e reprocessável, sem criar documento fiscal sintético.

## 5. Lote, estados e aceitação parcial

### 5.1 Estados do lote

```ts
type NfceImportBatchStatus =
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "COMPLETED_WITH_REJECTIONS"
  | "REJECTED"
  | "FAILED";

type NfceImportItemStatus =
  | "IMPORTED"
  | "REUSED"
  | "PENDING_LINK"
  | "REJECTED"
  | "CONFLICT"
  | "FAILED";
```

- `COMPLETED`: todos os arquivos terminaram como importados, reutilizados ou evento vinculado;
- `COMPLETED_WITH_REJECTIONS`: há ao menos um resultado válido e ao menos uma rejeição, conflito ou falha;
- `REJECTED`: nenhum arquivo é elegível por conteúdo ou contrato;
- `FAILED`: falha técnica do lote impediu produzir resultado confiável.

Falha técnica isolada de um arquivo não reverte documentos já confirmados. O relatório preserva cada resultado e permite reprocessar somente itens tecnicamente falhos ou pendentes; erro determinístico de conteúdo não recebe retry cego.

### 5.2 Resultado por arquivo

Cada resultado registra:

- nome lógico sanitizado, tamanho, media type e hash;
- tipo identificado, modelo, layout e ambiente;
- chave de acesso e protocolo quando confiáveis;
- estado e código estável;
- documento ou evento reutilizado/criado;
- versão do parser e do schema;
- instante, usuário, tentativa e `correlationId`;
- motivos sanitizados sem XML integral.

O relatório pode ser baixado em CSV. O original só é baixado por endpoint autorizado e auditado; caminho físico de storage nunca é exposto.

## 6. Idempotência, conflito e concorrência

A identidade do lote usa tenant, empresa e hash do arquivo enviado. Reenvio do mesmo conteúdo no mesmo contexto reutiliza o resultado terminal e não duplica documento, evento, objeto, notificação ou invalidação tributária.

A identidade documental usa tenant, empresa, modelo e chave de acesso:

- mesma chave e mesmo hash reutilizam o documento;
- mesma chave e conteúdo canônico equivalente, vindo de outra origem, acrescentam a origem sem duplicar o documento;
- mesma chave com hash ou conteúdo fiscal divergente produz `CONFLICT` e não escolhe vencedor;
- dois workers concorrentes convergem para um único documento/evento lógico.

O caso de uso controla banco, storage e outbox. Falha entre storage e banco não deixa registro confirmado apontar para objeto ausente; objeto órfão fica detectável por reconciliação.

## 7. Normalização

O contrato normalizado reutiliza a estrutura documental da F18 e acrescenta suporte explícito ao modelo 65. Persiste, quando presente:

- identificação, versão, série, número, chave, ambiente, datas civis e instantes;
- emitente, destinatário identificado e local de entrega;
- finalidade, presença, consumidor final e tipo de emissão;
- itens, produto, GTIN, NCM, CEST, CFOP, unidade, quantidade e valores;
- ICMS, ICMS-ST, PIS, COFINS e demais grupos presentes;
- IBS/CBS, benefícios e campos da RTC presentes no layout suportado;
- descontos, acréscimos, frete, totalizadores e pagamentos;
- protocolo de autorização e cancelamento conciliado;
- origem, hash, schema e versão do parser.

Valor ausente permanece ausente; nunca vira zero. Dinheiro usa centavos inteiros quando a escala for monetária final. Quantidades, alíquotas e fatores usam decimal exato ou inteiro escalado. Float é proibido.

O parser não classifica autopeça, seleciona regra tributária, calcula imposto, interpreta descrição ou decide elegibilidade da F29.

## 8. Integração com a F29

Após publicar documento ou cancelamento, o sistema identifica competências da F29 potencialmente afetadas pela empresa e data fiscal.

- competência nunca processada apenas passa a enxergar o novo documento;
- revisão em processamento recebe conflito de conjunto documental e não conclui com snapshot antigo;
- revisão `PENDING_REVIEW`, `APPROVED` ou `REJECTED` é marcada `STALE` quando o conjunto documental mudar;
- rascunho associado é invalidado, preservado e identificado como superado;
- usuário autorizado recebe motivo e ação para reprocessar a competência inteira;
- nenhum valor é recalculado e nenhuma nova revisão é criada automaticamente.

A detecção de impacto não afirma que toda NFC-e importada pertence ao cálculo de autopeças. A F29 continua sendo autoridade para selecionar operação, item, período, regime e regra.

## 9. Autorização, isolamento e auditoria

- `admin_escritorio`: importa, consulta, baixa relatório/original e reprocessa no tenant;
- `contador`: mesmas ações somente em empresa da carteira ativa;
- `auxiliar`: mesmas ações somente em empresa da carteira ativa e com permissão fiscal;
- `auditor_readonly`: consulta histórico, resultado, integridade e original autorizado, sem mutar;
- demais papéis: negados por padrão.

Lotes, itens, origens, documentos, eventos, objetos e auditoria possuem `tenant_id` e `empresa_id`, índice e RLS. Toda consulta e comando revalidam tenant, empresa e carteira na API.

Eventos append-only cobrem upload, início, importação, reuso, pendência, rejeição, conflito, falha, vínculo, cancelamento, download e reprocessamento. Logs e métricas não contêm XML integral, CPF de consumidor, assinatura, certificado, URL física ou conteúdo do ZIP.

## 10. Contrato de interface

A F30 compõe `Documentos fiscais` e não cria módulo tributário paralelo.

### 10.1 Estrutura

1. empresa selecionada e origem declarada;
2. ação `Importar NFC-e`;
3. área de upload para XML/ZIP e limites visíveis;
4. progresso assíncrono com totais processados;
5. resumo de importados, reutilizados, pendentes, rejeitados, conflitos e falhas;
6. tabela paginada por arquivo com código e mensagem acionável;
7. download do relatório;
8. histórico de lotes;
9. detalhe do documento com integridade, protocolo, estado e eventos;
10. aviso de competência F29 desatualizada com ação de reprocessamento no fluxo fiscal.

Não existe prévia ou confirmação após o upload: arquivo válido é persistido automaticamente. Correção ocorre no arquivo de origem e em nova tentativa; a interface não permite editar XML, chave, protocolo, imposto ou evento.

### 10.2 Estados e prova visual

Estados obrigatórios: vazio, arquivo selecionado, rejeição prévia, na fila, processando, concluído, concluído com rejeições, rejeitado, falha técnica, conflito, evento pendente de vínculo, documento autorizado, documento cancelado e competência desatualizada.

A tela de triagem documental de `docs/telas/` orienta conteúdo, densidade e hierarquia. `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md` corrigem aparência e comportamento.

Entrega final obrigatória em CLARO e ESCURO, com provas em 768, 1024 e 1440 px, navegação por teclado, foco visível, contraste, leitor de tela e redução de movimento. Estado nunca depende apenas de cor. `frontend-design` orienta a implementação e `impeccable` executa o passe final de acabamento.

## 11. API e persistência

O contrato HTTP expõe operações equivalentes a:

- criar lote multipart para uma empresa e origem declarada;
- consultar lote, progresso, totais e resultados paginados;
- baixar relatório do lote;
- consultar documento, integridade, origens, protocolo e eventos;
- baixar original com verificação de hash;
- reprocessar item técnico falho ou pendente com versão esperada.

Upload responde `202 Accepted` com identidade do lote. Comandos repetidos usam chave idempotente. Mutação concorrente ou conteúdo divergente retorna conflito.

Erros seguem `application/problem+json` com `type`, `title`, `status`, `code` e `correlationId`. Códigos estáveis cobrem, no mínimo:

- `NFCE_FILE_UNSUPPORTED`;
- `NFCE_ARCHIVE_UNSAFE`;
- `NFCE_XML_INVALID`;
- `NFCE_LAYOUT_UNSUPPORTED`;
- `NFCE_MODEL_MISMATCH`;
- `NFCE_ISSUER_MISMATCH`;
- `NFCE_ACCESS_KEY_INVALID`;
- `NFCE_SIGNATURE_INVALID`;
- `NFCE_PROTOCOL_INVALID`;
- `NFCE_EVENT_ORPHAN`;
- `NFCE_DOCUMENT_CONFLICT`;
- `NFCE_BATCH_LIMIT_EXCEEDED`.

Controller apenas valida e delega. DTO não é entidade. Parser e verificador não conhecem HTTP, banco, storage, relógio ou LLM.

## 12. Invariantes

| ID | Invariante |
|---|---|
| `I-1` | todo lote, arquivo, documento, evento, origem e auditoria pertence a tenant e empresa sob RLS |
| `I-2` | CNPJ emitente divergente nunca é realocado nem aceito silenciosamente |
| `I-3` | XML só fica apto após schema, chave, assinatura e protocolo coerentes |
| `I-4` | bytes originais e SHA-256 são preservados; caminho físico não é contrato público |
| `I-5` | uma rejeição não descarta os arquivos válidos do lote |
| `I-6` | mesma chave com conteúdo divergente gera conflito, nunca sobrescrita |
| `I-7` | cancelamento altera estado documental sem apagar original ou calcular estorno |
| `I-8` | dado ausente não vira zero; valores fiscais não usam float |
| `I-9` | LLM não valida, normaliza, classifica nem calcula documento fiscal |
| `I-10` | importação não recalcula F29; apenas marca revisão afetada como desatualizada |

## 13. Estratégia de testes

| Categoria | Provas mínimas |
|---|---|
| Regras | chave, dígito, modelo, UF, empresa, layout, estado do lote e transições documentais |
| XML | fixtures 3.10 e 4.00, autorização, cancelamento, IBS/CBS presente/ausente e campos opcionais |
| Segurança | DTD, XXE, expansão, referência externa, ZIP Slip, ZIP bomb, senha, aninhamento e limite |
| Criptografia | assinatura válida, digest alterado, certificado incompatível e protocolo divergente |
| Lote | vazio, XML único, ZIP misto, 10.000 itens, aceitação parcial e falha técnica isolada |
| Idempotência | reenvio, origem diferente, evento repetido, workers concorrentes e conflito chave/hash |
| Banco | RLS, carteira, unicidade, append-only, storage/banco e evento órfão conciliado depois |
| Integração F29 | documento novo, cancelamento, revisão em processamento, rascunho aprovado invalidado e reprocessamento explícito |
| Tela | CLARO/ESCURO, 768/1024/1440, estados, teclado, foco, contraste e leitor de tela |
| E2E | selecionar empresa → enviar lote misto → acompanhar → consultar resultados → importar cancelamento → sinalizar F29 |
| Performance | 10.000 XMLs em menos de 15 minutos no ambiente de referência |

Fixtures oficiais ou sintéticas rastreáveis registram layout, origem e anonimização. Portal Goiás real não integra a suíte: a exportação assistida e a consulta remota são `not_run`, nunca `pass`.

## 14. Critérios de aceite

- [ ] XML individual e ZIP sem senha são processados de forma assíncrona e segura.
- [ ] Somente NFC-e modelo 65 de emitente GO e da empresa selecionada é aceita.
- [ ] Layouts 3.10 e 4.00 usam schemas versionados e fixtures rastreáveis.
- [ ] Documento apto possui chave, assinatura e protocolo offline coerentes.
- [ ] Original e SHA-256 são preservados e recuperáveis por fluxo autorizado.
- [ ] Itens, totais, pagamentos e tributos presentes são normalizados sem inferir ausências.
- [ ] Autorização e cancelamento são vinculados idempotentemente; evento órfão permanece observável.
- [ ] Arquivo inválido não descarta arquivos válidos do mesmo lote.
- [ ] Reenvio não duplica documento/evento e conflito de chave não sobrescreve conteúdo.
- [ ] Documento novo ou cancelado marca revisão F29 afetada como desatualizada sem recalcular.
- [ ] RLS, carteira e papéis impedem acesso cruzado a lote, XML, relatório e documento.
- [ ] Interface final prova temas, viewports, estados e acessibilidade obrigatórios.

## 15. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Outras UFs e autorizadores | fatias próprias de expansão documental no MVP-2 |
| Outros layouts e futuras NTs | extensão versionada do parser por fatia de manutenção/expansão |
| Automação ou API oficial do Portal Goiás | fatia própria somente após contrato oficial documentado |
| Conectores de ERP/emissor | fatias próprias por fornecedor e contrato aprovado |
| Demais eventos de NFC-e | fatia própria de eventos fiscais no MVP-2 |
| Devolução e estorno proporcional | capacidade de eventos posteriores da F29 no MVP-2 |
| Cálculo com NFC-e na F29 | extensão própria da F29 após esta base documental |
| Transmissão, EFD, crédito, guia e contabilidade | capacidades fiscais e contábeis posteriores do MVP-2 |
| Produção e consulta real | gate posterior ao MVP-4 |

Nenhum complemento foi descartado. Documento não coberto permanece explicitamente não suportado e nunca é convertido em documento apto por aproximação.

## 16. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Capacidade | ingestão, validação, persistência e normalização de NFC-e modelo 65 |
| Origem | exportação assistida do Portal Goiás, ERP ou emissor; sem RPA |
| Cobertura | NFC-e genérica e versionada, sem acoplamento a autopeças |
| UF | somente estabelecimento emitente em Goiás |
| Layouts | 3.10 e 4.00 |
| Eventos | autorização e cancelamento; demais eventos ficam para fatia própria |
| Falha | resultado por arquivo, preservando válidos do lote misto |
| Persistência | automática após validação; sem prévia ou confirmação |
| Autenticidade | schema, chave, assinatura e protocolo validados offline; sem consulta remota |
| Interface | `Documentos fiscais` |
| F29 | marcar competência desatualizada e exigir reprocessamento explícito |
| Permissões | admin, contador e auxiliar importam; auditor somente consulta |

## 17. Matriz de cobertura

| Requisito | Cobertura |
|---|---|
| Identidade | importação e normalização de NFC-e modelo 65 emitida em Goiás |
| Comportamento | enviar lote, validar, preservar, normalizar, vincular eventos e relatar por arquivo |
| Aceite | §14, com provas por categoria no §13 |
| Invariantes | §12, incluindo RLS, autenticidade offline, idempotência e ausência de cálculo |
| Fora de escopo | §15, todos com destino explícito |
| Dúvidas resolvidas | §16, sem decisão de produto pendente |
| Contrato de UI | §10, tela final nos dois temas e estados obrigatórios |
| Rastreabilidade | PRD §§3, 5.3, 6.1, 6.5, 12, 14, 15 e 16; MVP-2; issue #34 |

## 18. Referências oficiais datadas

- Secretaria da Economia de Goiás, NFC-e — Nota Fiscal do Consumidor Eletrônica, consultada em 19/09/2026;
- Secretaria da Economia de Goiás, Consultas e Serviços, incluindo Arquivo XML e Lotes Enviados, consultada em 19/09/2026;
- Portal Nacional da NF-e, MOC 7.0 e schemas oficiais de NF-e/NFC-e, consultados em 19/09/2026;
- Nota Técnica 2016.002, migração do leiaute 3.10 para 4.00;
- Secretaria da Economia de Goiás, desativação da versão 3.10 da NFC-e em 01/10/2018.

## 19. Aprovação

Capacidade, origem, cobertura, UF, layouts, autenticidade, eventos, lote parcial, persistência automática, interface, integração com a F29, permissões, limites, provas e destinos aprovados pelo PI em 19/09/2026. A implementação deve seguir esta SPEC sem introduzir RPA, consulta remota, emissão, cálculo tributário ou regra jurídica adicional.
