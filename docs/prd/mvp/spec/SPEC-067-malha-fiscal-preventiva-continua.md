# SPEC-067 — Malha fiscal preventiva contínua

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F67
> **Origem:** PRD §§3, 5.3, 6.2, 6.4, 6.5, 7.2, 9.1, 10.5, 12, 14, 15 e 16
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 27/09/2026

---

## 1. Objetivo

Entregar uma malha fiscal preventiva contínua por empresa e competência, antes do fechamento fiscal da F51, cruzando as EFDs internas F52/F53, os DF-e normalizados pelas capacidades aprovadas e extratos bancários importados localmente por CSV ou OFX.

A F67 cobre somente comércio de autopeças em Goiás nos regimes e períodos já autorizados pelas capacidades de origem. Ela encontra divergências, preserva evidências, classifica impacto, orienta a correção na fonte e impede fechamento quando não existe segurança suficiente. Não altera EFD, DF-e, livro fiscal ou transação bancária; não transmite, paga, escritura nem produz efeito externo.

## 2. Resultado observável

Em `Fiscal -> Malha preventiva`, o usuário pode:

- importar CSV ou OFX de uma conta bancária para empresa e período explícitos;
- consultar a cobertura das fontes exigidas para cada competência;
- executar ou reprocessar o cruzamento de forma idempotente;
- comparar EFD ICMS/IPI, EFD-Contribuições, DF-e e evidência bancária;
- visualizar divergência, regra, valores comparados, impacto, criticidade e origem;
- distinguir caso fiscal comprovado, indício bancário, ambiguidade, `INDETERMINATE` e `STALE`;
- justificar caso médio ou baixo, preservando autor, motivo e evidência;
- navegar para a capacidade responsável pela correção;
- recalcular após nova versão da fonte e acompanhar o histórico;
- saber se o fechamento F51 está liberado, liberado com justificativas ou bloqueado.

Movimento bancário isolado nunca comprova omissão fiscal. Ausência, incompatibilidade ou conflito de cobertura não vira conformidade por padrão.

## 3. Recorte herdado

| Fonte | Cobertura consumida |
|---|---|
| F18/F30 e eventos aprovados | NF-e modelo 55, CT-e e NFC-e modelo 65 normalizados, nos recortes próprios |
| F51 | livros fiscais e competência aberta elegível para fechamento |
| F52 | EFD ICMS/IPI interna por estabelecimento de Goiás desde setembro de 2026 |
| F53 | EFD-Contribuições interna centralizada na matriz, Lucro Presumido cumulativo em 2026; Simples conforme decisão `NOT_APPLICABLE` |
| Importação F67 | extrato local CSV ou OFX da conta, empresa e período declarados |

A F67 não amplia regime, UF, CNAE, documento, operação ou período. Quando a F52 ou F53 não for aplicável segundo sua própria autoridade, a ausência é `NOT_APPLICABLE`, não divergência. Quando não for possível decidir a aplicabilidade ou completude, o resultado é `INDETERMINATE`.

## 4. Dependências e autoridades

- F18/F30 e suas extensões aprovadas são autoridades para conteúdo e situação dos DF-e.
- F51 é autoridade para livros, estado da competência e fechamento fiscal.
- F52 e F53 são autoridades para as EFDs internas e seus recortes.
- A revisão bancária publicada pela F67 é autoridade somente para o conteúdo importado; não comprova natureza fiscal.
- A regra de malha versionada declara quais campos semanticamente equivalentes podem ser comparados e como classificar o resultado.
- A capacidade de origem permanece autoridade exclusiva para corrigir seu dado.

Divergência entre autoridades ou tentativa de comparar bases não equivalentes produz diagnóstico explícito. A malha não escolhe precedência silenciosa e não usa semelhança de nome, descrição bancária ou proximidade de valor como prova fiscal.

## 5. Importação bancária local

Cada importação declara empresa, conta, instituição, moeda, período civil, formato, schema, arquivo, hash e instante imutável da revisão. CSV segue schema canônico publicado; OFX aceita somente variante suportada e identificada pelo parser.

O processamento contém prévia com contagens, intervalo, totais, duplicidades e erros. Dados externos entram como `unknown` e são validados antes da publicação. Arquivo parcial, período incompatível, moeda não suportada, conta ambígua ou linha inválida não publica subconjunto.

Mesmo tenant, empresa, conta, período e hash são idempotentes. Mesmo identificador com conteúdo diferente é conflito auditável. Revisão publicada é imutável; correção cria nova revisão integral e marca análises dependentes como `STALE`.

