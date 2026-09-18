# SPEC-005 / F5 — Central de Pendências cadastrais

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§4.1, 4.4, 9.1 e 15
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Médio
>
> **Dependências:** F3 / SPEC-003 e F4 / SPEC-004
>
> **Issue:** #6

## 1. Objetivo

Reunir, priorizar e conduzir à resolução as pendências cadastrais e documentais de todas as empresas do escritório, mantendo a empresa ativa e tornando a incompletude visível na lista, no cadastro e em uma Central global.

## 2. Fontes e ciclo de vida

A Central reúne:

- documento padrão ou específico ausente;
- documento rejeitado;
- documento vencido;
- exigência específica adicionada;
- campo cadastral obrigatório ausente ou inválido.

Regras:

- Campo opcional vazio não gera pendência.
- Cada pendência possui empresa, origem, tipo, estado, criação e data-limite opcional.
- Correção do campo ou aprovação do documento resolve automaticamente a pendência.
- Dispensa documental também resolve a pendência correspondente.
- Pendência resolvida permanece no histórico.
- Processamento repetido da mesma causa não duplica pendência aberta equivalente.
- Empresa com pendência continua `ATIVA` e recebe o indicador **Com pendências**.
- `CADASTRO_INCOMPLETO` permanece exclusivo do wizard não ativado.

## 3. Indicadores e navegação

- A lista de empresas exibe **Pendências: N**.
- A página da empresa exibe alerta persistente no topo.
- A ação **Ver pendências** abre a Central filtrada pela empresa.
- O total considera somente pendências abertas da empresa.
- A resolução atualiza os indicadores sem transformar o estado da empresa.

## 4. Central de Pendências

Filtros:

- empresa;
- origem: cadastral ou documental;
- tipo;
- estado;
- vencimento.

Ordenação padrão:

1. prazo de resolução vencido;
2. documento vencido;
3. documento rejeitado;
4. item que vence em até três dias;
5. demais pendências, da mais antiga para a mais recente.

Filtros, ordenação e paginação são processados no servidor e permanecem na URL.

## 5. Autorização, histórico e falhas

### 5.1 Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | pendências e eventos carregam `tenant_id` e `empresa_id`, índices e RLS |
| `I-2` | consulta sem tenant não retorna indicador, pendência ou histórico |
| `I-6` | histórico de criação, mudança e resolução é append-only |
| `I-11` | vencimento usa data civil; eventos com data/hora são exibidos em `America/Sao_Paulo` |

### 5.2 Regras específicas

- Nesta fatia, somente o `admin_escritorio` consulta e resolve pendências.
- Toda consulta e ação é isolada por `tenant_id` e `empresa_id`.
- Criação, mudança, resolução e dispensa registram empresa, origem, causa, data/hora e usuário quando houver ação humana.
- Mudança de origem e estado da pendência é atômica.
- Falha na reconciliação mantém o estado anterior e não duplica a pendência.
- Acesso divergente é negado sem revelar empresa ou item.
- Erros seguem `application/problem+json`, código estável e `correlationId`.

## 6. Interface

Referências concretas: `docs/telas/contaia_dashboard_multi_empresa_rf_06/`, `docs/telas/contaia_dashboard_multi_empresa_vis_o_de_riscos_tema_dark_carbon/` e navegação de `docs/telas/prototipo/`. Elas orientam densidade, indicadores e acesso à empresa; `FRONTEND.md`, `DESIGN-SYSTEM.md` e `docs/design-system/` corrigem defeitos do protótipo e definem o contrato final.

| Estado | Comportamento |
|---|---|
| Carregando | skeleton preserva filtros e lista |
| Sem pendências | estado positivo sem ocultar histórico |
| Filtro vazio | informa que não há resultado no recorte |
| Urgente | texto e ícone acompanham a cor |
| Resolvendo | ação ocupada e protegida contra repetição |
| Conflito | atualiza o item sem sobrescrever silenciosamente |
| Sem autorização | nega sem vazar existência |

Temas CLARO/ESCURO, viewports, estados, responsividade, acessibilidade, comparação visual e provas seguem `FRONTEND.md` §20.1. A implementação usa obrigatoriamente `frontend-design` e recebe o passe final de `impeccable`.

## 7. Stack, comandos e testes

- Next.js 16 e React 19 para indicadores e Central.
- NestJS para consultas, reconciliação e autorização.
- PostgreSQL com Drizzle ORM e RLS.

```bash
pnpm lint
pnpm typecheck
pnpm test:regras
pnpm test:banco
pnpm test:tela
pnpm test:e2e
pnpm build
```

| Categoria | Prova mínima |
|---|---|
| Regras | fontes; obrigatoriedade; prioridade; resolução; empresa permanece ativa; idempotência |
| Banco | isolamento; atomicidade; histórico; concorrência; unicidade da pendência aberta |
| Tela | badges; alerta; filtros; ordenação; vazio; CLARO/ESCURO |
| E2E | gerar pendência → localizar → navegar pela empresa → corrigir/aprovar → resolver → consultar histórico |
| Contrafactual | campo opcional; duplicação; outro tenant/empresa; mudar status da empresa |

## 8. Critérios de aceite

- [ ] Central reúne todas as fontes aprovadas.
- [ ] Campo opcional vazio não gera pendência.
- [ ] Empresa permanece Ativa e exibe indicadores coerentes.
- [ ] Lista mostra a quantidade aberta e a empresa oferece acesso filtrado à Central.
- [ ] Filtros e prioridade seguem as regras aprovadas.
- [ ] Data-limite é opcional.
- [ ] Correção cadastral, aprovação ou dispensa resolve o item automaticamente.
- [ ] Resolução preserva histórico.
- [ ] Mesma causa não duplica pendência aberta.
- [ ] Isolamento entre tenants e empresas possui prova negativa.
- [ ] Interface final é provada nos temas, viewports e estados exigidos.

## 9. Limites

- Sempre: autorizar no servidor, preservar histórico e reconciliar idempotentemente.
- Perguntar antes: criar nova fonte, prioridade, estado ou operador.
- Nunca: alterar empresa para `CADASTRO_INCOMPLETO`, apagar pendência resolvida ou expor outro escopo.

## 10. Fora desta fatia e destino

| Item | Destino |
|---|---|
| Gestão, análise e versões de documentos | F4 / SPEC-004 |
| Sino, badge de não lidas e histórico de notificações | F6 / SPEC-006 |
| Carteira e usuários adicionais | fatias próprias posteriores do MVP-1 |
| Portal do cliente | MVP-3 |

## 11. Dúvidas resolvidas pelo PI

| Decisão | Resposta |
|---|---|
| Composição | pendências cadastrais e documentais |
| Campo opcional | não gera pendência |
| Empresa afetada | permanece Ativa com indicador próprio |
| Indicadores | badge na lista, alerta e acesso filtrado |
| Data-limite | opcional |
| Filtros | empresa, origem, tipo, estado e vencimento |
| Prioridade | vencidas, rejeitadas, próximas e demais por criação |
| Resolução | automática após correção, aprovação ou dispensa |

## 12. Questões abertas

Nenhuma.

## 13. Aprovação

- Design funcional aprovado pelo PI durante a especificação em 17/09/2026.
- Documento completo aprovado pelo PI em 18/09/2026.
