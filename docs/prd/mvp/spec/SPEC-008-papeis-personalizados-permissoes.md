# SPEC-008 / F8 — Papéis personalizados e permissões

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§4.3, 4.4 e 15
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande — catálogo, editor hierárquico, aplicação imediata, ciclo de vida e auditoria formam uma política de autorização única; separar a matriz de sua aplicação deixaria papel configurável sem efeito verificável
>
> **Dependências:** F1 / SPEC-001 e F7 / SPEC-007
>
> **Issue:** #10

## 1. Objetivo

Permitir que o `admin_escritorio` crie papéis próprios do escritório a partir de um papel padrão, ajuste permissões por módulo, funcionalidade e ação e atribua esses papéis aos usuários sem alterar os papéis padrão.

Sucesso significa compor uma matriz válida com capacidades já entregues, aplicar sua revisão na próxima requisição, impedir concessões administrativas proibidas e preservar uma trilha auditável de todo o ciclo do papel.

## 2. Fronteira da fatia

Esta fatia entrega:

- catálogo controlado das permissões disponíveis no produto;
- criação de papel personalizado a partir de um papel padrão;
- edição independente da cópia, sem herança posterior;
- atribuição simultânea de papéis padrão e personalizados;
- arquivamento, revisão e reativação do papel;
- aplicação da autorização no servidor e auditoria das alterações.

Carteira por empresa e RLS de dois níveis continuam em fatias próprias posteriores do MVP-1. Até a carteira existir, a ausência de acesso empresarial definida na F7 continua prevalecendo para novos usuários.

## 3. Comportamento esperado

### 3.1 Identidade e criação

Somente `admin_escritorio` administra papéis personalizados do próprio tenant.

Cada papel possui:

- nome obrigatório, único no tenant sem diferenciar maiúsculas e minúsculas e renomeável;
- descrição opcional;
- papel padrão de origem: `admin_escritorio`, `contador`, `auxiliar` ou `auditor_readonly`;
- matriz própria de permissões;
- estado `ATIVO` ou `ARQUIVADO`;
- revisão monotônica da autorização.

O papel padrão apenas preenche a matriz inicial. Ao criar, o produto grava um snapshot independente: alterações futuras no padrão não modificam o papel personalizado, e alterações no personalizado nunca modificam o padrão.

Não existe rascunho. O papel nasce `ATIVO` somente quando nome e matriz completa são salvos atomicamente. A matriz precisa conter ao menos um módulo visível, uma funcionalidade consultável e uma permissão válida.

### 3.2 Catálogo controlado

O catálogo contém somente capacidades já entregues por SPEC aprovada e cresce com o produto. O administrador escolhe apenas permissões existentes; não cria módulo, funcionalidade ou ação livre.

Catálogo inicial da F8:

| Módulo | Funcionalidade | Ações elegíveis |
|---|---|---|
| Cadastro do escritório | Dados do escritório | Consultar, Editar |
| Empresas | Cadastro e ciclo de vida | Consultar, Criar, Editar, Arquivar, Reativar |
| Empresas | Histórico cadastral | Consultar |
| Documentos da empresa | Exigências | Consultar, Criar, Dispensar |
| Documentos da empresa | Arquivos e versões | Consultar, Enviar, Substituir, Visualizar, Baixar |
| Documentos da empresa | Análise documental | Consultar, Aprovar, Rejeitar |
| Documentos da empresa | Histórico documental | Consultar |
| Central de Pendências | Pendências | Consultar, Abrir origem |
| Notificações de pendências | Sino e histórico | Consultar, Marcar como lida |
| Histórico de Informações | Histórico global | Consultar |
| Usuários e permissões | Usuários e papéis | exclusivo do papel padrão `admin_escritorio`; visível e bloqueado no editor |

`Abrir origem` apenas navega para a funcionalidade que resolve a pendência e revalida sua autorização; não cria uma resolução paralela na Central.

Cada ação é uma chave estável do produto. Renomear seu texto de interface não cria uma permissão nova. Capacidade ainda não entregue não aparece no catálogo e não pode ser concedida antecipadamente.

### 3.3 Regras da matriz

