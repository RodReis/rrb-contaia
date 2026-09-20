/**
 * Contrato de erro HTTP: todo erro exposto sai como `application/problem+json`
 * com código estável (CONVENTION.md §9).
 */
import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio } from '@contaia/domain';

import { FiltroDeProblema, montarProblema, statusDoErro } from './problema';
import type { CorpoDoProblema } from './problema';
import type { CorrelationId } from '@contaia/domain';

const CORRELACAO = 'corr-de-teste' as CorrelationId;

/** Falha do driver do PostgreSQL, como o `pg` a entrega. */
const erroDoBanco = (code: string, constraint: string): Error =>
  Object.assign(new Error('erro do banco'), { code, constraint });

const capturar = (excecao: unknown): { status: number; corpo: CorpoDoProblema } => {
  const json = vi.fn();
  const type = vi.fn().mockReturnValue({ json });
  const status = vi.fn().mockReturnValue({ type });

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ header: () => undefined }),
    }),
  };

  new FiltroDeProblema().catch(excecao, host as never);

  return {
    status: status.mock.calls[0]?.[0] as number,
    corpo: json.mock.calls[0]?.[0] as CorpoDoProblema,
  };
};

describe('status por código de erro', () => {
  it('conflito de CNPJ é 409', () => {
    expect(
      statusDoErro(new ErroDeConflito(CODIGOS_DE_ERRO.CNPJ_JA_UTILIZADO, 'em uso')),
    ).toBe(HttpStatus.CONFLICT);
  });

  it('cadastro incompleto é 403', () => {
    expect(
      statusDoErro(new ErroDeDominio(CODIGOS_DE_ERRO.CADASTRO_INCOMPLETO, 'bloqueado')),
    ).toBe(HttpStatus.FORBIDDEN);
  });

  it('campo inválido é 422', () => {
    expect(statusDoErro(new ErroDeDominio(CODIGOS_DE_ERRO.CNPJ_INVALIDO, 'inválido'))).toBe(
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  });
});

describe('corpo do problema', () => {
  it('carrega código estável, correlationId e os campos inválidos', () => {
    const problema = montarProblema(
      new ErroDeDominio(CODIGOS_DE_ERRO.CNPJ_INVALIDO, 'CNPJ inválido', [
        { campo: 'cnpj', codigo: CODIGOS_DE_ERRO.CNPJ_INVALIDO },
      ]),
      CORRELACAO,
    );

    expect(problema).toMatchObject({
      code: CODIGOS_DE_ERRO.CNPJ_INVALIDO,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      correlationId: CORRELACAO,
      campos: [{ campo: 'cnpj', codigo: CODIGOS_DE_ERRO.CNPJ_INVALIDO }],
    });
  });
});

describe('violação de constraint do banco', () => {
  it('CNPJ duplicado vira 409 com o código do domínio, não 500', () => {
    // A checagem prévia e a escrita não são atômicas: sob concorrência é a
    // constraint que separa as duas requisições (SPEC-001 §6).
    const { status, corpo } = capturar(erroDoBanco('23505', 'tenant_cnpj_key'));

    expect(status).toBe(HttpStatus.CONFLICT);
    expect(corpo.code).toBe(CODIGOS_DE_ERRO.CNPJ_JA_UTILIZADO);
  });

  it('segundo endereço principal vira 409 de conflito', () => {
    const { status, corpo } = capturar(
      erroDoBanco('23505', 'escritorio_endereco_principal_unico_idx'),
    );

    expect(status).toBe(HttpStatus.CONFLICT);
    expect(corpo.code).toBe(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO);
  });

  it('violação de CHECK vira 422, não falha interna', () => {
    const { status, corpo } = capturar(erroDoBanco('23514', 'tenant_cnpj_check'));

    expect(status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(corpo.code).toBe(CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO);
  });

  it('falha desconhecida continua 500 genérico, sem vazar detalhe', () => {
    const { status, corpo } = capturar(new Error('conexão recusada em 10.0.0.5:5432'));

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(corpo.code).toBe('ERRO_INTERNO');
    expect(JSON.stringify(corpo)).not.toContain('10.0.0.5');
  });
});
