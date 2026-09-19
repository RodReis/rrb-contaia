# SPEC-025 / F25 — Procuração eletrônica RFB/e-CAC

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§3, 4.5, 12, 13.1, 15 e 16
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Grande e delimitada — gestão, evidência, vigência, autorização, auditoria, notificações, dublê e interface precisam formar uma entrega vertical; nenhuma integração oficial é antecipada
>
> **Ambiente:** Docker local, com storage e dublê determinístico; produção e integração oficial permanecem fora desta fatia
>
> **Issue:** #27

## 1. Objetivo

Permitir que o escritório registre e administre a procuração eletrônica concedida por uma empresa cliente ao e-CNPJ do escritório, com poderes RFB explícitos, vigência própria, evidência documental, autorização no servidor e histórico auditável.

Sucesso significa ativar uma procuração declarada somente depois de o administrador anexar o comprovante, confirmar a conferência no portal oficial e concluir a prova contra o dublê local; usuários autorizados consultam seu alcance e operações RFB dubladas são recusadas quando o poder ou a vigência não permitem.

A F25 não valida procurações perante a Receita Federal, não automatiza login ou navegação em portal governamental e não transforma a procuração RFB/e-CAC em credencial para Sefaz ou captura DF-e.

## 2. Fronteira da fatia

Esta fatia entrega:

- cadastro, edição enquanto rascunho, confirmação, ativação, renovação, revogação e arquivamento lógico;
- uma versão vigente e, opcionalmente, uma renovação futura por empresa e e-CNPJ do escritório;
- catálogo fechado e versionado dos poderes RFB suportados;
- um PDF de evidência por versão, com hash SHA-256 e acesso protegido;
- estados derivados da vigência civil e bloqueio imediato no vencimento;
- notificações D-30, D-7 e no vencimento;
- autorização por tenant, empresa, carteira, papel, estado e poder;
- dublê local determinístico para consulta cadastral e certidões;
- trilha append-only das mutações e tentativas de uso;
- interface final integrada a `Configurações & Cofre A1`, nos temas CLARO e ESCURO.

Não entrega API oficial da RFB, automação do Portal de Serviços/e-CAC, sessão gov.br, scraping, caixa postal, processos, declarações, escriturações, transmissão, poder em texto livre, procuração Sefaz ou substituição do A1 da F17.

## 3. Comportamento

### 3.1 Identidade e cardinalidade

Cada versão pertence obrigatoriamente a um `tenant`, uma `empresa` e ao e-CNPJ do próprio escritório. O CNPJ outorgante é o CNPJ ativo da empresa; o CNPJ outorgado é o CNPJ ativo do tenant.

Para cada par empresa + e-CNPJ do escritório:

- pode existir no máximo uma versão vigente;
- pode existir no máximo uma versão futura confirmada;
- períodos confirmados não podem se sobrepor;
- rascunhos não autorizam operação e não contam como versão vigente ou futura;
- renovação cria nova versão e preserva integralmente a anterior;
- troca de CNPJ da empresa ou do escritório não reescreve versões históricas.

A vigência usa datas civis inclusivas `validFrom` e `validUntil`. O relógio entra por parâmetro. Uma versão é elegível durante todo o dia final e expira no início do dia civil seguinte em `America/Sao_Paulo`, sem converter as datas persistidas em timestamp.

### 3.2 Estados e transições

```text
DRAFT ── confirmar + evidência + teste local ──▶ SCHEDULED ── início ──▶ ACTIVE
   │                                                │                    │
   └──────────────── revogar ───────────────────────┴────────────────────┤
                                                                         ▼
                                                                      REVOKED

ACTIVE ── fim da vigência ──▶ EXPIRED
SCHEDULED ── fim alcançado sem ativação possível ──▶ EXPIRED
```

