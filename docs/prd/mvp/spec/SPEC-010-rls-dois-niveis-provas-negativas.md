# SPEC-010 / F10 — RLS de dois níveis e provas negativas

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§3, 4.4 e 4.6
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande — contexto transacional, políticas das tabelas existentes, integração com carteira, caminhos administrativos e anti-drift formam uma proteção atômica; separar qualquer parte deixaria uma falsa garantia de isolamento
>
> **Dependências:** `[INFRA]` Fundação local (#8), F2 / SPEC-002, F3 / SPEC-003, F6 / SPEC-006, F7 / SPEC-007, F8 / SPEC-008 e F9 / SPEC-009
>
> **Issue:** #12

## 1. Objetivo

Impedir que uma requisição humana ou um processamento técnico leia ou altere dados fora do escritório e das empresas expressamente autorizadas, mesmo quando a aplicação omitir um filtro, por meio de Row-Level Security no PostgreSQL.

Sucesso significa provar, no caminho de aplicação padrão, que o banco falha fechado entre tenants, entre empresas do mesmo tenant, fora da carteira e sem contexto; e que nenhuma tabela transacional atual ou futura escapa dessa proteção por esquecimento.

## 2. Fronteira da fatia

Esta fatia entrega:

- contexto de RLS limitado à transação para requisições humanas e jobs técnicos;
- políticas de dois níveis por `tenant_id` e `empresa_id`, integradas à carteira ativa do usuário;
- finalidade administrativa explícita e restrita para os casos tenant-wide já aprovados;
- proteção de leitura e escrita em todas as tabelas transacionais existentes;
- classificação obrigatória das tabelas entre transacionais/sensíveis e globais allowlisted;
- anti-drift automático que bloqueia tabelas atuais ou futuras sem a proteção completa;
- matriz negativa automatizada e evidência rastreável da cobertura.

A autorização fica em camadas: papéis definem **o que** o usuário pode fazer, carteira define **em quais empresas** ele atua e a RLS impede que a persistência ultrapasse esse recorte. Uma camada não substitui as outras.

## 3. Comportamento esperado

### 3.1 Contexto humano

Toda operação de banco iniciada por uma requisição autenticada abre uma transação e estabelece, antes de qualquer consulta:

- identidade interna do usuário;
- `tenant_id` do escritório;
- empresa ou carteira vigentes;
- finalidade comum ou administrativa autorizada.

A finalidade comum libera somente linhas do tenant corrente cujos `empresa_id` pertençam à carteira ativa do usuário. Usuário suspenso ou arquivado não lê nem altera dados empresariais, ainda que possua vínculos preservados ou históricos.

O contexto existe somente na transação. Encerrar, confirmar ou reverter a transação elimina o recorte; uma conexão reaproveitada pelo pool nunca herda tenant, empresa, usuário ou finalidade da operação anterior.

### 3.2 Contexto técnico

Job automático opera com identidade técnica, finalidade específica, `tenant_id`, `empresa_id` e `correlationId`. Ele não simula usuário, não recebe carteira humana e não possui bypass genérico de RLS.

O worker acessa somente o tenant e a empresa declarados para o trabalho. Tentativa de omitir, substituir ou ampliar o recorte falha fechada. Mensagem de fila não é autoridade por si: o contexto é validado antes do acesso ao banco.

### 3.3 Finalidade administrativa

Operações tenant-wide aprovadas nas F7, F8 e F9 usam finalidade administrativa separada, disponível apenas aos casos de uso administrativos correspondentes. Essa finalidade:

- permanece limitada ao próprio tenant;
- permite somente os dados necessários à gestão de usuários, papéis e carteiras;
- não libera dados operacionais das empresas fora da carteira;
- não pode ser escolhida livremente por controller, cliente, repositório comum ou payload externo.

Na Central de Carteiras, a localização de empresa fora da carteira continua limitada aos dados básicos aprovados na F9. Consultas operacionais permanecem bloqueadas. A API pode usar o resolvedor administrativo restrito para compor o `403` da F9 com nome e CNPJ, sem transformar essa leitura em acesso empresarial.

### 3.4 Leitura e escrita

O papel da aplicação não possui `BYPASSRLS`. As políticas são habilitadas e forçadas para o caminho de aplicação padrão.

- `SELECT` fora do recorte retorna zero linhas no banco;
- `INSERT` exige tenant e empresa iguais ao contexto autorizado;
- `UPDATE` valida tanto a linha existente quanto o novo conteúdo e não permite mover registro entre tenant ou empresa;
- `DELETE` fora do recorte é negado e nunca substitui as regras de arquivamento ou append-only já definidas;
- consulta sem contexto válido não retorna nenhuma linha protegida nem aceita escrita.

A API traduz negações conforme os contratos funcionais existentes. A RLS não autoriza expor existência ou conteúdo de outro tenant.

### 3.5 Classificação e anti-drift

Toda tabela do banco pertence exatamente a uma classificação:

1. **transacional/sensível:** exige `tenant_id` e `empresa_id` `NOT NULL`, índices, RLS habilitada e forçada, políticas por operação aplicável e matriz negativa;
2. **global:** pode ficar sem os dois níveis somente quando constar em allowlist explícita com justificativa verificável.

Tabela não classificada falha na CI. Convenção de nome ou localização em schema não concede exceção automática.

O anti-drift inspeciona o catálogo real do PostgreSQL e falha quando encontrar:

- tabela transacional sem uma das chaves ou com chave anulável;
- ausência de índice compatível;
- RLS desabilitada ou não forçada no caminho de aplicação;
- operação liberada sem política correspondente;
- papel da aplicação com `BYPASSRLS` ou privilégio incompatível;
- tabela global fora da allowlist;
- tabela sensível sem registro na matriz de cobertura.

Cada fatia futura que criar tabela transacional traz seus casos na matriz; a guarda criada aqui permanece obrigatória e não pode ser removida.

## 4. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | toda tabela transacional possui `tenant_id` e `empresa_id` obrigatórios, indexados e protegidos por RLS de dois níveis |
| `I-2` | consulta sem contexto válido de tenant e empresa não retorna linha protegida nem aceita escrita |
| `I-6` | tabelas append-only continuam sem `UPDATE` ou `DELETE`; RLS, privilégios e anti-drift não podem abrir essas operações |

## 5. Contrato de interface

Não aplicável. Esta fatia não cria nem altera tela, navegação ou componente visual. Seu comportamento é observado nas interfaces já especificadas pelas F7, F8 e F9: o usuário continua vendo somente dados autorizados e recebe os erros já definidos quando tenta ultrapassar a alçada.

Por não haver mudança visual, referências em `docs/telas/`, estados próprios, temas CLARO/ESCURO, viewports, comparação visual, `frontend-design` e `impeccable` são **não aplicáveis à F10**, e não provas omitidas. `test-tela` deve ser declarado não aplicável na entrega; banco, API e E2E negativo constituem as provas desta fatia.

## 6. Erros observáveis

| Situação | Resultado esperado |
|---|---|
| Contexto de tenant ou empresa ausente/inválido | banco retorna zero linhas protegidas e rejeita escrita; nunca amplia o acesso |
| Outro tenant | nenhuma existência ou dado é revelado; leitura vazia e escrita rejeitada |
| Mesma empresa informada com tenant incompatível | operação rejeitada; nenhum dado é movido ou criado |
| Empresa do tenant fora da carteira | consulta operacional bloqueada; API preserva o `403` definido na F9 |
| Usuário suspenso ou arquivado | nenhum acesso empresarial pela sessão humana |
| Finalidade administrativa fora de caso autorizado | acesso negado sem fallback para consulta comum ampliada |
| Worker sem recorte ou tentando outra empresa | acesso negado; nenhuma linha lida ou alterada |
| Conexão pooled reutilizada | operação seguinte começa sem contexto residual |
| Tabela transacional ou política incompatível | anti-drift falha a CI e identifica tabela e requisito ausente |
| Tabela global não allowlisted | anti-drift falha a CI |

## 7. Dados e fluxo

```text
requisição humana
  └─▶ autenticação + estado + papel + carteira
        └─▶ transação com contexto local
              └─▶ RLS tenant × empresa × carteira × finalidade

job técnico
  └─▶ identidade técnica + finalidade + tenant + empresa + correlationId
        └─▶ transação com contexto local
              └─▶ RLS limitada ao recorte do trabalho

migration/schema
  └─▶ catálogo PostgreSQL + classificação/allowlist
        └─▶ anti-drift
              ├─▶ íntegro: publica rls-matrix.json
              └─▶ lacuna: falha a CI
```

Contrato lógico mínimo do contexto:

- origem humana ou técnica;
- identidade validada;
- `tenant_id` obrigatório;
- `empresa_id` ou carteira autorizada, conforme a finalidade;
- finalidade enumerada e não controlável pelo cliente;
- `correlationId` para rastreabilidade da operação.

## 8. Stack, comandos e estrutura

### 8.1 Stack aplicável

- PostgreSQL para RLS, privilégios, catálogo e políticas.
- Drizzle ORM com migrations SQL versionadas, conforme ADR-004.
- NestJS para o helper único de transação e a composição dos contextos humano e técnico.
- Keycloak fornece identidade e sessão; não fornece tenant, carteira ou bypass de banco.

### 8.2 Comandos de verificação

```bash
pnpm lint
pnpm typecheck
pnpm test:regras
pnpm test:banco
pnpm test:e2e
pnpm build
```

`pnpm test:tela` é declarado não aplicável à F10 porque não existe alteração de interface.

### 8.3 Estrutura lógica

```text
apps/api/                 criação e validação dos contextos humano e técnico
packages/db/              transação, migrations, políticas, classificação e anti-drift
packages/domain/          decisão de carteira, estado e finalidade permitida
tests/banco/              matriz RLS no PostgreSQL real e inspeção do catálogo
tests/e2e/                negações observáveis pelo caminho de aplicação
```

O caso de uso controla a transação. Controller e payload externo nunca definem diretamente tenant, empresa, carteira, identidade técnica ou finalidade administrativa.

## 9. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | composição de estado, carteira e finalidade; contexto humano e técnico; finalidade administrativa restrita |
| Banco | dois tenants; duas empresas no mesmo tenant; `SELECT`, `INSERT`, `UPDATE` e `DELETE`; ausência e adulteração de contexto; pool sem vazamento; RLS habilitada/forçada; papel sem bypass |
| Anti-drift | chaves `NOT NULL`; índices; políticas; classificação; allowlist; cobertura; tabela deliberadamente insegura faz a prova falhar |
| API | acesso permitido; outro tenant oculto; fora da carteira preserva contrato da F9; caso administrativo permitido e negado |
| E2E | autenticar → acessar empresa da carteira → tentar empresa fora da carteira → tentar outro tenant → confirmar ausência de vazamento |
| Worker | executar no recorte correto → tentar omitir ou trocar tenant/empresa → confirmar negação e ausência de efeito |
| Tela | não aplicável; nenhuma interface é criada ou alterada |
| Contrafactual | usuário suspenso/arquivado; carteira removida; tenant incompatível; troca de empresa em `UPDATE`; conexão reutilizada; tabela global não allowlisted |

A CI publica `rls-matrix.json` vinculado à SPEC e à issue, cobrindo 100% das tabelas sensíveis existentes. Nenhum mock de SQL serve como prova de RLS; a suíte usa PostgreSQL efêmero real.

## 10. Critérios de aceite

- [ ] Toda operação humana protegida estabelece contexto validado dentro de uma transação antes do primeiro acesso.
- [ ] O contexto termina com a transação e não vaza por conexão reaproveitada.
- [ ] A aplicação comum não possui `BYPASSRLS`.
- [ ] Usuário lê e altera somente linhas do próprio tenant e de empresas da carteira ativa.
- [ ] Usuário suspenso ou arquivado não acessa dados empresariais.
- [ ] Empresa do mesmo tenant fora da carteira preserva o bloqueio e o contrato de erro da F9.
- [ ] Outro tenant não tem existência nem dados revelados.
- [ ] `INSERT`, `UPDATE` e `DELETE` fora do recorte são rejeitados.
- [ ] `UPDATE` não move registro entre tenant ou empresa.
- [ ] Finalidade administrativa só funciona nos casos de uso e dados aprovados nas F7–F9.
- [ ] Worker usa identidade técnica e recorte obrigatório de tenant e empresa, sem bypass genérico.
- [ ] Todas as tabelas transacionais existentes têm chaves obrigatórias, índices e RLS habilitada e forçada.
- [ ] Toda tabela global sem os dois níveis consta em allowlist explícita e justificada.
- [ ] Tabela nova, não classificada ou insegura faz o anti-drift falhar.
- [ ] `rls-matrix.json` prova 100% das tabelas sensíveis existentes no PostgreSQL real.
- [ ] Categorias não aplicáveis, especialmente tela, são declaradas no relatório em vez de omitidas.
- [ ] CI executa e publica as evidências vinculadas à SPEC-010 e à issue #12.

## 11. Limites

### Sempre fazer

- abrir contexto dentro da transação e antes do primeiro acesso ao banco;
- falhar fechado sem tenant, empresa, identidade ou finalidade válida;
- aplicar RLS e testes negativos a toda tabela transacional;
- classificar explicitamente toda tabela e justificar cada exceção global;
- usar PostgreSQL real para provar políticas e catálogo.

### Perguntar antes

- criar nova finalidade tenant-wide;
- incluir tabela global na allowlist sem origem explícita no domínio;
- conceder acesso de serviço sem tenant ou empresa;
- mudar o contrato da F9 para empresa fora da carteira.

### Nunca fazer

- conceder `BYPASSRLS` à aplicação comum ou aos workers;
- confiar em filtro da API, botão oculto, token ou mensagem de fila como única proteção;
- aceitar contexto vindo diretamente do payload externo;
- manter contexto fora da transação;
- permitir que conexão pooled reutilize contexto anterior;
- desabilitar anti-drift ou retirar tabela da matriz para fazer a CI passar.

## 12. Fora desta fatia e destino

| Item | Destino |
|---|---|
| `cliente_portal` restrito ao próprio `empresa_id` e suas provas específicas | MVP-3, fatia do Portal do Cliente |
| Impersonation de super-admin, role de serviço dedicada e auditoria de toda sessão | MVP-4 / RF-08 |
| Infraestrutura, roles, observabilidade e validação de RLS produtivas | gate de produção posterior ao MVP-4 |
| Políticas e matriz das tabelas transacionais criadas depois da F10 | fatia que introduzir cada tabela, obrigatoriamente fiscalizada pelo anti-drift desta SPEC |
| Registro persistente de toda tentativa negada pela RLS | não faz parte do requisito aprovado; eventual adoção exige decisão do PI e fatia própria |
| Tela de diagnóstico ou administração da RLS | não faz parte do requisito aprovado; eventual adoção exige decisão do PI e fatia própria |

O cofre local com certificados exclusivamente de teste é a próxima capacidade do MVP-1, ainda sem número reservado.

## 13. Dúvidas resolvidas pelo PI

| Decisão | Resposta |
|---|---|
| Cobertura futura | guarda automática; tabela transacional futura insegura falha na CI |
| Tabelas globais | allowlist explícita e justificada; tabela não classificada falha |
| Carteira | validada também pela RLS como defesa em profundidade |
| Abordagem | contexto transacional e políticas centralizadas |
| Administração | finalidade separada, restrita ao tenant e aos casos de uso aprovados |
| Workers | contexto técnico restrito por tenant, empresa e finalidade; sem bypass |
| Auditoria de negações | não criada nesta fatia; a negação é provada sem inventar evento de produto |
| UI | não aplicável, porque não existe alteração visual |
| Tamanho | Grande e atômica |

## 14. Questões abertas

Nenhuma.

## 15. Aprovação

- Fronteira, abordagem, contexto humano e técnico, integração com carteira, finalidade administrativa, anti-drift, provas, destinos, não aplicabilidade de UI e tamanho aprovados pelo PI em 18/09/2026.
- Documento aprovado pelo PI; issue #12 criada em `proplan:backlog`.
