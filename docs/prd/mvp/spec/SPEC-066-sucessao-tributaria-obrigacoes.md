# SPEC-066 — Sucessão tributária versionada de obrigações

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F66
> **Origem:** PRD §§3, 6.1, 6.3, 6.5, 9.1, 10.5, 12, 14, 15, 16 e Anexo B.1
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 27/09/2026

---

## 1. Objetivo

Complementar o catálogo e as ocorrências da F63 com um grafo oficial curado, versionado e acíclico de sucessão tributária, capaz de representar substituição, consolidação, desdobramento e coexistência temporal entre as oito famílias já catalogadas e seus destinos normativos no cronograma de 2026 a 2033.

A F66 cobre empresas de autopeças em Goiás nos regimes `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO`, sem ampliar o recorte empresarial da F63. Ela registra destinos futuros mesmo quando ainda não existe capacidade geradora no ContaIA, mas os mantém em `SEM_CAPACIDADE`: não cria ocorrência concluível, ação contextual ou aparência de cobertura operacional. A fatia não calcula novo tributo, não transmite, não paga e não produz efeito fiscal externo.

## 2. Resultado observável

Em `Fiscal -> Agenda de obrigações`, o usuário pode:

- consultar uma linha do tempo de 2026 a 2033 por família, regime, empresa e competência;
- visualizar predecessoras, sucessoras e relações `SUBSTITUI`, `CONSOLIDA`, `DESDOBRA` e `COEXISTE`;
- distinguir destino operacional, `SEM_CAPACIDADE`, `INDETERMINATE` e `STALE`;
- entender vigência, condição, fundamento oficial e versão do mapa em cada transição;
- comparar versões publicadas sem reescrever ocorrências ou períodos encerrados;
- simular, sem persistir efeito, qual conjunto de obrigações resultaria para uma competência;
- reavaliar ocorrências abertas quando nova versão publicada mudar a sucessão aplicável;
- abrir a capacidade de destino apenas quando ela existir e for compatível com empresa e período;
- diagnosticar lacunas, conflitos, ciclos, sobreposições e destinos ainda não implementados.

O mapa nunca presume equivalência por nome, tributo, documento, data ou semelhança de código. Ausência ou conflito de fonte, vigência, condição, cardinalidade ou capacidade materializa diagnóstico explícito e não libera conclusão.

## 3. Recorte herdado e horizonte

| Origem | Família catalogada | Regime e período operacional |
|---|---|---|
| F36 | DAS do Anexo I | Simples Nacional, conforme a F36 |
| F36 | ICMS próprio e DARE prévia | Lucro Presumido em Goiás, conforme a F36 |
| F37 | PIS/Pasep e Cofins cumulativos | Lucro Presumido, competências de 2026 cobertas pela F37 |
| F38 | IRPJ e CSLL trimestrais | Lucro Presumido, trimestres cobertos pela F38 |
| F52 | EFD ICMS/IPI | Lucro Presumido e Simples quando especificamente obrigado, conforme a F52 |
| F53 | EFD-Contribuições | Lucro Presumido e decisão de dispensa do Simples, conforme a F53 |
| F49 | ECD | Lucro Presumido e Simples opcional, conforme a F49 |
| F50 | ECF | Lucro Presumido e Simples opcional, conforme a F50 |

O mapa normativo alcança 2026 a 2033. Esse horizonte não amplia o período operacional das capacidades de origem nem autoriza cálculo, geração ou entrega de IBS, CBS ou obrigação sucessora ainda não especificada. Cada ocorrência continua limitada ao regime, UF, CNAE, estabelecimento ou matriz, período, evento especial e efeito da sua capacidade geradora.

## 4. Dependências e autoridades

