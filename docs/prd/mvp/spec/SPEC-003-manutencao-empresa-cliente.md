# SPEC-003 / F3 — Manutenção da empresa cliente

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§4.1, 4.4 e 15
>
> **Estado:** em revisão pelo PI
>
> **Tamanho:** Grande — mantém coeso o ciclo de manutenção da empresa; documentos e pendências permanecem na F4
>
> **Dependência:** F2 / SPEC-002
>
> **Issue:** ainda não criada

## 1. Objetivo

Permitir que o `admin_escritorio` mantenha os dados de uma empresa cliente já ativada, gerencie seus endereços, atualize seletivamente dados cadastrais pela CNPJá e controle arquivamento e reativação sem apagar informação. A fatia também entrega uma área global de auditoria do escritório para consultar as mudanças realizadas.

Sucesso significa editar dados permitidos sem alterar o CNPJ, preservar versões auditáveis dos dados cadastrais e fiscais, manter exatamente um endereço Fiscal padrão e consultar empresas arquivadas sem permitir sua edição até a reativação.

## 2. Usuário e pré-condições

- Usuário desta fatia: `admin_escritorio` autenticado no tenant ativo.
- A empresa foi criada pela F2 / SPEC-002.
- A F3 não cria usuários, papéis nem carteira. A ampliação de acesso fica nas fatias próprias do MVP-1.
- Toda leitura e alteração é autorizada no servidor e isolada por `tenant_id`.

## 3. Escopo observável

### 3.1 Lista e navegação

- A lista de empresas abre com o filtro `ATIVA`.
- O usuário pode alternar entre `ATIVA`, `CADASTRO_INCOMPLETO` e `ARQUIVADA`.
- Empresas arquivadas aparecem somente quando o filtro `ARQUIVADA` estiver selecionado.
- A edição da empresa ativa possui três abas: **Identificação**, **Dados fiscais** e **Endereços**.
- A aba **Documentos**, uploads, pendências, sino e Central de Pendências pertencem integralmente à F4 / SPEC-004.

### 3.2 Identificação e dados fiscais

- Após a ativação, o CNPJ é imutável.
- Os demais dados cadastrais provenientes do cartão CNPJ podem ser alterados.
- Regime tributário, enquadramento MEI, CNAE principal, CNAEs secundários e inscrições estaduais e municipais seguem os domínios definidos na SPEC-002.
- Alteração de regime tributário ou CNAE exige data de vigência passada ou atual; vigência futura é rejeitada.
- Cada mudança auditável registra data/hora do sistema, usuário, empresa, ação, campo, valor anterior e valor novo.
- Para regime tributário e CNAEs, o registro inclui também a data de vigência informada.

### 3.3 Atualização pela CNPJá

- A ação **Atualizar dados pela CNPJá** executa nova consulta pelo adaptador definido na F2.
- O sistema compara o retorno com os dados atuais e não salva nenhuma diferença automaticamente.
- O usuário escolhe campo a campo quais diferenças deseja aplicar e confirma o salvamento.
- O CNPJ não participa da seleção porque é imutável.
- Cada campo aplicado gera seu registro no Histórico de Informações.
- Situação cadastral externa diferente de `ATIVA` gera alerta, sem bloquear a edição nem alterar o estado interno da empresa.
- Falha, timeout, limite, resposta inválida ou CNPJ não encontrado não apaga dados nem impede edição manual.

### 3.4 Endereços

- Toda empresa ativa possui exatamente um endereço padrão.
- O endereço de finalidade `FISCAL` é obrigatoriamente o endereço padrão.
- Finalidades disponíveis: `FISCAL`, `COBRANCA`, `CORRESPONDENCIA` e `OUTRO`.
- A finalidade é obrigatória e não pode se repetir entre endereços ativos.
- `OUTRO` exige descrição obrigatória.
- Como consequência, a empresa possui no máximo quatro endereços ativos.
- Ao transferir a finalidade Fiscal para outro endereço, o usuário deve escolher para o endereço Fiscal anterior uma nova finalidade disponível antes de confirmar.
- A troca salva, na mesma transação, o novo endereço Fiscal como padrão e a nova finalidade não repetida do endereço anterior.
- O endereço Fiscal não pode ser arquivado sem substituto Fiscal válido.
- Endereço não é excluído fisicamente; seu arquivamento e suas alterações alimentam o histórico.