- `DRAFT`: permite corrigir período, poderes e PDF; não autoriza uso.
- `SCHEDULED`: confirmação concluída, mas `validFrom` ainda não chegou.
- `ACTIVE`: confirmação concluída e data atual dentro da vigência.
- `EXPIRED`: fim da vigência ultrapassado; bloqueia uso automaticamente.
- `REVOKED`: encerramento manual irreversível daquela versão; bloqueia uso imediatamente.

Arquivamento é atributo lógico separado, permitido apenas para versão `EXPIRED` ou `REVOKED`. Arquivar não apaga evidência, eventos nem tentativas de uso. Não existe reativação de versão revogada ou expirada.

### 3.3 Cadastro, evidência e confirmação

Somente `admin_escritorio` cadastra e mantém procurações do próprio tenant. O cadastro exige empresa ativa, e-CNPJ ativo do escritório, início, fim e ao menos um poder do catálogo vigente.

Cada versão aceita exatamente um PDF:

- conteúdo validado por assinatura mágica e MIME permitido, não apenas extensão;
- limite de 20 MB, preservando o contrato documental da F4;
- nome original sanitizado, tamanho, tipo, hash SHA-256 e referência opaca persistidos;
- armazenamento privado reutiliza a fronteira documental da F4;
- substituição do PDF enquanto `DRAFT` cria nova versão documental e preserva auditoria;
- após confirmação, o PDF fica imutável; correção exige nova versão da procuração;
- download e visualização respeitam tenant, empresa, carteira e papel.

Para confirmar, o administrador declara explicitamente que conferiu a autorização no Portal de Serviços/e-CAC e que período, outorgante, outorgado e poderes correspondem ao PDF. A API registra usuário, instante e revisão dessa declaração.

Depois da declaração, o sistema executa um teste contra o dublê local com um dos poderes selecionados. Somente o sucesso do teste conclui a confirmação. O resultado é rotulado como **teste local da configuração**, nunca como validação automática ou oficial da RFB.

### 3.4 Catálogo de poderes

O catálogo inicial é fechado, tipado e versionado:

| Código estável | Capacidade |
|---|---|
| `RFB_CNPJ_STATUS_READ` | consultar situação cadastral do CNPJ |
| `RFB_TAX_CLEARANCE_CERTIFICATE_READ` | consultar certidão de regularidade fiscal |
| `RFB_TAX_CLEARANCE_CERTIFICATE_ISSUE` | emitir certidão de regularidade fiscal no dublê |

Não existe poder livre, curinga ou autorização implícita para serviços futuros. Acrescentar código ou ampliar o significado de um código existente exige decisão de produto e versão nova do catálogo. Versões confirmadas mantêm o snapshot de códigos e descrições vigente na confirmação.

### 3.5 Acesso e uso

- `admin_escritorio`: administra versões de qualquer empresa do tenant pela área administrativa; o uso operacional continua limitado à própria carteira.
- `contador` e `auxiliar`: consultam estado, vigência e poderes das empresas da carteira; não alteram procurações.
- `auditor_readonly`: consulta registro, evidência e histórico das empresas da carteira; não altera nem executa operação.
- demais papéis: somente recebem o efeito da autorização quando uma capacidade futura explicitamente lhes conceder a operação; esta fatia não amplia suas permissões.

Antes de cada chamada ao dublê, o servidor valida, nesta ordem:

1. tenant e empresa;
2. usuário ou identidade técnica e carteira aplicável;
3. permissão da ação;
4. estado `ACTIVE` não arquivado;
5. data civil dentro da vigência;
6. presença do poder solicitado no snapshot confirmado.

Falha em qualquer etapa impede a chamada. O navegador nunca escolhe URL, método externo ou código de poder fora do catálogo.

### 3.6 Dublê RFB local

O dublê fica disponível somente na rede Docker local e implementa as três capacidades do catálogo com fixtures determinísticas. Ele não simula autenticação gov.br nem afirma reproduzir o protocolo privado do portal oficial.

