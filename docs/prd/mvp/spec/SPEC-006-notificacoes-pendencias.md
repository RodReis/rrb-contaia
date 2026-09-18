# SPEC-006 / F6 — Notificações de pendências

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§4.1, 9.1 e 15
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Médio
>
> **Dependência:** F5 / SPEC-005
>
> **Issue:** ainda não criada

## 1. Objetivo

Notificar o `admin_escritorio` sobre pendências cadastrais e documentais, oferecer acesso direto ao item relacionado e preservar um histórico consultável sem confundir leitura da notificação com resolução da pendência.

## 2. Gatilhos e idempotência

Uma notificação é criada quando:

- surge nova pendência cadastral ou documental;
- um documento é rejeitado;
- um documento vence;
- uma exigência específica é adicionada à empresa.

Processamento repetido do mesmo evento não duplica notificação equivalente.

## 3. Painel do sino

- Badge representa a quantidade de notificações não lidas.
- Painel exibe as 15 notificações mais recentes, lidas e não lidas.
- Ordenação é da mais recente para a mais antiga.
- Cada item identifica empresa, assunto, momento e estado de leitura.
- Clicar no item marca-o como lido e abre a pendência relacionada.
- Cada item possui seleção individual.
- Checkbox **Todas** seleciona somente os 15 itens visíveis para marcação em lote como lidos.
- **Ver todas** abre o histórico completo, paginado e ordenado por data.
- Notificações lidas permanecem no histórico e não são excluídas pela interface.

Ler notificação não resolve pendência. Resolver ou dispensar pendência não apaga notificação histórica.

## 4. Autorização e estados de interface

- Toda notificação pertence ao tenant e referencia uma empresa acessível ao usuário.
- Nesta fatia, somente `admin_escritorio` recebe e consulta notificações.
- A navegação revalida a autorização da pendência; referência antiga ou inacessível não expõe dados.

| Estado | Comportamento |
|---|---|
| Badge zero | sino permanece acessível sem contador |
| Carregando | painel preserva dimensões e foco |
| Vazio | informa ausência de notificações |
| Não lida | texto e indicador além de cor |
| Seleção | quantidade selecionada e ação disponíveis |
| Destino indisponível | informa que o item não está acessível, sem vazar conteúdo |
| Erro | Toast acionável sem marcar como lida indevidamente |

O painel opera por teclado, controla foco e segue os temas CLARO e ESCURO.

## 5. Histórico e falhas

- Criação e marcação de leitura registram data/hora e usuário aplicável.
- Histórico é somente leitura pela interface.
- Marcação individual ou em lote é idempotente.
- Falha ao abrir o destino não desfaz a leitura já confirmada.
- Falha ao marcar leitura mantém o item como não lido.
- Evento repetido não aumenta o badge nem cria item duplicado.
- Acesso divergente é negado sem revelar empresa ou pendência.

## 6. Stack, comandos e testes

- Next.js 16 e React 19 para sino, painel e histórico.
- NestJS para consultas, leitura, autorização e consumidores de eventos.
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
| Regras | gatilhos; badge; leitura individual/lote; independência da pendência; idempotência |
| Banco | isolamento; histórico; concorrência; evento único; contador coerente |
| Tela | 15 itens; seleção; Todas; Ver todas; teclado; foco; CLARO/ESCURO |
| E2E | gerar evento → ver badge → abrir painel → selecionar/marcar → navegar → consultar histórico |
| Contrafactual | evento duplicado; destino alheio; marcar já lida; resolver sem apagar notificação |

## 7. Critérios de aceite

- [ ] Os quatro gatilhos aprovados criam notificações navegáveis.
- [ ] Reprocessamento não cria duplicata.
- [ ] Badge conta somente notificações não lidas.
- [ ] Painel mostra os 15 itens mais recentes na ordem correta.
- [ ] Clique marca como lida e abre a pendência autorizada.
- [ ] Seleção individual e checkbox Todas marcam os itens visíveis em lote.
- [ ] Ver todas abre o histórico completo paginado.
- [ ] Notificações lidas permanecem no histórico.
- [ ] Leitura e resolução são independentes.
- [ ] Tenant ou empresa divergente não é exposto.
- [ ] Temas, acessibilidade, viewports e estados são provados conforme `FRONTEND.md` §20.1.

## 8. Limites

- Sempre: autorizar no servidor, preservar histórico e garantir idempotência.
- Perguntar antes: criar gatilho, canal, retenção ou destinatário adicional.
- Nunca: resolver pendência ao ler, apagar notificação lida ou expor item de outro escopo.

## 9. Fora desta fatia e destino

| Item | Destino |
|---|---|
| Gestão e versões dos documentos | F4 / SPEC-004 |
| Central, indicadores e resolução | F5 / SPEC-005 |
| E-mail, WhatsApp, Telegram ou push externo | MVP-3, junto aos canais ativos |
| Notificações para outros papéis | fatia de usuários/papéis e carteira do MVP-1 |

## 10. Dúvidas resolvidas pelo PI

| Decisão | Resposta |
|---|---|
| Contador | notificações não lidas |
| Painel | 15 itens mais recentes |
| Histórico | Ver todas; itens lidos preservados |
| Seleção | individual e Todas para itens visíveis |
| Clique | marca como lida e abre pendência |
| Gatilhos | nova pendência, rejeição, vencimento e nova exigência |
| Relação com pendência | leitura não resolve; resolução não apaga notificação |

## 11. Questões abertas

Nenhuma.

## 12. Aprovação

- Design funcional aprovado pelo PI durante a especificação em 17/09/2026.
- Documento completo aprovado pelo PI em 18/09/2026.
