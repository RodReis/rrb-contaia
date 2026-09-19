# SPEC-011 / F11 — Cofre local de certificados A1

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§4.5, 4.6, 15 e 16
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande — cofre persistente, ingestão isolada, rotação, autorização, alertas, pendências, auditoria e interface formam uma entrega atômica; separar a tela do armazenamento produziria uma falsa garantia de segurança
>
> **Dependências:** `[INFRA]` Fundação local (#8), F2 / SPEC-002, F3 / SPEC-003, F5 / SPEC-005, F6 / SPEC-006, F7 / SPEC-007, F8 / SPEC-008, F9 / SPEC-009 e F10 / SPEC-010
>
> **Issue:** #13

## 1. Objetivo

Permitir que o escritório vincule a cada empresa um certificado digital A1 de teste, validado e guardado em um cofre local persistente, sem expor arquivo, senha ou chave privada à API principal, ao navegador ou a usuários.

Sucesso significa cadastrar, substituir, desativar e acompanhar o certificado por uma interface final, provar a persistência e as políticas do cofre após reinício e demonstrar que nenhum caminho externo à fronteira do cofre consegue ler o segredo.

## 2. Fronteira da fatia

Esta fatia entrega:

- Vault local em modo servidor standalone, persistente e inicializado de forma repetível;
- ingestão isolada de certificados A1 de teste, com validação antes da gravação;
- metadados, estados e histórico por tenant e empresa;
- um único certificado vigente por empresa, com substituição atômica;
- desativação auditada sem exclusão física;
- responsável obrigatório, alertas de vencimento e pendências acionáveis;
- integração com a Central de Pendências, o sininho e o Histórico de Informações;
- tela final focada no cofre, derivada da referência aprovada;
- provas negativas de acesso e de vazamento de segredo.

O cofre recebe e conserva o material criptográfico. Esta fatia não usa a chave para assinar, não termina mTLS, não consulta órgão governamental e não implementa procuração RFB/e-CAC.

## 3. Comportamento esperado

### 3.1 Cadastro e validação

`admin_escritorio` ou `contador` autorizado escolhe empresa e responsável, envia um arquivo `.pfx` ou `.p12` de até 10 MB e informa a senha do contêiner.

O fluxo aceita somente certificado A1 de e-CNPJ ICP-Brasil cujo CNPJ corresponda exatamente à empresa selecionada. Antes de gravar, rejeita:

- extensão ou contêiner incompatível;
- arquivo maior que 10 MB;
- senha incorreta;
- certificado expirado ou ainda não vigente;
- certificado que não seja e-CNPJ A1 ICP-Brasil;
- CNPJ do titular diferente do CNPJ da empresa;
- responsável ausente, inativo ou sem autorização sobre a empresa.

A recusa não cria certificado, não altera o vigente e não conserva arquivo ou senha fora da fronteira de ingestão. O usuário recebe erro específico e acionável, sem detalhes criptográficos sensíveis.

### 3.2 Autorização

- `admin_escritorio` cadastra, substitui e desativa certificados de empresas do próprio tenant;
- `contador` executa as mesmas ações somente em empresas de sua carteira ativa;
- ambos podem ser escolhidos como responsáveis quando ativos e autorizados para a empresa;
- demais papéis não executam mutações; consulta de metadados segue o catálogo e a matriz de permissões da F8;
- usuário suspenso, arquivado, de outro tenant ou fora da carteira não acessa nem altera o registro protegido.

Permissão de produto, carteira e RLS continuam cumulativas. Nenhuma delas concede leitura do conteúdo criptográfico.

### 3.3 Um vigente e rotação

Cada empresa possui no máximo um certificado vigente.

Quando a empresa já tem um vigente, o novo certificado só o substitui depois que validação, gravação no cofre e persistência dos metadados terminarem com sucesso. A troca é atômica:

- sucesso torna o novo vigente e encerra a vigência operacional do anterior;
- falha em qualquer etapa mantém o anterior vigente e utilizável;
- o anterior permanece no histórico com data, usuário, motivo e referência da substituição;
- arquivo, senha e chave privada nunca são copiados para o histórico funcional.

### 3.4 Desativação

Admin ou contador autorizado pode desativar o certificado vigente sem enviar outro. A ação exige confirmação com a empresa identificada e motivo obrigatório.

A desativação:

- impede uso futuro daquele certificado;
- preserva metadados e trilha histórica;
- não apaga versão nem evento;
- deixa a empresa sem certificado vigente;
- cria ou reabre a pendência de certificado ausente.

Não existe download, restauração informal ou reativação do segredo desativado. Novo uso exige novo cadastro validado.

### 3.5 Responsável

Todo certificado vigente possui exatamente um responsável ativo, escolhido entre `admin_escritorio` e `contador` autorizado para a empresa.

Se o responsável for suspenso, arquivado ou perder a carteira:

- o certificado continua vigente;
- a responsabilidade fica inconsistente;
- administradores recebem alerta para escolher outro responsável;
- a Central de Pendências mostra a falta de responsável;
- a escolha de novo responsável encerra a pendência e gera evento de auditoria.

Não existe reatribuição automática.

### 3.6 Vencimento e notificações

O estado de validade é derivado da data civil do certificado. O responsável recebe notificação individual, uma única vez por marco:

- D-30;
- D-15;
- D-7;
- vencido.

Cada notificação abre o registro da empresa no cofre. Reprocessamento do job não duplica a notificação do mesmo marco. A lista mantém o estado atualizado mesmo após o usuário marcar a notificação como lida.

Vencimento próximo é alerta. Certificado ausente, vencido/desativado ou sem responsável é também pendência na Central de Pendências.

### 3.7 Histórico de Informações

A aba **Certificados** do Histórico de Informações, em ordem de data, registra:

- cadastro e substituição concluídos;
- desativação e motivo;
- troca ou perda de responsável;
- emissão dos marcos de alerta;
- tentativa recusada e código estável do motivo.

Cada evento contém tenant, empresa, usuário ou identidade técnica, data/hora, ação, resultado e `correlationId`. Nunca contém arquivo, senha, chave privada, token do Vault ou segredo de bootstrap.

## 4. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | metadados, versões, responsabilidades e eventos transacionais possuem `tenant_id` e `empresa_id` obrigatórios, indexados e sob RLS |
| `I-2` | consulta sem contexto não retorna metadado nem aceita mutação; outro tenant ou empresa permanece inacessível |
| `I-6` | histórico, recusas, alertas e mudanças de estado são append-only |
| `I-10` | chave privada existe somente dentro da fronteira do cofre e, na fatia futura, do Signer; API principal, navegador e outros serviços não conseguem lê-la |
| `I-11` | validade é data civil; upload, rotação, desativação e auditoria exibem data/hora em `America/Sao_Paulo` |

## 5. Contrato de interface

### 5.1 Referência e recorte

Referência principal:

- `docs/telas/contaia_configura_es_cofre_de_certificados_a1/screen.png`;
- `docs/telas/contaia_configura_es_cofre_de_certificados_a1/code.html`.

A F11 preserva shell, cabeçalho, hierarquia, densidade, cartões-resumo, área de upload, busca, filtros e tabela. Retira desta entrega:

- procuração RFB/e-CAC;
- painel, SQL e toggles de RLS;
- métricas, latência, teste mTLS e histórico de assinaturas do Signer;
- download do certificado;
- textos que afirmem KMS/HSM, produção ou integração externa já disponíveis.

### 5.2 Conteúdo e ações

A tela mostra somente metadados:

- empresa, CNPJ e regime;
- titular e autoridade certificadora;
- impressão digital truncada;
- início e fim da validade;
- estado do certificado;
- responsável;
- ações permitidas de cadastrar, substituir, trocar responsável e desativar.

O formulário possui empresa, arquivo, senha e responsável obrigatórios. O upload oferece seletor acessível e drag-and-drop, progresso, mostrar/ocultar senha, erro ligado ao campo e sucesso por Toast Sonner.

Busca, filtro de estado, ordenação e paginação são controlados pela URL e executados no servidor.

### 5.3 Estados obrigatórios

- carregando com skeleton;
- lista vazia;
- empresa sem certificado;
- válido;
- vence em D-30, D-15 ou D-7;
- vencido;
- desativado;
- sem responsável;
- erro de validação;
- falha do cofre;
- permissão insuficiente;
- conteúdo longo e lista paginada;
- sucesso de cadastro, substituição, troca de responsável e desativação.

Cor nunca é a única representação: todo estado possui texto e ação correspondente.

### 5.4 Temas, acessibilidade e prova visual

A implementação entrega CLARO e ESCURO, navegação completa por teclado, foco visível, rótulos acessíveis, anúncio de erro e progresso, e viewports de 768, 1024 e 1440 px.

São obrigatórios:

- `frontend-design` antes e durante a implementação;
- comparação renderizada com a referência e os contratos normativos;
- correção dos defeitos de `docs/design-system/DEBITO.md`, inclusive o falso dropzone sem `input[type=file]`;
- `impeccable` ao final para acabamento;
- provas de `docs/FRONTEND.md` §20.1 anexadas à PR.

## 6. Arquitetura e segurança

### 6.1 Vault local

O cofre usa HashiCorp Vault em modo servidor standalone, nunca modo `dev` como prova da fatia. Possui:

- storage persistente em volume próprio;
- KV v2 para versionamento técnico dos segredos;
- audit device persistente e redigido;
- healthcheck e dependências explícitas no Docker Compose;
- rede local sem exposição pública;
- políticas mínimas por identidade técnica.

O bootstrap é idempotente. Na primeira subida, inicializa, desbloqueia e configura mount, políticas e auditoria. Chaves e tokens ficam somente em volume local ignorado pelo Git. A CI usa material efêmero e nunca credencial fixa versionada.

Esse arranjo prova comportamento local com material de teste. Não equivale a KMS/HSM, alta disponibilidade, auto-unseal ou prontidão produtiva.

### 6.2 Fronteiras de acesso

```text
navegador
  └─▶ endpoint isolado do cofre
        ├─▶ valida PKCS#12 em memória
        ├─▶ grava segredo com credencial write-only
        └─▶ devolve somente metadados e referência opaca

API principal
  └─▶ PostgreSQL: metadados, estados, responsável e auditoria
      sem credencial de leitura do segredo

Signer futuro
  └─▶ política read-only por tenant, empresa e finalidade
      sem listagem ampla e sem devolver a chave
```

O receptor de upload pertence à fronteira do cofre. Não grava arquivo temporário em disco e não registra conteúdo ou senha. A API principal não recebe credencial capaz de ler o KV.

### 6.3 Contrato lógico mínimo

Metadados persistidos fora do Vault:

- identificador opaco;
- `tenant_id` e `empresa_id`;
- versão funcional;
- CNPJ e nome do titular;
- autoridade certificadora e cadeia ICP-Brasil validada;
- número de série e impressão digital segura para identificação;
- datas de início e fim da validade;
- estado e motivo da última transição;
- responsável;
- autor e instantes de criação, substituição ou desativação;
- referência opaca do segredo, nunca seu conteúdo.

Senha e PKCS#12 permanecem juntos no Vault para o futuro Signer. Nenhum DTO de leitura possui campos para retorná-los.

## 7. Erros observáveis

| Situação | Resultado esperado |
|---|---|
| Extensão, contêiner ou tamanho inválido | rejeição específica antes da gravação |
| Senha incorreta | rejeição sem revelar detalhes do conteúdo |
| Expirado ou ainda não vigente | rejeição com validade apresentada como metadado seguro |
| Não é e-CNPJ A1 ICP-Brasil | rejeição por tipo incompatível |
| CNPJ diferente | rejeição identificando a divergência sem guardar o arquivo |
| Outro tenant ou empresa fora da carteira | negação sem revelar segredo ou metadado indevido |
| Responsável inválido | cadastro bloqueado; certificado vigente anterior preservado |
| Falha ao gravar no Vault | operação revertida; certificado anterior continua vigente |
| Falha após gravar e antes de ativar | compensação segura remove/inutiliza a nova referência e preserva o anterior |
| Vault indisponível | erro estável com `correlationId`; nenhum fallback para banco, disco ou log |
| Tentativa de leitura pela API principal | Vault nega pela política e a prova registra ausência de conteúdo |
| Desativação sem motivo | ação bloqueada no domínio e na interface |

Respostas HTTP seguem `application/problem+json`, com `type`, `title`, `status`, `code` e `correlationId`, sem material sensível.

## 8. Stack, comandos e estrutura

### 8.1 Stack aplicável

- HashiCorp Vault standalone com KV v2 e audit device.
- Docker Compose local com volume e rede próprios.
- NestJS para casos de uso, metadados, autorização e integração com notificações/pendências.
- PostgreSQL com RLS para metadados e trilhas.
- Next.js, TanStack Query, React Hook Form e Zod para a interface.

### 8.2 Comandos de verificação

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

### 8.3 Estrutura lógica

```text
apps/web/                 tela, estados, formulário e provas visuais
apps/api/                 casos de uso, autorização, metadados e integrações
apps/cofre/               ingestão isolada e adapter do Vault
packages/db/              migrations, RLS e trilhas append-only
packages/domain/          validações, estados e transições puras
infra/docker/             Vault, volumes, rede, bootstrap e healthcheck
tests/banco/              isolamento, RLS, append-only e persistência
tests/e2e/                fluxo real, negações e ausência de vazamento
```

A estrutura é lógica; nomes físicos podem seguir os padrões existentes, preservando a fronteira isolada do cofre.

## 9. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | formato, tamanho, senha, vigência, e-CNPJ ICP-Brasil, CNPJ, responsável, transições e substituição atômica |
| Banco | RLS por tenant/empresa, carteira, um vigente, append-only, desativação e pendências |
| Vault | modo servidor, KV v2, persistência após reinício, bootstrap repetível, políticas de ingestão/API/Signer e audit device |
| Segurança | API e navegador sem leitura; logs/respostas/artefatos sem arquivo, senha, chave, token ou segredo de bootstrap |
| Notificações | D-30, D-15, D-7 e vencido, uma vez por marco e por certificado |
| Integrações internas | Central de Pendências e Histórico de Informações com abertura e resolução corretas |
| Tela | CLARO/ESCURO, 768/1024/1440 px, teclado, foco, drag-and-drop, estados e comparação com referência |
| E2E | cadastrar → substituir → reiniciar Vault → consultar metadados → desativar → confirmar pendência e histórico |
| Contrafactual | outro tenant, fora da carteira, usuário inativo, senha errada, CNPJ divergente, certificado futuro/expirado, Vault indisponível e falha no meio da troca |

O teste de segredo usa valor sentinela e falha se ele aparecer em resposta HTTP, HTML, log, relatório, screenshot, trace ou artefato da CI.

## 10. Critérios de aceite

- [ ] Vault roda em modo servidor standalone com storage e auditoria persistentes.
- [ ] Bootstrap local é idempotente e não versiona chave, token ou segredo.
- [ ] Reinício dos contêineres preserva o certificado de teste e as políticas.
- [ ] Somente `.pfx`/`.p12` de até 10 MB, e-CNPJ A1 ICP-Brasil, vigente e do mesmo CNPJ é aceito.
- [ ] Senha incorreta, arquivo inválido, certificado expirado/futuro, tipo ou CNPJ incompatível são rejeitados sem alterar o vigente.
- [ ] Existe no máximo um certificado vigente por empresa.
- [ ] Substituição é atômica e preserva a versão anterior no histórico.
- [ ] Desativação exige confirmação e motivo, não apaga o registro e cria pendência de certificado ausente.
- [ ] Admin atua no próprio tenant; contador atua somente na carteira; demais papéis não mutam o cofre.
- [ ] Responsável é obrigatório, ativo e autorizado; sua perda gera pendência sem derrubar o certificado.
- [ ] D-30, D-15, D-7 e vencido geram uma notificação individual por marco.
- [ ] Certificado ausente, vencido/desativado e sem responsável aparecem na Central de Pendências.
- [ ] Histórico de Informações registra sucessos e recusas em ordem de data.
- [ ] API principal, navegador, usuários e serviços não autorizados não leem PKCS#12, senha ou chave privada.
- [ ] Não existe download de certificado na API ou interface.
- [ ] Valor sentinela não aparece em respostas, logs, HTML, screenshots, traces ou artefatos.
- [ ] Tela final mantém a identidade da referência sem procuração, RLS ou Signer antecipados.
- [ ] CLARO/ESCURO, teclado, foco visível, estados e viewports 768, 1024 e 1440 px estão provados.
- [ ] A PR registra uso de `frontend-design`, comparação visual e passe final de `impeccable`.
- [ ] CI executa e publica evidências vinculadas à SPEC-011 e à issue #13.

## 11. Limites

### Sempre fazer

- validar integralmente antes de tornar o novo certificado vigente;
- manter segredo apenas na fronteira do cofre;
- preservar certificado anterior se a substituição falhar;
- registrar sucesso e recusa sem material sensível;
- falhar fechado sem tenant, empresa, carteira, permissão ou responsável válido;
- usar somente material criptográfico de teste durante os MVPs.

### Perguntar antes

- aceitar outro tipo, formato ou titular de certificado;
- permitir mais de um certificado vigente por empresa;
- conceder leitura do segredo a identidade diferente do Signer;
- alterar a cadência ou os destinatários dos alertas;
- incluir procuração no mesmo fluxo.

### Nunca fazer

- usar Vault em modo `dev` como prova da fatia;
- versionar chave de unseal, token root, senha ou certificado;
- gravar PKCS#12 ou senha em banco, arquivo temporário, fila, cache, log ou telemetria;
- devolver conteúdo, senha ou chave privada à API principal ou ao navegador;
- oferecer download do certificado;
- apagar versão ou trilha para simplificar rotação;
- apresentar o cofre local como KMS/HSM ou como pronto para produção.

## 12. Fora desta fatia e destino

| Item | Destino |
|---|---|
| Leitura do segredo, assinatura, término mTLS e chamadas à Sefaz/eSocial | próxima capacidade do MVP-1: Signer isolado e assinatura/mTLS simulada ou em homologação |
| Procuração RFB/e-CAC, poderes e vigência | capacidade própria posterior do MVP-1, antes do fluxo que depender da procuração |
| Cartão consolidado de certificado no dashboard multiempresa | F23 / SPEC-023, reutilizando estados e eventos da F11 |
| Certificado A3 | permanece fora do produto conforme `docs/FORA-DE-ESCOPO.md` §3 |
| KMS/HSM, auto-unseal, alta disponibilidade, backup/restore e observabilidade produtivos | gate de produção posterior ao MVP-4 |
| Material criptográfico e operação produtivos | gate de produção posterior ao MVP-4, antes de qualquer piloto real |

## 13. Dúvidas resolvidas pelo PI

| Decisão | Resposta |
|---|---|
| Fronteira | somente cofre A1; Signer e procuração em fatias próprias |
| Quantidade vigente | um certificado por empresa |
| Substituição | imediata depois da validação, com histórico do anterior |
| Papéis padrão | `admin_escritorio` e `contador`; contador limitado à carteira |
| Arquivo | `.pfx`/`.p12`, até 10 MB |
| Titularidade | somente e-CNPJ A1 ICP-Brasil com CNPJ igual ao da empresa |
| Responsável | obrigatório; admin ou contador ativo e autorizado |
| Responsável inativo | certificado continua vigente e gera pendência para administradores |
| Senha | guardada no cofre para uso futuro do Signer |
| Desativação | permitida com confirmação e motivo |
| Alertas | responsável recebe D-30, D-15, D-7 e vencido |
| Pendências | ausente, vencido/desativado e sem responsável |
| Auditoria | ações concluídas e recusadas, sem segredo |
| Tecnologia local | Vault standalone persistente, não modo `dev` |
| Inicialização | bootstrap local automático e idempotente; CI efêmera |
| Interface | tela focada no cofre, sem procuração, RLS ou Signer antecipados |
| Tamanho | Grande e atômica |

## 14. Questões abertas

Nenhuma.

## 15. Aprovação

- Fronteira, comportamento, arquitetura, interface, alertas, pendências, auditoria, provas, destinos e tamanho aprovados pelo PI em 18/09/2026.
- Documento aprovado pelo PI; issue #13 criada em `proplan:backlog`.
