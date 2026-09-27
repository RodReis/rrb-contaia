# SPEC-064 — Penalidades, juros e prioridade de risco

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F64
> **Origem:** PRD §§3, 6.3, 6.5, 9.1, 10.5, 12, 14, 15, 16 e Anexos A.3 e B.1
> **Tamanho:** Médio
> **Estado:** aprovada pelo PI em 27/09/2026

---

## 1. Objetivo

Complementar o catálogo e as ocorrências da F63 com cálculo determinístico e reproduzível de penalidades e juros para o mesmo recorte de obrigações, distinguindo valor incorrido de projeção preventiva e classificando a prioridade de risco por prazo.

A F64 cobre empresas de autopeças em Goiás nos regimes `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO`. Ela consome somente ocorrências da F63 e valores aprovados das capacidades de origem, aplica pacote oficial curado e publicado e apresenta memória de cálculo na agenda. Não constitui crédito, não emite guia, não paga, não transmite, não altera a obrigação de origem e não produz efeito fiscal externo.

## 2. Resultado observável

Em `Fiscal -> Agenda de obrigações`, o usuário pode:

- consultar se a ocorrência possui penalidade aplicável, não aplicável ou `INDETERMINATE`;
- visualizar separadamente penalidade principal, juros e total;
- distinguir valor incorrido depois do vencimento de projeção preventiva antes do vencimento;
- informar uma data civil de referência e reproduzir o cálculo correspondente;
- abrir a memória com regra, revisão, fundamento, base, datas, etapas, arredondamentos e resultado;
- identificar a origem do valor usado como base e sua revisão aprovada;
- ver prioridade `CRITICA`, `ALTA`, `MEDIA` ou `BAIXA`, calculada sem LLM;
- comparar a avaliação atual com versões anteriores sem reescrever o histórico;
- reconhecer avaliação `STALE` quando catálogo, base ou pacote normativo perder autoridade.

Ausência ou conflito de fonte, base, vigência, data ou regra materializa `INDETERMINATE`. O sistema não completa fórmula, alíquota, mínimo, juros, base ou data por inferência.

## 3. Recorte herdado da F63

| Origem | Obrigação/saída | Regime e período |
|---|---|---|
| F36 | DAS do Anexo I | Simples Nacional, conforme o recorte temporal da F36 |
| F36 | ICMS próprio e DARE prévia | Lucro Presumido em Goiás, conforme a F36 |
| F37 | PIS/Pasep e Cofins cumulativos | Lucro Presumido, competências cobertas pela F37 |
| F38 | IRPJ e CSLL trimestrais | Lucro Presumido, trimestres cobertos pela F38 |
| F52 | EFD ICMS/IPI | Lucro Presumido e Simples quando especificamente obrigado, conforme a F52 |
| F53 | EFD-Contribuições | Lucro Presumido e decisão de dispensa do Simples, conforme a F53 |
| F49 | ECD | Lucro Presumido e Simples opcional, conforme a F49 |
| F50 | ECF | Lucro Presumido e Simples opcional, conforme a F50 |

A F64 herda da ocorrência F63 o tenant, empresa, estabelecimento ou matriz, obrigação, regime, UF, CNAE fundamentador, competência, aplicabilidade, vencimento nominal e ajustado e versão do catálogo. Ela não amplia obrigação, regime, UF, atividade, período ou efeito das origens.

## 4. Dependências e autoridades

- F16 fornece o mecanismo de pacote normativo versionado.
- F22 é autoridade para calendário útil, ocorrência, baixa, alerta D-3 e estado operacional da agenda.
- F63 é autoridade para catálogo, exigibilidade, vencimento e ação contextual.
- F36 a F38 são autoridades dos valores aprovados de apurações e guias internas abrangidas.
- F49, F50, F52 e F53 são autoridades das escriturações e declarações internas abrangidas.
- O pacote oficial curado F64 é autoridade para fórmula, base permitida, mínimo, juros, vigência e fundamento da penalidade.

Nenhuma autoridade prevalece silenciosamente sobre outra. Divergência, ausência ou versão incompatível produz `INDETERMINATE` com diagnóstico.

## 5. Pacote oficial curado de penalidades

O pacote contém, no mínimo:

- versão do schema, identificador e instante imutável de criação;
- manifesto com arquivos, hashes, contagens e fontes oficiais consultadas;
- código estável da regra e vínculo com a obrigação F63;
- regimes, UF, CNAEs, periodicidade, evento de incidência e vigência;
- natureza do cálculo, base admitida, percentual, valor mínimo, limite e regra de juros quando aplicáveis;
- unidade e periodicidade dos juros, marco inicial, calendário e tratamento de fração de período;
- regra explícita para projeção anterior ao vencimento;
- moeda, escala, arredondamento e ordem das operações;
- fonte oficial, dispositivo, data de consulta e intervalo de validade;
- diagnóstico esperado para dado ausente, conflitante ou fora de cobertura.