- F16 fornece o mecanismo de pacote normativo versionado.
- F22 é autoridade para calendário, ocorrência, baixa auditada e alertas.
- F63 é autoridade para catálogo, exigibilidade, recorte empresarial e ação contextual.
- F64 é autoridade para penalidades, juros e prioridade fixa por prazo.
- F65 é autoridade para dependências rígidas entre ocorrências; dependência não é sucessão.
- F36–F38, F49–F50 e F52–F53 são autoridades das capacidades operacionais existentes.
- O pacote oficial curado F66 é autoridade exclusiva para nós futuros, relações, condições, cardinalidade, vigências e fontes da sucessão.
- A capacidade geradora específica é autoridade exclusiva para declarar um destino `DISPONIVEL`.

Divergência entre autoridades produz `INDETERMINATE`. A F66 não usa precedência silenciosa e não transforma notícia, resumo, protótipo ou inferência em regra publicada.

## 5. Modelo do grafo

Cada revisão contém nós e relações direcionadas. Um nó representa uma família de obrigação ou destino normativo estável; uma relação representa somente vínculo oficial sustentado por fonte e janela temporal.

- `SUBSTITUI`: predecessoras deixam de ser aplicáveis e sucessoras assumem o recorte definido;
- `CONSOLIDA`: duas ou mais predecessoras convergem para uma sucessora;
- `DESDOBRA`: uma predecessora passa a ter dois ou mais destinos;
- `COEXISTE`: predecessora e sucessora permanecem simultaneamente aplicáveis durante janela explícita.

O grafo aceita cardinalidade N:N. Cada relação declara conjuntos completos de origens e destinos, regimes, UF, CNAEs, condições, vigência, regra de competência e fundamento. Relações não carregam percentual, alíquota, fórmula ou compensação, que pertencem às capacidades tributárias próprias.

O grafo publicado deve ser acíclico quando consideradas as relações de sucessão efetiva. Autorreferência, ciclo, relação sem fonte, nó órfão, vigência inválida ou conjuntos parciais tornam a revisão `INVALID`. `COEXISTE` não cria caminho de sucessão e não pode esconder ciclo.

## 6. Pacote oficial curado

O pacote contém, no mínimo:

- versão do schema, identificador e instante imutável de criação;
- manifesto com arquivos, hashes, contagens e fontes oficiais consultadas;
- códigos estáveis dos nós, natureza atual ou futura e capacidade geradora associada quando existente;
- relações com tipo, conjuntos completos de origem e destino, condição e vigência;
- regimes, UF, CNAEs, eventos especiais e regra de competência aplicáveis;
- fundamento oficial, dispositivo, data de consulta e intervalo de validade;
- versão mínima das capacidades referenciadas;
- diagnóstico para lacuna, conflito, ciclo, sobreposição ou destino sem capacidade.

Dados importados entram como `unknown`. Schema, manifesto, hashes, fontes, referências, vigências, cardinalidade e completude dos conjuntos são validados antes da revisão humana. Mesmo pacote, escopo e hash são idempotentes; mesmo identificador com conteúdo diferente é conflito auditável. Pacote parcial não é publicado parcialmente.

## 7. Revisão e publicação

Estados:

`IMPORTED -> VALIDATING -> INDETERMINATE | INVALID | READY_FOR_REVIEW -> PUBLISHED | REJECTED -> STALE`

- `INDETERMINATE`: fonte, condição, vigência ou cobertura é insuficiente ou conflitante;
- `INVALID`: estrutura, manifesto, grafo ou referência é inválida;
- `READY_FOR_REVIEW`: pacote íntegro, fontes consultáveis e comparação reproduzível;
- `PUBLISHED`: mapa aprovado e elegível para simulação e reavaliação;
- `STALE`: fonte normativa ou capacidade referenciada mudou depois da decisão.

Importador e preparador não aprovam a própria revisão. Publicação cabe a `contador` ou `admin_escritorio` distinto. Versão publicada é imutável; correção cria nova versão integral. Publicar mapa não executa migração destrutiva nem cria efeito externo.

## 8. Resolução determinística

