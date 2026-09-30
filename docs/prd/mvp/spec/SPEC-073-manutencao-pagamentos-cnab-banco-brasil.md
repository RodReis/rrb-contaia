# SPEC-073 — Manutenção de pagamentos BB por CNAB 240

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F73
> **Issue:** [#87](https://github.com/RodReis/rrb-contaia/issues/87), sub-issue nativa do MVP-2 #31
> **Origem:** PRD §§3, 5.3, 7.1, 9.1, 10.4, 12, 13.2, 14, 15 e 16
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 30/09/2026

## 1. Objetivo e comportamento observável

Manter pagamentos locais BB CNAB 240 originados na F72: preparar alteração de data e valor ou cancelamento de instrução, revisar, aprovar e gerar arquivo local; importar retorno correspondente e tratar estorno bancário confirmado por proposta revisável vinculada à baixa original F68.

O usuário consulta a tentativa original, cobertura e impedimentos, compara valores/datas anteriores e propostos, acompanha aprovação segregada e baixa arquivo/manifesto. O histórico distingue pedido local, resultado bancário observado e efeito financeiro confirmado. Geração e aceitação não confirmam alteração, cancelamento ou estorno. Todo desenvolvimento e homologação permanece em Docker local; produção somente após MVP-4 e gate próprio.

## 2. Autoridades e origens

| Origem | Autoridade |
|---|---|
| F68 | parcela, saldo, baixa original, estorno e versão financeira |
| F69 | documento atualizado, valor validado, vencimento e vínculo confirmado |
| F72 | perfil versionado, tentativa original, arquivo, manifesto, identificadores e estado bancário observado |
| F73 | instrução de manutenção, snapshot comparativo, aprovação, arquivo, retorno e proposta de estorno |

Somente tentativas F72 da mesma empresa/perfil/modalidade com identidade comprovada podem ser mantidas. Não criar pagamento avulso, trocar empresa, favorecido ou identidade do pagamento por similaridade. Documento atualizado precisa ser validado e vinculado na F69; compatibilidade com a identidade bancária original também deve estar comprovada. Documento diferente sem correspondência técnica não vira alteração do pagamento anterior.

## 3. Cobertura oficial e pacote técnico

Banco `001`, CNAB 240 de pagamentos, modalidades J/J52 e O herdadas da F72. Fonte inicial consultada em 30/09/2026: [Arquivo de Pagamentos — Particularidades BB](https://bb.com.br/docs/pub/emp/empl/dwn/PgtVer03BB.pdf), julho/2019. A publicação descreve exclusão em J/J52 e O. A tabela geral de retorno lista sucesso de alteração e exclusão, mas isso não comprova alteração de data/valor para cada modalidade. Estorno também exige evidência oficial específica; não presumir suporte ou vigência operacional pelo PDF acessível.

Manter matriz versionada por modalidade, operação, perfil/convênio, versão, campos, identificação original, estados elegíveis, restrições e ocorrências. Pacote inclui fontes oficiais BB/FEBRABAN aplicáveis, URL, título, versão, consulta, hash, vigência identificada e fixtures aprovadas. Código geral de ocorrência isolado não habilita uma operação em J/O.

Cobertura ausente, conflitante ou não comprovada resulta em `INDETERMINATE`: bloquear geração/aplicação afetada, preservar evidência e informar motivo. Não adaptar instrução de cobrança F71 nem segmento A/N para modalidade J/O. Não substituir alteração sem cobertura por cancelamento e novo pagamento. O requisito permanece nominalmente no complemento do MVP-2 de manutenção BB por modalidade, com gatilho de manual/contrato/fixtures aprovados.

## 4. Alteração de data e valor

Novo valor solicitado = valor do documento validado F69 = saldo aberto vigente F68, em centavos inteiros. Alteração pode mudar data, valor ou ambos, somente nos campos oficialmente cobertos. A F73 não calcula juros, multa, desconto ou atualização. Origens divergentes precisam ser resolvidas na F68/F69 antes da preparação; não corrigir o financeiro por retorno de alteração.

Data civil explícita por item, sem default pelo vencimento; manter restrições F72, inclusive data não posterior ao vencimento. Mudança de documento exige nova validação F69 e prova de identidade técnica compatível. Não alterar pagamento efetivado; cancelamento/estorno seguem seus ciclos próprios. Estado desconhecido, terminal incompatível ou instrução pendente bloqueia operação até resolução evidenciada.

## 5. Preparação, segregação e geração

Preparação captura tentativa original, identificadores, perfil/pacote e versões F68/F69/F72, motivo, operação e comparação anterior/proposta. Fluxo: rascunho → pendente de revisão → aprovado → gerado. Rejeição preserva motivo; correção exige nova revisão. Aprovação congela snapshot; alteração de origem, estado bancário ou pacote antes de gerar exige nova preparação/aprovação.

Manter uma instrução de manutenção em voo por tentativa. Reservas concorrentes não geram alteração e cancelamento simultâneos. Rejeição bancária confirmada encerra a instrução correspondente e permite outra após revalidar elegibilidade; ausência de retorno não libera reserva. Cancelar rascunho não cancela instrução já gerada.

Geração revalida versões, cobertura, segregação e disponibilidade em transação. Arquivo/manifesto são persistidos atomicamente, com operação, origens, identificadores, contagens, totais, versões, hashes e instante imutável da revisão. Mesma geração devolve artefato existente; download não muda bytes. Separar lotes conforme regras oficiais. Depois de gerar, mudanças de origem preservam arquivo e produzem divergência auditável.

## 6. Retorno, estado observado e nova tentativa

Reutilizar importação versionada F72 com extensão de manutenção: original/hash imutáveis, estrutura/contagens/totais validados antes de aplicar, idempotência por contexto e conflito para identidade repetida com conteúdo divergente. Parser novo produz extração própria. Correspondência exige identidade única da tentativa e da instrução, modalidade e contexto cobertos; valor/data isolados não identificam.

Pedido gerado ou aceito permanece pendente. Somente retorno coberto e correspondente confirma alteração ou cancelamento. Alteração confirmada atualiza estado bancário observado e encerra a instrução, sem criar baixa nem nova tentativa de pagamento. Cancelamento confirmado não estorna baixa F68: divergência com efetivação/baixa fica em conflito até resolução evidenciada. Retorno inválido, ambíguo, conflitante ou fora de ordem sem transição comprovada não libera nova remessa; preservar fatos, sem regredir efetivação pela ordem de importação.

Cancelamento confirmado permite nova preparação F72 após revalidar origens e ausência de efeito financeiro incompatível. Estorno confirmado permite nova preparação somente após confirmação do estorno vinculado na F68 ou comprovação transacional de ausência de baixa. Rejeitar proposta não resolve a pendência nem libera pagamento duplicado. A F73 complementa exclusivamente essas condições da trava F72; rejeição bancária já coberta mantém a regra F72.

## 7. Proposta revisável de estorno

Estorno bancário coberto, correspondente à efetivação e à baixa original, gera proposta idempotente com referências, evidência, valor e data comprovados. Sem baixa, registrar ausência verificada e impedir confirmação financeira de proposta de baixa superada pela reversão bancária, preservando histórico. Sem identidade, cobertura ou compatibilidade de valor, manter conflito; não presumir estorno integral/parcial nem inventar regra de rateio.

Confirmação humana segregada revalida versões, vínculo e situação da baixa em transação e delega ao estorno F68, sem apagar evento original. Repetir confirmação ou reimportar retorno não duplica estorno. Baixa já estornada pela F68 exige reconciliar a mesma origem comprovada, sem criar segundo efeito; motivo/valor incompatíveis permanecem em conflito. Rejeição registra decisão e conserva o estorno bancário observado e o bloqueio financeiro pendente.

## 8. Papéis, invariantes e contratos

Herdar segregação F72/F70: auxiliar prepara/importa, sem aprovar/gerar/confirmar; gestor_financeiro e admin_escritorio aprovam, geram e decidem propostas na alçada, distintos do preparador do ato; contador/auditor_readonly consultam; demais papéis sem alçada têm acesso negado. Carteira validada no servidor; super-admin local não decide pagamento empresarial.

Todas as entidades têm tenant/empresa, índices e RLS. I-1/I-2 isolamento; I-3/I-4 centavos e lógica determinística sem LLM; I-5 confirmação humana; I-6/I-7 eventos append-only; I-9 idempotência; I-11 datas civis e America/Sao_Paulo; I-12 snapshots reproduzíveis. Relógio entra por parâmetro; externo entra como unknown validado. Conflitos usam versão otimista, HTTP 409 e application/problem+json com code estável e correlationId.

Contratos mínimos: consulta de cobertura/elegibilidade; preparação de manutenção vinculada à tentativa; revisão segregada; geração idempotente; importação/classificação/correspondência; consulta de estado e histórico; confirmação/rejeição de proposta de estorno F68; avaliação da liberação de nova tentativa F72. Tipos/rotas finais são decisão técnica. Não expor transmissão ou consulta online.

Preparação, revisão, geração, download, importação, conflito, proposta, decisão, liberação negada e reprocessamento registram autor, papel, instante, referências, versões e resultado. Falha preserva último estado íntegro e permite retentativa explícita; não sobrescrever arquivo/evento anterior.

## 9. UI

Ampliar área Pagamentos da tela CNAB F72, com referência em docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/. Exibir tentativa original, cobertura por operação, comparativo, motivo, impedimentos, revisão, download, retorno, proposta de estorno e histórico financeiro/bancário. Mensagens não afirmam execução por arquivo gerado ou aceito.

Estados: carregando, vazio, acesso negado, origem desatualizada, valor divergente, vencido, cobertura INDETERMINATE, revisão/aprovação, gerando/gerado, instrução em voo, retorno inválido, sem correspondência, ambíguo, conflito, alteração/cancelamento confirmado, estorno observado, proposta pendente/confirmada/rejeitada, baixa ausente ou já estornada e erro recuperável.

Seguir FRONTEND.md, DESIGN-SYSTEM.md e docs/design-system/: temas CLARO/ESCURO, 375/768/1280/1536 px, teclado, foco, contraste, semântica, máscaras, confirmação e Toast/Sonner. frontend-design antes/durante, impeccable ao final e prova comparativa/visual/E2E conforme FRONTEND.md §20.1.

## 10. Critérios e provas

1. Operação coberta gera arquivo local válido após revisão segregada, vinculada à tentativa original.
2. Novo valor exige igualdade F68/F69; data após vencimento, origem superada e identidade incompatível bloqueiam.
3. Cobertura não comprovada bloqueia sem fallback de cancelamento/reinclusão.
4. Geração/aceitação não confirmam resultado nem alteram F68; somente retorno correspondente atualiza estado observado.
5. Cancelamento/estorno não liberam nova tentativa com situação bancária ou financeira pendente.
6. Proposta confirmada produz um único estorno F68; rejeição, repetição e concorrência não duplicam nem liberam pagamento indevido.
7. Histórico/UI distinguem instrução, resultado bancário e financeiro nos dois temas.

Regras: campos elegíveis, valores/datas, cobertura, transições, concorrência lógica, eventos contraditórios/fora de ordem, ausência de baixa e idempotência. Fixtures oficiais/versionadas: J/J52/O aplicáveis, identificação, posições, tamanho, contagens/totais, confirmação/rejeição de manutenção e estorno coberto. Não afirmar cobertura sem fixture e manual compatíveis.

Banco: RLS/carteira/alçada, instrução única em voo, arquivo/manifesto atômicos, versões, proposta e confirmação concorrentes. Tela: comparativo, impedimentos, segregação, estados e acesso negado. E2E: F72 → manutenção → aprovação → arquivo → retorno → resultado, e efetivação/baixa F68 → estorno retornado → proposta → confirmação → nova elegibilidade, incluindo repetição/rejeição e bloqueios.

Prova visual nos dois temas/quatro viewports, responsividade e acessibilidade. Evidência rastreável por SPEC/issue conforme TESTING.md. Ausência de prova é not_run, nunca PASS. CI verde para entrega; aceite final do card exclusivamente pelo PI.

## 11. Complementos e destinos

| Complemento | Destino e gatilho |
|---|---|
| Operação/modalidade BB de manutenção sem cobertura comprovada | complemento nominal de manutenção BB por modalidade no MVP-2; manual, contrato e fixtures aprovados |
| Juros, multa, desconto e atualização calculada | fatia de atualização financeira no MVP-2; regras/fontes aprovadas |
| Tributos sem código de barras e pagamentos avulsos | fatias de pagamentos tributários CNAB e origens financeiras no MVP-2; contratos aprovados |
| Outros bancos e modalidades fora da F72 | adaptadores de pagamento/manutenção no MVP-2; recorte oficial aprovado |
| Transmissão, API, SFTP e consulta online | integração bancária própria no MVP-2; parceiro/contrato aprovado, produção após MVP-4 e gate |
| Conciliação e contabilização automática | fatias de conciliação e integração financeiro-contábil no MVP-2; contratos aprovados |

## 12. Decisões resolvidas e gate documental

PI aprovou: manutenção BB CNAB 240; alteração de data e valor com F68/F69 revalidadas; sem cálculo de encargos; cancelamento confirmado por retorno; estorno por proposta revisável vinculada à baixa; nova tentativa após resolução F68 ou ausência comprovada de baixa; operação sem cobertura bloqueada e rastreada, sem substituição automática. Nenhuma dúvida de produto permanece aberta no recorte.

Grande: preparação, retorno e resolução financeira formam uma vertical verificável; capacidades adicionais possuem destino nominal. A capacidade bancária permanece condicionada à evidência técnica por operação, sem promessa de suporte irrestrito. Atualizar os cinco documentos de governança junto desta SPEC; uma issue de fatia, vinculada nativamente ao MVP-2, sem código ou deploy nesta entrega.
