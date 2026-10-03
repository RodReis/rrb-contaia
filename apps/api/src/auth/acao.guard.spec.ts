import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  permissoesDoPapelPadrao,
  permissoesDosPapeisPadrao,
  type ChaveDePermissao,
  type PapelPadrao,
} from '@contaia/domain';

import { AcaoLivre, ExigePermissao, GuardDeAcao } from './acao.guard';
import type { RequisicaoAutenticada } from './sessao.guard';

const contextoDe = (
  permissoes: readonly ChaveDePermissao[] | undefined,
  alvo: Readonly<{ classe: object; metodo: (...argumentos: never[]) => unknown }>,
): ExecutionContext => {
  const requisicao = {
    sessao: permissoes === undefined ? undefined : { permissoes },
  } as unknown as RequisicaoAutenticada;

  return {
    switchToHttp: () => ({ getRequest: () => requisicao }),
    getHandler: () => alvo.metodo,
    getClass: () => alvo.classe,
  } as unknown as ExecutionContext;
};

const dosPapeis = (...papeis: PapelPadrao[]): readonly ChaveDePermissao[] =>
  permissoesDosPapeisPadrao(papeis);

class ControllerDeTeste {
  @ExigePermissao('empresas.cadastro.arquivar')
  arquivar(): void {}

  @ExigePermissao('empresas.cadastro.consultar')
  consultar(): void {}

  @AcaoLivre()
  livre(): void {}

  // Quem lê a aba de usuários no Histórico precisa das duas permissões.
  @ExigePermissao('historico.global.consultar', 'usuarios.usuarios_e_papeis.consultar')
  historicoDeUsuarios(): void {}

  semAnotacao(): void {}

  @ExigePermissao()
  semChaves(): void {}
}

@ExigePermissao('documentos.analise.aprovar')
class ControllerComDefaultNaClasse {
  mutar(): void {}

  @ExigePermissao('documentos.arquivos.consultar')
  ler(): void {}
}

const guard = new GuardDeAcao(new Reflector());
const alvo = (metodo: keyof ControllerDeTeste) => ({
  classe: ControllerDeTeste,
  metodo: ControllerDeTeste.prototype[metodo],
});

const codigoDe = (funcao: () => unknown): string | undefined => {
  try {
    funcao();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : 'OUTRO';
  }

  return undefined;
};

describe('GuardDeAcao', () => {
  it('permite quando algum papel concede a permissão (permissões aditivas)', () => {
    expect(
      guard.canActivate(contextoDe(dosPapeis('auxiliar', 'contador'), alvo('arquivar'))),
    ).toBe(true);
  });

  it('nega com SEM_AUTORIZACAO quando nenhum papel concede a permissão', () => {
    expect(
      codigoDe(() => guard.canActivate(contextoDe(dosPapeis('auxiliar'), alvo('arquivar')))),
    ).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
    expect(
      codigoDe(() => guard.canActivate(contextoDe(dosPapeis('auditor_readonly'), alvo('arquivar')))),
    ).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
  });

  it('auditor consulta, mas não muta', () => {
    expect(guard.canActivate(contextoDe(dosPapeis('auditor_readonly'), alvo('consultar')))).toBe(
      true,
    );
  });

  it('nega quando a sessão não existe', () => {
    expect(codigoDe(() => guard.canActivate(contextoDe(undefined, alvo('consultar'))))).toBe(
      CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
    );
  });

  it('nega usuário sem nenhuma permissão', () => {
    expect(codigoDe(() => guard.canActivate(contextoDe([], alvo('consultar'))))).toBe(
      CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
    );
  });

  it('rota marcada como livre aceita qualquer sessão autenticada', () => {
    expect(guard.canActivate(contextoDe([], alvo('livre')))).toBe(true);
  });

  it('rota sem anotação é negada: o esquecimento falha fechado', () => {
    expect(
      codigoDe(() =>
        guard.canActivate(contextoDe(dosPapeis('admin_escritorio'), alvo('semAnotacao'))),
      ),
    ).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
  });

  it('anotação sem nenhuma chave também falha fechado', () => {
    expect(
      codigoDe(() =>
        guard.canActivate(contextoDe(dosPapeis('admin_escritorio'), alvo('semChaves'))),
      ),
    ).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
  });

  it('exige todas as chaves: contador lê o Histórico mas não os usuários', () => {
    const lerAba = (...papeis: PapelPadrao[]) =>
      codigoDe(() => guard.canActivate(contextoDe(dosPapeis(...papeis), alvo('historicoDeUsuarios'))));

    expect(lerAba('admin_escritorio')).toBeUndefined();
    expect(lerAba('auditor_readonly')).toBeUndefined();
    expect(lerAba('contador')).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
    expect(lerAba('auxiliar')).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
  });

  it('soma papéis: contador + auditor satisfaz as duas permissões', () => {
    expect(
      guard.canActivate(
        contextoDe(dosPapeis('contador', 'auditor_readonly'), alvo('historicoDeUsuarios')),
      ),
    ).toBe(true);
  });

  it('o método sobrescreve o padrão da classe', () => {
    const classe = ControllerComDefaultNaClasse;

    expect(
      guard.canActivate(
        contextoDe(dosPapeis('auditor_readonly'), { classe, metodo: classe.prototype.ler }),
      ),
    ).toBe(true);
    expect(
      codigoDe(() =>
        guard.canActivate(
          contextoDe(dosPapeis('auditor_readonly'), { classe, metodo: classe.prototype.mutar }),
        ),
      ),
    ).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
    expect(
      guard.canActivate(
        contextoDe(dosPapeis('auxiliar'), { classe, metodo: classe.prototype.mutar }),
      ),
    ).toBe(true);
  });
});

describe('permissão de papel personalizado na mesma checagem', () => {
  it('chave concedida só pelo papel personalizado vale como qualquer outra', () => {
    const efetiva: readonly ChaveDePermissao[] = ['empresas.cadastro.arquivar'];

    expect(guard.canActivate(contextoDe(efetiva, alvo('arquivar')))).toBe(true);
    expect(codigoDe(() => guard.canActivate(contextoDe(efetiva, alvo('consultar'))))).toBe(
      CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
    );
  });

  it('o papel personalizado nunca abre a área exclusiva, mesmo que a chave apareça na sessão', () => {
    const administracao = permissoesDoPapelPadrao('admin_escritorio').filter((chave) =>
      chave.startsWith('usuarios.'),
    );

    expect(administracao.length).toBeGreaterThan(0);
    expect(
      codigoDe(() =>
        guard.canActivate(
          contextoDe(['empresas.cadastro.consultar'], alvo('historicoDeUsuarios')),
        ),
      ),
    ).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
  });
});
