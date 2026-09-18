# SPEC-013 / F13 — Importação do plano de contas por CSV

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§4.2, 15 e 16
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande — upload, mapeamento, validação hierárquica, staging assíncrono, aplicação transacional, idempotência, relatório, histórico, pendência e interface formam uma entrega vertical única; separar a confirmação da validação deixaria uma importação sem resultado utilizável
>
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #15

## 1. Objetivo

Permitir que o escritório importe e reimporte por CSV o plano de contas de uma empresa, usando o modelo do ContaIA ou mapeando colunas de um arquivo legado, sem perder as linhas válidas quando outras forem rejeitadas.

Sucesso significa o usuário conseguir enviar, mapear, validar, revisar e confirmar o arquivo, ver quais contas foram incluídas ou atualizadas, entender cada rejeição, baixar o relatório e consultar o histórico sem duplicar contas nem atravessar tenant, empresa ou carteira.

## 2. Fronteira da fatia

Esta fatia entrega:

- modelo CSV do ContaIA para download;
- upload de CSV no onboarding e na aba `Plano de contas` da empresa;
- mapeamento livre de colunas legadas para o contrato do ContaIA;
- validação assíncrona do arquivo inteiro em staging;
- prévia antes de qualquer alteração do plano vigente;
- aceitação parcial com inclusão e atualização das linhas válidas;
- confirmação humana explícita e aplicação transacional;
- cancelamento da prévia sem alteração do plano;
- relatório detalhado em tela e CSV;
- histórico por empresa;
- pendência quando a empresa permanece sem nenhuma conta válida;
- notificação individual de conclusão para quem iniciou;
- permissões por funcionalidade e ação integradas às F7, F8 e F9.

Não entrega planilhas XLSX/ODS, empregados, centros de custo, edição manual completa do plano, vetorização, RAG ou classificação automática.

## 3. Comportamento esperado

### 3.1 Pontos de acesso

A importação aparece:

1. como etapa do onboarding da empresa;
2. na aba `Plano de contas` da empresa, para consulta, reimportação e histórico.

Os dois pontos usam o mesmo fluxo, regras e autorização. A ausência de plano válido não interrompe as demais etapas do onboarding, mas mantém uma pendência visível até existir ao menos uma conta válida.

### 3.2 Arquivo aceito

- formato: CSV;
- tamanho máximo: 10 MB;
- quantidade máxima: 10.000 linhas de dados;
- o arquivo pode seguir o modelo do ContaIA ou ter colunas mapeadas pelo usuário;
- arquivo vazio, acima do limite, sem cabeçalho utilizável ou que não possa ser interpretado é rejeitado antes do staging;
- o modelo publicado e o mapeamento livre convergem para o mesmo contrato interno e para as mesmas validações.

Codificação, delimitador e detalhes de parsing são responsabilidade técnica do Code, desde que o modelo oficial funcione e arquivos CSV brasileiros usuais tenham diagnóstico determinístico, sem interpretação silenciosa ambígua.

### 3.3 Campos obrigatórios por conta

| Campo | Regra |
|---|---|
| Código | obrigatório, não vazio e único dentro da empresa |
| Nome | obrigatório e não vazio |
| Tipo | `analítica` ou `sintética` |
| Natureza | `devedora` ou `credora` |
| Conta-pai | obrigatória, exceto para conta raiz |

O mapeamento precisa associar todas as colunas obrigatórias antes de iniciar a validação. Uma coluna de origem não pode alimentar dois campos de destino incompatíveis.

### 3.4 Validação integral e aceitação parcial

O worker valida o arquivo inteiro antes de formar a prévia. A ordem física das linhas não define a hierarquia: uma conta-pai válida pode aparecer depois da filha.

Uma linha é rejeitada quando ocorrer ao menos uma destas condições:

- campo obrigatório ausente ou valor fora do domínio;
- código repetido no mesmo arquivo;
- conta-pai inexistente tanto no plano vigente quanto entre as linhas válidas do lote;
- ciclo hierárquico;
- conta filha cujo pai foi rejeitado;
- conflito estrutural com o plano vigente;
- tentativa de transformar em analítica uma conta que possui filhas;
- código correspondente a conta arquivada;
- qualquer outra violação documentada do contrato da conta.

