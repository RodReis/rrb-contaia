# SPEC-007 / F7 — Gestão de usuários e papéis padrão

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§4.3, 4.4 e 15
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande — identidade, convite, ciclo de vida, autorização padrão e auditoria formam uma entrega atômica; separar qualquer parte deixaria usuário ativo com acesso inconsistente ou sem prova de segurança
>
> **Dependências:** card `[INFRA]` e F1 / SPEC-001
>
> **Issue:** #9

## 1. Objetivo

Permitir que o `admin_escritorio` convide e administre usuários do próprio escritório, atribua um ou mais papéis padrão e aplique imediatamente o acesso correspondente, sem conceder acesso a empresas antes da futura atribuição de carteira.

Sucesso significa concluir em Docker local o fluxo convite → definição de senha → primeiro acesso, preservar o ciclo de vida e a auditoria do usuário e provar que papel, tenant e ausência de carteira são respeitados no servidor.

## 2. Fronteira da fatia

Esta fatia entrega:

- usuários adicionais do escritório;
- convite individual por e-mail;
- papéis padrão do MVP-1;
- atribuição de múltiplos papéis com permissões aditivas;
- ciclo de vida, revogação de sessão e auditoria;
- visualização somente leitura dos papéis padrão e suas permissões.

Papéis personalizados e seu editor de permissões foram separados para F8 / SPEC-008. Carteira e RLS de dois níveis permanecem em fatias próprias posteriores do MVP-1.

## 3. Comportamento esperado

### 3.1 Papéis padrão e autorização

Papéis disponíveis nesta fatia:

- `admin_escritorio`;
- `contador`;
- `auxiliar`;
- `auditor_readonly`.

Cada usuário possui um ou mais papéis. As permissões são aditivas: uma ação permitida por qualquer papel fica disponível, sempre limitada pelo tenant e, quando existir, pela carteira.

| Capacidade já entregue | `admin_escritorio` | `contador` | `auxiliar` | `auditor_readonly` |
|---|---|---|---|---|
| Cadastro do escritório | consultar e editar | — | — | consultar |
| Empresas | criar, consultar, editar, arquivar e reativar | criar, consultar, editar, arquivar e reativar | criar, consultar e editar | consultar |
| Documentos da empresa | administrar | administrar | administrar | consultar |
| Central de Pendências | administrar | administrar | administrar | consultar |
| Notificações de pendências | administrar | administrar | administrar | consultar |
| Histórico de Informações | consultar | consultar | — | consultar |
| Usuários e papéis padrão | administrar | — | — | consultar |

`Administrar` significa executar as ações mutáveis já previstas pela SPEC da capacidade, sem criar permissão que essa SPEC não concedeu.

O `admin_escritorio` é o único papel que convida e altera usuários. Deve existir ao menos um `admin_escritorio` ativo: o último administrador não pode remover esse papel, suspender-se nem arquivar-se.

Até a entrega da carteira, um novo usuário ativo acessa somente recursos sem escopo de empresa. Toda consulta empresarial retorna zero empresas e a interface informa ausência de alçada; nunca existe liberação temporária de toda a base.

### 3.2 Convite

O cadastro ocorre em wizard de duas etapas:

1. **Dados:** nome completo e e-mail obrigatórios; telefone e CRC opcionais.
2. **Papéis e revisão:** seleção obrigatória de ao menos um papel e confirmação do envio.

Regras:

- o e-mail é normalizado e único globalmente; no MVP-1 uma identidade pertence a um único escritório;
- o convite é individual, de uso único e válido por 48 horas;
- o usuário inicia em `CONVIDADO`;
- aceitar o convite define a senha no Keycloak e ativa o usuário;
- reenviar gera novo link e invalida imediatamente o anterior;
- convite vencido muda a apresentação para `CONVITE_EXPIRADO`, preservando cadastro e papéis para reenvio;
- antes da aceitação, o admin pode corrigir o e-mail; a correção invalida o link anterior e envia outro;
- depois da ativação, o e-mail não é alterado nesta fatia;
- link, token e credencial nunca aparecem na API administrativa, em logs ou na auditoria.

