# SPEC-002 / F2 — Cadastro e ativação da empresa cliente

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§4.1, 4.3, 4.4 e 15
>
> **Estado:** aprovada pelo PI em 17/09/2026
>
> **Tamanho:** Médio
>
> **Dependência:** F1 / SPEC-001
>
> **Issue:** #3

## 1. Objetivo

Permitir que o `admin_escritorio` cadastre a primeira empresa cliente em um wizard persistente, use a API pública da CNPJá para pré-preencher dados cadastrais, revise os dados e ative a empresa. A mesma entrega disponibiliza a listagem mínima das empresas do escritório e a retomada de cadastros incompletos.

Sucesso significa que uma empresa válida passa de `CADASTRO_INCOMPLETO` para `ATIVA`, sem duplicar CNPJ dentro do tenant e sem expor ou alterar dados de outro escritório. Indisponibilidade do provedor externo não bloqueia o preenchimento manual.

## 2. Usuário e pré-condições

- Usuário desta fatia: `admin_escritorio` de tenant ativo.
- F1 / SPEC-001 concluída: autenticação, tenant e administrador estão disponíveis.
- O administrador acessa todas as empresas do próprio escritório.
- Usuários adicionais, papéis e carteira ainda não existem e não são antecipados nesta fatia.

## 3. Comportamento esperado

### 3.1 Entrada e listagem

- A visão sem empresas mostra `Nenhuma empresa cadastrada` e o CTA funcional `Cadastrar empresa`.
- A lista exibe nome fantasia, razão social, CNPJ, regime tributário e status.
- A busca aceita nome fantasia, razão social ou CNPJ.
- Os filtros disponíveis são `Ativa` e `Incompleta`.
- Empresa incompleta oferece a ação `Continuar cadastro`, retomando a primeira etapa pendente.

### 3.2 Wizard de cadastro

O wizard possui quatro etapas:

1. **Identificação:** CNPJ, razão social, nome fantasia, logo opcional, telefone opcional e e-mail opcional.
2. **Dados fiscais:** regime tributário, enquadramento no Simples quando aplicável, CNAE principal, CNAEs secundários e inscrições estadual e municipal.
3. **Endereço principal:** CEP, logradouro, número, complemento opcional, bairro, município e UF.
4. **Revisão e ativação:** resumo dos dados, alertas aplicáveis e ação `Ativar empresa`.

Regras do wizard:

- `Salvar e continuar` valida e persiste cada etapa antes de avançar.
- O usuário pode voltar e alterar uma etapa já salva.
- Sair do fluxo preserva o cadastro como `CADASTRO_INCOMPLETO`.
- Nova sessão retoma a primeira etapa pendente.
- Apenas `Ativar empresa` altera o status para `ATIVA`.
- A ativação é transacional e idempotente.

### 3.3 Consulta por CNPJ

1. O CNPJ é normalizado e validado antes da consulta.
2. O sistema verifica duplicidade dentro do tenant.
3. Sem duplicidade, consulta a API pública da CNPJá.
4. O retorno pode pré-preencher razão social, nome fantasia, CNAEs, endereço, telefone, e-mail e Simples/MEI.
5. Os valores permanecem editáveis e só são persistidos quando o usuário salva a etapa.
6. Campos não usados pelo produto, inclusive quadro societário, são ignorados.

Falha, timeout, limite de requisições ou CNPJ não encontrado permitem preenchimento manual e exibem que os dados não foram validados pela fonte externa.

### 3.4 CNPJ já existente

- Empresa `CADASTRO_INCOMPLETO`: abrir `Continuar cadastro`.
- Empresa `ATIVA`: abrir o cadastro existente em modo de consulta.
- A criação de uma segunda empresa com o mesmo CNPJ no tenant nunca é permitida.

## 4. Dados e invariantes

### 4.1 Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-2` | empresa só é consultada ou alterada dentro do tenant autenticado |

### 4.2 Identificação

- CNPJ obrigatório, válido e único dentro do tenant.
- Razão social e nome fantasia obrigatórios.
- Logo, telefone e e-mail opcionais.
- CNPJ é armazenado sem máscara e aceita o formato alfanumérico vigente, conforme ADR-006.

