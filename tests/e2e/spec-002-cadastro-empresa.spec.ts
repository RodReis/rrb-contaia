/**
 * E2E do caminho crítico da SPEC-002 (§10).
 *
 * Login → consultar CNPJ → pré-preencher → editar → sair → retomar → ativar →
 * localizar na lista, com os contrafactuais de duplicidade e de falha da fonte
 * externa.
 *
 * A CNPJá é dublada na camada de rede do navegador: a suíte não pode depender
 * da internet nem do provedor estar de pé (§5). A prova externa real é
 * separada e roda fora da CI.
 *
 * Cadastrar empresa exige escritório já `ATIVO` (SPEC-002 §2); o seed do F1
 * cria o tenant `CADASTRO_INCOMPLETO` de propósito, porque é o estado que o
 * E2E da SPEC-001 precisa encontrar. Em vez de depender de aquela suíte ter
 * rodado antes — ordem que a CI não garante entre arquivos — este arquivo
 * ativa o tenant direto no banco no `beforeAll`, ficando autossuficiente.
 *
 * Depende do ambiente local com Docker, Keycloak semeado e banco migrado:
 * `pnpm docker:up && pnpm db:migrate && pnpm db:seed`.
 */
import { Pool } from 'pg';
import { expect, test, type Page } from '@playwright/test';

/** CNPJs exclusivos desta suíte, para não colidir com dado de outra origem. */
const CNPJ_NOVO = '19131243000197';
const CNPJ_SEM_FONTE = '27865757000102';
const CNPJ_FORMATADO = '19.131.243/0001-97';

/**
 * Já no formato que a **nossa** rota devolve, não no formato bruto da CNPJá: o
 * dublê substitui a resposta da API do produto, e o mapeamento do provedor é
 * provado no teste do adaptador.
 */
const RESPOSTA_DA_FONTE = {
  cnpj: CNPJ_NOVO,
  razaoSocial: 'INSTITUTO NACIONAL DE TECNOLOGIA LTDA',
  nomeFantasia: 'Instituto Tecnologia',
  situacaoCadastral: 'Ativa',
  cnaePrincipal: '6201501',
  cnaesSecundarios: ['6202300'],
  telefone: '1133224455',
  email: 'contato@instituto.example',
  endereco: {
    cep: '01310100',
    logradouro: 'Avenida Paulista',
    numero: '1000',
    complemento: null,
    bairro: 'Bela Vista',
    municipio: 'São Paulo',
    uf: 'SP',
  },
  optanteSimples: false,
  mei: null,
};

const entrar = async (page: Page): Promise<void> => {
  await page.goto('/api/auth/entrar');

  // Duas saídas possíveis: o Keycloak pede credencial na primeira vez e, com a
  // sessão do provedor ainda válida, devolve o código direto.
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

/**
 * Substitui a consulta externa na borda da API do produto. O contrato que
 * interessa ao E2E é o da nossa rota; o adaptador tem provas próprias.
 *
 * O handler responde direto, sem `rota.fetch()`: reemitir a requisição de
 * dentro do interceptador derruba a navegação do Playwright neste projeto.
 * A duplicidade, que o servidor decide, tem teste próprio abaixo sem dublê.
 */
const dublarConsulta = async (
  page: Page,
  desfecho: 'consultado' | 'sem_fonte',
  dados: unknown = null,
): Promise<void> => {
  await page.route('**/api/proxy/empresas/consulta-cnpj/**', async (rota) => {
    const cnpj = rota.request().url().split('/').pop() ?? '';

    await rota.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        desfecho === 'consultado'
          ? { situacao: 'consultado', cnpj, dados }
          : { situacao: 'sem_fonte', cnpj, motivo: 'indisponivel' },
      ),
    });
  });
};

/**
 * Abre uma etapa pelo stepper. O wizard abre na primeira etapa pendente, que
 * varia com o quanto a fonte externa preencheu: navegar explicitamente evita
 * depender desse estado.
 *
 * O stepper só torna clicável a etapa atual e as concluídas — etapa pendente
 * não é botão, de propósito. Quando o alvo ainda não é alcançável, o caminho é
 * avançar pelo fluxo, e não forçar a navegação.
 */
