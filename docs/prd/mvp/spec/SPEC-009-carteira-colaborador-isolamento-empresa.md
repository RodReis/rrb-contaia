# SPEC-009 / F9 — Carteira do colaborador e isolamento por empresa

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§4.3, 4.4, 4.6 e 15
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande — gestão individual e em lote, aplicação da alçada, três pontos de interface, notificação e auditoria precisam formar uma entrega atômica; separar a administração de sua decisão de acesso deixaria um caminho sem prova de segurança
>
> **Dependências:** F2 / SPEC-002, F3 / SPEC-003, F6 / SPEC-006, F7 / SPEC-007 e F8 / SPEC-008
>
> **Issue:** #11

## 1. Objetivo

Permitir que o `admin_escritorio` distribua as empresas do escritório entre as carteiras dos colaboradores e fazer com que cada usuário opere somente as empresas atribuídas, conforme as permissões resultantes de seus papéis.

Sucesso significa administrar vínculos individualmente e em lote, refletir adições e remoções na próxima requisição, bloquear no servidor o acesso fora da carteira, registrar toda alteração e avisar cada colaborador afetado sem gerar ruído por empresa.

## 2. Fronteira da fatia

Esta fatia entrega:

- carteira individual por usuário, com uma empresa vinculável a vários colaboradores;
- Central de Carteiras orientada a colaboradores;
- atribuição e remoção individual ou em lote;
- aplicação da carteira em toda leitura e ação empresarial já entregue;
- autoatribuição ao `admin_escritorio` que cria a empresa;
- ciclo dos vínculos conforme estados do usuário e da empresa;
- notificação consolidada por colaborador afetado;
- histórico global append-only das alterações.

A carteira define **em quais empresas** o usuário atua. Papéis padrão e personalizados continuam definindo **o que** ele pode fazer. Uma condição não substitui a outra.

As políticas PostgreSQL de RLS em dois níveis e a cobertura negativa de todas as tabelas sensíveis pertencem à capacidade própria seguinte do MVP-1. Nesta fatia, a decisão de acesso empresarial já é obrigatória no servidor; nunca é apenas ocultação de interface.

## 3. Comportamento esperado

### 3.1 Administração e composição

Somente `admin_escritorio` administra carteiras do próprio tenant.

- uma empresa pode pertencer simultaneamente à carteira de vários colaboradores;
- um colaborador pode ter zero ou várias empresas;
- usuário ativo sem carteira vê zero empresas e uma orientação de ausência de alçada;
- permissões dos papéis são aditivas, mas nenhuma delas concede acesso operacional a empresa fora da carteira;
- adição ou remoção válida passa a valer na próxima requisição;
- a interface nunca é a fonte da autorização.

O `admin_escritorio` também fica limitado à própria carteira nos módulos e dados operacionais. A Central de Carteiras, por ser a área administrativa da alçada, permite que ele localize e atribua qualquer empresa do tenant, mesmo fora de sua carteira. Essa visibilidade administrativa não libera os demais dados nem ações da empresa.

Ao criar uma empresa, o `admin_escritorio` criador é incluído automaticamente em sua carteira na mesma transação da ativação. A empresa pode depois ser removida de sua carteira pelas regras normais.

### 3.2 Atribuição individual e em lote

A gestão aceita:

- um colaborador e várias empresas;
- vários colaboradores e uma ou várias empresas;
- adição e remoção de vínculos existentes.

Toda operação mostra uma revisão com colaboradores, empresas e efeito pretendido antes de salvar. A remoção, individual ou em lote, sempre exige confirmação explícita.

O lote é atômico: usuário, empresa, tenant, estado ou revisão inválidos fazem a operação inteira falhar. Nenhum vínculo válido é aplicado parcialmente. Repetir uma adição já existente ou a remoção de vínculo ausente não duplica evento nem altera a revisão.

### 3.3 Ciclo do usuário

- `CONVIDADO` e `CONVITE_EXPIRADO` podem receber carteira antes da ativação;
- `ATIVO` exerce o acesso correspondente na próxima requisição;
- `SUSPENSO` preserva os vínculos, mas não acessa nenhuma empresa;
- reativar usuário suspenso volta a considerar os vínculos preservados;
- arquivar usuário encerra seus vínculos ativos e mantém o histórico;
- reativar usuário arquivado, conforme F7, não restaura a carteira anterior; exige nova atribuição.

### 3.4 Ciclo da empresa

