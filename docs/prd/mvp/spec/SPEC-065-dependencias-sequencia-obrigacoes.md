# SPEC-065 — Dependências rígidas e sequência de entrega de obrigações

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F65
> **Origem:** PRD §§3, 6.3, 6.5, 9.1, 10.5, 12, 14, 15, 16 e Anexo B.1
> **Tamanho:** Médio
> **Estado:** aprovada pelo PI em 27/09/2026

---

## 1. Objetivo

Complementar o catálogo e as ocorrências da F63 com um grafo oficial curado, versionado e acíclico de dependências rígidas, apresentando a sequência de entrega e impedindo a baixa ou conclusão de uma obrigação sucessora enquanto alguma predecessora aplicável não estiver satisfeita.

A F65 cobre o mesmo catálogo de empresas de autopeças em Goiás nos regimes `SIMPLES_NACIONAL` e `LUCRO_PRESUMIDO` da F63. A sucessora pode ser preparada e revisada enquanto bloqueada, mas não pode ser concluída. A fatia não cria novas obrigações, não transmite, não paga, não produz efeito fiscal externo e não permite liberação manual da dependência.

## 2. Resultado observável

Em `Fiscal -> Agenda de obrigações`, o usuário pode:

- consultar a cadeia ordenada de predecessoras e sucessoras de cada ocorrência;
- distinguir dependências satisfeitas, bloqueantes, indeterminadas e desatualizadas;
- ver obrigação, empresa, competência, relação temporal, estado e fundamento de cada etapa;
- preparar e revisar a capacidade sucessora mesmo enquanto sua conclusão estiver bloqueada;
- tentar registrar a baixa e receber diagnóstico de todas as predecessoras bloqueantes;
- abrir cada ocorrência ou capacidade de origem diretamente a partir da cadeia;
- acompanhar versões anteriores do grafo e reavaliações sem reescrever o histórico;
- identificar uma sucessora `STALE` quando uma predecessora for reaberta depois da conclusão.

Nenhuma relação é inferida por nome, data, periodicidade ou sobreposição de intervalos. Ausência ou conflito de fonte, período, versão ou estado produz diagnóstico explícito e bloqueia a conclusão.

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

A F65 herda da F63 o tenant, empresa, estabelecimento ou matriz, obrigação, regime, UF, CNAE fundamentador, competência, exigibilidade, vencimento, versão do catálogo e ação contextual. Ela não amplia obrigação, regime, UF, atividade, período ou efeito das origens.

## 4. Dependências e autoridades

- F16 fornece o mecanismo de pacote normativo versionado.
- F22 é autoridade para ocorrência, baixa, reabertura, estado operacional e alerta.
- F63 é autoridade para catálogo, exigibilidade, período, vencimento e ação contextual.
- F64 permanece autoridade para penalidade, juros e prioridade fixa por prazo, sem decidir a sequência.
- F36 a F38, F49, F50, F52 e F53 são autoridades das capacidades internas abrangidas.
- O pacote oficial curado F65 é autoridade exclusiva para aresta, vigência, fundamento e mapeamento temporal da dependência.

Nenhuma autoridade prevalece silenciosamente sobre outra. Ausência, divergência ou versão incompatível bloqueia a conclusão e produz diagnóstico; não cria relação presumida.

## 5. Pacote oficial curado de dependências

O pacote contém, no mínimo:

- versão do schema, identificador e instante imutável de criação;
- manifesto com arquivos, hashes, contagens e fontes oficiais consultadas;
- código estável da relação e códigos das obrigações predecessora e sucessora da F63;
- regimes, UF, CNAEs, eventos especiais e vigência aplicáveis;
- mapeamento temporal explícito entre as competências, inclusive quando as periodicidades diferirem;
- fundamento oficial, dispositivo, data de consulta e intervalo de validade;
- versão mínima das capacidades referenciadas;
- diagnóstico esperado para ausência, conflito ou incompatibilidade.

Dados importados entram como `unknown`. Schema, manifesto, hashes, fontes, referências F63, vigências e relações temporais são validados antes de criar revisão utilizável. Mesmo pacote, escopo e hash são idempotentes; mesmo identificador com conteúdo diferente é conflito auditável.

O grafo publicado deve ser acíclico. Autorreferência, ciclo direto ou transitivo, obrigação fora do catálogo F63, aresta sem fonte, relação temporal ausente ou sobreposição incompatível tornam a revisão `INVALID`. O sistema não publica subconjunto válido de pacote inválido.