Quando um código aparece mais de uma vez no arquivo, todas as ocorrências daquele código são rejeitadas. Não existe regra silenciosa de primeira ou última linha vencedora.

Erros de linha não interrompem a validação das demais. Cada rejeição informa linha, código quando disponível, campo, código de erro estável e mensagem acionável.

### 3.5 Prévia e confirmação

Depois da validação, a tela apresenta:

- arquivo e instante da tentativa;
- mapeamento utilizado;
- totais de linhas lidas, novas, atualizadas e rejeitadas;
- amostra paginada das rejeições;
- acesso ao relatório completo;
- ação `Confirmar importação`;
- ação `Cancelar importação`.

Nenhuma conta é criada ou alterada antes da confirmação. A tela não oferece correção inline nem sugestão automática; o usuário corrige o CSV de origem e envia uma nova tentativa.

### 3.6 Aplicação ao plano vigente

Na confirmação:

- o código é a chave natural da conta dentro da empresa;
- código inexistente inclui uma conta ativa;
- código ativo existente atualiza nome, tipo, natureza e conta-pai;
- contas ausentes do CSV permanecem inalteradas;
- conta arquivada não é atualizada nem reativada; a linha orienta reativação separada;
- somente as linhas válidas são aplicadas;
- todas as linhas aceitas são aplicadas numa única transação;
- falha técnica reverte a aplicação inteira, sem plano parcialmente gravado;
- o resultado diferencia contas incluídas, atualizadas e rejeitadas.

Se o plano for alterado depois da formação da prévia, a confirmação detecta conflito de versão e exige nova validação. O sistema não aplica prévia obsoleta.

### 3.7 Idempotência

A identidade da tentativa considera, no mínimo:

- tenant;
- empresa;
- hash do arquivo;
- mapeamento confirmado.

Reenviar o mesmo conteúdo com o mesmo mapeamento reutiliza o resultado terminal existente e não duplica conta, tentativa aplicada nem notificação. O mesmo arquivo com mapeamento diferente é uma nova tentativa vinculada ao mesmo arquivo de origem.

Após confirmação, a atualização por código continua idempotente: repetir o lote não cria outra conta com a mesma chave natural.

### 3.8 Cancelamento

Uma prévia em `AGUARDANDO_CONFIRMACAO` pode ser cancelada por usuário autorizado. O cancelamento:

- não altera o plano;
- não apaga arquivo, relatório ou eventos;
- registra usuário, instante e correlação;
- mantém a tentativa disponível no histórico como `CANCELADA`.

Tentativa já em aplicação ou terminal não pode ser cancelada retroativamente.

### 3.9 Histórico e relatório

O histórico mostra 15 tentativas por página, da mais recente para a mais antiga. Cada tentativa registra:

- tenant e empresa;
- nome, tamanho e hash do arquivo;
- mapeamento utilizado;
- usuário iniciador e, quando diferente, confirmador ou cancelador;
- início, término e estado;
- totais de lidas, novas, atualizadas e rejeitadas;
- código e motivo por linha rejeitada;
- `correlationId`;
- indicação de resultado novo ou reutilizado por idempotência.

O resumo aparece na tela e o relatório completo pode ser baixado em CSV. O arquivo original e o relatório permanecem associados à tentativa no armazenamento local; a política produtiva de retenção é decidida no gate posterior ao MVP-4.

### 3.10 Pendência e notificação

- empresa sem nenhuma conta válida possui pendência de plano de contas incompleto na Central de Pendências da F5;
- a pendência pode ser aberta a partir da empresa e leva à aba `Plano de contas`;
- a pendência é resolvida quando passa a existir ao menos uma conta válida;
- o processamento concluído notifica somente o usuário que iniciou, pelo sino e histórico da F6;
- a notificação informa estado e totais e abre a tentativa correspondente;
- reuso idempotente não cria nova notificação;
- falha técnica produz estado acionável com `correlationId`, sem ocultar a tentativa.

### 3.11 Estados da importação