### 4.3 Dados fiscais

- Um CNAE principal é obrigatório.
- CNAEs secundários são opcionais e múltiplos.
- Regimes aceitos: `SIMPLES_NACIONAL`, `LUCRO_PRESUMIDO` e `LUCRO_REAL`.
- Para Simples Nacional, o enquadramento `MEI` ou `NAO_MEI` é obrigatório.
- Quando a CNPJá não indicar Simples, o sistema não infere o regime: o usuário escolhe Presumido ou Real.
- Inscrições estadual e municipal têm situação `POSSUI`, `ISENTO` ou `NAO_SE_APLICA`.
- O número da inscrição é obrigatório somente quando a situação for `POSSUI`.

### 4.4 Endereço e estado

- Um endereço principal completo é obrigatório para ativação.
- Nesta fatia, cada empresa possui somente o endereço principal.
- Estados da empresa nesta fatia: `CADASTRO_INCOMPLETO` e `ATIVA`.
- Empresa com situação cadastral externa diferente de `Ativa` exige alerta e confirmação explícita, mas pode ser ativada.

### 4.5 Isolamento

- A unicidade do CNPJ é composta por tenant e CNPJ normalizado.
- Toda leitura e escrita exige contexto do tenant autenticado.
- Um administrador não consulta, altera nem descobre empresas de outro escritório.
- CNPJ igual em tenants diferentes é permitido.

## 5. Contrato da integração CNPJá

- Provedor desta fatia: API pública da CNPJá, endpoint de consulta por CNPJ.
- O acesso ao provedor ocorre somente pela API do produto, nunca diretamente pelo navegador.
- A integração fica atrás de uma porta substituível; o domínio não depende do formato externo.
- A resposta entra como `unknown`, é validada e mapeada somente para os campos conhecidos.
- A credencial comercial não existe nesta fatia.
- Limite, indisponibilidade ou mudança do provedor são falhas recuperáveis pelo preenchimento manual.
- Testes automatizados usam dublê determinístico e não dependem da internet.
- A prova externa separada usa o CNPJ de teste `60.347.383/0001-09`.

## 6. Contrato de interface

- Referência concreta de conteúdo e fluxo: `docs/telas/contaia_onboarding_de_clientes_importa_o_de_legados_rf_01/` e navegação integrada de `docs/telas/prototipo/`.
- Interface final nos temas CLARO e ESCURO, sem wireframe ou aparência padrão de biblioteca.
- Wizard, lista e estados seguem `FRONTEND.md`, `DESIGN-SYSTEM.md` e `docs/design-system/`.
- Viewports e provas seguem `FRONTEND.md` §20.1.
- O stepper identifica etapa atual, concluídas e pendentes sem depender apenas de cor.
- Validação acontece ao sair do campo e ao avançar; o foco vai ao primeiro erro e existe resumo acessível.
- Há estados explícitos para carregamento, consulta externa, limite excedido, indisponibilidade, não encontrado, salvamento, retomada e ativação.
- A listagem preserva busca e filtros na navegação de retorno do wizard.
- A implementação deve usar `frontend-design` e receber o passe final de `impeccable`.

## 7. Erros observáveis

| Situação | Resultado esperado |
|---|---|
| CNPJ inválido | `422 application/problem+json`, associado ao campo |
| CNPJ ativo já cadastrado no tenant | abre a empresa existente, sem criar duplicata |
| CNPJ incompleto já cadastrado no tenant | abre a retomada do cadastro |
| Mesmo CNPJ em outro tenant | cadastro permitido, sem revelar a outra empresa |
| CNPJá indisponível, lenta ou limitada | aviso observável e preenchimento manual disponível |
| Retorno externo inválido | dados descartados; preenchimento manual disponível |
| Situação externa diferente de Ativa | alerta e confirmação explícita antes da ativação |
| Campo obrigatório inválido | `422 application/problem+json`, associado ao campo |
| Salvamento falhou | etapa não é concluída; dados anteriormente confirmados são preservados |
| Ativação falhou | empresa permanece `CADASTRO_INCOMPLETO`, sem estado parcial |
| Ativação repetida | resposta idempotente, sem duplicar dados |
| Tenant divergente | acesso negado sem revelar a existência da empresa |

