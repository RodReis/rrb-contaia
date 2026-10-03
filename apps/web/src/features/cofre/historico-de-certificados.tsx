/**
 * Aba "Certificados" do Histórico de Informações (SPEC-011 §3.7): cadastro e
 * substituição concluídos, desativação e motivo, troca ou perda de responsável,
 * marcos de alerta e tentativas recusadas com o código estável do motivo, do mais
 * recente ao mais antigo, com data/hora em `America/Sao_Paulo` (I-11).
 *
 * Somente leitura por natureza: o banco recusa `UPDATE` e `DELETE` por trigger e
 * aqui não existe nenhuma ação de escrita. O evento nunca carrega arquivo, senha,
 * chave ou token. Filtros e página ficam na URL (FRONTEND.md §7).
 */
'use client';

import type { EventoDeCertificado } from '@contaia/shared';
import { FileClock, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatarQuando } from '../carteira/rotulos';
import { ErroDoCofre } from './erro-do-cofre';
import {
  APRESENTACAO_DA_ACAO_DO_HISTORICO,
  ROTULO_DO_RESULTADO,
  TODOS,
  autorDoEvento,
  detalheDoEvento,
} from './apresentacao';
import { useHistoricoDeCertificados } from './queries';

export const ABA_DE_CERTIFICADOS = 'CERTIFICADOS';
const POR_PAGINA = 25;

const ACOES = Object.keys(APRESENTACAO_DA_ACAO_DO_HISTORICO);

const OPCOES_DE_ACAO = [
  { valor: TODOS, rotulo: 'Todas as ações' },
  ...Object.entries(APRESENTACAO_DA_ACAO_DO_HISTORICO).map(([valor, { rotulo }]) => ({ valor, rotulo })),
];

const OPCOES_DE_RESULTADO = [
  { valor: TODOS, rotulo: 'Qualquer resultado' },
  ...Object.entries(ROTULO_DO_RESULTADO).map(([valor, rotulo]) => ({ valor, rotulo })),
];

const ehAcao = (valor: string | null): valor is string => valor !== null && ACOES.includes(valor);
const ehResultado = (valor: string | null): valor is string =>
  valor !== null && valor in ROTULO_DO_RESULTADO;

const LinhaDoEvento = ({ evento }: { evento: EventoDeCertificado }) => {
  const acao = APRESENTACAO_DA_ACAO_DO_HISTORICO[evento.acao];
  const detalhe = detalheDoEvento(evento.acao, evento.codigo, evento.motivo);

  return (
    <li className="flex flex-col gap-sm border-b border-border py-md last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-md gap-y-xs">
        <time dateTime={evento.ocorridoEm} className="font-mono text-code-sm tabular-nums text-muted-foreground">
          {formatarQuando(evento.ocorridoEm)}
        </time>
        <StatusBadge tom={acao.tom} rotulo={acao.rotulo} />
        <StatusBadge
          tom={evento.resultado === 'SUCESSO' ? 'conforme' : 'critico'}
          rotulo={ROTULO_DO_RESULTADO[evento.resultado]}
        />
        <Link
          href={`/configuracoes/cofre?empresa=${evento.empresaId}`}
          className="rounded-sm text-title-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {evento.empresaNome}
        </Link>
      </div>

      {detalhe === null ? null : (
        <p className="max-w-prose text-body-sm text-foreground [overflow-wrap:anywhere]">{detalhe}</p>
      )}

      <p className="flex flex-wrap items-center gap-x-sm gap-y-xs text-body-sm text-muted-foreground">
        <span>
          por <span className="text-foreground">{autorDoEvento(evento.usuarioNome, evento.identidadeTecnica)}</span>
        </span>
        {evento.acao === 'RECUSA' && evento.codigo !== null ? (
          <span className="font-mono text-code-xs">{evento.codigo}</span>
        ) : null}
        <span className="font-mono text-code-xs">
          <span className="sr-only">Código de correlação </span>
          {evento.correlationId}
        </span>
      </p>
    </li>
  );
};

