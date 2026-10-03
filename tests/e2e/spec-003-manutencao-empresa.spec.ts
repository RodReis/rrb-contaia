/**
 * E2E do caminho crítico da SPEC-003 (§9).
 *
 * Editar empresa → consultar CNPJá → selecionar diferenças → salvar → conferir
 * histórico → arquivar → consultar → reativar, com os contrafactuais de CNPJ
 * imutável e de empresa arquivada somente para consulta.
 *
 * A CNPJá é dublada na camada de rede do navegador: a suíte não pode depender
 * da internet nem do provedor estar de pé.
 *
 * A empresa ativa de partida é criada direto no banco no `beforeAll`: passar
 * pelo wizard inteiro aqui provaria de novo a SPEC-002 e tornaria este arquivo
 * dependente da ordem entre suítes, que a CI não garante.
 *
 * Depende do ambiente local: `pnpm docker:up && pnpm db:migrate && pnpm db:seed`.
 */
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';

/** CNPJ exclusivo desta suíte, para não colidir com as outras. */
const CNPJ = '45242914000105';
const CNPJ_FORMATADO = '45.242.914/0001-05';

const RAZAO_ORIGINAL = 'Manutencao Comercio de Alimentos LTDA';
const RAZAO_DA_FONTE = 'MANUTENCAO COMERCIO DE ALIMENTOS E BEBIDAS LTDA';

let empresaId = '';

// Os três testes compartilham a mesma empresa e se encadeiam: o segundo parte
// do estado que o primeiro deixou, e o terceiro confere o histórico dos dois.
// Em paralelo eles disputariam a mesma linha do banco.
test.describe.configure({ mode: 'serial' });

const pool = new Pool({
  connectionString:
    process.env['DATABASE_URL'] ??
    'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia',
});

const entrar = async (page: Page): Promise<void> => {
  await page.goto('/api/auth/entrar');

  const usuario = page.getByRole('textbox', { name: 'Username or email' });

  await Promise.race([
    usuario.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
    page.waitForURL(/\/(escritorio|painel|empresas)/, { timeout: 15_000 }).catch(() => undefined),
  ]);

  if (await usuario.isVisible().catch(() => false)) {
    await usuario.fill('admin.escritorio');
    await page.getByRole('textbox', { name: 'Password' }).fill('admin_local_123');
    await page.getByRole('button', { name: 'Sign In' }).click();
  }

  await page.waitForURL(/\/(escritorio|painel|empresas)/);
};

test.beforeAll(async () => {
  // Só o tenant semeado: o `update` sem filtro alcançaria qualquer outro
  // escritório que exista na base local.
  const tenant = await pool.query<{ id: string }>(
    `update app.tenant set status = 'ATIVO'
      where cnpj = '11222333000181'
      returning id`,
  );

  const tenantId = tenant.rows[0]?.id;

  if (tenantId === undefined) {
    throw new Error('nenhum tenant semeado: rode `pnpm db:seed` antes do E2E');
  }

  // Estado limpo a cada execução: resíduo faria o insert violar a unicidade e a
  // suíte inteira seria pulada sem falha explícita.
  await pool.query(
    'alter table app.empresa_evento_de_historico disable trigger empresa_evento_de_historico_append_only',
  );
  await pool.query(
    `delete from app.empresa_evento_de_historico
      where empresa_id in (select id from app.empresa where cnpj = $1)`,
    [CNPJ],
  );
  await pool.query(
    'alter table app.empresa_evento_de_historico enable trigger empresa_evento_de_historico_append_only',
  );
  await pool.query(
    `delete from app.empresa_endereco
      where empresa_id in (select id from app.empresa where cnpj = $1)`,
    [CNPJ],
  );
  // O vínculo de carteira sai antes da empresa (FK composta, SPEC-009).
  await pool.query(
    `delete from app.carteira_vinculo
      where empresa_id in (select id from app.empresa where cnpj = $1)`,
    [CNPJ],
  );
  await pool.query('delete from app.empresa where cnpj = $1', [CNPJ]);

  const empresa = await pool.query<{ id: string }>(
    `insert into app.empresa
       (tenant_id, status, cnpj, razao_social, nome_fantasia, regime_tributario,
        enquadramento_simples, cnae_principal, inscricao_estadual_situacao,
        inscricao_municipal_situacao, situacao_cadastral_externa,
        validado_por_fonte_externa)
     values ($1, 'ATIVA', $2, $3, 'Manutencao Alimentos', 'SIMPLES_NACIONAL',
             'NAO_MEI', '1091102', 'ISENTO', 'ISENTO', 'Ativa', true)
     returning id`,
    [tenantId, CNPJ, RAZAO_ORIGINAL],
  );

  empresaId = empresa.rows[0]?.id ?? '';

  // A empresa inserida por SQL não passa pela criação que autoatribui o admin: sem vínculo, a
  // alçada por empresa (SPEC-009 §3.5) negaria a própria suíte. O admin do seed entra na carteira.
  await pool.query(
    `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id)
     select tenant_id, id, $2 from app.usuario
      where tenant_id = $1 and email = 'admin@escritorio.cnt.br'`,
    [tenantId, empresaId],
  );

  await pool.query(
    `insert into app.empresa_endereco
       (tenant_id, empresa_id, finalidade, principal, cep, logradouro, numero,
        bairro, municipio, uf)
     values ($1, $2, 'FISCAL', true, '74000000', 'Rua Um', '10', 'Centro',
             'Goiania', 'GO')`,
    [tenantId, empresaId],
  );
});

test.afterAll(async () => {
  await pool.end();
});