const abrirEtapa = async (page: Page, etapa: string): Promise<boolean> => {
  // `isVisible` não espera: sem isto, uma página que renderiza o stepper um instante depois
  // (máquina ocupada, outra suíte em paralelo) faz o helper concluir que a etapa não existe.
  await page
    .getByRole('navigation', { name: 'Etapas do cadastro' })
    .waitFor()
    .catch(() => undefined);

  const titulo = page.getByRole('heading', { name: etapa, level: 2 });

  if (await titulo.isVisible().catch(() => false)) {
    return true;
  }

  // O nome acessível do botão inclui a situação ("Identificação etapa atual").
  const botao = page.getByRole('button', { name: new RegExp(`^${etapa}`, 'u') });

  if (!(await botao.isVisible().catch(() => false))) {
    return false;
  }

  await botao.click();
  await expect(titulo).toBeVisible();

  return true;
};

const consultar = async (page: Page, cnpj: string): Promise<void> => {
  await page.goto('/empresas/nova');

  // `pressSequentially` em vez de `fill`: o campo é mascarado por `react-imask`,
  // que reage a tecla e não a uma atribuição direta de valor.
  const campo = page.getByRole('textbox', { name: /CNPJ da empresa/u });

  await campo.click();
  await campo.pressSequentially(cnpj);
  await page.getByRole('button', { name: 'Consultar CNPJ' }).click();
};

test.describe.configure({ mode: 'serial' });

/**
 * Espera o tenant seedado ficar `ATIVO`, sem forçá-lo por SQL.
 *
 * Os dois arquivos de E2E compartilham o único tenant que o seed cria — o
 * OIDC tem um usuário só — e rodam em paralelo (`fullyParallel`, §config).
 * `spec-001` é quem completa o cadastro do escritório pela UI; forçar o
 * status aqui por UPDATE correria com aquele teste e o derrubaria se
 * pegasse o tenant no meio do preenchimento. Em vez disso, esperamos o
 * resultado que `spec-001` produz, com timeout generoso para a ordem em
 * que os workers decidirem intercalar os dois arquivos.
 */
const esperarEscritorioAtivo = async (pool: Pool): Promise<void> => {
  const limite = Date.now() + 60_000;

  while (Date.now() < limite) {
    const { rows } = await pool.query<{ status: string }>('select status from app.tenant limit 1');

    if (rows[0]?.status === 'ATIVO') {
      return;
    }

    await new Promise((resolver) => setTimeout(resolver, 1_000));
  }

  throw new Error(
    'o tenant seedado não ficou ATIVO a tempo — spec-001-cadastro-escritorio ' +
      'precisa rodar (mesmo que em paralelo) para deixar o escritório pronto.',
  );
};

test.beforeAll(async () => {
  test.setTimeout(90_000);

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

  try {
    await esperarEscritorioAtivo(pool);
  } finally {
    await pool.end();
  }
});