Falha de entrega do e-mail não apaga o usuário: a lista informa falha de envio e oferece `Reenviar`.

### 3.3 Ciclo de vida

```text
CONVIDADO ──aceite──▶ ATIVO ──suspender──▶ SUSPENSO
     │                  │                     │
     ├─48 h─▶ CONVITE_EXPIRADO               └─reativar──▶ ATIVO
     │                  │
     └────reenviar──────┘

ATIVO ou SUSPENSO ──arquivar──▶ ARQUIVADO
ARQUIVADO ──revisar dados e papéis + novo convite──▶ CONVIDADO
```

- usuário ativo precisa manter ao menos um papel;
- mudança de papel passa a valer na próxima requisição;
- suspensão e arquivamento desabilitam a identidade e encerram todas as sessões;
- reativação de usuário arquivado exige revisão de dados e papéis e novo convite;
- arquivamento nunca exclui identidade, perfil ou histórico.

### 3.4 Aplicação imediata

Keycloak mantém identidade, credencial, ação de definição de senha e sessões. PostgreSQL mantém perfil, `tenant_id`, estado, papéis atribuídos, revisão vigente da autorização e auditoria.

A API nunca confia somente em botão oculto ou em permissão antiga da sessão. Alterações sincronizam Keycloak e produto, e a próxima requisição consulta a revisão vigente. Falha de sincronização não pode deixar estado ou papel parcialmente aplicado.

### 3.5 Auditoria

O menu global **Histórico de Informações** recebe a aba `Usuários e acessos`, limitada ao tenant ativo e somente leitura.

Ela registra:

- convite criado, reenviado, aceito e expirado;
- e-mail de convite corrigido;
- dados e papéis alterados;
- suspensão e reativação;
- arquivamento e início de novo convite.

Cada evento contém data/hora, autor, usuário afetado, tipo e valores anterior/novo quando aplicável. Filtros: usuário afetado, autor, tipo de evento e período.

## 4. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-2` | consulta sem contexto de tenant não retorna usuário, papel, convite ou auditoria |
| `I-6` | eventos de usuários e acessos são append-only, sem edição ou exclusão |
| `I-11` | datas e horas de convite, acesso e auditoria são exibidas em `America/Sao_Paulo` |

## 5. Contrato de interface

Não existe protótipo específico de usuários. Por decisão do PI, as referências concretas são:

- shell claro, navegação e densidade: `docs/telas/contaia_configura_es_cofre_de_certificados_a1/`;
- shell escuro: `docs/telas/contaia_dashboard_multi_empresa_vis_o_de_riscos_tema_dark_carbon/`;
- navegação geral: `docs/telas/prototipo/`.

O conteúdo específico abaixo é normativo e não deve ser inferido de uma tela inexistente.

### 5.1 Área Usuários e permissões

Menu: `Configurações → Usuários e permissões`.

A página possui:

- aba `Usuários`: busca por nome/e-mail, filtros por status e papel, contagem total e paginação padrão;
- aba `Papéis e permissões`: quatro papéis padrão somente leitura, com módulos, funcionalidades e ações concedidas;
- colunas da lista: nome, e-mail, papéis, status e ações;
- ações do admin: convidar, editar dados/papéis, reenviar, suspender, reativar e arquivar;
- visualização do auditor sem ações de mutação nem dados técnicos do convite.

Criação usa o wizard `Dados` → `Papéis e revisão`. Edição usa as abas `Dados` e `Papéis`.

Suspensão, arquivamento e proteção do último admin usam `AlertDialog`, nomeiam o usuário e explicam o efeito sobre a sessão. Feedback usa Toast; `alert`, `confirm` e `prompt` são proibidos.

### 5.2 Estados obrigatórios

- carregando com Skeleton;
- lista vazia;
- filtro sem resultado;
- erro com `correlationId` copiável;
- sucesso;
- convite expirado;
- falha de envio;
- ausência de alçada;
- permissão insuficiente;
- proteção do último administrador;
- conteúdo longo, ações desabilitadas e sessão expirada.

A interface final existe em CLARO e ESCURO, opera por teclado, mantém foco visível e não depende somente de cor.

