/**
 * Estados da leitura da planilha (SPEC-015 §3.10, §5.3): lendo, planilha que não pode ser usada
 * (protegida, corrompida, formato incompatível, limite) e leitura que falhou por motivo passageiro
 * (serviço ocupado, rede), com a nova tentativa só depois da espera pedida pela API.
 *
 * Estado persistente na tela, nunca só toast; cada recusa diz como corrigir o arquivo ou a escolha.
 */
'use client';

import { CODIGOS_DE_ERRO_DE_PLANILHA } from '@contaia/shared';
import { FileX2, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ErroDaApi, type Problema } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { CodigoDeSuporte } from './pecas';

/** Defeito do arquivo: tentar de novo com o mesmo arquivo dá o mesmo resultado. */
const DEFEITOS_DO_ARQUIVO: readonly string[] = [
  ...CODIGOS_DE_ERRO_DE_PLANILHA.filter((codigo) => codigo !== 'SERVICO_OCUPADO'),
  'ARQUIVO_ACIMA_DO_LIMITE',
  'ARQUIVO_INVALIDO',
  'ARQUIVO_VAZIO',
];

const ehDefeitoDoArquivo = (problema: Problema): boolean => DEFEITOS_DO_ARQUIVO.includes(problema.code);

/** O que falhou, como problem+json; resposta fora do contrato vira "erro desconhecido". */
export const problemaDa = (erro: unknown): Problema =>
  erro instanceof ErroDaApi
    ? erro.problema
    : {
        type: 'https://contaia.local/erros/desconhecido',
        title: 'Resposta inesperada.',
        status: 0,
        code: 'ERRO_DESCONHECIDO',
        correlationId: 'sem-correlacao',
      };

export const LendoPlanilha = ({ titulo, descricao }: { titulo: string; descricao: string }) => (
  <div className="flex items-start gap-sm rounded-md border border-info-indicator/40 bg-info px-md py-md">
    <LoaderCircle className="mt-xs size-icon-lg shrink-0 text-info-foreground motion-safe:animate-spin" aria-hidden="true" />
    <div className="flex flex-col gap-xs">
      <p className="font-display text-headline-sm text-info-foreground">{titulo}</p>
      <p className="max-w-prose text-body-sm text-info-foreground">{descricao}</p>
    </div>
  </div>
);

/** Botão que só libera depois do `Retry-After`; sem espera pedida, libera na hora. */
const NovaTentativa = ({ segundos, aoTentar }: { segundos: number | undefined; aoTentar: () => void }) => {
  const [liberada, definirLiberada] = useState(segundos === undefined || segundos <= 0);

  useEffect(() => {
    if (liberada || segundos === undefined) {
      return undefined;
    }

    const espera = setTimeout(() => definirLiberada(true), segundos * 1_000);

    return () => clearTimeout(espera);
  }, [liberada, segundos]);

  return (
    <div className="flex flex-wrap items-center gap-sm">
      <Button variante="contorno" tamanho="compacto" disabled={!liberada} onClick={aoTentar}>
        <RefreshCw aria-hidden="true" />
        Tentar de novo
      </Button>
      {liberada || segundos === undefined ? null : (
        <span className="text-body-sm tabular-nums">{`Disponível em ${segundos} segundos.`}</span>
      )}
    </div>
  );
};

/**
 * Falha da leitura. Defeito do arquivo: o motivo, o código de suporte e a troca de arquivo.
 * Passageira: a nova tentativa (depois da espera) e, ainda assim, a troca de arquivo.
 */
export const FalhaDaLeitura = ({
  erro,
  aoTentar,
  aoTrocar,
}: {
  erro: unknown;
  aoTentar: () => void;
  aoTrocar: () => void;
}) => {
  const problema = problemaDa(erro);
  const defeito = ehDefeitoDoArquivo(problema);
  const espera = problema.retryAfterSegundos;

  return (
    <div
      role="alert"
      className={
        defeito
          ? 'flex flex-col gap-sm rounded-md border border-danger-indicator/40 bg-danger px-md py-md text-danger-foreground'
          : 'flex flex-col gap-sm rounded-md border border-warning-indicator/40 bg-warning px-md py-md text-warning-foreground'
      }
    >
      <div className="flex items-start gap-sm">
        {defeito ? (
          <FileX2 className="mt-xs size-icon-lg shrink-0" aria-hidden="true" />
        ) : (
          <TriangleAlert className="mt-xs size-icon-lg shrink-0" aria-hidden="true" />
        )}
        <div className="flex min-w-0 flex-col gap-xs">
          <p className="font-display text-headline-sm">
            {defeito ? 'Esta planilha não pode ser usada' : 'Não foi possível ler a planilha agora'}
          </p>
          <p className="max-w-prose text-body-md">{mensagemDoCodigo(problema.code)}</p>
          <CodigoDeSuporte valor={problema.correlationId} className="text-body-sm" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-sm">
        {defeito ? null : <NovaTentativa key={problema.correlationId} segundos={espera} aoTentar={aoTentar} />}
        <Button variante={defeito ? 'contorno' : 'fantasma'} tamanho="compacto" onClick={aoTrocar}>
          Escolher outro arquivo
        </Button>
      </div>
    </div>
  );
};
