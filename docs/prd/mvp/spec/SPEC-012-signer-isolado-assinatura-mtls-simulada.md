# SPEC-012 / F12 — Signer isolado e assinatura/mTLS simulada

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§4.5, 4.6, 14, 15 e 16
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande — isolamento de rede, identidades técnicas, acesso estreito ao cofre, assinatura XML, saída mTLS, idempotência, auditoria, monitoramento e interface operacional formam uma fronteira de segurança atômica; separar essas partes produziria um Signer parcialmente confiável
>
> **Ambiente:** Docker local, somente material criptográfico de teste; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #14

## 1. Objetivo

Permitir que workers autorizados usem o certificado A1 vigente de uma empresa para assinar XML e concluir chamadas mTLS contra dublês locais de DF-e e eSocial, sem que API, worker, navegador ou usuário recebam PKCS#12, senha ou chave privada.

Sucesso significa provar, de ponta a ponta, que o Signer é o único serviço com acesso de leitura ao material criptográfico, restringe cada operação à empresa e à finalidade declaradas, não repete efeito externo e oferece diagnóstico operacional sem expor segredo.

## 2. Fronteira da fatia

Esta fatia entrega:

- Signer isolado em rede Docker privada e sem domínio público;
- autenticação mTLS interna com identidades técnicas distintas para API e workers;
- leitura estreita do Vault, sem capacidade de listagem ampla;
- assinatura XML XMLDSig com RSA-SHA256 e digest SHA-256;
- adaptadores explícitos para `DF-e de teste` e `eSocial de teste`;
- término mTLS contra dublês locais com destinos preconfigurados;
- idempotência de assinatura e de chamada externa;
- auditoria append-only de sucessos, falhas e recusas;
- teste automático pós-cadastro/substituição e teste manual autorizado;
- monitor de saúde, alerta de indisponibilidade e notificação de recuperação;
- painel operacional final integrado à tela do Cofre de Certificados.

O Signer não é proxy HTTP genérico, não aceita URL arbitrária, não consulta órgão oficial e não implementa captura DF-e, eSocial funcional ou procuração RFB/e-CAC.

## 3. Comportamento esperado

### 3.1 Identidades e alçadas técnicas

- workers autenticados podem solicitar assinatura e saída mTLS;
- a API autenticada pode consultar saúde, estados e histórico e solicitar diagnóstico autorizado;
- a identidade da API não pode assinar XML nem executar operação funcional em nome de worker;
- cada identidade usa certificado de serviço próprio, emitido pela CA local da composição Docker;
- processo sem identidade, com identidade desconhecida, expirada ou sem a alçada exigida é recusado;
- estar na rede Docker não concede autorização por si só.

### 3.2 Contexto obrigatório

Toda solicitação operacional contém:

- `tenant_id`;
- `empresa_id`;
- finalidade fechada;
- XML de teste;
- chave idempotente;
- `correlationId`;
- identidade técnica chamadora;
- usuário originador quando a cadeia tiver sido iniciada por pessoa.

O Signer valida tenant, empresa, finalidade, certificado vigente e alçada técnica antes de ler o segredo. Contexto ausente, cruzado ou incompatível é recusado sem leitura do certificado.

### 3.3 Finalidades permitidas

O catálogo inicial possui somente:

1. `DF-e de teste`;
2. `eSocial de teste`.

Cada finalidade possui adaptador próprio, regras de assinatura, destino local allowlisted e estado de diagnóstico independente. Finalidade livre, desconhecida ou incompatível com o adaptador é recusada.

O chamador não informa protocolo, host, porta, URL, CA, algoritmo ou caminho do Vault. Esses valores pertencem à configuração controlada da finalidade.

### 3.4 Leitura do certificado

O Signer resolve o certificado vigente pelos metadados autorizados e lê diretamente no Vault a versão correspondente. A política:

- concede `read` somente aos caminhos necessários;
- não concede `list` amplo;
- não concede escrita, rotação, desativação ou administração do cofre;
- não permite ler certificado de outro tenant ou empresa;
- é exclusiva da identidade do Signer.

