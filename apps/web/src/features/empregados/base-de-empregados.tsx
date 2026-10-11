/**
 * Base de empregados importada, em consulta (SPEC-014 §3.9, §5.2 item 10): paginada no servidor,
 * com busca por nome, CPF ou matrícula na URL. Sem edição, arquivamento ou reativação — o cadastro
 * de empregado é de outra fatia (§12). Nada de cargo, salário ou situação perante o eSocial, que o
 * protótipo mostrava (§5.1).
 *
 * CPF e matrícula, a chave natural, ficam lado a lado em mono e `tabular-nums`: é por eles que o
 * contador confere a base contra a origem. CPF sempre completo, `000.000.000-00` (PATTERNS.md §3).
 */
'use client';

import type { EmpregadoDaBase } from '@contaia/shared';
import { IdCard, SearchX, Users } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { cn } from '@/lib/cn';
import { formatarNumero } from '../importacao/apresentacao';
import { Paginacao, RegiaoRolavel, Secao } from '../importacao/pecas';
import { useBuscaComAtraso } from '../importacao/use-busca-com-atraso';
import type { EstadoNaUrl } from '../importacao/use-estado-na-url';
import { cpfParaExibir, formatarDataCivil } from './apresentacao';
import { useEmpregados } from './queries';

const COLUNAS = ['Nome completo', 'CPF', 'Matrícula', 'Nascimento', 'Admissão', 'Situação'] as const;

const Dado = ({ children, className }: { children: ReactNode; className?: string }) => (
  <td className={cn('whitespace-nowrap px-md py-sm font-mono text-code-sm tabular-nums text-foreground', className)}>
    {children}
  </td>
);

const Linha = ({ empregado }: { empregado: EmpregadoDaBase }) => (
  <tr className={cn('border-t border-border align-top', empregado.arquivado ? 'bg-muted/40' : 'hover:bg-accent/40')}>
    <th scope="row" className="min-w-[14rem] max-w-[24rem] px-md py-sm text-left text-body-md font-normal text-foreground [overflow-wrap:anywhere]">
      {empregado.nome}
    </th>
    <Dado>
      <span className="font-mono tabular-nums">{cpfParaExibir(empregado.cpf)}</span>
    </Dado>
    <Dado className="max-w-[10rem] whitespace-normal [overflow-wrap:anywhere]">{empregado.matricula}</Dado>
    <Dado className="text-muted-foreground">{formatarDataCivil(empregado.dataNascimento)}</Dado>
    <Dado>{formatarDataCivil(empregado.dataAdmissao)}</Dado>
    <td className="px-md py-sm">
      {empregado.arquivado ? (
        <StatusBadge tom="neutro" rotulo="Arquivado" />
      ) : (
        <span className="text-body-sm text-muted-foreground">Ativo</span>
      )}
    </td>
  </tr>
);

export const BaseDeEmpregados = ({ empresaId, url }: { empresaId: string; url: EstadoNaUrl }) => {
  const consulta = useEmpregados(empresaId, url.paginaDaBase, url.busca);
  const busca = useBuscaComAtraso(url);
  const dados = consulta.data;

  const corpo = (): ReactNode => {
    if (dados === undefined && consulta.isPending) {
      return (
        <div className="flex flex-col gap-xs px-lg py-md" aria-busy="true">
          <span className="sr-only">Carregando os empregados</span>
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
            titulo="Não foi possível carregar os empregados"
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
              titulo="Nenhum empregado corresponde à busca"
              descricao={`Nenhum nome, CPF ou matrícula contém “${url.busca}”. Ajuste o termo ou limpe a busca para ver a base inteira.`}
              acao={
                <Button variante="contorno" tamanho="compacto" onClick={busca.limpar}>
                  Limpar busca
                </Button>
              }
            />
          ) : (
            <EmptyState
              icone={<Users />}
              titulo="Esta empresa ainda não tem empregados importados"
              descricao="Os empregados aparecem aqui depois da primeira importação confirmada. Enquanto não houver ao menos um empregado confirmado, a empresa mantém a pendência de empregados não importados na Central de Pendências."
            />
          )}
        </div>
      );
    }

    return (
      <RegiaoRolavel
        rotulo="Tabela dos empregados, rolável na horizontal"
        className={cn(consulta.isPlaceholderData && 'opacity-60 transition-opacity duration-fast')}
      >
        <table className="w-full text-left">
          <caption className="sr-only">Empregados da base, página {dados.pagina}</caption>
          <thead className="bg-muted">
            <tr>
              {COLUNAS.map((titulo) => (
                <th key={titulo} scope="col" className="whitespace-nowrap px-md py-sm text-label-sm uppercase text-muted-foreground">
                  {titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dados.itens.map((empregado) => (
              <Linha key={empregado.id} empregado={empregado} />
            ))}
          </tbody>
        </table>
      </RegiaoRolavel>
    );
  };

  const total = dados?.total ?? 0;

  return (
    <Secao
      id="base-de-empregados"
      icone={<IdCard />}
      titulo="Empregados importados"
      descricao={
        total === 0
          ? 'Base cadastral desta empresa, somente para consulta.'
          : `${formatarNumero(total)} ${total === 1 ? 'empregado na base' : 'empregados na base'}, somente para consulta.`
      }
      acoes={
        <div className="w-full tablet:w-[18rem]">
          <Campo
            rotulo="Buscar por nome, CPF ou matrícula"
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
          rotulo="Paginação dos empregados"
          pagina={url.paginaDaBase}
          total={dados.total}
          porPagina={dados.itensPorPagina}
          aoIr={url.irParaBase}
          unidade={dados.total === 1 ? 'empregado' : 'empregados'}
        />
      )}
    </Secao>
  );
};
