/**
 * Área "Configurações → Usuários e permissões" (SPEC-007 §5.1): cabeçalho de
 * página canônico (breadcrumb, H1, descrição, uma ação primária) e as abas
 * `Usuários` e `Papéis e permissões`, com a aba na URL.
 *
 * A decisão de mostrar a área é da sessão (permissão de consulta), mas quem
 * decide de verdade é a API: o 403 dela cai no mesmo estado de "sem permissão".
 */
'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Abas, ConteudoDeAba, GatilhoDeAba, ListaDeAbas } from '@/components/ui/abas';
import { Skeleton } from '@/components/ui/estados';
import { CatalogoDePapeis } from './catalogo-de-papeis';
import { ErroDaConsulta, SemPermissao } from './erro-da-consulta';
import { ListaDeUsuarios } from './lista-de-usuarios';
import { useSessao } from './queries';

const BASE = '/configuracoes/usuarios';

type NomeDaAba = 'usuarios' | 'papeis';

const Cabecalho = ({ podeConvidar = false }: { podeConvidar?: boolean }) => (
  <header className="flex flex-col gap-sm">
    <Breadcrumb
      itens={[
        { rotulo: 'Início', href: '/empresas' },
        { rotulo: 'Configurações' },
        { rotulo: 'Usuários e permissões' },
      ]}
    />
    <div className="flex flex-col gap-md tablet:flex-row tablet:items-end tablet:justify-between">
      <div className="flex flex-col gap-xs">
        <h1 className="font-display text-headline-lg text-foreground">Usuários e permissões</h1>
        <p className="max-w-prose text-body-md text-muted-foreground">
          Quem acessa o escritório e o que cada pessoa pode fazer. Cada usuário recebe um convite
          por e-mail para definir a senha, e as mudanças de papel valem na próxima requisição.
        </p>
      </div>

      {/* Uma ação primária por página (PATTERNS.md §2); só quem administra a vê. */}
      {podeConvidar ? (
        <Button asChild>
          <Link href={`${BASE}/novo`}>
            <Plus aria-hidden="true" />
            Convidar usuário
          </Link>
        </Button>
      ) : null}
    </div>
  </header>
);

export const AreaDeUsuarios = () => {
  const navegador = useRouter();
  const parametros = useSearchParams();
  const { data: sessao, isPending, isError, error, refetch } = useSessao();

  const aba: NomeDaAba = parametros.get('aba') === 'papeis' ? 'papeis' : 'usuarios';

  if (isPending) {
    return (
      <div className="flex flex-col gap-xl" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando usuários e permissões</span>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-xl">
        <Cabecalho />
        <ErroDaConsulta
          erro={error}
          titulo="Não foi possível verificar o seu acesso"
          aoTentarDeNovo={() => void refetch()}
        />
      </div>
    );
  }

  if (!sessao.permissoes.USUARIOS.includes('consultar')) {
    return (
      <div className="flex flex-col gap-xl">
        <Cabecalho />
        <SemPermissao />
      </div>
    );
  }

  const podeAdministrar = sessao.permissoes.USUARIOS.includes('administrar');

  return (
    <div className="flex flex-col gap-xl">
      <Cabecalho podeConvidar={podeAdministrar} />

      <Abas
        value={aba}
        onValueChange={(valor) =>
          // A aba de usuários é o padrão e sai da URL; trocar de aba zera os filtros
          // da lista, que não existem na outra.
          navegador.replace(valor === 'papeis' ? `${BASE}?aba=papeis` : BASE, { scroll: false })
        }
        className="flex flex-col gap-lg"
      >
        <ListaDeAbas aria-label="Áreas de usuários e permissões">
          <GatilhoDeAba value="usuarios">Usuários</GatilhoDeAba>
          <GatilhoDeAba value="papeis">Papéis e permissões</GatilhoDeAba>
        </ListaDeAbas>

        <ConteudoDeAba value="usuarios">
          <ListaDeUsuarios podeAdministrar={podeAdministrar} />
        </ConteudoDeAba>
        <ConteudoDeAba value="papeis">
          <CatalogoDePapeis />
        </ConteudoDeAba>
      </Abas>
    </div>
  );
};
