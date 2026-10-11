import { expect } from 'vitest';

import { ErroDePlanilha, type CodigoDoLeitor, type DetalheDoErro } from '../erros.ts';

/**
 * Teto de relógio dos testes de desempenho/hostis. Generoso de propósito: o normal é milissegundos e a
 * regressão que o teste pega (laço quente, inflar a bomba, expandir a mescla) leva minutos; um teto
 * apertado só falharia em runner carregado, e a CI não admite rerun cego. O tempo real vai no log.
 */
export const TETO_DE_RELOGIO_MS = 15_000;
/** Prazo do Vitest para um teste com `TETO_DE_RELOGIO_MS` (o padrão de 5 s cortaria antes do teto). */
export const PRAZO_DO_TESTE_MS = 30_000;

/** Mede `fn` (que pode lançar: o código é conferido à parte) e registra o tempo no log do teste. */
export const cronometrar = (rotulo: string, fn: () => unknown): number => {
  const inicio = performance.now();
  try {
    fn();
  } catch {
    // o código é conferido à parte
  }
  const ms = performance.now() - inicio;
  console.warn(`[desempenho] ${rotulo}: ${ms.toFixed(0)} ms`);
  return ms;
};

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
