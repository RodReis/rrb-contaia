# CLAUDE.md — rrb-contaIA

## Papéis

**PI — Rodrigo Reis.** Decide escopo, prioridade e trade-off. Responde dúvidas, aprova specs e aceita entregas. Não executa o fluxo: não cria issue, não commita, não abre PR, não faz merge. O aceite é só dele.

**Cowork — planejamento.** Especifica e mantém `CLAUDE.md`, `docs/prd/mvp/spec/`, `docs/prd/`, `docs/adr/` e o Índice Fatia ↔ SPEC do `docs/STATUS.md`. Antes de fechar uma spec, apresenta ao PI as dúvidas abertas em perguntas objetivas (pop-up); só cria a issue com todas resolvidas, para evitar retrabalho. Escreve documento direto na `main`, sem PR. Cria e mantém a issue-pai de cada MVP, vincula cada card do MVP como sub-issue nativa do GitHub, cria as issues no board na ordem de implementação e mantém os próximos 5 cards em `proplan:todo`. Nunca escreve código — implementação é exclusiva do Code.

**Code — Claude Code, , developer.** Pega a issue e coloca para `proplan:doing`, implementa a partir das issues, na ordem do board. Codifica, revisa e testa antes do commit; entrega por PR com CI verde e mergeia ele mesmo. Atualiza a documentação de entrega ao final de cada card, atualiza a issue com a skill `fechar-card` no mesmo PR. Cria a própria issue `[FIX]`. Não cria issue de fatia nem `[INFRA]` — isso é do Cowork. Pode criticar arquitetura e spec; não discute escopo e não descarta escopo, vai para backlog.


## Regras do projeto (decididas pelo PI)

- Idioma: documentação, specs, issues, commits e comunicação em PT-BR; código e identificadores em inglês; textos de interface em PT-BR.
- Privacidade, proteção de dados, LGPD e consentimentos não pertencem ao contrato de produto nem ao PRD durante os MVPs 1–4. Achados surgidos durante a especificação são registrados pelo Cowork em `docs/PRIVACIDADE.md`, com o contexto de MVP/SPEC/Fatia, **sem vínculo normativo com a SPEC** e sem gerar funcionalidade, critério de aceite, controle técnico ou bloqueio. Ao final do MVP-4, o PI revisa esse registro junto com `docs/prd/histórico/Politica_Privacidade_LGPD_Compliance.md` e decide o que, se algo, será promovido ao produto. Cowork e Code não inventam regra jurídica: dúvida material é registrada e encaminhada ao PI.
- Ninguém cria regra de produto — nem Cowork, nem Code. Falta regra → pergunta ao PI (ver "O que bloqueia o Code").
- Autorizado a subir o docker, se estiver off. Criar sempre um nova instancia na primeira vez, com novas portas, nunca usar as que já estão configurada no docker.
- **Ambiente até o fim do MVP-4:** todo desenvolvimento, integração e homologação dos MVPs 1–4 roda em Docker local, com seeds, fixtures, dublês e, quando aplicável, integrações externas acessadas a partir do ambiente local. No ambiente local, está previamente autorizado o uso de qualquer dado real necessário. Não há deploy produtivo durante esses MVPs. Produção é uma etapa própria, posterior ao último MVP, com gate e decisão de infraestrutura específicos.

## Unidade de trabalho: card = fatia

- Fatia é a Slice N.M do PRD (`docs/prd/mvp/MVP-*.md`). Cada fatia recebe um número `F<n>` e um número `SPEC-<nnn>` **iguais**, alocados uma única vez pelo Cowork no Índice Fatia ↔ SPEC do `docs/STATUS.md` (fonte única do par MVP ↔ SPEC ↔ Fatia). Número nunca é reaproveitado.
- Uma spec gera exatamente uma fatia. Partir uma fatia é decisão do PI e gera spec nova com número novo — não sufixo.
- Uma issue por fatia, **nunca por passo**. Os passos vivem em `docs/DEVELOPMENT.md`.
- Plano de gate/homologação de MVP não é fatia: vira card `[GATE]`, sem `F` e sem `SPEC`.

### Título da issue
- Ler o conforme `docs/GITHUB.md`.

## Não é decisão livre do agente

