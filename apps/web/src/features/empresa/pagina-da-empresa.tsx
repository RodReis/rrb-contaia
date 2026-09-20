/**
 * Porta de entrada da empresa: decide entre o wizard de cadastro (SPEC-002) e a
 * manutenção da empresa ativa (SPEC-003).
 *
 * A decisão é do servidor, não da navegação: quem chega por link direto numa
 * empresa já ativada vê a manutenção, e quem abre uma empresa arquivada vê a
 * mesma tela em modo de consulta.
 */
'use client';

import { Button } from '@/components/ui/button';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { ManutencaoDaEmpresa } from './manutencao-da-empresa';
import { useEmpresa } from './queries';
import { WizardDaEmpresa } from './wizard';

export const PaginaDaEmpresa = ({ empresaId }: { empresaId: string }) => {
  const { data, isPending, isError, error, refetch } = useEmpresa(empresaId);

  if (isPending) {
    return (
      <div className="flex flex-col gap-lg" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando a empresa</span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (isError) {
    const problema = error instanceof ErroDaApi ? error.problema : null;

    return (
      <ErroDeTela
        nivel={2}
        titulo="Não foi possível carregar a empresa"
        descricao={
          problema === null ? 'Tente novamente em instantes.' : mensagemDoCodigo(problema.code)
        }
        correlationId={problema?.correlationId}
        acao={
          <Button variante="contorno" tamanho="compacto" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  // Empresa ainda em cadastro continua no wizard; ativada — ou arquivada, que
  // só existe depois da ativação — abre na manutenção.
  if (data.cadastro.status === 'CADASTRO_INCOMPLETO') {
    return <WizardDaEmpresa empresaId={empresaId} />;
  }

  return <ManutencaoDaEmpresa visao={data} arquivada={data.situacao === 'arquivado'} />;
};
