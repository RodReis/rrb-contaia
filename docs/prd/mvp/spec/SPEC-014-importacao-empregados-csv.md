# SPEC-014 / F14 — Importação de empregados por CSV

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§4.2, 8.1, 15 e 16
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande — upload, mapeamento, validação, staging assíncrono, prévia, aplicação transacional, relatório, histórico, pendência e interface formam uma entrega vertical única; a fatia reutiliza o pipeline da F13 e não antecipa o domínio funcional de DP
>
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #16

## 1. Objetivo

Permitir que o escritório importe e reimporte por CSV a base cadastral inicial de empregados de uma empresa, usando o modelo do ContaIA ou mapeando colunas de um arquivo legado, sem perder as linhas válidas quando outras forem rejeitadas.

Sucesso significa o usuário autorizado conseguir enviar, mapear, validar, revisar e confirmar o arquivo, consultar os empregados importados, entender cada rejeição, baixar o relatório e consultar o histórico sem duplicar vínculos nem atravessar tenant, empresa ou carteira.

## 2. Fronteira da fatia

Esta fatia entrega:

- modelo CSV do ContaIA para download;
- upload no onboarding e na aba `Empregados` da empresa;
- mapeamento livre de colunas legadas;
- validação estrutural e de coerência em staging assíncrono;
- prévia antes de qualquer alteração da base vigente;
- aceitação parcial das linhas válidas;
- inclusão e atualização pela chave natural CPF + matrícula dentro da empresa;
- confirmação humana explícita e aplicação transacional;
- cancelamento da prévia sem alteração da base;
- consulta da base importada, sem edição cadastral completa;
- relatório detalhado em tela e CSV;
- histórico por empresa;
- pendência quando não há empregado confirmado;
- notificações ao iniciador e aos administradores autorizados;
- permissões integradas às F7, F8 e F9.

Não entrega cadastro trabalhista completo, cargo, salário, vínculo detalhado, dependentes, folha, validações legais, eSocial, edição manual, arquivamento ou reativação de empregado.

## 3. Comportamento esperado

### 3.1 Pontos de acesso

A importação aparece:

1. como etapa própria do onboarding da empresa;
2. na aba `Empregados` da empresa, para consulta da base, reimportação, resultados e histórico.

Os dois pontos usam o mesmo fluxo, regras e autorização. A ausência de empregado confirmado não interrompe as demais etapas do onboarding, mas cria ou mantém uma pendência visível até existir ao menos um empregado confirmado.

### 3.2 Arquivo aceito

- formato: CSV;
- tamanho máximo: 10 MB;
- quantidade máxima: 10.000 linhas de dados;
- o arquivo pode seguir o modelo do ContaIA ou ter colunas mapeadas pelo usuário;
- arquivo vazio, acima do limite, sem cabeçalho utilizável ou ilegível é rejeitado antes do staging;
- modelo oficial e mapeamento livre convergem para o mesmo contrato e as mesmas validações.

Codificação, delimitador e parsing são decisões técnicas do Code, desde que o modelo oficial funcione e arquivos CSV brasileiros usuais tenham diagnóstico determinístico, sem interpretação silenciosa ambígua.

### 3.3 Campos obrigatórios por empregado

| Campo | Regra |
|---|---|
| CPF | obrigatório, com 11 dígitos e dígitos verificadores válidos |
| Nome completo | obrigatório e não vazio |
| Matrícula | obrigatória e não vazia |
| Data de nascimento | obrigatória, data civil válida |
| Data de admissão | obrigatória, data civil válida e posterior à data de nascimento |

O mapeamento precisa associar os cinco campos antes da validação. Uma coluna de origem não pode alimentar dois campos de destino incompatíveis. CPF e matrícula são normalizados para comparação, sem alterar o valor exibido além das máscaras definidas em `FRONTEND.md`.

### 3.4 Validação integral e aceitação parcial

O worker valida o arquivo inteiro antes de formar a prévia. Uma linha é rejeitada quando ocorrer ao menos uma destas condições:

- campo obrigatório ausente ou inválido;
- CPF com formato ou dígito verificador inválido;
- data inválida;
- nascimento igual ou posterior à admissão;
- CPF + matrícula repetidos no mesmo arquivo;
- CPF + matrícula correspondentes a empregado arquivado;
- qualquer outra violação documentada do contrato cadastral desta fatia.

Quando a mesma chave CPF + matrícula aparece mais de uma vez no arquivo, todas as ocorrências são rejeitadas. Não existe primeira ou última linha vencedora.

