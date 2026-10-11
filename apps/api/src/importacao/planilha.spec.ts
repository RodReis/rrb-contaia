/**
 * Fronteira da planilha na API (SPEC-015 §3.1–§3.2, §7): decisão do formato por extensão + conteúdo
 * (nunca pelo `Content-Type`), tradução dos erros do leitor em códigos estáveis e o limitador único
 * das leituras em processo filho.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { ErroDeInfraestrutura, ErroDePlanilha, gerarModelo } from '@contaia/planilhas';
import { cfb, conteudoOds, celulaOds, ods, tabelaOds, xlsx } from '@contaia/planilhas/testes';
import { describe, expect, it } from 'vitest';

import { LimitadorDeLeituras, formatoDoArquivo, traduzirErroDoLeitor } from './planilha';

const XLSX = Buffer.from(gerarModelo('XLSX', ['a', 'b'], ['1', '2']));
const ODS = Buffer.from(ods(conteudoOds(tabelaOds('Dados', `<table:table-row>${celulaOds('a')}</table:table-row>`))));
const CSV = Buffer.from('a;b\r\n1;2\r\n');

const codigoDe = (acao: () => unknown): string | undefined => {
  try {
    acao();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : `OUTRO: ${String(erro)}`;
  }
  return undefined;
};

const arquivo = (buffer: Buffer, nome: string, mimetype = 'application/octet-stream') => ({ buffer, nome, mimetype });

describe('formatoDoArquivo: extensão + conteúdo, nunca o Content-Type', () => {
  it.each([
    ['XLSX com Content-Type genérico', arquivo(XLSX, 'plano.xlsx'), 'XLSX'],
    ['XLSX com Content-Type de CSV', arquivo(XLSX, 'plano.XLSX', 'text/csv'), 'XLSX'],
    ['ODS', arquivo(ODS, 'plano.ods', 'application/vnd.oasis.opendocument.spreadsheet'), 'ODS'],
    ['CSV (caminho das F13/F14)', arquivo(CSV, 'plano.csv', 'text/csv'), 'CSV'],
  ])('%s → %s', (_caso, enviado, esperado) => {
    expect(formatoDoArquivo('IMPORTACAO_PLANO_CONTAS', enviado)).toBe(esperado);
  });

  it.each([
    ['.xls pelo nome', arquivo(CSV, 'plano.xls', 'text/csv'), CODIGOS_DE_ERRO.FORMATO_XLS_NAO_SUPORTADO],
    ['.xlsm pelo nome', arquivo(XLSX, 'plano.xlsm'), CODIGOS_DE_ERRO.FORMATO_XLSM_NAO_SUPORTADO],
    ['.xls de verdade renomeado .xlsx', arquivo(Buffer.from(cfb('Workbook')), 'plano.xlsx'), CODIGOS_DE_ERRO.FORMATO_XLS_NAO_SUPORTADO],
    ['XLSM renomeado .xlsx', arquivo(Buffer.from(xlsx({ macro: true })), 'plano.xlsx'), CODIGOS_DE_ERRO.FORMATO_XLSM_NAO_SUPORTADO],
    ['OOXML cifrado', arquivo(Buffer.from(cfb('EncryptionInfo', 'EncryptedPackage')), 'plano.xlsx'), CODIGOS_DE_ERRO.ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO],
    ['ODS cifrado', arquivo(Buffer.from(ods('', { cifrado: true })), 'plano.ods'), CODIGOS_DE_ERRO.ARQUIVO_PROTEGIDO_OU_CRIPTOGRAFADO],
    ['CSV renomeado .xlsx', arquivo(CSV, 'plano.xlsx'), CODIGOS_DE_ERRO.EXTENSAO_DIFERENTE_DO_CONTEUDO],
    ['ODS renomeado .xlsx', arquivo(ODS, 'plano.xlsx'), CODIGOS_DE_ERRO.EXTENSAO_DIFERENTE_DO_CONTEUDO],
    ['XLSX renomeado .ods', arquivo(XLSX, 'plano.ods'), CODIGOS_DE_ERRO.EXTENSAO_DIFERENTE_DO_CONTEUDO],
    ['ZIP truncado', arquivo(XLSX.subarray(0, 60), 'plano.xlsx'), CODIGOS_DE_ERRO.ARQUIVO_CORROMPIDO],
    ['vazio', arquivo(Buffer.alloc(0), 'plano.xlsx'), CODIGOS_DE_ERRO.ARQUIVO_VAZIO],
    ['acima de 10 MB', arquivo(Buffer.concat([XLSX, Buffer.alloc(10 * 1024 * 1024)]), 'plano.xlsx'), CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE],
    // O caminho do CSV fica como nas F13/F14: binário com nome .csv é ARQUIVO_INVALIDO.
    ['XLSX renomeado .csv', arquivo(XLSX, 'plano.csv', 'text/csv'), CODIGOS_DE_ERRO.ARQUIVO_INVALIDO],
  ])('%s → %s', (_caso, enviado, esperado) => {
    expect(codigoDe(() => formatoDoArquivo('IMPORTACAO_EMPREGADOS', enviado))).toBe(esperado);
  });

  it('a recusa diz o motivo com a mensagem fixa, sem ecoar o nome do arquivo', () => {
    try {
      formatoDoArquivo('IMPORTACAO_EMPREGADOS', arquivo(XLSX, 'Folha 529.982.247-25.xlsm'));
      expect.unreachable();
    } catch (erro) {
      expect((erro as ErroDeDominio).message).toMatch(/macro/u);
      expect(JSON.stringify(erro)).not.toContain('529.982.247-25');
    }
  });
});

describe('traduzirErroDoLeitor', () => {
  it('erro de arquivo vira o código estável com a mensagem fixa', () => {
    const erro = traduzirErroDoLeitor(new ErroDePlanilha('LIMITE_DE_PROCESSAMENTO_EXCEDIDO', 'ZIP_BOMBA'));

    expect(erro.codigo).toBe(CODIGOS_DE_ERRO.LIMITE_DE_PROCESSAMENTO_EXCEDIDO);
    expect(erro.message).toMatch(/limite seguro de processamento/u);
    expect(JSON.stringify(erro)).not.toContain('ZIP_BOMBA');
  });

  it('aba inexistente aponta o campo `aba`', () => {
    const erro = traduzirErroDoLeitor(new ErroDePlanilha('ABA_INEXISTENTE', 'ABA'));

    expect(erro.codigo).toBe(CODIGOS_DE_ERRO.ABA_INEXISTENTE);
    expect(erro.campos).toEqual([{ campo: 'aba', codigo: CODIGOS_DE_ERRO.ABA_INEXISTENTE }]);
  });

  it('falha técnica do processo filho é 503 SERVICO_OCUPADO, sem o motivo interno', () => {
    const erro = traduzirErroDoLeitor(new ErroDeInfraestrutura('filho morreu: ENOMEM /tmp/x'));

    expect(erro.codigo).toBe(CODIGOS_DE_ERRO.SERVICO_OCUPADO);
    expect(erro.message).not.toMatch(/ENOMEM|filho/u);
  });

  it('o que não é do leitor segue adiante como veio', () => {
    const outro = new TypeError('bug');

    expect(() => traduzirErroDoLeitor(outro)).toThrow(outro);
  });
});

describe('LimitadorDeLeituras: no máximo N leituras simultâneas; o excedente é recusado na hora', () => {
  const pendente = () => {
    let liberar: () => void = () => undefined;
    const promessa = new Promise<string>((resolver) => {
      liberar = () => resolver('ok');
    });
    return { promessa, liberar };
  };

  it('a terceira simultânea é SERVICO_OCUPADO; com uma vaga liberada, volta a aceitar', async () => {
    const limitador = new LimitadorDeLeituras(2);
    const a = pendente();
    const b = pendente();
    const primeira = limitador.executar(() => a.promessa);
    const segunda = limitador.executar(() => b.promessa);

    await expect(limitador.executar(() => Promise.resolve('x'))).rejects.toMatchObject({
      codigo: CODIGOS_DE_ERRO.SERVICO_OCUPADO,
    });

    a.liberar();
    await expect(primeira).resolves.toBe('ok');
    await expect(limitador.executar(() => Promise.resolve('de novo'))).resolves.toBe('de novo');
    b.liberar();
    await expect(segunda).resolves.toBe('ok');
  });

  it('a vaga volta também quando a leitura falha', async () => {
    const limitador = new LimitadorDeLeituras(1);

    await expect(limitador.executar(() => Promise.reject(new Error('falhou')))).rejects.toThrow('falhou');
    await expect(limitador.executar(() => Promise.resolve(1))).resolves.toBe(1);
  });
});
