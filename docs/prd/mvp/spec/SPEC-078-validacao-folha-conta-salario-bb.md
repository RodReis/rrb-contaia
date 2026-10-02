# SPEC-078 — Validação de folha mensal em conta salário BB por CNAB 240

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F78
> **Issue:** [#92](https://github.com/RodReis/rrb-contaia/issues/92), sub-issue nativa do MVP-2 #31
> **Origem:** PRD §§3, 5.3, 7.1, 12, 13.2, 14, 15 e 16; complemento de F76/SPEC-076 e F77/SPEC-077 aprovado pelo PI em 02/10/2026
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 02/10/2026

## 1. Objetivo e comportamento observável

Conferir localmente a folha mensal líquida externa contra remessa BB CNAB 240 destinada a **conta salário do próprio BB** e acompanhar retornos vinculados. A F78 amplia a modalidade de destino das F76/F77; cada conferência mantém uma empresa, competência e modalidade únicas. Corrente, poupança e conta salário são conferências separadas. O usuário importa referência CSV/JSON e remessa externa, consulta divergências por empregado e anexa retornos. O relatório distingue validade estrutural, correspondência individual e situação bancária observada.

A entrega é somente relatório. Não calcula folha, gera/transmite remessa, executa pagamento ou produz título, proposta, baixa, estorno ou lançamento na F68. Consistência da remessa não comprova aceite, efetivação ou regularidade trabalhista.

## 2. Contrato da referência e compatibilidade

Preservar `schemaVersion = "1"` da F76 para conta corrente e `schemaVersion = "2"` da F77 para corrente/poupança sem reinterpretar arquivos históricos. A referência de conta salário usa `schemaVersion = "2"` com `accountType = "SALARY"` explícito em todas as linhas CSV ou itens JSON. Os demais campos, formatos e regras individuais da v2 permanecem: empresa e competência únicas, CPF válido e único, líquido textual em centavos inteiros não negativos, valor positivo com um destino e data previstos, e líquido zero sem instrução nem destino/data. Valor externo de conta é texto, preservando zeros e dígitos significativos. `bankCode = "001"` é exigido para pagamento positivo.

O tipo declarado deve corresponder à modalidade tecnicamente comprovada na remessa. Não inferir conta salário pelo nome do arquivo, numeração da conta, texto da interface, serviço salarial `30` isolado ou existência de cartão. Tipo ausente, misturado ou divergente, referência parcial e CPF duplicado impedem conclusão positiva. Preservar bytes originais, hashes, erros por linha/campo e revisões.

## 3. Cobertura bancária e bloqueio

A [particularidade pública BB CNAB 240](https://bb.com.br/docs/pub/emp/empl/dwn/PgtVer03BB.pdf), consultada em 02/10/2026, identifica serviço salarial `30`, mas a lista pública de formas de lançamento nela consultada contém corrente `01` e poupança `05`, sem comprovar a modalidade conta salário. O [padrão FEBRABAN 240](https://www.bb.com.br/docs/pub/emp/empl/dwn/Doc3526SegtoE.pdf) cita `04` como **Cartão Salário** para serviço `30`; isso, isoladamente, não comprova que o BB aceita `04` para conta salário, nem a representação do destino ou as ocorrências de retorno. Não equiparar cartão salário, conta salário, conta corrente e poupança.

Versionar pacote técnico oficial aplicável com URL, título, versão, consulta, hash, vigência/compatibilidade, posições, segmentos, forma de lançamento, destino, convênio e ocorrências, mais fixtures verificadas de remessa e retorno. Só concluir positivamente estrutura, comparação ou retorno quando a cobertura BB específica e compatível comprovar aquela modalidade, campo e ocorrência. Evidência ausente, conflitante ou incompatível resulta em `INDETERMINATE` na verificação afetada; diagnósticos conhecidos continuam visíveis. Não reutilizar `01` ou `05`, nem presumir `04`, como fallback. A ausência de pacote/fixtures compatíveis é `not_run` na prova bancária, nunca PASS.

## 4. Comparação, retornos e histórico

Com cobertura comprovada, validar estrutura posicional em bytes, identidade da empresa, convênio, conta pagadora, lote, serviço, forma, segmentos/complementos, sequências, contagens e totais. Comparar individualmente CPF, tipo e destino completo, valor exato em centavos e data prevista. Nome ou total global não substituem a correspondência. Ausente, extra, duplicado, líquido zero pago ou divergência de destino, valor ou data impedem sucesso. Canonização de zeros, brancos e dígitos só vale quando comprovada pelo pacote.

Correlacionar retorno à remessa por identificadores de lote/item comprovados. Preservar rejeição, aceite/agendamento e efetivação apenas quando a ocorrência estiver coberta; agendamento não é pagamento. Ocorrência desconhecida, vínculo ambíguo e sequência conflitante sem resolução comprovada produzem `INDETERMINATE`, sem apagar fatos. Reimportação idêntica no mesmo contexto é idempotente e registra a tentativa; nova entrada ou pacote gera revisão imutável. O relatório identifica versões, hashes e instante da revisão; download não a altera.

## 5. Invariantes, acesso e interface

Aplicam-se as invariantes I-1/I-2 de isolamento por tenant, empresa e carteira; I-3/I-4 de centavos e determinismo; I-5 sem ato externo; I-6/I-7 de evidência e auditoria append-only; I-9 de idempotência; I-11 de datas civis e exibição de instantes em `America/Sao_Paulo`; e I-12 de reprodução histórica. I-8 não cria regra tributária e I-10 não se aplica. Papéis e acesso seguem F76/F77; `auditor_readonly` não altera evidências. Auditar importação, validação, retorno, bloqueio, reprocessamento e download com ator, contexto, instante, `correlationId`, pacote e resultado. Erros usam código estável e `application/problem+json`.

Ampliar a conferência de folha em Financeiro com seleção explícita de conta salário e resultado por empregado para esperado, solicitado e efetivado. Referências de conteúdo/fluxo: `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/` e `docs/telas/prototipo/index.html`; aparência e comportamento seguem `docs/FRONTEND.md`, `docs/DESIGN-SYSTEM.md` e `docs/design-system/`. Mostrar contexto, versões, originais, pacote, divergências por campo, histórico e os três resultados separados. Cobrir vazio, carregando, entrada inválida, cobertura ausente, estrutura inválida, divergente, consistente, retorno pendente/rejeitado/agendado/efetivado, conflito, `INDETERMINATE`, erro e acesso negado. Provar CLARO/ESCURO, responsividade, teclado, foco, contraste, zoom e comparação visual/E2E conforme `docs/FRONTEND.md` §20.1, com `frontend-design` e `impeccable`.

## 6. Critérios de aceite e provas

1. CSV/JSON v2 com `SALARY` explícito e equivalente; v1 corrente e v2 corrente/poupança continuam compatíveis. Tipo inválido, misto, ausente ou divergente não passa.
2. Conta salário só recebe conclusão positiva com manual BB específico e fixtures de remessa/retorno compatíveis; serviço `30` ou FEBRABAN `04` isolados não bastam. Falta de cobertura gera `INDETERMINATE` e prova `not_run`.
3. Com cobertura, estrutura posicional, identidade, contagens, totais e comparação por CPF, destino, centavos e data têm casos positivos e negativos, incluindo líquido zero, duplicidade, ausentes e extras.
4. Retornos cobertos preservam rejeição, agendamento e efetivação; repetições, ambiguidades e ocorrências desconhecidas preservam histórico e bloqueio quando aplicável.
5. Reimportação concorrente não duplica fatos; isolamento, readonly, auditoria e revisão reproduzível são provados; nenhum efeito F68 ou execução bancária é criado.
6. Regras, banco, tela, E2E e prova visual dos dois temas seguem `docs/TESTING.md`, com evidência por SPEC/issue.

## 7. Fora de escopo e destino

| Fora desta fatia | Destino nominal e gatilho |
|---|---|
| Arquivos mistos de modalidades, empresas ou competências | MVP-2: seleção de lotes em arquivos mistos de folha; isolamento e universo de comparação aprovados. |
| Pagamentos divididos e múltiplos contratos por CPF | MVP-2: correspondência agregada de folha externa; chaves e regras aprovadas. |
| Crédito para outros bancos | MVP-2: modalidades adicionais de validação CNAB de folha; manual e fixtures próprios. |
| Adiantamento, 13º, férias e rescisão | MVP-2: tipos adicionais de validação de folha externa; contrato de origem por tipo aprovado. |
| Cálculo, empregados, rubricas, encargos e eSocial | MVP-3: RF-05/folha e departamento pessoal em fatias próprias. |
| Geração, manutenção, transmissão e execução bancária | MVP-2: integração bancária de folha própria; produção somente após MVP-4. |
| Títulos, propostas, baixas e contabilização da folha | MVP-2: integração financeiro-contábil de folha com origens, revisão e vínculos próprios. |

## 8. Decisões do PI e gate documental

PI aprovou em 02/10/2026: usar F78/SPEC-078 para conta salário BB, ampliar a validação F76/F77, preservar as versões de referência anteriores, manter uma modalidade por conferência e resultado somente em relatório. Questões de produto abertas: **nenhuma**. A cobertura operacional de conta salário permanece condicionada à evidência BB específica e às fixtures; a aprovação documental não a presume.
