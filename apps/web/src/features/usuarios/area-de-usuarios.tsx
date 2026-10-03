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
import { CentralDeCarteiras } from '../carteira/central-de-carteiras';
import { ListaDePapeis } from '../papeis/lista-de-papeis';
import { ErroDaConsulta, SemPermissao } from './erro-da-consulta';
import { ListaDeUsuarios } from './lista-de-usuarios';
import { ADMINISTRACAO_DE_USUARIOS, CONSULTA_DE_USUARIOS, pode } from './permissoes';
import { useSessao } from './queries';

const BASE = '/configuracoes/usuarios';

type NomeDaAba = 'usuarios' | 'papeis' | 'carteiras';

const Cabecalho = ({
  podeAdministrar = false,
  aba = 'usuarios',
}: {
  podeAdministrar?: boolean;
  aba?: NomeDaAba;
}) => (
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
          Quem acessa o escritório, o que cada pessoa pode fazer e em quais empresas ela atua. Cada
          usuário recebe um convite por e-mail para definir a senha, e as mudanças de papel,
          permissões ou carteira valem na próxima requisição, sem a pessoa precisar entrar de novo.
        </p>
      </div>

      {/* Uma ação primária por página (PATTERNS.md §2), a da aba aberta; só quem administra a vê.
          A Central de Carteiras não tem ação de página: as operações em lote surgem com a seleção. */}
      {podeAdministrar && aba !== 'carteiras' ? (
        <Button asChild>
          {aba === 'papeis' ? (
            <Link href={`${BASE}/papeis/novo`}>
              <Plus aria-hidden="true" />
              Criar papel
            </Link>
          ) : (
            <Link href={`${BASE}/novo`}>
              <Plus aria-hidden="true" />
              Convidar usuário
            </Link>
          )}
        </Button>
      ) : null}
    </div>
  </header>
);

export const AreaDeUsuarios = () => {
  const navegador = useRouter();
  const parametros = useSearchParams();
  const { data: sessao, isPending, isError, error, refetch } = useSessao();

  const abaNaUrl = parametros.get('aba');

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

  if (!pode(sessao, CONSULTA_DE_USUARIOS)) {
    return (
      <div className="flex flex-col gap-xl">
        <Cabecalho />
        <SemPermissao />
      </div>
    );
  }

  const podeAdministrar = pode(sessao, ADMINISTRACAO_DE_USUARIOS);
  // A Central de Carteiras é área do administrador: para quem só consulta, a aba não existe.
  const aba: NomeDaAba =
    abaNaUrl === 'papeis' ? 'papeis' : abaNaUrl === 'carteiras' && podeAdministrar ? 'carteiras' : 'usuarios';

  return (
    <div className="flex flex-col gap-xl">
      <Cabecalho podeAdministrar={podeAdministrar} aba={aba} />

      <Abas
        value={aba}
        onValueChange={(valor) =>
          // A aba de usuários é o padrão e sai da URL; trocar de aba zera os filtros
          // da lista, que não existem na outra.
          navegador.replace(valor === 'usuarios' ? BASE : `${BASE}?aba=${valor}`, { scroll: false })
        }
        className="flex flex-col gap-lg"
      >
        <ListaDeAbas aria-label="Áreas de usuários e permissões">
          <GatilhoDeAba value="usuarios">Usuários</GatilhoDeAba>
          <GatilhoDeAba value="papeis">Papéis e permissões</GatilhoDeAba>
          {podeAdministrar ? <GatilhoDeAba value="carteiras">Central de Carteiras</GatilhoDeAba> : null}
        </ListaDeAbas>

        <ConteudoDeAba value="usuarios">
          <ListaDeUsuarios podeAdministrar={podeAdministrar} />
        </ConteudoDeAba>
        <ConteudoDeAba value="papeis">
          <ListaDePapeis podeAdministrar={podeAdministrar} />
        </ConteudoDeAba>
        {podeAdministrar ? (
          <ConteudoDeAba value="carteiras">
            <CentralDeCarteiras />
          </ConteudoDeAba>
        ) : null}
      </Abas>
    </div>
  );
};
