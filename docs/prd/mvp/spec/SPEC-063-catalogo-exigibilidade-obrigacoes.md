# SPEC-063 — Catálogo fiscal e exigibilidade de obrigações

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F63
> **Origem:** PRD §§3, 6.3, 6.5, 9.1, 10.5, 12, 14, 15, 16 e Anexo B.1
> **Tamanho:** Médio
> **Estado:** aprovada pelo PI em 27/09/2026

---

## 1. Objetivo

Expandir a agenda mínima da F22 com um catálogo fiscal curado e versionado que determine, por empresa, quais obrigações já cobertas pelas F36 a F53 são exigíveis, quando vencem e qual fluxo interno as atende.

A F63 cobre empresas de autopeças em Goiás nos regimes `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO`. Ela importa pacote oficial curado, exige revisão humana antes da publicação e materializa ocorrências na agenda da F22. Não cria um segundo motor, não calcula penalidade, não gera rascunho de entrega e não produz efeito fiscal externo.

## 2. Resultado observável

Em `Fiscal -> Agenda de obrigações`, o usuário pode:

- consultar a cobertura do catálogo por regime, UF, CNAE, obrigação e período;
- importar e revisar um pacote oficial curado com manifesto, fontes e vigências;
- publicar uma versão imutável do catálogo após revisão segregada;
- ver, por empresa e competência, obrigações exigíveis, não exigíveis ou `INDETERMINATE`;
- entender regime, UF, CNAE principal ou secundário, pré-requisito e fonte que fundamentaram a decisão;
- consultar vencimentos nominais e ajustados pelo calendário útil da F22;
- receber os alertas D-3 já definidos pela F22 para ocorrências exigíveis;
- abrir, sem execução automática, a tela da apuração, guia ou escrituração que atende a obrigação;
- identificar quando uma ocorrência futura precisa ser reavaliada por mudança de catálogo ou cadastro.

Nenhuma obrigação desaparece por ausência de dado. Quando a exigibilidade não puder ser comprovada ou afastada, a agenda materializa `INDETERMINATE` e apresenta a evidência faltante ou conflitante.

## 3. Recorte do catálogo inicial

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

Cada regra herda exatamente o regime, estabelecimento ou matriz, período, evento especial, aplicabilidade e limitação da fatia de origem. A F63 não amplia período, obrigação, regime, UF, atividade ou efeito das F36 a F53.

## 4. Dependências e autoridades

- F16 fornece o mecanismo de pacote normativo versionado.
- F22 é a autoridade para regra publicada, calendário útil, ocorrência, baixa auditada, alerta D-3, destinatários e canais locais dublados.
- F36 a F38 são autoridades das apurações e guias internas abrangidas.
- F49, F50, F52 e F53 são autoridades das escriturações internas abrangidas.
- O cadastro vigente e seu histórico aprovado são autoridade para regime, UF, município, CNAEs e situação da empresa.
- O pacote oficial curado é autoridade para vigência, prazo, aplicabilidade e evidência normativa da obrigação.

Divergência entre autoridades não é resolvida por precedência silenciosa: produz `INDETERMINATE` com diagnóstico.

## 5. Pacote oficial curado

O pacote contém, no mínimo:

- versão do schema, identificador e instante imutável de criação;
- manifesto com arquivos, hashes, contagens e fontes oficiais consultadas;
- para cada regra, código estável, obrigação de origem, regimes, UF, CNAEs, periodicidade, competência, vencimento nominal, ajuste de dia útil, pré-requisitos e vigência;
- destino interno da ação contextual e versão mínima da capacidade de origem;
- evidência da fonte, dispositivo, data de consulta e intervalo de validade;
- diagnóstico esperado para dados ausentes, conflitantes ou fora de cobertura.

Dados importados entram como `unknown`. Schema, manifesto, hash, fontes, vigências, códigos, referências às F36–F53 e ausência de sobreposição incompatível são validados antes de criar revisão utilizável.

O mesmo pacote, no mesmo escopo e hash, é idempotente. Mesmo identificador com conteúdo diferente é conflito auditável. Pacote parcial ou sem fonte oficial identificável é `INVALID`.

## 6. Revisão e publicação

Estados da revisão:

