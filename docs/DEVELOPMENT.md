# DEVELOPMENT.md — Ordem de execução e status por item

> **Mantido pelo Code/Codex**, atualizado **dentro da PR** a cada entrega, junto com o progresso em [`STATUS.md`](STATUS.md).
> Aqui moram os **passos**; o card é a fatia ([`CLAUDE.md`](../CLAUDE.md)). Uma issue por fatia, nunca por passo.

---

## 1. Ambiente

Do MVP-1 ao MVP-4, existe somente o ambiente Docker local definido na [ADR-012](adr/ADR-012-ambiente-local-ate-ultimo-mvp.md). Build, CI e homologação não publicam aplicação. Produção, piloto real e infraestrutura de nuvem são uma etapa posterior ao último MVP.

### 1.1 Requisitos

| Item | Versão |
|---|---|
| Node.js | 24.15.0 (`.nvmrc`) |
| pnpm | 10.33.2 (fixado em `packageManager`) |
| Docker + Compose | corrente (validado em 29.8.0) |
| Python | fixado em `services/ai/.python-version` (serviço ainda não criado) |

### 1.2 Primeira subida

```bash
pnpm install
cp .env.example .env            # portas e credenciais locais, todas sintéticas
pnpm docker:up                  # postgres, redis, keycloak e storage S3
pnpm db:migrate
pnpm dev
```

Portas reservadas para este projeto, verificadas como livres antes da primeira
subida: Web `15100`, API `15101`, workers `15102`, Signer `15103`,
PostgreSQL `15432`, Redis `16379`, Keycloak `18080`, storage `19000` e console
`19001`. Todas publicadas apenas em `127.0.0.1`.

Para parar e limpar **somente** os volumes deste projeto:

```bash
pnpm docker:down
docker volume rm contaia_postgres contaia_redis contaia_minio
```

- **Autorizado a subir o Docker se estiver parado.** Na primeira vez, **criar instância nova com portas novas** — nunca reutilizar as portas já configuradas de outro projeto (`CLAUDE.md`).
- **No ambiente local, está previamente autorizado o uso de qualquer dado real necessário.** Produção continua fora dos MVPs 1–4 ([ADR-012](adr/ADR-012-ambiente-local-ate-ultimo-mvp.md)).

### 1.3 Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | web + api + workers em modo de desenvolvimento |
| `pnpm lint` / `pnpm typecheck` | qualidade estática |
| `pnpm test:regras` / `test:banco` / `test:tela` / `test:e2e` | categorias de [`TESTING.md`](TESTING.md) |
| `pnpm build` | build dos apps afetados |
| `pnpm db:migrate` / `db:generate` | migrations (Drizzle) |
| `pnpm docker:up` / `docker:down` / `docker:ps` | ambiente local |
| `pnpm check:workspace` | self-check estrutural do monorepo |
| `pnpm check:gate` | self-check do agregador da CI |

O relatório por categoria sai em `test-results/<SPEC|INFRA>/`; defina
`PROVA_ESCOPO` para nomear a pasta (ex.: `PROVA_ESCOPO=INFRA-1`).

---

## 2. Ordem de execução

A ordem de implementação é a **ordem do board** (`CLAUDE.md`): o Code pega sempre o primeiro `proplan:todo`.
Enquanto o fatiamento em MVP/SPEC não existir, esta tabela fica vazia — **ela não inventa ordem**.