PKCS#12 e senha existem somente no Vault e na memória do processo durante a operação. O material é descartado ao terminar e nunca é escrito em arquivo temporário, banco, fila, cache, log, trace ou resposta.

### 3.5 Condição do certificado

- certificado ausente, vencido, ainda não vigente ou desativado bloqueia assinatura e mTLS;
- certificado vigente continua utilizável quando o responsável da F11 fica inválido;
- a utilização sem responsável válido não encerra o alerta nem a pendência administrativa da F11;
- troca de certificado passa a valer para novas operações depois da substituição atômica concluída na F11;
- operação já iniciada registra a referência opaca exata da versão usada.

### 3.6 Assinatura XML

O adaptador assina somente o elemento previsto pela finalidade, usando XMLDSig, RSA-SHA256, SHA-256 e canonicalização definida no contrato do adaptador.

Antes de devolver sucesso ou seguir para mTLS, o Signer valida a assinatura produzida com o certificado público correspondente. XML malformado, elemento-alvo ausente, referência ambígua, assinatura preexistente incompatível ou falha criptográfica gera recusa específica.

O XML assinado pode existir na memória da operação e na resposta imediata ao worker quando o contrato da chamada for somente assinatura. Ele não é persistido por esta fatia.

### 3.7 Saída mTLS simulada

Para chamada externa simulada, o adaptador:

1. assina o XML;
2. abre conexão TLS com o dublê local preconfigurado;
3. apresenta o A1 de teste vigente como certificado cliente;
4. valida certificado, cadeia e nome do servidor local contra a CA configurada;
5. envia a requisição prevista pela finalidade;
6. classifica a resposta e registra somente metadados operacionais.

Os dublês recusam conexão sem certificado cliente, com certificado não confiável ou com identidade incompatível. Desabilitar validação TLS, aceitar qualquer certificado ou substituir validação por HTTP simples invalida a prova.

### 3.8 Idempotência

A chave idempotente é avaliada junto de tenant, empresa, finalidade e hash do conteúdo.

- repetição idêntica com resultado terminal reutiliza o resultado persistido e não reassina nem chama o dublê novamente;
- mesma chave com tenant, empresa, finalidade ou conteúdo diferente retorna conflito;
- operação em andamento informa estado não terminal sem iniciar concorrente duplicada;
- falha transitória sem resultado terminal pode ser reapresentada pelo worker com a mesma chave, preservando o vínculo entre tentativas; o dublê recebe a mesma chave e também deduplica eventual efeito já aceito;
- falha definitiva é resultado terminal e sua repetição reutiliza a recusa registrada;
- o Signer realiza uma tentativa externa por chamada; backoff, teto e DLQ pertencem ao worker chamador.

### 3.9 Diagnóstico automático e manual

Depois que a F11 conclui cadastro ou substituição do certificado, a API agenda diagnóstico separado para DF-e e eSocial. O diagnóstico usa os dublês locais e registra autor técnico `sistema`.

Falha do diagnóstico:

- não desfaz a substituição;
- não desativa o certificado;
- mantém o A1 vigente;
- atualiza o estado operacional da finalidade;
- gera resultado acionável ao usuário e trilha auditável.

`admin_escritorio` pode executar teste manual para empresa do próprio tenant. `contador` pode executar somente para empresa de sua carteira ativa. Demais papéis apenas consultam quando possuírem a permissão correspondente da F8.

### 3.10 Saúde e incidentes

O monitor local verifica o Signer a cada minuto.

- três verificações consecutivas sem resposta válida abrem um incidente;
- um incidente aberto gera uma notificação individual para cada administrador ativo do tenant afetado;
- novas falhas do mesmo incidente não duplicam notificações;
- a primeira verificação válida encerra o incidente;
- a recuperação notifica os mesmos administradores e registra a duração;
- indisponibilidade do Signer não cria item na Central de Pendências;
- falha de uma finalidade por empresa não equivale automaticamente à indisponibilidade global do serviço.

### 3.11 Histórico operacional

O histórico registra sucessos, falhas, recusas e reutilizações idempotentes. Cada evento contém:

- tenant e empresa;
- finalidade;
- referência opaca do certificado;
- identidade técnica e usuário originador, quando houver;
- hash do conteúdo;
- chave idempotente por representação protegida;
- início, fim e latência;
- resultado e código estável;
- `correlationId`;
- indicação de operação nova ou resultado reutilizado.