`IMPORTED -> VALIDATING -> INDETERMINATE | INVALID | READY_FOR_REVIEW -> PUBLISHED | REJECTED -> STALE`

- `INDETERMINATE`: fonte, vigência ou cobertura do próprio pacote é insuficiente ou conflitante;
- `INVALID`: schema, manifesto ou referência estrutural é inválida;
- `READY_FOR_REVIEW`: pacote íntegro, fontes consultáveis e comparação reproduzível;
- `PUBLISHED`: catálogo aprovado e disponível para gerar ocorrências;
- `STALE`: fonte normativa ou autoridade referenciada mudou após a decisão.

Importador e preparador não aprovam a própria revisão. A publicação cabe a `contador` ou `admin_escritorio` distinto. Versão publicada é imutável; correção cria nova versão e preserva a anterior.

## 7. Decisão de exigibilidade

Para cada empresa e período, o motor puro recebe regra publicada, cadastro versionado, dados de pré-requisito, calendário útil e data de referência. Ele não acessa banco, rede, relógio ou LLM.

Estados observáveis:

- `PENDENTE`, `BLOQUEADA_POR_DEPENDENCIA`, `ENTREGUE`, `VENCIDA`, `NAO_EXIGIVEL` e `COBERTURA_INCOMPLETA` permanecem com a semântica da F22;
- `INDETERMINATE` significa que a obrigação está dentro do universo possível, mas falta ou conflita dado necessário para confirmar ou afastar exigibilidade.

`COBERTURA_INCOMPLETA` continua restrito à incapacidade de calcular o vencimento com segurança, como ausência de calendário aplicável. `INDETERMINATE` não recebe baixa como obrigação confirmada, não gera sucesso verde e exibe o caminho de resolução.

Regime, UF e município devem estar vigentes no período avaliado. CNAE principal ou secundário ativo pode satisfazer a regra; o diagnóstico preserva todos os CNAEs avaliados e identifica aquele que fundamentou o resultado. Ausência de histórico suficiente gera `INDETERMINATE`, não inferência retroativa.

## 8. Ocorrências, histórico e reavaliação

A identidade lógica continua a da F22: tenant, empresa, código da obrigação, competência e versão da regra. Reprocessamento concorrente não duplica ocorrência ou alerta.

Ocorrência histórica decidida não é reescrita. Nova versão do catálogo ou mudança cadastral:

- preserva ocorrências encerradas e sua regra original;
- reavalia ocorrências futuras ou ainda não decididas em nova versão;
- registra relação entre avaliação anterior e substituta;
- marca como `STALE` a avaliação ainda consumível que perdeu autoridade;
- nunca altera apuração fechada nem afirma entrega externa.

## 9. Ação contextual

Cada regra publicada aponta para uma capacidade já especificada. A ocorrência exigível oferece ação para abrir o fluxo correspondente com empresa, estabelecimento ou matriz e período preenchidos:

- DAS, ICMS/DARE, PIS/Cofins ou IRPJ/CSLL nas F36–F38;
- ECD/ECF nas F49–F50;
- EFD ICMS/IPI ou EFD-Contribuições nas F52–F53.

A ação apenas navega. Ela não cria apuração, guia, escrituração, arquivo, aprovação, assinatura, transmissão, protocolo, pagamento ou baixa.

## 10. Autorização, isolamento e auditoria

- `auxiliar`: consulta ocorrências e inicia importação; não publica catálogo;
- `contador`: revisa e publica pacote preparado por outro usuário e opera a agenda dentro da carteira;
- `admin_escritorio`: mesmas ações no tenant, preservada a segregação;
- `auditor_readonly`: consulta catálogo, diagnósticos e histórico;
- `cliente_portal` e papéis sem permissão fiscal: acesso negado;
- `super-admin` local mantém somente a infraestrutura do catálogo global, sem decidir exigibilidade empresarial fora do fluxo aprovado.

Tabelas transacionais carregam `tenant_id` e `empresa_id` quando aplicável, sob RLS. Importação, validação, decisão, publicação, geração, reavaliação, download e navegação entram em auditoria append-only.

## 11. Concorrência e falhas

