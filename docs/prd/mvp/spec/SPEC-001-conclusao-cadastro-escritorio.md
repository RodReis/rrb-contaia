# SPEC-001 / F1 — Acesso inicial e conclusão do cadastro do escritório

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§4.1, 4.3, 4.4 e 15; ADR-011; ADR-012
>
> **Estado:** aprovada pelo PI em 17/09/2026
>
> **Tamanho:** Médio
>
> **Dependência:** card `[INFRA] Bootstrap local do MVP-1`, sem F/SPEC
>
> **Issue:** #2

## 1. Objetivo

Entregar o primeiro comportamento vertical observável do ContaIA: um `admin_escritorio` criado por seed autentica-se pelo Keycloak local, conclui obrigatoriamente o cadastro do escritório em um wizard persistente e passa a acessar a visão inicial do sistema. Depois da ativação, o cadastro pode ser consultado e editado por abas.

Sucesso significa que nenhum tenant incompleto entra nas áreas operacionais, que o CNPJ do escritório é único globalmente e que o fluxo completo funciona em Docker local sem cadastro público, convite ou infraestrutura de nuvem.

## 2. Usuário e pré-condições

- Usuário: `admin_escritorio`.
- O card `[INFRA]` entrega monorepo, Docker Compose, PostgreSQL, Redis, Keycloak, storage local compatível com S3, serviços mínimos, health checks e CI inicial.
- O seed local cria:
  - identidade do `admin_escritorio` no Keycloak;
  - usuário correspondente no produto, associado pelo `sub` OIDC;
  - tenant mínimo no estado `CADASTRO_INCOMPLETO`.
- Não existe cadastro público nem convite nesta fatia.

## 3. Comportamento esperado

### 3.1 Autenticação e bloqueio cadastral

1. O usuário autentica-se no Keycloak local.
2. A aplicação associa o `sub` OIDC ao usuário local e ao tenant seedado.
3. Enquanto o tenant estiver `CADASTRO_INCOMPLETO`, qualquer tentativa de acessar uma área operacional redireciona para a primeira etapa incompleta do wizard.
4. A restrição é aplicada no servidor; ocultar navegação no cliente não é o controle de acesso.
5. Logout e nova autenticação retomam o progresso salvo.

### 3.2 Wizard de conclusão

O wizard possui cinco etapas:

1. **Identificação:** CNPJ, nome/razão social e logo.
2. **Responsável técnico:** nome completo, CPF, CRC, e-mail e telefone.
3. **Endereço principal:** CEP, logradouro, número, complemento opcional, bairro, município e UF.
4. **Documentos:** um ou mais arquivos no campo genérico “Documentos do escritório”; pelo menos um é obrigatório.
5. **Revisão:** resumo de todos os dados e ação `Concluir cadastro`.

Regras do wizard:

- `Salvar e continuar` valida e persiste cada etapa antes de avançar.
- O usuário pode voltar e alterar etapas já salvas.
- Etapa inválida não é marcada como concluída.
- Formatos, limite de tamanho e armazenamento dos arquivos são decisões técnicas do Code, configuradas em uma fonte única e validadas igualmente na interface e na API.
- Logo e documento só contam como enviados após persistência confirmada.
- Apenas `Concluir cadastro` altera o tenant para `ATIVO`.
- A ativação é transacional e idempotente.

### 3.3 Estado ativo e edição

- Após a ativação, o usuário acessa a visão inicial vazia com a mensagem `Nenhuma empresa cadastrada`, sem ação para um fluxo ainda inexistente.
- A fatia de cadastro de empresa adicionará o CTA funcional `Cadastrar primeira empresa`.
- O cadastro do escritório passa a ser editado em quatro abas: `Identificação`, `Responsável`, `Endereços` e `Arquivos`.
- O wizard exige um endereço principal. Depois da ativação, a aba `Endereços` permite adicionar, editar e arquivar endereços, mantendo exatamente um endereço principal ativo.
- Alterações posteriores não reabrem o wizard.
- Arquivos existentes podem ser consultados e substituídos; o escritório nunca pode ficar sem logo nem sem ao menos um documento persistido.

## 4. Regras e invariantes

### 4.1 Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-2` | nenhuma consulta ou alteração do escritório retorna dado sem contexto do tenant autenticado |

### 4.2 Regras específicas