Cada operação recebe contexto autenticado, CNPJ da empresa, código de poder e chave idempotente. O adaptador possui destinos fixos por configuração e retorna resposta tipada e sanitizada. `RFB_TAX_CLEARANCE_CERTIFICATE_ISSUE` é idempotente: repetição da mesma solicitação retorna o mesmo resultado sem nova emissão lógica.

### 3.7 Alertas, expiração e histórico

Administradores ativos do tenant recebem uma notificação por procuração e marco:

- D-30;
- D-7;
- vencimento.

Reprocessamento ou concorrência não duplica notificação. Procuração revogada antes do marco não gera alerta futuro. Expiração bloqueia uso mesmo se o job de notificação falhar; notificação é consequência, não fonte do estado.

A trilha append-only registra cadastro, alteração de rascunho, troca do PDF, confirmação, teste local, ativação derivada, renovação, revogação, expiração, arquivamento, notificações e toda tentativa de uso. Cada evento contém tenant, empresa, versão, autor, origem, revisão, código do poder quando aplicável, resultado, motivo, `correlationId` e instante.

O histórico não guarda conteúdo do PDF, resposta integral do dublê, sessão, token, certificado ou segredo.

## 4. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-1` | versões, evidências, notificações, operações e eventos possuem `tenant_id` e `empresa_id`, indexados e sob RLS |
| `I-2` | consulta ou operação sem tenant não retorna procuração, evidência nem resultado |
| `I-6` | histórico da procuração e das operações é append-only |
| `I-7` | versão e evidência não são apagadas; versões terminais apenas são arquivadas logicamente |
| `I-9` | emissão dublada e notificações são idempotentes |
| `I-11` | início e fim são datas civis; eventos usam UTC e são exibidos em `America/Sao_Paulo` |

## 5. Contrato de interface

### 5.1 Referência e composição

Referências:

- `docs/telas/contaia_configura_es_cofre_de_certificados_a1/screen.png`;
- `docs/telas/contaia_configura_es_cofre_de_certificados_a1/code.html`.

A F25 compõe a tela final das F11/F12 em `Configurações → Cofre A1 e procurações` e reintroduz somente:

- indicador `Procurações RFB` com contagem por estado;
- tipo de credencial `Procuração RFB/e-CAC` na listagem por empresa;
- ação `Gerenciar procuração`;
- formulário, detalhe de poderes/evidência e histórico.

O rótulo do protótipo `e-CAC Conectado` é proibido. A interface usa `Configuração testada localmente` e informa: `Declaração conferida pelo escritório; sem validação automática pela Receita Federal`.

### 5.2 Lista e detalhe

A lista mostra empresa, CNPJ, e-CNPJ outorgado, estado textual, início, fim, dias restantes, resumo dos poderes e ação. Permite busca por empresa/CNPJ, filtros por estado, poder e vencimento, paginação e ordenação. Estado nunca depende somente de cor.

O detalhe mostra:

- identidade de outorgante e outorgado;
- período e linha do tempo de estados;
- catálogo confirmado e sua versão;
- PDF, hash e metadados;
- declaração do administrador;
- resultado do teste local e `correlationId`;
- histórico paginado do mais recente para o mais antigo;
- ações permitidas conforme estado.

### 5.3 Fluxos

- cadastro em etapas: empresa → período → poderes → PDF → revisão;
- confirmação com `AlertDialog` que diferencia conferência humana de validação oficial;
- teste local com progresso sem disparo duplicado;
- renovação pré-preenchida que sempre cria nova versão;
- revogação com motivo obrigatório e confirmação do efeito imediato;
- arquivamento de versão terminal, sem opção de excluir.

Feedback usa Toast Sonner. `alert`, `confirm` e `prompt` são proibidos.

### 5.4 Estados e acessibilidade

Estados obrigatórios:

- carregando com skeleton;
- lista vazia;
- rascunho;
- confirmação/teste em andamento;
- futura;
- ativa;
- vence em até 30 dias;
- vence em até 7 dias;
- vencida;
- revogada;
- arquivada;
- falha no PDF;
- falha no teste local;
- conflito de período ou revisão;
- acesso negado;
- falha de comunicação com preservação do último estado conhecido.

Provas obrigatórias:

- temas CLARO e ESCURO;
- viewports 768, 1024 e 1440 px;
- teclado, foco visível, ordem previsível e retorno de foco;
- diálogo prende foco e fecha por `Esc` quando não há operação irreversível em andamento;
- atualização assíncrona anunciada sem excesso;
- redução de movimento respeitada;
- PDF e ações possuem nomes acessíveis;
- `frontend-design` antes e durante a implementação e `impeccable` no passe final, conforme `FRONTEND.md` §20.1.

## 6. Contratos internos

### 6.1 Tipos mínimos

```ts
type PowerOfAttorneyStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "ACTIVE"
  | "EXPIRED"
  | "REVOKED";

type RfbPowerCode =
  | "RFB_CNPJ_STATUS_READ"
  | "RFB_TAX_CLEARANCE_CERTIFICATE_READ"
  | "RFB_TAX_CLEARANCE_CERTIFICATE_ISSUE";

type PowerOfAttorneyVersion = {
  id: string;
  tenantId: string;
  companyId: string;
  grantorCnpj: string;
  granteeCnpj: string;
  validFrom: string;
  validUntil: string;
  status: PowerOfAttorneyStatus;
  catalogVersion: number;
  powers: readonly RfbPowerCode[];
  evidenceDocumentId: string | null;
  confirmedAt: string | null;
  revokedAt: string | null;
  archivedAt: string | null;
  revision: number;
};
```

Datas civis usam `YYYY-MM-DD`. DTO de mutação exige `expectedRevision`. API não recebe URL, cookie, token gov.br, certificado, caminho de storage ou código de poder livre.

### 6.2 Casos de uso

O caso de uso controla a transação e publica auditoria/notificação por outbox. Fronteiras mínimas:

- criar e editar rascunho;
- anexar/substituir evidência em rascunho;
- confirmar e testar configuração;
- renovar;
- revogar;
- arquivar versão terminal;
- listar/detalhar/histórico;
- autorizar e executar capacidade RFB dublada;
- projetar vigência e emitir alertas idempotentes.

Controller apenas valida formato e delega. Status corrente é calculado pelas regras de data, sem depender de um cron para expirar.

### 6.3 Persistência

Persistem separadamente:

- versão da procuração e revisão concorrente;
- snapshot de poderes e versão do catálogo;
- vínculo com versão documental da F4 e hash SHA-256;
- confirmação humana e resultado do teste local;
- marcações de revogação e arquivamento;
- marcos de notificação;
- operações dubladas e chaves idempotentes;
- eventos append-only.

Restrições de banco impedem sobreposição confirmada, mais de uma futura, alteração de evento e acesso cruzado. A checagem de sobreposição também ocorre no caso de uso para retornar erro acionável.

### 6.4 Erros observáveis

| Situação | Resultado |
|---|---|
| tenant, empresa ou versão cruzados | negação sem revelar existência ou dados |
| usuário fora da carteira consulta ou usa | `403 application/problem+json` |
| não administrador tenta mutar | `403`; nenhum estado muda |
| CNPJ do registro diverge da empresa/tenant | `422` com código estável |
| intervalo inválido ou sobreposto | `422`; informa o conflito permitido sem expor outro tenant |
| segundo registro futuro | `409`; exige renovar ou arquivar o anterior |
| PDF ausente, inválido ou acima do limite | `422`; nada é confirmado |
| confirmação sem declaração | `422` |
| teste local falha | permanece `DRAFT`; falha auditada |
| revisão concorrente | `409`; exige recarga |
| poder ausente ou desconhecido | recusa antes do dublê |
| versão futura, vencida, revogada ou arquivada | recusa antes do dublê |
| revogação repetida | reutiliza o resultado terminal sem novo efeito |
| falha de notificação | estado e bloqueio permanecem corretos; outbox retenta |