Não contém XML, resposta integral do dublê, PKCS#12, senha, chave privada, token, certificado de serviço ou segredo de bootstrap.

## 4. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | operações, estados, incidentes e eventos transacionais possuem `tenant_id` e `empresa_id` obrigatórios, indexados e sob RLS quando aplicável |
| `I-2` | consulta ou operação sem contexto de tenant não retorna estado nem acessa certificado |
| `I-6` | histórico de assinaturas, mTLS, diagnósticos, recusas e incidentes é append-only |
| `I-9` | assinatura e chamada mTLS são idempotentes e não repetem efeito externo para a mesma solicitação |
| `I-10` | chave privada só existe no Vault e na memória do Signer; nenhum outro serviço consegue lê-la |
| `I-11` | instantes são persistidos em UTC e exibidos em `America/Sao_Paulo`; validade do certificado continua data civil |

## 5. Contrato de interface

### 5.1 Referência e composição

Referência principal:

- `docs/telas/contaia_configura_es_cofre_de_certificados_a1/screen.png`;
- `docs/telas/contaia_configura_es_cofre_de_certificados_a1/code.html`.

A F12 preserva a tela final entregue pela F11 e reintroduz somente:

- cartão geral `Microserviço Signer`;
- coluna `Signer mTLS` por empresa;
- ação para abrir o painel operacional detalhado;
- diagnóstico manual;
- histórico operacional do Signer.

Não reintroduz procurações, painel ou SQL de RLS, toggles de segurança, download do certificado, alegações de AWS KMS/HSM, produção, uptime real ou integração oficial já disponível.

### 5.2 Cartão e estado por empresa

O cartão geral mostra:

- estado agregado `Operacional`, `Degradado` ou `Indisponível`;
- instante da última verificação;
- latência da última resposta válida;
- acesso ao detalhe do incidente quando existir.

A coluna por empresa mostra DF-e e eSocial separadamente, cada um com estado, último teste e latência. O resumo da empresa usa o pior estado das duas finalidades e nunca depende apenas de cor.

### 5.3 Painel detalhado

O painel detalhado identifica empresa e CNPJ e oferece:

- resumo do certificado apenas por metadados;
- estado atual de DF-e e eSocial;
- botão `Testar mTLS` quando autorizado;
- progresso do teste sem permitir disparo duplicado;
- resultado acionável com `correlationId`;
- histórico paginado com 15 itens por página, do mais recente ao mais antigo;
- filtro por finalidade e resultado.

Sucessos, falhas e recusas aparecem no histórico. Conteúdo XML e detalhes sensíveis não aparecem nem podem ser expandidos ou baixados.

### 5.4 Estados obrigatórios

- carregando com skeleton;
- serviço operacional;
- degradado por uma finalidade;
- indisponível;
- empresa sem certificado vigente;
- teste em andamento;
- teste concluído com sucesso;
- falha acionável;
- histórico vazio;
- página de histórico sem resultado;
- acesso negado;
- falha de comunicação com manutenção do último estado conhecido e indicação de desatualização.

### 5.5 Responsividade e acessibilidade

- temas CLARO e ESCURO completos;
- viewports obrigatórios de 768, 1024 e 1440 px;
- ordem de foco previsível e foco sempre visível;
- cartão, estados, tabs/filtros, paginação e painel operáveis por teclado;
- diálogo/painel prende foco enquanto aberto, fecha por `Esc` e devolve foco ao acionador;
- estado nunca comunicado somente por cor;
- atualização assíncrona anunciada por região apropriada sem excesso de leitura;
- redução de movimento respeitada.

### 5.6 Prova visual obrigatória

A implementação usa `frontend-design` antes e durante a interface e `impeccable` no passe final. A PR apresenta comparação com a referência, CLARO/ESCURO, três viewports, estados, teclado, foco, acessibilidade e registro do refinamento conforme `FRONTEND.md` §20.1.

## 6. Arquitetura e contratos internos

### 6.1 Fluxo

