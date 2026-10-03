import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import forge from 'node-forge';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CargaDoTicket } from '@contaia/shared';
import {
  CNPJ_PADRAO_DE_TESTE,
  criarPki,
  emitirPfx,
  gerarConjuntoDeTeste,
  raizConfiavelEmPem,
} from '../../../scripts/gerar-pki-de-teste.mjs';
import type { ClienteDaApi, RespostaDaApi } from './api.js';
import type { RegistroDeLog } from './ingestao.js';
import { criarServidorDoCofre } from './server.js';
import { assinarTicket } from './ticket.js';
import { ErroDoVault, type ClienteDoVault, type EscopoDoSegredo } from './vault.js';

const TICKET_SECRET = 'segredo-do-ticket-de-teste-com-32-bytes!';
const SERVICE_TOKEN = 'token-de-servico-de-teste-com-32-bytes!!';
const ADMIN_TOKEN = 'token-admin-de-teste-com-mais-de-32-bytes!!';
const ORIGEM = 'http://web.local:15100';
const SENTINELA_SENHA = 'SENTINELA-SENHA-7c1e9';
const AGORA = new Date();

const TENANT = '11111111-1111-4111-8111-111111111111';
const EMPRESA = '22222222-2222-4222-8222-222222222222';

type Pfx = { pfx: Buffer; senha: string };

const pki = criarPki({ agora: AGORA });
const conjunto = gerarConjuntoDeTeste(pki, { cnpj: CNPJ_PADRAO_DE_TESTE }) as Record<string, Pfx>;
const pfxComSentinela = emitirPfx(pki, { senha: SENTINELA_SENHA }) as Pfx;
const raizes = [forge.pki.certificateFromPem(raizConfiavelEmPem(pki) as string)];
const TRECHO_DO_PFX = pfxComSentinela.pfx.toString('base64').slice(100, 160);

const respostaDeSucesso = { ok: true, corpo: { certificado: { id: 'cert-1', versao: 1 } } } as unknown as RespostaDaApi;

class VaultFalso implements ClienteDoVault {
  gravacoes: { escopo: EscopoDoSegredo; senha: string }[] = [];
  destruicoes: EscopoDoSegredo[] = [];
  inutilizacoes: EscopoDoSegredo[] = [];
  restauracoes: EscopoDoSegredo[] = [];
  falharGravacao = false;
  falharDestruicao = false;
  falharInutilizacao = false;
  estaPronto = true;

  async gravar(escopo: EscopoDoSegredo, dados: { senha: string }): Promise<number> {
    if (this.falharGravacao) throw new ErroDoVault('INDISPONIVEL', 503);
    this.gravacoes.push({ escopo, senha: dados.senha });
    return 1;
  }
  async destruir(escopo: EscopoDoSegredo): Promise<void> {
    if (this.falharDestruicao) throw new ErroDoVault('INDISPONIVEL', 503);
    this.destruicoes.push(escopo);
  }
  async inutilizar(escopo: EscopoDoSegredo): Promise<void> {
    if (this.falharInutilizacao) throw new ErroDoVault('INDISPONIVEL', 503);
    this.inutilizacoes.push(escopo);
  }
  async restaurar(escopo: EscopoDoSegredo): Promise<void> {
    this.restauracoes.push(escopo);
  }
  async pronto(): Promise<boolean> {
    return this.estaPronto;
  }
}

const AMBIGUO_REDE: RespostaDaApi = { ok: false, definitiva: false, status: null };
const AMBIGUO_500: RespostaDaApi = { ok: false, definitiva: false, status: 500 };
const recusaDa = (codigo: string, status = 422, titulo: string | null = null): RespostaDaApi => ({
  ok: false,
  definitiva: true,
  status,
  codigo,
  titulo,
  detalhe: titulo,
});

class ApiFalsa implements ClienteDaApi {
  ativacoes: { referenciaDoSegredo: string; ticket: string; cnpjsDoTitular: unknown }[] = [];
  recusas: string[] = [];
  /** Uma resposta por tentativa; a última se repete. */
  sequencia: RespostaDaApi[] = [respostaDeSucesso];
  /** Se definido, a ativação espera este portão (para segurar a ingestão em andamento). */
  portao: Promise<void> | null = null;

  async ativar(pedido: { referenciaDoSegredo: string; ticket: string; metadados: object }): Promise<RespostaDaApi> {
    this.ativacoes.push({
      referenciaDoSegredo: pedido.referenciaDoSegredo,
      ticket: pedido.ticket,
      cnpjsDoTitular: (pedido.metadados as { cnpjsDoTitular?: unknown }).cnpjsDoTitular,
    });
    if (this.portao) await this.portao;
    const indice = Math.min(this.ativacoes.length - 1, this.sequencia.length - 1);
    return this.sequencia[indice] ?? respostaDeSucesso;
  }
  async recusar(pedido: { codigo: string }): Promise<boolean> {
    this.recusas.push(pedido.codigo);
    return true;
  }
}