- Módulo não visível não expõe navegação, rota nem conteúdo de suas funcionalidades.
- Módulo visível exige ao menos uma funcionalidade com `Consultar`.
- `Criar`, `Editar`, `Arquivar`, `Reativar`, `Dispensar`, `Enviar`, `Substituir`, `Visualizar`, `Baixar`, `Aprovar`, `Rejeitar`, `Abrir origem` e `Marcar como lida` implicam `Consultar` na respectiva funcionalidade.
- Conceder ação dependente concede `Consultar` automaticamente.
- Retirar `Consultar` revoga as ações dependentes da funcionalidade.
- Ocultar módulo com permissões marcadas informa quantas serão removidas, exige confirmação e revoga toda a subárvore.
- Áreas exclusivas do `admin_escritorio` permanecem bloqueadas, mesmo quando esse papel padrão foi escolhido como origem.
- A matriz pode adicionar ou retirar qualquer permissão elegível em relação à base.

### 3.4 Permissão efetiva e aplicação

Um usuário pode receber múltiplos papéis padrão e personalizados. Sua permissão efetiva é a união aditiva das matrizes, sempre limitada pelo tenant, estado do usuário e, quando entregue, carteira da empresa.

Retirar uma permissão de um papel não nega uma ação ainda concedida por outro papel do usuário. A interface de confirmação informa os usuários vinculados afetados pelo papel alterado, sem afirmar perda efetiva quando outro papel ainda concede a mesma ação.

Toda mudança bem-sucedida incrementa a revisão do papel e vale na próxima requisição. A API consulta a revisão vigente e não confia em botão oculto, rota de frontend ou autorização antiga da sessão.

### 3.5 Edição, arquivamento e reativação

- Nome, descrição e matriz de papel ativo podem ser alterados.
- Redução de permissões em papel atribuído mostra a quantidade de usuários vinculados, exige confirmação e aplica matriz e auditoria atomicamente.
- Papel atribuído a qualquer usuário não pode ser arquivado; o admin deve remover ou substituir todos os vínculos antes.
- Arquivamento preserva definição, origem, revisões e histórico e impede nova atribuição.
- Reativação abre revisão obrigatória da matriz preservada contra o catálogo vigente.
- Permissão que deixou de existir no catálogo não pode ser restaurada; a revisão informa a incompatibilidade e exige confirmação da matriz válida.
- Reativar não restaura vínculos antigos com usuários.
- Papel personalizado nunca é excluído fisicamente.

### 3.6 Auditoria

O menu global **Histórico de Informações**, aba `Usuários e acessos`, registra:

- papel criado e origem utilizada;
- nome ou descrição alterados;
- matriz alterada, com permissões adicionadas e retiradas;
- papel arquivado e reativado;
- incompatibilidades removidas durante a reativação.

Cada evento bem-sucedido contém data/hora, autor, papel, tipo, revisão e valores anterior/novo quando aplicável. Eventos de atribuição e retirada do papel em usuários seguem a auditoria da F7. Nenhum evento desta fatia gera sino ou e-mail no MVP-1.

## 4. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-2` | consulta sem contexto de tenant não retorna papel, catálogo, vínculo ou auditoria |
| `I-6` | revisões e eventos de papéis e permissões são append-only, sem edição ou exclusão |
| `I-11` | datas e horas do ciclo e da auditoria são exibidas em `America/Sao_Paulo` |

## 5. Contrato de interface

Não existe protótipo específico de papéis. Permanecem as referências concretas aprovadas na F7:

- shell claro, navegação e densidade: `docs/telas/contaia_configura_es_cofre_de_certificados_a1/`;
- shell escuro: `docs/telas/contaia_dashboard_multi_empresa_vis_o_de_riscos_tema_dark_carbon/`;
- navegação geral: `docs/telas/prototipo/`.

O conteúdo abaixo é normativo e não deve ser inferido de uma tela inexistente.

### 5.1 Lista

Caminho: `Configurações → Usuários e permissões → Papéis e permissões`.

A aba contém:

- seção `Papéis padrão`, somente leitura;
- seção `Papéis personalizados`, com busca por nome, filtro de status, contagem e paginação padrão;
- filtro inicial `Ativos`; `Arquivados` é seleção explícita;
- nome, descrição, base original, status, quantidade de usuários e ações permitidas;
- ações `Criar papel`, `Editar`, `Arquivar` e `Reativar` somente para `admin_escritorio`.

### 5.2 Criação e edição

A criação abre página dedicada em wizard:

1. `Identificação e base`;
2. `Permissões`;
3. `Revisão e criação`.

A edição abre página dedicada com abas:

- `Resumo`: nome, descrição, base original, estado, revisão e usuários vinculados;
- `Permissões`: matriz editável.

A matriz usa módulos expansíveis, funcionalidades agrupadas e ações elegíveis. Área exclusiva usa cadeado, texto explicativo e controles desabilitados. A revisão mostra diferenças em relação ao estado anterior ou, na criação, ao molde selecionado.

