import { expect } from 'vitest';

import { ErroDePlanilha, type CodigoDoLeitor, type DetalheDoErro } from '../erros.ts';

/** Executa `fn` e confere que lançou `ErroDePlanilha` com o código (e o detalhe interno) esperado. */
export const esperarErro = (fn: () => unknown, codigo: CodigoDoLeitor, detalhe?: DetalheDoErro): ErroDePlanilha => {
  let lancado: unknown;
  try {
    fn();
  } catch (erro) {
    lancado = erro;
  }
  expect(lancado).toBeInstanceOf(ErroDePlanilha);
  const erro = lancado as ErroDePlanilha;
  expect(erro.codigo).toBe(codigo);
  if (detalhe !== undefined) expect(erro.detalhe).toBe(detalhe);
  return erro;
};

export const esperarErroAssincrono = async (
  promessa: Promise<unknown>,
  codigo: CodigoDoLeitor,
  detalhe?: DetalheDoErro,
): Promise<ErroDePlanilha> => {
  const lancado = await promessa.then(
    () => undefined,
    (erro: unknown) => erro,
  );
  expect(lancado).toBeInstanceOf(ErroDePlanilha);
  const erro = lancado as ErroDePlanilha;
  expect(erro.codigo).toBe(codigo);
  if (detalhe !== undefined) expect(erro.detalhe).toBe(detalhe);
  return erro;
};