```text
RECEBIDA
  └─▶ VALIDANDO
       ├─▶ AGUARDANDO_CONFIRMACAO
       │    ├─▶ APLICANDO ──▶ CONCLUIDA | CONCLUIDA_COM_REJEICOES | FALHA
       │    └─▶ CANCELADA
       ├─▶ REJEITADA
       └─▶ FALHA
```

- `CONCLUIDA`: lote aplicado sem linha rejeitada;
- `CONCLUIDA_COM_REJEICOES`: linhas válidas aplicadas e rejeições preservadas no relatório;
- `REJEITADA`: nenhuma linha pode ser aplicada ou o arquivo não atende ao contrato;
- `FALHA`: erro técnico, distinto de erro de conteúdo.

Estados terminais não são reabertos nem apagados. Nova correção gera nova tentativa.

### 3.12 Autorização

O catálogo de permissões recebe, em `Empresas → Plano de contas`:

| Ação | Efeito |
|---|---|
| `Consultar` | ver plano, tentativas e resultados permitidos |
| `Importar` | enviar arquivo e confirmar mapeamento |
| `Confirmar importação` | aplicar a prévia validada ou cancelá-la |
| `Baixar relatório` | baixar modelo, arquivo permitido e relatório CSV |

Padrão inicial:

- `admin_escritorio`: todas as ações, dentro do tenant;
- `contador`: todas as ações, somente para empresa da carteira ativa;
- `auxiliar`: consultar e baixar relatório, somente para empresa da carteira ativa;
- `auditor_readonly`: consultar e baixar relatório, somente leitura e dentro da alçada disponível;
- demais papéis padrão: sem acesso nesta fatia.

Papéis personalizados podem receber somente ações existentes no catálogo. A API revalida usuário ativo, tenant, empresa, carteira e permissão em cada comando; esconder botão não autoriza nem substitui essa decisão.

## 4. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | plano, tentativas, staging, relatórios, pendências e eventos possuem `tenant_id` e `empresa_id` obrigatórios, indexados e sob RLS |
| `I-2` | consulta ou comando sem contexto de tenant não retorna arquivo, plano, prévia, relatório nem histórico |
| `I-6` | eventos da importação e histórico de aplicação, cancelamento, falha e reuso são append-only |
| `I-7` | conta contábil e tentativa não são apagadas; conta é arquivada por fluxo próprio e tentativas terminais permanecem no histórico |
| `I-9` | reenvio e confirmação repetidos não duplicam contas, aplicação nem notificação |

## 5. Contrato de interface

### 5.1 Referência e correções de escopo

Referência concreta:

- `docs/telas/contaia_onboarding_de_clientes_importa_o_de_legados_rf_01/screen.png`;
- `docs/telas/contaia_onboarding_de_clientes_importa_o_de_legados_rf_01/code.html`;
- navegação integrada em `docs/telas/prototipo/`.

A implementação preserva a direção de conteúdo, hierarquia e fluxo, mas corrige os elementos do protótipo que antecipam outras capacidades:

- título passa a tratar somente `Plano de contas`;
- remove centro de custo;
- remove correção inline;
- remove solução ou sugestão de IA;
- remove vetorização, RAG e alegação de classificador pronto;
- remove métricas ou garantias fictícias;
- não acopla captura DF-e, Ciência da Emissão ou ativação de etapa posterior.

### 5.2 Composição da tela

O núcleo visual contém:

1. identificação da empresa;
2. instrução e download do modelo;
3. área de seleção/upload;
4. mapeamento de colunas;
5. progresso da validação;
6. resumo da prévia;
7. tabela paginada de rejeições;
8. confirmação ou cancelamento;
9. resultado terminal;
10. histórico de importações.

No onboarding, o núcleo aparece como etapa do wizard e permite continuar com pendência quando não houver conta válida. Na manutenção, aparece na aba `Plano de contas` sem duplicar regra ou contrato.

### 5.3 Estados obrigatórios

- carregando com skeleton;
- sem plano e sem tentativa;
- arquivo selecionado;
- arquivo rejeitado antes do envio;
- mapeamento incompleto ou inválido;
- validação em andamento;
- prévia sem rejeições;
- prévia com aceitação parcial;
- zero linhas válidas;
- confirmação em andamento;
- concluída;
- concluída com rejeições;
- cancelada;
- falha técnica com nova tentativa possível;
- conflito por plano alterado;
- histórico vazio;
- histórico/relatório indisponível;
- permissão insuficiente;
- empresa fora da carteira.