let vault: VaultFalso;
let api: ApiFalsa;
let logs: RegistroDeLog[];
let base: string;
let servidor: ReturnType<typeof criarServidorDoCofre>;
let sequencia = 0;

const ticket = (alteracoes: Partial<CargaDoTicket> = {}): string =>
  assinarTicket(
    {
      jti: `jti-${++sequencia}-${randomUUID()}`,
      tenantId: TENANT,
      empresaId: EMPRESA,
      usuarioId: 'usuario-1',
      cnpjDaEmpresa: CNPJ_PADRAO_DE_TESTE,
      responsavelId: 'responsavel-1',
      operacao: 'CADASTRO',
      correlationId: `corr-${sequencia}`,
      exp: Math.floor(Date.now() / 1000) + 300,
      ...alteracoes,
    },
    TICKET_SECRET,
  );

type Envio = {
  ticket?: string | undefined;
  senha?: string | undefined;
  arquivo?: Buffer | undefined;
  nome?: string;
  origem?: string;
};

const enviar = (envio: Envio): Promise<Response> => {
  const form = new FormData();
  if (envio.ticket !== undefined) form.append('ticket', envio.ticket);
  if (envio.senha !== undefined) form.append('senha', envio.senha);
  if (envio.arquivo !== undefined) form.append('arquivo', new Blob([new Uint8Array(envio.arquivo)]), envio.nome ?? 'certificado.pfx');
  return fetch(`${base}/ingestao`, {
    method: 'POST',
    body: form,
    headers: envio.origem ? { origin: envio.origem } : {},
  });
};

const enviarPfx = (nome: string, extra: Partial<Envio> = {}): Promise<Response> => {
  const { pfx, senha } = conjunto[nome]!;
  return enviar({ ticket: ticket(), senha, arquivo: pfx, ...extra });
};

beforeAll(async () => {
  servidor = criarServidorDoCofre({
    get vault() {
      return vault;
    },
    get api() {
      return api;
    },
    raizes,
    ticketSecret: TICKET_SECRET,
    adminToken: ADMIN_TOKEN,
    esperar: async () => {},
    maxIngestoesSimultaneas: 2,
    origensPermitidas: [ORIGEM],
    log: (registro) => logs.push(registro),
  });
  await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolver) => servidor.close(resolver));
});

beforeEach(() => {
  vault = new VaultFalso();
  api = new ApiFalsa();
  logs = [];
});

describe('POST /ingestao — caminho feliz', () => {
  it('valida, grava no Vault, pede ativação à API e devolve só o que a API devolveu', async () => {
    const resposta = await enviarPfx('valido-e-cnpj-a1');

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ certificado: { id: 'cert-1', versao: 1 } });
    expect(vault.gravacoes).toHaveLength(1);
    expect(vault.gravacoes[0]?.escopo).toMatchObject({ tenantId: TENANT, empresaId: EMPRESA });
    expect(api.ativacoes).toHaveLength(1);
    expect(api.ativacoes[0]?.referenciaDoSegredo).toBe(vault.gravacoes[0]?.escopo.referencia);
    expect(api.recusas).toEqual([]);
    expect(vault.destruicoes).toEqual([]);
  });

  it('aceita .p12 em maiúsculas', async () => {
    expect((await enviarPfx('valido-e-cnpj-a1', { nome: 'MEU.P12' })).status).toBe(200);
  });
});

describe('POST /ingestao — ticket', () => {
  it('sem ticket, com assinatura errada ou expirado: 401 e nada é gravado', async () => {
    const { pfx, senha } = conjunto['valido-e-cnpj-a1']!;
    const adulterado = `${ticket().split('.')[0]}.${Buffer.alloc(32).toString('base64url')}`;
    const expirado = ticket({ exp: Math.floor(Date.now() / 1000) - 1 });

    for (const t of [undefined, 'lixo', adulterado, expirado]) {
      const resposta = await enviar({ ticket: t, senha, arquivo: pfx });
      expect(resposta.status).toBe(401);
      expect((await resposta.json()).code).toBe('CERTIFICADO_TICKET_INVALIDO');
    }
    expect(vault.gravacoes).toEqual([]);
    expect(api.ativacoes).toEqual([]);
    expect(api.recusas).toEqual([]);
  });

  it('replay do mesmo ticket é recusado, inclusive depois de sucesso', async () => {
    const { pfx, senha } = conjunto['valido-e-cnpj-a1']!;
    const t = ticket();

    expect((await enviar({ ticket: t, senha, arquivo: pfx })).status).toBe(200);
    const segunda = await enviar({ ticket: t, senha, arquivo: pfx });

    expect(segunda.status).toBe(401);
    expect(vault.gravacoes).toHaveLength(1);
  });

  it('a primeira tentativa consome o jti mesmo falhando (nova tentativa exige novo ticket)', async () => {
    const { pfx, senha } = conjunto['valido-e-cnpj-a1']!;
    const t = ticket();

    expect((await enviar({ ticket: t, senha: 'errada', arquivo: pfx })).status).toBe(400);
    expect((await enviar({ ticket: t, senha, arquivo: pfx })).status).toBe(401);
    expect(vault.gravacoes).toEqual([]);
  });

  it('o correlationId do ticket volta no problem+json e no cabeçalho', async () => {
    const resposta = await enviarPfx('invalido-a3');
    const corpo = await resposta.json();

    expect(corpo.correlationId).toMatch(/^corr-\d+$/);
    expect(resposta.headers.get('x-correlation-id')).toBe(corpo.correlationId);
  });
});

