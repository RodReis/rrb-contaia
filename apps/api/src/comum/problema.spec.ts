/**
 * Contrato de erro HTTP: todo erro exposto sai como `application/problem+json`
 * com código estável (CONVENTION.md §9).
 */
import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio } from '@contaia/domain';

import { FiltroDeProblema, montarProblema, obterCorrelationId, statusDoErro } from './problema';
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

describe('Signer (SPEC-012 §7)', () => {
  it('Signer fora do ar é falha de dependência: 503, não entrada inválida', () => {
    const { status, corpo } = capturar(new ErroDeDominio(CODIGOS_DE_ERRO.SIGNER_INDISPONIVEL, 'O Signer está indisponível.'));

    expect(status).toBe(503);
    expect(corpo.code).toBe('SIGNER_INDISPONIVEL');
  });

  it('segundo teste manual enquanto o primeiro roda é conflito de estado: 409', () => {
    const { status, corpo } = capturar(
      new ErroDeConflito(CODIGOS_DE_ERRO.SIGNER_TESTE_EM_ANDAMENTO, 'Já há um teste em andamento.'),
    );

    expect(status).toBe(409);
    expect(corpo.code).toBe('SIGNER_TESTE_EM_ANDAMENTO');
  });
});

describe('correlationId vindo de fora', () => {
  const com = (valor: string | undefined): string =>
    obterCorrelationId({ header: () => valor } as never);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

  it('aceita UUID e o formato [A-Za-z0-9-]{8,64}', () => {
    const uuid = '01927b5c-8e1a-7c3d-9a1b-0123456789ab';

    expect(com(uuid)).toBe(uuid);
    expect(com('corr-de-teste')).toBe('corr-de-teste');
    expect(com('a'.repeat(64))).toBe('a'.repeat(64));
  });

  it.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['curto demais', 'abc-123'],
    ['longo demais', 'a'.repeat(65)],
    ['com espaço', 'corr com espaco'],
    ['com quebra de linha (injeção de log)', 'corr-1234\nINFO falsa'],
    ['com símbolos', 'corr_1234;drop'],
  ])('%s é descartado e vira um UUID novo', (_nome, valor) => {
    const gerado = com(valor);

    expect(gerado).toMatch(UUID);
    expect(gerado).not.toBe(valor);
  });
});