```text
Worker autorizado
  └─▶ mTLS interno + contexto + XML + finalidade + idempotência
       └─▶ Signer
            ├─▶ resolve metadado vigente e autorização
            ├─▶ lê caminho estreito no Vault, sem listagem
            ├─▶ assina e valida XML em memória
            ├─▶ adaptador DF-e ou eSocial
            │    └─▶ dublê local por mTLS
            └─▶ persiste apenas resultado e auditoria

API autorizada
  └─▶ mTLS interno
       └─▶ saúde, estados, histórico e diagnóstico
            sem capacidade de assinatura funcional
```

### 6.2 Contrato operacional mínimo

O contrato interno é tipado, versionado e distingue:

- comando de assinatura;
- comando de execução mTLS por finalidade;
- comando de diagnóstico;
- consulta de saúde;
- consulta de estado e histórico.

DTOs não possuem campo de URL arbitrária, caminho do Vault, PKCS#12, senha, chave privada ou token. Respostas HTTP de erro usam `application/problem+json`, com `type`, `title`, `status`, `code` e `correlationId`.

### 6.3 Persistência

Persistem somente:

- operação e seu estado;
- identidade, contexto e finalidade;
- hash do conteúdo;
- referência opaca do certificado;
- resultado sanitizado e código estável;
- latência e correlação;
- estados de diagnóstico;
- incidentes e notificações.

Registros de trilha são append-only. Estado corrente pode ser projeção derivada dos eventos, sem alterar ou apagar o histórico.

### 6.4 Dependências técnicas

- Node.js 24 e TypeScript estrito;
- APIs nativas de TLS/HTTPS do Node para PKCS#12 e mTLS;
- biblioteca de XMLDSig com suporte a RSA-SHA256, SHA-256 e verificação;
- HashiCorp Vault KV v2 persistente entregue pela F11;
- PostgreSQL com RLS para metadados e auditoria;
- Redis/fila existente para diagnóstico automático, retry do worker e monitoramento;
- dublês locais HTTPS mutuamente autenticados.

Dependência criptográfica nova exige justificativa explícita, versão fixada, análise de manutenção e testes contrafactuais. O Signer continua sendo a menor superfície de código do repositório.

## 7. Erros observáveis

| Situação | Resultado esperado |
|---|---|
| Identidade técnica ausente ou inválida | recusa antes do domínio, sem acesso ao Vault |
| API tenta assinatura funcional | acesso negado por alçada técnica |
| Tenant/empresa ausente ou cruzado | recusa sem metadado nem segredo |
| Finalidade não permitida | recusa sem assinatura nem saída de rede |
| Certificado ausente, vencido, futuro ou desativado | operação bloqueada com código específico |
| Responsável inválido | operação permitida; alerta e pendência da F11 permanecem |
| XML malformado ou alvo ambíguo | recusa criptográfica acionável |
| Falha de leitura no Vault | falha indisponível, sem fallback inseguro |
| Falha ao validar assinatura produzida | operação falha e não chama o dublê |
| Certificado do dublê inválido | conexão rejeitada; nunca desabilita validação |
| Timeout ou indisponibilidade do dublê | uma falha registrada; retry fica com o worker |
| Repetição idêntica com resultado terminal | resultado anterior reutilizado |
| Repetição após falha transitória | nova tentativa vinculada à mesma operação; dublê deduplica efeito pela mesma chave |
| Chave idempotente com contexto diferente | HTTP 409 com código estável |
| Teste pós-rotação falha | certificado continua vigente e estado operacional falha |
| Histórico indisponível | painel preserva último estado conhecido e informa desatualização |

## 8. Stack, comandos e estrutura

### 8.1 Comandos obrigatórios

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

### 8.2 Fronteiras esperadas

```text
apps/signer/             serviço isolado, criptografia, adaptadores e mTLS
apps/api/                consultas, autorização humana e diagnóstico
apps/workers/            comandos operacionais, retry, backoff e DLQ
apps/web/                card, coluna, painel e histórico operacional
packages/shared/         contratos tipados e códigos de erro
packages/db/             operações, estados, incidentes e trilha append-only
infra/docker/            rede privada, CA local, identidades e dublês mTLS
tests/banco/             RLS, isolamento, idempotência e append-only
tests/e2e/               fluxo real local, negações e ausência de vazamento
```