### 3.5 Arquivamento e reativação

- Arquivar exige confirmação explícita e justificativa obrigatória.
- Empresa arquivada fica somente para consulta e não pode ser editada.
- Reativação é ação do `admin_escritorio`, exige confirmação e justificativa obrigatória e restaura a edição com os dados preservados.
- Arquivamento e reativação registram data/hora, usuário e justificativa.
- Nenhuma das duas operações exclui dados ou registros históricos.

### 3.6 Histórico de Informações

O menu global **Histórico de Informações** reúne os eventos auditáveis de todas as empresas do escritório, sempre limitado ao tenant ativo.

Abas:

- **Dados cadastrais**;
- **Dados fiscais**;
- **Endereços**;
- **Status da empresa**.

Filtros:

- empresa;
- período;
- usuário responsável;
- campo alterado.

A listagem abre do evento mais recente para o mais antigo. Cada evento exibe empresa, data/hora, usuário, ação, campo, valor anterior e valor novo e, quando aplicável, vigência ou justificativa. Arquivamentos e reativações aparecem em **Status da empresa**.

O histórico é append-only e somente leitura: nenhum registro pode ser editado ou excluído pela interface.

## 4. Invariantes e regras

- CNPJ é único por tenant e imutável após a ativação.
- Empresa e histórico nunca atravessam o limite do tenant.
- Empresa ativa possui exatamente um endereço Fiscal padrão.
- Finalidade de endereço ativo é única por empresa.
- Arquivamento substitui exclusão física.
- Alteração auditável e respectivo evento histórico são persistidos na mesma transação.
- Dados recebidos da CNPJá são tratados como externos, validados e aplicados somente após confirmação humana.
- Histórico é append-only; atualização ou exclusão de evento é proibida.

## 5. Estados de interface

As telas seguem `FRONTEND.md`, `DESIGN-SYSTEM.md`, `docs/design-system/` e as referências aplicáveis de `docs/telas/`, nos temas CLARO e ESCURO.

| Estado | Comportamento esperado |
|---|---|
| Carregando | skeleton preserva a estrutura da lista, abas ou histórico |
| Lista vazia | mensagem coerente com o filtro e ação possível |
| Salvando | ação fica ocupada e não aceita envio duplicado |
| Alteração concorrente | conflito informado sem sobrescrever silenciosamente |
| CNPJá carregando | comparação aguarda sem apagar dados atuais |
| CNPJá indisponível | aviso e manutenção manual preservada |
| Nenhuma diferença | informar que os dados já estão atualizados |
| Empresa arquivada | modo somente leitura com ação de reativação |
| Histórico vazio | mensagem contextual conforme aba e filtros |
| Erro | mensagem acionável via Toast, preservando dados já digitados |
| Sem autorização | acesso negado sem revelar existência de empresa de outro tenant |

Filtros e paginação da lista de empresas e do histórico são processados no servidor. O estado dos filtros permanece na URL, conforme `FRONTEND.md`.

## 6. Fluxos principais

```text
lista (ATIVA por padrão)
        │
        ├─ editar empresa ativa ──▶ Identificação / Dados fiscais / Endereços
        │                                  │
        │                                  ├─ salvar mudança ──▶ dado + evento atômicos
        │                                  └─ atualizar CNPJá ──▶ comparar ──▶ selecionar ──▶ salvar
        │
        ├─ arquivar + justificar ──▶ ARQUIVADA ──▶ consulta
        │                                             │
        │                                             └─ reativar + justificar ──▶ ATIVA
        │
        └─ Histórico de Informações ──▶ abas + filtros ──▶ eventos somente leitura
```

## 7. Falhas e atomicidade