describe('POST /ingestao — recusas de formato', () => {
  const cenarios: [string, () => Promise<Response>, number, string][] = [
    ['extensão errada', () => enviarPfx('valido-e-cnpj-a1', { nome: 'certificado.txt' }), 400, 'CERTIFICADO_EXTENSAO_INVALIDA'],
    ['sem extensão', () => enviarPfx('valido-e-cnpj-a1', { nome: 'certificado' }), 400, 'CERTIFICADO_EXTENSAO_INVALIDA'],
    ['arquivo vazio', () => enviar({ ticket: ticket(), senha: 'x', arquivo: Buffer.alloc(0) }), 400, 'CERTIFICADO_ARQUIVO_VAZIO'],
    ['sem o campo arquivo', () => enviar({ ticket: ticket(), senha: 'x' }), 400, 'CERTIFICADO_ARQUIVO_VAZIO'],
    ['senha errada', () => enviarPfx('valido-e-cnpj-a1', { senha: 'errada' }), 400, 'CERTIFICADO_SENHA_INCORRETA'],
    ['senha vazia', () => enviarPfx('valido-e-cnpj-a1', { senha: '' }), 400, 'CERTIFICADO_SENHA_INCORRETA'],
    ['sem o campo senha', () => enviarPfx('valido-e-cnpj-a1', { senha: undefined }), 400, 'CERTIFICADO_SENHA_INCORRETA'],
    ['contêiner corrompido', () => enviarPfx('invalido-corrompido'), 400, 'CERTIFICADO_CONTEINER_INVALIDO'],
    [
      'bytes que não são PKCS#12',
      () => enviar({ ticket: ticket(), senha: 'x', arquivo: Buffer.from('conteúdo qualquer') }),
      400,
      'CERTIFICADO_CONTEINER_INVALIDO',
    ],
  ];

  it.each(cenarios)('%s', async (_nome, acao, status, codigo) => {
    const resposta = await acao();
    const corpo = await resposta.json();

    expect(resposta.status).toBe(status);
    expect(resposta.headers.get('content-type')).toContain('application/problem+json');
    expect(corpo).toMatchObject({ code: codigo, status, type: `https://contaia.local/erros/${codigo}` });
    expect(corpo.title).toBeTruthy();
    expect(corpo.correlationId).toBeTruthy();
    expect(api.recusas).toEqual([codigo]);
    expect(vault.gravacoes).toEqual([]);
    expect(api.ativacoes).toEqual([]);
  });

  it('arquivo de 10 MB + 1 byte: 413 e a recusa chega à API', async () => {
    const excedente = Buffer.alloc(10 * 1024 * 1024 + 1, 7);

    const resposta = await enviar({ ticket: ticket(), senha: 'x', arquivo: excedente });

    expect(resposta.status).toBe(413);
    expect((await resposta.json()).code).toBe('CERTIFICADO_TAMANHO_EXCEDIDO');
    expect(api.recusas).toEqual(['CERTIFICADO_TAMANHO_EXCEDIDO']);
    expect(vault.gravacoes).toEqual([]);
  });

  it('corpo muito acima do limite é cortado cedo, com 413', async () => {
    const gigante = Buffer.alloc(12 * 1024 * 1024, 7);

    const resposta = await enviar({ ticket: ticket(), senha: 'x', arquivo: gigante });

    expect(resposta.status).toBe(413);
    expect((await resposta.json()).code).toBe('CERTIFICADO_TAMANHO_EXCEDIDO');
    expect(vault.gravacoes).toEqual([]);
  });

  it('requisição que não é multipart: 400', async () => {
    const resposta = await fetch(`${base}/ingestao`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(resposta.status).toBe(400);
    expect((await resposta.json()).code).toBe('REQUISICAO_INVALIDA');
  });
});

describe('POST /ingestao — cada recusa do domínio, com PFX reais gerados em runtime', () => {
  it.each([
    ['invalido-a3', 422, 'CERTIFICADO_TIPO_INCOMPATIVEL'],
    ['invalido-e-cpf', 422, 'CERTIFICADO_TIPO_INCOMPATIVEL'],
    ['invalido-cadeia-desconhecida', 422, 'CERTIFICADO_TIPO_INCOMPATIVEL'],
    ['invalido-sem-chave-privada', 422, 'CERTIFICADO_TIPO_INCOMPATIVEL'],
    ['invalido-titular-e-autoridade', 422, 'CERTIFICADO_TIPO_INCOMPATIVEL'],
    ['invalido-cnpj-diferente', 422, 'CERTIFICADO_CNPJ_DIVERGENTE'],
    ['invalido-expirado', 422, 'CERTIFICADO_EXPIRADO'],
    ['invalido-ainda-nao-vigente', 422, 'CERTIFICADO_AINDA_NAO_VIGENTE'],
  ])('%s → %i %s', async (nome, status, codigo) => {
    const resposta = await enviarPfx(nome);

    expect(resposta.status).toBe(status);
    expect((await resposta.json()).code).toBe(codigo);
    expect(api.recusas).toEqual([codigo]);
    expect(vault.gravacoes).toEqual([]);
    expect(api.ativacoes).toEqual([]);
  });

  it('o CNPJ comparado é o do ticket, não o do formulário', async () => {
    const resposta = await enviarPfx('valido-e-cnpj-a1', {
      ticket: ticket({ cnpjDaEmpresa: '45723174000110' }),
    });

    expect((await resposta.json()).code).toBe('CERTIFICADO_CNPJ_DIVERGENTE');
  });
});

describe('POST /ingestao — falhas do Vault e da API (compensação)', () => {
  it('Vault indisponível na gravação: 503 COFRE_INDISPONIVEL, a API não é chamada para ativar', async () => {
    vault.falharGravacao = true;

    const resposta = await enviarPfx('valido-e-cnpj-a1');

    expect(resposta.status).toBe(503);
    expect((await resposta.json()).code).toBe('COFRE_INDISPONIVEL');
    expect(api.ativacoes).toEqual([]);
    expect(api.recusas).toEqual(['COFRE_INDISPONIVEL']);
  });

  it('API recusa de forma DEFINITIVA (4xx com problem+json): destroy da mesma referência', async () => {
    api.sequencia = [recusaDa('CERTIFICADO_RESPONSAVEL_INVALIDO')];

    const resposta = await enviarPfx('valido-e-cnpj-a1');

    expect(resposta.status).toBe(422);
    expect((await resposta.json()).code).toBe('CERTIFICADO_RESPONSAVEL_INVALIDO');
    expect(vault.destruicoes).toEqual([vault.gravacoes[0]?.escopo]);
    expect(vault.inutilizacoes).toEqual([]);
    expect(api.ativacoes).toHaveLength(1);
  });

  it.each([
    ['timeout/erro de rede', AMBIGUO_REDE],
    ['HTTP 500', AMBIGUO_500],
  ])('desfecho AMBÍGUO (%s): tenta 3 vezes com o mesmo ticket e referência e NÃO destrói o segredo', async (_nome, ambiguo) => {
    api.sequencia = [ambiguo];

    const resposta = await enviarPfx('valido-e-cnpj-a1');
    const corpo = await resposta.json();

    expect(resposta.status).toBe(503);
    expect(corpo.code).toBe('COFRE_INDISPONIVEL');
    expect(api.ativacoes).toHaveLength(3);
    expect(new Set(api.ativacoes.map((a) => a.ticket)).size).toBe(1);
    expect(new Set(api.ativacoes.map((a) => a.referenciaDoSegredo))).toEqual(
      new Set([vault.gravacoes[0]?.escopo.referencia]),
    );
    expect(vault.destruicoes).toEqual([]);
    expect(vault.inutilizacoes).toEqual([]);
    const registro = logs.find((l) => l['evento'] === 'ativacao_ambigua');
    expect(registro).toMatchObject({
      correlationId: corpo.correlationId,
      referencia: vault.gravacoes[0]?.escopo.referencia,
    });
    expect(JSON.stringify(registro)).not.toContain('senha');
  });

  it('retry que acaba em 200 devolve sucesso e não destrói nada', async () => {
    api.sequencia = [AMBIGUO_REDE, AMBIGUO_500, respostaDeSucesso];

    const resposta = await enviarPfx('valido-e-cnpj-a1');

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ certificado: { id: 'cert-1', versao: 1 } });
    expect(api.ativacoes).toHaveLength(3);
    expect(vault.destruicoes).toEqual([]);
  });

  it('ambíguo seguido de recusa definitiva: aí sim compensa', async () => {
    api.sequencia = [AMBIGUO_REDE, recusaDa('CERTIFICADO_RESPONSAVEL_INVALIDO')];

    const resposta = await enviarPfx('valido-e-cnpj-a1');

    expect(resposta.status).toBe(422);
    expect(api.ativacoes).toHaveLength(2);
    expect(vault.destruicoes).toHaveLength(1);
  });

  it('espera entre as tentativas (backoff curto e crescente)', async () => {
    const esperas: number[] = [];
    const { criarServidorDoCofre } = await import('./server.js');
    const outro = criarServidorDoCofre({
      vault,
      api,
      raizes,
      ticketSecret: TICKET_SECRET,
      adminToken: ADMIN_TOKEN,
      origensPermitidas: [],
      log: () => {},
      esperar: async (ms) => void esperas.push(ms),
    });
    await new Promise<void>((resolver) => outro.listen(0, '127.0.0.1', resolver));
    api.sequencia = [AMBIGUO_REDE];

    try {
      const f = new FormData();
      f.append('ticket', ticket());
      f.append('senha', conjunto['valido-e-cnpj-a1']!.senha);
      f.append('arquivo', new Blob([new Uint8Array(conjunto['valido-e-cnpj-a1']!.pfx)]), 'c.pfx');
      await fetch(`http://127.0.0.1:${(outro.address() as AddressInfo).port}/ingestao`, { method: 'POST', body: f });
    } finally {
      await new Promise((resolver) => outro.close(resolver));
    }

    expect(esperas).toEqual([250, 750]);
  });

  it.each([
    ['CERTIFICADO_JA_VIGENTE', 409],
    ['CERTIFICADO_VIGENTE_INEXISTENTE', 409],
    ['EMPRESA_ARQUIVADA', 409],
    ['EMPRESA_NAO_ATIVA', 409],
    ['SEM_AUTORIZACAO', 403],
    ['CONFLITO_DE_VERSAO', 409],
  ])('código da API %s é repassado com status %i e o título dela (e o segredo é compensado)', async (codigo, status) => {
    api.sequencia = [recusaDa(codigo, status, `Título da API para ${codigo}`)];

    const resposta = await enviarPfx('valido-e-cnpj-a1');
    const corpo = await resposta.json();

    expect(resposta.status).toBe(status);
    expect(resposta.headers.get('content-type')).toContain('application/problem+json');
    expect(corpo).toMatchObject({
      code: codigo,
      status,
      title: `Título da API para ${codigo}`,
      type: `https://contaia.local/erros/${codigo}`,
    });
    expect(corpo.correlationId).toBeTruthy();
    expect(vault.destruicoes).toHaveLength(1);
  });

  it('código definitivo desconhecido da API vira COFRE_INDISPONIVEL (nada de ecoar texto alheio), com compensação', async () => {
    api.sequencia = [recusaDa('ALGO_QUE_O_COFRE_NAO_CONHECE', 409, 'texto alheio')];

    const resposta = await enviarPfx('valido-e-cnpj-a1');
    const corpo = await resposta.json();

    expect(corpo.code).toBe('COFRE_INDISPONIVEL');
    expect(JSON.stringify(corpo)).not.toContain('texto alheio');
    expect(vault.destruicoes).toHaveLength(1);
  });

  it('destroy falha numa recusa definitiva: cai no delete reversível e registra compensação parcial', async () => {
    api.sequencia = [recusaDa('CERTIFICADO_RESPONSAVEL_INVALIDO')];
    vault.falharDestruicao = true;

    await enviarPfx('valido-e-cnpj-a1');

    expect(vault.inutilizacoes).toHaveLength(1);
    expect(logs.some((l) => l['evento'] === 'compensacao_parcial')).toBe(true);
  });

  it('destroy e delete falham: erro registrado com a referência opaca, sem segredo', async () => {
    api.sequencia = [recusaDa('CERTIFICADO_RESPONSAVEL_INVALIDO')];
    vault.falharDestruicao = true;
    vault.falharInutilizacao = true;

    const resposta = await enviarPfx('valido-e-cnpj-a1');

    expect(resposta.status).toBe(422);
    const registro = logs.find((l) => l['evento'] === 'compensacao_falhou');
    expect(registro?.['referencia']).toBe(vault.gravacoes[0]?.escopo.referencia);
  });

  it('envia à API TODOS os CNPJs do certificado', async () => {
    await enviarPfx('valido-e-cnpj-a1');

    expect(api.ativacoes[0]?.cnpjsDoTitular).toEqual([CNPJ_PADRAO_DE_TESTE]);
  });
});

