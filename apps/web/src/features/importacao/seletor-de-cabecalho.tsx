/**
 * Escolha da linha de cabeçalho sobre a amostra da aba (SPEC-015 §3.4, §5.2 item 4).
 *
 * Um rádio de verdade por linha, todos no mesmo grupo: Tab entra no grupo, as setas trocam a linha
 * (comportamento do navegador) e o leitor de tela diz "Linha 3 como cabeçalho". Os números são os
 * da planilha original. A linha escolhida, as ignoradas e as ocultas são ditas por texto na própria
 * linha, não só pela cor. Valor longo fica numa linha, inteiro no título.
 */
'use client';

import type { InspecaoDePlanilha } from '@contaia/shared';
import { EyeOff } from 'lucide-react';
import { clsx } from 'clsx';
import { useId } from 'react';

import { formatarNumero } from './apresentacao';
import { letrasDasColunas } from './apresentacao-da-planilha';
import { RegiaoRolavel } from './pecas';

type LinhaDaAmostra = InspecaoDePlanilha['amostra'][number];

const Marca = ({ tom, children }: { tom: 'cabecalho' | 'ignorada' | 'oculta'; children: string }) => (
  <span
    className={clsx(
      'inline-flex items-center gap-xs rounded-sm px-xs font-sans text-label-sm',
      tom === 'cabecalho' && 'bg-info text-info-foreground',
      tom === 'ignorada' && 'bg-muted text-muted-foreground',
      tom === 'oculta' && 'bg-warning text-warning-foreground',
    )}
  >
    {tom === 'oculta' ? <EyeOff className="size-icon-xs shrink-0" aria-hidden="true" /> : null}
    {children}
  </span>
);

export const SeletorDeCabecalho = ({
  nomeDaAba,
  amostra,
  linhaCabecalho,
  bloqueado,
  aoEscolher,
}: {
  nomeDaAba: string;
  amostra: readonly LinhaDaAmostra[];
  linhaCabecalho: number;
  bloqueado: boolean;
  aoEscolher: (linha: number) => void;
}) => {
  const grupo = useId();
  const letras = letrasDasColunas(amostra.map((linha) => linha.celulas));

  return (
    <RegiaoRolavel rotulo="Amostra da aba para escolher o cabeçalho, rolável na horizontal" className="rounded-md border border-border">
      <table className="w-full min-w-max text-left">
        <caption className="sr-only">Primeiras linhas da aba {nomeDaAba}; escolha a linha do cabeçalho</caption>
        <thead className="bg-muted">
          <tr>
            <th scope="col" className="w-0 px-sm py-sm text-label-sm uppercase text-muted-foreground">
              Cabeçalho
            </th>
            <th scope="col" className="px-sm py-sm text-label-sm uppercase text-muted-foreground">
              Linha
            </th>
            {letras.map((letra) => (
              <th key={letra} scope="col" className="px-sm py-sm font-mono text-code-xs text-muted-foreground">
                {letra}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {amostra.map((linha) => {
            const escolhida = linha.numero === linhaCabecalho;
            const ignorada = linha.numero < linhaCabecalho;

            return (
              <tr
                key={linha.numero}
                className={clsx(
                  'border-t border-border align-top transition-colors duration-fast ease-out',
                  escolhida ? 'bg-accent' : 'hover:bg-accent/40',
                )}
              >
                <td className="px-sm py-sm">
                  <input
                    type="radio"
                    name={grupo}
                    value={linha.numero}
                    checked={escolhida}
                    disabled={bloqueado}
                    aria-label={`Linha ${linha.numero} como cabeçalho`}
                    onChange={() => aoEscolher(linha.numero)}
                    className="mt-xs size-4 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </td>
                <th scope="row" className="whitespace-nowrap px-sm py-sm text-left font-normal">
                  <span className="flex flex-wrap items-center gap-xs">
                    <span className="font-mono text-code-sm tabular-nums text-foreground">{formatarNumero(linha.numero)}</span>
                    {escolhida ? <Marca tom="cabecalho">cabeçalho</Marca> : null}
                    {ignorada ? <Marca tom="ignorada">ignorada</Marca> : null}
                    {linha.oculta ? <Marca tom="oculta">oculta</Marca> : null}
                  </span>
                </th>
                {letras.map((letra) => {
                  const valor = linha.celulas[letra] ?? '';

                  return (
                    <td
                      key={letra}
                      className={clsx(
                        'px-sm py-sm',
                        // O cabeçalho é texto (nome de coluna); os dados, valor exibido em mono.
                        escolhida ? 'text-title-sm' : 'font-mono text-code-sm tabular-nums',
                        ignorada ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    >
                      {valor === '' ? (
                        <span className="font-sans text-body-sm text-muted-foreground">—</span>
                      ) : (
                        <span title={valor} className="block max-w-[14rem] truncate">
                          {valor}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </RegiaoRolavel>
  );
};