Todos os erros de domínio expostos pela API possuem código estável e `correlationId`, conforme `ARCHITECTURE.md` e `FRONTEND.md`.

## 8. Dados e fluxo

```text
admin do tenant ativo
        │
        ▼
   CNPJ válido ── consulta de duplicidade no tenant
        │
        ├─ existente incompleta ──▶ retomar wizard
        ├─ existente ativa ───────▶ abrir consulta
        │
        └─ novo ──▶ CNPJá pública ──┬─ sucesso ──▶ pré-preencher
                                    └─ falha ────▶ preencher manualmente
                                                        │
                                                        ▼
                                        salvar etapas e revisar
                                                        │
                                                        ▼
                                    CADASTRO_INCOMPLETO ──▶ ATIVA
```

O caso de uso controla a transação. Controller valida e delega; DTO externo não é entidade de persistência.

## 9. Stack, comandos e estrutura

### 9.1 Stack aplicável

- Next.js 16 e React 19 para a interface.
- NestJS para a API e o adaptador da CNPJá.
- PostgreSQL com Drizzle ORM e RLS por tenant.
- Storage local compatível com S3 somente para o logo opcional.

### 9.2 Comandos de validação

```bash
pnpm lint
pnpm typecheck
pnpm test:regras
pnpm test:banco
pnpm test:tela
pnpm test:e2e
pnpm build
```

### 9.3 Estrutura de referência

```text
apps/web/                 wizard, lista e estados da interface
apps/api/                 casos de uso e adaptador externo
packages/domain/          regras puras, estados e erros estáveis
packages/db/              schema, migrations e políticas de isolamento
tests/                    provas por categoria e dublê da CNPJá
```

A estrutura interna exata continua decisão reversível do Code.

### 9.4 Estilo de contrato

```ts
type CompanyStatus = 'CADASTRO_INCOMPLETO' | 'ATIVA';

type TaxRegime =
  | 'SIMPLES_NACIONAL'
  | 'LUCRO_PRESUMIDO'
  | 'LUCRO_REAL';
```

- Código e identificadores em inglês; interface e documentação em PT-BR.
- Dado externo entra como `unknown` e é validado antes do uso.
- É proibido `any` implícito.

## 10. Estratégia de teste e evidência

| Categoria | Prova mínima |
|---|---|
| Regras | CNPJ válido/inválido; obrigatoriedade; regimes; MEI; inscrições; situação externa; transição idempotente |
| Banco | unicidade por tenant; mesmo CNPJ entre tenants; persistência por etapa; ativação atômica; negação entre tenants |
| Integração | mapeamento do dublê; timeout; `404`; `429`; resposta inválida; descarte de campos excedentes |
| Tela | vazio com CTA; wizard; retomada; lista, busca e filtros; mensagens nos temas CLARO/ESCURO; responsividade e acessibilidade |
| E2E | login → cadastrar CNPJ → pré-preencher → editar → sair → retomar → ativar → localizar na lista |
| Contrafactual | tentar duplicar no tenant; acessar empresa alheia; ativar sem obrigatório; repetir ativação; falha externa |
| Prova externa | consulta separada à CNPJá pública com o CNPJ de teste, sem integrar a chamada à CI |

Indisponibilidade da CNPJá durante a prova externa é registrada como `not_run` ou falha externa observada; não transforma o teste com dublê em prova real.

## 11. Critérios de aceite

