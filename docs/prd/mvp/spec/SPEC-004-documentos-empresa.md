# SPEC-004 / F4 — Documentos da empresa

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§4.1, 4.4 e 15
>
> **Estado:** em revisão pelo PI
>
> **Tamanho:** Médio
>
> **Dependências:** F2 / SPEC-002 e F3 / SPEC-003
>
> **Issue:** ainda não criada

## 1. Objetivo

Entregar a aba **Documentos** da empresa para o `admin_escritorio` controlar exigências cadastrais, enviar e revisar arquivos, preservar versões e consultar o histórico documental sem exclusão física.

Sucesso significa manter uma única versão vigente por exigência, exigir análise explícita de cada envio, preservar versões anteriores e produzir eventos auditáveis para todas as ações documentais.

## 2. Escopo observável

### 2.1 Checklist

Checklist padrão:

- Contrato social ou requerimento de empresário;
- Cartão CNPJ;
- Inscrição estadual, quando aplicável;
- Inscrição municipal, quando aplicável;
- Alvará de funcionamento, quando aplicável;
- Documento do responsável legal;
- Comprovante de endereço da empresa.

O escritório pode adicionar exigências específicas por empresa, com nome, descrição e data-limite opcional.

### 2.2 Aplicabilidade das inscrições

- `NAO_SE_APLICA`: não cria exigência documental.
- `ISENTO`: exige comprovante de isenção.
- `POSSUI`: exige comprovante da inscrição.
- Mudança cadastral na F3 reconcilia a exigência sem apagar seu histórico.

### 2.3 Arquivos e versões

- Formatos aceitos: PDF, JPG e PNG.
- Limite: 20 MB por arquivo.
- Cada exigência possui no máximo um arquivo vigente.
- Novo upload entra como `ENVIADO` e exige aprovação ou rejeição posterior, mesmo quando enviado pelo próprio administrador.
- Substituição cria nova versão vigente e arquiva a anterior.
- Versões anteriores são somente leitura e não podem ser excluídas pela interface.
- PDF e imagens podem ser visualizados no navegador e baixados no formato original.

### 2.4 Estados

| Estado | Significado |
|---|---|
| `PENDENTE` | exigência aplicável sem arquivo vigente aprovado |
| `ENVIADO` | arquivo recebido e aguardando análise |
| `APROVADO` | arquivo vigente aceito |
| `REJEITADO` | arquivo recusado e aguardando nova versão |
| `DISPENSADO` | exigência liberada mediante justificativa |
| `VENCIDO` | arquivo aprovado com validade ultrapassada |

- Rejeição e dispensa exigem justificativa.
- Rejeição mantém a exigência pendente até nova versão ser aprovada.
- Data de validade é opcional; quando ultrapassada, o estado muda para `VENCIDO`.

## 3. Usuário, autorização e auditoria

- Somente o `admin_escritorio` opera documentos nesta fatia.
- Toda ação é autorizada no servidor por `tenant_id` e `empresa_id`.
- Storage não é público; conteúdo só é acessado pela aplicação após autorização.
- Upload, substituição, aprovação, rejeição, dispensa, vencimento, visualização e download registram empresa, exigência, versão, ação, data/hora e usuário.
- Justificativa, estado anterior e estado novo são registrados quando aplicáveis.
- Ação documental e evento são persistidos atomicamente.
- Histórico e versões arquivadas são append-only e somente leitura.

## 4. Estados de interface

As telas seguem `FRONTEND.md`, `DESIGN-SYSTEM.md`, `docs/design-system/` e as referências aplicáveis de `docs/telas/`, nos temas CLARO e ESCURO.

| Estado | Comportamento |
|---|---|
| Carregando | skeleton preserva a estrutura da aba |
| Checklist vazio | explica ausência de exigências e oferece inclusão específica |
| Upload em andamento | progresso visível e envio duplicado bloqueado |
| Arquivo inválido | informa formato ou tamanho permitido |
| Enviado | informa que ainda depende de análise |
| Rejeitado | mostra justificativa e ação para nova versão |
| Vencido | destaca validade e necessidade de substituição |
| Arquivo indisponível | falha acionável sem registrar acesso concluído |
| Sem autorização | nega acesso sem revelar recurso alheio |

## 5. Falhas e atomicidade

