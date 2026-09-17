# TESTING.md — Estratégia de teste, evidência e relatório

> **Normativo.** O que se testa, como se classifica, o que conta como prova e o que nunca conta.
> Aceite de entrega é **CI verde** (`CLAUDE.md`). Este documento define o que precisa estar verde.

---

## 1. Princípios

1. **Testa-se comportamento, não implementação.** Teste que quebra em refactor sem mudança de comportamento é custo, não prova.
2. **O risco manda no esforço.** Isolamento de tenant, cálculo tributário, partida dobrada, idempotência de manifestação e prazo do eSocial concentram o risco do produto. Botão que abre modal, não.
3. **Ausência de ambiente é `not_run`, nunca `pass`** (`CLAUDE.md`). Falha de worker ou falta de infraestrutura jamais vira PASS.
4. **Correção de bug entra com teste de regressão** quando há comportamento verificável; sem teste viável, a PR registra o motivo e a prova alternativa (`CLAUDE.md`).
5. **Teste instável é defeito.** Rerun não resolve, quarentena sem issue `[FIX]` é remoção de prova.
6. **Nada de teste contra órgão de governo em CI de PR.** Sefaz e eSocial entram por dublê contratual; o ambiente real é prova condicional.

---

## 2. Categorias obrigatórias

As quatro categorias de `CLAUDE.md`, com a fronteira explícita:

| Categoria | Job de CI | Escopo | Ferramenta | Dublê |
|---|---|---|---|---|
| **regras** | `test-regras` | funções puras: motor tributário, partida dobrada, motor de obrigações, conciliação multi-critério, validadores de CPF/CNPJ/chave, formatadores, máquina de estados | Vitest | tudo em memória; "agora" injetado |
| **banco** | `test-banco` | migrations, **RLS de dois níveis**, repositórios, transação, constraint, índice, append-only | Vitest + Postgres efêmero (Testcontainers ou service container) | banco real, sem mock de SQL |
| **tela** | `test-tela` | componente e fluxo de UI: estados, validação, máscara, acessibilidade, procedência de IA | Vitest + Testing Library + `jest-axe` | API por MSW |
| **E2E** | `e2e` | caminho crítico ponta a ponta no navegador | Playwright | órgão governamental por dublê contratual |

Categoria não aplicável à fatia é declarada como tal na PR — **não omitida**.

---

## 3. Prova obrigatória por tipo de risco

### 3.1 Isolamento de tenant (RLS) — a prova mais importante do produto

O PRD exige teste automatizado de RLS em **100% das tabelas sensíveis** no caminho de aplicação padrão (§4.6).

Para toda tabela transacional nova, `test-banco` prova:

- [ ] Usuário do tenant A **não lê** linha do tenant B;
- [ ] Usuário do tenant A **não escreve** em linha do tenant B (INSERT, UPDATE, DELETE);
- [ ] Usuário do escritório **fora da carteira** não lê dado da empresa;
- [ ] Usuário `cliente_portal` lê **estritamente** o próprio `empresa_id`;
- [ ] Consulta sem `tenant_id`/`empresa_id` no contexto **não retorna nada** — nunca retorna tudo;
- [ ] `tenant_id` e `empresa_id` existem, são `NOT NULL` e estão indexados;
- [ ] Impersonation de super-admin usa **role de serviço separada** e gera entrada no log global.

**Anti-drift:** um teste varre o schema e falha se existir tabela transacional sem `tenant_id`/`empresa_id`, sem índice ou sem política de RLS habilitada. Tabela nova não pode escapar por esquecimento. Esse teste é validado pelo `gate` e **não pode ser removido** ([`CI-PR.md`](CI-PR.md) §4).

### 3.2 Cálculo fiscal e contábil