- comandos de revisão e publicação usam versão otimista e retornam HTTP 409 em conflito;
- falha parcial de pacote não publica subconjunto de regras;
- indisponibilidade preserva o último catálogo publicado e permite retentativa idempotente;
- erro segue `application/problem+json` com código estável e `correlationId`;
- falta de fonte, cadastro ou pré-requisito nunca vira obrigação omitida nem confirmada por padrão.

## 12. Invariantes globais tocados

| Invariante | Aplicação na F63 |
|---|---|
| I-1 | revisões e ocorrências empresariais carregam tenant e empresa, com índices e RLS |
| I-2 | consulta sem contexto não retorna dados empresariais |
| I-4 | exigibilidade e vencimento são determinísticos; LLM não calcula nem decide |
| I-5 | publicação do catálogo e qualquer efeito jurídico posterior exigem decisão humana registrada |
| I-6 | versões, decisões e reavaliações preservam trilha append-only |
| I-7 | ocorrência fiscal e evidência não são apagadas |
| I-8 | regra é selecionada pela vigência do período avaliado |
| I-9 | importação, geração, reavaliação e alertas são idempotentes |
| I-11 | competência e vencimento são datas civis; timestamps usam `America/Sao_Paulo` na exibição |
| I-12 | mesmas entradas e versões reproduzem a mesma decisão e o mesmo calendário |

## 13. Contrato de UI

A UI evolui a agenda da F22 e usa as referências `docs/telas/contaia_dashboard_multi_empresa_rf_06/` e `docs/telas/contaia_dashboard_multi_empresa_vis_o_de_riscos_tema_dark_carbon/` para conteúdo, hierarquia e densidade, corrigidas por `FRONTEND.md` e pelo design system.

Ela apresenta:

- cobertura por regime, UF, CNAE, obrigação e período;
- importação, manifesto, fontes, revisão e publicação do pacote;
- agenda em lista/calendário, filtros representáveis na URL e detalhe da exigibilidade;
- CNAE fundamentador, pré-requisitos, fonte, regra e período herdado;
- distinção textual entre `INDETERMINATE` e `COBERTURA_INCOMPLETA`;
- ação contextual para a capacidade de origem;
- histórico de versões e reavaliações.

Estados obrigatórios: carregando, vazio sem catálogo, importando, validando, catálogo indeterminado, inválido, pronto para revisão, publicado, rejeitado, `STALE`, ocorrência pendente, não exigível, `INDETERMINATE`, cobertura incompleta, bloqueada, entregue, vencida, erro recuperável e acesso negado.

A implementação entrega temas CLARO e ESCURO, viewports de 375, 768, 1280 e 1536 px, teclado, foco visível, semântica, contraste e Toast/Sonner. `frontend-design` é obrigatória antes e durante a implementação; `impeccable`, no acabamento. A PR prova comparação visual, responsividade, estados e acessibilidade conforme `FRONTEND.md` §20.1.

## 14. Critérios de aceite verificáveis

| Categoria | Prova obrigatória |
|---|---|
| Catálogo | pacote oficial curado cobre somente as saídas F36–F53 enumeradas, com fontes, vigências, manifesto e hashes |
| Regimes | Simples Nacional e Lucro Presumido são avaliados sem misturar regras ou inferir cobertura |
| Período | cada obrigação herda exatamente o recorte da fatia de origem |
| CNAE | principal e secundários ativos são avaliados e o CNAE fundamentador aparece no diagnóstico |
| Incerteza | dado ausente ou conflitante materializa `INDETERMINATE`; não omite nem confirma a obrigação |
| Calendário | vencimento usa calendário útil F22 e distingue cobertura de prazo incompleta |
| Histórico | regra futura e alteração cadastral não reescrevem ocorrência encerrada |
| Integração | ocorrências exigíveis reutilizam baixa, alerta D-3, destinatários e outbox da F22 |
| Navegação | ação abre a origem correta sem criar ou executar artefato |
| Banco | RLS, carteira, imutabilidade, idempotência, concorrência e append-only |
| UI | dois temas, quatro viewports, estados, teclado, foco, contraste e acabamento comprovados |

## 15. Provas exigidas