| Situação | Resultado |
|---|---|
| Alteração inválida | nada é salvo; erro aparece no campo correspondente |
| CNPJ alterado | operação rejeitada com código de domínio estável |
| Vigência futura | operação rejeitada sem criar histórico |
| Finalidade duplicada | operação rejeitada sem alterar endereços |
| Arquivar Fiscal sem substituto | operação rejeitada |
| Falha ao registrar auditoria | alteração principal sofre rollback |
| Concorrência de edição | conflito explícito; nenhuma sobrescrita silenciosa |
| Falha da CNPJá | dados atuais permanecem íntegros e editáveis |
| Tenant divergente | acesso negado sem revelar a existência da empresa |

Erros expostos pela API seguem `application/problem+json`, código estável e `correlationId`.

## 8. Stack, comandos e estrutura

### 8.1 Stack aplicável

- Next.js 16 e React 19 para lista, abas, comparação e histórico.
- NestJS para casos de uso, autorização e adaptador da CNPJá.
- PostgreSQL com Drizzle ORM, RLS e log de auditoria append-only.

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
apps/web/                 lista, abas, comparação e Histórico de Informações
apps/api/                 casos de uso, autorização e integração externa
packages/domain/          regras puras, estados e erros estáveis
packages/db/              persistência, RLS, concorrência e auditoria append-only
tests/                    provas por categoria e dublê da CNPJá
```

A estrutura interna exata continua decisão reversível do Code.

### 8.4 Estilo de contrato

```ts
type CompanyStatus = 'CADASTRO_INCOMPLETO' | 'ATIVA' | 'ARQUIVADA';

type AddressPurpose =
  | 'FISCAL'
  | 'COBRANCA'
  | 'CORRESPONDENCIA'
  | 'OUTRO';