- [ ] O estado vazio apresenta CTA funcional para cadastrar empresa.
- [ ] O administrador conclui as quatro etapas e ativa a empresa.
- [ ] Cada etapa válida é salva e retomada após nova sessão.
- [ ] CNPJ duplicado no tenant abre o cadastro existente e não cria duplicata.
- [ ] O mesmo CNPJ pode existir em tenants distintos sem vazamento.
- [ ] A CNPJá pré-preenche somente os campos previstos e eles permanecem editáveis.
- [ ] Falha externa permite concluir manualmente com aviso de ausência de validação.
- [ ] Situação externa diferente de Ativa exige confirmação explícita.
- [ ] Ativação exige identificação, dados fiscais e endereço principal válidos.
- [ ] Lista, busca e filtros funcionam para empresas ativas e incompletas.
- [ ] Ativação é transacional e idempotente.
- [ ] Temas, viewports, estados e acessibilidade são provados conforme `FRONTEND.md` §20.1.
- [ ] Testes de regras, banco, integração, tela e E2E produzem evidência rastreável à SPEC-002/issue.

## 12. Limites

### Sempre fazer

- Autorizar e filtrar pelo tenant no servidor.
- Preservar o progresso já confirmado.
- Permitir preenchimento manual quando a integração externa falhar.
- Manter o adaptador externo substituível.
- Provar negação entre tenants com teste negativo.

### Perguntar antes

- Alterar campos obrigatórios, estados ou regimes aprovados.
- Tornar a CNPJá obrigatória para ativação.
- Mudar a unicidade do CNPJ para global.
- Antecipar manutenção, documentos ou Central de Pendências.

### Nunca fazer

- Consultar a CNPJá diretamente pelo navegador.
- Persistir o retorno integral do provedor.
- Inferir Lucro Presumido ou Real pela ausência de Simples.
- Criar usuário, carteira ou permissão adicional nesta fatia.
- Usar plano comercial ou infraestrutura produtiva; qualquer dado real necessário permanece restrito ao ambiente local já autorizado.

## 13. Fora desta fatia e destino

| Item | Destino |
|---|---|
| Edição por abas, múltiplos endereços, arquivamento e reativação | F3 / SPEC-003 — Manutenção da empresa cliente |
| Upload, download, substituição e arquivamento de documentos | F4 / SPEC-004 — Documentos da empresa |
| Central de Pendências e indicadores | F5 / SPEC-005 — Central de Pendências cadastrais |
| Sino e histórico de notificações | F6 / SPEC-006 — Notificações de pendências |
| Usuários adicionais, papéis e permissões | fatia própria posterior do MVP-1 |
| Carteira do colaborador e acesso por empresa | fatia própria posterior do MVP-1 |
| RLS de dois níveis nas tabelas operacionais | fatia própria posterior do MVP-1; esta fatia já prova isolamento das empresas por tenant |
| Plano comercial da CNPJá e consulta em tempo real | gate produtivo após o MVP-4, salvo emenda do PI |
| Produção e piloto real | gate produtivo após o MVP-4 |

## 14. Dúvidas resolvidas pelo PI

| Decisão | Resposta |
|---|---|
| Recorte inicial | cadastro da primeira empresa cliente |
| Acesso do administrador | todas as empresas do próprio escritório |
| Interface de criação | wizard persistente |
| Campos mínimos | identificação, dados fiscais e endereço principal |
| Unicidade do CNPJ | por tenant |
| Nome fantasia | obrigatório |
| CNAE | um principal obrigatório e secundários opcionais |
| Regimes | Simples Nacional, Lucro Presumido e Lucro Real |
| MEI | enquadramento do Simples, não regime separado |
| Inscrições | Possui, Isento ou Não se aplica |
| Endereço nesta fatia | um principal obrigatório |
| Cadastro interrompido | permanece incompleto e retomável |
| Consulta de CNPJ | automática, por provedor terceiro |
| Provedor | API pública da CNPJá |
| Falha do provedor | preenchimento manual com aviso |
| Situação cadastral não ativa | alerta e confirmação, sem bloqueio |
| Dados retornados | pré-preenchidos, editáveis e salvos por ação do usuário |
| Regime não Simples | escolha humana entre Presumido e Real |
| Telefone e e-mail | opcionais e editáveis |
| Decomposição | F2 cadastro; F3 manutenção; F4 documentos e pendências |

## 15. Questões abertas

Nenhuma.

## 16. Aprovação

- Design funcional aprovado pelo PI durante a especificação em 17/09/2026.
- Documento completo aprovado pelo PI em 17/09/2026.
