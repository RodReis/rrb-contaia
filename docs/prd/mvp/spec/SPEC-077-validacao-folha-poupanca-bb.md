# SPEC-077 — Validação de folha mensal em poupança BB por CNAB 240

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F77
> **Issue:** [#91](https://github.com/RodReis/rrb-contaia/issues/91), sub-issue nativa do MVP-2 #31
> **Origem:** PRD §§3, 5.3, 7.1, 12, 13.2, 14, 15 e 16; complemento de F76/SPEC-076 aprovado pelo PI em 02/10/2026
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 02/10/2026

## 1. Objetivo e comportamento observável

Conferir localmente uma folha mensal líquida externa contra remessa BB CNAB 240 de crédito em **conta poupança do próprio BB** e acompanhar seus retornos. A F77 estende a F76 somente quanto à modalidade de destino e ao contrato de referência necessário para declará-la. Cada conferência pertence a uma empresa, competência e modalidade única. Conta corrente e poupança são conferências separadas; arquivo misto permanece fora do recorte.

Em Financeiro, o usuário escolhe empresa, competência e poupança BB, importa referência CSV/JSON e remessa externa, consulta divergências por empregado e anexa retornos vinculados. O relatório separa validade estrutural, correspondência individual e situação bancária observada. Consistência de remessa não comprova aceite, pagamento ou regularidade trabalhista. A entrega é somente relatório: não calcula folha, gera/transmite remessa, executa pagamento ou produz título, proposta, baixa, estorno ou lançamento na F68.

## 2. Referência externa e compatibilidade

O contrato F76 `schemaVersion = "1"` continua válido e imutável para conta corrente BB. A F77 introduz `schemaVersion = "2"` em CSV e JSON, preservando os campos, formatos, validações e semântica da F76 e acrescentando `accountType` obrigatório. O domínio coberto é `CHECKING` para conta corrente BB e `SAVINGS` para poupança BB; valores externos são identificadores textuais, sem conversão numérica. Em CSV, acrescentar `accountType` ao fim do cabeçalho v1, repetido por empregado; em JSON, acrescentá-lo a cada item de `employees`. Os modelos publicados explicam as duas versões.

Uma conferência de poupança exige v2 e `accountType = "SAVINGS"` em todas as linhas; uma conferência de corrente aceita v1 ou v2 com `CHECKING`. Não inferir tipo pela numeração da conta, nome do arquivo ou escolha visual isolada. Referência com modalidades misturadas, tipo ausente/inválido ou divergente da remessa não recebe conclusão positiva. `bankCode = "001"` continua obrigatório para pagamento positivo; agência, dígito, conta, dígito e eventual representação própria de poupança seguem o pacote técnico BB comprovado, preservando dígitos significativos.

Mantêm-se as regras F76: uma empresa/competência; CPF válido e único; líquido textual não negativo em centavos inteiros; valor positivo exige exatamente uma instrução; líquido zero exige ausência de pagamento e destino/data vazios; duplicidade ou qualquer linha inválida impede sucesso global. Preservar bytes originais, hashes, erros por linha/campo e revisões. A v2 não migra nem reinterpreta retrospectivamente referências v1.

## 3. Remessa e cobertura técnica

Referência oficial inicial: [BB — CNAB 240, Arquivo de Pagamentos, Particularidades BB](https://bb.com.br/docs/pub/emp/empl/dwn/PgtVer03BB.pdf), consultada em 02/10/2026. O documento publicado identifica serviço salarial `30` e forma de lançamento em poupança `05`. Isso **não comprova** vigência operacional, contrato habilitado, representação de todas as contas ou semântica de todas as ocorrências.

Versionar pacote técnico com URL, título, versão, data de consulta, hash, vigência/compatibilidade, posições, regras de preenchimento, complementos oficiais e fixtures verificadas por segmento e ocorrência. Incorporar norma FEBRABAN aplicável quando necessária. Só concluir positivamente uma remessa homogênea de inclusão salarial BB para poupança com estrutura, lote, serviço, forma, segmentos/complementos, CPF do favorecido, identidade da empresa, convênio, conta pagadora, sequências, contagens e totais cobertos. Vários lotes da mesma modalidade são permitidos conforme F76. A estrutura posicional é lida em bytes da codificação coberta.

Modalidade, versão, instrução, campo de destino, segmento ou ocorrência sem cobertura comprovada impede conclusão positiva. Evidência ausente, contraditória ou incompatível produz `INDETERMINATE` na verificação afetada, preservando diagnósticos conhecidos. Não corrigir, converter nem gerar remessa. A conta salário BB, transferência a outros bancos e arquivos mistos não são equivalentes à poupança `05`.

## 4. Correspondência, retornos e histórico

Comparar individualmente CPF, tipo e destino bancário completo, valor exato em centavos e data prevista contra a instrução da remessa. Nome e soma global não resolvem identidade ou divergência. CPF duplicado/ausente, pagamento extra, líquido zero pago, modalidade, conta, valor ou data divergentes impedem resultado positivo. Aplicar apenas a canonização de zeros, brancos e dígitos comprovada pelo pacote técnico.

Retornos pertencem a remessa importada e são correlacionados por identificadores de lote/item comprovados, nunca apenas por CPF, nome, conta, valor ou escolha manual incompatível. Preservar rejeição, aceite/agendamento e efetivação quando a ocorrência estiver coberta; agendamento não é pagamento. Comparar valor e data efetivados com os previstos. Retorno desconhecido, vínculo ambíguo ou sequência conflitante sem resolução comprovada gera `INDETERMINATE`, sem apagar fatos anteriores.

Reimportação idêntica no mesmo contexto reutiliza evidência e registra a tentativa; nova referência, remessa ou pacote cria revisão imutável. O relatório identifica versões, hashes e instante da revisão. Download não altera a revisão. Nenhum retorno altera a F68 ou os fluxos F70–F76.

## 5. Invariantes globais tocados

| CONVENTION.md §2 | Aplicação |
|---|---|
| I-1 e I-2 | Tenant, empresa, carteira e RLS isolam referências, arquivos, retornos e relatórios; consulta sem contexto não retorna dados. |
| I-3 e I-4 | Comparação determinística em centavos; sem float, cálculo de folha ou LLM. |
| I-5 | Relatório não autoriza ato externo ou pagamento. |
| I-6 e I-7 | Originais, revisões, diagnósticos, retornos e auditoria são preservados sem apagar evidência trabalhista. |
| I-8 | Sem regra tributária; a cobertura técnica é aplicada pela versão/compatibilidade evidenciada. |
| I-9 | Importações e reprocessamentos idempotentes, embora não haja efeito externo. |
| I-11 | Competência/data são civis; instantes auditáveis aparecem em America/Sao_Paulo. |
| I-12 | Revisão histórica reproduz resultado com entradas e pacote congelados. |

Papéis e acesso seguem os contratos do módulo e da F76; `auditor_readonly` não modifica evidências. Auditar importação, validação, comparação, retorno, bloqueio, reprocessamento e download com ator, contexto, instante, `correlationId`, versão e resultado. Erros usam código estável e `application/problem+json`. I-10 não é acionado: não há certificado, assinatura ou cofre.

## 6. Interface

Ampliar a conferência de folha em Financeiro com modalidade explícita, modelo v2 e resultado por empregado que mostre tipo de conta, esperado, solicitado e efetivado. Referências de conteúdo e fluxo: `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/code.html`, `screen.png` e `docs/telas/prototipo/index.html`. Aparência e comportamento obedecem `docs/FRONTEND.md`, `docs/DESIGN-SYSTEM.md` e `docs/design-system/`.

Exibir contexto, versões, pacote técnico, originais, três dimensões do resultado, divergências por campo e histórico de retornos. Estados: vazio, carregando, importando, entrada inválida, cobertura ausente, estrutura inválida, divergente, consistente, retorno pendente/rejeitado/agendado/efetivado, conflito, `INDETERMINATE`, erro recuperável e acesso negado. Não mostrar ação de geração, transmissão, pagamento ou baixa. Provar CLARO/ESCURO, 375/768/1280/1536 px, teclado, foco, contraste e zoom, com `frontend-design`, `impeccable` e comparação visual/E2E conforme `docs/FRONTEND.md` §20.1.

## 7. Critérios de aceite e provas

1. CSV e JSON v2 equivalentes com `accountType` obrigatório; v1 F76 continua válida para corrente e não passa como poupança. Campos inválidos, modalidade misturada ou referência parcial não recebem sucesso global.
2. Remessa salarial `30`/poupança `05` é validada posicionalmente com pacote e fixtures compatíveis; conta corrente `01`, conta salário, outros bancos, versão desconhecida e arquivo misto não são aceitos como poupança coberta.
3. Correspondência individual exata de CPF, tipo/destino, centavos e data, inclusive provas negativas para ausentes, extras, duplicados, líquido zero e diferenças em dígitos da conta.
4. Retornos rejeitados, agendados e efetivados com vínculo comprovado, repetições, ambiguidades, conflito e ocorrência desconhecida preservam histórico e `INDETERMINATE` quando aplicável.
5. Reimportação concorrente não duplica fatos; revisão/download permanecem estáveis; isolamento de tenant/empresa/carteira, readonly e trilha append-only são comprovados; não surge efeito F68 nem execução bancária.
6. Regras, banco, tela, E2E e prova visual dos dois temas seguem `docs/TESTING.md`, com evidência por SPEC/issue. Cobertura bancária sem manual/fixture compatível é `not_run` na prova afetada, nunca PASS.

## 8. Fora de escopo e destino dos complementos

| Fora desta fatia | Destino nominal e gatilho |
|---|---|
| Conta salário BB e crédito para outros bancos | MVP-2: modalidades adicionais de validação CNAB de folha; recorte, manual oficial e fixtures próprios. |
| Arquivos mistos de corrente/poupança ou por empresa/competência | MVP-2: seleção de lotes em arquivos mistos de folha; isolamento e universo de comparação aprovados. |
| Pagamentos divididos e múltiplos contratos por CPF | MVP-2: correspondência agregada de folha externa; chave/agrupamento e regras aprovados. |
| Adiantamento, 13º, férias e rescisão | MVP-2: tipos adicionais de validação de folha externa; contrato de origem por tipo aprovado. |
| Cálculo, empregados, rubricas, encargos e eSocial | MVP-3: RF-05/folha e departamento pessoal em fatias próprias. |
| Geração, manutenção, transmissão ou execução bancária | MVP-2: integração bancária de folha própria, com contrato específico; produção somente após MVP-4. |
| Títulos, propostas, baixas e contabilização da folha | MVP-2: integração financeiro-contábil de folha, com origens/revisão/vínculos próprios. |

## 9. Decisões do PI e gate documental

PI aprovou em 02/10/2026: F77 para poupança BB, reaproveitamento das regras F76, `accountType` explícito em `schemaVersion = "2"` preservando v1 para corrente, e conferências separadas por modalidade. A entrega é somente relatório; os complementos acima permanecem nas fatias indicadas.

Questões abertas: **Nenhuma**. A cobertura bancária operacional depende de evidência técnica versionada na implementação e não é presumida pela aprovação documental.