## 6. Contrato bancário normalizado

`BankStatementImport` identifica a revisão e seu manifesto. `BankAccountSnapshot` identifica conta, moeda, período e saldos declarados. `BankTransaction` contém identificador externo quando presente, data civil, tipo crédito/débito, valor inteiro em centavos, descrição original, documento informado e hash estável.

O futuro conector de Open Finance do MVP-2 deverá produzir esse mesmo contrato normalizado, sem alterar a semântica da malha. Consentimento, saldos remotos, webhooks e iniciação de pagamento não pertencem à F67.

## 7. Execução versionada

`PreventiveMeshRun` referencia versões exatas de empresa, competência F51, EFD F52, EFD F53 quando aplicável, conjunto de DF-e, revisão bancária e pacote de regras. O motor é puro: não acessa banco, rede, relógio ou LLM durante o cálculo.

Nova versão elegível de EFD, DF-e ou extrato agenda reprocessamento idempotente de competência aberta. O usuário também pode solicitar reprocessamento manual. Mesmas entradas e versões produzem os mesmos casos, totais e gate.

Falha não substitui o último resultado íntegro. Execuções encerradas ficam imutáveis e ligadas à execução sucessora.

## 8. Comparações fiscais

A malha compara somente campos declarados como equivalentes pela regra versionada. Valores fiscais usam decimal exato e tolerância monetária zero; normalização de escala nunca arredonda diferença para escondê-la.

Casos mínimos:

- DF-e autorizado e aplicável ausente da escrituração esperada;
- registro escriturado sem DF-e ou evidência de origem exigida;
- situação autorizada, cancelada ou devolvida incompatível entre fontes;
- chave, participante, estabelecimento, competência ou documento divergente;
- valor contábil, base, tributo ou total diferente no campo equivalente;
- duplicidade ou omissão comprovada;
- totalização incompatível com os itens que a compõem;
- versão de fonte alterada depois da análise.

Bases de ICMS, IPI, PIS/Pasep, Cofins e CPRB não são comparadas entre si por coincidência numérica. Cada regra nomeia origem, destino, campo, documento, operação, regime, período e fundamento técnico.

## 9. Vínculo bancário restrito

Vínculo automático ocorre somente por identificador inequívoco compartilhado ou combinação determinística exata publicada pela regra. Descrição semelhante, valor aproximado, data próxima ou contraparte parecida geram apenas candidato para revisão.

Não se usam os pesos da conciliação RF-04, embeddings ou LLM. Um movimento sem vínculo fiscal abre indício bancário, nunca divergência fiscal crítica sozinho. Ele só corrobora criticidade quando uma divergência já é sustentada por DF-e/EFD ou por regra oficial inequívoca.

## 10. Casos, criticidade e ciclo de vida

`PreventiveMeshCase` contém código estável, empresa, competência, regra e versão, fontes e versões, campos comparados, valores, diferença, evidências, impacto, criticidade, capacidade de correção e estado.

Estados:

`OPEN -> UNDER_REVIEW -> JUSTIFIED | RESOLVED -> STALE`

`INDETERMINATE` é resultado próprio quando cobertura, aplicabilidade, fonte obrigatória ou equivalência não pode ser decidida. Caso crítico só pode ser resolvido após nova execução comprovar que a origem foi corrigida. Caso médio ou baixo pode receber justificativa humana auditada, sem apagar a divergência.

Criticidade `CRITICAL` exige impacto fiscal comprovado ou cobertura indeterminada capaz de invalidar o fechamento. `MEDIUM` indica divergência material que exige revisão, mas não invalida por si a totalidade da competência. `LOW` registra inconsistência sem impacto fiscal comprovado. Regras e versões determinam criticidade; usuário não a reduz manualmente.

## 11. Gate do fechamento F51

O fechamento é bloqueado quando houver:

- caso `CRITICAL` aberto ou em revisão;
- fonte obrigatória ausente, inválida ou `STALE`;
- resultado `INDETERMINATE` capaz de afetar cobertura;
- execução inexistente, falha ou baseada em versões superadas.

Casos `MEDIUM` ou `LOW` permitem fechamento somente quando todos estiverem resolvidos ou justificados por usuário autorizado. O snapshot F51 registra execução, versões, casos, justificativas e resultado do gate. Reabertura preserva o snapshot anterior e exige nova execução antes de outro fechamento.

## 12. Correção e navegação

