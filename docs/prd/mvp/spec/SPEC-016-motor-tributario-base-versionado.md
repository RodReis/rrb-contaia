# SPEC-016 / F16 — Motor tributário base versionado

> **MVP:** MVP-1 — Fundação, captura e controle operacional
>
> **Origem:** PRD v3.1 §§2, 3, 5.3, 6.1, 6.5, 15 e 16
>
> **Estado:** aprovada pelo PI em 18/09/2026
>
> **Tamanho:** Médio — catálogo global, ciclo de publicação, avaliador determinístico, simulador manual e adaptador descartável de NF-e; captura, persistência documental e apuração permanecem em fatias próprias
>
> **Ambiente:** Docker local; produção permanece no gate posterior ao MVP-4
>
> **Issue:** #18

## 1. Objetivo

Entregar a base observável do motor tributário: um administrador da plataforma cadastra e publica versões de regras por vigência, e um usuário autorizado comprova qual versão se aplica e reproduz o cálculo por formulário ou por uma NF-e local de teste.

Sucesso significa obter sempre o mesmo resultado para a mesma entrada e versão, com memória de cálculo auditável, sem LLM, float, precedência oculta ou alteração retroativa causada por regra futura.

## 2. Fronteira da fatia

Esta fatia entrega:

- catálogo global de regras tributárias por tributo, regime e tipo de operação;
- rascunho, publicação imutável e arquivamento sem exclusão;
- vigência civil com rejeição de sobreposição para a mesma identidade de regra;
- operações tipadas de base, redução e aplicação de alíquota;
- simulador manual independente de empresa e competência;
- upload descartável de NF-e de fixture como entrada alternativa do simulador;
- leitura inicial dos grupos IBS/CBS da NF-e, sem captura ou persistência documental;
- memória de cálculo, auditoria e fixtures não oficiais para provar coexistência entre tributos atuais e IBS/CBS.

A F16 não entrega apuração por competência, guias, fechamento, escrituração, partidas dobradas, captura por NSU, manifestação, inbox nem repositório de documentos fiscais.

## 3. Comportamento esperado

### 3.1 Identidade e conteúdo da regra

Uma versão de regra contém, no mínimo:

- tributo: `ICMS`, `PIS`, `COFINS`, `IBS_UF`, `IBS_MUN` ou `CBS`;
- regime: `SIMPLES_NACIONAL`, `LUCRO_PRESUMIDO` ou `LUCRO_REAL`;
- tipo de operação, selecionado de catálogo tipado;
- `vigente_de` obrigatório e `vigente_ate` opcional, ambos datas civis;
- base de cálculo definida pela entrada;
- redução de base em centésimos de ponto percentual, opcional;
- alíquota em centésimos de ponto percentual;
- fonte descritiva e observação de fixture;
- versão otimista, autor e instantes de criação, publicação e arquivamento.

As fixtures da F16 são marcadas visivelmente como **dados de teste não oficiais**. Elas provam comportamento e não afirmam representar legislação vigente.

### 3.2 Ciclo de vida

```text
RASCUNHO ──▶ PUBLICADA ──▶ ARQUIVADA
```

- rascunho pode ser editado por `super-admin`;
- publicação exige confirmação explícita e validação integral;
- versão publicada é imutável; correção cria novo rascunho e nova versão;
- arquivamento impede uso em fatos futuros, mas preserva histórico e reproduções anteriores;
- nenhum estado pode voltar para rascunho ou ser apagado;
- concorrência de edição usa versão otimista e retorna HTTP 409.

### 3.3 Vigência e conflito

A seleção usa a data civil do fato gerador, nunca a data atual.

Para a mesma combinação de tributo, regime e tipo de operação, duas versões publicadas não podem possuir intervalos de vigência sobrepostos. A publicação conflitante falha sem alterar nenhuma versão.

Limites são inclusivos. `vigente_ate` ausente representa intervalo aberto. Arquivar uma versão não autoriza reescrever seu intervalo histórico.