Dados importados entram como `unknown`. Schema, manifesto, hashes, fontes, vigências, vínculos com F63, unidades e ausência de sobreposição incompatível são validados antes de criar revisão utilizável. Mesmo pacote, escopo e hash são idempotentes; mesmo identificador com conteúdo diferente é conflito auditável.

## 6. Revisão e publicação

Estados da revisão normativa:

`IMPORTED -> VALIDATING -> INDETERMINATE | INVALID | READY_FOR_REVIEW -> PUBLISHED | REJECTED -> STALE`

- `INDETERMINATE`: fonte, fórmula, vigência ou cobertura é insuficiente ou conflitante;
- `INVALID`: schema, manifesto, hash, unidade ou vínculo estrutural é inválido;
- `READY_FOR_REVIEW`: pacote íntegro, fontes consultáveis e comparação reproduzível;
- `PUBLISHED`: regras aprovadas e disponíveis para avaliação;
- `STALE`: fonte normativa ou autoridade referenciada mudou após a publicação.

Importador e preparador não publicam a própria revisão. A publicação cabe a `contador` ou `admin_escritorio` distinto. Versão publicada é imutável; correção cria nova versão e preserva a anterior.

## 7. Cálculo determinístico

A função pura recebe ocorrência F63, regra publicada, base aprovada, datas civis, calendário e data de referência. Ela não acessa banco, rede, relógio ou LLM.

- dinheiro é inteiro em centavos; percentuais e juros usam decimal tipado, nunca float;
- a regra publicada define etapas, escala e arredondamento; o sistema não aplica padrão fiscal implícito;
- a data de referência é obrigatória e não pode ser substituída pelo relógio interno;
- cálculo posterior ao vencimento é `INCURRED`;
- cálculo na data de vencimento ou antes dela é `PROJECTED` e aparece sempre rotulado como projeção;
- obrigação entregue ou baixada usa o estado e a data comprovada pela F22; ausência de prova não inventa cessação de juros;
- regra comprovadamente sem penalidade aplicável produz `NOT_APPLICABLE`;
- regra ou base insuficiente produz `INDETERMINATE`, nunca zero.

A memória preserva entradas canônicas, versões, fórmula decomposta, valores intermediários, arredondamentos, resultado e hash reproduzível.

## 8. Base financeira e declarações acessórias

Para DAS, ICMS/DARE, PIS/Cofins e IRPJ/CSLL, a base vem exclusivamente da revisão aprovada da capacidade de origem indicada na ocorrência. Rascunho, revisão rejeitada, `STALE`, não aprovada ou incompatível não serve de base.

Para EFD ICMS/IPI, EFD-Contribuições, ECD e ECF, a regra publicada declara expressamente qual grandeza comprovada compõe a base ou se a penalidade é fixa. A F64 não deduz base a partir do tamanho do arquivo, quantidade de registros, faturamento presumido ou valor de tributo não autorizado pela fonte.

## 9. Prioridade fixa por prazo

A prioridade usa a diferença em dias civis entre a data de referência e o vencimento ajustado da F63:

| Prioridade | Regra |
|---|---|
| `CRITICA` | ocorrência exigível e atrasada |
| `ALTA` | vencimento entre D0 e D3 |
| `MEDIA` | vencimento entre D4 e D7 e penalidade projetada aplicável |
| `BAIXA` | vencimento acima de D7 ou penalidade comprovadamente não aplicável |

`INDETERMINATE`, `STALE` e `COBERTURA_INCOMPLETA` não recebem prioridade financeira definitiva; exibem estado próprio e bloqueiam qualquer aparência de cálculo confirmado. Valor monetário não altera a faixa nesta fatia. Ordenação por impacto financeiro, dependências e decisão do Agente Compliance permanecem em capacidade posterior.

## 10. Avaliação, histórico e desatualização

Estados da avaliação:

`CALCULATED | NOT_APPLICABLE | INDETERMINATE | STALE`

A identidade lógica inclui tenant, empresa, ocorrência F63, revisão normativa, revisão da base e data de referência. Repetir as mesmas entradas não duplica avaliação.

Avaliação histórica é imutável. Nova revisão da F63, alteração de vencimento, nova base aprovada, baixa ou entrega posterior, mudança de calendário ou novo pacote normativo marca a avaliação consumível como `STALE` e exige nova avaliação vinculada à anterior.

## 11. Autorização, isolamento e auditoria

