# SPEC-072 — Pagamentos locais BB por CNAB 240

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F72
> **Issue:** [#86](https://github.com/RodReis/rrb-contaia/issues/86), sub-issue nativa do MVP-2 #31
> **Origem:** PRD §§3, 5.3, 7.1, 9.1, 10.4, 12, 13.2, 14, 15 e 16
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 30/09/2026

## 1. Objetivo e comportamento observável

Preparar, revisar, aprovar e gerar arquivos locais de remessa de pagamentos do Banco do Brasil em CNAB 240 para boletos de cobrança, tributos e convênios com código de barras. Importar retornos, distinguir aceitação/agendamento de efetivação e produzir proposta revisável de baixa na F68 somente para pagamento efetivado e relacionado deterministicamente.

O usuário seleciona empresa e perfil de pagamento, consulta parcelas elegíveis, informa a data por item, prepara o lote, acompanha aprovação segregada, baixa o arquivo gerado e importa o retorno local. A tela exibe validações, ocorrências, conflitos, propostas e histórico com referência à parcela e ao documento.

Gerar arquivo não transmite remessa, agenda pagamento no banco nem movimenta dinheiro. Aceitação no retorno não significa efetivação. Efetivação observada não baixa automaticamente a F68. Todo desenvolvimento e homologação ocorre em Docker local; não há deploy produtivo durante os MVPs 1–4.

## 2. Autoridades e entradas

| Origem | Autoridade |
|---|---|
| F68 | título, parcela, publicação, saldo, baixa e estorno |
| F69 | documento de cobrança/arrecadação, evidência, validação e vínculo confirmado |
| F70/F71 | cobrança bancária; seus perfis não são presumidos compatíveis com pagamentos |
| F72 | perfil de pagamento, preparação, aprovação, snapshot, arquivo, manifesto, retorno, ocorrência e proposta de baixa |

A remessa recebe somente parcelas a pagar publicadas na F68, abertas ou parcialmente liquidadas, com saldo positivo e documento F69 validado e vinculado à mesma empresa e parcela. Valor, vencimento e identidade necessários à modalidade precisam estar resolvidos. Documento com valor ou vencimento ausente continua inelegível até resolução na origem F69.

Título cancelado, liquidado, sem vínculo confirmado, documento inválido, pendente ou fora de cobertura não entra. A F72 não cria pagamento avulso, título ou vínculo por similaridade. Um saldo parcialmente liquidado só entra se o valor validado do documento coincidir exatamente com o saldo atual.

## 3. Pacote técnico e modalidades

Banco obrigatório: `001`, Banco do Brasil. Leiaute: CNAB 240 de pagamentos. Boletos usam segmento J e complementos obrigatórios cobertos, inclusive J52 quando exigido; tributos e convênios com código de barras usam segmento O. Segmentos de tributos sem código de barras, transferências, folha e Pix não entram.

Fonte oficial inicial consultada em 30/09/2026: [CNAB240 — Arquivo de Pagamentos — Particularidades BB](https://bb.com.br/docs/pub/emp/empl/dwn/PgtVer03BB.pdf), versão identificada julho/2019. A publicação acessível comprova a estrutura consultada, não a vigência atual de todos os serviços. O pacote técnico exige URL, título, versão, data de consulta, hash do conteúdo, vigência operacional identificada e fixtures aprovadas de cada modalidade, versão, segmento e ocorrência suportados. Incorporar a norma FEBRABAN aplicável e complementos oficiais BB quando necessários; não fixar versão pela simples disponibilidade do PDF antigo.

Cobertura ausente, conflitante ou não comprovada resulta em `INDETERMINATE`, bloqueando geração ou aplicação da ocorrência afetada. Não aproximar códigos, convênios ou semântica de outro banco. A F72 paga documento existente: não determina regime, UF, exigibilidade, apuração ou obrigação tributária.

## 4. Perfil, valor e data

Perfil de pagamento próprio por tenant e empresa registra conta, agência, dígitos, convênio, modalidade e versão técnica explícitos. Não reutilizar automaticamente perfil de cobrança F70. Mudanças de perfil preservam versões e não reescrevem arquivos anteriores.

Valor solicitado = valor validado F69 = saldo aberto F68, em inteiros de centavos. Divergência bloqueia preparação, aprovação e geração. Não calcular nem aplicar juros, multa, desconto, tarifa ou atualização; não preencher componentes desconhecidos com valores presumidos.

Cada item recebe data de pagamento solicitada explícita, como data civil, sem default pelo vencimento. Data posterior ao vencimento é inelegível. Documento atualizado precisa passar novamente pela F69. Campos e restrições técnicas adicionais seguem somente cobertura oficial comprovada; a F72 não inventa calendário ou promete execução na data informada.

## 5. Preparação, aprovação e geração

Preparação captura referências e versões F68/F69, código de barras validado, valor, vencimento, data solicitada, identidade necessária e perfil técnico. Arquivos são separados por empresa, perfil, versão e modalidade, com lotes homogêneos conforme manual.

Fluxo de preparação: rascunho → pendente de revisão → aprovado → gerado. Rejeição da preparação preserva motivo e histórico; correção retorna à revisão. Aprovação congela o snapshot. Mudança nas origens ou no perfil antes de gerar torna a preparação desatualizada e exige nova preparação e aprovação; após gerar, conserva o artefato e apresenta divergência auditável.

Geração revalida elegibilidade, versões, segregação, disponibilidade da tentativa e pacote técnico em transação. Arquivo e manifesto são persistidos atomicamente, com identificadores de itens/lotes, contagens, totais, referências, versões, hashes e instante imutável da revisão. Mesma geração retorna o artefato existente; download não muda bytes ou hash. Serialização respeita tamanho, posições, codificação, preenchimentos e registros exigidos pela versão coberta.

## 6. Tentativa ativa e reenvio

Uma tentativa ativa por parcela/documento; reservas e geração concorrentes não duplicam pagamento, inclusive se o mesmo documento for apresentado em preparações distintas. Identidade documental validada, empresa e parcela participam da proteção de duplicidade.

Depois de gerado, o item permanece bloqueado para nova remessa enquanto não houver rejeição bancária confirmada e correspondente à tentativa. Ausência de retorno, aceitação ou agendamento não liberam reenvio. Pagamento efetivado não libera nova tentativa, mesmo que a proposta de baixa seja rejeitada pelo usuário.

Rejeição bancária confirmada permite nova preparação, com revalidação das origens e nova aprovação. A tentativa rejeitada e seu arquivo permanecem imutáveis. Download repetido entrega o mesmo arquivo e não constitui nova tentativa. Cancelamento local de rascunho não cancela arquivo já gerado nem pagamento bancário.

## 7. Retorno e correspondência

Preservar arquivo bruto, hash, perfil, extração versionada e ocorrências. Validar estrutura, segmentos, contagens, totais e contexto antes de aplicar resultados. Retorno estruturalmente inválido não produz aplicação parcial. Mesmo hash no mesmo contexto é idempotente; mesma identidade com conteúdo divergente é conflito. Reprocessamento com parser novo gera extração própria, sem reescrever a anterior.

Correspondência exige identificadores cobertos de empresa, perfil, modalidade, lote/item, referência e documento. Valor ou vencimento isolados não autorizam vínculo. Resultado é único, ausente, múltiplo, conflitante ou `INDETERMINATE`; só correspondência única e coberta permite atualizar estado observado.

Aceitação e agendamento mantêm o item pendente de efetivação e não criam baixa. Rejeição confirmada encerra a tentativa sem baixa. Somente ocorrência coberta de pagamento efetivado gera proposta. Retornos fora de ordem ou contraditórios preservam evidência e ficam pendentes quando não houver transição determinística comprovada; não regredir efetivação por mera ordem de importação. Estorno ou cancelamento bancário observado fica pendente, sem estornar automaticamente a F68.

## 8. Proposta e confirmação financeira

Pagamento efetivado com correspondência única e valor compatível gera proposta idempotente, vinculada à ocorrência e à tentativa. A proposta leva valor e data efetivamente comprovados pelo retorno; não confundir data solicitada com data efetiva. Evidência insuficiente, valor divergente ou saldo incompatível fica em conflito e não produz baixa presumida.

Confirmação humana delega à baixa F68, com revalidação de versão e saldo em transação, preservando a origem CNAB. Mudança financeira posterior à preparação ou à proposta pode bloquear confirmação. Repetir confirmação não duplica baixa. Rejeitar proposta conserva a efetivação observada e não autoriza novo pagamento. Baixa e estorno da F68 continuam sob seu contrato.

## 9. Papéis, isolamento e auditoria

- `auxiliar`: configura rascunho, prepara itens e importa retorno; não aprova, gera arquivo final ou confirma baixa.
- `gestor_financeiro`: aprova/rejeita, gera e confirma/rejeita propostas dentro da carteira, distinto do preparador do ato.
- `admin_escritorio`: mesmas ações no tenant, preservada a segregação.
- `contador` e `auditor_readonly`: consulta e exportação de evidência, sem ato financeiro.
- `cliente_portal` e demais papéis sem alçada: acesso negado; `super-admin` local não decide pagamento empresarial.

Entidades transacionais têm tenant, empresa, índices e RLS; autorização valida carteira no servidor. Aprovação, geração, importação e confirmação usam controle de concorrência e idempotência. Falha conserva último estado íntegro, com retentativa explícita e erro `application/problem+json`, código estável e `correlationId`.

Preparação, alteração de perfil, aprovação/rejeição, geração, download, importação, validação, correspondência, proposta, decisão, reprocessamento e tentativa negada geram trilha append-only com autor, papel, contexto, instante, versão, resultado e referências. Não apagar nem sobrescrever arquivos, decisões ou eventos.

## 10. Contratos de aplicação

Contratos mínimos: perfil versionado de pagamento; preparação com referências e versões F68/F69 e data por item; aprovação segregada; geração idempotente de arquivo/manifesto; importação de retorno; consulta de ocorrências/estado observado; confirmação/rejeição de proposta integrada à F68.

Dados externos entram como `unknown` e são validados. Cálculo, elegibilidade, serialização, parsing e correspondência são determinísticos; relógio entra por parâmetro. Não expor rota de transmissão, consulta bancária ou execução de pagamento. Nomes finais de tipos e rotas são decisão técnica do Codex, preservando esses contratos.

## 11. UI

Ativar a área **Pagamentos** da tela CNAB da F70, sem misturar cobrança com pagamento. Referência de conteúdo e hierarquia: `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/`; aparência e comportamento seguem `FRONTEND.md`, `DESIGN-SYSTEM.md` e contratos em `docs/design-system/`.

Exibir seleção de empresa/perfil, parcelas elegíveis e impedimentos, vínculo F69, valor/saldo, data por item, resumo de lotes, revisão segregada, download, importação, ocorrências, propostas e histórico. Diferenciar arquivo gerado, aceito/agendado, rejeitado, efetivado e baixa confirmada. Não afirmar pagamento por geração ou agendamento.

Estados: carregando, vazio, perfil ausente/incompleto, documento pendente, vencido, valor divergente, rascunho, revisão, aprovado, desatualizado, gerando, gerado, tentativa ativa, retorno validando/inválido, aceito/agendado, rejeitado, efetivado, sem correspondência, ambíguo, conflito, `INDETERMINATE`, proposta pendente/aprovada/rejeitada, erro recuperável, conflito de versão e acesso negado.

Temas CLARO/ESCURO, viewports 375/768/1280/1536 px, teclado, foco, semântica, contraste, máscaras, confirmação e Toast/Sonner. Implementação exige `frontend-design` antes/durante, `impeccable` no acabamento e prova comparativa/visual/E2E conforme `FRONTEND.md` §20.1.

## 12. Invariantes e aceite

| Invariante | Aplicação |
|---|---|
| I-1/I-2 | tenant, empresa, carteira, índices e RLS em todas as operações |
| I-3/I-4 | centavos inteiros e regras determinísticas; LLM não calcula nem decide |
| I-5 | aprovação e baixa humanas, registradas e segregadas |
| I-6/I-7 | eventos append-only; artefatos e decisões preservados |
| I-9 | tentativa, geração, importação, proposta e baixa idempotentes |
| I-11 | datas civis; timestamps exibidos em America/Sao_Paulo |
| I-12 | mesmos snapshots e pacote reproduzem arquivo e interpretação |

Critérios verificáveis:

1. Parcela elegível com documento F69 produz remessa BB 240 válida de sua modalidade após aprovação segregada.
2. Valor divergente, vencido, origem desatualizada, perfil incompleto e cobertura desconhecida bloqueiam sem efeito financeiro.
3. Não há duplicação por concorrência, geração repetida, download ou reapresentação documental.
4. Aceitação/agendamento não gera baixa; rejeição confirmada permite nova preparação; efetivação única gera proposta revisável.
5. Retorno inválido, ambíguo, conflitante ou fora de cobertura não aplica baixa nem libera reenvio.
6. Confirmação segregada revalida a F68 e produz uma baixa; reimportação e repetição não duplicam proposta ou baixa.
7. UI e histórico distinguem estado bancário observado de estado financeiro, nos dois temas e quatro viewports.

## 13. Provas exigidas

Testes de regras cobrem valor/data, elegibilidade, transições, rejeição/reenvio, efetivação, eventos fora de ordem e idempotência. Fixtures oficiais/versionadas cobrem segmentos obrigatórios, posições, tamanho, contagens, totais e retornos de cada modalidade suportada.

Testes de banco cobrem RLS, alçada, reserva concorrente, geração/manifesto atômicos, persistência imutável e confirmação concorrente. Testes de tela cobrem estados, mensagens, segregação e acesso negado. E2E percorre F68/F69 → preparação → aprovação → arquivo → retorno → proposta → confirmação F68, incluindo rejeição e reimportação.

Prova visual nos dois temas/quatro viewports, responsividade e acessibilidade. Evidência por SPEC/issue conforme `TESTING.md`; ausência de prova externa é `not_run`, nunca PASS. Aceite de entrega: CI verde; aceite final do card exclusivamente pelo PI.

## 14. Fora de escopo e destinos

| Complemento | Destino e gatilho |
|---|---|
| Tributos sem código de barras | fatia própria de pagamentos tributários CNAB no MVP-2; tipos, manuais e campos aprovados |
| Juros, multa, desconto e atualização de valores | fatia própria de atualização financeira no MVP-2; regras e modalidade aprovadas |
| Pagamentos avulsos | fatia própria de origens financeiras de pagamento no MVP-2; criação/vínculo aprovados |
| Outros bancos | adaptadores próprios no MVP-2; recorte, manuais e fixtures aprovados |
| Folha | fatia própria de validação CNAB de folha no MVP-2, sem execução e sem antecipar RF-05 |
| Alteração/cancelamento de instrução bancária e estorno retornado | fatia própria de manutenção de pagamentos CNAB no MVP-2; ciclo e ocorrências aprovados |
| Conciliação e contabilização automática | fatias próprias de conciliação e integração financeiro-contábil no MVP-2; contratos aprovados |
| Transmissão, SFTP, API ou consulta online | fatia própria de integração bancária no MVP-2; parceiro/contrato aprovados; produção somente após MVP-4 e gate próprio |
| Open Finance, ITP, Pix, aging e fluxo projetado | fatias próprias já previstas no MVP-2; recortes aprovados |

## 15. Decisões resolvidas e gate documental

PI aprovou em 30/09/2026: pagamentos; BB CNAB 240; boletos, tributos e convênios com código de barras; remessa e retorno locais; F68 vinculada à F69; valor exato validado; data explícita por item; segregação F70; reenvio somente após rejeição confirmada; bloqueio de vencidos; proposta revisável de baixa. Nenhuma dúvida de produto permanece aberta neste recorte.

Tamanho Grande: geração, retorno e revisão financeira permanecem na mesma vertical para provar o ciclo completo; complementos têm destino nomeado. Identidade, origem PRD, invariantes, UI, critérios, provas e limites estão explícitos. Índice, MVP, README, rastreabilidade e fora de escopo devem acompanhar esta SPEC; não cria efeito externo nem reduz requisitos remanescentes do PRD.