describe('POST /ingestao — nenhum vazamento do sentinela', () => {
  it('senha e bytes do PKCS#12 não aparecem em respostas nem em logs, em sucesso ou em falha', async () => {
    const respostas: string[] = [];
    const coletar = async (r: Response): Promise<void> => {
      respostas.push(JSON.stringify([...r.headers.entries()]), await r.text());
    };
    const { pfx } = pfxComSentinela;
    const novo = (extra: Partial<Envio> = {}): Promise<Response> =>
      enviar({ ticket: ticket(), senha: SENTINELA_SENHA, arquivo: pfx, ...extra });

    await coletar(await novo());
    await coletar(await novo({ senha: `${SENTINELA_SENHA}-errada` }));
    await coletar(await novo({ arquivo: pfx.subarray(0, 300) }));
    await coletar(await novo({ nome: 'x.txt' }));
    api.sequencia = [AMBIGUO_500];
    await coletar(await novo());
    vault.falharGravacao = true;
    await coletar(await novo());

    const tudo = `${respostas.join('\n')}\n${JSON.stringify(logs)}\n${JSON.stringify(api.recusas)}`;
    expect(tudo).not.toContain(SENTINELA_SENHA);
    expect(tudo).not.toContain(TRECHO_DO_PFX);
    expect(tudo).not.toContain(pfx.toString('base64').slice(0, 40));
    expect(logs.length).toBeGreaterThan(0);
  });

  it('o único destino da senha é o Vault', async () => {
    await enviar({ ticket: ticket(), senha: SENTINELA_SENHA, arquivo: pfxComSentinela.pfx });

    expect(vault.gravacoes[0]?.senha).toBe(SENTINELA_SENHA);
  });
});