## 6. Revisão e publicação

Estados da revisão normativa:

`IMPORTED -> VALIDATING -> INDETERMINATE | INVALID | READY_FOR_REVIEW -> PUBLISHED | REJECTED -> STALE`

- `INDETERMINATE`: fonte, vigência ou cobertura da relação é insuficiente ou conflitante;
- `INVALID`: estrutura, manifesto, hash, referência, mapeamento temporal ou aciclicidade é inválida;
- `READY_FOR_REVIEW`: pacote íntegro, fontes consultáveis e grafo reproduzível;
- `PUBLISHED`: grafo aprovado e disponível para avaliar ocorrências;
- `STALE`: fonte normativa ou autoridade referenciada mudou após a publicação.

Importador e preparador não publicam a própria revisão. A publicação cabe a `contador` ou `admin_escritorio` distinto. Versão publicada é imutável; correção cria nova versão e preserva a anterior. Não existe criação ou alteração manual de aresta fora do pacote integral revisado.

## 7. Avaliação determinística da cadeia

A função pura recebe grafo publicado, ocorrência sucessora, ocorrências predecessoras mapeadas, versões e data de referência. Ela não acessa banco, rede, relógio ou LLM.

Quando uma sucessora possui várias predecessoras, todas usam semântica `AND`:

| Estado da predecessora | Resultado para a dependência |
|---|---|
| `ENTREGUE` | satisfeita |
| `NAO_EXIGIVEL` | satisfeita, com fundamento preservado |
| `PENDENTE` ou `VENCIDA` | bloqueante |
| `BLOQUEADA_POR_DEPENDENCIA` | bloqueante |
| `INDETERMINATE` ou `COBERTURA_INCOMPLETA` | bloqueante e indeterminada |
| ocorrência, regra ou avaliação `STALE` | bloqueante e desatualizada |
| ocorrência ausente ou incompatível | bloqueante e indeterminada |

A sucessora somente fica apta à baixa quando todas as predecessoras aplicáveis estiverem satisfeitas. Predecessora comprovadamente `NAO_EXIGIVEL` libera a relação; ausência de prova não equivale a não exigibilidade.

## 8. Preparação, conclusão e bloqueio

O estado `BLOQUEADA_POR_DEPENDENCIA` não oculta a ocorrência nem impede abrir, preparar, gerar rascunho ou revisar a capacidade sucessora. A F65 bloqueia exclusivamente a baixa ou conclusão interna que faria a ocorrência tornar-se `ENTREGUE`.

O comando de baixa reavalia a cadeia no servidor, dentro da mesma transação lógica e com versões esperadas. Se houver bloqueio, nenhuma baixa parcial é registrada e a API retorna HTTP 409 em `application/problem+json`, com código estável, `correlationId` e a lista sanitizada de predecessoras bloqueantes.

Não existe override por `admin_escritorio`, `contador` ou qualquer outro papel. A regularização exige satisfazer a predecessora ou publicar nova versão integral do pacote oficial curado. Ocultar ou habilitar botão no cliente não substitui a validação do servidor.

## 9. Reabertura, histórico e desatualização

Baixa, reabertura e avaliação da cadeia são eventos append-only. Ocorrência histórica não é reescrita.

Se uma predecessora for reaberta depois de a sucessora ter sido concluída:

- a baixa histórica da sucessora é preservada;
- a avaliação consumível da sucessora passa a `STALE` e exige revisão;
- nova conclusão ou baixa permanece bloqueada até a cadeia ser regularizada;
- nenhuma sucessora é reaberta automaticamente;
- o vínculo entre avaliação anterior e substituta permanece auditável.

Nova versão do grafo reavalia ocorrências futuras ou ainda abertas. Ocorrências encerradas preservam a versão original; quando uma mudança posterior comprometer sua cadeia, recebem avaliação `STALE`, nunca alteração retroativa silenciosa.

## 10. Autorização, isolamento e auditoria

- `auxiliar`: consulta a cadeia e prepara capacidades permitidas; não publica pacote nem ignora bloqueio;
- `contador`: revisa e publica pacote preparado por outro usuário e opera a agenda na carteira;
- `admin_escritorio`: mesmas ações no tenant, preservada a segregação;
- `auditor_readonly`: consulta regras, cadeias, diagnósticos e histórico;
- `cliente_portal` e papéis sem permissão fiscal: acesso negado;
- `super-admin` local mantém somente infraestrutura global, sem decidir cadeia empresarial fora do fluxo aprovado.

