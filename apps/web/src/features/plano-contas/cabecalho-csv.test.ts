/**
 * Leitura do cabeçalho no navegador (SPEC-013 §3.2–3.3): só os primeiros 64 KB, com as mesmas
 * regras de decodificação do servidor (`decodificarCsv` do domínio), sem `csv-parse` no bundle.
 * Os trechos imitam o que o Excel pt-BR e os sistemas legados exportam.
 */
import { describe, expect, it } from 'vitest';

import {
  BYTES_LIDOS_NO_NAVEGADOR,
  lerCabecalhoDoArquivo,
  mapeamentoSugerido,
  pendenciasDoRascunho,
  registrosDoTexto,
} from './cabecalho-csv';

const utf8 = (texto: string): Uint8Array => new TextEncoder().encode(texto);

/** Latin-1 de verdade: um byte por caractere, como o Excel antigo grava "Código". */
const latin1 = (texto: string): Uint8Array => Uint8Array.from([...texto].map((c) => c.charCodeAt(0)));

const arquivo = (bytes: Uint8Array, nome = 'plano.csv'): File =>
  new File([new Uint8Array(bytes)], nome, { type: 'text/csv' });

describe('lerCabecalhoDoArquivo', () => {
  it('lê o modelo do ContaIA com BOM, ";" e CRLF', async () => {
    const leitura = await lerCabecalhoDoArquivo(
      arquivo(utf8('﻿codigo;nome;tipo;natureza;conta_pai\r\n1;Ativo;sintetica;devedora;\r\n1.1;Circulante;sintetica;devedora;1\r\n')),
    );

    expect(leitura).toEqual({
      tipo: 'LIDO',
      delimitador: ';',
      cabecalho: ['codigo', 'nome', 'tipo', 'natureza', 'conta_pai'],
      amostra: [
        ['1', 'Ativo', 'sintetica', 'devedora', ''],
        ['1.1', 'Circulante', 'sintetica', 'devedora', '1'],
      ],
    });
  });

  it('decodifica acentos em Latin-1 sem trocar por caractere de substituição', async () => {
    const leitura = await lerCabecalhoDoArquivo(
      arquivo(latin1('Código;Descrição;Tipo;Natureza;Conta Pai\n1;Ativo Circulante;Sintética;Devedora;\n')),
    );

    expect(leitura.tipo).toBe('LIDO');
    expect(leitura.tipo === 'LIDO' ? leitura.cabecalho : []).toEqual([
      'Código',
      'Descrição',
      'Tipo',
      'Natureza',
      'Conta Pai',
    ]);
    expect(leitura.tipo === 'LIDO' ? leitura.amostra[0]?.[2] : null).toBe('Sintética');
  });

  it('respeita aspas, aspas escapadas e o delimitador por vírgula', async () => {
    const leitura = await lerCabecalhoDoArquivo(
      arquivo(utf8('cod,"descricao, completa",tipo\n1,"Caixa ""geral""",analitica\n')),
    );

    expect(leitura).toMatchObject({
      tipo: 'LIDO',
      delimitador: ',',
      cabecalho: ['cod', 'descricao, completa', 'tipo'],
      amostra: [['1', 'Caixa "geral"', 'analitica']],
    });
  });

  it('descarta colunas sem nome no fim do cabeçalho (";" sobrando do Excel)', async () => {
    const leitura = await lerCabecalhoDoArquivo(arquivo(utf8('codigo;nome;;\n1;Ativo;;\n')));

    expect(leitura).toMatchObject({ tipo: 'LIDO', cabecalho: ['codigo', 'nome'] });
  });

  it('lê só o começo de um arquivo grande e corta na última linha inteira', async () => {
    const linha = '1.1.01;Caixa geral com acentuação ção;analitica;devedora;1.1\n';
    const texto = `codigo;nome;tipo;natureza;conta_pai\n${linha.repeat(5000)}`;
    const bytes = utf8(texto);

    expect(bytes.length).toBeGreaterThan(BYTES_LIDOS_NO_NAVEGADOR);

    const leitura = await lerCabecalhoDoArquivo(arquivo(bytes));

    expect(leitura).toMatchObject({ tipo: 'LIDO', cabecalho: ['codigo', 'nome', 'tipo', 'natureza', 'conta_pai'] });
    expect(leitura.tipo === 'LIDO' ? leitura.amostra[0]?.[1] : null).toBe('Caixa geral com acentuação ção');
  });

  it.each([
    ['só cabeçalho', utf8('codigo;nome;tipo;natureza;conta_pai\n'), 'ARQUIVO_VAZIO'],
    ['vazio de conteúdo', utf8('   \n\n'), 'ARQUIVO_VAZIO'],
    ['binário com extensão .csv', Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02]), 'ARQUIVO_INVALIDO'],
    ['aspas sem fechar no cabeçalho', utf8('"codigo;nome\n1;Ativo\n'), 'ARQUIVO_INVALIDO'],
    ['coluna repetida no cabeçalho', utf8('codigo;Codigo;nome\n1;2;Ativo\n'), 'CABECALHO_INVALIDO'],
    ['coluna sem nome no meio', utf8('codigo;;nome\n1;x;Ativo\n'), 'CABECALHO_INVALIDO'],
  ])('recusa %s antes do envio', async (_caso, bytes, codigo) => {
    expect(await lerCabecalhoDoArquivo(arquivo(bytes))).toEqual({ tipo: 'RECUSADO', codigo });
  });
});