Redução em massa, ocultação de módulo, arquivamento e reativação usam `AlertDialog` com impacto explícito. Feedback usa Toast; `alert`, `confirm` e `prompt` são proibidos.

### 5.3 Estados obrigatórios e provas

- carregando com Skeleton;
- lista vazia;
- filtro sem resultado;
- erro com `correlationId` copiável;
- sucesso;
- nome duplicado;
- matriz inválida ou sem permissão;
- permissão insuficiente;
- papel atribuído impedindo arquivamento;
- confirmação de redução de acesso;
- catálogo incompatível na reativação;
- conteúdo longo, ações desabilitadas e sessão expirada.

A interface final existe em CLARO e ESCURO, opera por teclado, mantém foco visível e não depende somente de cor.

Viewports, responsividade, acessibilidade, comparação visual e provas seguem `FRONTEND.md` §20.1 em 768, 1024 e 1440 px. A implementação usa obrigatoriamente `frontend-design` antes e durante a construção e recebe o passe final de `impeccable`.

## 6. Erros observáveis

| Situação | Resultado esperado |
|---|---|
| Nome duplicado no tenant | `409 application/problem+json`; nenhuma alteração |
| Matriz sem permissão válida | `422`; papel não é criado ou atualizado |
| Ação inexistente no catálogo | `422`; não aceita chave livre ou obsoleta |
| Área exclusiva selecionada | `403`; nenhuma concessão aplicada |
| Papel atribuído é arquivado | `409`; retorna quantidade de vínculos, sem arquivar |
| Revisão concorrente | `409`; informa desatualização e exige recarga |
| Reativação com permissão obsoleta | revisão obrigatória; incompatibilidade não é restaurada |
| Usuário sem administração tenta mutação | `403`; nenhum dado alterado |
| Tenant divergente | negação sem revelar papel, usuário ou permissão |
| Auditoria falha | mutação principal sofre rollback |

## 7. Dados e fluxo

```text
admin_escritorio
      │ base + identificação + matriz
      ▼
Editor ──▶ API ──▶ catálogo vigente
                 │
                 ├─▶ papel + snapshot + revisão + vínculos
                 │
                 └─▶ Histórico de Informações append-only

requisição do usuário
      └─▶ tenant + estado + revisões dos papéis
             └─▶ união de permissões ──▶ permitir ou negar
```

Contrato lógico mínimo:

- papel: tenant, nome normalizado, descrição, origem, estado e revisão atual;
- permissão: módulo, funcionalidade e ação por chave estável;
- snapshot: conjunto integral da matriz em uma revisão;
- vínculo: usuário e papel dentro do mesmo tenant;
- evento: autor, papel, tipo, revisão, antes/depois e data/hora.

## 8. Stack, comandos e estrutura

### 8.1 Stack aplicável

- Next.js 16 e React 19 para lista, wizard, resumo e matriz.
- NestJS para catálogo, casos de uso e decisão de autorização.
- PostgreSQL com Drizzle ORM para papéis, snapshots, vínculos, revisões e auditoria.
- Keycloak continua responsável por identidade e sessões; a matriz funcional pertence ao produto e não é cadastrada como papel livre no Keycloak.

### 8.2 Comandos de verificação

```bash
pnpm lint
pnpm typecheck
pnpm test:regras
pnpm test:banco
pnpm test:tela
pnpm test:e2e
pnpm build
```

### 8.3 Estrutura lógica

```text
apps/web/                 lista, wizard, resumo e matriz de permissões
apps/api/                 catálogo, casos de uso e autorização
packages/domain/          papéis, revisões e composição aditiva
packages/db/              snapshots, vínculos e auditoria append-only
tests/e2e/                criação, atribuição, redução, arquivo e reativação
```

Identificadores ficam em inglês; domínio, documentos, mensagens e interface permanecem em PT-BR. Entrada externa é `unknown` até validação; erros seguem `application/problem+json`.

## 9. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | nome único; snapshot independente; dependência de Consultar; módulo; união aditiva; estados |
| Banco | tenant; revisão monotônica; snapshot integral; vínculos; atomicidade; append-only |
| API | catálogo permitido; próxima requisição; área exclusiva; concorrência; negações |
| Tela | lista; filtros; wizard; abas; matriz; confirmações; estados; CLARO/ESCURO; viewports |
| E2E | criar de cada base → atribuir → provar acesso → reduzir → provar negação → desatribuir → arquivar → revisar → reativar |
| Contrafactual | outro tenant; ação livre; área exclusiva; papel em uso; matriz vazia; revisão concorrente; permissão obsoleta |

## 10. Critérios de aceite