Viewports, responsividade, acessibilidade, comparação visual e provas seguem `FRONTEND.md` §20.1 em 768, 1024 e 1440 px. A implementação usa obrigatoriamente `frontend-design` antes e durante a construção e recebe o passe final de `impeccable`.

## 6. Erros observáveis

| Situação | Resultado esperado |
|---|---|
| E-mail já utilizado | `409 application/problem+json`; não revela outro tenant |
| Convite expirado ou já utilizado | rejeição do link e orientação para solicitar reenvio |
| Link anterior após reenvio/correção | rejeitado sem alterar usuário |
| Usuário sem papel | `422`; convite ou ativação não prossegue |
| Último admin tenta perder administração | `409`; nenhuma alteração aplicada |
| Auditor tenta mutação | `403`; nenhum dado alterado |
| Keycloak indisponível | nenhuma alteração parcial; erro com `correlationId` |
| Envio de e-mail falha | cadastro preservado; lista mostra falha e permite reenvio |
| Usuário sem carteira consulta empresa | resultado vazio/negado sem revelar empresa |
| Auditoria falha | mutação principal sofre rollback |

## 7. Dados e fluxo

```text
admin_escritorio
      │ wizard + papéis padrão
      ▼
API ───────────────▶ PostgreSQL
 │                    perfil + tenant + estado + papéis + revisão
 │
 ├───────────────▶ Keycloak local
 │                  identidade + ação de senha + sessões
 │
 ├───────────────▶ SMTP local controlado
 │                  convite de uso único
 │
 └───────────────▶ Histórico de Informações
                    evento append-only
```

## 8. Stack, comandos e estrutura

### 8.1 Stack aplicável

