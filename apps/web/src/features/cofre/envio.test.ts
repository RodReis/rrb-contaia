/**
 * Provas do envio direto ao cofre (SPEC-011 §6.2): a requisição vai ao endpoint
 * do cofre, sem credenciais, com o ticket antes do arquivo, e a recusa chega com
 * código estável e `correlationId`. O `XMLHttpRequest` é dublado.
 */
import { LIMITE_DO_CERTIFICADO_BYTES, MENSAGEM_DA_RECUSA } from '@contaia/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErroDaApi } from '@/lib/http';
import {
  COFRE_URL,
  SENHA_SENTINELA,
  XhrDublado,
  arquivoDeCertificado,
  certificado,
  instalarXhr,
} from './cofre.fixtures';
import { enviarAoCofre, validarArquivoDoCertificado } from './envio';

beforeEach(() => instalarXhr());
afterEach(() => vi.unstubAllGlobals());

describe('validarArquivoDoCertificado', () => {
  it('aceita .pfx e .p12, em qualquer caixa', () => {
    expect(validarArquivoDoCertificado({ name: 'a.pfx', size: 10 })).toBeNull();
    expect(validarArquivoDoCertificado({ name: 'A.P12', size: 10 })).toBeNull();
  });

  it('recusa outra extensão antes de gastar a rede', () => {
    expect(validarArquivoDoCertificado({ name: 'a.pem', size: 10 })).toBe(
      MENSAGEM_DA_RECUSA.CERTIFICADO_EXTENSAO_INVALIDA,
    );
    expect(validarArquivoDoCertificado({ name: 'pfx', size: 10 })).toBe(
      MENSAGEM_DA_RECUSA.CERTIFICADO_EXTENSAO_INVALIDA,
    );
  });

  it('recusa arquivo vazio e arquivo acima de 10 MB; 10 MB exatos passam', () => {
    expect(validarArquivoDoCertificado({ name: 'a.pfx', size: 0 })).toBe(
      MENSAGEM_DA_RECUSA.CERTIFICADO_ARQUIVO_VAZIO,
    );
    expect(
      validarArquivoDoCertificado({ name: 'a.pfx', size: LIMITE_DO_CERTIFICADO_BYTES + 1 }),
    ).toBe(MENSAGEM_DA_RECUSA.CERTIFICADO_TAMANHO_EXCEDIDO);
    expect(
      validarArquivoDoCertificado({ name: 'a.pfx', size: LIMITE_DO_CERTIFICADO_BYTES }),
    ).toBeNull();
  });
});

describe('enviarAoCofre', () => {
  const entrada = (aoProgredir = vi.fn()) => ({
    cofreUrl: `${COFRE_URL}/`,
    ticket: 'ticket.assinado',
    senha: SENHA_SENTINELA,
    arquivo: arquivoDeCertificado(),
    aoProgredir,
  });

  it('envia multipart ao /ingestao do cofre, sem credenciais, com o ticket antes do arquivo', async () => {
    const promessa = enviarAoCofre(entrada());
    const xhr = XhrDublado.ultimo;

    expect(xhr?.registro.metodo).toBe('POST');
    expect(xhr?.registro.url).toBe(`${COFRE_URL}/ingestao`);
    expect(xhr?.registro.withCredentials).toBe(false);
    expect(xhr?.registro.ordemDosCampos).toEqual(['ticket', 'senha', 'arquivo']);
    expect(xhr?.registro.campos['ticket']).toBe('ticket.assinado');
    expect(xhr?.registro.campos['senha']).toBe(SENHA_SENTINELA);
    expect(xhr?.registro.campos['arquivo']).toBeInstanceOf(File);

    xhr?.responder(200, { certificado: certificado() });
    await expect(promessa).resolves.toEqual({ certificado: certificado() });
  });

  it('repassa o progresso como fração entre 0 e 1', async () => {
    const aoProgredir = vi.fn();
    const promessa = enviarAoCofre(entrada(aoProgredir));

    XhrDublado.ultimo?.progresso(512, 2048);
    XhrDublado.ultimo?.progresso(4096, 2048);
    XhrDublado.ultimo?.responder(200, { certificado: certificado() });
    await promessa;

    expect(aoProgredir).toHaveBeenNthCalledWith(1, 0.25);
    expect(aoProgredir).toHaveBeenNthCalledWith(2, 1);
  });

  it('a recusa do cofre vira ErroDaApi com código estável e correlationId', async () => {
    const promessa = enviarAoCofre(entrada());

    XhrDublado.ultimo?.responder(422, {
      type: 'x',
      title: 'x',
      status: 422,
      code: 'CERTIFICADO_SENHA_INCORRETA',
      correlationId: 'corr-cofre-1',
    });

    const erro: unknown = await promessa.catch((falha: unknown) => falha);

    expect(erro).toBeInstanceOf(ErroDaApi);
    expect((erro as ErroDaApi).problema.code).toBe('CERTIFICADO_SENHA_INCORRETA');
    expect((erro as ErroDaApi).problema.correlationId).toBe('corr-cofre-1');
  });

  it('resposta sem problema vira erro desconhecido, nunca sucesso', async () => {
    const promessa = enviarAoCofre(entrada());

    XhrDublado.ultimo?.responder(502, { qualquer: 'coisa' });

    const erro: unknown = await promessa.catch((falha: unknown) => falha);

    expect((erro as ErroDaApi).problema.code).toBe('ERRO_DESCONHECIDO');
  });

  it('2xx sem metadados também não é sucesso', async () => {
    const promessa = enviarAoCofre(entrada());

    XhrDublado.ultimo?.responder(200, { ok: true });

    const erro: unknown = await promessa.catch((falha: unknown) => falha);

    expect((erro as ErroDaApi).problema.code).toBe('ERRO_DESCONHECIDO');
  });

  it('falha de rede ou tempo esgotado vira COFRE_INDISPONIVEL', async () => {
    const promessa = enviarAoCofre(entrada());

    XhrDublado.ultimo?.falharNaRede();

    const erro: unknown = await promessa.catch((falha: unknown) => falha);

    expect((erro as ErroDaApi).problema.code).toBe('COFRE_INDISPONIVEL');
  });
});