Erros seguem `application/problem+json`, com `type`, `title`, `status`, `code` e `correlationId`.

## 7. Estratégia de testes

| Categoria | Prova mínima |
|---|---|
| Regras | estados, datas inclusivas, sobreposição, uma vigente + uma futura, catálogo fechado, confirmação, revogação e arquivamento |
| Banco | RLS, restrições de cardinalidade, concorrência, hash/evidência, outbox e append-only |
| Documentos | PDF válido, assinatura inválida, MIME divergente, tamanho excedido, versionamento e acesso cruzado |
| Autorização | admin administra; contador/auxiliar consultam carteira; auditor consulta; demais papéis e contexto cruzado são negados |
| Dublê | três poderes válidos; poder ausente, estado inválido e destino livre recusados |
| Idempotência | emissão repetida, revogação repetida e notificações reprocessadas não duplicam efeito |
| Relógio | antes do início, primeiro dia, D-30, D-7, último dia e primeiro dia vencido |
| Tela | todos os estados, temas, viewports, teclado, foco, textos e contraste |
| E2E | cadastrar → PDF → declarar → testar → ativar → consultar CNPJ/certidão → renovar → expirar/revogar → histórico |
| Segurança | outro tenant, fora da carteira, arquivo malicioso, poder livre, segredo sentinela e resposta integral não vazam |
| Contrafactual | teste local não aparece como validação oficial; procuração não habilita Sefaz/DF-e; alerta falho não prolonga vigência |

As provas usam Docker local, fixtures determinísticas e relógio controlado. Validação oficial, compatibilidade do portal e operação produtiva permanecem `not_run`.

## 8. Critérios de aceite

- [ ] Uma empresa possui no máximo uma versão vigente e uma futura confirmada para o e-CNPJ do escritório, sem sobreposição.
- [ ] Datas civis são inclusivas e o primeiro dia posterior ao fim bloqueia uso independentemente do job de notificações.
- [ ] Confirmação exige PDF válido, declaração do administrador e teste local bem-sucedido.
- [ ] A interface e a auditoria identificam o teste como local e nunca afirmam validação oficial da RFB.
- [ ] Somente os três códigos do catálogo inicial podem ser concedidos ou executados.
- [ ] Procuração RFB/e-CAC não autoriza captura, manifestação ou qualquer operação Sefaz/DF-e.
- [ ] Admin administra; contador e auxiliar consultam a carteira; auditor consulta registro/histórico; mutação indevida é recusada.
- [ ] PDF confirmado é imutável, protegido por RLS/carteira e verificável por SHA-256.
- [ ] Renovação cria versão nova; revogação é imediata e irreversível; versão terminal somente é arquivada logicamente.
- [ ] D-30, D-7 e vencimento notificam administradores sem duplicação.
- [ ] Cada tentativa de uso valida contexto, estado, vigência e poder antes de alcançar o dublê.
- [ ] Emissão dublada é idempotente e o chamador não controla URL ou operação livre.
- [ ] Histórico append-only registra mutações, testes, alertas e tentativas sem PDF, resposta integral ou segredo.
- [ ] Erros concorrentes e de validação seguem `application/problem+json` com código estável e `correlationId`.
- [ ] Interface final compõe Cofre A1/procurações sem restaurar garantias falsas do protótipo.
- [ ] CLARO/ESCURO, 768/1024/1440 px, teclado, foco, acessibilidade e estados são provados.
- [ ] A PR registra `frontend-design`, comparação visual e passe final de `impeccable`.
- [ ] CI publica provas de regras, banco, tela e E2E vinculadas à SPEC-025 e à issue #27.

## 9. Limites do Code