```

- Código e identificadores em inglês; interface e documentação em PT-BR.
- Dado externo entra como `unknown` e é validado antes do uso.
- É proibido `any` implícito.

## 9. Estratégia de teste e evidência

| Categoria | Prova mínima |
|---|---|
| Regras | CNPJ imutável; vigência passada/atual; rejeição de vigência futura; finalidade única; Fiscal padrão; justificativas obrigatórias |
| Banco | isolamento por tenant; dado e auditoria atômicos; append-only; concorrência; arquivamento sem exclusão; reativação preservando dados |
| Integração | comparação CNPJá; seleção parcial; nenhuma aplicação automática; alerta de situação não ativa; falhas externas preservam edição |
| Tela | filtros de status; três abas; comparação campo a campo; múltiplos endereços; consulta arquivada; Histórico de Informações e filtros; CLARO/ESCURO |
| E2E | editar empresa → consultar CNPJá → selecionar diferenças → salvar → conferir histórico → arquivar → consultar → reativar |
| Contrafactual | alterar CNPJ; duplicar finalidade; remover Fiscal sem substituto; editar arquivada; excluir auditoria; acessar outro tenant |
| Prova externa | consulta separada à CNPJá pública no ambiente local autorizado, sem integrar a chamada à CI |

Indisponibilidade externa é registrada como `not_run` ou falha externa observada; o dublê continua responsável pela prova determinística da integração.

## 10. Critérios de aceite

- [ ] A lista abre mostrando empresas ativas e alterna entre ativas, incompletas e arquivadas.
- [ ] Empresa ativa pode ser mantida pelas abas Identificação, Dados fiscais e Endereços.
- [ ] CNPJ ativado não pode ser alterado.
- [ ] Regime tributário e CNAEs exigem vigência passada ou atual e preservam histórico.
- [ ] A CNPJá apresenta diferenças sem aplicá-las automaticamente.
- [ ] O administrador escolhe campo a campo quais diferenças aplicar.
- [ ] Situação externa diferente de Ativa somente alerta.
- [ ] Falha externa não apaga dados nem bloqueia edição manual.
- [ ] Empresa ativa mantém exatamente um endereço Fiscal padrão.
- [ ] Finalidades de endereço não se repetem e Outro exige descrição.
- [ ] Arquivamento e reativação exigem justificativa e preservam os dados.
- [ ] Empresa arquivada permanece somente para consulta até ser reativada.
- [ ] Histórico global oferece as quatro abas e os quatro filtros aprovados.
- [ ] Cada mudança auditável exibe autor, data/hora, campo, valores e complemento aplicável.
- [ ] Histórico não pode ser alterado ou excluído pela interface.
- [ ] Alteração e evento histórico são atômicos e isolados por tenant.
- [ ] Temas, viewports, estados e acessibilidade são provados conforme `FRONTEND.md` §20.1.
- [ ] Testes de regras, banco, integração, tela e E2E produzem evidência rastreável à SPEC-003/issue.

## 11. Limites

### Sempre fazer

- Autorizar e filtrar pelo tenant no servidor.
- Preservar dados e histórico durante arquivamento e reativação.
- Exigir confirmação humana antes de aplicar retorno da CNPJá.
- Persistir mudança auditável e evento na mesma transação.
- Provar os contrafactuais de isolamento, imutabilidade e append-only.

### Perguntar antes

- Tornar o CNPJ editável após ativação.
- Aceitar vigência futura.
- Criar nova finalidade de endereço.
- Permitir edição de empresa arquivada.
- Alterar os campos cobertos pelo histórico.
- Antecipar documentos ou pendências da F4.

### Nunca fazer

- Excluir fisicamente empresa, endereço ou registro de auditoria.
- Atualizar cadastro automaticamente com retorno da CNPJá.
- Arquivar empresa por causa da situação cadastral externa.
- Consultar a CNPJá diretamente pelo navegador.
- Expor dados ou eventos de outro tenant.
- Implementar documentos, uploads, pendências, sino ou Central de Pendências nesta fatia.

## 12. Fora desta fatia e destino

| Item | Destino |
|---|---|
| Aba Documentos, upload, download, substituição e arquivamento de arquivos | F4 / SPEC-004 |
| Pendências documentais, sino e Central de Pendências | F4 / SPEC-004 |
| Usuários adicionais, papéis e permissões | fatia própria posterior do MVP-1 |
| Carteira do colaborador e acesso por empresa | fatia própria posterior do MVP-1 |
| RLS de dois níveis nas tabelas operacionais | fatia própria posterior do MVP-1; esta fatia já prova isolamento por tenant |
| Produção e piloto real | gate produtivo após o MVP-4 |

## 13. Dúvidas resolvidas pelo PI

| Decisão | Resposta |
|---|---|
| Filtro padrão | empresas ativas |
| Empresa arquivada | aparece no filtro Arquivadas e fica somente para consulta |
| CNPJ após ativação | imutável |
| Escopo do histórico | dados fiscais e dados da empresa provenientes do cartão CNPJ |
| Metadados do histórico | data/hora, usuário, campo, valor anterior e valor novo |
| Vigência | obrigatória para regime e CNAEs; passada ou atual |
| Endereço padrão | exatamente um; sempre o Fiscal |
| Finalidades | Fiscal, Cobrança, Correspondência e Outro |
| Repetição de finalidade | não permitida entre endereços ativos |
| Troca do endereço Fiscal | exige escolher uma nova finalidade disponível para o endereço anterior |
| Arquivamento | confirmação e justificativa obrigatória |
| Reativação | confirmação e justificativa obrigatória |
| Abas da edição | Identificação, Dados fiscais e Endereços |
| Documentos | permanecem integralmente na F4 |
| Área de auditoria | menu global Histórico de Informações |
| Abas da auditoria | Dados cadastrais, Dados fiscais, Endereços e Status da empresa |
| Filtros da auditoria | empresa, período, usuário e campo alterado |
| Mutabilidade da auditoria | somente leitura e append-only |
| Atualização CNPJá | comparação e aplicação seletiva campo a campo |
| Situação externa não ativa | somente alerta; nunca arquivamento automático |

## 14. Questões abertas

Nenhuma.

## 15. Aprovação

- Design funcional aprovado pelo PI durante a especificação em 17/09/2026.
- Documento completo aguardando revisão do PI.
