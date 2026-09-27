# SPEC-070 — Núcleo CNAB de cobrança do Banco do Brasil

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F70
> **Origem:** PRD §§3, 5.3, 6.5, 7.1, 9.1, 10.4, 12, 13.2, 14, 15 e 16
> **Tamanho:** Grande
> **Estado:** aprovada pelo PI em 27/09/2026

---

## 1. Objetivo

Entregar o núcleo local de cobrança bancária por arquivos CNAB 240 e CNAB 400 do Banco do Brasil. A fatia prepara remessa de entrada de títulos a receber da F68, gera o arquivo e seu manifesto, importa o retorno bancário, reconhece confirmação, rejeição e liquidação e cria proposta revisável de baixa total ou parcial.

A F70 prova o ciclo determinístico de arquivo sem transmitir remessa, consultar o banco, registrar boleto externamente, movimentar dinheiro ou baixar título automaticamente. O Banco do Brasil é o único adaptador bancário obrigatório desta fatia; núcleo comum não equivale a compatibilidade declarada com outro banco.

## 2. Resultado observável

Em `Financeiro -> CNAB de cobrança`, o usuário pode:

- selecionar uma empresa, uma configuração local de cobrança BB e o leiaute 240 ou 400;
- localizar parcelas publicadas da F68, a receber, com saldo aberto e ainda sem boleto ou registro bancário;
- completar e revisar os dados obrigatórios do pagador em snapshot da remessa;
- validar elegibilidade, campos, posições, totais, sequência e cobertura do leiaute antes de gerar;
- preparar e submeter uma remessa para revisão segregada;
- aprovar e gerar o arquivo local, o manifesto e os hashes reproduzíveis;
- baixar o arquivo local sem transmiti-lo ao banco;
- importar um retorno BB 240 ou 400 e visualizar sua validação estrutural;
- consultar confirmações, rejeições e liquidações reconciliadas com a remessa e a parcela F68;
- revisar proposta idempotente de baixa total ou parcial originada por liquidação;
- consultar original, extração, divergências, decisões e trilha append-only.

Gerar arquivo não significa registrar cobrança no banco. Importar liquidação não significa baixar automaticamente a parcela.

## 3. Dependências e autoridades

| Fonte | Autoridade consumida |
|---|---|
| F2/F3 | empresa, CNPJ, endereço e situação cadastral |
| F7–F10 | usuário, papel, carteira, isolamento e RLS |
| F24 | auditoria append-only e evidência íntegra |
| F68 | compromisso, parcela, direção, contraparte, publicação, saldo, baixa e estorno |
| F70 | configuração CNAB local, remessa, item, snapshot do pagador, arquivo, retorno, ocorrência e proposta de baixa |

A F68 permanece autoridade para existência, situação e saldo da parcela. A F70 não altera silenciosamente título, contraparte ou baixa; preserva referências e snapshots utilizados no arquivo.

## 4. Fontes técnicas e cobertura

O pacote técnico versionado da F70 registra URL, título, versão identificável, data de consulta, hash e vigência operacional das seguintes fontes oficiais:

- **CNAB 240:** manual `Padrão FEBRABAN 240 Posições V6.0` publicado pelo Banco do Brasil, limitado ao serviço de cobrança e aos registros exigidos pelo perfil BB adotado;
- **CNAB 400:** leiaute Banco do Brasil `CBR643`, limitado à cobrança simples e aos registros de remessa e retorno cobertos por fixtures aprovadas;
- tabelas BB de códigos, carteiras, comandos e ocorrências referenciadas pelos manuais aplicáveis.

Fonte ausente, versão incompatível, carteira não coberta, código desconhecido ou conflito entre manual e arquivo produz `INDETERMINATE`. A F70 não completa posição, código ou semântica por aproximação e não trata o leiaute FEBRABAN como garantia de interoperabilidade entre bancos.

## 5. Configuração CNAB local

`BankCollectionProfile` representa uma configuração de cobrança por tenant e empresa, com banco `001`, leiaute, versão, agência, conta, convênio, carteira/modalidade, identificadores exigidos, sequência atual e pacote técnico.

A configuração é local e não contém senha, token, certificado nem canal de transmissão. Campos sigilosos não previstos no arquivo não são coletados. Alteração de dado que muda a serialização cria nova versão do perfil; remessas históricas continuam vinculadas à versão usada.