- `auxiliar`: consulta avaliações e inicia importação; não publica pacote;
- `contador`: revisa e publica pacote preparado por outro usuário e consulta a carteira autorizada;
- `admin_escritorio`: mesmas ações no tenant, preservada a segregação;
- `auditor_readonly`: consulta regras, avaliações, memória e histórico;
- `cliente_portal` e papéis sem permissão fiscal: acesso negado;
- `super-admin` local mantém somente a infraestrutura do catálogo global, sem decidir avaliação empresarial fora do fluxo aprovado.

Tabelas empresariais carregam `tenant_id` e `empresa_id`, com índices e RLS. Importação, validação, publicação, cálculo, reavaliação, consulta e download entram em auditoria append-only.

## 12. Concorrência e falhas

- comandos de revisão e publicação usam versão otimista e retornam HTTP 409 em conflito;
- falha parcial do pacote não publica subconjunto de regras;
- falha de uma avaliação não altera ocorrência ou origem;
- indisponibilidade preserva a última revisão publicada e permite retentativa idempotente;
- erro segue `application/problem+json` com código estável e `correlationId`;
- resultado anterior não é reutilizado quando qualquer versão ou data de referência divergir.

## 13. Invariantes globais tocados

| Invariante | Aplicação na F64 |
|---|---|
| I-1 | regras empresariais e avaliações carregam tenant e empresa, com índices e RLS |
| I-2 | consulta sem contexto não retorna dados empresariais |
| I-3 | penalidade, juros, base e total usam centavos; float é proibido |
| I-4 | cálculo e prioridade são determinísticos; LLM não calcula nem decide |
| I-5 | pacote normativo exige publicação humana segregada; a fatia não gera efeito externo |
| I-6 | revisões, avaliações e reavaliações preservam trilha append-only |
| I-7 | memória e valor fiscal não são apagados |
| I-8 | regra é selecionada pela vigência aplicável ao fato e ao atraso avaliados |
| I-9 | importação e avaliação são idempotentes |
| I-11 | competência, vencimento e referência são datas civis; timestamps usam `America/Sao_Paulo` na exibição |
| I-12 | mesmas entradas e versões reproduzem memória, prioridade e resultado idênticos |

## 14. Contrato de UI

A UI evolui a agenda da F63 e usa as referências `docs/telas/contaia_dashboard_multi_empresa_rf_06/` e `docs/telas/contaia_dashboard_multi_empresa_vis_o_de_riscos_tema_dark_carbon/` para conteúdo, hierarquia e densidade, corrigidas por `FRONTEND.md` e pelo design system.

Ela apresenta filtros representáveis na URL, prioridade, tipo `INCURRED` ou `PROJECTED`, valor principal, juros, total, data de referência, origem da base, versão da regra, fundamento, memória e histórico. Projeção nunca usa a mesma linguagem visual de valor incorrido.

Estados obrigatórios: carregando, vazio, sem regra publicada, importando, validando, revisão indeterminada, inválida, pronta para revisão, publicada, rejeitada, avaliação calculada, não aplicável, `INDETERMINATE`, `STALE`, cobertura incompleta, erro recuperável e acesso negado.

A implementação entrega temas CLARO e ESCURO, viewports de 375, 768, 1280 e 1536 px, teclado, foco visível, semântica, contraste e Toast/Sonner. `frontend-design` é obrigatória antes e durante a implementação; `impeccable`, no acabamento. A PR prova comparação visual, responsividade, estados e acessibilidade conforme `FRONTEND.md` §20.1.

## 15. Critérios de aceite verificáveis

| Categoria | Prova obrigatória |
|---|---|
| Cobertura | somente as oito famílias da F63 são avaliadas, sem ampliar regime, UF, atividade ou período |
| Cálculo | mínimo, percentual, juros, limites, vigência, etapas e arredondamentos seguem a regra publicada |
| Momento | valor incorrido e projeção preventiva ficam inequívocos e usam data de referência explícita |
| Base | somente revisão aprovada e compatível da origem alimenta cálculo variável |
| Incerteza | fonte, regra, data ou base ausente/conflitante produz `INDETERMINATE`, não zero |
| Prioridade | atraso é `CRITICA`; D0–D3, `ALTA`; D4–D7 aplicável, `MEDIA`; demais casos cobertos, `BAIXA` |
| Reprodução | mesmas entradas e versões geram a mesma memória, hash e total |
| Histórico | nova autoridade cria nova avaliação e marca a anterior consumível como `STALE` |
| Banco | RLS, carteira, imutabilidade, idempotência, concorrência e append-only |
| UI | dois temas, quatro viewports, estados, teclado, foco, contraste e acabamento comprovados |

## 16. Provas exigidas