- CNPJ do escritório é válido e único globalmente.
- CPF e CNPJ são armazenados sem máscara; a interface aplica máscara e validação conforme `FRONTEND.md`.
- O CNPJ aceita o formato alfanumérico vigente, conforme ADR-006.
- CRC, CPF, e-mail e telefone do responsável técnico são obrigatórios.
- O Keycloak responde pela identidade; estado cadastral, tenant e associação do usuário pertencem ao PostgreSQL do produto.
- Consulta sem contexto de tenant não retorna dados.
- Um usuário não consulta nem altera o cadastro de outro tenant.
- Não existe exclusão física do escritório nesta fatia.

## 5. Contrato de interface

- Tela de acesso baseada nas referências `docs/telas/contaia_p_gina_inicial_acesso/` e `docs/telas/contaia_p_gina_inicial_portal_de_acesso_tema_dark_carbon/`.
- Wizard e edição usam a composição do onboarding existente como referência de conteúdo e fluxo, corrigida pelos contratos de design.
- Interface final nos temas CLARO e ESCURO, sem wireframe ou aparência padrão de biblioteca.
- Viewports e provas seguem `FRONTEND.md` §20.1.
- O stepper identifica etapa atual, concluídas e pendentes sem depender apenas de cor.
- Validação ocorre ao sair do campo e ao avançar; o foco vai para o primeiro erro e existe resumo acessível dos erros da etapa.
- Carregamento, retomada, falha de salvamento, falha de upload, sucesso e sessão expirada têm estados explícitos.
- A implementação deve usar `frontend-design` e receber o passe final de `impeccable`.

## 6. Erros observáveis

| Situação | Resultado esperado |
|---|---|
| Credencial inválida | Keycloak rejeita o login; nenhuma sessão local é criada |
| Sessão expirada | retorno ao login; após autenticar, retomada da etapa incompleta |
| CNPJ inválido | `422 application/problem+json`, associado ao campo |
| CNPJ já utilizado | `409 application/problem+json`, sem revelar dados do outro tenant |
| Outro campo inválido | `422 application/problem+json`, associado ao campo correspondente |
| Upload falhou | arquivo não é salvo e a etapa permanece incompleta |
| Conclusão falhou | tenant permanece `CADASTRO_INCOMPLETO`; nenhuma ativação parcial |
| Conclusão repetida | resposta idempotente; não duplica dados nem arquivos |
| Tenant divergente | acesso negado sem revelar a existência do outro tenant |

Todos os erros de domínio expostos pela API possuem código estável e `correlationId`, conforme `ARCHITECTURE.md` e `FRONTEND.md`.

## 7. Dados e fluxo

```text
Keycloak local
  identidade seedada
        │ OIDC (`sub`)
        ▼
usuário local ── tenant CADASTRO_INCOMPLETO
                       │
                       ├─ etapas persistidas do wizard
                       │
                       └─ conclusão transacional
                                  ▼
                              tenant ATIVO
                                  ▼
                   visão inicial sem empresas cadastradas
```

O caso de uso controla a transação. Controller valida e delega; DTO não é entidade de persistência.

## 8. Stack, comandos e estrutura

### 8.1 Stack aplicável

- Keycloak self-hosted em Docker local, via OIDC.
- Next.js 16 e React 19 para a interface.
- NestJS para a API.
- PostgreSQL com Drizzle ORM.
- Storage local compatível com S3 para logo e documentos.

Produção, cluster, Kubernetes, provedor de nuvem e alta disponibilidade não pertencem a esta fatia.

### 8.2 Comandos de validação

```bash
pnpm lint
pnpm typecheck
pnpm test:regras
pnpm test:banco
pnpm test:tela
pnpm test:e2e
pnpm build
```

### 8.3 Estrutura de referência

```text
apps/web/                 interface e fluxo OIDC
apps/api/                 casos de uso e endpoints
packages/domain/          regras puras e erros estáveis
packages/db/              schema, migrations e RLS
infra/docker/             composição local e seeds
tests/                    provas por categoria
```

A estrutura interna exata continua decisão reversível do Code.

### 8.4 Estilo de contrato

```ts
type TenantStatus = 'CADASTRO_INCOMPLETO' | 'ATIVO';

type CompleteTenantRegistration = Readonly<{
  tenantId: TenantId;
  expectedVersion: number;
}>;
```

- Código e identificadores em inglês; interface e documentação em PT-BR.
- Dado externo entra como `unknown` e é validado antes do uso.
- É proibido `any` implícito.

## 9. Estratégia de teste e evidência