test('mantém a empresa, aplica a CNPJá seletivamente e registra no histórico', async ({
  page,
}) => {
  await entrar(page);
  await page.goto(`/empresas/${empresaId}`);

  // A empresa ativada abre na manutenção, não no wizard (§3.1).
  await expect(page.getByRole('tab', { name: 'Identificação' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Dados fiscais' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Endereços' })).toBeVisible();
  // Documentos entrou na F4 (SPEC-004); as provas da aba ficam na suíte dela.
  await expect(page.getByRole('tab', { name: 'Documentos' })).toBeVisible();

  // O CNPJ é exibido e não oferece edição (§3.2).
  await expect(page.getByText(CNPJ_FORMATADO).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^CNPJ/u })).toHaveCount(0);

  // A fonte externa é dublada pelo `CNPJA_URL` da API (ver playwright.config):
  // dublar no navegador cobriria só a comparação, e a aplicação — que o
  // servidor faz — acabaria consultando a CNPJá real.
  await page.getByRole('button', { name: /consultar cnpjá/iu }).click();

  const escolhaDaRazao = page.getByRole('checkbox', { name: /razão social/iu });
  await expect(escolhaDaRazao).toBeVisible();

  // Nada é aplicado automaticamente: sem seleção, não há o que salvar (§3.3).
  const aplicar = page.getByRole('button', { name: /aplicar selecionados/iu });
  await expect(aplicar).toBeDisabled();

  await escolhaDaRazao.check();
  await aplicar.click();

  await expect(page.getByText('Dados atualizados pela CNPJá.')).toBeVisible();

  // Só a razão social foi escolhida: o CNAE continua o original (§3.3).
  const depois = await pool.query<{ razao_social: string; cnae_principal: string }>(
    'select razao_social, cnae_principal from app.empresa where id = $1',
    [empresaId],
  );

  expect(depois.rows[0]?.razao_social).toBe(RAZAO_DA_FONTE);
  expect(depois.rows[0]?.cnae_principal).toBe('1091102');

  // O evento tem de estar no histórico global, com autor e os dois valores.
  await page.goto('/historico');

  // Escopo na lista de eventos: a navegação do topo também é uma lista.
  const evento = page
    .getByRole('list', { name: 'Eventos do histórico' })
    .getByRole('listitem')
    .first();
  await expect(evento).toContainText('Razão social');
  await expect(evento).toContainText(RAZAO_ORIGINAL);
  await expect(evento).toContainText(RAZAO_DA_FONTE);
});

test('arquiva com justificativa, consulta e reativa preservando os dados', async ({
  page,
}) => {
  await entrar(page);
  await page.goto(`/empresas/${empresaId}`);

  await page.getByRole('button', { name: /arquivar empresa/iu }).click();

  const dialogo = page.getByRole('dialog');
  await dialogo.getByRole('textbox', { name: /justificativa/iu }).fill(
    'Encerrou as atividades no E2E.',
  );
  await dialogo.getByRole('button', { name: 'Arquivar empresa' }).click();

  await expect(page.getByText('Empresa arquivada.')).toBeVisible();

  // Arquivada fica somente para consulta até ser reativada (§3.5).
  await expect(page.getByRole('status').first()).toContainText(/somente para consulta/iu);
  await expect(page.getByRole('textbox', { name: /razão social/iu })).toBeDisabled();
  await expect(page.getByRole('button', { name: /salvar alterações/iu })).toHaveCount(0);

  // A empresa arquivada só aparece sob o filtro Arquivadas (§3.1). A busca é
  // na tabela: a listagem também renderiza cartões para telas estreitas, que
  // existem no DOM e ficam ocultos nesta largura.
  await page.goto('/empresas?status=ATIVA');
  await expect(page.getByRole('table').getByText(CNPJ_FORMATADO)).toHaveCount(0);

  await page.goto('/empresas?status=ARQUIVADA');
  await expect(page.getByRole('table').getByText(CNPJ_FORMATADO)).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Arquivada');

  // Nada foi apagado: o dado continua lá, com a situação trocada (I-7).
  const arquivada = await pool.query<{ situacao: string; razao_social: string }>(
    'select situacao, razao_social from app.empresa where id = $1',
    [empresaId],
  );

  expect(arquivada.rows[0]?.situacao).toBe('arquivado');
  expect(arquivada.rows[0]?.razao_social).toBe(RAZAO_DA_FONTE);

  await page.goto(`/empresas/${empresaId}`);
  await page.getByRole('button', { name: /reativar empresa/iu }).click();

  const dialogoDeReativacao = page.getByRole('dialog');
  await dialogoDeReativacao
    .getByRole('textbox', { name: /justificativa/iu })
    .fill('Retomou as atividades no E2E.');
  await dialogoDeReativacao.getByRole('button', { name: 'Reativar empresa' }).click();

  await expect(page.getByText('Empresa reativada.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: /razão social/iu })).toBeEnabled();

  // Arquivamento e reativação aparecem na aba Status da empresa, com as
  // justificativas preservadas (§3.6).
  await page.goto('/historico?aba=STATUS_DA_EMPRESA');

  await expect(page.getByText('Retomou as atividades no E2E.')).toBeVisible();
  await expect(page.getByText('Encerrou as atividades no E2E.')).toBeVisible();
});

test('o histórico não oferece nenhuma ação de escrita', async ({ page }) => {
  await entrar(page);
  await page.goto('/historico');

  await expect(
    page.getByRole('list', { name: 'Eventos do histórico' }).getByRole('listitem').first(),
  ).toBeVisible();

  // Append-only não é só regra de servidor: a tela não tem por onde tentar (I-6).
  for (const proibido of [/editar/iu, /excluir/iu, /remover/iu]) {
    await expect(page.getByRole('button', { name: proibido })).toHaveCount(0);
  }
});