- somente empresa ativa pode receber novo vínculo;
- arquivar empresa encerra todos os vínculos ativos e preserva o histórico;
- empresa arquivada não aparece como opção de atribuição;
- reativar empresa não restaura a carteira anterior; exige nova atribuição;
- a autoatribuição aplica-se à criação, não à reativação.

### 3.5 Decisão de acesso

Toda consulta ou mutação empresarial já entregue valida, no servidor:

1. tenant da sessão;
2. estado ativo do usuário;
3. vínculo ativo da empresa na carteira;
4. permissão da ação resultante dos papéis.

Empresa do mesmo tenant fora da carteira retorna `403 application/problem+json`, informa nome e CNPJ e declara falta de acesso; nenhum outro dado ou ação empresarial é liberado. Empresa, usuário ou vínculo de outro tenant é negado sem revelar sua existência ou seus dados.

### 3.6 Notificação e histórico

Cada operação bem-sucedida gera uma notificação individual consolidada para cada colaborador afetado, contendo o resumo das empresas adicionadas e removidas naquela operação. Não existe uma notificação separada por vínculo.

O sino e o histórico de notificações seguem F6 / SPEC-006. O aviso leva à carteira do próprio colaborador. Mudanças de papel ou matriz de permissões continuam sem sino nesta fatia.

O menu global **Histórico de Informações**, aba `Carteiras`, registra:

- atribuição individual e em lote;
- remoção individual e em lote;
- autoatribuição pela criação da empresa;
- encerramento de vínculos pelo arquivamento do usuário ou da empresa.

Cada evento contém data/hora, autor, origem individual ou lote, colaboradores afetados, empresas adicionadas/removidas e revisão. Histórico e vínculo são persistidos atomicamente; falha no histórico ou na criação das notificações desfaz toda a operação.

## 4. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | o vínculo transacional de carteira possui `tenant_id` e `empresa_id`, ambos obrigatórios, indexados e preparado para a RLS da capacidade seguinte |
| `I-2` | consulta sem contexto de tenant não retorna carteira, vínculo, empresa ou histórico |
| `I-6` | eventos de atribuição, remoção e encerramento são append-only, sem edição ou exclusão |
| `I-11` | datas e horas de alteração, notificação e histórico são exibidas em `America/Sao_Paulo` |

## 5. Contrato de interface

Não existe protótipo específico de carteira. As referências concretas são:

- shell claro, navegação e densidade: `docs/telas/contaia_configura_es_cofre_de_certificados_a1/`;
- shell escuro: `docs/telas/contaia_dashboard_multi_empresa_vis_o_de_riscos_tema_dark_carbon/`;
- navegação geral: `docs/telas/prototipo/`.

O conteúdo abaixo é normativo e não deve ser inferido de uma tela inexistente.

### 5.1 Central de Carteiras

Caminho: `Configurações → Usuários e permissões → Central de Carteiras`.

A lista principal é orientada a colaboradores e mostra:

- nome e e-mail;
- papéis;
- status;
- quantidade de empresas;
- ação `Gerenciar carteira`.

Há busca por nome ou e-mail, filtros por papel, status do colaborador e situação da carteira (`Sem empresas` ou `Com empresas`), contagem total e paginação padrão. O filtro inicial mostra colaboradores ativos; arquivados dependem de seleção explícita.

Selecionar vários colaboradores habilita `Adicionar empresas` e `Remover empresas`. A revisão nomeia os colaboradores, lista ou resume as empresas conforme o volume e informa o efeito antes de salvar.

### 5.2 Gestão individual e visões contextuais

`Gerenciar carteira` abre página dedicada com empresas disponíveis e atribuídas, busca por nome/CNPJ, filtros de status, seleção múltipla e resumo antes de salvar.

- o detalhe do usuário possui aba `Carteira`;
- o detalhe da empresa possui aba `Colaboradores`;
- as duas visões oferecem o mesmo resultado de autorização e respeitam a exclusividade do `admin_escritorio` para mutações;
- usuário sem administração vê somente os próprios vínculos quando a rota fizer parte de sua navegação autorizada.

Remoção usa `AlertDialog` com impacto explícito. Feedback usa Toast; `alert`, `confirm` e `prompt` são proibidos.

### 5.3 Estados obrigatórios e provas

