/**
 * Apoio da prova E2E da SPEC-013 (importação do plano de contas): arquivos de teste, chamadas à API
 * pelo proxy da Web, leitura do banco, da fila (Redis do Compose) e dos contêineres, provas visuais
 * nos dois temas e nos três viewports, e a checagem de acessibilidade com o axe-core.
 *
 * Os CSVs pequenos ficam versionados em `tests/e2e/fixtures/` com os bytes exatos (BOM, CRLF,
 * Latin-1; ver `.gitattributes`). Os grandes (acima de 10 MB e de 10.000 linhas) são gerados na
 * execução, numa pasta temporária, e nunca entram no repositório.
 */
import { expect, type APIResponse, type Locator, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Pool } from 'pg';

// -- Arquivos ------------------------------------------------------------------------------------

export const PASTA_DAS_FIXTURES = resolve('tests/e2e/fixtures');

export type NomeDaFixture =
  | 'plano-bom.csv'
  | 'plano-legado.csv'
  | 'plano-parcial.csv'
  | 'plano-sem-linhas-validas.csv'
  | 'plano-so-cabecalho.csv'
  | 'plano-cabecalho-invalido.csv';

export const caminhoDa = (nome: NomeDaFixture): string => join(PASTA_DAS_FIXTURES, nome);
export const bytesDa = (nome: NomeDaFixture): Buffer => readFileSync(caminhoDa(nome));

/** Mapeamento do modelo do ContaIA: o nome de cada campo é o da própria coluna. */
export const MAPEAMENTO_DO_MODELO = {
  codigo: 'codigo',
  nome: 'nome',
  tipo: 'tipo',
  natureza: 'natureza',
  conta_pai: 'conta_pai',
} as const;

const CABECALHO_DO_MODELO = 'codigo;nome;tipo;natureza;conta_pai';
const LIMITE_EM_BYTES = 10 * 1024 * 1024;
const LIMITE_DE_LINHAS = 10_000;

export type ArquivosGerados = Readonly<{
  pasta: string;
  /** Acima de 10 MB (e com menos de 10.000 linhas): a recusa é pelo tamanho. */
  acimaDoTamanho: string;
  /** 10.001 linhas de dados em poucas centenas de KB: a recusa é pela quantidade. */
  acimaDasLinhas: string;
  /** O modelo bom com uma conta a mais: outro hash, para o conflito concorrente. */
  variante: string;
}>;

export const gerarArquivosGrandes = (): ArquivosGerados => {
  const pasta = mkdtempSync(join(tmpdir(), 'e2e-f13-'));
  const nomeLongo = 'Conta com descricao propositalmente longa '.repeat(30);
  const linhasGrandes: string[] = [CABECALHO_DO_MODELO];
  let bytes = CABECALHO_DO_MODELO.length + 2;

  for (let indice = 1; bytes <= LIMITE_EM_BYTES + 64 * 1024; indice += 1) {
    const linha = `9.${indice};${nomeLongo}${indice};analitica;devedora;`;

    linhasGrandes.push(linha);
    bytes += linha.length + 2;
  }

  const acimaDoTamanho = join(pasta, 'plano-acima-de-10mb.csv');
  writeFileSync(acimaDoTamanho, `${linhasGrandes.join('\r\n')}\r\n`, 'utf8');

  const linhasDemais = [CABECALHO_DO_MODELO, '1;Ativo;sintetica;devedora;'];
  for (let indice = 1; indice < LIMITE_DE_LINHAS + 1; indice += 1) {
    linhasDemais.push(`1.${indice};Conta ${indice};analitica;devedora;1`);
  }
  const acimaDasLinhas = join(pasta, 'plano-10001-linhas.csv');
  writeFileSync(acimaDasLinhas, `${linhasDemais.join('\r\n')}\r\n`, 'utf8');

  const variante = join(pasta, 'plano-variante.csv');
  writeFileSync(
    variante,
    Buffer.concat([bytesDa('plano-bom.csv'), Buffer.from('2.2;Impostos a Recolher;analitica;credora;2\r\n', 'utf8')]),
  );

  return { pasta, acimaDoTamanho, acimaDasLinhas, variante };
};

// -- API pelo proxy da Web -----------------------------------------------------------------------

export type Resposta = Readonly<{ status: number; corpo: unknown; texto: string }>;