A malha nunca edita dados das capacidades de origem. Cada caso aponta a fonte responsável e oferece navegação contextual para F51, F52, F53 ou gestão do DF-e/extrato, conforme autorização.

Depois da correção, nova versão da origem dispara reprocessamento. O caso anterior fica `STALE`; a nova execução cria resultado próprio e relaciona a evidência anterior. Não existe botão de “conformar”, alterar valor ou excluir evidência dentro da malha.

## 13. Autorização, isolamento e auditoria

- `auxiliar`: consulta, importa e prepara revisão bancária; não justifica nem libera fechamento;
- `contador`: publica revisão preparada por outro usuário, revisa casos e justifica `MEDIUM`/`LOW` da própria carteira;
- `admin_escritorio`: mesmas ações no tenant, preservada a segregação da importação/publicação;
- `auditor_readonly`: consulta execuções, regras, fontes, casos, justificativas e histórico;
- `cliente_portal` e papéis sem permissão fiscal: acesso negado;
- `super-admin` local: mantém infraestrutura global, sem decidir caso empresarial.

Tabelas transacionais carregam `tenant_id` e `empresa_id`, índices e RLS. Importação, validação, publicação, execução, revisão, justificativa, navegação, download, gate e tentativas negadas entram em auditoria append-only.

## 14. Concorrência e falhas

- publicação, revisão, justificativa e gate usam versão otimista e retornam HTTP 409 em conflito;
- lote bancário inválido falha atomicamente;
- falha de uma fonte não vira caso resolvido nem conformidade parcial;
- indisponibilidade preserva a última execução íntegra e permite retentativa idempotente;
- erro segue `application/problem+json` com código estável e `correlationId`;
- processamento em lote registra resultado por competência sem sobrescrever histórico.

## 15. Invariantes globais tocados

| Invariante | Aplicação na F67 |
|---|---|
| I-1 | importações, execuções e casos carregam tenant e empresa, índices e RLS |
| I-2 | consulta sem contexto não retorna dados fiscais ou bancários |
| I-3 | valores monetários são inteiros em centavos; cálculo fiscal preserva decimal exato |
| I-4 | cruzamento e criticidade são determinísticos; LLM não calcula nem decide |
| I-5 | justificativa e fechamento continuam ações humanas registradas |
| I-6 | fontes, execuções, casos e decisões preservam trilha append-only |
| I-7 | evidência fiscal ou bancária não é apagada |
| I-8 | regra é selecionada pela competência e vigência aplicáveis |
| I-9 | importação, execução e reprocessamento são idempotentes |
| I-11 | competência e datas bancárias são civis; timestamps exibem `America/Sao_Paulo` |
| I-12 | snapshot fechado reproduz exatamente fontes, regras, casos e gate |

## 16. Contrato de UI

A UI usa `docs/telas/contaia_dashboard_multi_empresa_rf_06/` e `docs/telas/contaia_dashboard_multi_empresa_vis_o_de_riscos_tema_dark_carbon/` para conteúdo, hierarquia e densidade, corrigidas por `FRONTEND.md` e pelo design system.

Ela apresenta resumo por competência, cobertura das fontes, gate do fechamento, filtros de criticidade/estado/origem, tabela de casos, comparação lado a lado, evidências, revisão bancária, justificativa, histórico e navegação para correção.

Estados obrigatórios: carregando, vazio, importando, prévia inválida, validando, processamento, sem divergências, casos críticos/médios/baixos, indício bancário, ambiguidade, `INDETERMINATE`, `STALE`, bloqueio, liberação com justificativas, conflito, erro recuperável e acesso negado.

A implementação entrega temas CLARO e ESCURO, viewports de 375, 768, 1280 e 1536 px, teclado, foco, semântica, contraste e Toast/Sonner. `frontend-design` é obrigatória antes e durante a implementação; `impeccable`, no acabamento. A PR prova comparação visual, responsividade, estados e acessibilidade conforme `FRONTEND.md` §20.1.

## 17. Critérios de aceite verificáveis

| Categoria | Prova obrigatória |
|---|---|
| Importação | CSV e OFX íntegros publicam revisão; arquivo parcial, duplicado conflitante ou inválido falha atomicamente |
| Cobertura | aplicabilidade herdada de F52/F53 distingue fonte exigida, `NOT_APPLICABLE` e `INDETERMINATE` |
| Fiscal | omissão, duplicidade, situação e valores equivalentes são comparados com tolerância zero |
| Semântica | bases tributárias diferentes não são comparadas por coincidência |
| Banco | vínculo automático exige prova determinística; movimento isolado não bloqueia como divergência fiscal |
| Histórico | fonte alterada marca análise anterior `STALE` e nova execução preserva a anterior |
| Fechamento | crítico, cobertura indeterminada ou fonte inválida bloqueiam F51; médio/baixo exigem resolução ou justificativa |
| Banco de dados | RLS, carteira, imutabilidade, idempotência, segregação, concorrência e append-only |
| UI | dois temas, quatro viewports, estados, teclado, foco, contraste e acabamento |