Perfil incompleto, arquivado, de outra empresa, com carteira fora da cobertura ou sem pacote técnico aplicável bloqueia a geração. CNAB 240 e CNAB 400 usam perfis explicitamente compatíveis; a tela não converte um perfil entre leiautes por suposição.

## 6. Elegibilidade do recebível

Cada item parte de exatamente uma `FinancialInstallment` da F68 que esteja:

- sob o mesmo tenant e empresa do perfil;
- na direção `RECEIVABLE`;
- publicada, aberta ou parcialmente liquidada, com saldo positivo;
- sem boleto F69 vinculado, sem registro bancário confirmado e sem item ativo em outra remessa;
- em BRL, com valor e vencimento válidos;
- com contraparte identificada e dados do pagador completos para o leiaute.

Título cancelado, liquidado, vencimento ausente, saldo divergente, origem superada ou parcela já remetida não entra. Possível duplicidade ou vínculo bancário anterior fica pendente; não é vencido por confirmação genérica.

O valor remetido é o saldo aberto aprovado no instante do snapshot. Alteração posterior da F68 não reescreve a remessa: antes da geração, torna o item desatualizado e exige nova preparação; depois da geração, permanece divergência auditável para decisão humana.

## 7. Snapshot do pagador

`RemittancePayerSnapshot` preserva nome, CPF/CNPJ, endereço, número, complemento, bairro, município, UF e CEP usados na serialização, além da origem de cada campo.

Nome e CPF/CNPJ partem do snapshot F68 quando disponíveis. O usuário completa os campos adicionais no preparo da remessa. Essa complementação pertence ao item CNAB, não cria cadastro mestre nem altera a contraparte F68.

CPF/CNPJ, CEP, UF e limites posicionais são validados deterministicamente. Truncamento silencioso é proibido: conteúdo maior que o campo fica pendente para correção explícita antes da aprovação.

## 8. Remessa, manifesto e serialização

`CollectionRemittance` agrupa um ou mais itens da mesma empresa, perfil, leiaute, versão, convênio e carteira. Misturar contextos incompatíveis é proibido.

Estados persistidos:

`DRAFT -> PENDING_REVIEW -> APPROVED -> GENERATED`

Transições alternativas:

- `DRAFT | PENDING_REVIEW -> REJECTED`, com motivo;
- `DRAFT | PENDING_REVIEW -> STALE`, quando perfil, parcela ou pacote aplicável mudar;
- `GENERATED -> SUPERSEDED`, somente por nova remessa relacionada, sem apagar a anterior.

A geração produz atomicamente:

- arquivo de largura fixa com encoding e finais de linha definidos pelo perfil;
- manifesto com tenant, empresa, perfil, leiaute, versão, sequência, itens, contagens e totais;
- hash do arquivo, hash do manifesto e versão do serializador;
- relatório de validação por registro e posição.

Cada registro possui exatamente 240 ou 400 caracteres conforme o leiaute. Cabeçalhos, lotes, detalhes, trailers, sequências, quantidades e totais fecham exatamente. Dinheiro usa inteiro em centavos; preenchimento, alinhamento e datas seguem o pacote técnico.

## 9. Identidade e idempotência da remessa

A identidade lógica considera tenant, empresa, perfil versionado, leiaute, sequência e conjunto ordenado de snapshots dos itens. Aprovar novamente a mesma identidade retorna a remessa existente e não consome nova sequência.

A sequência é alocada transacionalmente por perfil apenas na geração bem-sucedida. Falha não deixa lacuna publicada nem arquivo parcial. Mesmo número com conteúdo diferente retorna HTTP 409 e exige nova preparação.

Uma parcela não participa de duas remessas ativas para o mesmo registro. Nova tentativa após rejeição bancária referencia a remessa anterior e usa nova sequência, preservando ambas.

## 10. Importação e preservação do retorno

`CollectionReturnImport` preserva arquivo original imutável, hash, tamanho, encoding detectado e confirmado, leiaute declarado e detectado, perfil, instante, autor e versão do parser.

A importação valida largura, caracteres, banco, empresa/convênio, sequência, estrutura, registros, trailers, contagens e totais antes de produzir ocorrências. Arquivo truncado, misto, corrompido, de outro banco, perfil ou empresa não é aplicado parcialmente.

O mesmo hash no mesmo contexto é idempotente. Mesmo identificador de retorno com conteúdo diferente é conflito. Nova versão do parser cria nova extração vinculada e não reescreve a anterior.

