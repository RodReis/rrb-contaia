import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio, type PapelPadrao } from '@contaia/domain';

import { AcaoLivre, ExigeAcao, GuardDeAcao } from './acao.guard';
import type { RequisicaoAutenticada } from './sessao.guard';

const contextoDe = (
  papeis: readonly PapelPadrao[] | undefined,
  alvo: Readonly<{ classe: object; metodo: (...argumentos: never[]) => unknown }>,
): ExecutionContext => {
  const requisicao = {
    sessao: papeis === undefined ? undefined : { papeis },
  } as unknown as RequisicaoAutenticada;

  return {
    switchToHttp: () => ({ getRequest: () => requisicao }),
    getHandler: () => alvo.metodo,
    getClass: () => alvo.classe,
  } as unknown as ExecutionContext;
};

class ControllerDeTeste {
  @ExigeAcao('EMPRESAS', 'arquivar')
  arquivar(): void {}

  @ExigeAcao('EMPRESAS', 'consultar')
  consultar(): void {}

  @AcaoLivre()
  livre(): void {}

  semAnotacao(): void {}
}

@ExigeAcao('DOCUMENTOS', 'administrar')
class ControllerComDefaultNaClasse {
  mutar(): void {}

  @ExigeAcao('DOCUMENTOS', 'consultar')
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
  it('permite quando algum papel concede a ação (permissões aditivas)', () => {
    expect(guard.canActivate(contextoDe(['auxiliar', 'contador'], alvo('arquivar')))).toBe(true);
  });

  it('nega com SEM_AUTORIZACAO quando nenhum papel concede a ação', () => {
    expect(codigoDe(() => guard.canActivate(contextoDe(['auxiliar'], alvo('arquivar'))))).toBe(
      CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
    );
    expect(
      codigoDe(() => guard.canActivate(contextoDe(['auditor_readonly'], alvo('arquivar')))),
    ).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
  });

  it('auditor consulta, mas não muta', () => {
    expect(guard.canActivate(contextoDe(['auditor_readonly'], alvo('consultar')))).toBe(true);
  });

  it('nega quando a sessão não existe', () => {
    expect(codigoDe(() => guard.canActivate(contextoDe(undefined, alvo('consultar'))))).toBe(
      CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
    );
  });

  it('nega usuário sem nenhum papel', () => {
    expect(codigoDe(() => guard.canActivate(contextoDe([], alvo('consultar'))))).toBe(
      CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
    );
  });

  it('rota marcada como livre aceita qualquer sessão autenticada', () => {
    expect(guard.canActivate(contextoDe([], alvo('livre')))).toBe(true);
  });

  it('rota sem anotação é negada: o esquecimento falha fechado', () => {
    expect(
      codigoDe(() => guard.canActivate(contextoDe(['admin_escritorio'], alvo('semAnotacao')))),
    ).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
  });

  it('o método sobrescreve o padrão da classe', () => {
    const classe = ControllerComDefaultNaClasse;

    expect(
      guard.canActivate(
        contextoDe(['auditor_readonly'], { classe, metodo: classe.prototype.ler }),
      ),
    ).toBe(true);
    expect(
      codigoDe(() =>
        guard.canActivate(
          contextoDe(['auditor_readonly'], { classe, metodo: classe.prototype.mutar }),
        ),
      ),
    ).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
    expect(
      guard.canActivate(contextoDe(['auxiliar'], { classe, metodo: classe.prototype.mutar })),
    ).toBe(true);
  });
});