O motor puro recebe mapa publicado, catálogo F63, empresa e cadastro versionado, competência, ocorrências existentes, capacidades disponíveis e data civil de referência. Ele não acessa banco, rede, relógio ou LLM.

Para cada origem aplicável, seleciona a versão vigente, avalia condições explícitas, resolve o conjunto completo N:N, preserva coexistências na janela, classifica os destinos e produz diagnóstico, versões e fontes. Mesmas entradas e versões produzem o mesmo resultado. Relação futura não altera competência anterior. Cobertura incompleta não elimina predecessora nem ativa sucessora.

## 9. Destinos sem capacidade

Um nó futuro pode ser publicado antes da sua capacidade geradora. Nesse caso:

- permanece `SEM_CAPACIDADE` com código, nome, vigência, fonte e destino de implementação;
- aparece na linha do tempo e na simulação como cobertura normativa sem cobertura operacional;
- não materializa ocorrência concluível, vencimento, penalidade ou ação contextual;
- não recebe baixa, entrega, alerta verde nem prioridade financeira;
- bloqueia qualquer afirmação de migração concluída;
- passa a `DISPONIVEL` somente por nova revisão publicada que referencie capacidade implementada.

É proibido usar formulário genérico, ação vazia ou ocorrência sem origem para simular implementação.

## 10. Ocorrências e histórico

Nova versão publicada:

- aplica-se à geração de ocorrências futuras conforme a competência;
- reavalia ocorrências abertas ou ainda não decididas em avaliação imutável;
- preserva ocorrências entregues, não exigíveis definitivas, canceladas ou vinculadas a período fechado;
- relaciona avaliação anterior e substituta, marcando a sem autoridade como `STALE`;
- não troca código, versão ou evidência dentro de snapshot encerrado;
- não altera apuração, guia, escrituração ou arquivo aprovado.

Durante `COEXISTE`, cada obrigação operacional permanece independente e só é materializada quando F63 comprovar exigibilidade e existir capacidade geradora. Encerrada a janela, a predecessora não é criada para competências posteriores quando a relação publicada comprovar substituição integral.

## 11. Simulação e ação contextual

A simulação recebe empresa, competência e versão publicada, não persiste ocorrência e retorna origens consideradas, relações aplicadas ou afastadas, predecessoras mantidas ou encerradas, sucessoras, estados de capacidade, lacunas, fontes e versões.

Destino `DISPONIVEL` oferece somente navegação autorizada pela capacidade correspondente. Destino `SEM_CAPACIDADE` apresenta o destino documental nomeado, sem botão de execução. Nenhuma ação gera apuração, guia, arquivo, assinatura, transmissão, protocolo, pagamento ou baixa.

## 12. Autorização, isolamento e auditoria

- `auxiliar`: consulta mapa, linha do tempo e simulação; pode iniciar importação, sem publicar;
- `contador`: revisa e publica pacote preparado por outro usuário e reavalia a própria carteira;
- `admin_escritorio`: mesmas ações no tenant, preservada a segregação;
- `auditor_readonly`: consulta versões, fontes, diagnósticos e histórico;
- `cliente_portal` e papéis sem permissão fiscal: acesso negado;
- `super-admin` local: mantém infraestrutura global, sem decidir aplicação empresarial fora do fluxo.

Tabelas transacionais carregam `tenant_id` e `empresa_id` quando aplicável, sob RLS. Importação, validação, revisão, publicação, simulação, reavaliação, download e tentativas negadas entram em auditoria append-only.

## 13. Concorrência e falhas

- revisão, publicação e reavaliação usam versão otimista e retornam HTTP 409 em conflito;
- falha parcial não publica subconjunto nem aplica parte de relação N:N;
- indisponibilidade preserva a última versão publicada e permite retentativa idempotente;
- erro segue `application/problem+json` com código estável e `correlationId`;
- fonte ou capacidade ausente nunca vira sucessão confirmada por padrão;
- reavaliação em lote registra sucesso ou falha por ocorrência sem sobrescrever a anterior.