describe('status por código de erro', () => {
  it('conflito de CNPJ é 409', () => {
    expect(
      statusDoErro(new ErroDeConflito(CODIGOS_DE_ERRO.CNPJ_JA_UTILIZADO, 'em uso')),
    ).toBe(HttpStatus.CONFLICT);
  });

  it('dispensar pendência do cofre é conflito (409)', () => {
    expect(statusDoErro(new ErroDeDominio(CODIGOS_DE_ERRO.PENDENCIA_NAO_DISPENSAVEL, 'x'))).toBe(
      HttpStatus.CONFLICT,
    );
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

  it('e-mail de usuário repetido vira 409 EMAIL_JA_UTILIZADO sem revelar o escritório (SPEC-007 §6)', () => {
    const { status, corpo } = capturar(erroDoBanco('23505', 'usuario_email_unico'));

    expect(status).toBe(HttpStatus.CONFLICT);
    expect(corpo.code).toBe(CODIGOS_DE_ERRO.EMAIL_JA_UTILIZADO);
    expect(JSON.stringify(corpo)).not.toContain('usuario_email_unico');
  });
});

describe('status dos códigos de usuários e convite (SPEC-007 §6)', () => {
  const casos: ReadonlyArray<readonly [keyof typeof CODIGOS_DE_ERRO, number]> = [
    ['SEM_ALCADA', HttpStatus.FORBIDDEN],
    ['USUARIO_NAO_ENCONTRADO', HttpStatus.NOT_FOUND],
    ['CONVITE_INVALIDO', HttpStatus.NOT_FOUND],
    ['EMAIL_JA_UTILIZADO', HttpStatus.CONFLICT],
    ['ULTIMO_ADMIN', HttpStatus.CONFLICT],
    ['USUARIO_ARQUIVADO_USE_NOVO_CONVITE', HttpStatus.CONFLICT],
    ['TRANSICAO_DE_USUARIO_INVALIDA', HttpStatus.CONFLICT],
    ['EMAIL_IMUTAVEL', HttpStatus.UNPROCESSABLE_ENTITY],
    ['PAPEL_OBRIGATORIO', HttpStatus.UNPROCESSABLE_ENTITY],
    ['PAPEL_INVALIDO', HttpStatus.UNPROCESSABLE_ENTITY],
    ['SENHA_FRACA', HttpStatus.UNPROCESSABLE_ENTITY],
    ['IDENTIDADE_INDISPONIVEL', HttpStatus.SERVICE_UNAVAILABLE],
  ];

  it.each(casos)('%s responde %i', (codigo, esperado) => {
    expect(statusDoErro(new ErroDeDominio(CODIGOS_DE_ERRO[codigo], 'x'))).toBe(esperado);
  });
});

describe('status dos códigos de papéis personalizados (SPEC-008 §6)', () => {
  const casos: ReadonlyArray<readonly [keyof typeof CODIGOS_DE_ERRO, number]> = [
    ['PAPEL_NAO_ENCONTRADO', HttpStatus.NOT_FOUND],
    ['PERMISSAO_EXCLUSIVA', HttpStatus.FORBIDDEN],
    ['PAPEL_NOME_DUPLICADO', HttpStatus.CONFLICT],
    ['PAPEL_EM_USO', HttpStatus.CONFLICT],
    ['PAPEL_ARQUIVADO', HttpStatus.CONFLICT],
    ['TRANSICAO_DE_PAPEL_INVALIDA', HttpStatus.CONFLICT],
    ['REDUCAO_NAO_CONFIRMADA', HttpStatus.CONFLICT],
    ['REVISAO_NAO_CONFIRMADA', HttpStatus.CONFLICT],
    ['CONFLITO_DE_VERSAO', HttpStatus.CONFLICT],
    ['MATRIZ_INVALIDA', HttpStatus.UNPROCESSABLE_ENTITY],
    ['PERMISSAO_INEXISTENTE', HttpStatus.UNPROCESSABLE_ENTITY],
  ];

  it.each(casos)('%s responde %i', (codigo, esperado) => {
    expect(statusDoErro(new ErroDeDominio(CODIGOS_DE_ERRO[codigo], 'x'))).toBe(esperado);
  });

  it('nome de papel duplicado sob concorrência vira 409 PAPEL_NOME_DUPLICADO, não 500', () => {
    const { status, corpo } = capturar(erroDoBanco('23505', 'papel_personalizado_nome_unico'));

    expect(status).toBe(HttpStatus.CONFLICT);
    expect(corpo.code).toBe(CODIGOS_DE_ERRO.PAPEL_NOME_DUPLICADO);
    expect(JSON.stringify(corpo)).not.toContain('papel_personalizado_nome_unico');
  });
});

describe('status dos códigos da importação do plano de contas (SPEC-013)', () => {
  const casos: ReadonlyArray<readonly [keyof typeof CODIGOS_DE_ERRO, number]> = [
    ['TENTATIVA_NAO_ENCONTRADA', HttpStatus.NOT_FOUND],
    ['ESTADO_INVALIDO_PARA_ACAO', HttpStatus.CONFLICT],
    ['CONFLITO_DE_VERSAO', HttpStatus.CONFLICT],
    ['FILA_INDISPONIVEL', HttpStatus.SERVICE_UNAVAILABLE],
    ['FALHA_TECNICA', HttpStatus.INTERNAL_SERVER_ERROR],
    ['ARQUIVO_ACIMA_DO_LIMITE', HttpStatus.PAYLOAD_TOO_LARGE],
    ['ARQUIVO_VAZIO', HttpStatus.UNPROCESSABLE_ENTITY],
    ['CABECALHO_INVALIDO', HttpStatus.UNPROCESSABLE_ENTITY],
    ['MAPEAMENTO_INCOMPLETO', HttpStatus.UNPROCESSABLE_ENTITY],
    // CSV ilegível (aspas malformadas, binário) e formato não aceito: rejeição de arquivo, 422.
    ['ARQUIVO_INVALIDO', HttpStatus.UNPROCESSABLE_ENTITY],
  ];

  it.each(casos)('%s responde %i', (codigo, esperado) => {
    expect(statusDoErro(new ErroDeDominio(CODIGOS_DE_ERRO[codigo], 'x'))).toBe(esperado);
  });

  it('arquivo acima do limite sai como problem+json 413 com o código estável', () => {
    const { status, corpo } = capturar(
      new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE, 'Arquivo acima de 10 MB.'),
    );

    expect(status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(corpo.code).toBe('ARQUIVO_ACIMA_DO_LIMITE');
    expect(corpo.type).toMatch(/arquivo-acima-do-limite$/u);
  });
});