## 11. Ocorrências funcionais do núcleo

A F70 dá comportamento financeiro apenas a:

- confirmação de entrada/registro;
- rejeição de entrada, com todos os códigos e descrições preservados;
- liquidação normal, parcial ou por saldo quando coberta pelo manual e fixture aprovada;
- estorno de liquidação somente como ocorrência pendente, sem estornar automaticamente a baixa F68.

Demais códigos são preservados como `UNSUPPORTED_OCCURRENCE`, com conteúdo bruto, interpretação disponível no pacote e destino na fatia própria de extensão do ciclo CNAB. Código desconhecido resulta em `INDETERMINATE` e nunca é tratado como sucesso.

Confirmação vincula a identificação bancária ao item CNAB, sem afirmar transmissão feita pelo ContaIA. Rejeição encerra aquela tentativa, não cancela o título F68 e permite preparar nova remessa relacionada.

## 12. Correspondência e proposta de baixa

A correspondência determinística usa, na ordem de autoridade disponível:

1. remessa e item internos referenciados pelo identificador empresarial;
2. perfil, convênio, carteira e identificação bancária;
3. empresa, parcela F68, CPF/CNPJ, valor e vencimento do snapshot.

Resultados possíveis:

- `UNIQUE_MATCH`: uma parcela e um item compatíveis;
- `NO_MATCH`: ocorrência preservada, sem efeito;
- `MULTIPLE_MATCHES`: candidatos apresentados para revisão, sem escolha automática;
- `CONFLICT`: identificador existe, mas valor, empresa, pagador ou referência diverge;
- `INDETERMINATE`: regra, código ou evidência insuficiente.

Liquidação com `UNIQUE_MATCH` cria `SettlementProposal` idempotente. Valor recebido igual ao saldo propõe baixa total; valor positivo menor propõe baixa parcial; valor maior, zero, negativo ou incompatível fica em conflito. Juros, multa, desconto, tarifa e outros componentes permanecem separados quando o retorno os informar; a F70 não inventa rateio.

Somente `gestor_financeiro` ou `admin_escritorio` distinto do preparador confirma a proposta. A confirmação delega à baixa F68 e preserva a ocorrência CNAB como origem. Rejeição da proposta não apaga retorno nem ocorrência.

## 13. Autorização e segregação

- `auxiliar`: configura rascunho, seleciona parcelas, completa snapshot, prepara remessa e importa retorno; não aprova, gera arquivo final nem confirma proposta;
- `gestor_financeiro`: aprova/rejeita remessa, gera artefato e confirma/rejeita proposta dentro da carteira, desde que não tenha preparado o ato;
- `admin_escritorio`: mesmas ações no tenant, preservada a segregação;
- `contador`: consulta arquivos, ocorrências, propostas e trilha; não executa ato financeiro;
- `auditor_readonly`: consulta e exporta evidência sem mutação;
- `cliente_portal` e papéis sem permissão: acesso negado;
- `super-admin` local: mantém infraestrutura, sem decidir cobrança empresarial.

Download do arquivo gerado é auditado. A F70 não oferece upload, SFTP, API ou outro envio ao banco.

## 14. Isolamento, concorrência e falhas

- entidades transacionais carregam `tenant_id` e `empresa_id`, índices e RLS;
- toda consulta valida empresa e carteira no servidor;
- aprovação, geração, importação e confirmação de proposta usam versão otimista;
- arquivo, manifesto e hashes são persistidos atomicamente;
- retorno inválido não produz ocorrência parcial nem proposta;
- falha preserva o último estado íntegro e permite retentativa explícita;
- erro segue `application/problem+json` com código estável e `correlationId`.

## 15. Auditoria

Criação e alteração de perfil, seleção de parcela, edição de snapshot, submissão, aprovação, rejeição, geração, download, importação, validação, extração, correspondência, proposta, confirmação, rejeição, reprocessamento e tentativa negada geram evento append-only.

Cada evento registra tenant, empresa, autor, papel, instante, `correlationId`, entidade, versão, resultado, motivo e referências F68. Arquivo, manifesto, retorno, extração, ocorrência e decisão não são apagados fisicamente.

## 16. Invariantes globais tocados