## 14. Invariantes globais tocados

| Invariante | Aplicação na F66 |
|---|---|
| I-1 | revisões e avaliações empresariais carregam tenant e empresa, índices e RLS |
| I-2 | consulta sem contexto não retorna dados empresariais |
| I-4 | sucessão é determinística; LLM não cria ou escolhe relação |
| I-5 | publicação exige decisão humana segregada |
| I-6 | versões, fontes e reavaliações preservam trilha append-only |
| I-7 | ocorrência, avaliação e evidência não são apagadas |
| I-8 | relação é selecionada pela vigência da competência |
| I-9 | importação, publicação e reavaliação são idempotentes |
| I-11 | competência e vigência são datas civis; timestamps exibem `America/Sao_Paulo` |
| I-12 | mesmas entradas e versões reproduzem os mesmos destinos |

## 15. Contrato de UI

A UI evolui a agenda da F63 e usa `docs/telas/contaia_dashboard_multi_empresa_rf_06/` e `docs/telas/contaia_dashboard_multi_empresa_vis_o_de_riscos_tema_dark_carbon/` para conteúdo, hierarquia e densidade, corrigidas por `FRONTEND.md` e pelo design system.

Ela apresenta linha do tempo de 2026 a 2033; conjuntos de origem e destino; tipo, vigência e condição; fonte e versão; estados `DISPONIVEL`, `SEM_CAPACIDADE`, `INDETERMINATE` e `STALE`; comparação; simulação; histórico; e ação somente para capacidade existente.

Estados obrigatórios: carregando, vazio, importando, validando, revisão indeterminada, inválida, pronta para revisão, publicada, rejeitada, `STALE`, mapa aplicável, coexistência, sucessão futura, `SEM_CAPACIDADE`, ocorrência reavaliada, período preservado, conflito, erro recuperável e acesso negado.

A implementação entrega temas CLARO e ESCURO, viewports de 375, 768, 1280 e 1536 px, teclado, foco, semântica, contraste e Toast/Sonner. `frontend-design` é obrigatória antes e durante a implementação; `impeccable`, no acabamento. A PR prova comparação visual, responsividade, estados e acessibilidade conforme `FRONTEND.md` §20.1.

## 16. Critérios de aceite verificáveis

| Categoria | Prova obrigatória |
|---|---|
| Grafo | relações 1:1, 1:N, N:1 e N:N são representadas sem perda |
| Cronograma | vigências 2026–2033 são selecionadas por competência sem retroatividade |
| Coexistência | predecessora e sucessora coexistem somente na janela publicada |
| Capacidade | destino ausente permanece `SEM_CAPACIDADE`, sem ocorrência ou ação falsa |
| Incerteza | falta ou conflito produz `INDETERMINATE` |
| Validação | ciclo, autorreferência, relação parcial, nó órfão e sobreposição invalidam o pacote |
| Histórico | futuras e abertas são reavaliadas; encerradas e períodos fechados permanecem intactos |
| Integração | F63 decide exigibilidade, F64 calcula risco e F65 bloqueia dependências sem confusão |
| Banco | RLS, carteira, imutabilidade, idempotência, concorrência e append-only |
| UI | dois temas, quatro viewports, estados, teclado, foco, contraste e acabamento |

## 17. Provas exigidas

- testes de regras para cardinalidades, tipos, janelas, competências e estados de capacidade;
- testes negativos para ciclo, autorreferência, conjunto parcial, fonte ausente, vigência conflitante, nó órfão e sobreposição;
- testes de banco para publicação imutável, atomicidade N:N, idempotência, RLS, carteira, segregação e concorrência;
- integração com F22, F63, F64, F65 e capacidades F36–F53;
- E2E de importação, revisão, publicação, simulação, reavaliação aberta, preservação encerrada e `SEM_CAPACIDADE`;
- prova visual nos dois temas e quatro viewports.

