# SPEC-074 — Pagamentos tributários BB sem código de barras por CNAB 240

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F74
> **Issue:** [#88](https://github.com/RodReis/rrb-contaia/issues/88), sub-issue nativa do MVP-2 #31
> **Origem:** PRD §§3, 5.3, 7.1, 9.1, 10.4, 12, 13.2, 14, 15 e 16
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 30/09/2026

## 1. Objetivo

Preparar, revisar, aprovar e gerar localmente remessas BB CNAB 240 para DARF comum, DARF Simples e GPS sem código de barras. Importar retorno, distinguir aceitação/agendamento de efetivação e criar proposta revisável de baixa F68 somente para efetivação inequivocamente correspondente. Não transmitir ao banco nem executar baixa automática. Desenvolvimento e homologação permanecem em Docker local.

## 2. Origem e documento

Cada item exige parcela a pagar F68 publicada, com saldo aberto, e guia externa anexada, legível e validada. A entrada estruturada dos campos da guia pode ser manual ou pré-preenchida por origem interna aprovada; em ambos os casos o usuário confere e confirma a correspondência com o anexo. Apurações F37/F38 e seus rascunhos locais de DARF servem apenas como referência comparativa: não substituem a guia externa nem provam emissão oficial. GPS pode ter origem manual até existir capacidade interna aprovada. A F74 não cria título avulso, guia oficial ou obrigação tributária.

Preservar arquivo original, hash, modalidade, identificação do contribuinte, competência/período, código de receita ou recolhimento, referência, vencimento, valor e demais campos exigidos pelo leiaute comprovado, com origem e versão. Valor solicitado = valor validado da guia = saldo aberto F68, em centavos. Identidade da empresa, guia e parcela deve ser determinística; divergência, duplicidade inequívoca, origem superada, guia ilegível ou campo obrigatório desconhecido bloqueiam. Não inferir modalidade pelo nome do arquivo ou apenas pelo código de ocorrência.

## 3. Cobertura técnica

Banco `001`, CNAB 240 de pagamentos. Fonte inicial consultada em 30/09/2026: [Arquivo de Pagamentos — Particularidades BB](https://bb.com.br/docs/pub/emp/empl/dwn/PgtVer03BB.pdf), que descreve segmentos N para tributos sem código de barras, inclusive DARF Simples; [BB Gestão Max](https://www.bb.com.br/site/setor-publico/aplicativos/bb-gestao-max/) lista DARF, DARF Simples e GPS. Essas publicações indicam possibilidade, não comprovam contrato, versão ou habilitação de um perfil bancário concreto.

Manter matriz versionada por modalidade, segmento/subsegmento, perfil/convênio, campos, retornos e vigência, com fonte BB/FEBRABAN, URL, título, versão, data de consulta, hash e fixtures aprovadas. Gerador e parser independentes devem validar posições, tamanho, contagens e totais. Cobertura ausente, contraditória ou não comprovada resulta em `INDETERMINATE`: registrar causa e bloquear geração ou aplicação correspondente. Não adaptar segmentos J/O da F72 para N.

## 4. Vencimento, revisão e remessa

O usuário informa data civil de pagamento por item. Guia já vencida, data posterior ao vencimento, saldo divergente ou guia/compromisso alterado após revisão bloqueiam. Não calcular juros, multa, desconto, tarifa ou atualização; não zerar componente desconhecido para fazê-lo caber no arquivo. Preparação captura snapshot F68, guia, campos, perfil técnico e pacote de cobertura. Revisão segregada compara anexo, dados estruturados, valor, data e impedimentos. Aprovação congela snapshot; alteração exige nova revisão.

Herdar da F72 a segregação de papéis, geração transacional e idempotente, manifesto com versões/hashes/contagens/totais, reserva de uma tentativa ativa por parcela/finalidade, e reenvio apenas após rejeição bancária confirmada. Gerar lotes homogêneos conforme o manual aplicável. Download repetido preserva bytes. Arquivo gerado não prova recebimento, agendamento ou pagamento pelo banco.

## 5. Retorno e efeito financeiro

Importar original imutável; validar estrutura e pacote técnico antes de aplicar. Corresponder retorno por identificadores, perfil, modalidade, arquivo e tentativa, sem aproximação por valor ou data. Reimportação idêntica é idempotente; mesmo identificador com conteúdo divergente, retorno sem par, contraditório ou fora de ordem permanece em conflito auditável. Aceitação e agendamento não alteram F68. Só efetivação confirmada e correspondente produz proposta idempotente de baixa total ou parcial, com valor e data observados, para confirmação humana segregada na F68. Rejeição da proposta não apaga o fato bancário nem libera nova tentativa; ausência de retorno não libera reserva.

Toda preparação, decisão, geração, download, importação, conflito, proposta e confirmação registra evento append-only com tenant, empresa, ator, instante, `correlationId`, origens, versões e resultado. Aplicar RLS e carteira no servidor; dinheiro em centavos, data civil e erros `application/problem+json` com código estável. Transmissão, API/SFTP e produção dependem de integração própria e gate posterior ao MVP-4.

## 6. Interface e provas

Ampliar a área Pagamentos da gestão financeira com modalidade, vínculo F68, guia anexada, comparação com origem interna, dados estruturados, cobertura, impedimentos, revisão, arquivo, retorno, proposta de baixa e histórico. Seguir `docs/FRONTEND.md`, `docs/DESIGN-SYSTEM.md` e protótipo correspondente em `docs/telas/`; temas claro/escuro, 375/768/1280/1536 px, acessibilidade e estados vazio, carregando, vencido, divergente, `INDETERMINATE`, revisão, gerado, agendado, efetivado, rejeitado, conflito e acesso negado. Aplicar `frontend-design` e `impeccable` na implementação da UI.

Provar por modalidade DARF comum, DARF Simples e GPS: campos e arquivo/retorno com fixtures aprovadas, comparação anexo–F68, segregação, idempotência, rejeição/agendamento/efetivação, proposta única de baixa, concorrência, isolamento e bloqueios por vencimento, origem superada, guia ausente e cobertura incerta. Incluir regras, banco, tela, E2E e prova visual dos dois temas conforme `docs/TESTING.md`. Ausência de manual/fixture compatível é `not_run` para a prova daquela modalidade, nunca PASS.

## 7. Complementos e decisões

| Complemento | Destino e gatilho |
|---|---|
| DARF numerado/DCTFWeb e outras guias | fatias próprias de pagamentos tributários no MVP-2; modalidade e contrato oficial aprovados |
| Guia vencida, juros, multa e atualização | fatia de atualização financeira no MVP-2; regras e fontes aprovadas |
| Títulos avulsos e origens adicionais | fatia de origens financeiras no MVP-2; contrato de origem aprovado |
| Transmissão e consulta bancária | integração BB própria no MVP-2; contrato/parceiro aprovado, produção após MVP-4 e gate |
| Conciliação e contabilização automática | fatias próprias no MVP-2; contratos aprovados |

PI aprovou DARF comum e Simples, GPS, entrada estruturada manual ou interna, guia externa validada obrigatória, vínculo a parcela F68 publicada, bloqueio de vencidos e ausência de cálculo de acréscimos. A cobertura por modalidade exige evidência técnica; ausência dela bloqueia a operação sem criar uma promessa de suporte irrestrito.