### 3.4 Operações tipadas e precisão

O motor executa somente esta sequência:

1. recebe a base em centavos inteiros;
2. aplica, quando existente, redução de base em centésimos de ponto percentual;
3. aplica a alíquota em centésimos de ponto percentual;
4. arredonda o resultado final ao centavo por **meio para cima**.

Valores intermediários usam representação decimal exata ou racional; float é proibido. A memória expõe base original, redução, base reduzida, alíquota, valor anterior ao arredondamento, modo de arredondamento e total em centavos.

Não existe expressão livre, script, `eval`, fórmula enviada pelo navegador ou execução por LLM.

### 3.5 Simulação manual

O formulário recebe:

- data do fato gerador;
- regime;
- tributo;
- tipo de operação;
- base monetária.

O sistema seleciona exatamente uma regra publicada vigente. O resultado mostra regra e versão, intervalo de vigência, memória de cálculo e indicação de fixture. Simulação não cria apuração, guia, lançamento ou obrigação.

Sem regra vigente, o sistema retorna falha de domínio acionável. Mais de uma regra aplicável é erro de integridade e nunca é resolvido por “mais recente vence”.

### 3.6 Simulação por NF-e

O usuário pode carregar uma NF-e local exclusivamente para simulação. O adaptador:

- aceita somente XML de NF-e no leiaute RTC fixado pela implementação para a NT 2025.002 v1.50;
- valida namespace, versão e estrutura mínima antes de extrair dados;
- rejeita DTD e entidades externas;
- extrai data de emissão, CRT/regime quando mapeável, itens, bases e grupos IBS/CBS;
- permite ao usuário completar somente campos de simulação que não existam ou não tenham mapeamento inequívoco no XML;
- calcula por item e apresenta total agregado sem substituir os valores declarados no documento;
- compara, quando presentes, valores calculados e declarados, identificando divergência sem declarar qual é juridicamente correto;
- mantém o arquivo apenas em memória durante a requisição e não grava conteúdo, hash, item ou resultado como documento fiscal.

XML malformado, tipo diferente de NF-e, versão não suportada ou ausência de dados mínimos gera erro de validação, não HTTP 500. O arquivo nunca é enviado a serviço externo.

### 3.7 Catálogo global e autorização

O catálogo não pertence a tenant ou empresa. O papel `super-admin` já definido no PRD, pré-configurado no Keycloak local somente para esta capacidade, pode criar, editar rascunho, publicar e arquivar. Isso não antecipa gestão de tenants, billing, métricas SaaS ou o painel completo do MVP-4.

Usuários autenticados dos papéis `admin_escritorio`, `contador` e `auditor_readonly` podem consultar regras publicadas e simular. Outros papéis não recebem acesso por padrão. Toda autorização é revalidada pela API.

### 3.8 Auditoria

Criação, edição, publicação e arquivamento geram eventos append-only com ator, instante, versão anterior quando aplicável, versão resultante e `correlationId`. A auditoria não guarda o XML enviado ao simulador.

Simulações não entram no livro fiscal nem na auditoria permanente. Logs técnicos podem registrar duração, identificadores e códigos de resultado, mas nunca o XML completo.

## 4. Invariantes globais tocados

| Invariante | Aplicação nesta fatia |
|---|---|
| `I-3` | base e resultado são inteiros em centavos; alíquota e redução usam centésimos percentuais; float é proibido |
| `I-4` | todo valor vem do motor determinístico; LLM não calcula nem seleciona regra |
| `I-6` | eventos de criação, edição, publicação e arquivamento são append-only |
| `I-7` | regra publicada não é apagada nem alterada; arquivamento preserva o histórico |
| `I-8` | seleção usa a vigência na data do fato gerador |
| `I-11` | fato gerador e vigência são datas civis; instantes de auditoria usam UTC e exibição `America/Sao_Paulo` |
| `I-12` | mesma entrada e mesma versão reproduzem exatamente memória e resultado |