| Situação | Resultado |
|---|---|
| Formato ou tamanho inválido | upload rejeitado antes da persistência |
| Falha durante upload | não cria versão vigente nem evento de sucesso |
| Falha na auditoria | ação documental sofre rollback |
| Análise concorrente | conflito explícito, sem sobrescrita silenciosa |
| Ação sobre versão antiga | operação rejeitada |
| Tenant ou empresa divergente | acesso negado sem revelar existência |

Erros seguem `application/problem+json`, código estável e `correlationId`.

## 6. Stack, comandos e estrutura

- Next.js 16 e React 19 para a aba e visualização.
- NestJS para casos de uso, autorização e acesso ao storage.
- PostgreSQL com Drizzle ORM e RLS.
- Storage local compatível com S3 durante os MVPs.

```bash
pnpm lint
pnpm typecheck
pnpm test:regras
pnpm test:banco
pnpm test:tela
pnpm test:e2e
pnpm build
```

```text
apps/web/                 aba Documentos, revisão e histórico
apps/api/                 casos de uso, autorização e storage
packages/domain/          estados e invariantes documentais
packages/db/              metadados, versões, RLS e auditoria
tests/                    provas por categoria e storage local
```

## 7. Estratégia de teste e aceite

| Categoria | Prova mínima |
|---|---|
| Regras | estados; transições; justificativas; validade; uma versão vigente; aplicabilidade das inscrições |
| Banco | isolamento; atomicidade; append-only; substituição; concorrência |
| Storage | formatos; limite; falha parcial; conteúdo privado; original preservado |
| Tela | checklist; upload; análise; versões; visualização; download; CLARO/ESCURO |
| E2E | criar exigência → enviar → rejeitar → substituir → aprovar → consultar histórico |
| Contrafactual | arquivo proibido; segundo vigente; versão antiga; exclusão; acesso alheio |

Critérios:

- [ ] Checklist padrão e exigências específicas aparecem na aba Documentos.
- [ ] Aplicabilidade das inscrições segue Possui, Isento e Não se aplica.
- [ ] Somente PDF, JPG e PNG de até 20 MB são aceitos.
- [ ] Cada exigência mantém um arquivo vigente e versões anteriores preservadas.
- [ ] Novo upload fica Enviado e exige análise explícita.
- [ ] Rejeição e dispensa exigem justificativa.
- [ ] Validade ultrapassada muda o documento para Vencido.
- [ ] Visualização e download são autorizados e auditados.
- [ ] Histórico e versões não podem ser alterados ou excluídos pela interface.
- [ ] Temas, viewports, acessibilidade e estados são provados conforme `FRONTEND.md` §20.1.

## 8. Limites

### Sempre fazer

- Autorizar no servidor por tenant e empresa.
- Preservar versões e eventos.
- Exigir análise explícita do upload.
- Persistir ação e evento atomicamente.

### Perguntar antes

- Aceitar formato novo, arquivo acima de 20 MB ou múltiplos vigentes.
- Alterar checklist, estados ou operador permitido.

### Nunca fazer

- Aprovar upload automaticamente.
- Excluir fisicamente versão ou evento pela interface.
- Tornar storage público.
- Tratar certificado digital ou procuração como documento cadastral.

## 9. Fora desta fatia e destino

| Item | Destino |
|---|---|
| Central, indicadores e resolução de pendências | F5 / SPEC-005 |
| Sino, notificações e histórico de notificações | F6 / SPEC-006 |
| Certificado digital A1, rotação e cofre | fatia própria posterior do MVP-1 |
| Procuração eletrônica RFB/e-CAC | fatia própria posterior do MVP-1 |
| Upload pelo portal do cliente | MVP-3, junto ao portal `cliente_portal` |
| Produção e storage gerenciado | gate produtivo após o MVP-4 |

## 10. Dúvidas resolvidas pelo PI

| Decisão | Resposta |
|---|---|
| Exigências | checklist padrão e específicas por empresa |
| Estados | Pendente, Enviado, Aprovado, Rejeitado, Dispensado e Vencido |
| Operador | somente `admin_escritorio` |
| Versões | uma vigente; anteriores preservadas |
| Arquivos | PDF, JPG e PNG; até 20 MB |
| Análise | sempre explícita e separada do upload |
| Rejeição e dispensa | justificativa obrigatória |
| Validade | opcional; vencimento muda estado |
| Visualização e download | incluídos e auditados |

## 11. Questões abertas

Nenhuma.

## 12. Aprovação

- Design funcional aprovado pelo PI durante a especificação em 17/09/2026.
- Documento completo aguardando revisão do PI.