- testes de regras para mínimo, percentual, juros, limites, vigência, atraso, projeção, datas, arredondamento e quatro prioridades;
- testes negativos para fonte ausente, regra sobreposta, base indisponível, revisão incompatível, não aplicabilidade, `INDETERMINATE` e `STALE`;
- testes de banco para publicação imutável, atomicidade, idempotência, RLS, carteira, segregação e concorrência;
- testes de integração com ocorrências F63 e bases aprovadas das F36–F38, F49–F50 e F52–F53;
- fixtures de pacote válido, inválido, parcial, sem fonte e com unidade incompatível;
- E2E de importação, revisão, publicação, cálculo, projeção, prioridade, memória, desatualização e acesso negado;
- prova visual nos dois temas e quatro viewports.

## 17. Fora de escopo e destinos obrigatórios

| Item | Destino obrigatório |
|---|---|
| Grafo ampliado de dependências e sequência de entrega | capacidade posterior de dependências entre obrigações no MVP-2 |
| Sucessão tributária sob a Reforma | capacidade própria de sucessão do motor no MVP-2; transição completa IBS/CBS permanece no MVP-4 |
| Ordenação por valor, impacto operacional e dependências | capacidade de priorização do Compliance completo no MVP-2 |
| Rascunhos, resumo por LLM e ações sugeridas | capacidade posterior do Agente Compliance no MVP-2 |
| E-mail, SMS, push ou outro canal externo real | comunicação ativa no MVP-3; durante MVP-2 permanecem dublês locais |
| Obrigações sem saída especificada nas F36–F53 | fatias próprias do catálogo e da capacidade geradora no MVP-2 |
| Outros regimes, UFs, segmentos e períodos | expansão fiscal própria do MVP-2 |
| Alteração manual da regra importada | nova versão integral do pacote oficial curado |
| Guia oficial, assinatura, transmissão, protocolo, pagamento, compensação ou constituição de crédito | capacidades próprias; produção somente no gate posterior ao MVP-4 |

## 18. Dúvidas resolvidas

| Pergunta | Decisão do PI em 27/09/2026 |
|---|---|
| Qual capacidade ocupa F64/SPEC-064? | penalidades e juros do motor de obrigações |
| Qual cobertura? | o mesmo catálogo de DAS, ICMS/DARE, PIS/Cofins, IRPJ/CSLL, EFD ICMS/IPI, EFD-Contribuições, ECD e ECF da F63 |
| Qual momento de cálculo? | valor incorrido depois do vencimento e projeção claramente rotulada antes dele |
| A F64 prioriza alertas? | sim, com prioridade fixa e determinística por prazo; Compliance completo permanece posterior |
| Quais faixas? | atrasada `CRITICA`; D0–D3 `ALTA`; D4–D7 aplicável `MEDIA`; acima de D7 ou sem penalidade aplicável `BAIXA` |
| Como tratar falta ou conflito? | `INDETERMINATE` com diagnóstico, sem valor presumido |
| Há questões abertas? | Nenhuma |

## 19. Gate de conformidade documental

- **Identidade:** F64/SPEC-064, MVP-2 e origem no PRD estão explícitos.
- **Comportamento:** pacote, publicação, cálculo, projeção, memória, prioridade e desatualização são observáveis.
- **Aceite:** regras, banco, integração, tela e E2E têm provas verificáveis.
- **Invariantes:** I-1 a I-9, I-11 e I-12 aplicáveis estão declarados.
- **Limites:** não há dependências ampliadas, sucessão, agente, transmissão, pagamento ou efeito externo.
- **Dúvidas:** todas as decisões do PI estão registradas; não há questão aberta.
- **Destinos:** cada complemento aponta capacidade e MVP obrigatórios.
- **UI:** referências, estados, temas, viewports, acessibilidade e skills estão explícitos.
- **Tamanho:** Médio; reutiliza F22/F63 e limita cálculo às oito famílias já especificadas.

## 20. Referências normativas a curar na implementação

- Portal do Simples Nacional e normas vigentes do CGSN para DAS e obrigações do regime;
- Receita Federal e SPED para PIS/Pasep, Cofins, IRPJ, CSLL, EFD-Contribuições, ECD e ECF;
- Secretaria da Economia de Goiás para ICMS, DARE e EFD ICMS/IPI;
- legislação oficial específica de cada obrigação, com dispositivo, vigência, data de consulta e hash no pacote F64.

A lista não autoriza fórmula genérica. Cada regra só é publicada quando a fonte oficial sustentar integralmente base, percentual ou valor fixo, mínimo, juros, vigência, marco temporal e arredondamento aplicáveis ao recorte.

## 21. Aprovação

Recorte aprovado pelo PI em 27/09/2026 para criação da issue, commit e push direto na `main`.
