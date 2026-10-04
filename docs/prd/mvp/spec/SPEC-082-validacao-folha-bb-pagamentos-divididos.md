# SPEC-082 — Validação de folha BB com pagamentos divididos por contrato

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F82
> **Issue:** [#103](https://github.com/RodReis/rrb-contaia/issues/103), sub-issue nativa do MVP-2 #31
> **Origem:** PRD §§3, 5.3, 7.1, 12, 13.2, 14, 15 e 16; complemento de pagamentos divididos das F76–F81
> **Tamanho:** Grande — estende referência, correspondência, retornos e interface
> **Estado:** aprovada pelo PI em 04/10/2026

## 1. Resultado observável

Conferir localmente vários créditos BB CNAB 240 previstos para o mesmo CPF e **um único contrato** na folha mensal líquida externa. A referência CSV/JSON declara cada parcela com identificador estável, valor em centavos, data prevista, tipo de conta e destino completos. Parcelas do contrato podem ter datas e destinos diferentes. A conferência mostra resultado por parcela e por contrato, inclusive efetivação parcial comprovada por retorno. Não calcula folha, gera ou transmite remessa, executa pagamento nem cria título, proposta, baixa, estorno ou lançamento F68.

A F82 reutiliza as modalidades e a atribuição por empresa/competência das F76–F81, inclusive arquivo com pares diferentes entre lotes. Cada relatório permanece segregado por par do mesmo tenant/carteira; um lote continua pertencendo integralmente a um par. Consistência da remessa não comprova aceite, efetivação ou quitação bancária.

## 2. Referência externa e universo

Introduzir `schemaVersion = "3"` para a referência CSV/JSON de pagamentos divididos. Preservar v1/v2 e suas revisões sem conversão automática. A v3 mantém `companyCnpj`, `competence` civil (`AAAA-MM`) e `employeeCpf` da folha; para cada CPF há um único contrato nesta fatia, com `netAmount` mensal declarado e lista de parcelas. Cada parcela contém `installmentId` estável e único dentro do CPF/contrato, `accountType` (`CHECKING`, `SAVINGS`, `SALARY`), `bankCode`, `agency`, `agencyDigit`, `account`, `accountDigit`, `installmentAmount` e `expectedPaymentDate`. Valores seguem o formato decimal textual de duas casas da v1/v2 e são convertidos a centavos inteiros antes da comparação; documentos, destino e data continuam strings. CSV UTF-8 separa campos por ponto e vírgula, com uma linha por parcela positiva e uma linha sem campos de parcela para líquido zero, repetindo contexto, CPF e líquido; JSON representa parcelas sob o item do CPF. Aceitar BOM e LF/CRLF como diferenças de transporte e publicar modelos equivalentes. Preservar bytes originais, hash e versão da referência.

Líquido positivo dividido exige ao menos duas parcelas positivas e soma exata dos `installmentAmount` em centavos igual ao `netAmount`; líquido zero conserva o CPF sem parcela nem instrução. No CSV, linhas do mesmo CPF repetem o mesmo contexto, nome e líquido e compõem um único contrato; divergência nesses campos, líquido negativo, parcela zero/negativa, ID vazio/duplicado, CPF duplicado como contrato independente no JSON, soma divergente ou parcela incompleta invalidam a referência para conclusão positiva. Duas parcelas podem ter os mesmos valor, data e destino se tiverem IDs distintos. Ordem de linha ou de array não altera sua identidade. Não inferir competência da data de crédito nem aceitar vários contratos para o mesmo CPF nesta fatia.

Em arquivo F81, a referência v3 é própria de cada par; o manifesto atribui cada lote inteiro a um par autorizado. Validar integridade, contagens, totais e atribuição do arquivo completo antes de concluir qualquer par positivamente. Falha conhecida ou lote sem atribuição bloqueia a conclusão positiva de todos os pares, preservando diagnósticos locais. Acesso a arquivo, referência, relatório e download segue tenant, empresa e carteira.

## 3. Correspondência, cobertura BB e retornos

Comparar o conjunto completo de parcelas previstas com as instruções do par por CPF, tipo de conta, destino, centavos e data. `installmentId` identifica a parcela na referência e nas revisões; só se vincula à instrução CNAB por identificadores e posições comprovados pelo pacote BB. Parcelas com campos bancários idênticos exigem desambiguação técnica comprovada: sem ela, o vínculo permanece `INDETERMINATE`, nunca é escolhido por ordem de arquivo. Detectar parcela ausente, crédito extra, duplicidade, CPF indevido e divergência por campo. Igualdade da soma por CPF ou do total do arquivo não substitui correspondência individual.

Versionar pacote técnico BB com URL, título, versão, data de consulta, hash, vigência/compatibilidade, serviço, forma, segmentos, posições e ocorrências, além de fixtures de remessa e retorno para **créditos divididos do mesmo contrato** e para a configuração de modalidade/lote/arquivo realmente analisada. Manual de crédito único, padrão FEBRABAN ou soma local não comprovam pagamentos divididos. Sem pacote e fixtures compatíveis, manter diagnósticos locais comprovados, classificar verificações dependentes como `INDETERMINATE` e a prova bancária como `not_run`, nunca PASS. Contradição de regra coberta permanece divergência conhecida.

Correlacionar retornos à remessa, lote, item e parcela somente pelos identificadores cobertos. Preservar eventos e revisões de rejeição, aceite/agendamento e efetivação. Agendamento não é efetivação. Se somente parte das parcelas tiver efetivação comprovada, mostrar cada situação e o contrato como **parcialmente efetivado**, sem declarar quitação integral. Retorno ambíguo, ocorrência desconhecida ou sequência não resolvida deixa a parte afetada `INDETERMINATE`, sem ocultar eventos comprovados. Reimportação idêntica no mesmo contexto reutiliza evidência e registra tentativa; alteração de referência, remessa, manifesto ou pacote cria revisão imutável.

## 4. Invariantes, acesso e interface

Aplicam-se `docs/CONVENTION.md` I-1/I-2 (isolamento), I-3/I-4 (centavos e determinismo), I-5 (sem ato externo), I-6/I-7 (evidência append-only), I-9 (idempotência), I-11 (datas civis) e I-12 (reprodução histórica). Papéis seguem F76–F81; `auditor_readonly` não modifica evidência. Auditar importação, comparação, retorno, bloqueio, revisão e download com ator, contexto, instante, `correlationId`, versões e resultado. Erros usam código estável e `application/problem+json`.

Ampliar a conferência em Financeiro com líquido declarado, soma, parcelas previstas, instruções encontradas, divergências por campo, situação bancária por parcela e situação agregada do contrato. Em arquivo misto, manter seleção e relatório por par e indicar falha global sem expor dados de outra empresa. Conteúdo e fluxo partem de `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/`; aparência e comportamento seguem `docs/FRONTEND.md`, `docs/DESIGN-SYSTEM.md` e `docs/design-system/`. Cobrir vazio, carregando, entrada inválida, cobertura ausente, divergência, consistente, retorno pendente/rejeitado/agendado/parcialmente efetivado/efetivado, conflito, `INDETERMINATE`, erro e acesso negado. Provar CLARO/ESCURO, 375/768/1280/1536 px, teclado, foco, contraste, zoom e comparação visual/E2E conforme `docs/FRONTEND.md` §20.1, com `frontend-design` e `impeccable`.

## 5. Critérios de aceite

1. Referências CSV e JSON v3 equivalentes produzem a mesma comparação; v1/v2 e relatórios históricos não mudam. IDs distintos permitem parcelas com campos idênticos sem atribuição por ordem.
2. Para um CPF/contrato, líquido positivo equivale à soma exata das parcelas; zero não admite instrução. Soma incorreta, ID/CPF duplicado, parcela inválida, ausência, extra ou divergência por campo impedem conclusão positiva.
3. Conferir parcelas com datas e destinos próprios nas modalidades cobertas por F76–F80 e em arquivo misto F81; falha de integridade/atribuição global impede conclusão positiva de todos os pares.
4. Sem manual e fixtures BB compatíveis com pagamentos divididos e a configuração testada, resultado dependente `INDETERMINATE` e prova `not_run`; com cobertura, provar cenários positivos, negativos e duas parcelas de campos iguais.
5. Retornos preservam cada evento e demonstram rejeição, agendamento, efetivação parcial e integral sem efeito F68 nem inferência de quitação por soma ou agendamento.
6. Testar isolamento por tenant/carteira/empresa, importação concorrente, revisão, idempotência, readonly, acesso negado, regras, banco, tela e E2E com evidência rastreável conforme `docs/TESTING.md`.
7. Testes visuais cobrem ambos os temas, estados, responsividade e acessibilidade conforme `docs/FRONTEND.md`.

## 6. Fora de escopo e destino

| Fora desta fatia | Destino nominal e gatilho |
|---|---|
| Vários contratos por CPF, inclusive parcela de cada contrato | MVP-2: correspondência por contrato de origem; identificador contratual, regra de agregação e referência externa aprovados. |
| Empresas/competências diferentes dentro do mesmo lote | MVP-2: atribuição por item em arquivo misto; contrato de origem, isolamento e prova BB específicos aprovados. |
| Arquivos entre tenants/carteiras distintos | MVP-2: compartilhamento intercontexto de evidência; autorização e isolamento próprios aprovados. |
| Outros bancos, adiantamento, 13º, férias e rescisão | MVP-2: modalidades e tipos adicionais de validação; contratos de origem, manuais e fixtures próprios. |
| Cálculo de folha, empregados, rubricas, encargos e eSocial | MVP-3: RF-05/folha e departamento pessoal. |
| Geração, manutenção, transmissão e execução bancária | MVP-2: integração bancária de folha própria; produção somente após MVP-4. |
| Títulos, propostas, baixas e contabilização da folha | MVP-2: integração financeiro-contábil de folha com origens, revisão e vínculos próprios. |

## 7. Decisões do PI e gate documental

PI aprovou em 04/10/2026: F82/SPEC-082 para pagamentos divididos de um contrato por CPF; parcelas explícitas em CSV/JSON, cada qual com ID estável, valor, data e destino próprios; cobertura também dos arquivos mistos F81; situação parcial quando apenas parte estiver efetivada. Questões de produto abertas: **nenhuma**. A aprovação documental não presume cobertura operacional BB.