Toast não substitui o estado da tela. `info` anuncia processamento em segundo plano; conclusão parcial usa `warning` com link para o relatório; falha usa mensagem persistente e `correlationId` copiável, conforme `FRONTEND.md`.

### 5.4 Responsividade e acessibilidade

- temas CLARO e ESCURO completos;
- viewports obrigatórios de 768, 1024 e 1440 px;
- ordem de foco previsível e foco sempre visível;
- upload, mapeamento, tabela, paginação, confirmação e cancelamento operáveis por teclado;
- diálogo de confirmação prende foco, fecha por `Esc` quando ainda for seguro e devolve foco ao acionador;
- progresso e conclusão assíncronos são anunciados sem excesso por tecnologia assistiva;
- estado nunca depende somente de cor ou ícone;
- tabela mantém cabeçalhos e relação linha/erro compreensíveis;
- redução de movimento é respeitada.

### 5.5 Prova visual obrigatória

A implementação usa `frontend-design` antes e durante a interface e `impeccable` no passe final. A PR prova comparação com a referência, correções de escopo, CLARO/ESCURO, 768/1024/1440, estados, teclado, foco e acessibilidade conforme `FRONTEND.md` §20.1.

## 6. Arquitetura e contratos internos

### 6.1 Fluxo

```text
Web
  └─▶ API: autoriza e registra RECEBIDA
       ├─▶ object storage local: arquivo original
       └─▶ BullMQ: validação
            └─▶ worker: parse + normalização + validação integral
                 ├─▶ staging isolado por tenant/empresa
                 └─▶ prévia + relatório

Web
  └─▶ API: confirma versão da prévia
       └─▶ caso de uso transacional
            ├─▶ inclui/atualiza contas válidas
            ├─▶ grava eventos append-only
            ├─▶ atualiza pendência
            └─▶ publica notificação individual
```

O caso de uso controla a transação. Controller valida entrada e delega. DTO não é entidade de persistência. Worker não escolhe autorização de produto nem aplica conta fora do caso de uso transacional.

### 6.2 Contratos mínimos

Devem existir contratos tipados para:

- criar tentativa e obter destino de upload;
- registrar ou concluir upload;
- salvar mapeamento;
- consultar estado e prévia;
- confirmar importação com versão da prévia;
- cancelar prévia;
- listar plano vigente;
- listar histórico;
- baixar modelo e relatório.

Erro HTTP segue `application/problem+json`, com `type`, `title`, `status`, `code` e `correlationId`. Erro de conteúdo pertence ao relatório da linha e não vira HTTP 500.

### 6.3 Persistência e concorrência

Persistem, no mínimo:

- conta contábil com chave natural por empresa;
- tentativa e estado corrente;
- arquivo de origem e seu hash;
- mapeamento versionado;
- linhas normalizadas de staging ou representação equivalente auditável;
- prévia e totais;
- rejeições por linha;
- eventos append-only;
- relação idempotente entre tentativa, conteúdo e mapeamento.

O plano possui versão otimista. A confirmação envia a versão validada; divergência retorna HTTP 409 e não aplica nenhuma linha.

### 6.4 Fila e recuperação

- mensagem carrega `tenant_id`, `empresa_id`, identificador da tentativa e `correlationId`;
- worker pode repetir validação sem duplicar tentativa ou staging terminal;
- retry usa backoff e teto de tentativas;
- esgotamento termina em `FALHA` acionável, preservando diagnóstico;
- retomada após queda não reaplica confirmação já concluída;
- aplicação do plano não acontece parcialmente no worker.

## 7. Erros observáveis