`I-1` e `I-2` não se aplicam ao catálogo global. Nenhuma tabela transacional de tenant ou empresa é criada nesta fatia.

## 5. Contrato de interface

### 5.1 Referências concretas

- `docs/telas/contaia_apura_o_fiscal_tribut_ria_reforma_ibs_cbs_rf_03/screen.png`;
- `docs/telas/contaia_apura_o_fiscal_tribut_ria_reforma_ibs_cbs_rf_03/code.html`;
- `docs/DESIGN-SYSTEM.md`, `docs/design-system/` e `docs/FRONTEND.md` §20.1.

A referência fornece hierarquia visual, identidade do motor e padrão da memória de cálculo. A F16 remove KPIs de carteira, empresas, guias, fechamento, partidas dobradas, SPED, malha e promessas de apuração.

### 5.2 Composição

1. identificação de ambiente local e aviso de fixtures não oficiais;
2. tabela do catálogo com filtros por tributo, regime, operação, vigência e estado;
3. criação e edição de rascunho;
4. confirmação de publicação ou arquivamento;
5. simulador com abas `Preenchimento manual` e `NF-e de teste`;
6. resultado e memória de cálculo determinística;
7. comparação entre valor calculado e declarado quando o XML trouxer ambos.

### 5.3 Estados obrigatórios

- carregando com skeleton;
- catálogo vazio;
- rascunho novo, editado e com validação pendente;
- publicação válida;
- vigência sobreposta;
- conflito de versão;
- versão publicada ou arquivada em somente leitura;
- simulação válida;
- nenhuma regra aplicável;
- mais de uma regra aplicável como erro de integridade;
- XML selecionado, analisando, incompatível, malformado ou sem campos mínimos;
- campos extraídos e campos que exigem complemento manual;
- divergência entre calculado e declarado;
- acesso negado;
- falha técnica com `correlationId`.

Toast não substitui estado persistente. Valores e avisos não dependem somente de cor.

### 5.4 Responsividade e acessibilidade

- temas CLARO e ESCURO completos;
- viewports obrigatórios de 768, 1024 e 1440 px;
- tabela, filtros, formulários, upload, diálogos e memória operáveis por teclado;
- foco visível e devolvido ao acionador após diálogo;
- resultados e erros anunciados sem excesso;
- valores monetários e percentuais possuem rótulos acessíveis completos;
- nomes longos, memória detalhada e XML com muitos itens não quebram a hierarquia;
- redução de movimento respeitada.

### 5.5 Prova visual obrigatória

A implementação usa `frontend-design` antes e durante a interface, `gstack:design-review` na revisão e `impeccable` no passe final. A PR prova comparação com a referência, ambos os temas, 768/1024/1440, estados, teclado, foco e acessibilidade conforme `FRONTEND.md` §20.1.

## 6. Arquitetura e contratos públicos

### 6.1 Fluxo

```text
super-admin ─▶ API ─▶ catálogo global versionado ─▶ auditoria append-only

formulário ───────────────┐
                         ├─▶ normalização ─▶ seleção por vigência ─▶ avaliador puro ─▶ memória
NF-e em memória ─▶ parser ┘
```

O caso de uso controla a transação. Controller valida e delega. DTO não é entidade. Parser não seleciona regra; avaliador não conhece HTTP, banco, relógio, XML ou LLM. A data do fato sempre entra por parâmetro.

### 6.2 Endpoints mínimos

```text
GET    /tax-rules
POST   /tax-rules
GET    /tax-rules/:id
PUT    /tax-rules/:id
POST   /tax-rules/:id/publish
POST   /tax-rules/:id/archive
POST   /tax-simulations/manual
POST   /tax-simulations/nfe
```

Listagem aceita filtros e paginação. Mutação de rascunho envia a versão esperada. Publicação e arquivamento são comandos explícitos. Simulação NF-e usa `multipart/form-data`; os demais contratos são JSON tipado.

Erro segue `application/problem+json`, com `type`, `title`, `status`, `code` e `correlationId`.

