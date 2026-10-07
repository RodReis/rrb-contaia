/**
 * Histórico operacional do Signer na empresa (SPEC-012 §3.11, §5.3): 15 itens por página, do mais
 * recente ao mais antigo, com filtro por finalidade e resultado. Sucessos, falhas e recusas
 * aparecem; nada do conteúdo da operação aparece nem pode ser expandido ou baixado.
 *
 * Só se lê o que o contrato público declara: um campo a mais na resposta é ignorado, nunca
 * renderizado (a referência do segredo e o XML não têm lugar nesta tela).
 */
'use client';

import {
  FINALIDADES,
  ITENS_POR_PAGINA_DO_HISTORICO,
  RESULTADOS_DO_HISTORICO,
  type Finalidade,
  type HistoricoPublicoDoSigner,
  type ItemDoHistoricoPublico,
  type ResultadoDoHistorico,
} from '@contaia/shared';
import { FileClock, Lock, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';

import { formatarQuando } from '../../carteira/rotulos';
import { TODOS } from '../apresentacao';
import type { FiltroDoHistoricoDoSigner } from './api';
import {
  APRESENTACAO_DO_RESULTADO,
  ROTULO_DA_FINALIDADE,
  mensagemDoSigner,
  textoDaLatencia,
} from './apresentacao';
import { useHistoricoDoSigner } from './queries';

const OPCOES_DE_FINALIDADE = [
  { valor: TODOS, rotulo: 'Todas as finalidades' },
  ...FINALIDADES.map((valor) => ({ valor, rotulo: ROTULO_DA_FINALIDADE[valor] })),
];

const OPCOES_DE_RESULTADO = [
  { valor: TODOS, rotulo: 'Qualquer resultado' },
  ...RESULTADOS_DO_HISTORICO.map((valor) => ({ valor, rotulo: APRESENTACAO_DO_RESULTADO[valor].rotulo })),
];

const ehFinalidade = (valor: string): valor is Finalidade => (FINALIDADES as readonly string[]).includes(valor);
const ehResultado = (valor: string): valor is ResultadoDoHistorico =>
  (RESULTADOS_DO_HISTORICO as readonly string[]).includes(valor);

const ORIGEM: Readonly<Record<'AUTOMATICO' | 'MANUAL', string>> = {
  AUTOMATICO: 'Teste automático',
  MANUAL: 'Teste manual',
};

/** `urn:contaia:servico:worker` → `worker`: a identidade técnica, sem o prefixo do esquema. */
const nomeDoServico = (identidade: string): string => identidade.split(':').pop() ?? identidade;

const Evento = ({ evento }: { evento: ItemDoHistoricoPublico }) => {
  const resultado = APRESENTACAO_DO_RESULTADO[evento.resultado];
  const motivo = evento.codigo === null ? null : mensagemDoSigner(evento.codigo);

  return (
    <li className="flex flex-col gap-xs border-b border-border py-md last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-sm gap-y-xs">
        <time dateTime={evento.iniciadoEm} className="font-mono text-code-sm tabular-nums text-muted-foreground">
          {formatarQuando(evento.iniciadoEm).replace(',', '')}
        </time>
        <StatusBadge tom="neutro" rotulo={ROTULO_DA_FINALIDADE[evento.finalidade]} />
        <StatusBadge tom={resultado.tom} rotulo={resultado.rotulo} />
        <span className="font-mono text-code-sm tabular-nums text-muted-foreground">
          {textoDaLatencia(evento.latenciaMs)}
        </span>
      </div>
      {motivo === null ? null : (
        <p className="max-w-prose text-body-sm text-foreground [overflow-wrap:anywhere]">{motivo}</p>
      )}
      <p className="flex flex-wrap items-center gap-x-sm gap-y-xs text-body-sm text-muted-foreground">
        {evento.origemDiagnostico === null ? null : <span>{ORIGEM[evento.origemDiagnostico]}</span>}
        <span>Chamado por {nomeDoServico(evento.identidadeTecnica)}</span>
        {evento.reutilizado ? <span>Resultado reutilizado</span> : null}
      </p>
      <p className="text-body-sm text-muted-foreground">
        Código de suporte:{' '}
        <span className="font-mono text-code-sm [overflow-wrap:anywhere]">{evento.correlationId}</span>
      </p>
    </li>
  );
};

const Esqueleto = () => (
  <div className="flex flex-col gap-sm" aria-busy="true">
    <span className="sr-only">Carregando o histórico do Signer</span>
    {Array.from({ length: 4 }, (_, indice) => (
      <Skeleton key={indice} className="h-16 w-full" />
    ))}
  </div>
);

type UltimaLeitura = Readonly<{
  finalidade: Finalidade | null;
  resultado: ResultadoDoHistorico | null;
  dados: HistoricoPublicoDoSigner;
}>;

export const HistoricoDoSigner = ({ empresaId }: { empresaId: string }) => {
  const [filtro, definirFiltro] = useState<FiltroDoHistoricoDoSigner>({
    pagina: 1,
    finalidade: null,
    resultado: null,
  });
  const consulta = useHistoricoDoSigner(empresaId, filtro, true);
  const [ultima, definirUltima] = useState<UltimaLeitura | null>(null);

  // Guarda a última página lida de verdade: se a próxima falhar, ela segue na tela, marcada.
  // Atualizado durante a renderização (e não em efeito): é estado derivado da consulta.
  if (consulta.data !== undefined && !consulta.isPlaceholderData && ultima?.dados !== consulta.data) {
    definirUltima({ finalidade: filtro.finalidade, resultado: filtro.resultado, dados: consulta.data });
  }

  const temFiltro = filtro.finalidade !== null || filtro.resultado !== null;
  const limpar = (): void => definirFiltro({ pagina: 1, finalidade: null, resultado: null });
  const irParaPagina = (pagina: number): void => definirFiltro((atual) => ({ ...atual, pagina }));

  const lidaComOMesmoFiltro =
    ultima !== null && ultima.finalidade === filtro.finalidade && ultima.resultado === filtro.resultado
      ? ultima.dados
      : undefined;
  const dados = consulta.isError ? lidaComOMesmoFiltro : (consulta.data ?? lidaComOMesmoFiltro);

  const barraDeFiltro = (
    <div className="flex flex-col gap-md tablet:flex-row tablet:flex-wrap tablet:items-end">
      <div className="w-full tablet:w-[14rem]">
        <Select
          rotulo="Finalidade"
          opcoes={OPCOES_DE_FINALIDADE}
          valor={filtro.finalidade ?? TODOS}
          onValorChange={(valor) =>
            definirFiltro((atual) => ({ ...atual, pagina: 1, finalidade: ehFinalidade(valor) ? valor : null }))
          }
        />
      </div>
      <div className="w-full tablet:w-[14rem]">
        <Select
          rotulo="Resultado"
          opcoes={OPCOES_DE_RESULTADO}
          valor={filtro.resultado ?? TODOS}
          onValorChange={(valor) =>
            definirFiltro((atual) => ({ ...atual, pagina: 1, resultado: ehResultado(valor) ? valor : null }))
          }
        />
      </div>
      {temFiltro ? (
        <Button variante="contorno" tamanho="compacto" onClick={limpar}>
          <SlidersHorizontal aria-hidden="true" />
          Limpar filtros
        </Button>
      ) : null}
    </div>
  );

  const corpo = (): React.ReactNode => {
    const problema = consulta.error instanceof ErroDaApi ? consulta.error.problema : null;

    if (dados === undefined) {
      if (consulta.isPending) {
        return <Esqueleto />;
      }

      if (problema?.code === 'SEM_AUTORIZACAO') {
        return (
          <EmptyState
            icone={<Lock />}
            titulo="Você não tem permissão para ver o Signer"
            descricao="O seu papel não inclui a consulta do histórico do Signer. Se você precisa dela, peça a um administrador do escritório."
          />
        );
      }

      return (
        <ErroDeTela
          titulo="Não foi possível ler o histórico do Signer"
          descricao={problema === null ? mensagemDoCodigo('FALHA_DE_REDE') : mensagemDoSigner(problema.code)}
          correlationId={problema?.correlationId}
          acao={
            <Button variante="contorno" tamanho="compacto" onClick={() => void consulta.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      );
    }

    const totalDePaginas = Math.max(1, Math.ceil(dados.total / ITENS_POR_PAGINA_DO_HISTORICO));
    const desatualizado = consulta.isError;

    return (
      <div className="flex flex-col gap-sm">
        {desatualizado ? (
          <p className="flex flex-wrap items-center justify-between gap-sm rounded-md bg-warning px-md py-sm text-body-sm text-warning-foreground">
            <span>
              <strong className="font-semibold">Histórico desatualizado.</strong> Não foi possível ler esta
              página agora; segue a última lida
              {problema === null ? '' : ` (código de suporte: ${problema.correlationId})`}.
            </span>
            <Button variante="contorno" tamanho="compacto" onClick={() => void consulta.refetch()}>
              Tentar de novo
            </Button>
          </p>
        ) : null}

        {dados.itens.length === 0 ? (
          dados.total > 0 ? (
            <EmptyState
              icone={<FileClock />}
              titulo="Esta página não tem eventos"
              descricao="O histórico tem eventos, mas não há nenhum nesta página. Volte à primeira para ver os mais recentes."
              acao={
                <Button variante="contorno" tamanho="compacto" onClick={() => irParaPagina(1)}>
                  Voltar à primeira página
                </Button>
              }
            />
          ) : temFiltro ? (
            <EmptyState
              icone={<SlidersHorizontal />}
              titulo="Nenhum evento corresponde aos filtros"
              descricao="Ajuste a finalidade ou o resultado, ou use Limpar filtros, para ver mais eventos."
            />
          ) : (
            <EmptyState
              icone={<FileClock />}
              titulo="Nenhum evento do Signer ainda"
              descricao="Os testes do mTLS, automáticos e manuais, aparecem aqui assim que acontecem, do mais recente ao mais antigo."
            />
          )
        ) : (
          <div className={consulta.isPlaceholderData ? 'opacity-60 transition-opacity duration-fast' : undefined}>
            <ol aria-label="Histórico do Signer" className="flex flex-col">
              {dados.itens.map((evento) => (
                <Evento key={evento.id} evento={evento} />
              ))}
            </ol>
          </div>
        )}

        {dados.total > ITENS_POR_PAGINA_DO_HISTORICO ? (
          <nav className="flex items-center justify-between gap-md pt-sm" aria-label="Paginação do histórico do Signer">
            <p className="text-body-sm text-muted-foreground" aria-live="polite">
              Página {dados.pagina} de {totalDePaginas}
            </p>
            <div className="flex gap-xs">
              <Button
                variante="contorno"
                tamanho="compacto"
                disabled={filtro.pagina <= 1}
                onClick={() => irParaPagina(filtro.pagina - 1)}
              >
                Anterior
              </Button>
              <Button
                variante="contorno"
                tamanho="compacto"
                disabled={filtro.pagina >= totalDePaginas}
                onClick={() => irParaPagina(filtro.pagina + 1)}
              >
                Próxima
              </Button>
            </div>
          </nav>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-md">
      {barraDeFiltro}
      {corpo()}
    </div>
  );
};