describe('registrosDoTexto', () => {
  it('pula registros em branco e junta quebra de linha dentro de aspas', () => {
    expect(registrosDoTexto('a;b\r\n\r\n;;\r\n"x\ny";2\r\n', ';', 10, true)).toEqual([
      ['a', 'b'],
      ['x\ny', '2'],
    ]);
  });

  it('não devolve o último registro de um recorte incompleto', () => {
    expect(registrosDoTexto('a;b\n1;"meio', ';', 10, false)).toEqual([['a', 'b']]);
  });
});

describe('mapeamentoSugerido', () => {
  it('pré-seleciona as colunas com o mesmo nome do modelo, sem acento nem caixa', () => {
    expect(mapeamentoSugerido(['Código', 'Nome', 'TIPO', 'Natureza', 'Conta Pai', 'Extra'])).toEqual({
      codigo: 'Código',
      nome: 'Nome',
      tipo: 'TIPO',
      natureza: 'Natureza',
      conta_pai: 'Conta Pai',
    });
  });

  it('deixa sem sugestão o campo cujo nome não aparece no arquivo legado', () => {
    expect(mapeamentoSugerido(['Cod', 'Descricao', 'tipo'])).toEqual({ tipo: 'tipo' });
  });
});

describe('pendenciasDoRascunho', () => {
  const cabecalho = ['Cod', 'Descricao', 'Tipo', 'Natureza', 'Pai'];

  it('aponta os campos ainda não associados', () => {
    expect(pendenciasDoRascunho(cabecalho, { codigo: 'Cod', nome: 'Descricao', tipo: 'Tipo' })).toEqual([
      { campo: 'natureza', motivo: 'AUSENTE' },
      { campo: 'conta_pai', motivo: 'AUSENTE' },
    ]);
  });

  it('bloqueia uma coluna de origem alimentando dois campos', () => {
    expect(
      pendenciasDoRascunho(cabecalho, {
        codigo: 'Cod',
        nome: 'Cod',
        tipo: 'Tipo',
        natureza: 'Natureza',
        conta_pai: 'Pai',
      }),
    ).toEqual([
      { campo: 'codigo', motivo: 'COLUNA_REPETIDA' },
      { campo: 'nome', motivo: 'COLUNA_REPETIDA' },
    ]);
  });

  it('libera o mapeamento completo e sem repetição', () => {
    expect(
      pendenciasDoRascunho(cabecalho, {
        codigo: 'Cod',
        nome: 'Descricao',
        tipo: 'Tipo',
        natureza: 'Natureza',
        conta_pai: 'Pai',
      }),
    ).toEqual([]);
  });
});