Erros de linha não interrompem as demais. Cada rejeição informa linha, CPF e matrícula quando disponíveis, campo, código de erro estável e mensagem acionável.

A F14 não valida prazo de S-2200, piso salarial, jornada, FGTS, dependentes, situação perante a Receita ou qualquer regra legal/eSocial. Essas validações pertencem ao domínio de DP do MVP-3.

### 3.5 Prévia e confirmação

Depois da validação, a tela apresenta:

- arquivo e instante da tentativa;
- mapeamento utilizado;
- totais de linhas lidas, novas, atualizadas e rejeitadas;
- amostra paginada das rejeições;
- acesso ao relatório completo;
- ação `Confirmar importação`;
- ação `Cancelar importação`.

Nenhum empregado é criado ou alterado antes da confirmação. A tela não oferece correção inline; o usuário corrige o CSV e envia nova tentativa.

### 3.6 Aplicação à base vigente

Na confirmação:

- a chave natural é empresa + CPF + matrícula;
- chave inexistente inclui empregado ativo;
- chave ativa existente atualiza nome completo, nascimento e admissão;
- empregados ausentes do CSV permanecem inalterados;
- empregado arquivado não é atualizado nem reativado; a linha orienta reativação no cadastro do MVP-3;
- somente as linhas válidas são aplicadas;
- todas as linhas aceitas são aplicadas numa única transação;
- falha técnica reverte a aplicação inteira;
- o resultado diferencia empregados incluídos, atualizados e rejeitados.

Se a base for alterada após a formação da prévia, a confirmação detecta conflito de versão e exige nova validação. Prévia obsoleta nunca é aplicada.

### 3.7 Idempotência

A identidade da tentativa considera, no mínimo:

- tenant;
- empresa;
- hash do arquivo;
- mapeamento confirmado.

Reenviar o mesmo conteúdo com o mesmo mapeamento reutiliza o resultado terminal e não duplica empregado, aplicação ou notificação. O mesmo arquivo com mapeamento diferente é nova tentativa vinculada ao mesmo arquivo de origem.

Após confirmação, repetir o lote não cria outro empregado com a mesma chave natural.

### 3.8 Cancelamento

Uma prévia em `AGUARDANDO_CONFIRMACAO` pode ser cancelada por usuário autorizado. O cancelamento:

- não altera a base;
- não apaga arquivo, relatório ou eventos;
- registra usuário, instante e correlação;
- mantém a tentativa no histórico como `CANCELADA`.

Tentativa já em aplicação ou terminal não pode ser cancelada retroativamente.

### 3.9 Consulta, histórico e relatório

A aba `Empregados` mostra a base importada em modo de consulta. Edição, arquivamento e reativação permanecem indisponíveis nesta fatia.

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

O resumo aparece na tela e o relatório completo pode ser baixado em CSV. Arquivo original e relatório permanecem associados à tentativa no armazenamento local; retenção produtiva será decidida no gate posterior ao MVP-4.

### 3.10 Pendência e notificações

- empresa sem empregado confirmado possui pendência de importação de empregados na Central de Pendências da F5;
- a pendência leva à aba `Empregados`;
- a pendência é resolvida quando existe ao menos um empregado confirmado;
- conclusão notifica pelo sino e histórico da F6 o iniciador e os `admin_escritorio` com acesso à empresa;
- a notificação informa estado e totais e abre a tentativa correspondente;
- reuso idempotente não cria nova notificação;
- falha técnica produz estado acionável com `correlationId`.

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
- `CONCLUIDA_COM_REJEICOES`: linhas válidas aplicadas e rejeições preservadas;
- `REJEITADA`: nenhuma linha pode ser aplicada ou o arquivo não atende ao contrato;
- `FALHA`: erro técnico, distinto de erro de conteúdo.

Estados terminais não são reabertos nem apagados. Nova correção gera nova tentativa.

### 3.12 Autorização

O catálogo de permissões recebe, em `Empresas → Empregados`:

| Ação | Efeito |
|---|---|
| `Consultar` | ver empregados, tentativas e resultados permitidos |
| `Importar` | enviar arquivo e confirmar mapeamento |
| `Confirmar importação` | aplicar ou cancelar a prévia validada |
| `Baixar relatório` | baixar modelo, arquivo permitido e relatório CSV |

Padrão inicial:

- `admin_escritorio`: todas as ações, dentro do tenant;
- `dp`: todas as ações, somente para empresa da carteira ativa;
- `contador`: consultar e baixar, somente para empresa da carteira ativa;
- `auditor_readonly`: consultar e baixar, somente leitura e dentro da alçada disponível;
- demais papéis padrão: sem acesso nesta fatia.

Papéis personalizados recebem somente ações existentes no catálogo. A API revalida usuário ativo, tenant, empresa, carteira e permissão em cada comando; esconder botão não substitui autorização no servidor.

## 4. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | empregados, tentativas, staging, relatórios, pendências e eventos possuem `tenant_id` e `empresa_id` obrigatórios, indexados e sob RLS |
| `I-2` | consulta ou comando sem contexto de tenant não retorna empregado, arquivo, prévia, relatório ou histórico |
| `I-6` | eventos da importação e histórico de aplicação, cancelamento, falha e reuso são append-only |
| `I-7` | empregado e tentativa não são apagados; arquivamento pertence a fluxo próprio e tentativas terminais permanecem no histórico |
| `I-9` | reenvio e confirmação repetidos não duplicam empregado, aplicação nem notificação |
| `I-11` | nascimento e admissão são datas civis; instantes da trilha são armazenados em UTC e exibidos em `America/Sao_Paulo` |

## 5. Contrato de interface

### 5.1 Referência e correções de escopo

Referência concreta:

- `docs/telas/contaia_onboarding_de_clientes_importa_o_de_legados_rf_01/screen.png`;
- `docs/telas/contaia_onboarding_de_clientes_importa_o_de_legados_rf_01/code.html`;
- navegação integrada em `docs/telas/prototipo/`.

A implementação preserva o wizard, a hierarquia e o fluxo reconhecíveis, mas restringe a F14 à importação cadastral de empregados. Não apresenta cargo, salário, dependentes, folha, eSocial, IA, vetorização, métricas ou garantias não entregues.

### 5.2 Composição da tela

O núcleo visual contém:

1. identificação da empresa;
2. instrução e download do modelo;
3. seleção/upload;
4. mapeamento de colunas;
5. progresso da validação;
6. resumo da prévia;
7. tabela paginada de rejeições;
8. confirmação ou cancelamento;
9. resultado terminal;
10. base importada em consulta;
11. histórico de importações.

No onboarding, aparece como etapa própria do wizard e permite continuar com pendência quando não houver empregado confirmado. Na manutenção, aparece na aba `Empregados` sem duplicar regra.

### 5.3 Estados obrigatórios

- carregando com skeleton;
- sem empregado e sem tentativa;
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
- conflito por base alterada;
- histórico vazio;
- histórico ou relatório indisponível;
- permissão insuficiente;
- empresa fora da carteira;
- conteúdo longo.

Toast não substitui o estado da tela. Conclusão parcial usa `warning` com link para o relatório; falha usa mensagem persistente e `correlationId` copiável.

### 5.4 Responsividade e acessibilidade

- temas CLARO e ESCURO completos;
- viewports obrigatórios de 768, 1024 e 1440 px;
- ordem de foco previsível e foco sempre visível;
- upload, mapeamento, tabela, paginação, confirmação e cancelamento operáveis por teclado;
- diálogo de confirmação prende foco, fecha por `Esc` quando seguro e devolve foco ao acionador;
- progresso e conclusão assíncronos são anunciados sem excesso;
- estado nunca depende somente de cor ou ícone;
- tabela mantém cabeçalhos e relação linha/erro compreensíveis;
- redução de movimento é respeitada.

### 5.5 Prova visual obrigatória

A implementação usa `frontend-design` antes e durante a interface e `impeccable` no passe final. A PR prova comparação com a referência, CLARO/ESCURO, 768/1024/1440, estados, teclado, foco e acessibilidade conforme `FRONTEND.md` §20.1.

## 6. Arquitetura e contratos internos

### 6.1 Fluxo

```text
Web
  └─▶ API: autoriza e registra RECEBIDA
       ├─▶ object storage local: arquivo original
       └─▶ BullMQ: validação
            └─▶ worker: parse + normalização + validação
                 ├─▶ staging isolado por tenant/empresa
                 └─▶ prévia + relatório

Web
  └─▶ API: confirma versão da prévia
       └─▶ caso de uso transacional
            ├─▶ inclui/atualiza empregados válidos
            ├─▶ grava eventos append-only
            ├─▶ atualiza pendência
            └─▶ publica notificações autorizadas
```

O pipeline técnico é compartilhado com a F13, com schema, chave natural e validações próprios de empregado. O caso de uso controla a transação; controller valida e delega; DTO não é entidade de persistência; worker não decide autorização de produto.

