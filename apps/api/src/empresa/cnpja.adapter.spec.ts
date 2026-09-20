/**
 * Provas do adaptador da CNPJá (SPEC-002 §10, categoria Integração).
 *
 * `fetch` é substituído por dublê determinístico: a suíte não depende da
 * internet nem do provedor estar de pé (§5). A prova externa real com o CNPJ
 * de teste é separada e não roda na CI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsultaDeCnpjNaCnpja } from './cnpja.adapter';

const CNPJ = '11222333000181';

const respostaCompleta = {
  taxId: CNPJ,
  company: {
    name: 'PADARIA AURORA COMERCIO DE ALIMENTOS LTDA',
    simples: { optant: true },
    simei: { optant: false },
    // Campo que o produto não usa: tem de ser descartado, não persistido.
    members: [{ person: { name: 'Fulano de Tal', taxId: '52998224725' } }],
  },
  alias: 'Padaria Aurora',
  status: { text: 'Ativa' },
  mainActivity: { id: 1091102 },
  sideActivities: [{ id: 4721102 }, { id: '4729699' }],
  phones: [{ area: '11', number: '33224455' }],
  emails: [{ address: 'Contato@PadariaAurora.com.BR' }],
  address: {
    zip: '01310-100',
    street: 'Avenida Paulista',
    number: '1000',
    details: 'Conjunto 101',
    district: 'Bela Vista',
    city: 'São Paulo',
    state: 'sp',
  },
};

const responderCom = (corpo: unknown, status = 200): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => Promise.resolve(corpo),
      } as Response),
    ),
  );
};

const falharCom = (erro: Error): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.reject(erro)),
  );
};

let adaptador: ConsultaDeCnpjNaCnpja;

beforeEach(() => {
  adaptador = new ConsultaDeCnpjNaCnpja();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('consulta bem-sucedida', () => {
  it('mapeia apenas os campos previstos pela fatia', async () => {
    responderCom(respostaCompleta);

    const resultado = await adaptador.consultar('11.222.333/0001-81');

    expect(resultado).toEqual({
      ok: true,
      dados: {
        cnpj: CNPJ,
        razaoSocial: 'PADARIA AURORA COMERCIO DE ALIMENTOS LTDA',
        nomeFantasia: 'Padaria Aurora',
        situacaoCadastral: 'Ativa',
        cnaePrincipal: '1091102',
        cnaesSecundarios: ['4721102', '4729699'],
        telefone: '1133224455',
        email: 'contato@padariaaurora.com.br',
        endereco: {
          cep: '01310100',
          logradouro: 'Avenida Paulista',
          numero: '1000',
          complemento: 'Conjunto 101',
          bairro: 'Bela Vista',
          municipio: 'São Paulo',
          uf: 'SP',
        },
        optanteSimples: true,
        mei: false,
      },
    });
  });

  it('descarta o quadro societário e qualquer campo excedente', async () => {
    responderCom(respostaCompleta);

    const resultado = await adaptador.consultar(CNPJ);

    expect(resultado.ok).toBe(true);
    const serializado = JSON.stringify(resultado);
    expect(serializado).not.toContain('members');
    expect(serializado).not.toContain('Fulano de Tal');
    expect(serializado).not.toContain('52998224725');
  });

  it('normaliza o CNPJ com máscara antes de consultar', async () => {
    responderCom(respostaCompleta);

    await adaptador.consultar('11.222.333/0001-81');

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain(CNPJ);
  });

  it('não infere Simples quando a fonte não informa: tri-estado, não boolean', async () => {
    responderCom({ ...respostaCompleta, company: { name: 'EMPRESA SEM SIMPLES LTDA' } });

    const resultado = await adaptador.consultar(CNPJ);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.dados.optanteSimples).toBeNull();
      expect(resultado.dados.mei).toBeNull();
    }
  });

  it('aceita registro incompleto: base pública irregular não é resposta inválida', async () => {
    responderCom({ taxId: CNPJ });

    const resultado = await adaptador.consultar(CNPJ);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.dados.razaoSocial).toBeNull();
      expect(resultado.dados.cnaesSecundarios).toEqual([]);
      expect(resultado.dados.endereco.cep).toBeNull();
    }
  });
});

describe('falhas recuperáveis pelo preenchimento manual', () => {
  it('404 vira nao_encontrado', async () => {
    responderCom({ message: 'not found' }, 404);

    expect(await adaptador.consultar(CNPJ)).toEqual({ ok: false, motivo: 'nao_encontrado' });
  });

  it('429 vira limite_excedido', async () => {
    responderCom({ message: 'too many requests' }, 429);

    expect(await adaptador.consultar(CNPJ)).toEqual({ ok: false, motivo: 'limite_excedido' });
  });

  it('500 vira indisponivel', async () => {
    responderCom({ message: 'boom' }, 500);

    expect(await adaptador.consultar(CNPJ)).toEqual({ ok: false, motivo: 'indisponivel' });
  });

  it('timeout vira indisponivel, sem lançar', async () => {
    falharCom(new DOMException('The operation was aborted.', 'TimeoutError'));

    expect(await adaptador.consultar(CNPJ)).toEqual({ ok: false, motivo: 'indisponivel' });
  });

  it('falha de rede vira indisponivel, sem lançar', async () => {
    falharCom(new TypeError('fetch failed'));

    expect(await adaptador.consultar(CNPJ)).toEqual({ ok: false, motivo: 'indisponivel' });
  });

  it('corpo fora do schema vira resposta_invalida e o dado é descartado', async () => {
    responderCom({ taxId: 42, status: 'texto onde deveria vir objeto' });

    expect(await adaptador.consultar(CNPJ)).toEqual({ ok: false, motivo: 'resposta_invalida' });
  });

  it('corpo que não é JSON vira resposta_invalida', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => Promise.reject(new SyntaxError('Unexpected token <')),
        } as unknown as Response),
      ),
    );

    expect(await adaptador.consultar(CNPJ)).toEqual({ ok: false, motivo: 'resposta_invalida' });
  });
});