| # | Card | Fatia / SPEC | Situação | PR | Observação |
|---|---|---|---|---|---|
| 1 | [#1](https://github.com/RodReis/rrb-contaia/issues/1) `[INFRA]` Bootstrap local do MVP-1 | — | entregue | #2 | precede a F1; sem F e sem SPEC |
| 2 | [#2](https://github.com/RodReis/rrb-contaia/issues/2) `[MVP1][SPEC-001][F1]` Acesso inicial e conclusão do cadastro do escritório | F1 / SPEC-001 | entregue | #7 | acesso OIDC, wizard de 5 etapas, edição por abas, RLS por tenant |
| 3 | [#3](https://github.com/RodReis/rrb-contaia/issues/3) `[MVP1][SPEC-002][F2]` Cadastro e ativação da empresa cliente | F2 / SPEC-002 | entregue | #42 | consulta CNPJá, wizard de 4 etapas, listagem com filtro na URL, unicidade por tenant |
| 4 | [#4](https://github.com/RodReis/rrb-contaia/issues/4) `[MVP1][SPEC-003][F3]` Manutenção da empresa cliente | F3 / SPEC-003 | entregue | #48 | abas de manutenção, finalidade de endereço, arquivamento com justificativa, Histórico de Informações append-only |
| 5 | [#5](https://github.com/RodReis/rrb-contaia/issues/5) `[MVP1][SPEC-004][F4]` Documentos da empresa | F4 / SPEC-004 | em revisão | — | checklist, upload com versões, análise explícita, storage privado, histórico documental append-only |

---

## 3. Passos por card

Detalhamento operacional de cada card em execução. Passo concluído fica marcado, com o PR que o entregou.

### Card #1 — `[INFRA]` Bootstrap local do MVP-1 (PR #2)

- [x] Workspace pnpm + Turborepo, Node e pnpm fixados, TypeScript strict compartilhado
- [x] `@contaia/config`, `@contaia/shared` e `@contaia/domain`, com teste que barra framework no domínio
- [x] Shell Web em Next.js 16, tokens do design system nos dois temas e health check
- [x] API NestJS 11 com health check, Vitest no lugar do Jest do scaffold
- [x] Shells de workers e Signer, sem cofre, fila ou assinatura
- [x] PostgreSQL com pgvector, Drizzle e migration técnica; role `contaia_app` sem `BYPASSRLS`
- [x] Compose local com Redis, Keycloak e storage S3, portas próprias e health check real
- [x] Smoke E2E, com prova de que reprova quando um serviço está fora
- [x] CI paralela com gate agregador e resumo por categoria

### Card #2 — `[MVP1][SPEC-001][F1]` Acesso inicial e conclusão do cadastro do escritório (PR #7)

- [x] Validadores de CNPJ (com o formato alfanumérico vigente), CPF, telefone, CEP, e-mail e UF
- [x] Máquina de estado do cadastro: etapa só conclui com dado válido e arquivo persistido; ativação idempotente
- [x] Schema com RLS por `tenant_id`, CNPJ único global, um endereço principal ativo e anti-drift de schema
- [x] `app.uuid_v7()` própria — o PostgreSQL 17 não traz `uuidv7()` nativo
- [x] Resolução de identidade e checagem de CNPJ por função `SECURITY DEFINER` estreita, sem `BYPASSRLS`
- [x] Acesso OIDC pelo Keycloak com PKCE, sessão em cookie `httpOnly` e proxy que nunca expõe o token
- [x] Bloqueio de área operacional por guard no servidor enquanto o tenant está `CADASTRO_INCOMPLETO`
- [x] Wizard de cinco etapas com retomada, uploads de logo e documentos e conclusão transacional
- [x] Edição por abas depois da ativação, sem reabrir o wizard
- [x] Telas nos temas CLARO e ESCURO, com os quatro estados e sem violação de acessibilidade
- [x] Provas: 80 de regras, 34 de banco, 8 de tela e 9 E2E, com o caminho crítico na CI

### Card #3 — `[MVP1][SPEC-002][F2]` Cadastro e ativação da empresa cliente (PR #42)

- [x] Domínio puro da empresa: regimes, enquadramento só no Simples, inscrição com número apenas em `POSSUI`, ativação idempotente
- [x] Regime tributário nunca inferido — ausência de Simples não decide entre Presumido e Real
- [x] Schema com RLS por `tenant_id` e **unicidade de CNPJ por tenant**, não global: dois escritórios podem atender a mesma empresa sem um descobrir o outro
- [x] `REVOKE DELETE` no default ACL do schema e nas tabelas existentes — o `ALTER DEFAULT PRIVILEGES` do F1 não bastava e toda tabela nova nascia com DELETE, violando I-7
- [x] Porta de consulta de CNPJ com falha como valor: indisponibilidade, limite e não encontrado liberam o preenchimento manual em vez de lançar
- [x] Adaptador da CNPJá no servidor, resposta como `unknown` validada por Zod, quadro societário e excedente descartados, timeout por `AbortSignal`
- [x] Telefone e e-mail que a validação do produto recusa não são propostos — a base pública guarda número anterior ao nono dígito
- [x] Consulta antes da criação: duplicidade no tenant abre o cadastro existente em vez de criar segunda empresa
- [x] Wizard de quatro etapas com persistência por etapa, retomada na primeira pendente e ativação transacional
- [x] Situação cadastral externa irregular exige confirmação em `AlertDialog` nomeando empresa e CNPJ
- [x] Listagem com busca, filtro e página na URL, contagem total, quatro estados e colapso em cartões abaixo de 768px
- [x] Componentes novos do catálogo: `Select` (Radix) e `StatusBadge` (dot + rótulo, cor nunca sozinha)
- [x] `EmptyState` e `ErroDeTela` com `nivel` — o `<h3>` fixo pulava nível depois do `<h1>` e reprovava no `heading-order`
- [x] Telas nos temas CLARO e ESCURO, com os quatro estados e sem violação de acessibilidade
- [x] Provas: 107 de regras, 50 de banco, 21 de tela e 4 E2E; prova externa real executada fora da CI com o CNPJ de teste da SPEC

### Card #5 — `[MVP1][SPEC-004][F4]` Documentos da empresa

- [x] Domínio puro dos documentos: checklist padrão, aplicabilidade das inscrições, máquina de seis estados, validade por data civil
- [x] Análise sempre explícita — nenhuma função do domínio devolve `APROVADO` a partir de um envio, nem quando quem subiu foi o administrador
- [x] `NAO_SE_APLICA` mantém a exigência na lista com `aplicavel: false`: exigência que some da lista some junto com o que já foi enviado
- [x] **FK composta `(tenant_id, empresa_id)` e `(tenant_id, usuario_id)`** — achado da fatia: FK simples para `app.empresa(id)` não impede um escritório gravar linha apontando para a empresa de outro, porque a RLS confere o `tenant_id` da própria linha, que o atacante preenche com o dele. Dois testes provavam o vazamento antes da correção
- [x] Uma versão vigente por exigência por índice parcial único; versão somente leitura por trigger (só o arquivamento passa); evento documental append-only como o histórico da F3
- [x] Documento da empresa é tipo próprio de arquivo: PDF/JPG/PNG até 20 MB, sem `.docx`, porque todo formato aceito precisa abrir no navegador
- [x] `TipoDeArquivoDoEscritorio` estreita o caminho da SPEC-001: alargar `TipoDeArquivo` sem isso deixaria o documento da empresa chegar à coluna `tipo` de `escritorio_arquivo`
- [x] `StorageService` sai de `escritorio/` para `comum/` e ganha leitura; sem URL assinada nem bucket público — link direto entregaria o documento sem trilha
- [x] Acesso só vira evento depois de o storage devolver o arquivo: falha de leitura não registra acesso concluído
- [x] Aba Documentos nos temas CLARO e ESCURO, com os quatro estados, dropzone real com validação por arrasto e versões anteriores somente leitura
- [x] Ordem do checklist pela SPEC, não por `criado_em`: o semeio grava as sete na mesma transação e `now()` empata em todas
- [x] Provas: 20 de regras no domínio, 4 no shared, 24 na API, 17 de banco, 24 de tela e 4 E2E, mais 4 capturas nos dois temas em 1440 e 768

### Card #4 — `[MVP1][SPEC-003][F3]` Manutenção da empresa cliente (PR #48)

- [x] Domínio puro da manutenção: finalidade de endereço, vigência por data civil em `America/Sao_Paulo`, justificativa obrigatória, diferenças da fonte externa
- [x] CNPJ imutável após a ativação, com código próprio (`CNPJ_IMUTAVEL`) — tentativa explícita é recusada em vez de ignorada em silêncio
- [x] Finalidade única por empresa entre endereços ativos; como são quatro finalidades, a empresa tem no máximo quatro endereços
- [x] Endereço Fiscal é sempre o padrão, amarrado por CHECK (`principal = (finalidade = 'FISCAL')`) — duas colunas independentes permitiriam estado incoerente
- [x] Troca de finalidade Fiscal passa por `situacao = 'em_troca'`: índice único é verificado por linha durante o comando, e constraint `DEFERRABLE` não aceita predicado parcial
- [x] Histórico append-only por **trigger**, não só por GRANT — um `GRANT` pode escapar numa fatia futura; a trigger vale para qualquer role
- [x] Coluna `sequencia` no histórico: `ocorrido_em` empata dentro da transação e o sufixo do `uuid_v7` é aleatório, então dois eventos salvos juntos apareceriam em ordem arbitrária
- [x] Migration faz backfill antes de criar as restrições — migration que só funciona em tabela vazia não é migration
- [x] Alteração e evento na mesma transação: a escrita usa o repositório direto, não o `EmpresaService`, que abre transação própria
- [x] Conflito de edição concorrente por compare-and-swap na `versao`, opcional no repositório (a manutenção informa, o wizard da F2 não)
- [x] CNPJá compara e **nunca** aplica sozinha: seleção campo a campo, situação externa irregular só alerta, falha externa preserva os dados e a edição manual
- [x] Empresa arquivada fica somente para consulta, por `fieldset disabled` — e o servidor recusa a escrita de qualquer forma
- [x] Lista abre em `ATIVA`; a arquivada aparece só sob o filtro `ARQUIVADA`, que cruza `status` e `situacao`
- [x] Histórico de Informações global com as quatro abas e os quatro filtros, sem nenhuma ação de escrita na tela
- [x] Componente novo do catálogo: `AreaDeTexto` (justificativa é texto corrido, e um `input` de uma linha esconde o que ficou registrado para sempre)
- [x] Telas nos temas CLARO e ESCURO, com os estados e sem violação de acessibilidade
- [x] Provas: 42 de regras, 67 de banco, 42 de tela e 3 E2E; dublê da CNPJá por `CNPJA_URL`, porque dublar só no navegador deixava a aplicação seletiva consultar a fonte real

---

## 4. Rotina

A rotina completa está em [`AUDIT.md`](AUDIT.md). Em resumo:

1. Ler [`APRENDIZADOS.md`](APRENDIZADOS.md) · confirmar issue, SPEC, base e branch.
2. Worktree por card.
3. Implementar com uma finalidade só.
4. Rodar as categorias aplicáveis de [`TESTING.md`](TESTING.md).
5. Autorrevisar com [`REVIEW.md`](REVIEW.md).
6. PR conforme [`PRS.md`](PRS.md); acompanhar o gate do SHA atual.
7. Squash com gate verde; confirmar `mergedAt` na origem.
8. Comentário de encerramento na issue (`fechar-card`) → `proplan:done`.
9. Atualizar este documento e [`STATUS.md`](STATUS.md) **na PR**.

---

## Referências

- [`STATUS.md`](STATUS.md) · [`AUDIT.md`](AUDIT.md) · [`TESTING.md`](TESTING.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`FRONTEND.md`](FRONTEND.md)