### 6.3 Códigos de erro estáveis

- `TAX_RULE_NOT_FOUND`;
- `TAX_RULE_IMMUTABLE`;
- `TAX_RULE_OVERLAPPING_VALIDITY`;
- `TAX_RULE_VERSION_CONFLICT`;
- `TAX_RULE_NOT_APPLICABLE`;
- `TAX_RULE_AMBIGUOUS`;
- `TAX_SIMULATION_INVALID_INPUT`;
- `NFE_XML_INVALID`;
- `NFE_LAYOUT_UNSUPPORTED`;
- `NFE_REQUIRED_DATA_MISSING`;
- `PLATFORM_ADMIN_REQUIRED`.

## 7. Erros observáveis

| Situação | Resultado esperado |
|---|---|
| Vigência final anterior à inicial | rascunho inválido, publicação bloqueada |
| Intervalo encosta sem sobrepor | publicação permitida quando o dia anterior encerra a versão anterior |
| Intervalo sobreposto | HTTP 409, nenhuma versão alterada |
| Edição de publicada | HTTP 409 `TAX_RULE_IMMUTABLE` |
| Regra futura | não afeta fato anterior à sua vigência |
| Nenhuma regra | resultado vazio acionável, sem cálculo improvisado |
| Duas regras aplicáveis por drift | erro de integridade, sem precedência automática |
| XML com DTD/entidade externa | rejeição antes do parse |
| XML de CT-e, NFS-e ou versão diferente | `NFE_LAYOUT_UNSUPPORTED` |
| IBS/CBS ausente | usuário pode completar entrada manual; ausência fica explícita |
| Falha técnica | estado persistente com `correlationId`, sem expor XML |

## 8. Estratégia de testes e provas

| Categoria | Prova mínima |
|---|---|
| Regras | limites inclusivos, intervalo aberto, redução, alíquota, meio para cima, valores extremos e reprodução exata |
| Vigência | atual/futura, transição entre versões, ausência e ambiguidade contrafactual |
| Banco | unicidade de vigência publicada, imutabilidade, versão otimista, arquivamento e append-only |
| Autorização | admin da plataforma muta; escritório/contador/auditor consultam e simulam; demais negados |
| XML | NF-e válida, IBS/CBS presente e ausente, XML malformado, versão diferente, DTD/XXE e muitos itens |
| API | JSON, multipart, paginação e todos os Problem Details estáveis |
| Tela | catálogo, rascunho, publicação, manual, NF-e, memória, erros, temas, viewports, teclado e foco |
| E2E | cadastrar → publicar → simular manualmente → simular por NF-e → comparar memória |
| Contrafactual | regra futura não muda cálculo passado; XML nunca aparece no banco, storage ou logs completos |

## 9. Critérios de aceite verificáveis

- [ ] `super-admin` cria e edita rascunho com operações tipadas.
- [ ] Publicação congela a versão e rejeita sobreposição.
- [ ] Arquivamento preserva regra e auditoria.
- [ ] Simulação seleciona regra pela data do fato e reproduz exatamente o resultado.
- [ ] Dinheiro não usa float e o resultado final aplica meio para cima.
- [ ] Memória identifica regra, versão, entrada, etapas e arredondamento.
- [ ] Fixture futura não altera simulação histórica.
- [ ] Fixtures de regime atual e IBS/CBS coexistem e são marcadas como não oficiais.
- [ ] Upload de NF-e válida extrai entradas e calcula por item e total.
- [ ] Valor declarado, quando presente, é comparado sem ser sobrescrito.
- [ ] XML incompatível, malformado ou inseguro é rejeitado com código estável.
- [ ] XML e conteúdo fiscal enviado ao simulador não são persistidos nem enviados externamente.
- [ ] API revalida autorização e responde em Problem Details.
- [ ] Banco prova imutabilidade, conflito, auditoria e ausência de tabela transacional de tenant nesta fatia.
- [ ] Interface não apresenta apuração, guia, fechamento, SPED ou dado fictício como real.
- [ ] Prova visual cobre referência, CLARO/ESCURO, 768/1024/1440, estados e acessibilidade.
- [ ] Jornada E2E completa roda no Docker local.