| Situação | Resultado esperado |
|---|---|
| Arquivo acima de 10 MB ou 10.000 linhas | rejeição antes da prévia, com limite explícito |
| Formato não CSV ou conteúdo ilegível | rejeição do arquivo, sem staging aplicável |
| Mapeamento incompleto | confirmação do mapeamento bloqueada, campos ausentes destacados |
| Código duplicado no CSV | todas as ocorrências daquele código rejeitadas |
| Pai ausente ou rejeitado | filha rejeitada com vínculo causal |
| Ciclo hierárquico | todas as linhas que formam o ciclo rejeitadas |
| Conta arquivada | linha rejeitada e orientação para reativação separada |
| Nenhuma linha válida | estado `REJEITADA`; onboarding continua com pendência |
| Alteração concorrente do plano | HTTP 409; exige nova validação |
| Falha do worker | tentativa `FALHA`, retry controlado e correlação visível |
| Falha durante aplicação | transação revertida integralmente |
| Reenvio idêntico | resultado terminal reutilizado, sem duplicação nem nova notificação |
| Usuário sem permissão ou fora da carteira | negação sem revelar plano, arquivo ou relatório |
| Relatório temporariamente indisponível | histórico permanece visível e oferece nova tentativa de download |

## 8. Stack, comandos e estrutura

### 8.1 Comandos obrigatórios

```bash
pnpm lint
pnpm typecheck
pnpm test:regras
pnpm test:banco
pnpm test:tela
pnpm test:e2e
pnpm build
pnpm docker:up
pnpm docker:ps
```

### 8.2 Fronteiras esperadas

```text
apps/web/                wizard, aba, mapeamento, prévia, relatório e histórico
apps/api/                autorização, consultas e confirmação transacional
apps/workers/            parsing e validação assíncrona
packages/shared/         contratos, schemas e códigos de erro
packages/domain/         regras puras de conta, hierarquia e transições
infra/db/                tabelas, índices, RLS, anti-drift e append-only
infra/docker/            fila e object storage local
tests/banco/             isolamento, transação, concorrência e auditoria
tests/e2e/               jornadas e contrafactuais observáveis
```

A estrutura interna exata é decisão do Code, desde que preserve essas fronteiras e os contratos da fatia.

## 9. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | campos, domínios, duplicidade, hierarquia, ciclos, pai rejeitado, conta arquivada e conflito estrutural |
| Reimportação | conta nova inclui; código existente atualiza; ausente permanece; arquivada não reativa |
| Idempotência | mesmo hash + mapeamento reutiliza resultado; mapeamento diferente cria nova tentativa; confirmação repetida não reaplica |
| Banco | RLS por tenant/empresa, chave natural, transação atômica, versão otimista e trilha append-only |
| Fila | retry, retomada após queda, teto de tentativas e ausência de duplicação |
| Permissões | admin e contador importam; auxiliar/auditor consultam; papel personalizado; fora da carteira e outro tenant negados |
| Pendência | zero válidas mantém pendência; primeira conta válida resolve; onboarding não bloqueia |
| Notificação | somente iniciador recebe conclusão; reuso idempotente não duplica |
| Tela | referência corrigida, estados, relatório, histórico, CLARO/ESCURO, 768/1024/1440, teclado e foco |
| E2E | upload → mapeamento → validação parcial → confirmação → plano atualizado → relatório → histórico |
| Contrafactual | arquivo grande, cabeçalho inválido, zero válidas, ciclo, pai rejeitado, conta arquivada, conflito concorrente e falha do worker |

## 10. Critérios de aceite verificáveis

- [ ] Modelo ContaIA pode ser baixado e importado com sucesso.
- [ ] CSV legado pode ter colunas mapeadas para os cinco campos obrigatórios.
- [ ] Arquivo acima de 10 MB ou 10.000 linhas é rejeitado com motivo verificável.
- [ ] Validação integral aceita linhas válidas sem ser interrompida pelas inválidas.
- [ ] Duplicidades, ciclos, pais ausentes/rejeitados, conflitos estruturais e contas arquivadas aparecem no relatório com código estável.
- [ ] Nenhuma conta muda antes da confirmação humana.
- [ ] Confirmação inclui novas e atualiza existentes pelo código, sem arquivar ausentes.
- [ ] Aplicação das linhas válidas é transacional e falha não deixa plano parcial.
- [ ] Alteração concorrente entre prévia e confirmação retorna 409 e exige revalidação.
- [ ] Reenvio idêntico e confirmação repetida não duplicam conta, aplicação ou notificação.
- [ ] Cancelamento preserva tentativa, arquivo, relatório e auditoria sem alterar o plano.
- [ ] Resultado aparece em tela, pode ser baixado em CSV e permanece no histórico de 15 itens por página.
- [ ] Zero linhas válidas não bloqueia o onboarding e mantém pendência até existir conta válida.
- [ ] Somente o iniciador recebe a notificação de conclusão.
- [ ] API nega outro tenant, empresa fora da carteira e ação sem permissão sem revelar dados.
- [ ] RLS, anti-drift, chave natural, append-only e versão otimista passam nos testes de banco.
- [ ] Tela remove centro de custo, correção inline, IA, vetorização e promessas não entregues do protótipo.
- [ ] Prova visual cobre referência, CLARO/ESCURO, 768/1024/1440, teclado, foco, estados e passe `impeccable`.
- [ ] Jornada E2E completa roda no Docker local e preserva `correlationId` em fila, erro e histórico.