- Keycloak self-hosted em Docker local, via OIDC e API administrativa protegida.
- Next.js 16 e React 19 para lista, wizard, edição e catálogo de papéis.
- NestJS para casos de uso, autorização, integração de identidade e convite.
- PostgreSQL com Drizzle ORM para perfil, vínculos e auditoria.
- capturador SMTP local para prova determinística; entrega externa real não é requisito desta fatia.

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
apps/web/                 usuários, wizard, edição e papéis padrão somente leitura
apps/api/                 casos de uso, autorização e integração com Keycloak/SMTP
packages/domain/          estados, transições e política de papéis padrão
packages/db/              perfis, vínculos, revisão e auditoria append-only
tests/e2e/                convite, acesso, mudança de papel e revogação
```

Identificadores ficam em inglês; domínio, documentos, mensagens e interface permanecem em PT-BR. Entrada externa é `unknown` até validação; erros seguem `application/problem+json`.

## 9. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | transições; 48 horas; link único; permissões aditivas; papel obrigatório; último admin |
| Banco | tenant; e-mail único; vínculos; revisão; auditoria atômica e append-only |
| Integração | criar identidade; definir senha; sincronizar papéis; suspender; reativar; revogar sessões |
| Tela | lista, filtros, wizard, abas, catálogo somente leitura, estados, CLARO/ESCURO e viewports |
| E2E | convidar → capturar e-mail → definir senha → entrar sem carteira → alterar papel → suspender → negar sessão → reativar por novo convite |
| Contrafactual | outro tenant; link antigo; usuário sem papel; auditor mutando; último admin bloqueando-se; Keycloak indisponível |

SMTP externo, nuvem e comportamento produtivo são `not_run`, nunca `pass`.

## 10. Critérios de aceite

- [ ] Admin conclui wizard com dados válidos, ao menos um papel e revisão antes do envio.
- [ ] Convite local é individual, de uso único, válido por 48 horas e ativa o usuário após definição da senha.
- [ ] Reenvio ou correção do e-mail invalida o link anterior.
- [ ] Falha de envio preserva cadastro e oferece reenvio.
- [ ] Usuário aceita múltiplos papéis e recebe a união das permissões na próxima requisição.
- [ ] Papéis padrão aplicam exatamente a matriz aprovada no servidor e na interface.
- [ ] Usuário sem carteira não lê nenhuma empresa.
- [ ] Suspensão e arquivamento revogam todas as sessões.
- [ ] Usuário arquivado só retorna após revisão e novo convite.
- [ ] O último admin ativo não pode perder administração.
- [ ] Auditor consulta usuários, papéis e histórico sem executar mutação.
- [ ] Aba `Usuários e acessos` registra todos os eventos aprovados com antes/depois aplicável.
- [ ] Tenant divergente não é exposto e consulta sem tenant retorna vazio.
- [ ] Temas, estados, teclado, acessibilidade e viewports são provados conforme `FRONTEND.md` §20.1.
- [ ] CI executa e publica evidências das categorias aplicáveis.

## 11. Limites

### Sempre fazer

- validar tenant, estado, papéis e revisão de autorização no servidor;
- sincronizar identidade e produto sem estado parcial;
- revogar sessões em suspensão e arquivamento;
- registrar mutação e auditoria de forma atômica.

### Perguntar antes

- adicionar papel padrão, campo obrigatório, estado ou destinatário de convite;
- permitir que um e-mail pertença a mais de um escritório;
- mudar validade, canal ou fluxo do convite;
- alterar a matriz dos papéis padrão.

### Nunca fazer

- permitir usuário ativo sem papel;
- conceder todas as empresas enquanto não houver carteira;
- expor senha, token, link de convite ou dado de outro tenant;
- excluir fisicamente usuário ou auditoria;
- permitir que o último admin ativo elimine a administração do escritório.

## 12. Fora desta fatia e destino

| Item | Destino |
|---|---|
| Papéis personalizados, clonagem de papel padrão e matriz módulo/funcionalidade/ação | F8 / SPEC-008, próxima fatia do MVP-1 |
| Carteira do colaborador e atribuição de empresas | fatia própria posterior do MVP-1 |
| RLS de dois níveis e provas negativas completas | fatia própria posterior do MVP-1 |
| `gestor_financeiro` | MVP-2, junto ao módulo Financeiro |
| `dp` e `cliente_portal` | MVP-3, junto aos respectivos módulos |
| `super-admin`, convite de admin do tenant e impersonation | MVP-4 / RF-08 |
| Troca de e-mail após ativação | MVP-4 / RF-08, na gestão de usuários da plataforma e do tenant |
| MFA, federação e recuperação administrativa de credencial | MVP-4 / RF-08, na gestão de identidade da plataforma |
| Entrega externa real de e-mail e infraestrutura produtiva | gate de produção após o MVP-4 |

## 13. Dúvidas resolvidas pelo PI

| Decisão | Resposta |
|---|---|
| Fatiamento | F7 usuários e papéis padrão; F8 papéis personalizados |
| Administração | exclusiva de `admin_escritorio` |
| Papéis simultâneos | permitidos; permissões aditivas |
| Papéis disponíveis | admin, contador, auxiliar e auditor |
| Convite | e-mail, 48 horas, reenvio invalida anterior |
| Dados | nome e e-mail obrigatórios; telefone e CRC opcionais; sem CPF |
| Identidade multi-escritório | não no MVP-1 |
| Papel obrigatório | sim, antes do convite |
| Último admin | não pode perder administração, suspender-se ou arquivar-se |
| E-mail | corrigível antes do aceite; imutável depois da ativação nesta fatia |
| Ciclo | convidado, expirado, ativo, suspenso e arquivado; arquivado retorna por novo convite |
| Alteração de acesso | vale na próxima requisição; suspensão/arquivamento encerram sessões |
| Sem carteira | nenhuma empresa acessível |
| Histórico | nova aba global `Usuários e acessos` |
| Navegação | uma área com abas `Usuários` e `Papéis e permissões` |
| Novo cadastro | wizard em duas etapas |
| Edição | abas `Dados` e `Papéis` |
| Referência visual | usar shells existentes; não criar tela específica em `docs/telas/` |

## 14. Questões abertas

Nenhuma.

## 15. Aprovação

- Fronteira, autorização, interface, estados, dados, integração, falhas e provas aprovados pelo PI em 18/09/2026.
- Plano de consolidação documental aprovado pelo PI em 18/09/2026.