test('cadastra o CNPJ consultado, retoma o cadastro e ativa a empresa', async ({ page }) => {
  await entrar(page);
  await dublarConsulta(page, 'consultado', RESPOSTA_DA_FONTE);
  await consultar(page, CNPJ_NOVO);

  await expect(page.getByText('Dados encontrados na base pública')).toBeVisible();
  await page.getByRole('button', { name: 'Iniciar cadastro' }).click();
  await page.waitForURL(/\/empresas\/[0-9a-f-]+/u);

  const enderecoDaEmpresa = page.url();

  // Pré-preenchimento (§3.3): o campo chega preenchido pela consulta que o
  // servidor faz. O texto exato depende do que a fonte devolver, então o que se
  // prova é que veio preenchido — e que continua editável.
  //
  // O wizard abre na primeira etapa pendente, que varia com o quanto a fonte
  // preencheu: a etapa é aberta pelo stepper antes de tocar nos campos.
  await abrirEtapa(page, 'Identificação');

  const razaoSocial = page.getByRole('textbox', { name: /Razão social/u });

  await expect(razaoSocial).toBeVisible();
  await expect(razaoSocial).not.toHaveValue('');
  await page.getByRole('textbox', { name: /Nome fantasia/u }).fill('Instituto Tecnologia SP');
  await page.getByRole('button', { name: /Salvar e continuar/u }).click();
  await expect(page.getByText('Identificação salva.')).toBeVisible();

  // Sair do fluxo e voltar: o progresso fica salvo e o wizard é retomável.
  await page.goto('/empresas');
  await page.goto(enderecoDaEmpresa);

  await abrirEtapa(page, 'Identificação');

  await expect(page.getByRole('textbox', { name: /Nome fantasia/u })).toHaveValue(
    'Instituto Tecnologia SP',
  );

  // Salvar a identificação avança para a etapa seguinte.
  await page.getByRole('button', { name: /Salvar e continuar/u }).click();
  await expect(page.getByText('Identificação salva.')).toBeVisible();

  // Regime é escolha humana: a fonte não decide entre Presumido e Real (§3.3).
  await abrirEtapa(page, 'Dados fiscais');

  const regime = page.getByRole('combobox', { name: /Regime tributário/u });

  await regime.click();
  await page.getByRole('option', { name: 'Lucro Presumido' }).click();
  await page.getByRole('button', { name: /Salvar e continuar/u }).click();
  await expect(page.getByText('Dados fiscais salvos.')).toBeVisible();

  // Revisão e ativação.
  await abrirEtapa(page, 'Revisão e ativação');

  const ativar = page.getByRole('button', { name: 'Ativar empresa' });

  await expect(ativar).toBeEnabled();
  await ativar.click();

  // Ativada, volta para a lista e é encontrável pelo CNPJ, que é o
  // identificador estável do cadastro.
  await page.waitForURL(/\/empresas(\?|$)/u);
  await page.getByRole('searchbox', { name: /Buscar/u }).fill(CNPJ_NOVO);

  // A asserção de status é na **linha desta empresa**, não na tabela toda: a
  // busca por CNPJ não esvazia a lista de outras empresas ativas do escritório,
  // e `getByRole('cell', { name: 'Ativa' })` casaria com qualquer uma delas.
  const linha = page.getByRole('row').filter({ hasText: CNPJ_FORMATADO });

  await expect(linha.getByRole('cell', { name: CNPJ_FORMATADO })).toBeVisible({
    timeout: 10_000,
  });
  await expect(linha.getByRole('cell', { name: 'Ativa' })).toBeVisible();
});

test('CNPJ já cadastrado no escritório abre o existente e não duplica', async ({ page }) => {
  await entrar(page);

  // A duplicidade é decidida pelo servidor, e o servidor precisa ter a empresa
  // para decidir: o teste cria a sua própria condição em vez de depender do
  // que outro teste deixou para trás.
  const criacao = await page.request.post('/api/proxy/empresas', {
    data: { cnpj: CNPJ_NOVO },
    headers: { 'content-type': 'application/json' },
  });

  expect([201, 200, 409]).toContain(criacao.status());

  const antes = await page.request.get('/api/proxy/empresas?limite=100&deslocamento=0');
  const { total } = (await antes.json()) as { total: number };

  // Sem dublê aqui: o que se prova é a decisão do servidor sobre duplicidade.
  await consultar(page, CNPJ_NOVO);

  await expect(page.getByText('Esta empresa já está neste escritório')).toBeVisible();

  const depois = await page.request.get('/api/proxy/empresas?limite=100&deslocamento=0');

  expect(((await depois.json()) as { total: number }).total).toBe(total);
});

test('falha da fonte externa não impede o cadastro manual', async ({ page }) => {
  await entrar(page);
  await dublarConsulta(page, 'sem_fonte');
  await consultar(page, CNPJ_SEM_FONTE);

  // O aviso é observável e o preenchimento manual continua disponível (§3.3).
  await expect(page.getByText('Dados não validados pela fonte externa')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preencher manualmente' })).toBeEnabled();
});

test('a listagem preserva busca e filtro na URL', async ({ page }) => {
  await entrar(page);
  await page.goto('/empresas?busca=Instituto&status=ATIVA');

  await expect(page.getByRole('searchbox', { name: /Buscar/u })).toHaveValue('Instituto');
  await expect(page.getByRole('combobox', { name: /Situação/u })).toContainText('Ativa');
});