- Sempre: validar autorização no servidor, preservar versões, distinguir declaração de validação oficial, controlar o relógio e auditar falhas.
- Perguntar antes: adicionar poder, ampliar papel, permitir várias versões simultâneas, mudar alertas, aceitar outro formato ou automatizar portal oficial.
- Nunca: fazer scraping/login gov.br, guardar sessão/token, chamar URL fornecida pelo cliente, usar procuração para Sefaz, apagar evidência/evento ou exibir `e-CAC conectado`.

## 10. Fora desta fatia e destino

| Item | Destino |
|---|---|
| API, consulta ou validação oficial de procurações RFB | capacidade integradora posterior, condicionada a canal oficial documentado; produção somente após o MVP-4 |
| Automação do Portal de Serviços/e-CAC, login gov.br ou scraping | excluídos desta arquitetura; eventual adoção exige decisão do PI, ADR e SPEC própria |
| Caixa postal, processos, declarações e escriturações RFB | capacidades fiscais próprias dos MVPs 2–4 |
| Catálogo amplo ou autorização para serviços futuros | fatia própria após definição dos serviços concretos |
| Procuração para Sefaz/DF-e | não é a procuração RFB/e-CAC; captura do MVP-1 permanece com A1 conforme F17 |
| Material, credenciais, storage e observabilidade produtivos | gate de produção posterior ao MVP-4 |
| Validação de compatibilidade real com portais oficiais | gate da integração correspondente; nesta fatia fica `not_run` |

## 11. Decisões do PI

| Tema | Decisão |
|---|---|
| Fronteira | gestão completa + dublê local; sem integração oficial |
| Efeito | somente serviços RFB explicitamente concedidos; não substitui A1 em Sefaz/DF-e |
| Comprovação | declaração do administrador + um PDF por versão + teste local |
| Poderes | catálogo explícito e versionado, sem texto livre ou serviços futuros implícitos |
| Catálogo inicial | situação cadastral do CNPJ e consulta/emissão de certidões |
| Ativação | exige confirmação do admin e teste local bem-sucedido |
| Acesso | admin gere; contador/auxiliar da carteira consultam; auditor consulta histórico |
| Cardinalidade | uma vigente e uma futura, sem sobreposição |
| Alertas | D-30, D-7 e vencimento |
| Evidência | PDF único, com hash, acesso protegido e sem exclusão física |

## 12. Gate de conformidade

| Verificação | Resultado |
|---|---|
| Identidade | F25/SPEC-025 · MVP-1 · PRD §§3, 4.5, 12, 13.1, 15 e 16 |
| Comportamento | gestão vertical, autorização e prova local observáveis |
| Aceite | critérios enumerados e ligados a regras, banco, documento, tela e E2E |
| Invariantes | I-1, I-2, I-6, I-7, I-9 e I-11 aplicados explicitamente |
| Fora de escopo | integrações oficiais, serviços amplos, Sefaz e produção possuem destino |
| Dúvidas | decisões do PI registradas; questões abertas: nenhuma |
| Complementos | integrações e capacidades ampliadas apontam destino e gatilho |
| UI | referências concretas, estados, temas, viewports, acessibilidade, `frontend-design` e `impeccable` |

## 13. Referências

- PRD v3.1 §§3, 4.5, 12, 13.1, 15 e 16.
- `docs/CONVENTION.md` §§2 e 3.4.
- F4/SPEC-004 para documentos versionados.
- F6/SPEC-006 para notificações.
- F8–F10 para permissão, carteira e RLS.
- F24/SPEC-024 para auditoria append-only.
- `docs/FRONTEND.md`, `docs/DESIGN-SYSTEM.md` e `docs/design-system/`.

## 14. Aprovação

Fronteira, efeito, comprovação, catálogo, ativação, acesso, cardinalidade, alertas, evidência, interface, provas e destinos aprovados pelo PI em 18/09/2026.
