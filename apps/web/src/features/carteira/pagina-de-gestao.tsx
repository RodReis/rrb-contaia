/**
 * Página dedicada "Gerenciar carteira" (SPEC-009 §5.2): o mesmo componente da aba
 * "Carteira" do usuário, num endereço próprio que a Central e o aviso do sino abrem.
 */
'use client';

import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Skeleton } from '@/components/ui/estados';
import { ErroDaConsulta, SemPermissao } from '../usuarios/erro-da-consulta';
import { ADMINISTRACAO_DE_USUARIOS, pode } from '../usuarios/permissoes';
import { useSessao } from '../usuarios/queries';
import { GestaoDaCarteira } from './gestao-da-carteira';

const Cabecalho = () => (
  <header className="flex flex-col gap-sm">
    <Breadcrumb
      itens={[
        { rotulo: 'Início', href: '/empresas' },
        { rotulo: 'Configurações' },
        { rotulo: 'Usuários e permissões', href: '/configuracoes/usuarios?aba=carteiras' },
        { rotulo: 'Gerenciar carteira' },
      ]}
    />
    <div className="flex flex-col gap-xs">
      <h1 className="font-display text-headline-lg text-foreground">Gerenciar carteira</h1>
      <p className="max-w-prose text-body-md text-muted-foreground">
        A carteira define em quais empresas o colaborador atua; o papel define o que ele pode fazer.
        Uma não substitui a outra, e a mudança vale na próxima requisição dele.
      </p>
    </div>
  </header>
);

export const PaginaDeGestaoDaCarteira = ({ usuarioId }: { usuarioId: string }) => {
  const { data: sessao, isPending, isError, error, refetch } = useSessao();

  if (isPending) {
    return (
      <div className="flex flex-col gap-xl" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando a gestão de carteira</span>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-xl">
      <Cabecalho />
      {isError ? (
        <ErroDaConsulta
          erro={error}
          titulo="Não foi possível verificar o seu acesso"
          aoTentarDeNovo={() => void refetch()}
        />
      ) : pode(sessao, ADMINISTRACAO_DE_USUARIOS) ? (
        <GestaoDaCarteira usuarioId={usuarioId} />
      ) : (
        <SemPermissao />
      )}
    </div>
  );
};
