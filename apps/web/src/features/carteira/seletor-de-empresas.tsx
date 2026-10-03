/**
 * Escolha de empresas para a carteira (SPEC-009 §5.2): busca por nome ou CNPJ,
 * filtro de situação, seleção múltipla e paginação. Só empresa ativa aparece
 * como opção — empresa arquivada ou em cadastro não recebe vínculo novo.
 *
 * Busca e página vivem em estado local (e não na URL): o seletor mora num diálogo
 * ou numa aba, e o que se está montando ainda não é uma visão compartilhável.
 */
'use client';

import { Building2, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { CaixaDeSelecao } from '@/components/ui/caixa-de-selecao';
import { EmptyState, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaConsulta } from '../usuarios/erro-da-consulta';
import type { EmpresaParaAtribuicao, FiltroDeEmpresas } from './api';
import { useEmpresasParaAtribuicao } from './queries';
import { cnpjFormatado } from './rotulos';

const POR_PAGINA = 10;
const ATRASO_DA_BUSCA_MS = 300;
const TODAS = 'todas';

const OPCOES_DE_SITUACAO = [
  { valor: TODAS, rotulo: 'Todas as empresas' },
  { valor: 'ATRIBUIDAS', rotulo: 'Já na carteira' },
  { valor: 'DISPONIVEIS', rotulo: 'Ainda fora da carteira' },
] as const;

export const SeletorDeEmpresas = ({
  usuarioId,
  estaMarcada,
  aoAlternar,
  mostrarSituacao = true,
  desabilitado = false,
}: {
  /** Colaborador de referência para a marca "já na carteira". */
  usuarioId: string;
  estaMarcada: (empresa: EmpresaParaAtribuicao) => boolean;
  aoAlternar: (empresa: EmpresaParaAtribuicao) => void;
  /** No lote não há uma carteira de referência: esconde o filtro e a marca. */
  mostrarSituacao?: boolean;
  desabilitado?: boolean;
}) => {
  const [rascunho, definirRascunho] = useState('');
  const [busca, definirBusca] = useState('');
  const [situacao, definirSituacao] = useState<FiltroDeEmpresas['situacao']>(null);
  const [pagina, definirPagina] = useState(1);

  useEffect(() => {
    const temporizador = setTimeout(() => {
      definirBusca(rascunho.trim());
      definirPagina(1);
    }, ATRASO_DA_BUSCA_MS);

    return () => clearTimeout(temporizador);
  }, [rascunho]);

  const { data, isPending, isError, error, refetch, isPlaceholderData } = useEmpresasParaAtribuicao(
    usuarioId,
    {
      busca: busca === '' ? null : busca,
      situacao,
      limite: POR_PAGINA,
      deslocamento: (pagina - 1) * POR_PAGINA,
    },
  );

  const totalDePaginas = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / POR_PAGINA));
  const temFiltro = busca !== '' || situacao !== null;

  return (
    // A busca vive dentro de formulários (aba "Carteira" do usuário): Enter no campo não pode
    // enviar o formulário de dados.
    <div
      className="flex flex-col gap-md"
      onKeyDown={(evento) => {
        if (evento.key === 'Enter' && evento.target instanceof HTMLInputElement) {
          evento.preventDefault();
        }
      }}
    >
      <div className="flex flex-col gap-md tablet:flex-row tablet:items-end">
        <div className="flex-1">
          <Campo
            rotulo="Buscar empresa"
            placeholder="Nome ou CNPJ"
            value={rascunho}
            onValorChange={definirRascunho}
            type="search"
            inputMode="search"
          />
        </div>
        {mostrarSituacao ? (
          <div className="w-full tablet:w-[15rem]">
            <Select
              rotulo="Situação na carteira"
              opcoes={OPCOES_DE_SITUACAO}
              valor={situacao ?? TODAS}
              onValorChange={(valor) => {
                definirSituacao(valor === TODAS ? null : (valor as 'ATRIBUIDAS' | 'DISPONIVEIS'));
                definirPagina(1);
              }}
            />
          </div>
        ) : null}
      </div>

      {isPending ? (
        <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
          <span className="sr-only">Carregando as empresas do escritório</span>
          {Array.from({ length: 4 }, (_, indice) => (
            <Skeleton key={indice} className="h-14 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErroDaConsulta
          erro={error}
          titulo="Não foi possível carregar as empresas"
          aoTentarDeNovo={() => void refetch()}
        />
      ) : data.empresas.length === 0 ? (
        <EmptyState
          nivel={3}
          icone={temFiltro ? <Search /> : <Building2 />}
          titulo={temFiltro ? 'Nenhuma empresa encontrada' : 'Nenhuma empresa ativa no escritório'}
          descricao={
            temFiltro
              ? 'Nenhuma empresa corresponde à busca ou ao filtro. Empresa arquivada ou com cadastro incompleto não aparece como opção.'
              : 'Empresas arquivadas ou com cadastro incompleto não podem ser atribuídas. Ative uma empresa para incluí-la em carteiras.'
          }
        />
      ) : (
        <div className={isPlaceholderData ? 'opacity-60 transition-opacity duration-fast' : undefined}>
          <p className="pb-sm text-body-sm text-muted-foreground" aria-live="polite">
            {data.total === 1
              ? '1 empresa ativa.'
              : `${data.total.toLocaleString('pt-BR')} empresas ativas.`}
          </p>
          <ul
            aria-label="Empresas do escritório"
            className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
          >
            {data.empresas.map((empresa) => (
              <li key={empresa.id} className="flex items-start justify-between gap-md px-md py-sm">
                <CaixaDeSelecao
                  rotulo={empresa.nome}
                  descricao={`CNPJ ${cnpjFormatado(empresa.cnpj)}`}
                  marcada={estaMarcada(empresa)}
                  onMarcadaChange={() => aoAlternar(empresa)}
                  disabled={desabilitado}
                />
                {mostrarSituacao && empresa.atribuida ? (
                  <StatusBadge tom="processando" rotulo="Na carteira" />
                ) : null}
              </li>
            ))}
          </ul>

          {totalDePaginas > 1 ? (
            <nav
              className="flex items-center justify-between gap-md pt-md"
              aria-label="Paginação das empresas"
            >
              <p className="text-body-sm text-muted-foreground">
                Página {pagina} de {totalDePaginas}
              </p>
              <div className="flex gap-xs">
                <Button
                  type="button"
                  variante="contorno"
                  tamanho="compacto"
                  disabled={pagina <= 1}
                  onClick={() => definirPagina(pagina - 1)}
                >
                  Anterior
                </Button>
                <Button
                  type="button"
                  variante="contorno"
                  tamanho="compacto"
                  disabled={pagina >= totalDePaginas}
                  onClick={() => definirPagina(pagina + 1)}
                >
                  Próxima
                </Button>
              </div>
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
};