Tabelas empresariais carregam `tenant_id` e `empresa_id`, com índices e RLS. Importação, validação, publicação, avaliação, tentativa bloqueada de baixa, reavaliação, consulta e download entram em auditoria append-only.

## 11. Concorrência e falhas

- comandos de revisão, publicação e baixa usam versão otimista;
- alteração concorrente de predecessora ou grafo invalida a tentativa e retorna HTTP 409;
- falha parcial do pacote não publica subconjunto de arestas;
- falha de avaliação não altera ocorrências ou capacidades de origem;
- indisponibilidade preserva a última revisão publicada e permite retentativa idempotente;
- resultado anterior não é reutilizado quando qualquer ocorrência, regra, relação temporal ou versão divergir.

## 12. Invariantes globais tocados

| Invariante | Aplicação na F65 |
|---|---|
| I-1 | avaliações empresariais carregam tenant e empresa, com índices e RLS |
| I-2 | consulta sem contexto não retorna dados empresariais |
| I-4 | cadeia, ordem e bloqueio são determinísticos; LLM não cria aresta nem libera conclusão |
| I-5 | pacote exige publicação humana segregada; a fatia não gera efeito externo |
| I-6 | revisões, tentativas, avaliações e reavaliações preservam trilha append-only |
| I-7 | ocorrência, baixa e histórico da cadeia não são apagados |
| I-8 | relação é selecionada pela vigência e pelo mapeamento temporal explícito |
| I-9 | importação e avaliação são idempotentes |
| I-11 | competências são datas civis; timestamps usam `America/Sao_Paulo` na exibição |
| I-12 | mesmas entradas e versões reproduzem a mesma cadeia, ordem e decisão |

## 13. Contrato de UI

A UI evolui a agenda da F63 e usa as referências `docs/telas/contaia_dashboard_multi_empresa_rf_06/` e `docs/telas/contaia_dashboard_multi_empresa_vis_o_de_riscos_tema_dark_carbon/` para conteúdo, hierarquia e densidade, corrigidas por `FRONTEND.md` e pelo design system.

Ela apresenta cadeia ordenada em lista acessível; obrigação, competência, relação temporal, estado, fundamento e versão por etapa; distinção textual entre satisfeita, bloqueante, indeterminada e `STALE`; todas as predecessoras bloqueantes na tentativa de baixa; ações para abrir cada ocorrência e preparar a sucessora; e histórico de versões, reaberturas e reavaliações.

Estados obrigatórios: carregando, vazio sem relações, importando, validando, revisão indeterminada, inválida, pronta para revisão, publicada, rejeitada, `STALE`, cadeia satisfeita, bloqueada, indeterminada, conflito concorrente, erro recuperável e acesso negado.

A implementação entrega temas CLARO e ESCURO, viewports de 375, 768, 1280 e 1536 px, teclado, foco visível, semântica, contraste e Toast/Sonner. `frontend-design` é obrigatória antes e durante a implementação; `impeccable`, no acabamento. A PR prova comparação visual, responsividade, estados e acessibilidade conforme `FRONTEND.md` §20.1.

## 14. Critérios de aceite verificáveis

| Categoria | Prova obrigatória |
|---|---|
| Cobertura | somente as oito famílias da F63 participam do grafo |
| Fonte | cada aresta possui fundamento, vigência e mapeamento temporal explícitos |
| Grafo | autorreferência, ciclo, referência desconhecida ou período incompatível impedem publicação |
| Semântica | todas as predecessoras devem estar `ENTREGUE` ou `NAO_EXIGIVEL` |
| Bloqueio | preparação e revisão são permitidas; baixa/conclusão bloqueada retorna diagnóstico atômico |
| Incerteza | ausência, conflito, `INDETERMINATE`, cobertura incompleta ou `STALE` bloqueiam conclusão |
| Exceção | nenhum papel consegue liberar manualmente uma dependência |
| Reabertura | predecessora reaberta torna a avaliação da sucessora concluída `STALE`, sem apagar histórico |
| Reprodução | mesmas entradas e versões geram a mesma cadeia, ordem e decisão |
| Banco | RLS, carteira, imutabilidade, idempotência, concorrência e append-only |
| UI | dois temas, quatro viewports, estados, teclado, foco, contraste e acabamento comprovados |

## 15. Provas exigidas

