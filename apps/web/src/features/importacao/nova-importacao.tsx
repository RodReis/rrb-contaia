/**
 * Começo de uma importação: escolher o CSV, mapear as colunas e enviar para validação
 * (SPEC-013/014 §5.2 itens 3 e 4). Ao ser aceito, o envio abre a tentativa na URL e o acompanhamento
 * assume. Quem não pode importar vê por quê, e o resto da aba continua disponível.
 */
'use client';

import { ArrowRight, Lock } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { APARENCIA_DO_ESTADO, formatarInstante, naoTerminada } from './apresentacao';
import type { DominioDaImportacao } from './dominio';
import { EnvioDoCsv, type ArquivoLido } from './envio-do-csv';
import { EtapasDaImportacao } from './etapas';
import { MapeamentoDeColunas } from './mapeamento-de-colunas';
import { useEnviarImportacao, useHistorico } from './queries';

/** A tentativa mais recente que ainda não terminou: quem volta à aba precisa achá-la. */
const AvisoDeTentativaAberta = ({
  dominio,
  empresaId,
  aoAbrir,
}: {
  dominio: DominioDaImportacao;
  empresaId: string;
  aoAbrir: (tentativaId: string) => void;
}) => {
  const { data } = useHistorico(dominio, empresaId, 1);
  const recente = data?.itens[0];

  if (recente === undefined || !naoTerminada(recente.estado)) {
    return null;
  }

  return (
    <div className="flex flex-col gap-sm rounded-md border border-warning-indicator/40 bg-warning px-md py-sm tablet:flex-row tablet:items-center tablet:justify-between">
      <p className="flex flex-wrap items-center gap-xs text-body-sm text-warning-foreground">
        <StatusBadge tom={APARENCIA_DO_ESTADO[recente.estado].tom} rotulo={APARENCIA_DO_ESTADO[recente.estado].rotulo} />
        <span>
          A importação de <span className="font-mono text-code-sm [overflow-wrap:anywhere]">{recente.arquivo.nome}</span>,
          enviada em <span className="tabular-nums">{formatarInstante(recente.inicioEm)}</span>, ainda não terminou.
        </span>
      </p>
      <Button variante="contorno" tamanho="compacto" onClick={() => aoAbrir(recente.id)}>
        Abrir importação
        <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
};

export const NovaImportacao = ({
  dominio,
  empresaId,
  podeImportar,
  aoAbrirTentativa,
}: {
  dominio: DominioDaImportacao;
  empresaId: string;
  podeImportar: boolean;
  aoAbrirTentativa: (tentativaId: string) => void;
}) => {
  const [lido, definirLido] = useState<ArquivoLido | null>(null);
  const enviar = useEnviarImportacao(dominio, empresaId);
  const falhaDoEnvio = enviar.error instanceof ErroDaApi ? enviar.error.problema : null;

  if (!podeImportar) {
    return (
      <div className="flex flex-col gap-md px-lg py-lg">
        <AvisoDeTentativaAberta dominio={dominio} empresaId={empresaId} aoAbrir={aoAbrirTentativa} />
        <div className="flex items-start gap-sm rounded-md bg-secondary px-md py-md">
          <Lock className="mt-xs size-icon-sm shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="max-w-prose text-body-sm text-muted-foreground">
            <span className="text-title-sm text-foreground">{dominio.textos.semPermissaoDeImportar.titulo}</span>{' '}
            {dominio.textos.semPermissaoDeImportar.descricao}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-lg px-lg py-lg">
      <EtapasDaImportacao atual={lido === null ? 'arquivo' : 'mapeamento'} />
      <AvisoDeTentativaAberta dominio={dominio} empresaId={empresaId} aoAbrir={aoAbrirTentativa} />

      {lido === null ? (
        <EnvioDoCsv
          dominio={dominio}
          aoLer={(novo) => {
            enviar.reset();
            definirLido(novo);
          }}
        />
      ) : (
        <MapeamentoDeColunas
          dominio={dominio}
          key={`${lido.arquivo.name}-${lido.arquivo.size}-${lido.arquivo.lastModified}`}
          lido={lido}
          enviando={enviar.isPending}
          falhaDoEnvio={falhaDoEnvio}
          aoTrocar={() => {
            enviar.reset();
            definirLido(null);
          }}
          aoEnviar={(mapeamento) =>
            enviar.mutate(
              { arquivo: lido.arquivo, mapeamento },
              { onSuccess: (previa) => aoAbrirTentativa(previa.tentativaId) },
            )
          }
        />
      )}
    </div>
  );
};
