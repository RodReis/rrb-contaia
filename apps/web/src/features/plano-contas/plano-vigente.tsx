/**
 * Plano de contas vigente da empresa (SPEC-013 §3.12 "Consultar"): paginado no servidor (50 por
 * página), com busca por código ou nome na URL. Conta sintética lê como grupo — fundo `--muted` e
 * peso 600, a regra da HierarchicalTable (COMPONENTS.md §3.2) —, para a hierarquia aparecer sem
 * depender só de recuo. Somente leitura: o CRUD manual do plano é de outra fatia (§12).
 */
'use client';

import type { ContaDoPlanoDeContas } from '@contaia/shared';
import { ListTree, SearchX } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { cn } from '@/lib/cn';
import { ROTULO_DA_NATUREZA, ROTULO_DO_TIPO } from './apresentacao';
import { Paginacao, Secao } from './pecas';
import { useContasDoPlano } from './queries';
import type { EstadoNaUrl } from './use-estado-na-url';

export const CONTAS_POR_PAGINA = 50;
const ATRASO_DA_BUSCA_MS = 300;

const Linha = ({ conta }: { conta: ContaDoPlanoDeContas }) => {
  const sintetica = conta.tipo === 'sintetica';

  return (
    <tr className={cn('border-t border-border', sintetica ? 'bg-muted/60' : 'hover:bg-accent/40')}>
      <th
        scope="row"
        className={cn(
          'whitespace-nowrap px-md py-sm text-left font-mono text-code-sm tabular-nums text-foreground',
          sintetica ? 'font-semibold' : 'font-normal',
        )}
      >
        {conta.codigo}
      </th>
      <td className={cn('px-md py-sm text-body-md text-foreground', sintetica && 'font-semibold')}>{conta.nome}</td>
      <td className="whitespace-nowrap px-md py-sm text-body-sm text-muted-foreground">{ROTULO_DO_TIPO[conta.tipo]}</td>
      <td className="whitespace-nowrap px-md py-sm text-body-sm text-muted-foreground">
        {ROTULO_DA_NATUREZA[conta.natureza]}
      </td>
      <td className="whitespace-nowrap px-md py-sm font-mono text-code-sm tabular-nums text-muted-foreground">
        {conta.contaPai ?? <span className="font-sans text-body-sm">raiz</span>}
      </td>
      <td className="px-md py-sm">
        {conta.arquivada ? (
          <StatusBadge tom="neutro" rotulo="Arquivada" />
        ) : (
          <span className="text-body-sm text-muted-foreground">Ativa</span>
        )}
      </td>
    </tr>
  );
};

/**
 * Busca com atraso de 300 ms (PATTERNS.md §11), publicada na URL com `replace`. Se a busca da URL
 * muda por fora (voltar do navegador, outro link), o que estava digitado e ainda não publicado
 * deixa de valer — senão o atraso republicaria o rascunho velho por cima.
 */
const useBuscaComAtraso = (url: EstadoNaUrl) => {
  const [rascunho, definirRascunho] = useState<string | null>(null);
  const [buscaVista, definirBuscaVista] = useState(url.busca);
  const buscar = useRef(url.buscar);

  if (url.busca !== buscaVista) {
    definirBuscaVista(url.busca);

    if (rascunho !== null && rascunho.trim() !== url.busca) {
      definirRascunho(null);
    }
  }

  useEffect(() => {
    buscar.current = url.buscar;
  });

  useEffect(() => {
    if (rascunho === null || rascunho.trim() === url.busca) {
      return undefined;
    }

    const relogio = setTimeout(() => buscar.current(rascunho.trim()), ATRASO_DA_BUSCA_MS);

    return () => clearTimeout(relogio);
  }, [rascunho, url.busca]);

  return { texto: rascunho ?? url.busca, definir: definirRascunho, limpar: () => definirRascunho('') };
};

export const PlanoVigente = ({ empresaId, url }: { empresaId: string; url: EstadoNaUrl }) => {
  const consulta = useContasDoPlano(empresaId, url.paginaDasContas, url.busca);
  const busca = useBuscaComAtraso(url);
  const dados = consulta.data;

  const corpo = (): ReactNode => {
    if (dados === undefined && consulta.isPending) {
      return (
        <div className="flex flex-col gap-xs px-lg py-md" aria-busy="true">
          <span className="sr-only">Carregando o plano de contas</span>
          {Array.from({ length: 6 }, (_, indice) => (
            <Skeleton key={indice} className="h-9 w-full" />
          ))}
        </div>
      );
    }

    if (dados === undefined || consulta.isError) {
      const problema = consulta.error instanceof ErroDaApi ? consulta.error.problema : null;

      return (
        <div className="px-lg py-md">
          <ErroDeTela
            titulo="Não foi possível carregar o plano de contas"
            descricao={problema === null ? mensagemDoCodigo('FALHA_DE_REDE') : mensagemDoCodigo(problema.code)}
            correlationId={problema?.correlationId}
            acao={
              <Button variante="contorno" tamanho="compacto" onClick={() => void consulta.refetch()}>
                Tentar de novo
              </Button>
            }
          />
        </div>
      );
    }

    if (dados.itens.length === 0) {
      return (
        <div className="px-lg py-md">
          {url.busca !== '' ? (
            <EmptyState
              icone={<SearchX />}
              titulo="Nenhuma conta corresponde à busca"
              descricao={`Nenhum código ou nome contém “${url.busca}”. Ajuste o termo ou limpe a busca para ver o plano inteiro.`}
              acao={
                <Button variante="contorno" tamanho="compacto" onClick={busca.limpar}>
                  Limpar busca
                </Button>
              }
            />
          ) : (
            <EmptyState
              icone={<ListTree />}
              titulo="Esta empresa ainda não tem plano de contas"
              descricao="As contas aparecem aqui depois da primeira importação confirmada. Enquanto não houver ao menos uma conta válida, a empresa mantém a pendência de plano de contas na Central de Pendências."
            />
          )}
        </div>
      );
    }

    return (
      <div className={cn('overflow-x-auto', consulta.isPlaceholderData && 'opacity-60 transition-opacity duration-fast')}>
        <table className="w-full text-left">
          <caption className="sr-only">Contas do plano vigente, página {dados.pagina}</caption>
          <thead className="bg-muted">
            <tr>
              {['Código', 'Nome', 'Tipo', 'Natureza', 'Conta-pai', 'Situação'].map((titulo) => (
                <th key={titulo} scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">
                  {titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dados.itens.map((conta) => (
              <Linha key={conta.id} conta={conta} />
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <Secao
      id="plano-vigente"
      icone={<ListTree />}
      titulo="Plano de contas vigente"
      descricao={
        dados === undefined || dados.total === 0
          ? 'As contas ativas e arquivadas desta empresa.'
          : `${dados.total.toLocaleString('pt-BR')} ${dados.total === 1 ? 'conta' : 'contas'} no plano.`
      }
      acoes={
        <div className="w-full tablet:w-[18rem]">
          <Campo
            rotulo="Buscar por código ou nome"
            type="search"
            value={busca.texto}
            onValorChange={busca.definir}
            maxLength={100}
            autoComplete="off"
          />
        </div>
      }
    >
      {corpo()}
      {dados === undefined ? null : (
        <Paginacao
          rotulo="Paginação do plano de contas"
          pagina={url.paginaDasContas}
          total={dados.total}
          porPagina={CONTAS_POR_PAGINA}
          aoIr={url.irParaContas}
          unidade={dados.total === 1 ? 'conta' : 'contas'}
        />
      )}
    </Secao>
  );
};