## 10. Limites e proibições

- não usar alíquota ou fixture como orientação fiscal real;
- não executar código ou expressão livre;
- não usar LLM para cálculo ou seleção;
- não alterar regra publicada;
- não resolver sobreposição por prioridade ou data de criação;
- não persistir XML, hash ou documento fiscal;
- não aceitar CT-e, NFS-e, NFC-e ou evento nesta fatia;
- não capturar DF-e, controlar NSU ou manifestar documento;
- não criar apuração, guia, lançamento, competência ou fechamento;
- não antecipar painel completo de super-admin;
- não registrar XML completo em log ou auditoria;
- não afirmar homologação ou uso produtivo.

## 11. Fora de escopo e destino do complemento

| Complemento | Destino obrigatório |
|---|---|
| Captura DF-e por NSU, idempotência e `tempoMedio` | MVP-1 · futura fatia RF-02, a numerar |
| Parse e persistência de NF-e, CT-e, NFS-e e eventos, XML original, hash e estrutura normalizada | MVP-1 · futura fatia RF-02, a numerar |
| Ciência da Emissão automática | MVP-1 · futura fatia RF-02, a numerar |
| Inbox e aprovação humana das demais manifestações | MVP-1 · futura fatia RF-02, a numerar |
| Apuração por competência, ICMS/PIS/COFINS/IBS/CBS, guias e escrituração | MVP-2 · futuras fatias RF-03 |
| Regras completas por regime e catálogo normativo oficial | MVP-2 · futuras fatias RF-03 |
| Transição IBS/CBS completa até 2033 | MVP-4 · futuras fatias tributárias |
| Gestão completa de super-admin, tenants, planos e billing | MVP-4 · futuras fatias RF-08 |
| Infraestrutura e dados produtivos | gate de Produção após o MVP-4 |

## 12. Dúvidas resolvidas pelo PI

| Tema | Decisão |
|---|---|
| Fluxo vertical | cadastrar, publicar e simular |
| Autor da regra | administrador da plataforma |
| Conteúdo inicial | fixtures declaradamente não oficiais |
| Modelo | operações tipadas; nenhuma DSL ampla |
| Sobreposição | rejeitada |
| Simulação | formulário independente e XML de teste |
| Arredondamento | meio para cima no resultado final |
| Alcance do XML | entrada descartável do simulador |
| Documento XML | somente NF-e |
| Complementos RF-02 | permanecem obrigatórios no MVP-1 e serão numerados em fatias próprias |

**Questões abertas:** nenhuma.

## 13. Gate dos oito itens obrigatórios

| Item | Evidência nesta SPEC |
|---|---|
| Fatia, MVP e Slice | cabeçalho e §§1–2 |
| Comportamento observável | §3 |
| Aceite verificável | §§8–9 |
| Invariantes tocados | §4 |
| Fora de escopo | §§10–11 |
| Dúvidas resolvidas | §12; nenhuma aberta |
| Destino do complemento | §11 |
| Contrato de UI | §5, com referência, estados, temas, viewports e provas |

## 14. Referências técnicas datadas

- Portal NF-e — NT 2025.002 v1.50, publicada em 03/06/2026: <https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=6WfrpZYE4Ik%3D>.
- Receita Federal — Orientações da Reforma Tributária para 2026, atualizadas em 06/05/2026: <https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-2026>.

A versão aceita pelo adaptador é explícita. Atualização de Nota Técnica exige fixture, parser e testes próprios; não existe compatibilidade silenciosa.

## 15. Aprovação

Fronteira, regras, XML, interface, autorização, arquitetura, provas e destinos aprovados pelo PI em 18/09/2026. A implementação deve seguir esta SPEC sem criar regra tributária ou jurídica adicional; lacuna material volta ao PI.
