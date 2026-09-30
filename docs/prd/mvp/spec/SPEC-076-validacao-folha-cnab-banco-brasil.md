# SPEC-076 — Validação de folha mensal BB por CNAB 240

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F76
> **Issue:** [#90](https://github.com/RodReis/rrb-contaia/issues/90), sub-issue nativa do MVP-2 #31
> **Origem:** PRD §§3, 5.3, 7.1, 12, 13.2, 14, 15 e 16; recorte aprovado pelo PI em 30/09/2026
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 30/09/2026

## 1. Objetivo e comportamento observável

Conferir localmente uma folha mensal líquida externa contra remessa BB CNAB 240 e acompanhar seus retornos bancários. Cada conferência pertence a uma empresa e competência, cobre somente crédito em conta corrente no próprio BB e produz relatório rastreável. Não calcula folha, gera/transmite remessa, executa pagamento nem cria título, baixa ou proposta financeira na F68.

Em Financeiro, o usuário seleciona empresa e competência, importa referência CSV ou JSON e remessa externa, consulta divergências por empregado e anexa retornos vinculados à remessa. O relatório separa validade estrutural, correspondência com a folha e situação bancária observada. Remessa consistente não comprova aceite bancário, pagamento realizado ou regularidade trabalhista.

A fatia é Grande pela combinação de dois formatos de referência, validação posicional, comparação individual, histórico de retornos e interface final. O desenvolvimento e a homologação ocorrem em Docker local; não há produção durante MVPs 1–4.

## 2. Referência externa e contrato de importação

Receber referência e remessa exclusivas da empresa selecionada e de uma competência. A competência vem da referência externa, nunca da data bancária. Não antecipar cadastro ou cálculo de empregados do RF-05/MVP-3. A referência declara os valores esperados; não comprova o cálculo que os originou.

Contrato `schemaVersion = "1"`, equivalente em CSV e JSON:

| Campo | Contrato |
|---|---|
| `schemaVersion` | string `"1"` |
| `companyCnpj` | string de 14 dígitos, CNPJ válido da empresa selecionada |
| `competence` | string `AAAA-MM`, mês válido igual ao contexto |
| `employeeCpf` | string de 11 dígitos, CPF válido e único na empresa/competência |
| `employeeName` | string não vazia; informativo, sem correspondência por nome |
| `bankCode` | string `"001"` para pagamento positivo |
| `agency`, `agencyDigit` | strings; domínio, tamanho e dígito conforme pacote BB coberto |
| `account`, `accountDigit` | strings; domínio, tamanho e dígito conforme pacote BB coberto |
| `netAmount` | decimal textual não negativo, ponto decimal e exatamente duas casas; sem separador de milhar, convertido para centavos inteiros |
| `expectedPaymentDate` | data civil `AAAA-MM-DD` válida para pagamento positivo |

CSV: UTF-8, separador ponto e vírgula, cabeçalho com esses campos nessa ordem e uma linha por empregado. Aceitar BOM e terminadores LF/CRLF como diferenças de transporte, preservando os bytes originais. Todos os campos de contexto se repetem por linha e precisam coincidir. JSON: objeto com `schemaVersion`, `companyCnpj`, `competence` e array `employees`; cada item contém os demais campos da tabela. Usar strings também para documentos, destino, data e valor, sem conversão de identificador para número. Publicar modelos e exemplos equivalentes no fluxo de importação.

Líquido positivo exige exatamente uma instrução de pagamento. Líquido zero mantém o empregado na referência e exige ausência de instrução; destino bancário e data ficam vazios no CSV ou nulos no JSON. Valores negativos invalidam a referência. Não agregar linhas duplicadas por CPF, inclusive em contratos distintos do mesmo empregado: esse caso requer complemento próprio.

Reportar todos os erros identificáveis por linha/campo, sem corrigir a fonte silenciosamente. Referência malformada, vazia, com linha inválida ou CPF duplicado não pode produzir correspondência global positiva nem validar somente um subconjunto como se fosse a folha completa. Não aplicar a regra de importação parcial de onboarding ao universo de comparação desta fatia.

## 3. Remessa e cobertura técnica

Fonte oficial inicial consultada em 30/09/2026: [BB — CNAB 240, Arquivo de Pagamentos, Particularidades BB](https://bb.com.br/docs/pub/emp/empl/dwn/PgtVer03BB.pdf), versão identificada julho/2019. A publicação descreve serviço salarial `30`, forma de lançamento em conta corrente `01` e segmentos A/B. Sua disponibilidade não comprova vigência operacional atual de todos os serviços.

O pacote técnico versionado exige URL, título, versão, data de consulta, hash, vigência/compatibilidade identificada, regras posicionais, complementos oficiais e fixtures verificadas por versão, modalidade, segmento e ocorrência. Incorporar norma FEBRABAN aplicável quando necessária. Não transcrever erro aparente de tabela como regra nem ampliar cobertura por analogia com fornecedores, poupança, Pix ou transferências.

Cobrir remessa externa de inclusão salarial em conta corrente BB, banco `001`, serviço `30` e forma `01`, permitindo vários lotes cobertos dentro da mesma empresa/competência. Exigir identificação CPF do favorecido e vínculo inequívoco entre pagamento e seus complementos; ausência de CPF/complemento impede comparação positiva, mesmo quando o banco aceite um arquivo menos informativo. Não afirmar que essa exigência de comparação é obrigatoriedade bancária universal.

Validar estrutura completa, comprimento de registros, codificação, posições, tipos, preenchimentos, headers/trailers, sequências, lotes, segmentos/complementos, identidade da empresa, convênio, conta pagadora, beneficiários, instruções, contagens e totais conforme o pacote. A estrutura posicional é avaliada sobre bytes na codificação coberta, sem normalização que altere offsets. Vários lotes não autorizam modalidades, empresas ou instruções fora do recorte. Retorno não pode ser interpretado como remessa e vice-versa.

Modalidade, instrução, versão ou segmento sem cobertura impedem conclusão positiva. Evidência técnica ausente, contraditória ou incompatível resulta em `INDETERMINATE` para a verificação afetada. Preservar diagnósticos conhecidos sem apresentar o arquivo inteiro como validado. Não reescrever bytes, trocar modalidade nem gerar arquivo corrigido.

## 4. Correspondência e retornos

Comparar CPF, destino bancário completo, valor em centavos e data prevista com a data solicitada no CNAB. Preenchimentos posicionais de zeros/brancos e `X` seguem a representação canônica explicitamente documentada pelo pacote; não eliminar dígitos significativos. Nome não resolve identidade. Não usar LLM, similaridade, tolerância monetária ou soma de pagamentos divididos.

Mostrar correspondência individual e divergências por campo. CPF duplicado, empregado ausente, pagamento extra, pagamento para líquido zero, conta/data/valor divergentes ou identidade ausente/ambígua impedem resultado positivo. Totais iguais não substituem conferência individual. Correção da referência ou remessa cria nova revisão e novo resultado; não apaga ou altera a anterior.

Receber retornos vinculados a uma remessa já importada. Validar seu formato e contexto, correlacionar lote e item pelos identificadores comprovados do pacote técnico e preservar cada evento. Não inferir vínculo apenas por CPF, conta, valor, nome do arquivo ou escolha humana de uma remessa incompatível. Retorno sem correspondência ou ambíguo permanece explicitamente pendente/indeterminado.

Distinguir rejeição, aceitação/agendamento e efetivação somente para ocorrências cobertas. Agendamento não equivale a pagamento. Para efetivação comprovadamente correspondente, comparar valor e data efetivados com os previstos, registrando divergências sem recalcular folha ou alterar a referência. Não aplicar regras de prazo trabalhista.

Preservar sucessivos retornos, suas ocorrências, ordem de importação e evidência temporal bancária quando disponível. Não usar simplesmente o último upload para substituir o resultado anterior. Estado consolidado deve seguir a semântica e a sequência comprovadas no pacote; transição não comprovada, ocorrência desconhecida ou conflito sem resolução determinística resulta em `INDETERMINATE`, sem apagar fatos conhecidos.

Reimportação do mesmo conteúdo no mesmo contexto não duplica artefatos ou eventos; registrar a tentativa e reutilizar a evidência. Reprocessamento com nova versão de referência, remessa ou pacote gera revisão distinta. O relatório identifica hashes, versões e instante da revisão; downloads de uma revisão não alteram seu conteúdo.

Nenhum retorno gera título, proposta, baixa, estorno ou lançamento contábil. F68 e os fluxos F70–F75 permanecem autoridades de suas operações; F76 não reutiliza reservas de pagamento nem cria executor bancário.

## 5. Invariantes, acesso e auditoria

| Invariante de CONVENTION.md §2 | Aplicação |
|---|---|
| I-1 e I-2 | RLS, tenant/empresa e carteira em arquivos, referências, relatórios e retornos; sem contexto não retorna dados |
| I-3 e I-4 | Comparação determinística em centavos; sem float, cálculo de folha ou cálculo por LLM |
| I-5 | Sem ato jurídico ou executor nesta fatia; relatório não autoriza pagamento |
| I-6 e I-7 | Originais, revisões, retornos e diagnósticos preservados; trilha append-only, sem apagar evidência trabalhista |
| I-8 | Não há aplicação de regra tributária; cobertura técnica usa versão/compatibilidade evidenciada |
| I-9 | Sem efeito externo; importações/reprocessamentos idempotentes |
| I-11 | Competência e datas como valores civis; instantes auditáveis com exibição America/Sao_Paulo |
| I-12 | Não recalcula período fechado; resultado histórico reproduzido com entradas e pacote congelados |

Papéis e acesso seguem CONVENTION.md e os contratos de acesso existentes do módulo, sem conceder alçada financeira/trabalhista por importar arquivo. Auditor readonly não modifica evidências. Registrar importação, validação, correspondência, retorno, bloqueio, reprocessamento e download com ator, contexto, instante, correlationId, versões e resultado. Erros seguem códigos estáveis e `application/problem+json`. I-10 não é acionado: sem certificado, cofre ou assinatura.

## 6. Interface

Ampliar Financeiro com conferência de folha CNAB. Referências de conteúdo e fluxo: `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/code.html` e `screen.png`; protótipo navegável `docs/telas/prototipo/index.html`. Aparência e comportamento obedecem `docs/FRONTEND.md`, `docs/DESIGN-SYSTEM.md` e `docs/design-system/`.

Exibir empresa/competência, modelos CSV/JSON, originais, pacote/versão, três dimensões do resultado, totais e comparação por empregado, códigos/motivos, vínculo dos retornos e histórico. Detalhe mostra esperado, solicitado e efetivado, com divergências por campo. Não apresentar CTA de executar, transmitir, gerar remessa ou baixar F68.

Estados: vazio, carregando, importando, entrada inválida, cobertura ausente, estrutura inválida, divergências, comparação consistente, retorno pendente, rejeitado, aceito/agendado, efetivação observada, conflito, `INDETERMINATE`, erro recuperável e acesso negado. Provar CLARO/ESCURO, 375/768/1280/1536 px, teclado, foco, contraste e zoom. Aplicar frontend-design antes/durante implementação, impeccable no acabamento e protocolo FRONTEND.md §20.1, com comparação ao protótipo e prova visual/E2E.

## 7. Critérios de aceite e provas

1. Modelos CSV/JSON equivalentes, contexto explícito e preservação de originais/hashes; CPF/CNPJ, mês, datas, destinos e dinheiro inválidos geram erro rastreável; entradas parciais não recebem sucesso global.
2. Um CPF por empresa/competência; líquido positivo com um pagamento exato; zero sem pagamento; negativo/duplicidade inválidos; nome e soma total não resolvem divergência individual.
3. Correspondência exata e provas negativas de CPF, conta, dígitos, centavos e data; ausências, extras, divisão de pagamento e CPF ausente no CNAB impedem conclusão positiva.
4. Estrutura posicional íntegra, headers/trailers, lotes, segmentos, contagens e totais; remessa mista, empresa divergente, modalidade/instrução não coberta e versão desconhecida sem falso positivo.
5. Retornos repetidos, sem vínculo, ambíguos, rejeitados, agendados e efetivados; diferenças de valor/data, ocorrências desconhecidas e conflitos preservados; upload mais recente não apaga evento anterior.
6. Importação/reprocessamento concorrentes não duplicam fatos; revisões e downloads estáveis; nova fonte/pacote não reescreve histórico.
7. Isolamento tenant/empresa/carteira, consulta sem contexto, readonly e trilha append-only; ausência de criação/baixa/proposta F68, pagamento, transmissão ou cálculo de folha.
8. Regras, banco, tela, E2E e prova visual dos dois temas segundo `docs/TESTING.md`, com evidência por SPEC/issue. Cobertura sem manual/fixture compatível é `not_run` na prova afetada, nunca PASS. Aprovação documental não comprova testes de aplicação executados.

## 8. Fora de escopo e destino dos complementos

| O que não entra | Destino nominal e gatilho |
|---|---|
| Poupança, conta salário e crédito para outros bancos | MVP-2: complementos de modalidades de validação CNAB de folha; recorte do PI, documentação oficial e fixtures |
| Pagamentos divididos ou múltiplos contratos por CPF | MVP-2: correspondência agregada de folha externa; chave/agrupamento e regras aprovados |
| Arquivos mistos por empresa, competência ou modalidade | MVP-2: seleção de lotes em arquivos mistos de folha; isolamento e universo da comparação aprovados |
| Adiantamento, 13º, férias e rescisão | MVP-2: tipos adicionais de validação CNAB de folha externa; contrato de referência por tipo aprovado |
| Cálculo de folha, rubricas, encargos, empregados e eSocial | MVP-3: RF-05, folha e departamento pessoal; fatias próprias conforme PRD |
| Geração, manutenção, transmissão e consulta de remessa/pagamento | MVP-2: integração bancária de folha própria; contrato e aprovação específicos, produção somente após MVP-4 |
| Títulos, baixas, propostas e contabilização da folha | MVP-2: integração financeiro-contábil da folha; origens, revisão e vínculos aprovados, consumindo RF-05 quando necessário |
| Bancos diferentes de BB e CNAB 400 | MVP-2: expansão de bancos/leiautes de validação de folha; fonte oficial e fixtures específicas |

## 9. Decisões do PI e gate documental

PI aprovou em 30/09/2026: BB CNAB 240, referência CSV e JSON padronizados, folha mensal líquida, conta corrente BB, uma empresa/competência por conferência com vários lotes cobertos, correspondência individual exata por CPF/destino/valor/data, líquido zero sem pagamento, remessa e retorno com histórico/divergências e somente relatório sem efeito financeiro. Não entram cálculo, execução, transmissão, geração de remessa ou F68.

Questões abertas: **Nenhuma**. Identidade, comportamento, contrato de entradas, aceite enumerado, invariantes, complementos com destino, decisões do PI e UI estão registrados. A cobertura bancária operacional será comprovada na implementação; não é presumida pela aprovação da SPEC.