describe('CORS de /ingestao', () => {
  it('preflight de origem permitida: 204 com POST e content-type, sem credenciais', async () => {
    const resposta = await fetch(`${base}/ingestao`, { method: 'OPTIONS', headers: { origin: ORIGEM } });

    expect(resposta.status).toBe(204);
    expect(resposta.headers.get('access-control-allow-origin')).toBe(ORIGEM);
    expect(resposta.headers.get('access-control-allow-methods')).toBe('POST');
    expect(resposta.headers.get('access-control-allow-headers')).toBe('content-type');
    expect(resposta.headers.get('access-control-allow-credentials')).toBeNull();
    expect(resposta.headers.get('vary')).toContain('Origin');
  });

  it('preflight e POST de origem não permitida: 403 sem cabeçalho CORS e sem processar', async () => {
    const preflight = await fetch(`${base}/ingestao`, { method: 'OPTIONS', headers: { origin: 'http://malicioso.local' } });
    const post = await enviarPfx('valido-e-cnpj-a1', { origem: 'http://malicioso.local' });

    for (const resposta of [preflight, post]) {
      expect(resposta.status).toBe(403);
      expect(resposta.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(vault.gravacoes).toEqual([]);
    expect(api.recusas).toEqual([]);
  });

  it('POST da origem permitida (sucesso e erro) leva o cabeçalho para o navegador ler a resposta', async () => {
    const ok = await enviarPfx('valido-e-cnpj-a1', { origem: ORIGEM });
    const erro = await enviarPfx('invalido-a3', { origem: ORIGEM });

    for (const resposta of [ok, erro]) {
      expect(resposta.headers.get('access-control-allow-origin')).toBe(ORIGEM);
      expect(resposta.headers.get('access-control-allow-credentials')).toBeNull();
      expect(resposta.headers.get('access-control-expose-headers')).toContain('x-correlation-id');
    }
  });

  it('nunca responde com curinga', async () => {
    const resposta = await enviarPfx('valido-e-cnpj-a1', { origem: ORIGEM });

    expect(resposta.headers.get('access-control-allow-origin')).not.toBe('*');
  });
});

describe('rotas internas /segredos', () => {
  const chamar = (referencia: string, operacao: string, opcoes: { token?: string; corpo?: unknown } = {}): Promise<Response> =>
    fetch(`${base}/segredos/${referencia}/${operacao}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opcoes.token === undefined ? {} : { authorization: `Bearer ${opcoes.token}` }),
      },
      body: JSON.stringify(opcoes.corpo ?? { tenantId: TENANT, empresaId: EMPRESA }),
    });
  const REF = '33333333-3333-4333-8333-333333333333';

  it.each(['inutilizar', 'restaurar'])('%s exige o Bearer ADMIN: sem token, errado, esquema errado e o token do sentido cofre→API dão 401', async (operacao) => {
    for (const cabecalho of [undefined, 'Bearer errado', `Basic ${ADMIN_TOKEN}`, `Bearer ${SERVICE_TOKEN}`]) {
      const resposta = await fetch(`${base}/segredos/${REF}/${operacao}`, {
        method: 'POST',
        headers: cabecalho ? { authorization: cabecalho } : {},
        body: JSON.stringify({ tenantId: TENANT, empresaId: EMPRESA }),
      });
      expect(resposta.status).toBe(401);
      expect((await resposta.json()).code).toBe('NAO_AUTORIZADO');
    }
    expect(vault.inutilizacoes).toEqual([]);
    expect(vault.restauracoes).toEqual([]);
  });

  it('inutilizar chama o delete da referência do escopo informado e não devolve conteúdo', async () => {
    const resposta = await chamar(REF, 'inutilizar', { token: ADMIN_TOKEN });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ referencia: REF, estado: 'INUTILIZADO' });
    expect(vault.inutilizacoes).toEqual([{ tenantId: TENANT, empresaId: EMPRESA, referencia: REF }]);
  });

  it('restaurar chama o undelete', async () => {
    const resposta = await chamar(REF, 'restaurar', { token: ADMIN_TOKEN });

    expect(await resposta.json()).toEqual({ referencia: REF, estado: 'RESTAURADO' });
    expect(vault.restauracoes).toHaveLength(1);
  });

  it('referência ou ids fora do formato UUID: 400, sem tocar o Vault', async () => {
    const traversal = await chamar('..%2F..%2Fsys', 'inutilizar', { token: ADMIN_TOKEN });
    const idRuim = await chamar(REF, 'inutilizar', { token: ADMIN_TOKEN, corpo: { tenantId: 'x', empresaId: EMPRESA } });
    const semCorpo = await chamar(REF, 'inutilizar', { token: ADMIN_TOKEN, corpo: {} });

    for (const resposta of [traversal, idRuim, semCorpo]) {
      expect(resposta.status).toBe(400);
      expect((await resposta.json()).code).toBe('REQUISICAO_INVALIDA');
    }
    expect(vault.inutilizacoes).toEqual([]);
  });

  it('Vault fora do ar: 503 COFRE_INDISPONIVEL', async () => {
    vault.falharInutilizacao = true;

    const resposta = await chamar(REF, 'inutilizar', { token: ADMIN_TOKEN });

    expect(resposta.status).toBe(503);
    expect((await resposta.json()).code).toBe('COFRE_INDISPONIVEL');
  });
});

describe('superfície do serviço', () => {
  it('não existe rota de leitura, listagem ou download de segredo', async () => {
    const tentativas: [string, string][] = [
      ['GET', '/segredos/33333333-3333-4333-8333-333333333333'],
      ['GET', '/segredos/33333333-3333-4333-8333-333333333333/download'],
      ['POST', '/segredos/33333333-3333-4333-8333-333333333333/ler'],
      ['GET', '/certificados'],
      ['GET', '/download'],
      ['GET', '/ingestao'],
    ];

    for (const [metodo, caminho] of tentativas) {
      const resposta = await fetch(`${base}${caminho}`, { method: metodo, headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
      expect(resposta.status, `${metodo} ${caminho}`).toBe(404);
    }
  });

  it('/health: 200 com Vault pronto; 503 caso contrário', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);

    vault.estaPronto = false;
    const indisponivel = await fetch(`${base}/health`);

    expect(indisponivel.status).toBe(503);
    expect(await indisponivel.json()).toEqual({ service: 'cofre', status: 'indisponivel' });
  });
});

describe('capacidade e ordem das partes da ingestão', () => {
  const enviarNaOrdem = (partes: [string, string | Buffer, string?][]): Promise<Response> => {
    const form = new FormData();
    for (const [nome, valor, arquivo] of partes) {
      if (arquivo === undefined) form.append(nome, valor.toString());
      else form.append(nome, new Blob([new Uint8Array(Buffer.from(valor))]), arquivo);
    }
    return fetch(`${base}/ingestao`, { method: 'POST', body: form });
  };
  const { pfx, senha } = conjunto['valido-e-cnpj-a1']!;
  const completo = (t: string = ticket()): [string, string | Buffer, string?][] => [
    ['ticket', t],
    ['senha', senha],
    ['arquivo', pfx, 'c.pfx'],
  ];

  it('arquivo ANTES do ticket: 401, o arquivo não é aberto nem gravado e a API não é chamada', async () => {
    const resposta = await enviarNaOrdem([['arquivo', pfx, 'c.pfx'], ['ticket', ticket()], ['senha', senha]]);

    expect(resposta.status).toBe(401);
    expect((await resposta.json()).code).toBe('CERTIFICADO_TICKET_INVALIDO');
    expect(vault.gravacoes).toEqual([]);
    expect(api.ativacoes).toEqual([]);
    expect(api.recusas).toEqual([]);
  });

  it('senha ANTES do ticket também é recusada', async () => {
    const resposta = await enviarNaOrdem([['senha', senha], ['ticket', ticket()], ['arquivo', pfx, 'c.pfx']]);

    expect(resposta.status).toBe(401);
    expect(vault.gravacoes).toEqual([]);
  });

  it('ticket inválido com arquivo grande: 401 sem abrir o PKCS#12 (corpo só é descartado)', async () => {
    const resposta = await enviarNaOrdem([
      ['ticket', 'lixo.lixo'],
      ['senha', senha],
      ['arquivo', Buffer.alloc(5 * 1024 * 1024, 1), 'c.pfx'],
    ]);

    expect(resposta.status).toBe(401);
    expect(vault.gravacoes).toEqual([]);
    expect(api.recusas).toEqual([]);
  });

  it('ticket válido mas já usado (replay) é barrado antes de o arquivo chegar: 401', async () => {
    const t = ticket();
    expect((await enviarNaOrdem(completo(t))).status).toBe(200);

    const segunda = await enviarNaOrdem(completo(t));

    expect(segunda.status).toBe(401);
    expect(vault.gravacoes).toHaveLength(1);
  });

  it('acima do limite de ingestões simultâneas: 503 com Retry-After, sem consumir o ticket; as demais concluem', async () => {
    let liberar: () => void = () => {};
    api.portao = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    const emAndamento = [enviarNaOrdem(completo()), enviarNaOrdem(completo())];
    // Espera as duas estarem seguras na ativação (vagas ocupadas).
    for (let i = 0; i < 300 && api.ativacoes.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    expect(api.ativacoes).toHaveLength(2);

    const t3 = ticket();
    const excedente = await enviarNaOrdem(completo(t3));

    expect(excedente.status).toBe(503);
    expect(excedente.headers.get('retry-after')).toBe('5');
    expect((await excedente.json()).code).toBe('COFRE_INDISPONIVEL');
    expect(api.ativacoes).toHaveLength(2);

    liberar();
    expect((await Promise.all(emAndamento)).map((r) => r.status)).toEqual([200, 200]);

    // O ticket do excedente não foi consumido: com vaga livre, ele serve.
    expect((await enviarNaOrdem(completo(t3))).status).toBe(200);
  });

  it('a vaga é devolvida mesmo quando a ingestão falha', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await enviarNaOrdem([['ticket', ticket()], ['senha', 'errada'], ['arquivo', pfx, 'c.pfx']]);
      expect(r.status).toBe(400);
    }
    expect((await enviarNaOrdem(completo())).status).toBe(200);
  });
});

describe('endurecimento das rotas internas e do bind', () => {
  const REF = '33333333-3333-4333-8333-333333333333';
  const chamarBruto = (corpo: string, cabecalhos: Record<string, string> = {}): Promise<Response> =>
    fetch(`${base}/segredos/${REF}/inutilizar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, ...cabecalhos },
      body: corpo,
    });

  it.each(['null', '[]', '"texto"', '42', '{"tenantId":1,"empresaId":2}'])('corpo JSON %s é 400, não erro 500', async (corpo) => {
    const resposta = await chamarBruto(corpo);

    expect(resposta.status).toBe(400);
    expect((await resposta.json()).code).toBe('REQUISICAO_INVALIDA');
    expect(vault.inutilizacoes).toEqual([]);
  });

  it('x-correlation-id válido é mantido; malformado ou enorme é trocado por um UUID novo', async () => {
    const corpo = JSON.stringify({ tenantId: TENANT, empresaId: EMPRESA });

    const valido = await chamarBruto(corpo, { 'x-correlation-id': 'corr-123_abc.DEF' });
    const sujo = await chamarBruto(corpo, { 'x-correlation-id': 'a b;<script>' });
    const enorme = await chamarBruto(corpo, { 'x-correlation-id': 'x'.repeat(65) });

    expect(valido.headers.get('x-correlation-id')).toBe('corr-123_abc.DEF');
    for (const resposta of [sujo, enorme]) {
      expect(resposta.headers.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('o servidor escuta em 127.0.0.1 por padrão (COFRE_HOST só afrouxa por decisão explícita)', async () => {
    const { criarServidorDoCofre: criar, escutar, HOST_PADRAO } = await import('./server.js');
    const outro = criar({
      vault,
      api,
      raizes,
      ticketSecret: TICKET_SECRET,
      adminToken: ADMIN_TOKEN,
      origensPermitidas: [],
      log: () => {},
    });
    await escutar(outro, 0);

    try {
      expect(HOST_PADRAO).toBe('127.0.0.1');
      expect((outro.address() as AddressInfo).address).toBe('127.0.0.1');
    } finally {
      await new Promise((resolver) => outro.close(resolver));
    }
  });
});