- testes de regras para cadeia simples e múltipla, semântica `AND`, mapeamentos temporais e cada estado de predecessora;
- testes negativos para ciclo, autorreferência, obrigação fora da F63, período incompatível, fonte ausente, sobreposição e pacote parcial;
- testes de banco para publicação imutável, atomicidade, idempotência, RLS, carteira, segregação e concorrência;
- testes de integração com ocorrência, baixa e reabertura F22, exigibilidade F63 e prioridade F64;
- E2E de preparação bloqueada, tentativa de baixa, diagnóstico, satisfação integral, conclusão e reabertura posterior;
- prova visual nos dois temas e quatro viewports.

## 16. Fora de escopo e destinos obrigatórios

| Item | Destino obrigatório |
|---|---|
| Sucessão tributária sob a Reforma | capacidade própria de sucessão do motor no MVP-2; transição completa IBS/CBS permanece no MVP-4 |
| Ordenação por valor, impacto operacional ou decisão do agente | capacidade de priorização do Compliance completo no MVP-2 |
| Rascunhos, resumo por LLM e ações sugeridas | capacidade posterior do Agente Compliance no MVP-2 |
| Obrigações sem saída especificada nas F36 a F53 | fatias próprias do catálogo e da capacidade geradora no MVP-2 |
| Outros regimes, UFs, segmentos e períodos | expansão fiscal própria do MVP-2 |
| Edição manual de aresta ou liberação excepcional | nova versão integral do pacote oficial curado e nova revisão segregada |
| Geração, assinatura, transmissão, protocolo, pagamento ou baixa automática | capacidades próprias; produção somente no gate posterior ao MVP-4 |

## 17. Dúvidas resolvidas

| Pergunta | Decisão do PI em 27/09/2026 |
|---|---|
| Qual capacidade ocupa F65/SPEC-065? | dependências entre obrigações e ordem de entrega |
| A dependência bloqueia? | sim; impede baixa ou conclusão da sucessora |
| Qual cobertura? | somente as oito famílias do catálogo F63 |
| O que satisfaz a predecessora? | `ENTREGUE` ou `NAO_EXIGIVEL`; os demais estados bloqueiam |
| Como relacionar periodicidades diferentes? | mapeamento temporal explícito no pacote, sem inferência |
| Existe liberação manual? | não |
| O que é permitido durante o bloqueio? | abrir, preparar, gerar rascunho e revisar; não concluir |
| O que ocorre após reabertura da predecessora? | sucessora concluída fica `STALE`, sem reabertura automática nem perda do histórico |
| Como funcionam várias predecessoras? | semântica `AND`; todas devem estar satisfeitas |
| Há questões abertas? | Nenhuma |

## 18. Gate de conformidade documental

- **Identidade:** F65/SPEC-065, MVP-2 e origem no PRD estão explícitos.
- **Comportamento:** pacote, publicação, cadeia, bloqueio, conclusão e desatualização são observáveis.
- **Aceite:** regras, banco, integração, tela e E2E têm provas verificáveis.
- **Invariantes:** I-1, I-2, I-4 a I-9, I-11 e I-12 aplicáveis estão declarados.
- **Limites:** não há sucessão, novas obrigações, agente, transmissão, pagamento ou efeito externo.
- **Dúvidas:** todas as decisões do PI estão registradas; não há questão aberta.
- **Destinos:** cada complemento aponta capacidade e MVP obrigatórios.
- **UI:** referências, estados, temas, viewports, acessibilidade e skills estão explícitos.
- **Tamanho:** Médio; reutiliza F22/F63 e limita o grafo às oito famílias já especificadas.

## 19. Referências normativas a curar na implementação

- Portal do Simples Nacional e normas vigentes do CGSN para DAS e obrigações do regime;
- Receita Federal e SPED para PIS/Pasep, Cofins, IRPJ, CSLL, EFD-Contribuições, ECD e ECF;
- Secretaria da Economia de Goiás para ICMS, DARE e EFD ICMS/IPI;
- legislação oficial específica de cada relação de precedência, com dispositivo, vigência, data de consulta e hash no pacote F65.

A lista não autoriza dependência genérica. Cada aresta só é publicada quando fonte oficial sustentar obrigação predecessora, sucessora, vigência e relação temporal aplicáveis ao recorte.

## 20. Aprovação

Recorte aprovado pelo PI em 27/09/2026 para criação da issue, commit e push direto na `main`.
