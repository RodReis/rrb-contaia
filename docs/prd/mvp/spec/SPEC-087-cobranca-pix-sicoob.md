# SPEC-087 — Cobrança Pix Sicoob e baixa idempotente

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F87
> **Issue:** [#118](https://github.com/RodReis/rrb-contaia/issues/118)
> **Estado:** aprovada pelo PI em 12/10/2026
> **Tamanho:** Grande
> **PRD:** §§3, 5.3, 7.3, 7.5, 9.1, 10.4, 12, 13.2, 14, 15 e 16

## 1. Resultado observável

Permitir que usuário financeiro autorizado emita pelo Sicoob uma cobrança Pix imediata ou com vencimento para uma parcela publicada a receber na F68. A interface exibe os dados de pagamento e acompanha os estados informados pelo provedor. Quando o Sicoob confirma o recebimento, o sistema registra a baixa correspondente na F68 sem intervenção humana e sem duplicar efeitos em caso de reentrega.

O título, saldo e ciclo de baixa continuam sob autoridade da F68; o Sicoob é autoridade para cobrança e pagamento observados. F87 faz a ponte entre as duas origens, sem contabilização automática, iniciação de pagamento, devolução de valores ou dependência do consentimento Open Finance da F85.

## 2. Emissão e vínculo à F68

- O usuário seleciona empresa, título e parcela a receber publicados e elegíveis na F68. A cobrança fica vinculada à parcela e à empresa de origem; uma cobrança não pode ser associada a outra empresa ou tenant.
- `gestor_financeiro` ou `admin_escritorio` pode emitir a cobrança dentro da carteira autorizada. Outros papéis seguem as permissões existentes na F68 e não recebem alçada financeira nova.
- A cobrança imediata usa a modalidade de pagamento imediato oferecida pela API Pix do Sicoob. A cobrança com vencimento usa a modalidade equivalente do provedor. A tela apresenta identificador, valor, vencimento quando aplicável, QR Code e payload copia-e-cola retornados pelo Sicoob.
- Valor é representado em centavos inteiros e parte do saldo aberto observado na parcela no momento da emissão. F87 não calcula juros, multa ou desconto e não altera o valor nominal da parcela.
- O estado externo da cobrança e o estado financeiro da parcela são exibidos separadamente. Falha ou resposta incerta do provedor não é apresentada como cobrança emitida; a retomada consulta a origem antes de repetir uma operação cujo resultado seja desconhecido.

## 3. Confirmação e baixa financeira

O webhook do Sicoob notifica o recebimento e dispara validação/correlação com a cobrança emitida. Evento não autenticado, malformado, sem correspondência, inconsistente com o estado consultado no provedor ou destinado a outra empresa não cria baixa; permanece como ocorrência rastreável para recuperação.

Cada pagamento confirmado é registrado na F68 como uma baixa vinculada à parcela e à evidência do provedor, preservando identificadores, valor, instante, conta de recebimento e correlação. `e2eid` e `txid`, quando fornecidos pelo contrato vigente do Sicoob, compõem a correlação/idempotência junto à identidade da conta e do tenant. Reentrega do webhook, retry, concorrência e reconciliação não duplicam pagamento nem baixa.

- Pagamento integral reduz o saldo a zero por baixa automática F68.
- Pagamento inferior ao saldo aberto registra baixa parcial somente pelo valor efetivamente recebido; o saldo remanescente continua aberto na F68.
- Se o valor recebido superar o saldo aberto no instante de efetivação, a baixa limita-se ao saldo então disponível. O excedente fica registrado como exceção vinculada ao evento; não é rateado para outra parcela nem devolvido automaticamente.
- Mais de um Pix confirmado para a mesma cobrança é processado como pagamentos distintos quando os identificadores do provedor também forem distintos. A soma nunca pode baixar valor acima do saldo; excedente segue a regra acima.
- Eventos inválidos, repetidos, tardios ou fora de ordem não revertem silenciosamente estado financeiro. Correção de baixa segue os eventos compensatórios e permissões da F68.

Indisponibilidade de webhook ou do provedor mantém o último estado confirmado, identificado como possivelmente desatualizado, e oferece recuperação por consulta ao Sicoob. Apenas resposta verificável de pagamento confirmado produz baixa; ausência de resposta ou divergência permanece pendente de recuperação.

## 4. Autorização, auditoria e invariantes

- Toda cobrança, notificação, confirmação, baixa e exceção carrega tenant e empresa e respeita RLS, carteira, papel e segregação da F68.
- A integração usa somente recursos de recebimento Pix e valida os estados conforme o contrato oficial corrente do Sicoob; não usa API de Pix Pagamentos nem inicia transferência.
- Emissão, vínculo, eventos externos, retries, baixa e exceções preservam histórico append-only, origem, ator ou serviço, instante, `correlationId` e identificadores externos disponíveis.
- Valores permanecem em centavos inteiros; timestamps são exibidos em `America/Sao_Paulo` e datas de vencimento são civis.
- Uma resposta ambígua de emissão é reconciliada antes de tentar novamente; uma confirmação externa não pode duplicar baixa mesmo se houver corrida com baixa manual já registrada.
- Webhooks e respostas externas são dados não confiáveis até validação. Segredos e material de autenticação do provedor nunca são expostos ao navegador.

## 5. Contrato de UI

Estender `Financeiro → Contas a Receber & Pix BaaS`, usando conteúdo e hierarquia da tela financeira em `docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/`. A tela permite selecionar parcela elegível, escolher cobrança imediata ou com vencimento, revisar dados, emitir e apresentar QR/payload; acompanha cobrança, pagamentos vinculados, saldo atualizado e exceções.

Cobrir carregando, sem parcelas elegíveis, cobrança emitida, vencida/expirada quando o provedor confirmar, pagamento pendente, integral, parcial, múltiplos pagamentos, excedente, webhook inválido/duplicado, resultado de emissão incerto, provedor indisponível, conflito com baixa F68, acesso negado e recuperação. Implementar CLARO e ESCURO, responsividade, teclado, foco, semântica, contraste, zoom, comparação com protótipo e E2E conforme `docs/FRONTEND.md` §20.1. Aplicar `frontend-design` e `impeccable`; incluir smoke ao vivo com Playwright.

## 6. Critérios de aceite

1. Usuário autorizado emite cobrança imediata e cobrança com vencimento para parcela publicada e elegível da empresa selecionada; outra empresa/tenant é sempre rejeitada.
2. QR Code, payload, valor, identificador e vencimento são mostrados conforme resposta validada do Sicoob; falha ou resultado incerto nunca aparece como sucesso confirmado.
3. Pagamento confirmado por webhook válido e correlacionado cria automaticamente uma baixa F68; reentrega, retry e processamento concorrente não duplicam efeitos.
4. Recebimento menor que o saldo cria baixa parcial apenas pelo recebido; excedente não baixa acima do saldo, não é rateado nem devolvido automaticamente e fica rastreável como exceção.
5. Pagamentos distintos para a mesma cobrança conservam cada identidade do provedor e não fazem o saldo ficar negativo.
6. Evento inválido, de empresa diferente, sem cobrança correspondente, fora de ordem, repetido, tardio ou não confirmado não cria baixa indevida e tem diagnóstico/recuperação.
7. Indisponibilidade do webhook ou Sicoob preserva estado anterior e permite consulta/retomada sem repetir cegamente uma emissão incerta.
8. Correção preserva histórico e segue as permissões e eventos compensatórios da F68; nenhuma operação Pix cria partida contábil, inicia pagamento ou devolve dinheiro.
9. Provar regras, banco, tela, E2E aplicável, isolamento/RLS, papéis, idempotência, concorrência, valor integral/parcial/excedente, reentrega, timeout e retomada; registrar evidência rastreável por F87/#118 conforme `docs/TESTING.md`.
10. Cobertura bancária positiva requer ambiente local e documentação/credenciais/fixtures oficiais compatíveis com a cooperativa habilitada. Sem essa evidência, prova real é `not_run`, nunca `pass` ou capacidade presumida.

## 7. Fora de escopo e dependências

| Fora desta fatia | Destino |
|---|---|
| ITP, Pix Automático, pagamentos, transferências e devolução de valores | Capacidades próprias do MVP-2; autorização final de pagamento permanece no banco |
| Pix estático, recorrência, lote de cobranças, QR híbrido com boleto e outros provedores | Futura fatia com recorte e cobertura aprovados |
| Alteração de valor, juros, multa, desconto e política de tolerância para divergência | Não definidos nesta fatia; não calcular nem inferir |
| Contabilização automática e conciliação com transações Open Finance | Capacidades próprias do MVP-2, incluindo F86 para conciliação assistida |
| Produção e movimentação financeira produtiva | Etapa própria após MVP-4; esta fatia roda em Docker local |

Antes da integração, confirmar na documentação corrente e para a cooperativa/conta elegível que o Sicoob habilita cobrança imediata, cobrança com vencimento, consulta de Pix e webhook de recebimento. O manual público localizado durante a especificação descreve `cob`, `cobv`, `pix` e `webhook`, mas é de 23/03/2021 e não comprova cobertura comercial/contratual atual. A API Pix e a configuração da cooperativa são independentes do consentimento Open Finance F85.

## 8. Decisões do PI e gate documental

PI aprovou em 12/10/2026: F87/SPEC-087 cobre cobrança Pix Sicoob imediata e com vencimento; pagamento confirmado via webhook baixa a F68 automaticamente e de forma idempotente; recebimento parcial baixa somente o valor recebido; excedente não é distribuído nem devolvido automaticamente e deve permanecer como exceção. Questões de produto abertas: **nenhuma**.

**Referências oficiais consultadas:** [Portal de desenvolvedores do Sicoob](https://developers.sicoob.com.br/portal/contato) e [Manual Sicoob Pix — API Pix (23/03/2021)](https://www.sicoob.com.br/documents/61112012/64877374/Sicoob%2BPix%2B%E2%80%93%2BManual%2Bpara%2Butiliza%C3%A7%C3%A3o%2Bda%2BAPI%2BPix.pdf/994711e9-bdf4-a479-f9f1-33266d83d58c?download=true&t=1627932447480).