- [ ] Teste de tabela com casos reais por regime (Simples, Presumido, Real);
- [ ] **Vigência:** regra cadastrada com vigência futura não altera apuração já fechada (PRD §6.5);
- [ ] **Reprodutibilidade:** recálculo de período fechado devolve exatamente o mesmo resultado;
- [ ] **IBS/CBS:** documento emitido a partir de 03/08/2026 é apurado com os campos novos;
- [ ] **Partida dobrada:** todo lançamento tem contrapartida válida e o razão fecha no período (PRD §6.5);
- [ ] **Arredondamento** explicitado e testado nas bordas — meio centavo, rateio, alíquota;
- [ ] **Nenhum float** no caminho de dinheiro ([ADR-005](adr/ADR-005-representacao-de-dinheiro.md)).

### 3.3 Integração governamental (DF-e, eSocial)

- [ ] **Idempotência:** mesmo NSU ou mesma chave de acesso reprocessados não duplicam documento (PRD §5.3);
- [ ] **Controle de NSU:** nenhuma requisição é emitida em violação do `tempoMedio`; lote de 50 respeitado; Rejeição 656 não ocorre em operação normal (PRD §5.4);
- [ ] **Retry exponencial** e alerta após 3 falhas;
- [ ] **Manifestação:** Confirmação, Desconhecimento e Operação não Realizada **nunca** são transmitidas sem aprovação humana registrada — teste que falha se o caminho automático existir;
- [ ] **Ciência da Emissão** automática registrada com autor `agente`;
- [ ] **XML original** recuperável com hash validado;
- [ ] Contrato do órgão testado por **fixture de XML real anonimizado**, versionada no repositório.

Chamada real a Sefaz/eSocial é **prova condicional**: roda fora da CI de PR, contra homologação, e é declarada `not_run` quando o ambiente não estiver disponível.

### 3.4 Agentes de IA e HITL

- [ ] **LLM nunca calcula:** teste prova que o resultado fiscal vem do motor determinístico, mesmo com o LLM devolvendo outro número;
- [ ] **Threshold:** score abaixo do corte escala para humano;
- [ ] **Fila HITL:** aprovar executa, rejeitar não executa e gera feedback, timeout de 24h escala para supervisor;
- [ ] **Pseudonimização:** CPF, CNPJ e nome mascarados no que sai para LLM de terceiro;
- [ ] **Isolamento vetorial:** busca no pgvector nunca retorna embedding de outro tenant/empresa;
- [ ] **Trilha:** toda decisão de agente registra prompt, contexto, ferramenta, score, custo e aprovador;
- [ ] Resposta de LLM é tratada como **dado hostil** — validada por schema antes de qualquer uso.

O LLM é **sempre dublado** em teste automatizado. Avaliação de qualidade de modelo é rotina própria, fora do gate de PR.

### 3.5 Tela

- [ ] Os quatro estados: carregando (Skeleton), vazio (variante correta), erro (com `correlationId`), sucesso;
- [ ] Validação e máscara de cada campo BR ([`FRONTEND.md`](FRONTEND.md) §9), incluindo colar valor formatado;
- [ ] Ação destrutiva exige confirmação; ação em lote exibe contagem e escopo;
- [ ] Valor sugerido por IA aparece com marca, score e fonte, e **Aceitar/Rejeitar visíveis**;
- [ ] Acessibilidade: `jest-axe` sem violação crítica, navegação por teclado, foco visível;
- [ ] Nenhum dado da empresa anterior permanece após troca de empresa.

### 3.6 E2E (caminho crítico)

Mínimo por MVP:

1. Login → seleção de empresa → dashboard com semáforo;
2. Cadastro de empresa com CNPJ válido → aparece na listagem;
3. Upload de certificado A1 inválido/expirado → rejeitado com mensagem correta;
4. Inbox de manifestação → aprovar uma sugestão → trilha registrada;
5. Onboarding: importar CSV com linhas boas e ruins → relatório de aceitas e rejeitadas, sem interromper o restante.

E2E roda nos **dois temas** quando a fatia tem prova visual.

---

## 4. Pirâmide e proporção

```
        E2E        ~5%   caminho crítico, lento, caro
     tela/banco    ~25%  comportamento com dependência real
       regras      ~70%  domínio puro, milissegundos
```

Suíte invertida (muito E2E, pouca regra) é lenta, instável e não diz onde quebrou. Se um bug de cálculo só é pego pelo E2E, falta teste de regra.