## 18. Provas exigidas

- testes de regras para cada caso fiscal, criticidade, tolerância zero, equivalência e gate;
- testes negativos para vínculo aproximado, extrato isolado, fonte ausente, arquivo parcial, moeda incompatível e schema inválido;
- testes de parser com fixtures CSV, OFX suportado, duplicidade e caracteres inválidos;
- testes de banco para atomicidade, idempotência, RLS, carteira, segregação, concorrência e auditoria;
- integração com DF-e, F51, F52 e F53, inclusive `NOT_APPLICABLE`, `INDETERMINATE` e `STALE`;
- E2E de importação, publicação, execução, revisão, justificativa, correção na origem, reprocessamento e fechamento;
- prova visual nos dois temas e quatro viewports.

## 19. Fora de escopo e destinos obrigatórios

| Item | Destino obrigatório |
|---|---|
| Consentimento, contas, saldos e webhooks bancários | fatia própria de Open Finance no MVP-2 |
| ITP e autorização final no banco | fatia própria de ITP no MVP-2 |
| Cobrança e baixa Pix | fatia própria de Pix via PSP/BaaS no MVP-2 |
| Pesos, embeddings, LLM, auto-match e fila financeira | conciliação multi-critério e Agente Conciliador no MVP-2 |
| Contas a pagar/receber, boleto, CNAB, aging e fluxo de caixa | fatias financeiras próprias do MVP-2 |
| Edição de EFD, DF-e, livro ou transação na malha | capacidade de origem correspondente |
| Novos regimes, UFs, CNAEs, documentos e períodos | expansão fiscal própria do MVP-2 |
| Alertas externos, rascunhos e ordenação por impacto | Agente Compliance completo no MVP-2; comunicação ativa no MVP-3 |
| Transmissão, pagamento, protocolo ou efeito externo | capacidades próprias; produção após o MVP-4 |

## 20. Dúvidas resolvidas

| Pergunta | Decisão do PI em 27/09/2026 |
|---|---|
| Qual capacidade ocupa F67/SPEC-067? | malha fiscal preventiva contínua |
| Quais SPEDs entram? | EFD ICMS/IPI F52 e EFD-Contribuições F53 |
| Como obter extrato antes do Open Finance? | importação local CSV/OFX sob contrato normalizado reutilizável |
| A malha edita fontes? | não; navega para a origem e recalcula após nova versão |
| Quando executa? | por evento de nova versão e por solicitação manual |
| Qual tolerância fiscal? | zero centavo em campos semanticamente equivalentes |
| Como vincula banco? | somente regra determinística restrita; ambiguidade exige revisão |
| Banco isolado bloqueia? | não; somente corrobora divergência fiscal já comprovada |
| O que bloqueia fechamento? | crítico aberto, fonte inválida/superada ou cobertura `INDETERMINATE` |
| Qual tamanho? | Grande, mantendo importação, cruzamento, gate, UI e provas na mesma vertical |
| Há questões abertas? | Nenhuma |

## 21. Gate de conformidade documental

- **Identidade:** F67/SPEC-067, MVP-2 e origem no PRD estão explícitos.
- **Comportamento:** importação, execução, casos, correção indireta e gate são observáveis.
- **Aceite:** regras, parser, banco, integração, tela e E2E têm provas verificáveis.
- **Invariantes:** I-1 a I-9, I-11 e I-12 aplicáveis estão declarados.
- **Limites:** não há Open Finance, conciliação financeira, edição de origem ou efeito externo.
- **Dúvidas:** todas as decisões do PI estão registradas; não há questão aberta.
- **Destinos:** cada complemento aponta capacidade e MVP obrigatórios.
- **UI:** referências, estados, temas, viewports, acessibilidade e skills estão explícitos.
- **Tamanho:** Grande; cruzamento triplo, bloqueio preventivo e prova vertical permanecem atômicos.

## 22. Aprovação

Recorte aprovado pelo PI em 27/09/2026 para criação da issue, commit e push direto na `main`.