Estrutura interna exata é decisão do Code, desde que preserve essas fronteiras e não amplie a superfície autorizada.

## 9. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | catálogo de finalidades, condição do certificado, contexto, alçadas técnicas e transições de estado |
| Criptografia | XML DF-e/eSocial assinado e verificado; XML malformado, alvo ausente/ambíguo e assinatura inválida recusados |
| mTLS externo | dublês aceitam A1 correto e recusam ausência, certificado errado, CA não confiável e nome inválido |
| mTLS interno | worker autorizado opera; API só diagnostica; identidade ausente ou desconhecida falha |
| Vault | política read-only estreita, sem `list`, escrita ou leitura cruzada |
| Banco | RLS por tenant/empresa, append-only, idempotência, estados e incidentes |
| Idempotência | resultado terminal repetido não reassina nem chama dublê; falha transitória admite nova tentativa segura; conflito de conteúdo retorna 409 |
| Segurança | valor sentinela ausente de respostas, logs, traces, HTML, screenshots e artefatos |
| Diagnóstico | execução automática pós-cadastro/substituição e manual autorizada, separada por finalidade |
| Incidente | três falhas abrem uma notificação por administrador; novas falhas não duplicam; recuperação encerra e notifica |
| Tela | referência, CLARO/ESCURO, 768/1024/1440, teclado, foco, estados, paginação e filtros |
| E2E | cadastrar A1 de teste → diagnosticar duas finalidades → assinar/chamar dublê → repetir idempotente → consultar histórico |
| Contrafactual | outro tenant, fora da carteira, API tentando assinar, finalidade livre, certificado inválido, Vault/dublê indisponível e segredo sentinela |

## 10. Critérios de aceite verificáveis

- [ ] Signer não possui porta ou domínio público e só é alcançável pelas identidades técnicas autorizadas na rede privada.
- [ ] Worker autorizado assina XML DF-e e eSocial de teste e a assinatura produzida é validada.
- [ ] API consulta e diagnostica, mas não consegue executar assinatura funcional.
- [ ] Dublês locais comprovam mTLS e recusam clientes ou servidores não confiáveis.
- [ ] Somente DF-e e eSocial de teste são aceitos; URL e finalidade livres não existem no contrato.
- [ ] Vault permite ao Signer apenas leitura estreita e nega `list`, escrita e acesso cruzado.
- [ ] Certificado ausente, vencido, futuro ou desativado bloqueia; responsável inválido não bloqueia.
- [ ] Repetição com resultado terminal não reassina nem repete mTLS; falha transitória admite nova tentativa segura com a mesma chave; chave conflitante retorna 409.
- [ ] Signer faz uma tentativa externa por chamada e o worker controla retry/backoff.
- [ ] Cadastro ou substituição agenda diagnósticos DF-e/eSocial sem reverter vigência quando falham.
- [ ] Admin e contador da carteira executam teste manual; demais usuários respeitam a matriz da F8.
- [ ] DF-e e eSocial possuem estados independentes e o resumo usa o pior estado.
- [ ] Histórico registra sucessos, falhas, recusas e reutilizações, 15 por página, em ordem decrescente.
- [ ] Três falhas de saúde abrem um único incidente; recuperação encerra e notifica os mesmos administradores.
- [ ] Nenhum XML persistido, PKCS#12, senha, chave, token ou certificado de serviço aparece fora da fronteira autorizada.
- [ ] Valor sentinela não aparece em respostas, logs, traces, HTML, screenshots ou artefatos.
- [ ] Tela final restaura card, coluna e painel do Signer sem reintroduzir procuração, RLS ou falsas garantias produtivas.
- [ ] CLARO/ESCURO, teclado, foco, acessibilidade, estados e viewports 768, 1024 e 1440 px estão provados.
- [ ] A PR registra `frontend-design`, comparação visual e passe final de `impeccable`.
- [ ] CI executa e publica evidências vinculadas à SPEC-012 e à issue #14.

## 11. Limites

### Sempre fazer