| Categoria | Prova mínima |
|---|---|
| Regras | CNPJ/CPF válidos e inválidos; obrigatoriedade; transição de estado; idempotência |
| Banco | unicidade global do CNPJ; persistência por etapa; ativação atômica; associação pelo `sub`; negação entre tenants |
| Tela | wizard, retomada, abas, mensagens e uploads em CLARO/ESCURO; responsividade; teclado; foco; contraste |
| E2E | login seedado → salvar etapas → sair → retomar → concluir → visão vazia → editar por abas |
| Contrafactual | tenant incompleto tenta rota operacional; segundo tenant tenta mesmo CNPJ; usuário tenta tenant alheio; upload falha; conclusão é repetida |

Credencial real, nuvem, alta disponibilidade e comportamento produtivo são `not_run`, nunca `pass`.

## 10. Critérios de aceite

- [ ] O seed cria identidade, usuário local e tenant mínimo associados corretamente.
- [ ] Login OIDC local cria sessão segura e identifica o `admin_escritorio`.
- [ ] Tenant incompleto não acessa nenhuma área operacional.
- [ ] Cada etapa válida é persistida por `Salvar e continuar` e retomada após nova sessão.
- [ ] Todos os campos e arquivos obrigatórios são validados.
- [ ] CNPJ duplicado é recusado globalmente sem vazamento entre tenants.
- [ ] `Concluir cadastro` ativa o tenant de forma transacional e idempotente.
- [ ] A visão inicial ativa informa que não existem empresas e apresenta a próxima ação.
- [ ] O cadastro ativo é consultável e editável por abas sem reabrir o wizard.
- [ ] Provas visuais cobrem temas, viewports, estados e acessibilidade exigidos por `FRONTEND.md` §20.1.
- [ ] Testes de regras, banco, tela e E2E aplicáveis passam e produzem evidência rastreável à SPEC-001/issue.

## 11. Limites

### Sempre fazer

- Validar a autorização e o estado cadastral no servidor.
- Preservar progresso já confirmado.
- Manter frontend e API no mesmo contrato de validação de arquivos.
- Provar negação entre tenants com teste negativo.

### Perguntar antes

- Alterar os campos obrigatórios aprovados.
- Permitir acesso operacional a tenant incompleto.
- Trocar Keycloak ou mudar a fronteira entre identidade e carteira.

### Nunca fazer

- Criar cadastro público ou convite nesta fatia.
- Antecipar cadastro de empresa cliente, usuários adicionais ou super-admin.
- Usar infraestrutura produtiva; qualquer dado real necessário permanece restrito ao ambiente local já autorizado.
- Representar o estado cadastral apenas no cliente.

## 12. Fora desta fatia e destino

| Item | Destino |
|---|---|
| Bootstrap do monorepo e serviços locais | card `[INFRA] Bootstrap local do MVP-1`, pré-requisito sem F/SPEC |
| Cadastro público, convite de admin e arquivamento/ciclo de vida do tenant | MVP-4, junto ao RF-08, salvo emenda do PI |
| Usuários adicionais, papéis e permissões | próxima fatia própria do MVP-1 |
| Cadastro de empresa cliente e CTA funcional na visão vazia | próxima fatia própria do MVP-1 |
| Carteira e RLS de dois níveis sobre empresas | fatia própria do MVP-1 |
| Super-admin e impersonation | MVP-4 |
| Nuvem, alta disponibilidade e produção | gate produtivo após o MVP-4 |

## 13. Dúvidas resolvidas pelo PI

| Decisão | Resposta |
|---|---|
| Origem do primeiro admin | seed local |
| Conteúdo do seed | usuário e escritório mínimo |
| Acesso com cadastro incompleto | bloqueado fora do wizard |
| Dados necessários para ativação | todos os campos do PRD, logo e documento obrigatório |
| Documento obrigatório | campo genérico, aceitando múltiplos arquivos |
| Unicidade do CNPJ do escritório | global |
| Recorte da entrega | `[INFRA]` separado; F1 vertical de acesso e cadastro |
| Interface de criação | wizard persistido por etapa |
| Interface de edição | abas |
| Dados do responsável | nome, CPF, CRC, e-mail e telefone |

## 14. Questões abertas

Nenhuma.

## 15. Aprovação

- Design funcional aprovado pelo PI durante a especificação em 17/09/2026.
- Documento completo aprovado pelo PI em 17/09/2026.