const lerResposta = async (resposta: APIResponse): Promise<Resposta> => {
  const texto = await resposta.text();
  let corpo: unknown = null;

  try {
    corpo = JSON.parse(texto) as unknown;
  } catch {
    corpo = null;
  }

  return { status: resposta.status(), corpo, texto };
};

export const pelaApi = async (
  page: Page,
  caminho: string,
  opcoes?: Readonly<{ metodo?: 'GET' | 'POST'; corpo?: unknown; correlationId?: string }>,
): Promise<Resposta> => {
  const cabecalhos: Record<string, string> = { 'x-correlation-id': opcoes?.correlationId ?? randomUUID() };

  if (opcoes?.corpo !== undefined) {
    cabecalhos['content-type'] = 'application/json';
  }

  return lerResposta(
    await page.request.fetch(`/api/proxy${caminho}`, {
      method: opcoes?.metodo ?? 'GET',
      headers: cabecalhos,
      ...(opcoes?.corpo === undefined ? {} : { data: JSON.stringify(opcoes.corpo) }),
    }),
  );
};

/** Envio multipart direto à API (o mesmo corpo que a tela monta), sem passar pela checagem do navegador. */
export const enviarPelaApi = async (
  page: Page,
  empresaId: string,
  arquivo: Readonly<{ nome: string; conteudo: Buffer }>,
  mapeamento: Readonly<Record<string, string>> = MAPEAMENTO_DO_MODELO,
  correlationId: string = randomUUID(),
): Promise<Resposta> =>
  lerResposta(
    await page.request.post(`/api/proxy/empresas/${empresaId}/plano-contas/importacoes`, {
      headers: { 'x-correlation-id': correlationId },
      multipart: {
        arquivo: { name: arquivo.nome, mimeType: 'text/csv', buffer: arquivo.conteudo },
        mapeamento: JSON.stringify(mapeamento),
      },
      timeout: 60_000,
    }),
  );

/** `code` de um problem+json, ou `null` quando o corpo não é um. */
export const codigoDo = (resposta: Resposta): string | null => {
  const corpo = resposta.corpo;

  return typeof corpo === 'object' && corpo !== null && 'code' in corpo && typeof corpo.code === 'string'
    ? corpo.code
    : null;
};

export const campoDe = (corpo: unknown, campo: string): unknown =>
  typeof corpo === 'object' && corpo !== null && campo in corpo ? (corpo as Record<string, unknown>)[campo] : undefined;

// -- Banco ---------------------------------------------------------------------------------------

export type Conta = Readonly<{
  codigo: string;
  nome: string;
  tipo: string;
  natureza: string;
  conta_pai: string | null;
  arquivada: boolean;
  versao: string;
  atualizado_em: string;
}>;

export const contasDa = async (pool: Pool, empresaId: string): Promise<Map<string, Conta>> => {
  const { rows } = await pool.query<Conta>(
    `select codigo, nome, tipo, natureza, conta_pai, arquivada, versao::text as versao,
            atualizado_em::text as atualizado_em
       from app.conta_contabil where empresa_id = $1 order by codigo`,
    [empresaId],
  );

  return new Map(rows.map((conta) => [conta.codigo, conta]));
};

export type Tentativa = Readonly<{
  id: string;
  estado: string;
  correlation_id: string;
  totais: Readonly<{ lidas: number; novas: number; atualizadas: number; rejeitadas: number }> | null;
  usuario_iniciador_id: string;
  usuario_confirmador_id: string | null;
  usuario_cancelador_id: string | null;
  reutilizada_por_idempotencia: boolean;
  finalizado_em: string | null;
  arquivo_chave: string;
}>;

export const tentativasDa = async (pool: Pool, empresaId: string): Promise<Tentativa[]> =>
  (
    await pool.query<Tentativa>(
      `select id, estado, correlation_id, totais, usuario_iniciador_id, usuario_confirmador_id,
              usuario_cancelador_id, reutilizada_por_idempotencia, finalizado_em::text as finalizado_em,
              arquivo_chave
         from app.importacao_plano_contas where empresa_id = $1 order by sequencia`,
      [empresaId],
    )
  ).rows;

export const tentativa = async (pool: Pool, tentativaId: string): Promise<Tentativa | undefined> =>
  (
    await pool.query<Tentativa>(
      `select id, estado, correlation_id, totais, usuario_iniciador_id, usuario_confirmador_id,
              usuario_cancelador_id, reutilizada_por_idempotencia, finalizado_em::text as finalizado_em,
              arquivo_chave
         from app.importacao_plano_contas where id = $1`,
      [tentativaId],
    )
  ).rows[0];