export const HistoricoDeCertificados = () => {
  const navegador = useRouter();
  const parametros = useSearchParams();

  const acaoNaUrl = parametros.get('acao');
  const resultadoNaUrl = parametros.get('resultado');
  // Vem do link "Ver o histórico completo" do detalhe da empresa; o servidor valida o identificador.
  const empresaNaUrl = parametros.get('empresaId');
  const paginaNaUrl = Math.max(1, Number(parametros.get('pagina') ?? '1') || 1);

  const filtro = useMemo(
    () => ({
      acao: ehAcao(acaoNaUrl) ? acaoNaUrl : null,
      resultado: ehResultado(resultadoNaUrl) ? resultadoNaUrl : null,
      empresaId: empresaNaUrl !== null && empresaNaUrl !== '' ? empresaNaUrl : null,
      limite: POR_PAGINA,
      deslocamento: (paginaNaUrl - 1) * POR_PAGINA,
    }),
    [acaoNaUrl, resultadoNaUrl, empresaNaUrl, paginaNaUrl],
  );

  const { data, isPending, isError, error, refetch } = useHistoricoDeCertificados(filtro);

  const publicar = (ajustar: (proximos: URLSearchParams) => void, voltarAPrimeira = true): void => {
    const proximos = new URLSearchParams(parametros.toString());

    proximos.set('aba', ABA_DE_CERTIFICADOS);
    ajustar(proximos);

    // Qualquer mudança de filtro volta à primeira página.
    if (voltarAPrimeira) {
      proximos.delete('pagina');
    }

    navegador.replace(`/historico?${proximos.toString()}`, { scroll: false });
  };

  const definir = (chave: string, valor: string | null): void =>
    publicar((proximos) => {
      if (valor === null || valor === '' || valor === TODOS) {
        proximos.delete(chave);
      } else {
        proximos.set(chave, valor);
      }
    });

  const limpar = (): void =>
    navegador.replace(`/historico?aba=${ABA_DE_CERTIFICADOS}`, { scroll: false });

  const temFiltro =
    filtro.acao !== null || filtro.resultado !== null || filtro.empresaId !== null;
  const totalDePaginas = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / POR_PAGINA));

  const barraDeFiltro = (
    <div className="flex flex-col gap-md">
      <div className="flex flex-col gap-md tablet:flex-row tablet:items-end">
        <div className="flex-1">
          <Select
            rotulo="Ação"
            opcoes={OPCOES_DE_ACAO}
            valor={filtro.acao ?? TODOS}
            onValorChange={(valor) => definir('acao', valor)}
            ajuda="Cadastro, substituição, desativação, responsável, alerta ou recusa."
          />
        </div>
        <div className="flex-1">
          <Select
            rotulo="Resultado"
            opcoes={OPCOES_DE_RESULTADO}
            valor={filtro.resultado ?? TODOS}
            onValorChange={(valor) => definir('resultado', valor)}
            ajuda="Concluído ou recusado."
          />
        </div>
      </div>
      {filtro.empresaId === null ? null : (
        <p className="text-body-sm text-muted-foreground">
          Mostrando só os eventos de uma empresa, a que você abriu no cofre.
        </p>
      )}
      {temFiltro ? (
        <div>
          <Button variante="contorno" tamanho="compacto" onClick={limpar}>
            <SlidersHorizontal aria-hidden="true" />
            Limpar
          </Button>
        </div>
      ) : null}
    </div>
  );

  const conteudo = (): React.ReactNode => {
    if (isPending) {
      return (
        <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
          <span className="sr-only">Carregando o histórico de certificados</span>
          {Array.from({ length: 5 }, (_, indice) => (
            <Skeleton key={indice} className="h-20 w-full" />
          ))}
        </div>
      );
    }

    if (isError) {
      return (
        <ErroDoCofre
          erro={error}
          titulo="Não foi possível carregar o histórico"
          aoTentarDeNovo={() => void refetch()}
        />
      );
    }

    if (data.eventos.length === 0) {
      return temFiltro ? (
        <EmptyState
          nivel={2}
          icone={<FileClock />}
          titulo="Nenhum evento no período ou filtro"
          descricao="Nenhum evento de certificado corresponde aos filtros aplicados."
          acao={
            <Button variante="contorno" tamanho="compacto" onClick={limpar}>
              Limpar filtros
            </Button>
          }
        />
      ) : (
        <EmptyState
          nivel={2}
          icone={<FileClock />}
          titulo="Nenhum evento de certificado registrado"
          descricao="Cadastros, substituições, desativações, trocas de responsável, alertas de vencimento e tentativas recusadas aparecem aqui, sem nunca guardar o arquivo, a senha ou a chave."
        />
      );
    }

    return (
      <div className="flex flex-col gap-lg">
        <ul aria-label="Eventos de certificado" className="flex flex-col">
          {data.eventos.map((evento) => (
            <LinhaDoEvento key={evento.id} evento={evento} />
          ))}
        </ul>

        {totalDePaginas > 1 ? (
          <nav
            aria-label="Paginação do histórico de certificados"
            className="flex items-center justify-between gap-md"
          >
            <span className="text-body-sm text-muted-foreground" aria-live="polite">
              Página {paginaNaUrl} de {totalDePaginas}
            </span>
            <div className="flex gap-sm">
              <Button
                variante="contorno"
                tamanho="compacto"
                disabled={paginaNaUrl <= 1}
                onClick={() =>
                  publicar((proximos) => {
                    if (paginaNaUrl - 1 > 1) {
                      proximos.set('pagina', String(paginaNaUrl - 1));
                    }
                  }, false)
                }
              >
                Anterior
              </Button>
              <Button
                variante="contorno"
                tamanho="compacto"
                disabled={paginaNaUrl >= totalDePaginas}
                onClick={() =>
                  publicar((proximos) => proximos.set('pagina', String(paginaNaUrl + 1)), false)
                }
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
    <div className="flex flex-col gap-lg">
      {barraDeFiltro}
      {conteudo()}
    </div>
  );
};