## 11. Limites e proibições

- não aceitar formato diferente de CSV nesta fatia;
- não importar empregado ou centro de custo;
- não corrigir linha na tela;
- não usar IA para sugerir conta, pai, tipo ou natureza;
- não inferir silenciosamente primeira ou última duplicata;
- não substituir ou arquivar o plano inteiro por ausência no arquivo;
- não reativar conta arquivada pelo CSV;
- não aplicar prévia obsoleta;
- não permitir confirmação sem ação explícita;
- não confiar em autorização somente no frontend;
- não misturar arquivo, staging, plano, relatório ou histórico entre tenants ou empresas;
- não apagar tentativa, relatório ou evento terminal;
- não transformar erro de linha em falha total do arquivo;
- não afirmar infraestrutura, retenção ou escala produtiva.

## 12. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Importação de empregados por CSV | MVP-1 · F14 / SPEC-014 |
| Importação XLSX/ODS de plano de contas e empregados | MVP-1 · F15 / SPEC-015 |
| Centros de custo operacionais | MVP-2 · capacidade contábil de plano de contas e centros de custo |
| CRUD manual completo do plano e regras de lançamentos | MVP-2 · capacidade contábil |
| Embeddings, RAG, classificação automática e sugestões | MVP-2 · fatia do Agente Classificador |
| Uso do plano na escrituração, partidas dobradas, ECD e SPED | MVP-2 · capacidades contábeis e fiscais |
| Retenção, escala, object storage e operação produtivos | gate de Produção após o MVP-4 |

## 13. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Reimportação | atualizar por código e incluir novas; manter ausentes |
| Entrada | modelo ContaIA e mapeamento livre de colunas |
| Campos | código, nome, tipo, natureza e conta-pai; pai dispensado na raiz |
| Operadores | `admin_escritorio` e `contador` confirmam; auxiliar e auditor consultam/baixam |
| Aplicação | prévia e confirmação humana explícita |
| Correção | corrigir CSV de origem; sem correção inline |
| Relatório | tela e CSV, mantidos no histórico |
| Limite | 10 mil linhas e 10 MB |
| Duplicidade no arquivo | rejeitar todas as ocorrências do código |
| Conta arquivada | exigir reativação separada |
| Acesso | onboarding e aba da empresa |
| Onboarding sem conta válida | não bloquear; manter pendência |
| Notificação | somente quem iniciou |
| Processamento | assíncrono em staging |
| Planilhas XLSX/ODS | F15 / SPEC-015 no MVP-1 |
| Cancelamento | permitido antes da aplicação, com histórico preservado |

**Questões abertas:** nenhuma.

## 14. Gate dos oito itens obrigatórios

| Item | Evidência nesta SPEC |
|---|---|
| Fatia, MVP e Slice | cabeçalho e §§1–2 |
| Comportamento observável | §3 |
| Aceite verificável | §§9–10 |
| Invariantes tocados | §4 |
| Fora de escopo | §§11–12 |
| Dúvidas resolvidas | §13; nenhuma aberta |
| Destino do complemento | §12 |
| Contrato de UI | §5, com referências, estados, temas, viewports e provas |

## 15. Aprovação

Fronteira, regras, interface, autorização, arquitetura, provas e destinos aprovados pelo PI em 18/09/2026. A implementação deve seguir esta SPEC sem criar regra de produto adicional; lacuna material volta ao PI.