export type Evento = Readonly<{ acao: string; estado_novo: string; codigo: string | null; correlation_id: string }>;

export const eventosDa = async (pool: Pool, tentativaId: string): Promise<Evento[]> =>
  (
    await pool.query<Evento>(
      `select acao, estado_novo, codigo, correlation_id
         from app.importacao_plano_contas_evento where tentativa_id = $1 order by sequencia`,
      [tentativaId],
    )
  ).rows;

export const destinatariosDaNotificacao = async (pool: Pool, tentativaId: string): Promise<string[]> =>
  (
    await pool.query<{ usuario_id: string }>(
      `select usuario_id from app.importacao_plano_contas_notificacao where tentativa_id = $1 order by sequencia`,
      [tentativaId],
    )
  ).rows.map((linha) => linha.usuario_id);

export const notificacoesDoUsuario = async (pool: Pool, usuarioId: string): Promise<number> =>
  Number(
    (
      await pool.query<{ total: string }>(
        `select count(*) as total from app.importacao_plano_contas_notificacao where usuario_id = $1`,
        [usuarioId],
      )
    ).rows[0]?.total ?? 0,
  );

export const pendenciaDoPlano = async (pool: Pool, empresaId: string): Promise<string[]> =>
  (
    await pool.query<{ estado: string }>(
      `select estado from app.empresa_pendencia
        where empresa_id = $1 and origem = 'PLANO_CONTAS' order by criado_em`,
      [empresaId],
    )
  ).rows.map((linha) => linha.estado);

export const esperarEstado = async (pool: Pool, tentativaId: string, estado: string, timeout = 90_000): Promise<void> => {
  await expect
    .poll(async () => (await tentativa(pool, tentativaId))?.estado, { timeout, intervals: [500, 1_000] })
    .toBe(estado);
};

// -- Fila de validação (BullMQ) ------------------------------------------------------------------

/** O BullMQ da árvore dos workers: a prova usa a mesma biblioteca e a mesma fila do produto. */
const doWorkers = createRequire(resolve('apps/workers/package.json'));

type FilaDoBullmq = Readonly<{ pause: () => Promise<void>; resume: () => Promise<void>; close: () => Promise<void> }>;
type ConstrutorDaFila = new (nome: string, opcoes: Readonly<{ connection: Readonly<{ host: string; port: number }> }>) => FilaDoBullmq;

const comAFilaDeValidacao = async (acao: (fila: FilaDoBullmq) => Promise<void>): Promise<void> => {
  const { Queue } = doWorkers('bullmq') as { Queue: ConstrutorDaFila };
  const endereco = new URL(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:16379');
  const fila = new Queue('plano-contas-validacao', {
    connection: { host: endereco.hostname, port: Number(endereco.port || '6379') },
  });

  try {
    await acao(fila);
  } finally {
    await fila.close();
  }
};

/**
 * Sem consumidor para a validação do plano: a fila fica pausada (só ela; os consumidores do Signer
 * e o monitor seguem), e o job espera como se o worker estivesse fora do ar.
 */
export const pausarAValidacao = (): Promise<void> => comAFilaDeValidacao((fila) => fila.pause());
export const retomarAValidacao = (): Promise<void> => comAFilaDeValidacao((fila) => fila.resume());

// -- Docker (fila, contêineres e logs) -----------------------------------------------------------

export const PROJETO = process.env['COMPOSE_PROJECT_NAME'] ?? 'contaia';
export const nomeDoContainer = (servico: string): string => `${PROJETO}-${servico}`;

export const docker = (...argumentos: string[]): string =>
  execFileSync('docker', argumentos, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });

export const logsDe = (servico: string): string => {
  const { stdout, stderr } = spawnSync('docker', ['logs', nomeDoContainer(servico)], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  return `${stdout}\n${stderr}`;
};

/** Espera o healthcheck do Compose: o MinIO e os workers voltam saudáveis antes do próximo passo. */
export const esperarSaudavel = async (servico: string, timeout = 120_000): Promise<void> => {
  await expect
    .poll(
      () => {
        try {
          return docker('inspect', '--format', '{{.State.Health.Status}}', nomeDoContainer(servico)).trim();
        } catch {
          return 'indisponivel';
        }
      },
      { timeout, intervals: [1_000] },
    )
    .toBe('healthy');
};

/** `redis-cli` dentro do contêiner do Redis do Compose (a fila do BullMQ, prefixo padrão `bull`). */
export const redis = (...argumentos: string[]): string =>
  docker('exec', nomeDoContainer('redis'), 'redis-cli', '--raw', ...argumentos).trim();

const comoJson = (saida: string): unknown => {
  if (saida === '') {
    return null;
  }

  try {
    return JSON.parse(saida) as unknown;
  } catch {
    return null;
  }
};

/** Dados do job de validação da tentativa (id determinístico `validacao-<tentativaId>`). */
export const dadosDoJob = (tentativaId: string): unknown =>
  comoJson(redis('HGET', `bull:plano-contas-validacao:validacao-${tentativaId}`, 'data'));

/** Chaves auxiliares do BullMQ: não são jobs. */
const CHAVE_DE_CONTROLE = /:(meta|id|events|wait|completed|failed|active|paused|delayed|prioritized|marker|stalled-check|limiter|pc|logs)$/u;

/** Jobs da fila morta (esgotados) cujos dados citam a tentativa. */
export const jobsMortosDa = (tentativaId: string): unknown[] =>
  redis('--scan', '--pattern', 'bull:plano-contas-validacao-morta:*')
    .split('\n')
    .map((chave) => chave.trim())
    .filter((chave) => chave !== '' && !CHAVE_DE_CONTROLE.test(chave))
    .map((chave) => {
      try {
        return redis('TYPE', chave) === 'hash' ? comoJson(redis('HGET', chave, 'data')) : null;
      } catch {
        return null;
      }
    })
    .filter((dados) => dados !== null && JSON.stringify(dados).includes(tentativaId));

// -- Tela ----------------------------------------------------------------------------------------

export const abrirAba = async (page: Page, empresaId: string, consulta = ''): Promise<void> => {
  await page.goto(`/empresas/${empresaId}?aba=plano-contas${consulta}`);
  await expect(page.getByRole('heading', { level: 2, name: 'Plano de contas' })).toBeVisible({ timeout: 30_000 });
};

/** O Select do Radix: abre o combobox e escolhe a coluna pelo nome exato. */
export const escolherColuna = async (page: Page, campo: RegExp, coluna: string): Promise<void> => {
  await page.getByRole('combobox', { name: campo }).click();
  await page.getByRole('option', { name: coluna, exact: true }).click();
  await expect(page.getByRole('combobox', { name: campo })).toContainText(coluna);
};

/** Número de um dos totais da prévia (`Linhas lidas`, `Novas`, `Atualizadas`, `Rejeitadas`). */
export const totalNaTela = (page: Page, rotulo: string): Locator =>
  page.locator('dl div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${rotulo}$`, 'u') }) }).locator('dd');

/**
 * Seleciona o CSV, valida com o mapeamento da tela e devolve o id da tentativa e o `x-correlation-id`
 * que a tela mandou no envio (é o que a API grava na tentativa, na fila e nos eventos).
 */
export const validarPelaTela = async (page: Page): Promise<Readonly<{ tentativaId: string; correlationId: string }>> => {
  const [requisicao] = await Promise.all([
    page.waitForRequest(
      (pedido) => pedido.method() === 'POST' && /\/plano-contas\/importacoes$/u.test(new URL(pedido.url()).pathname),
    ),
    page.getByRole('button', { name: 'Validar arquivo' }).click(),
  ]);
  const resposta = await requisicao.response();

  expect(resposta?.status(), 'envio aceito para validação').toBe(202);
  await page.waitForURL(/[?&]tentativa=/u);

  return {
    tentativaId: new URL(page.url()).searchParams.get('tentativa') ?? '',
    correlationId: requisicao.headers()['x-correlation-id'] ?? '',
  };
};

export const confirmarPelaTela = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirmar importação' }).click();
};

/** Texto do `main` para explicar uma falha sem captura automática. */
export const textoDaTela = async (page: Page): Promise<string> =>
  (await page.locator('main').innerText().catch(() => '')).replace(/\s+/gu, ' ').slice(0, 1_500);

/** Baixa pelo botão da tela (fetch → blob → âncora) e devolve os bytes do arquivo. */
export const baixarPeloBotao = async (page: Page, rotulo: string): Promise<Readonly<{ nome: string; bytes: Buffer }>> => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: rotulo }).first().click(),
  ]);
  const caminho = await download.path();

  return { nome: download.suggestedFilename(), bytes: readFileSync(caminho) };
};

// -- Provas visuais e acessibilidade -------------------------------------------------------------