- carregando com Skeleton;
- lista vazia;
- filtro sem resultado;
- erro com `correlationId` copiável;
- sucesso;
- colaborador sem carteira;
- empresa sem colaboradores;
- empresa arquivada indisponível para atribuição;
- permissão insuficiente;
- conflito concorrente;
- lote inválido sem aplicação parcial;
- confirmação de remoção;
- conteúdo longo, ações desabilitadas e sessão expirada.

A interface final existe em CLARO e ESCURO, opera por teclado, mantém foco visível e não depende somente de cor.

Viewports, responsividade, acessibilidade, comparação visual e provas seguem `FRONTEND.md` §20.1 em 768, 1024 e 1440 px. A implementação usa obrigatoriamente `frontend-design` antes e durante a construção e recebe o passe final de `impeccable`.

## 6. Erros observáveis

| Situação | Resultado esperado |
|---|---|
| Empresa do tenant fora da carteira | `403`; mostra nome e CNPJ e não libera outros dados ou ações |
| Empresa, usuário ou vínculo de outro tenant | negação sem revelar existência ou dados |
| Usuário sem administração tenta alterar carteira | `403`; nenhum vínculo muda |
| Empresa arquivada é selecionada | `422`; lote inteiro rejeitado |
| Usuário arquivado é selecionado | `422`; lote inteiro rejeitado |
| Revisão concorrente | `409`; informa desatualização e exige recarga |
| Item inválido em lote | `422`; lista os problemas e nenhuma alteração é aplicada |
| Auditoria ou notificação falha | operação inteira sofre rollback |
| Usuário ativo sem carteira | lista empresarial vazia com orientação de ausência de alçada |

## 7. Dados e fluxo

```text
admin_escritorio
      │ colaboradores + empresas + operação
      ▼
Central/abas ──▶ API ──▶ valida tenant, estados e revisão
                           │
                           ├─▶ vínculos de carteira
                           ├─▶ Histórico de Informações append-only
                           └─▶ uma notificação por colaborador afetado

requisição empresarial
      └─▶ tenant + usuário ativo + carteira + união dos papéis
             ├─▶ permitido: executa a ação
             └─▶ negado: 403 conforme origem do registro
```

Contrato lógico mínimo:

- vínculo: tenant, empresa, usuário, estado, revisão, criado por e data/hora;
- revisão de carteira: monotônica por usuário, usada no controle concorrente;
- evento: autor, origem, colaboradores, empresas adicionadas/removidas e data/hora;
- notificação: destinatário, operação, resumo consolidado e vínculo com a carteira.

## 8. Stack, comandos e estrutura

### 8.1 Stack aplicável