- testes de regras para seleção de versão, regime, UF, município, CNAEs, pré-requisitos, período herdado, vencimento e estados;
- testes de banco para publicação imutável, atomicidade, idempotência, RLS, carteira, segregação e concorrência;
- testes de integração com F22 e com as rotas das F36–F38, F49–F50 e F52–F53;
- fixtures de pacote válido, sobreposto, parcial, sem fonte e com referência incompatível;
- E2E de importação, revisão, publicação, geração da agenda, `INDETERMINATE`, alerta D-3 e abertura do fluxo de origem;
- prova visual nos dois temas e quatro viewports.

## 16. Fora de escopo e destinos obrigatórios

| Item | Destino obrigatório |
|---|---|
| Penalidades, juros e estimativa financeira | capacidade posterior do motor de obrigações no MVP-2 |
| Grafo ampliado de dependências e sequência completa de entrega | capacidade posterior de dependências entre obrigações no MVP-2 |
| Sucessão tributária sob a Reforma | capacidade própria de sucessão do motor no MVP-2; transição completa IBS/CBS permanece no MVP-4 |
| Rascunhos e priorização pelo Agente Compliance | capacidade posterior de Compliance completo no MVP-2 |
| Obrigações sem saída especificada nas F36–F53 | fatias próprias do catálogo e da capacidade geradora no MVP-2 |
| Outros regimes, UFs, segmentos e períodos | expansão fiscal própria do MVP-2 |
| Alteração manual de regra importada | nova versão do pacote oficial curado e nova revisão integral |
| Geração, assinatura, transmissão, protocolo, pagamento ou baixa automática | capacidades próprias; produção somente no gate posterior ao MVP-4 |

## 17. Dúvidas resolvidas

| Pergunta | Decisão do PI em 27/09/2026 |
|---|---|
| Qual capacidade ocupa F63/SPEC-063? | expansão do motor de obrigações |
| Quais regimes? | Simples Nacional e Lucro Presumido |
| Como manter o tamanho? | F63 cobre catálogo, calendário e exigibilidade; penalidades, dependências ampliadas e sucessão ficam em capacidades posteriores |
| Qual catálogo inicial? | somente DAS, ICMS/DARE, PIS/Cofins, IRPJ/CSLL, EFD ICMS/IPI, EFD-Contribuições, ECD e ECF já especificados |
| Qual período? | cada obrigação herda o recorte da fatia de origem |
| Qual fonte? | pacote oficial curado, versionado e publicado após revisão humana |
| Como tratar ausência ou conflito? | materializar `INDETERMINATE` com diagnóstico |
| Qual ação oferecer? | abrir o fluxo da capacidade de origem, sem executar efeito |
| Quais CNAEs contam? | principal e secundários ativos, preservando o CNAE fundamentador |
| Há questões abertas? | Nenhuma |

## 18. Gate de conformidade documental

- **Identidade:** F63/SPEC-063, MVP-2 e origem no PRD estão explícitos.
- **Comportamento:** importação, revisão, publicação, decisão, agenda e navegação são observáveis.
- **Aceite:** regras, banco, integração, tela e E2E têm provas verificáveis.
- **Invariantes:** I-1, I-2, I-4 a I-9, I-11 e I-12 estão aplicados.
- **Limites:** não há penalidade completa, sucessão, rascunho, transmissão ou efeito externo.
- **Dúvidas:** todas as decisões do PI estão registradas; não há questão aberta.
- **Destinos:** cada complemento aponta capacidade e MVP obrigatórios.
- **UI:** referências, estados, temas, viewports, acessibilidade e skills estão explícitos.
- **Tamanho:** Médio; reutiliza integralmente a F22 e limita o catálogo às saídas já especificadas.

## 19. Referências normativas consultadas

- Receita Federal, Resolução CGSN nº 140/2018, multivigente: <https://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=92278>;
- SPED, EFD ICMS/IPI e Guia Prático versão 3.2.2: <https://sped.rfb.gov.br/item/show/274>;
- SPED, EFD-Contribuições e manuais: <https://sped.rfb.gov.br/item/show/268>;
- SPED, destaques e atualizações de ECD/ECF de 2026: <https://sped.rfb.gov.br/destaques/show/7>;
- Secretaria da Economia de Goiás, calendário de recolhimento de ICMS: <https://goias.gov.br/economia/saiba-mais-sobre-o-icms/>.

## 20. Aprovação

Recorte aprovado pelo PI em 27/09/2026 para criação da issue, commit e push direto na `main`.