/** axe-core da árvore do workspace (dependência do `jest-axe` da Web), injetado na página. */
const FONTE_DO_AXE = (() => {
  const daWeb = createRequire(resolve('apps/web/package.json'));
  const doJestAxe = createRequire(daWeb.resolve('jest-axe'));

  return readFileSync(doJestAxe.resolve('axe-core/axe.min.js'), 'utf8');
})();

export type Violacao = Readonly<{ id: string; impacto: string | null; alvos: string[] }>;

type ResultadoDoAxe = { violations: Array<{ id: string; impact?: string | null; nodes: Array<{ target: unknown[] }> }> };
type JanelaComAxe = Window & { axe?: { run: (contexto: Document, opcoes: unknown) => Promise<ResultadoDoAxe> } };

export const violacoesDeAcessibilidade = async (page: Page): Promise<Violacao[]> => {
  await page.addScriptTag({ content: FONTE_DO_AXE });

  return page.evaluate(async () => {
    const axe = (window as JanelaComAxe).axe;

    if (axe === undefined) {
      throw new Error('axe-core não carregou na página');
    }

    const resultado = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });

    return resultado.violations.map((violacao) => ({
      id: violacao.id,
      impacto: violacao.impact ?? null,
      alvos: violacao.nodes.slice(0, 5).map((no) => JSON.stringify(no.target)),
    }));
  });
};

const TEMAS = [
  ['claro', 'light'],
  ['escuro', 'dark'],
] as const;
const LARGURAS = [768, 1024, 1440] as const;

export type OpcoesDaProva = Readonly<{
  /** O que precisa estar na tela para a captura valer. */
  pronto: (page: Page) => Locator;
  /**
   * Estado guardado na URL: recarrega a cada tema/largura (o tema entra pelo `localStorage`, como o
   * produto o lê). Sem URL (arquivo escolhido, etapa logo após a ativação): o tema é trocado no
   * `data-theme` da página aberta, sem recarregar e perder o estado.
   */
  recarregar: boolean;
  /** Refaz o estado depois de recarregar (ex.: a confirmação que devolve o 409). */
  preparar?: (page: Page) => Promise<void>;
  /** Captura só esta região (ex.: a tabela de rejeições), em vez da página inteira. */
  recorte?: (page: Page) => Locator;
}>;

/**
 * Captura `<estado>-<tema>-<largura>.png` em `test-results/<escopo>/e2e/provas/` nos dois temas e
 * nas três larguras, confere que não há rolagem horizontal e roda o axe uma vez por tema. Devolve
 * as violações encontradas (a prova as afirma vazias com `expect.soft`, para não esconder capturas).
 */
export const provarVisualmente = async (
  page: Page,
  pasta: string,
  estado: string,
  opcoes: OpcoesDaProva,
): Promise<Record<string, Violacao[]>> => {
  mkdirSync(pasta, { recursive: true });
  const violacoes: Record<string, Violacao[]> = {};

  for (const [tema, valor] of TEMAS) {
    await page.evaluate((escolhido) => localStorage.setItem('contaia-theme', escolhido), valor);

    for (const largura of LARGURAS) {
      await page.setViewportSize({ width: largura, height: 900 });

      if (opcoes.recarregar) {
        await page.reload();
        await opcoes.preparar?.(page);
      } else {
        await page.evaluate((escolhido) => document.documentElement.setAttribute('data-theme', escolhido), valor);
      }

      await expect(page.locator('html')).toHaveAttribute('data-theme', valor);
      await expect(opcoes.pronto(page).first()).toBeVisible({ timeout: 30_000 });
      // Sem animação em curso na captura (spinner, transição de opacidade).
      await page.evaluate(() => document.fonts.ready);
      const arquivo = join(pasta, `${estado}-${tema}-${largura}.png`);

      if (opcoes.recorte === undefined) {
        await page.screenshot({ path: arquivo, fullPage: true, animations: 'disabled' });
      } else {
        await opcoes.recorte(page).first().screenshot({ path: arquivo, animations: 'disabled' });
      }

      expect
        .soft(
          await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
          `rolagem horizontal em ${estado} ${tema} ${largura}px`,
        )
        .toBe(false);

      if (largura === 1024) {
        violacoes[tema] = await violacoesDeAcessibilidade(page);
      }
    }
  }

  await page.evaluate(() => localStorage.setItem('contaia-theme', 'light'));
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.setViewportSize({ width: 1280, height: 900 });

  return violacoes;
};
