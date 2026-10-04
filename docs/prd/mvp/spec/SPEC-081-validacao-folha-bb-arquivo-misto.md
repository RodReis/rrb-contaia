# SPEC-081 — Validação de folha BB em arquivo com empresas e competências mistas

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F81
> **Issue:** [#102](https://github.com/RodReis/rrb-contaia/issues/102), sub-issue nativa do MVP-2 #31
> **Origem:** PRD §§3, 5.3, 7.1, 12, 13.2, 14, 15 e 16; complemento de arquivos mistos das F76–F80
> **Tamanho:** Grande — estende importação, atribuição de lotes, comparação, retorno e interface
> **Estado:** aprovada pelo PI em 04/10/2026

## 1. Resultado observável

Conferir localmente uma remessa BB CNAB 240 que contém lotes de empresas ou competências diferentes. Cada conferência e relatório pertence a **um par empresa/competência**. O usuário importa remessa, manifesto de atribuição e uma referência de folha externa para cada par, acompanha diagnósticos por lote e empregado e anexa retornos. O arquivo compartilhado permanece uma evidência única e imutável; cada par recebe uma visão segregada, sem copiar ou alterar seus bytes.

A F81 amplia F76–F80 apenas na atribuição de lotes entre pares. As regras já aprovadas de conta corrente, poupança, conta salário, modalidades entre lotes ou intralote, comparação individual, retornos e cobertura bancária continuam aplicáveis. Não calcula folha, gera ou transmite remessa, executa pagamento, cria título/proposta/baixa/estorno F68 nem lança contabilidade. Consistência local não comprova aceite ou efetivação bancária.

## 2. Entradas, atribuição e universo

O manifesto externo versionado identifica a remessa por hash do arquivo original e associa **cada número de lote do arquivo** a exatamente um `companyCnpj` e uma `competence` civil (`AAAA-MM`). O par precisa ter referência CSV/JSON compatível com F76–F80; a competência vem dessa referência e do manifesto, **nunca** da data bancária. Identificação da empresa, convênio e conta pagadora no CNAB precisam corresponder ao par conforme campos e evidência técnica cobertos. O manifesto não substitui prova bancária de que o arquivo misto é aceito.

Aceitar apenas empresas às quais o ator tenha acesso dentro do mesmo tenant e carteira. Empresa fora desse contexto impede a importação do conjunto; nenhum relatório, original ou diagnóstico de outro contexto é exposto. Cada lote inteiro pertence a um par: instrução de outra empresa/competência dentro dele é divergência ou indeterminação conforme a evidência disponível, nunca redistribuição automática por CPF, conta, valor ou data. Lote ausente, duplicado, inexistente, par sem referência, referência com par divergente ou atribuição ambígua impedem conclusão positiva.

Validar a estrutura, contagens, totais e atribuição do **arquivo completo** antes de concluir qualquer par positivamente. Cada relatório compara a referência integral do par a todos os seus lotes, sem escolher subconjunto conveniente. Falha conhecida em qualquer lote, ou lote não atribuído, bloqueia conclusão positiva de todos os pares; o relatório de cada um mantém seus diagnósticos comprovados. Ausência de cobertura técnica sobre a estrutura compartilhada produz `INDETERMINATE` nas verificações afetadas e em todas as conclusões dependentes. Não converter erro conhecido em `INDETERMINATE` para ocultá-lo.

## 3. Correspondência, cobertura BB e retornos

Reutilizar os formatos e regras individuais das F76–F80, inclusive `schemaVersion = "2"` e `accountType` (`CHECKING`, `SAVINGS`, `SALARY`) quando exigidos. Preservar v1 somente nos fluxos anteriormente cobertos e não reinterpretar históricos. Comparar CPF, tipo quando aplicável, destino completo, centavos exatos e data prevista; CPF único por par, líquido zero sem instrução, ausência, extra e duplicidade impedem resultado positivo. Não agregar pagamentos divididos nem múltiplos contratos por CPF.

Versionar pacote técnico BB com URL, título, versão, data de consulta, hash, vigência/compatibilidade, posições, serviço, forma, segmentos e ocorrências, além de fixtures de remessa e retorno compatíveis com **arquivo de múltiplas empresas/competências**. Manual de modalidade isolada, padrão FEBRABAN ou semelhança de campos não comprovam essa capacidade BB. Sem pacote e fixtures compatíveis, manter os diagnósticos locais comprovados, classificar a verificação afetada e a conclusão dependente como `INDETERMINATE` e registrar prova bancária `not_run`, nunca PASS. Contradição comprovada por regra coberta é divergência estrutural.

Correlacionar retorno ao arquivo, lote e item apenas por identificadores cobertos, preservando rejeição, aceite/agendamento e efetivação em suas respectivas revisões e pares. Agendamento não é pagamento. Retorno de outro par, ocorrência desconhecida, vínculo ambíguo ou sequência sem resolução documentada não é atribuído por aproximação e mantém a parte afetada `INDETERMINATE`. Reimportação idêntica no mesmo contexto reutiliza evidência e registra tentativa; mudança no arquivo, manifesto, referência ou pacote cria revisão imutável. Originais, hashes, diagnósticos, eventos e versões permanecem reproduzíveis.

## 4. Invariantes, acesso e interface

Aplicam-se `docs/CONVENTION.md` I-1/I-2 (tenant, empresa, carteira e ausência de dados sem contexto), I-3/I-4 (centavos e determinismo), I-5 (sem ato externo), I-6/I-7 (evidência e auditoria append-only), I-9 (idempotência), I-11 (competência civil e exibição de instantes em `America/Sao_Paulo`) e I-12 (reprodução histórica). O arquivo físico compartilhado não concede leitura cruzada: consultas e downloads obedecem ao contexto autorizado. Papéis seguem F76–F80; `auditor_readonly` não modifica evidência. Auditar importação, atribuição, comparação, retorno, bloqueio, reprocessamento e download com ator, contexto, instante, `correlationId`, versões e resultado. Erros usam código estável e `application/problem+json`.

Ampliar a conferência em Financeiro com seleção de par, lista de lotes atribuídos, integridade do arquivo, manifesto, referências, originais, pacote, divergências por campo, retorno e conclusão de cada par. Mostrar por que uma falha em outro lote bloqueia a conclusão positiva do par selecionado, sem revelar dados de empresa não autorizada. Conteúdo e fluxo partem de `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/`; aparência e comportamento seguem `docs/FRONTEND.md`, `docs/DESIGN-SYSTEM.md` e `docs/design-system/`. Cobrir vazio, carregando, manifesto inválido, acesso negado, cobertura ausente, divergência, consistente, retorno pendente/rejeitado/agendado/efetivado, conflito, `INDETERMINATE` e erro. Provar temas CLARO/ESCURO, 375/768/1280/1536 px, teclado, foco, contraste, zoom e comparação visual/E2E conforme `docs/FRONTEND.md` §20.1, com `frontend-design` e `impeccable`.

## 5. Critérios de aceite

1. Manifesto completo e unívoco associa cada lote inteiro a um par autorizado; CSV/JSON equivalentes por par produzem a mesma comparação, sem inferir competência da data bancária.
2. Arquivo íntegro com vários pares gera relatórios separados. Lote ausente/duplicado no manifesto, par divergente, item deslocado ou falha estrutural em outro lote bloqueia conclusão positiva de todos, preservando diagnósticos próprios.
3. Comparação por empregado e modalidade reutiliza F76–F80, detecta CPF/tipo/destino/centavos/data divergentes, zero pago, ausências e extras; históricos v1/v2 não mudam.
4. Sem manual e fixtures BB compatíveis com a mistura real, resultado dependente `INDETERMINATE` e prova bancária `not_run`; com cobertura, provar casos positivos e negativos, inclusive retorno por lote/item.
5. Testar isolamento por tenant/carteira/empresa, importação concorrente, revisão, idempotência, readonly, acesso negado e ausência de efeito F68 com evidência rastreável de regras e banco.
6. Testes de tela e E2E cobrem estados, dois temas, responsividade e prova visual conforme `docs/TESTING.md` e `docs/FRONTEND.md`.

## 6. Fora de escopo e destino

| Fora desta fatia | Destino nominal e gatilho |
|---|---|
| Empresas/competências diferentes dentro do mesmo lote | MVP-2: atribuição por item em arquivo misto; contrato de origem, isolamento e prova BB específicos aprovados. |
| Pagamentos divididos ou múltiplos contratos por CPF | MVP-2: correspondência agregada de folha externa; chaves e regra de agregação aprovadas. |
| Arquivos entre tenants/carteiras distintos | MVP-2: compartilhamento intercontexto de evidência; autorização e isolamento próprios aprovados. |
| Outros bancos, adiantamento, 13º, férias e rescisão | MVP-2: modalidades e tipos adicionais de validação; contratos de origem, manuais e fixtures próprios. |
| Cálculo de folha, empregados, rubricas, encargos e eSocial | MVP-3: RF-05/folha e departamento pessoal. |
| Geração, manutenção, transmissão e execução bancária | MVP-2: integração bancária de folha própria; produção somente após MVP-4. |
| Títulos, propostas, baixas e contabilização da folha | MVP-2: integração financeiro-contábil de folha com origens, revisão e vínculos próprios. |

## 7. Decisões do PI e gate documental

PI aprovou em 04/10/2026: F81/SPEC-081 para arquivo misto por empresa/competência, com um par por lote; conferência e relatório por par; manifesto externo explícito; somente empresas autorizadas do mesmo tenant/carteira; integridade e atribuição de todo o arquivo impedem conclusão positiva de qualquer par quando falham. Questões de produto abertas: **nenhuma**. A aprovação documental não presume cobertura operacional BB.