---

## 5. Cobertura

**Piso por categoria de risco, sem número global** ([ADR-008](adr/ADR-008-politica-de-cobertura.md)):

| Alvo | Piso | Bloqueia gate |
|---|---|---|
| Motor de regras tributárias, partida dobrada, motor de obrigações, conciliação, validadores | **95% de linhas e 100% dos invariantes documentados** | sim |
| Políticas de RLS e repositórios | **100% das tabelas sensíveis cobertas pelo anti-drift** | sim |
| Casos de uso da API | **80% de linhas** | sim |
| UI | sem piso numérico — prova por estado de tela + E2E do caminho crítico | sim (pela ausência de prova, não pelo número) |
| Adaptadores, DTO, configuração | sem piso | não |

Número global de cobertura é métrica ruim: premia testar o que é fácil. **Cobertura é chão, não teto** — 95% num motor sem teste de borda não vale nada.

---

## 6. Dados de teste

- **Nenhum dado real de cliente.** CNPJ, CPF, chave de acesso e XML de fixture são **gerados ou anonimizados**, com DV válido.
- Fixtures de XML ficam versionadas em `tests/fixtures/`, com a origem documentada (layout, versão, órgão).
- Fábrica de dados (`factory`) por entidade, com padrão válido e sobrescrita por caso — nada de objeto literal copiado entre testes.
- **"Agora" injetado**, nunca `new Date()` dentro da função testada (`CLAUDE.md`). Teste de prazo fiscal congela o relógio.
- Banco de teste é **efêmero e recriado por execução** — teste que depende de ordem ou de resíduo é defeito.

---

## 7. Evidência e relatório

Toda execução produz artefato bruto rastreável por **SPEC/issue** (`CLAUDE.md`):

```
test-results/
  <SPEC-NNN|FIX-N>/
    regras/     junit.xml · coverage/
    banco/      junit.xml · coverage/ · rls-matrix.json
    tela/       junit.xml · a11y.json
    e2e/        report/ · traces/ · screenshots/{claro,escuro}/
    resumo.json
```

`resumo.json` por categoria: total, passou, falhou, pulado, **`not_run` com motivo**, duração, cobertura.

O job `gate` consolida, **não reexecuta** ([`CI-PR.md`](CI-PR.md) §2), e valida:

- toda categoria obrigatória reportou;
- anti-drift de RLS e de append-only passou;
- nenhum `not_run` sem motivo declarado;
- o relatório referencia a SPEC/issue da PR.

A tabela **Validação executada** da PR ([`PRS.md`](PRS.md) §2) aponta para esses artefatos. Afirmação sem artefato não é prova.

---

## 8. Mudança em teste, workflow ou gerador de relatório

Exige self-check e verificação do próprio relatório (`CLAUDE.md`):

- [ ] O relatório mudou como se esperava, e o motivo está na PR;
- [ ] Nenhuma categoria sumiu do agregado;
- [ ] Nenhum teste passou a ser pulado silenciosamente;
- [ ] Se tocou UI ou fluxo crítico, há prova visual/E2E anexada.

Redução de escopo de suíte é **mudança de contrato de prova** e exige justificativa explícita — não entra de carona em PR de feature.

---

## 9. Dependências de versão

Dependência web/mobile que não suporte **Node 24**, ou dependência de backend incompatível com a versão de Python fixada, é **bloqueio explícito**: documentar o erro e ajustar a matriz só com justificativa. **Nunca degradar versão em silêncio** (`CLAUDE.md`).

---

## Referências

- [`CI-PR.md`](CI-PR.md) · [`PRS.md`](PRS.md) · [`REVIEW.md`](REVIEW.md) · [`FRONTEND.md`](FRONTEND.md) · [`CONVENTION.md`](CONVENTION.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md)
- [Vitest](https://vitest.dev) · [Testing Library](https://testing-library.com) · [Playwright](https://playwright.dev) · [Testcontainers](https://testcontainers.com) · [MSW](https://mswjs.io)