## 18. Fora de escopo e destinos obrigatórios

| Item | Destino obrigatório |
|---|---|
| Cálculo e apuração completos de IBS/CBS até 2033 | motor completo de IBS/CBS no MVP-4 |
| Capacidade geradora de sucessora inexistente | fatia própria no MVP-2 ou MVP-4, conforme o PRD |
| Novas obrigações sem relação com as oito famílias F63 | expansão própria do catálogo no MVP-2 |
| Outros regimes, UFs, CNAEs, segmentos e períodos operacionais | expansão fiscal própria do MVP-2 |
| Percentuais, alíquotas, compensações e fórmulas | capacidades de apuração próprias; complemento no MVP-4 |
| Ordenação por impacto, rascunhos e resumo por LLM | Agente Compliance completo no MVP-2 |
| Edição manual de relação publicada | nova versão integral e revisão segregada |
| Geração, transmissão, pagamento ou baixa automática | capacidades próprias; produção após o MVP-4 |

## 19. Dúvidas resolvidas

| Pergunta | Decisão do PI em 27/09/2026 |
|---|---|
| Qual capacidade ocupa F66/SPEC-066? | sucessão tributária versionada |
| Qual cobertura? | autopeças em Goiás, Simples Nacional e Lucro Presumido da F63 |
| Qual catálogo de origem? | somente as oito famílias da F63 |
| Qual horizonte normativo? | 2026 a 2033 |
| Qual cardinalidade? | grafo N:N, incluindo 1:1, 1:N e N:1 |
| Como tratar coexistência? | janela explícita, sem inferência |
| Como aplicar nova versão? | futuras e abertas são avaliadas; encerradas e períodos fechados preservam snapshot |
| Destino sem implementação? | `SEM_CAPACIDADE`, sem ocorrência concluível ou ação falsa |
| Há aprovação por ocorrência? | não; publicação humana segregada e resolução determinística |
| Qual tamanho? | Grande, mantendo a entrega vertical atômica |
| Há questões abertas? | Nenhuma |

## 20. Gate de conformidade documental

- **Identidade:** F66/SPEC-066, MVP-2 e origem no PRD estão explícitos.
- **Comportamento:** pacote, grafo, publicação, resolução, simulação e reavaliação são observáveis.
- **Aceite:** regras, banco, integração, tela e E2E têm provas verificáveis.
- **Invariantes:** I-1, I-2, I-4 a I-9, I-11 e I-12 aplicáveis estão declarados.
- **Limites:** não há apuração IBS/CBS completa, nova capacidade ou efeito externo.
- **Dúvidas:** todas as decisões do PI estão registradas; não há questão aberta.
- **Destinos:** cada complemento aponta capacidade e MVP obrigatórios.
- **UI:** referências, estados, temas, viewports, acessibilidade e skills estão explícitos.
- **Tamanho:** Grande; grafo N:N, cronograma, reavaliação e prova vertical permanecem atômicos.

## 21. Referências normativas a curar na implementação

- Receita Federal, **Entenda a Reforma Tributária do Consumo**, atualizada em 03/07/2026: <https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/entenda>;
- Receita Federal, **Orientações da Reforma Tributária do Consumo**, atualizada em 21/09/2026: <https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-da-reforma-tributaria>;
- Emenda Constitucional nº 132/2023: <https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc132.htm>;
- Lei Complementar nº 214/2025, texto compilado: <https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214compilado.htm>;
- fontes oficiais específicas de cada obrigação, relação, condição e vigência do pacote F66.

A lista não autoriza relação genérica. Cada nó e aresta só é publicado quando fonte oficial sustentar integralmente origens, destinos, condição, vigência e aplicação ao recorte.

## 22. Aprovação

Recorte aprovado pelo PI em 27/09/2026 para criação da issue, commit e push direto na `main`.