### 6.2 Contratos mínimos

Devem existir contratos tipados para:

- criar tentativa e obter destino de upload;
- registrar ou concluir upload;
- salvar mapeamento;
- consultar estado e prévia;
- confirmar com versão da prévia;
- cancelar prévia;
- listar empregados importados;
- listar histórico;
- baixar modelo e relatório.

Erro HTTP segue `application/problem+json`, com `type`, `title`, `status`, `code` e `correlationId`. Erro de conteúdo pertence ao relatório e não vira HTTP 500.

### 6.3 Persistência e concorrência

Persistem, no mínimo:

- empregado com chave natural por empresa;
- tentativa e estado corrente;
- arquivo e hash;
- mapeamento versionado;
- linhas normalizadas de staging ou representação auditável equivalente;
- prévia e totais;
- rejeições por linha;
- eventos append-only;
- relação idempotente entre tentativa, conteúdo e mapeamento.

A base possui versão otimista. A confirmação envia a versão validada; divergência retorna HTTP 409 e não aplica linha.

### 6.4 Fila e recuperação

- mensagem carrega `tenant_id`, `empresa_id`, tentativa e `correlationId`;
- worker pode repetir validação sem duplicar tentativa ou staging terminal;
- retry usa backoff e teto de tentativas;
- esgotamento termina em `FALHA` acionável;
- retomada após queda não reaplica confirmação concluída;
- aplicação não acontece parcialmente no worker.

## 7. Erros observáveis