| Invariante | Aplicação na F70 |
|---|---|
| I-1 | perfis, remessas, itens, retornos, ocorrências e propostas carregam tenant e empresa, índices e RLS |
| I-2 | consulta sem empresa e carteira não retorna dado bancário ou financeiro |
| I-3 | valores e totais usam inteiros em centavos; nenhuma serialização usa float |
| I-4 | elegibilidade, layout, parsing, correspondência e proposta são determinísticos; LLM não decide |
| I-5 | aprovação da remessa e confirmação da baixa são humanas e segregadas |
| I-6 | arquivos, snapshots, ocorrências e decisões preservam histórico append-only |
| I-7 | artefato gerado e retorno importado não são sobrescritos nem excluídos fisicamente |
| I-9 | geração, importação, ocorrência e proposta são idempotentes |
| I-11 | vencimento é data civil; timestamps exibem `America/Sao_Paulo` |
| I-12 | mesma entrada e pacote técnico reproduzem arquivo, validação e correspondência |

## 17. Contrato de UI

A UI usa `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/` para conteúdo, hierarquia e densidade, limitada à cobrança por arquivo e à integração com os recebíveis F68. Pagamentos, folha, Open Finance, Pix e conciliação aparecem apenas como destinos indisponíveis.

A tela apresenta seleção de empresa e perfil BB, alternância 240/400, parcelas elegíveis, editor do snapshot, validações por campo e posição, resumo de lotes/totais, revisão segregada, download, upload de retorno, ocorrências, conflitos, propostas de baixa e histórico.

Estados obrigatórios: carregando, vazio, perfil ausente/incompleto, rascunho, pendente de revisão, desatualizado, aprovado, gerando, gerado, retorno enviando/validando/válido/inválido, confirmação, rejeição, liquidação total/parcial, sem correspondência, múltiplos candidatos, conflito, ocorrência não suportada, `INDETERMINATE`, proposta pendente/aprovada/rejeitada, erro recuperável, conflito de versão e acesso negado.

A implementação entrega temas CLARO e ESCURO, viewports de 375, 768, 1280 e 1536 px, teclado, foco, semântica, contraste, densidade adequada para registros, confirmação e Toast/Sonner. `frontend-design` é obrigatória antes e durante a implementação; `impeccable`, no acabamento. A PR prova comparação visual, responsividade, estados e acessibilidade conforme `FRONTEND.md` §20.1.

## 18. Critérios de aceite verificáveis

| Categoria | Prova obrigatória |
|---|---|
| Perfil | somente banco 001, leiaute, versão, convênio e carteira cobertos geram remessa |
| Elegibilidade | apenas parcela F68 a receber, publicada, aberta e sem boleto/registro ativo entra |
| Snapshot | campos obrigatórios validam sem truncamento silencioso e não alteram F68 |
| CNAB 240 | cada registro tem 240 posições; headers, lotes, detalhes, trailers, contagens e totais fecham |
| CNAB 400 | cada registro tem 400 posições; header, detalhes, trailer, sequência, contagens e totais fecham |
| Reprodutibilidade | mesma entrada, perfil e pacote produzem os mesmos bytes e hashes |
| Retorno | arquivo íntegro gera extração versionada; inválido não produz efeito parcial |
| Ocorrências | confirmação, rejeição e liquidação são reconhecidas; código desconhecido fica `INDETERMINATE` |
| Correspondência | candidato único cria proposta; zero, múltiplos ou conflito não escolhem automaticamente |
| Baixa | liquidação total/parcial cria proposta idempotente e nunca baixa sem confirmação humana |
| Idempotência | repetição não duplica sequência, remessa, retorno, ocorrência, proposta ou baixa |
| Autorização | auxiliar prepara; gestor/admin aprovam; contador e auditor consultam |
| Banco de dados | RLS, carteira, atomicidade, concorrência e append-only são provados |
| UI | dois temas, quatro viewports, estados, teclado, foco, contraste e acabamento são provados |
| Efeito externo | nenhum teste transmite arquivo, usa credencial bancária ou afirma registro real |

## 19. Provas exigidas