- Alterar ruleset, exigência de review, auto-merge nativo ou atualização obrigatória de branch: exige escopo e autorização próprios.
- Remover cobertura, RLS, anti-drift, append-only ou teste para ganhar minutos de CI. `[skip ci]`, cache de PASS e rerun cego não são otimização.
- Reescrever workflow humano ou mudar comando de validação sem preservar o contrato.
- Exigir aprovador humano extra quando o fluxo é solo, ou pedir novo aceite de produto que já foi dado.
- Introduzir sharding, migrar runner ou contratar infraestrutura sem evidência e recorte próprios.
- Alterar requisito de produto, política de aceite ou escopo de uma fatia: SPEC/emenda do PI **antes** de implementar.

## Testes e CI
- Para CI remoto, usar `gh pr checks <n>` ou `gh pr checks <n> --watch`. Não confiar em silêncio de
  watcher, print antigo, aba aberta ou status lembrado.
- Ler o conforme `docs/CI-PR.md`.


## Convenções de código

- Funções de cálculo puras: sem banco, rede ou relógio; o "agora" entra por parâmetro.
- Caso de uso controla a transação; controller só valida e delega. DTO nunca é entidade de persistência.
- Proibido `any` implícito; `unknown` antes de validar dado externo; proibido float para dinheiro.
- Erro de domínio tem código estável; resposta HTTP segue `application/problem+json` com `type`, `title`, `status`, `code`, `correlationId`.
- Frontend web segue `docs/FRONTEND.md` (contrato de engenharia da interface, UX e UI): máscara e validação em Date, valores R$, CPF, CNPJ, telefone e e-mail; mensagem ao usuário via Toast (Sonner), nunca `alert`; CRUD com confirmação e arquivamento em vez de exclusão física.
- **UI desde a primeira fatia, do MVP-1 ao MVP-4:** toda fatia com interface implementa a tela final nos temas CLARO e ESCURO; é proibido entregar wireframe, shell genérico, shadcn-default ou “funcional agora, visual depois”. Conteúdo, fluxo e hierarquia partem da tela correspondente em `docs/telas/`; aparência e comportamento obedecem `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md`, que vencem defeitos conhecidos do protótipo.
- **Skills obrigatórias em toda fatia com UI:** `frontend-design` antes e durante a implementação, preservando a direção visual já aprovada, e `impeccable` ao final para acabamento/refino. A PR precisa provar o ciclo de comparação com o protótipo, ambos os temas, responsividade, estados, acessibilidade e o passe final de polimento definido em `docs/FRONTEND.md` §20.1. Ausência da skill no ambiente exige aplicar e registrar o protocolo equivalente; não autoriza pular a disciplina.

## Skills do Code — na ordem de um card

`superpowers:using-git-worktrees` → `superpowers:writing-plans` / `executing-plans` (a Slice do PRD **é** o design; `brainstorming` só quando cair num caso de bloqueio ou em `[FIX]` sem causa clara) → `superpowers:test-driven-development` em feature crítica (isolamento de tenant, decisão de acesso, idempotência financeira) → `engineering:code-review` em toda tarefa → `gstack:qa` → `superpowers:finishing-a-development-branch` → `fechar-card` (encerramento na issue, antes de `proplan:done`).
Quando a tarefa tem UI: `frontend-design` (**obrigatória**, sem substituir a direção já fixada), `gstack:design-review`, `impeccable` (**obrigatória para acabamento/refino**) e smoke ao vivo com Playwright. Documentação de biblioteca: `context7`. Mobile: `expo`.

`gstack:*`, `fechar-card` e `impeccable` estão instalados globalmente na máquina do PI (Windows) — o Code os usa normalmente lá. Em qualquer ambiente onde uma dessas skills não exista, isso não é desculpa para pular a disciplina que ela representa: aplicar o equivalente manual (revisão de design, acabamento visual, **comentário de encerramento com as três seções**) e registrar na PR.

skill global: C:\Users\rodri\.claude\skills

## Grafo de conhecimento (graphify) — opcional

Só vale enquanto houver código a indexar; com o repo só em documentação, ler os arquivos direto é mais barato. Se `graphify-out/` existir, consulte o grafo antes de explorar arquitetura ou "quem chama o quê" (`/graphify query "<pergunta>"`); leia arquivo direto só para conteúdo exato. Ao final de cada entrega do ultimo card do MVP, pergunte ao PI se roda `/graphify . --update` (incremental, nunca do zero). `graphify-out/` é cache local, não entra em commit.

## Documentos-chave
- Leia o conforme `docs/DOCUMENTOS.md`.