| Situação | Resultado esperado |
|---|---|
| Arquivo acima de 10 MB ou 10.000 linhas | rejeição antes da prévia, com limite explícito |
| Formato não CSV ou conteúdo ilegível | rejeição do arquivo, sem staging aplicável |
| Mapeamento incompleto | mapeamento bloqueado, campos ausentes destacados |
| CPF inválido | linha rejeitada com campo e motivo |
| CPF + matrícula duplicados | todas as ocorrências da chave rejeitadas |
| Datas incoerentes | linha rejeitada sem executar regra legal de DP |
| Empregado arquivado | linha rejeitada e orientação para reativação no MVP-3 |
| Nenhuma linha válida | estado `REJEITADA`; onboarding continua com pendência |
| Alteração concorrente | HTTP 409; exige nova validação |
| Falha do worker | tentativa `FALHA`, retry controlado e correlação visível |
| Falha durante aplicação | transação revertida integralmente |
| Reenvio idêntico | resultado reutilizado, sem duplicação nem nova notificação |
| Usuário sem permissão ou fora da carteira | negação sem revelar empregado, arquivo ou relatório |
| Relatório indisponível | histórico permanece visível e oferece nova tentativa de download |

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
apps/web/                wizard, aba, mapeamento, prévia, base, relatório e histórico
apps/api/                autorização, consultas e confirmação transacional
apps/workers/            parsing e validação assíncrona
packages/shared/         contratos, schemas e códigos de erro
packages/domain/         normalização, coerência e transições puras
infra/db/                tabelas, índices, RLS, anti-drift e append-only
infra/docker/            fila e object storage local
tests/banco/             isolamento, transação, concorrência e auditoria
tests/e2e/               jornadas e contrafactuais observáveis
```

A estrutura interna exata é decisão do Code, desde que preserve fronteiras e contratos.

## 9. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | campos, CPF, datas, normalização, chave composta, duplicidade e arquivado |
| Reimportação | empregado novo inclui; chave existente atualiza; ausente permanece; arquivado não reativa |
| Idempotência | mesmo hash + mapeamento reutiliza; mapeamento diferente cria nova tentativa; confirmação repetida não reaplica |
| Banco | RLS, chave natural, transação atômica, versão otimista e trilha append-only |
| Fila | retry, retomada, teto de tentativas e ausência de duplicação |
| Permissões | admin e DP operam; contador e auditor consultam; papel personalizado; fora da carteira e outro tenant negados |
| Pendência | zero válidas mantém pendência; primeiro empregado confirmado resolve; onboarding não bloqueia |
| Notificação | iniciador e admins autorizados recebem; reuso idempotente não duplica |
| Tela | referência, estados, base, relatório, histórico, CLARO/ESCURO, 768/1024/1440, teclado e foco |
| E2E | upload → mapeamento → validação parcial → confirmação → base atualizada → relatório → histórico |
| Contrafactual | arquivo grande, CPF inválido, datas incoerentes, duplicidade, zero válidas, arquivado, conflito e falha do worker |

## 10. Critérios de aceite verificáveis

- [ ] Modelo ContaIA pode ser baixado e importado.
- [ ] CSV legado pode mapear os cinco campos obrigatórios.
- [ ] Arquivo acima de 10 MB ou 10.000 linhas é rejeitado com motivo verificável.
- [ ] Validação aceita linhas válidas sem ser interrompida pelas inválidas.
- [ ] CPF, datas, duplicidade e empregado arquivado aparecem no relatório com código estável.
- [ ] Nenhum empregado muda antes da confirmação humana.
- [ ] Confirmação inclui novos ativos e atualiza existentes por CPF + matrícula, sem alterar ausentes.
- [ ] Aplicação é transacional e falha não deixa base parcial.
- [ ] Alteração concorrente retorna 409 e exige revalidação.
- [ ] Reenvio idêntico e confirmação repetida não duplicam empregado, aplicação ou notificação.
- [ ] Cancelamento preserva tentativa, arquivo, relatório e auditoria sem alterar a base.
- [ ] Resultado aparece em tela, pode ser baixado em CSV e permanece no histórico de 15 itens por página.
- [ ] Zero linhas válidas não bloqueia onboarding e mantém pendência.
- [ ] Iniciador e administradores autorizados recebem notificação; demais usuários não recebem.
- [ ] API nega outro tenant, empresa fora da carteira e ação sem permissão sem revelar dados.
- [ ] RLS, anti-drift, chave natural, append-only e versão otimista passam nos testes de banco.
- [ ] A aba permite consulta, mas não edição, arquivamento ou reativação.
- [ ] A tela não antecipa cargo, salário, dependentes, folha, eSocial ou IA.
- [ ] Prova visual cobre referência, CLARO/ESCURO, 768/1024/1440, teclado, foco, estados e passe `impeccable`.
- [ ] Jornada E2E completa roda no Docker local e preserva `correlationId`.

## 11. Limites e proibições

- não aceitar formato diferente de CSV nesta fatia;
- não cadastrar cargo, salário, vínculo detalhado ou dependente;
- não executar folha, validação legal, evento ou transmissão eSocial;
- não corrigir linha na tela;
- não usar IA para completar ou validar empregado;
- não escolher silenciosamente uma duplicata;
- não arquivar empregados ausentes do CSV;
- não reativar empregado arquivado pelo CSV;
- não aplicar prévia obsoleta;
- não permitir confirmação sem ação explícita;
- não confiar em autorização somente no frontend;
- não misturar arquivo, staging, base, relatório ou histórico entre tenants ou empresas;
- não apagar empregado, tentativa, relatório ou evento terminal;
- não transformar erro de linha em falha total do arquivo;
- não afirmar infraestrutura, retenção ou escala produtiva.

## 12. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Cargo, salário, vínculo detalhado e dependentes | MVP-3 · futuras fatias de cadastro de empregados e DP |
| Edição, arquivamento e reativação de empregado | MVP-3 · futura fatia de cadastro de empregados |
| Folha, validações legais, guias e eSocial | MVP-3 · fatias de DP e eSocial |
| Agente DP, explicações e sugestões | MVP-3 · futura fatia do Agente DP |
| Importação XLSX/ODS de plano de contas e empregados | MVP-1 · F15 / SPEC-015 |
| Retenção, escala e object storage produtivos | gate de Produção após o MVP-4 |

## 13. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Campos obrigatórios | CPF, nome completo, matrícula, nascimento e admissão |
| Chave natural | CPF + matrícula dentro da empresa |
| Reimportação | atualizar existentes, incluir novos e manter ausentes |
| Operadores | admin e DP importam/confirmam; contador e auditor consultam/baixam |
| Entrada | modelo ContaIA e mapeamento livre |
| Duplicidade | rejeitar todas as ocorrências da chave |
| Arquivado | rejeitar e orientar reativação no MVP-3 |
| Validação | estrutura, CPF e coerência de datas; regras legais ficam no MVP-3 |
| Aplicação | prévia e confirmação explícita |
| Onboarding sem válidas | não bloquear; criar ou manter pendência |
| Acesso | onboarding e aba `Empregados` |
| Notificação | iniciador e administradores autorizados |
| Histórico | completo, 15 por página, recentes primeiro |
| Resultado | tela e CSV |
| Limite | 10 mil linhas e 10 MB |
| Pipeline | compartilhado com a F13, assíncrono em BullMQ |
| Situação inicial | empregado novo ativo |

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
