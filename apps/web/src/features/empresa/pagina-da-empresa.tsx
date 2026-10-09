/**
 * Porta de entrada da empresa: decide entre o wizard de cadastro (SPEC-002) e a
 * manutenção da empresa ativa (SPEC-003).
 *
 * A decisão é do servidor, não da navegação: quem chega por link direto numa
 * empresa já ativada vê a manutenção, e quem abre uma empresa arquivada vê a
 * mesma tela em modo de consulta.
 */
'use client';

import { Lock } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { EtapaDePlanoDeContas } from './etapa-plano-de-contas';
import { ManutencaoDaEmpresa } from './manutencao-da-empresa';
import { useEmpresa } from './queries';
import { WizardDaEmpresa } from './wizard';

export const PaginaDaEmpresa = ({ empresaId }: { empresaId: string }) => {
  const { data, isPending, isError, error, refetch } = useEmpresa(empresaId);
  // Ativada agora, nesta sessão de tela: só quem acabou de ativar vê a etapa final do cadastro.
  // Abrir o endereço de uma empresa que já estava ativa cai direto na manutenção.
  const [ativadaAgora, definirAtivadaAgora] = useState(false);

  // Antes de qualquer outro estado: a releitura que a ativação dispara não pode trocar a etapa
  // por skeleton ou erro de tela.
  if (ativadaAgora) {
    return <EtapaDePlanoDeContas empresaId={empresaId} />;
  }

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

    // Empresa do próprio escritório, fora da carteira (SPEC-009 §3.5): a recusa diz qual empresa
    // (nome e CNPJ) e que falta alçada, e nada além — nenhum outro dado ou ação é liberado.
    if (problema?.code === 'EMPRESA_FORA_DA_CARTEIRA') {
      const empresa = problema.detalhes?.['empresa'] as { nome?: string; cnpj?: string } | undefined;

      return (
        <EmptyState
          nivel={2}
          icone={<Lock />}
          titulo="Esta empresa não está na sua carteira"
          descricao={
            empresa?.nome === undefined
              ? mensagemDoCodigo(problema.code)
              : `Você não tem acesso a ${empresa.nome}${
                  empresa.cnpj === undefined ? '' : ` (CNPJ ${empresa.cnpj})`
                }. Seu papel só vale sobre as empresas atribuídas à sua carteira; peça a um administrador do escritório para atribuí-la.`
          }
          acao={
            <Button asChild variante="contorno" tamanho="compacto">
              <Link href="/carteira">Ver minha carteira</Link>
            </Button>
          }
        />
      );
    }

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
    return <WizardDaEmpresa empresaId={empresaId} aoAtivar={() => definirAtivadaAgora(true)} />;
  }

  return <ManutencaoDaEmpresa visao={data} arquivada={data.situacao === 'arquivado'} />;
};