- validar identidade técnica, tenant, empresa, finalidade e certificado antes de ler o segredo;
- manter destinos e algoritmos em configuração controlada por adaptador;
- validar a assinatura produzida antes da saída mTLS;
- registrar auditoria e correlação sem material sensível;
- usar somente certificados e CAs de teste no ambiente local;
- tratar falha de integração como falha, nunca como `pass`.

### Perguntar antes

- adicionar finalidade, algoritmo, formato ou destino;
- ampliar identidade técnica autorizada;
- permitir URL informada pelo chamador;
- alterar regra de idempotência, monitoramento ou destinatários;
- persistir XML ou resposta externa nesta fatia;
- incluir órgão oficial ou procuração.

### Nunca fazer

- expor PKCS#12, senha ou chave privada à API, worker, navegador ou usuário;
- gravar segredo em banco, arquivo temporário, fila, cache, log ou telemetria;
- conceder ao Signer escrita ou listagem ampla no Vault;
- aceitar TLS sem validação, CA universal ou `rejectUnauthorized: false`;
- usar somente a rede Docker como autenticação;
- transformar o Signer em proxy ou serviço de assinatura genérico;
- apresentar a prova local como produção, KMS/HSM ou homologação oficial.

## 12. Fora desta fatia e destino

| Item | Destino |
|---|---|
| Captura DF-e por NSU, resposta fiscal, lotes e `tempoMedio` | capacidade própria de captura DF-e do MVP-1 |
| Homologação oficial Sefaz | mesma capacidade de captura DF-e do MVP-1, antes de concluir sua integração externa |
| Integração funcional e homologação oficial eSocial | MVP-3, capacidade de integração eSocial |
| Procuração RFB/e-CAC, poderes e vigência | capacidade própria posterior do MVP-1, antes de fluxo que dependa da procuração |
| Persistência, retenção e download de XML fiscal | capacidades de captura e parse do MVP-1 |
| Manifestação fiscal com efeito jurídico | capacidades de Ciência automática e inbox HITL do MVP-1 |
| Testes mTLS periódicos por empresa | não entram nesta fatia; reavaliar na capacidade de captura DF-e se a operação demonstrar necessidade |
| Certificado A3 | permanece fora do produto conforme `docs/FORA-DE-ESCOPO.md` §3 |
| KMS/HSM, auto-unseal, alta disponibilidade, backup/restore e observabilidade produtivos | gate de produção posterior ao MVP-4 |
| Material criptográfico, identidades e operação produtivos | gate de produção posterior ao MVP-4, antes de qualquer piloto real |

## 13. Dúvidas resolvidas pelo PI

| Decisão | Resposta |
|---|---|
| Fronteira | assinatura XML e mTLS contra dublês locais |
| Interface | painel operacional completo dentro da tela do Cofre |
| Teste manual | admin e contador da carteira ativa |
| Assinatura pela interface | não; somente serviço interno |
| Finalidades | DF-e e eSocial de teste |
| Responsável inválido | permite uso e mantém alerta/pendência |
| Idempotência | repetição com resultado terminal reutiliza o resultado; falha transitória admite nova tentativa segura com a mesma chave |
| Retentativa | controlada pelo worker chamador |
| Histórico | últimas 15 por página, ordem decrescente, com sucessos, falhas e recusas |
| Indisponibilidade | alerta administradores; sem Central de Pendências |
| Recuperação | notifica os mesmos administradores |
| Canal interno | mTLS por identidade de serviço |
| Alçada técnica | worker opera; API diagnostica |
| Diagnóstico | automático após cadastro/substituição e manual |
| Falha pós-upload | mantém certificado vigente e alerta |
| Estados | separados por DF-e e eSocial; resumo usa o pior |
| Incidente | abre após três falhas consecutivas |
| Health check | a cada um minuto |
| Arquitetura | núcleo criptográfico comum e adaptadores por finalidade |
| Tamanho | Grande e atômica |

## 14. Questões abertas

Nenhuma.

## 15. Aprovação

- Fronteira, comportamento, arquitetura, interface, autorização, idempotência, monitoramento, auditoria, provas, destinos e tamanho aprovados pelo PI em 18/09/2026.
- Documento aprovado pelo PI; issue #14 criada em `proplan:backlog`.