- [ ] Admin cria papel ativo pelo wizard com nome único, descrição opcional, base e matriz válida.
- [ ] Cópia permanece independente de mudanças posteriores no papel padrão.
- [ ] Catálogo contém somente módulos, funcionalidades e ações já entregues.
- [ ] Ações dependentes concedem `Consultar`; retirar `Consultar` revoga suas dependentes.
- [ ] Ocultar módulo revoga toda sua subárvore somente após confirmação.
- [ ] Área exclusiva de usuários e papéis aparece bloqueada e não pode ser concedida.
- [ ] Papéis padrão e personalizados compõem permissões de forma aditiva.
- [ ] Alteração válida passa a valer na próxima requisição e incrementa a revisão.
- [ ] Redução informa usuários vinculados afetados e exige confirmação.
- [ ] Papel atribuído não pode ser arquivado.
- [ ] Reativação exige revisão do catálogo e não restaura vínculos antigos.
- [ ] Eventos aprovados aparecem em `Usuários e acessos` com antes/depois aplicável.
- [ ] Tenant divergente não é exposto e consulta sem tenant retorna vazio.
- [ ] Temas, estados, teclado, acessibilidade e viewports são provados conforme `FRONTEND.md` §20.1.
- [ ] CI executa e publica evidências das categorias aplicáveis.

## 11. Limites

### Sempre fazer

- validar tenant, estado, revisão, catálogo e união de papéis no servidor;
- persistir matriz e auditoria atomicamente;
- preservar snapshots e histórico;
- confirmar toda redução que atinja papel vinculado.

### Perguntar antes

- adicionar ação, funcionalidade ou módulo ao catálogo fora de uma SPEC entregue;
- liberar gestão de usuários ou papéis para papel personalizado;
- mudar composição aditiva, estados ou regra de arquivamento;
- criar notificação ou canal para mudança de acesso.

### Nunca fazer

- permitir nome duplicado no tenant;
- criar papel ativo sem permissão válida;
- aceitar chave de permissão livre;
- propagar mudança do papel padrão para cópia existente;
- excluir papel, snapshot ou evento fisicamente;
- confiar somente na interface para autorizar ação.

## 12. Fora desta fatia e destino

| Item | Destino |
|---|---|
| Carteira do colaborador e atribuição de empresas | fatia própria posterior do MVP-1 |
| RLS de dois níveis e provas negativas completas | fatia própria posterior do MVP-1 |
| `gestor_financeiro` e permissões do Financeiro | MVP-2, junto ao módulo Financeiro |
| `dp` e `cliente_portal` | MVP-3, junto aos respectivos módulos |
| Notificação por sino, e-mail ou canal externo sobre mudança de acesso | MVP-3, junto aos canais ativos, se priorizada pelo PI |
| `super-admin`, convite de admin do tenant e impersonation | MVP-4 / RF-08 |
| Linguagem livre de políticas, condições dinâmicas e negação explícita | MVP-4 / RF-08, se priorizada pelo PI |
| Infraestrutura produtiva | gate de produção após o MVP-4 |

## 13. Dúvidas resolvidas pelo PI

| Decisão | Resposta |
|---|---|
| Modelo | snapshot controlado pelo catálogo |
| Base | um papel padrão; apenas molde inicial |
| Ajuste | adicionar e remover qualquer permissão elegível |
| Nome | obrigatório, único no tenant, sem diferenciar caixa e renomeável |
| Descrição | opcional |
| Publicação | ativo ao salvar matriz completa; sem rascunho |
| Níveis | módulo, funcionalidade e ação |
| Ações | catálogo controlado por funcionalidade |
| Dependências | ação mutável implica Consultar |
| Módulo oculto | revoga permissões internas após confirmação |
| Área exclusiva | visível e bloqueada no editor |
| Redução | mostra usuários vinculados, confirma e aplica na próxima requisição |
| Arquivamento | bloqueado enquanto houver usuário atribuído |
| Reativação | preserva matriz para revisão; não restaura vínculos |
| Notificação | somente histórico no MVP-1 |
| Lista | ativos por padrão; arquivados por filtro |
| Organização | seções Papéis padrão e Papéis personalizados |
| Criação | página dedicada, wizard em três etapas |
| Edição | página dedicada com abas Resumo e Permissões |

## 14. Questões abertas

Nenhuma.

## 15. Aprovação

- Fronteira, autorização, ciclo, interface, estados, auditoria, falhas e provas aprovados pelo PI em 18/09/2026.
- Documento consolidado para publicação direta na `main` por autorização do PI em 18/09/2026.
