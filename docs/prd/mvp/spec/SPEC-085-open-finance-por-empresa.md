# SPEC-085 — Open Finance por empresa via agregador

> **MVP:** MVP-2 — Fiscal, contábil e financeiro
> **Fatia:** F85
> **Issue:** [#117](https://github.com/RodReis/rrb-contaia/issues/117)
> **Estado:** aprovada pelo PI em 12/10/2026
> **Tamanho:** Grande
> **PRD:** §§3, 5.3, 7.2, 12, 14, 15 e 16

## 1. Resultado observável

Conectar cada empresa do escritório ao Open Finance por meio de um agregador regulado, começando por contas correntes do Sicoob. A conexão importa contas, saldos e histórico de transações/extratos, recebe atualizações por webhooks e executa reconciliação periódica para recuperar eventos não recebidos. O agregador concreto e a cobertura do Sicoob devem ser confirmados antes da implementação.

Cada conexão e seus dados pertencem a uma empresa. O escritório pode consultar uma empresa autorizada ou consolidar apenas as empresas da carteira que o usuário tem permissão para acessar. Saldos normalizados alimentam a F84; contas e transações seguem o contrato bancário normalizado reutilizado pela F67.

A capacidade é de leitura. Não movimenta dinheiro nem altera contas a pagar/receber, lançamentos contábeis ou transações na instituição financeira.

## 2. Conexão, consentimento e ciclo de vida

O papel gestor_financeiro ou admin_escritorio pode iniciar o fluxo de conexão para uma empresa da sua carteira. A confirmação do compartilhamento acontece no canal bancário e exige ação do titular da conta ou de representante autorizado. O ContaIA acompanha os identificadores e estados retornados pelo agregador, sem receber nem armazenar credenciais bancárias do titular.

A conexão registra empresa, instituição, agregador, contas autorizadas, escopos concedidos, datas de início e validade, última atualização, cobertura e estado do consentimento. A validade, renovação e transições seguem as informações oficiais do agregador e da instituição, sem prazo fixo inventado pelo ContaIA.

Consentimento pendente não inicia coleta. Consentimento expirado ou revogado interrompe novas coletas. Revogação também é propagada ao agregador quando iniciada no ContaIA; revogações originadas no banco ou agregador são refletidas após webhook ou reconciliação. O histórico já importado permanece disponível para consulta financeira autorizada, sem novas atualizações.

Falhas temporárias do provedor preservam a última revisão válida, exibida com seu instante de atualização e estado de desatualização. Não se apresenta saldo antigo como atualizado.

## 3. Dados bancários e atualização

A F85 publica contas correntes, snapshots de saldo com moeda e data/hora de referência, e transações bancárias no contrato normalizado da F67 (BankAccountSnapshot e BankTransaction). A janela histórica depende da cobertura autorizada e do período oferecido pela instituição e pelo agregador; a interface mostra o período e a cobertura efetivamente importados.

Webhooks autenticados e validados iniciam a atualização dos dados correspondentes. O processamento é idempotente: reentrega de evento ou transação não duplica registros. Uma reconciliação periódica compara o estado conhecido com o estado disponibilizado pelo agregador e recupera eventos ausentes. Frequência, limites e estratégia de retomada são configurados conforme o contrato do agregador escolhido.

Cada coleta preserva a referência da origem e da revisão; atualização não apaga o histórico previamente publicado. Cobertura parcial, conta sem saldo, conta indisponível, histórico limitado ou falha de coleta são estados explícitos. Conteúdo externo é validado antes de entrar no contrato normalizado.

## 4. Visões, autorização e invariantes

A tela permite iniciar ou acompanhar conexões por empresa, consultar instituição e contas vinculadas, estado do consentimento, saldos, cobertura histórica e instante da última atualização. O consolidado do escritório soma somente contas de empresas autorizadas e não duplica uma conta vinculada.

Aplicam-se isolamento por tenant, carteira e empresa e os papéis financeiros da docs/CONVENTION.md. Uma conexão não pode ser atribuída a empresa diferente daquela autorizada no fluxo bancário. Filtros, agregados, detalhes e exportações respeitam o mesmo escopo de acesso.

- A fonte bancária e o agregador são autoridades para consentimento, contas, saldos, transações, cobertura e atualização informados.
- Eventos externos são validados; repetição não duplica registros e falhas não apagam a última revisão válida.
- Saldos usam valores monetários exatos e moeda explícita; não há conversão cambial nesta fatia.
- Dados bancários não criam, baixam, estornam ou alteram títulos F68 nem partidas contábeis.
- Revogação ou expiração impede novas coletas e preserva o histórico importado sob as permissões vigentes.
- Erros seguem códigos estáveis e application/problem+json definidos em docs/ARCHITECTURE.md e docs/CONVENTION.md.

## 5. Contrato de UI

Usar docs/telas/contaia_gest_o_financeira_integrada_concilia_o_open_finance_rf_04/ como referência de conteúdo e hierarquia da área financeira. A tela da F85 apresenta seleção de empresa, início e estado da conexão, instituição, contas autorizadas, situação do consentimento, saldos, cobertura, período histórico e última atualização; permite revisar falhas e retomar quando a fonte voltar. O protótipo não prevalece sobre docs/DESIGN-SYSTEM.md, docs/design-system/ e docs/FRONTEND.md.

Cobrir carregamento, conexão pendente, ativa, expirada, revogada, sem contas, cobertura parcial, dados desatualizados, erro recuperável e acesso negado. Implementar temas CLARO e ESCURO e provar 375/768/1280/1536 px, navegação por teclado, foco, contraste, zoom, comparação com o protótipo e acabamento conforme docs/FRONTEND.md §20.1. Aplicar frontend-design e o passe final de impeccable; incluir smoke ao vivo com Playwright.

## 6. Critérios de aceite

1. Usuário autorizado inicia conexão somente para empresa da sua carteira; a coleta só começa após confirmação do titular/representante autorizado no canal bancário.
2. Conexões, contas, saldos e transações permanecem isolados por tenant e empresa; consolidado equivale à soma das empresas autorizadas e não duplica contas.
3. Expiração ou revogação interrompe novas coletas; revogação iniciada no produto é propagada; histórico importado continua consultável segundo as permissões vigentes.
4. Contas correntes, saldos com referência, transações, período histórico e cobertura são apresentados conforme dados autorizados e contrato do agregador.
5. Webhook duplicado ou reentregue não duplica dados; evento ausente é recuperável pela reconciliação periódica; indisponibilidade preserva a última revisão e identifica sua idade.
6. Conteúdo inválido, instituição sem cobertura, saldo ausente ou histórico limitado não é apresentado como cobertura completa.
7. Saldos normalizados ficam disponíveis à F84 e contas/transações seguem o contrato bancário da F67, sem mutação F68, conciliação ou efeito financeiro.
8. Cobrir regras, banco, tela e E2E aplicáveis, permissões, isolamento, falhas e retomada, ambos os temas, responsividade e acessibilidade, com evidência rastreável por F85/#117 conforme docs/TESTING.md.

## 7. Fora de escopo e destinos

| Fora desta fatia | Destino nominal e gatilho |
|---|---|
| Integração com instituições além do Sicoob | Nova fatia do MVP-2, com instituição, cobertura do agregador e contrato aprovados pelo PI. |
| ITP, iniciação ou execução de pagamentos, Pix e cobrança | Fatias próprias do MVP-2, com parceiro e autorização aprovados. |
| Conciliação bancária, baixa automática e contabilização | Fatias próprias do MVP-2; F85 somente publica dados bancários normalizados. |
| Seleção comercial do agregador | Pré-requisito técnico antes da implementação; confirmar cobertura Sicoob, consentimento, dados, webhooks e reconciliação. |
| Produção e conexão de contas reais em ambiente produtivo | Etapa própria posterior ao MVP-4, conforme gate de infraestrutura aprovado. |

## 8. Decisões do PI e gate documental

PI aprovou em 12/10/2026: F85/SPEC-085 usa agregador regulado, começa pelo Sicoob e cobre contas correntes, saldos e histórico de transações/extratos, com webhooks e reconciliação periódica; conexão e consentimento são por empresa; gestor_financeiro e admin_escritorio iniciam o fluxo, e titular ou representante autorizado confirma no banco; validade e renovação seguem provedor/instituição; revogação interrompe novas coletas e preserva histórico importado para consulta autorizada. O agregador concreto e sua cobertura Sicoob serão confirmados antes da implementação. Questões de produto abertas: **nenhuma**.