- fixtures BB versionadas de remessa e retorno CNAB 240 e CNAB 400, sem dado pessoal real;
- testes parametrizados de largura, tipo, posições, preenchimento, encoding, datas, valores, sequências, contagens e totais;
- parser independente do gerador para validar os artefatos produzidos;
- testes negativos para perfil incompleto, carteira não coberta, snapshot inválido, truncamento, parcela inelegível e remessa desatualizada;
- testes de retorno confirmado, rejeitado, liquidado total/parcial, duplicado, fora de ordem, truncado, misto, de outro banco e com código desconhecido;
- testes de correspondência para candidato único, nenhum, múltiplos e conflito;
- testes de banco para RLS, carteira, sequência concorrente, atomicidade, idempotência e auditoria;
- E2E de parcela F68 até arquivo local e de retorno até proposta revisável e baixa confirmada;
- prova visual nos dois temas e quatro viewports.

## 20. Fora de escopo e destinos obrigatórios

| Item | Destino obrigatório |
|---|---|
| Alteração de vencimento, desconto, protesto, sustação, baixa de registro e demais instruções/ocorrências avançadas | fatia própria de extensão do ciclo CNAB de cobrança no MVP-2 |
| CNAB 240 de pagamento de boletos e tributos | fatia própria de pagamentos CNAB no MVP-2 |
| CNAB 240 de folha sem execução | fatia própria de validação de arquivo de folha no MVP-2, sem antecipar RF-05 |
| Bancos diferentes do Banco do Brasil | adaptadores bancários próprios no MVP-2, com manual oficial e fixtures aprovadas |
| API Cora para cobrança, pagamento, extrato e webhooks | fatia própria de integração bancária por API no MVP-2 |
| Transmissão de remessa, SFTP, API ou confirmação online | integração bancária própria; produção somente após o MVP-4 |
| Boleto F69 já existente como origem de nova remessa | permanece evidência F69; não é registrado novamente pela F70 |
| Emissão visual de boleto, consulta externa e segunda via | fatia própria de integração bancária no MVP-2 |
| Aging e fluxo de caixa 30/60/90 | fatia própria de aging e fluxo projetado no MVP-2 |
| Open Finance, ITP, Pix e conciliação multi-critério | fatias próprias do MVP-2 |
| Cadastro mestre e deduplicação de contrapartes | fatia própria de contrapartes financeiras no MVP-2 |
| Baixa automática e lançamento contábil automático | fatias próprias de conciliação e integração financeiro-contábil no MVP-2 |

## 21. Dúvidas resolvidas

| Pergunta | Decisão do PI em 27/09/2026 |
|---|---|
| Qual capacidade ocupa F70/SPEC-070? | núcleo CNAB de cobrança do Banco do Brasil |
| Quais leiautes? | cobrança em CNAB 240 e CNAB 400 |
| Qual direção financeira? | contas a receber; pagamentos ficam em fatia própria do MVP-2 |
| Qual banco inicial? | Banco do Brasil; Cora usa API e fica em fatia própria |
| Qual origem da remessa? | parcela F68 publicada a receber, sem boleto F69 e sem registro bancário ativo |
| Como obter dados adicionais do pagador? | snapshot imutável preenchido na remessa, sem cadastro mestre e sem alterar F68 |
| Qual ciclo entra? | registro, confirmação, rejeição e liquidação; ciclo avançado fica em fatia própria do MVP-2 |
| O retorno baixa automaticamente? | não; cria proposta idempotente sujeita a revisão humana segregada |
| Há transmissão ou efeito externo? | não; arquivo e retorno são operados localmente |
| Há questões abertas? | Nenhuma |

## 22. Gate de conformidade documental

- **Identidade:** F70/SPEC-070, MVP-2 e origem no PRD estão explícitos.
- **Comportamento:** preparo, geração, importação, ocorrência, correspondência e proposta são observáveis.
- **Aceite:** regras, arquivos, integração F68, banco, autorização, tela e E2E têm provas verificáveis.
- **Invariantes:** I-1 a I-7, I-9, I-11 e I-12 aplicáveis estão declarados.
- **Limites:** não há ciclo avançado, pagamentos, folha executável, outro banco, transmissão ou baixa automática.
- **Dúvidas:** todas as decisões do PI estão registradas; não há questão aberta.
- **Destinos:** cada complemento aponta capacidade, fatia e MVP obrigatórios.
- **UI:** referência, estados, temas, viewports, acessibilidade e skills estão explícitos.
- **Tamanho:** Grande; geração e retorno formam uma vertical auditável única, enquanto instruções avançadas foram separadas em fatia própria.

## 23. Aprovação

Recorte aprovado pelo PI em 27/09/2026 para criação da issue, commit e push direto na `main`.
