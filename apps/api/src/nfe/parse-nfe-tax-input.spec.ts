/**
 * Adaptador de NF-e em memória (SPEC-016 §3.6, §7): leiaute NT 2025.002 v1.50 fixado, parse seguro
 * (sem DTD nem entidades), extração mínima para a simulação e erros de validação, nunca HTTP 500.
 * Só fixtures sintéticas e não oficiais.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { LIMITE_DA_NFE_BYTES, NFE_RTC_LAYOUT } from '@contaia/shared';

import { parseNfeTaxInput } from './parse-nfe-tax-input';

const lerFixture = (nome: string): string => readFileSync(join(__dirname, 'fixtures', nome), 'utf8');
const VALIDA = lerFixture('nfe-rtc-valida.xml');
const SEM_IBSCBS = lerFixture('nfe-sem-ibscbs.xml');

const bytes = (xml: string): Buffer => Buffer.from(xml, 'utf8');
const trocar = (xml: string, de: string | RegExp, para: string): string => {
  const resultado = xml.replace(de, para);
  expect(resultado).not.toBe(xml);
  return resultado;
};

const codigoDe = (executar: () => unknown): string | undefined => {
  try {
    executar();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : `inesperado: ${String(erro)}`;
  }
  return undefined;
};

describe('extração de NF-e válida com IBS/CBS', () => {
  const extracao = parseNfeTaxInput(bytes(VALIDA));

  it('fixa o leiaute e extrai a emissão como data civil e o regime do CRT inequívoco', () => {
    expect(extracao.layout).toEqual(NFE_RTC_LAYOUT);
    expect(extracao.issueDate).toBe('2026-06-15');
    expect(extracao.regime).toBe('SIMPLES_NACIONAL');
  });

  it('extrai itens, bases e grupos declarados em centavos inteiros', () => {
    expect(extracao.items).toHaveLength(3);
    expect(extracao.items[0]).toEqual({
      number: 1,
      productCents: 10_000,
      ibsCbs: {
        baseCents: 10_000,
        ibsUf: { ratePercent: '0.1000', valueCents: 10 },
        ibsMun: { ratePercent: '0.0000', valueCents: 0 },
        cbs: { ratePercent: '0.9000', valueCents: 90 },
      },
    });
    expect(extracao.items[1]).toMatchObject({ number: 2, productCents: 420, ibsCbs: { baseCents: 420, cbs: { valueCents: 4 } } });
    expect(extracao.items[2]).toMatchObject({ number: 3, ibsCbs: { cbs: { ratePercent: '0.9500', valueCents: 95 } } });
  });

  it('extrai os totais declarados do documento', () => {
    expect(extracao.declaredTotals).toEqual({ ibsCents: 20, cbsCents: 189 });
  });

  it('devolve só o necessário à simulação: nada de emitente, chave de acesso ou texto do documento', () => {
    const texto = JSON.stringify(extracao);

    for (const sensivel of ['EMITENTE', 'NFe0000', 'ITEM DE TESTE', '00000000000000', 'VENDA FIXTURE']) {
      expect(texto).not.toContain(sensivel);
    }
  });

  it('é determinística para o mesmo documento', () => {
    expect(JSON.stringify(parseNfeTaxInput(bytes(VALIDA)))).toBe(JSON.stringify(extracao));
  });
});

describe('NF-e sem os grupos IBS/CBS', () => {
  const extracao = parseNfeTaxInput(bytes(SEM_IBSCBS));

  it('aceita a raiz NFe sem nfeProc e deixa a ausência explícita', () => {
    expect(extracao.items).toEqual([
      { number: 1, productCents: 25_000, ibsCbs: null },
      { number: 2, productCents: 1_000, ibsCbs: null },
    ]);
    expect(extracao.declaredTotals).toBeNull();
  });

  it('CRT 3 não mapeia para um único regime (presumido ou real): fica nulo para complemento', () => {
    expect(extracao.regime).toBeNull();
  });
});

describe('mapeamento do CRT', () => {
  it.each([
    ['1', 'SIMPLES_NACIONAL'],
    ['2', 'SIMPLES_NACIONAL'],
    ['3', null],
    ['4', null],
  ])('CRT %s → %s', (crt, regime) => {
    const xml = crt === '1' ? VALIDA : trocar(VALIDA, '<CRT>1</CRT>', `<CRT>${crt}</CRT>`);

    expect(parseNfeTaxInput(bytes(xml)).regime).toBe(regime);
  });

  it('sem CRT o regime fica nulo', () => {
    expect(parseNfeTaxInput(bytes(trocar(VALIDA, '<CRT>1</CRT>', ''))).regime).toBeNull();
  });
});

describe('data de emissão', () => {
  it('usa o dia civil escrito no documento, sem converter fuso', () => {
    const xml = trocar(VALIDA, '2026-06-15T10:30:00-03:00', '2026-06-15T23:59:59-03:00');

    expect(parseNfeTaxInput(bytes(xml)).issueDate).toBe('2026-06-15');
  });

  it('recusa data de emissão inexistente', () => {
    expect(codigoDe(() => parseNfeTaxInput(bytes(trocar(VALIDA, '2026-06-15T10:30:00-03:00', '2026-02-30T10:30:00-03:00'))))).toBe(
      CODIGOS_DE_ERRO.NFE_XML_INVALID,
    );
  });

  it('sem data de emissão faltam dados mínimos', () => {
    const xml = trocar(VALIDA, /<dhEmi>.*<\/dhEmi>/u, '');

    expect(codigoDe(() => parseNfeTaxInput(bytes(xml)))).toBe(CODIGOS_DE_ERRO.NFE_REQUIRED_DATA_MISSING);
  });
});

describe('XML inseguro ou ilegível → NFE_XML_INVALID', () => {
  it.each([
    ['vazio', Buffer.alloc(0)],
    ['só espaços', bytes('   \n')],
    ['truncado', bytes(VALIDA.slice(0, 900))],
    ['sem fechar tag', bytes(trocar(VALIDA, '</infNFe>', ''))],
    ['bytes que não são UTF-8', Buffer.from([0x3c, 0x4e, 0x46, 0x65, 0x3e, 0xff, 0xfe, 0x3c, 0x2f, 0x4e, 0x46, 0x65, 0x3e])],
    ['declara outra codificação', bytes(trocar(VALIDA, 'encoding="UTF-8"', 'encoding="ISO-8859-1"'))],
    ['entidade não declarada', bytes(trocar(VALIDA, 'ITEM DE TESTE 1', 'ITEM &naoexiste; 1'))],
    ['texto que não é XML', bytes('isto não é xml')],
  ])('%s', (_nome, conteudo) => {
    expect(codigoDe(() => parseNfeTaxInput(conteudo))).toBe(CODIGOS_DE_ERRO.NFE_XML_INVALID);
  });

  it.each([
    ['DTD com entidade interna', 'com-doctype.xml'],
    ['entidade externa (XXE)', 'xxe-entidade-externa.xml'],
  ])('%s é recusado antes do parse', (_nome, arquivo) => {
    expect(codigoDe(() => parseNfeTaxInput(bytes(lerFixture(arquivo))))).toBe(CODIGOS_DE_ERRO.NFE_XML_INVALID);
  });

  it.each(['<!DOCTYPE', '<!doctype', '<!DocType', '<!ENTITY', '<!entity'])('recusa %s em qualquer caixa e posição', (marca) => {
    const xml = trocar(VALIDA, '<NFe>', `<NFe>${marca} x>`);

    expect(codigoDe(() => parseNfeTaxInput(bytes(xml)))).toBe(CODIGOS_DE_ERRO.NFE_XML_INVALID);
  });

  it('o erro não ecoa o conteúdo do arquivo', () => {
    try {
      parseNfeTaxInput(bytes(lerFixture('xxe-entidade-externa.xml')));
    } catch (erro) {
      expect((erro as Error).message).not.toMatch(/passwd|file:/u);
    }
  });

  it('recusa arquivo acima do limite explícito', () => {
    expect(codigoDe(() => parseNfeTaxInput(Buffer.alloc(LIMITE_DA_NFE_BYTES + 1, 0x20)))).toBe(CODIGOS_DE_ERRO.NFE_XML_INVALID);
  });

  it.each([
    ['valor não decimal', '<vProd>100.00</vProd>', '<vProd>abc</vProd>'],
    ['valor com três casas', '<vProd>100.00</vProd>', '<vProd>100.005</vProd>'],
    ['valor negativo', '<vProd>100.00</vProd>', '<vProd>-100.00</vProd>'],
    ['valor com notação científica', '<vProd>100.00</vProd>', '<vProd>1e2</vProd>'],
    ['base IBS/CBS não decimal', '<vBC>100.00</vBC>', '<vBC>x</vBC>'],
    ['item duplicado', '<det nItem="2">', '<det nItem="1">'],
    ['item não numérico', '<det nItem="2">', '<det nItem="dois">'],
    ['item acima de 990', '<det nItem="2">', '<det nItem="991">'],
  ])('%s', (_nome, de, para) => {
    expect(codigoDe(() => parseNfeTaxInput(bytes(trocar(VALIDA, de, para))))).toBe(CODIGOS_DE_ERRO.NFE_XML_INVALID);
  });
});

describe('documento que não é NF-e do leiaute aceito → NFE_LAYOUT_UNSUPPORTED', () => {
  it('CT-e', () => {
    expect(codigoDe(() => parseNfeTaxInput(bytes(lerFixture('cte-nao-suportado.xml'))))).toBe(CODIGOS_DE_ERRO.NFE_LAYOUT_UNSUPPORTED);
  });

  it.each([
    ['NFC-e (modelo 65)', trocar(VALIDA, '<mod>55</mod>', '<mod>65</mod>')],
    ['versão 3.10 do leiaute', trocar(VALIDA, 'infNFe versao="4.00"', 'infNFe versao="3.10"')],
    ['versão sem declaração', trocar(VALIDA, 'infNFe versao="4.00" ', 'infNFe ')],
    ['namespace de outro documento', trocar(VALIDA, 'http://www.portalfiscal.inf.br/nfe"', 'http://www.portalfiscal.inf.br/cte"')],
    ['sem namespace', trocar(VALIDA, ' xmlns="http://www.portalfiscal.inf.br/nfe"', '')],
    ['evento de NF-e', '<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe"><evento/></procEventoNFe>'],
    ['NFS-e', '<?xml version="1.0" encoding="UTF-8"?><CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd"><Nfse/></CompNfse>'],
    ['sem infNFe', '<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"/>'],
  ])('%s', (_nome, xml) => {
    expect(codigoDe(() => parseNfeTaxInput(bytes(xml)))).toBe(CODIGOS_DE_ERRO.NFE_LAYOUT_UNSUPPORTED);
  });
});

describe('ausência de dados mínimos → NFE_REQUIRED_DATA_MISSING', () => {
  it('sem itens', () => {
    const xml = trocar(VALIDA, /<det nItem[\s\S]*<\/det>\s*(?=<total>)/u, '');

    expect(codigoDe(() => parseNfeTaxInput(bytes(xml)))).toBe(CODIGOS_DE_ERRO.NFE_REQUIRED_DATA_MISSING);
  });

  it('item sem valor do produto', () => {
    const xml = trocar(VALIDA, '<vProd>100.00</vProd>', '');

    expect(codigoDe(() => parseNfeTaxInput(bytes(xml)))).toBe(CODIGOS_DE_ERRO.NFE_REQUIRED_DATA_MISSING);
  });
});

describe('desempenho e robustez com muitos itens', () => {
  const comItens = (quantidade: number): string => {
    const item = (n: number): string =>
      `<det nItem="${n}"><prod><vProd>1.00</vProd></prod><imposto><IBSCBS><gIBSCBS><vBC>1.00</vBC><gCBS><pCBS>0.9000</pCBS><vCBS>0.01</vCBS></gCBS></gIBSCBS></IBSCBS></imposto></det>`;

    return (
      '<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00" Id="NFe0">' +
      '<ide><mod>55</mod><dhEmi>2026-06-15T10:30:00-03:00</dhEmi></ide><emit><CRT>1</CRT></emit>' +
      Array.from({ length: quantidade }, (_, indice) => item(indice + 1)).join('') +
      '</infNFe></NFe>'
    );
  };

  it('processa os 990 itens que o leiaute permite, na ordem do documento', () => {
    const extracao = parseNfeTaxInput(bytes(comItens(990)));

    expect(extracao.items).toHaveLength(990);
    expect(extracao.items[989]).toMatchObject({ number: 990, ibsCbs: { baseCents: 100, ibsUf: null, ibsMun: null, cbs: { valueCents: 1 } } });
  });

  it('recusa mais itens do que o leiaute permite', () => {
    expect(codigoDe(() => parseNfeTaxInput(bytes(comItens(991))))).toBe(CODIGOS_DE_ERRO.NFE_XML_INVALID);
  });
});