- Next.js 16 e React 19 para Central de Carteiras e abas contextuais.
- NestJS para casos de uso, autorização e aplicação atômica dos lotes.
- PostgreSQL com Drizzle ORM para vínculos, revisões, notificações e auditoria.
- Keycloak continua responsável por identidade e sessões; carteira e decisão de alçada pertencem ao produto.

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
apps/web/                 Central de Carteiras e abas contextuais
apps/api/                 casos de uso, consulta e decisão de alçada
packages/domain/          vínculos, revisão, lote e composição com papéis
packages/db/              persistência, atomicidade e auditoria append-only
tests/e2e/                atribuição, remoção, ciclo e negações
```

Identificadores ficam em inglês; domínio, documentos, mensagens e interface permanecem em PT-BR. Entrada externa é `unknown` até validação; erros seguem `application/problem+json`.

## 9. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | empresa compartilhada; usuário sem carteira; ciclo de usuário/empresa; autoatribuição; composição carteira + papéis |
| Banco | tenant e empresa obrigatórios; unicidade do vínculo ativo; revisão concorrente; lote, histórico e notificações atômicos; append-only |
| API | próxima requisição; Central global do admin; 403 fora da carteira; negação entre tenants; lotes inválidos |
| Tela | lista, filtros, seleção em lote, página dedicada, abas, confirmações, estados, CLARO/ESCURO e viewports |
| E2E | criar empresa → autoatribuir → compartilhar → provar acesso → remover → provar negação → arquivar/reativar → exigir nova atribuição |
| Contrafactual | usuário sem papel; papel sem ação; usuário suspenso/arquivado; empresa arquivada; outro tenant; revisão concorrente; lote parcialmente inválido |

## 10. Critérios de aceite

- [ ] Admin administra carteiras individualmente e em lote pela central orientada a colaboradores.
- [ ] Uma empresa pode pertencer a vários colaboradores e um colaborador pode ficar sem empresa.
- [ ] Empresa criada é autoatribuída ao admin criador na mesma transação da ativação.
- [ ] Central permite ao admin localizar todas as empresas do tenant sem liberar acesso operacional fora da carteira.
- [ ] Adição e remoção passam a valer na próxima requisição.
- [ ] Remoção sempre exige confirmação com impacto explícito.
- [ ] Lote inválido não aplica nenhum vínculo parcialmente.
- [ ] Convite aceita carteira; suspensão preserva sem acesso; arquivamento encerra sem restaurar depois.
- [ ] Arquivar empresa encerra vínculos; reativar exige nova atribuição.
- [ ] Acesso permitido exige simultaneamente vínculo de carteira e permissão do papel.
- [ ] Empresa do mesmo tenant fora da carteira retorna `403` com nome e CNPJ, sem outros dados ou ações.
- [ ] Outro tenant não é exposto e consulta sem tenant retorna vazio.
- [ ] Cada operação gera uma notificação consolidada por colaborador afetado.
- [ ] Eventos aparecem em `Histórico de Informações → Carteiras` com autor, origem, afetados, antes/depois aplicável e data/hora.
- [ ] Vínculos, eventos e notificações são persistidos ou revertidos juntos.
- [ ] Temas, estados, teclado, acessibilidade e viewports são provados conforme `FRONTEND.md` §20.1.
- [ ] CI executa e publica evidências das categorias aplicáveis.

## 11. Limites

### Sempre fazer

- validar tenant, estado, carteira e permissão no servidor;
- tratar lote, histórico e notificações atomicamente;
- revalidar a carteira em cada requisição empresarial;
- confirmar toda remoção de acesso.

### Perguntar antes

- delegar gestão de carteira a papel diferente de `admin_escritorio`;
- introduzir equipe, grupo, responsável principal ou hierarquia de carteira;
- restaurar automaticamente vínculos encerrados;
- criar outro canal além do sino para mudança de carteira.

### Nunca fazer

- liberar toda a base para usuário sem carteira;
- tratar botão oculto como autorização;
- aplicar parcialmente lote inválido;
- atribuir empresa arquivada ou de outro tenant;
- restaurar carteira no retorno de usuário ou empresa arquivados;
- excluir vínculo histórico ou evento de auditoria.

## 12. Fora desta fatia e destino

| Item | Destino |
|---|---|
| Políticas PostgreSQL de RLS em dois níveis e provas sobre todas as tabelas sensíveis | capacidade própria seguinte do MVP-1, ainda sem número reservado |
| `cliente_portal` restrito ao próprio `empresa_id` | MVP-3, junto ao Portal do Cliente |
| Alçada de aprovação HITL por domínio | fatias dos módulos Fiscal/Contábil, Financeiro e DP, sempre limitada pela carteira |
| Notificação de mudança de papel ou matriz de permissões | MVP-3, junto aos canais ativos, se priorizada pelo PI |
| `super-admin` e impersonation | MVP-4 / RF-08 |
| RLS, infraestrutura e observabilidade produtivas | gate de produção posterior ao MVP-4 |

Equipes, grupos de carteira e responsável principal não são complemento transferido: não fazem parte do requisito aprovado e não são criados nesta fatia.

## 13. Dúvidas resolvidas pelo PI

| Decisão | Resposta |
|---|---|
| Atribuição | individual e em lote |
| Compartilhamento | uma empresa pode pertencer a vários colaboradores |
| Admin | limitado à carteira nos módulos; autoatribuído na criação da empresa |
| Ciclo do usuário | convidado recebe; suspenso preserva sem acessar; arquivado perde vínculos ativos |
| Ciclo da empresa | arquivamento encerra; reativação exige nova atribuição |
| Gestor | somente `admin_escritorio` |
| Pontos de gestão | Central de Carteiras + aba do usuário + aba da empresa |
| Visão central | lista orientada a colaboradores |
| Escopo da central | todas as empresas do tenant para o admin |
| Lote inválido | tudo ou nada |
| Remoção | sempre exige confirmação |
| Notificação | sino individual, uma notificação consolidada por colaborador |
| Fora da carteira no mesmo tenant | `403` com nome e CNPJ; demais dados e ações bloqueados |

## 14. Questões abertas

Nenhuma.

## 15. Aprovação

- Fronteira, comportamento, interface, segurança, histórico, falhas, provas, destinos e tamanho aprovados pelo PI em 18/09/2026.
- Documento revisado e aprovado pelo PI; issue #11 criada em `proplan:backlog`.
