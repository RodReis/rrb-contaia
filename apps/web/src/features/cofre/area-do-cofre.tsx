/**
 * Cofre de certificados A1 (SPEC-011 §5): cabeçalho de página canônico, cartões-
 * resumo, envio do certificado e a lista das empresas, com busca, filtro,
 * ordenação, paginação e a empresa do detalhe na URL.
 *
 * A decisão de mostrar a tela é da sessão (permissão de consulta), mas quem
 * decide de verdade é a API: o 403 dela cai no mesmo estado de "sem permissão"
 * (ARCHITECTURE.md §6). Esconder botão não é controle de acesso.
 */
'use client';

import type { ItemDoCofre } from '@contaia/shared';
import { Lock, Upload } from 'lucide-react';
import { useState } from 'react';

import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/estados';
import { SemCarteira } from '@/components/ui/sem-carteira';
import { ErroDaApi } from '@/lib/http';

import { useSessao } from '../usuarios/queries';
import { CartoesDoResumo, EsqueletoDosCartoes } from './cartoes-do-resumo';
import { DetalheDaEmpresa } from './detalhe-da-empresa';
import { SemPermissaoNoCofre } from './erro-do-cofre';
import { focarCampo, rolarAte } from './foco';
import { FormularioDeEnvio } from './formulario-de-envio';
import {
  CADASTRO_NO_COFRE,
  CONSULTA_DO_COFRE,
  CONSULTA_DO_SIGNER,
  SUBSTITUICAO_NO_COFRE,
  TESTE_DO_SIGNER,
  concede,
} from './permissoes';
import { ListaDoCofre } from './lista-do-cofre';
import { useCofre } from './queries';
import { CartaoDoSigner } from './signer/cartao-do-signer';
import { useFiltroDoCofre } from './use-filtro-do-cofre';


type PedidoDeEnvio = Readonly<{ numero: number; empresa: ItemDoCofre | null }>;

const Cabecalho = ({
  podeEnviar,
  aoEnviar,
}: {
  podeEnviar: boolean;
  aoEnviar: () => void;
}) => (
  <header className="flex flex-col gap-sm">
    <Breadcrumb
      itens={[
        { rotulo: 'Início', href: '/empresas' },
        { rotulo: 'Configurações' },
        { rotulo: 'Cofre de certificados' },
      ]}
    />
    <div className="flex flex-col gap-md tablet:flex-row tablet:items-end tablet:justify-between">
      <div className="flex flex-col gap-xs">
        <h1 className="font-display text-headline-lg text-foreground">Cofre de certificados A1</h1>
        <p className="max-w-prose text-body-md text-muted-foreground">
          O certificado digital de cada empresa do escritório, guardado no cofre local. A tela mostra
          só metadados: o arquivo, a senha e a chave não voltam ao navegador, e não existe download.
        </p>
      </div>

      {/* Uma ação primária por página (PATTERNS.md §2): levar o certificado ao cofre. */}
      {podeEnviar ? (
        <Button onClick={aoEnviar}>
          <Upload aria-hidden="true" />
          Enviar certificado
        </Button>
      ) : null}
    </div>
  </header>
);

const SoConsulta = () => (
  <section
    aria-label="Permissão de envio"
    className="flex items-start gap-sm rounded-xl border border-border bg-card p-lg"
  >
    <Lock className="mt-xs size-icon-md shrink-0 text-muted-foreground" aria-hidden="true" />
    <div className="flex flex-col gap-xs">
      <h2 className="text-title-sm text-foreground">Seu papel permite apenas consultar o cofre</h2>
      <p className="max-w-prose text-body-sm text-muted-foreground">
        Cadastrar, substituir e desativar certificados é com administradores do escritório e
        contadores com a permissão correspondente. Se você precisa dela, peça a um administrador.
      </p>
    </div>
  </section>
);

export const AreaDoCofre = () => {
  const controle = useFiltroDoCofre();
  const consulta = useCofre(controle.filtro);
  const { data: sessao, isPending: carregandoSessao } = useSessao();
  const [pedido, definirPedido] = useState<PedidoDeEnvio>({ numero: 0, empresa: null });

  const iniciarEnvio = (empresa: ItemDoCofre): void =>
    definirPedido((anterior) => ({ numero: anterior.numero + 1, empresa }));

  const levarAoFormulario = (): void => {
    const secao = document.getElementById('enviar-certificado');

    rolarAte(secao);

    if (secao !== null) {
      focarCampo(secao, 'empresa');
    }
  };

  const podeConsultar = sessao === undefined || concede(sessao, CONSULTA_DO_COFRE);
  const podeEnviar =
    sessao !== undefined &&
    (concede(sessao, CADASTRO_NO_COFRE) || concede(sessao, SUBSTITUICAO_NO_COFRE));

  const podeVerSigner = sessao !== undefined && concede(sessao, CONSULTA_DO_SIGNER);
  const podeTestarSigner = sessao !== undefined && concede(sessao, TESTE_DO_SIGNER);

  const negadoPelaApi =
    consulta.error instanceof ErroDaApi && consulta.error.problema.code === 'SEM_AUTORIZACAO';
  const semCarteira =
    sessao?.escopoDeEmpresas === 'NENHUMA' || consulta.data?.escopoDeEmpresas === 'NENHUMA';

  const corpo = (): React.ReactNode => {
    if (carregandoSessao) {
      return (
        <>
          <EsqueletoDosCartoes />
          <Skeleton className="h-96 w-full" />
        </>
      );
    }

    if (!podeConsultar || negadoPelaApi) {
      return <SemPermissaoNoCofre />;
    }

    if (semCarteira) {
      return (
        <SemCarteira descricao="Quando houver empresas na sua carteira, o certificado de cada uma aparece aqui. Enquanto isso, você acessa apenas as áreas que não dependem de uma empresa." />
      );
    }

    return (
      <>
        <section aria-labelledby="titulo-resumo" className="flex flex-col gap-md">
          <h2 id="titulo-resumo" className="sr-only">
            Resumo do cofre
          </h2>
          {consulta.data === undefined ? (
            consulta.isPending ? (
              <EsqueletoDosCartoes />
            ) : null
          ) : (
            <CartoesDoResumo resumo={consulta.data.resumo} aoFiltrar={controle.aplicar} />
          )}
          {podeVerSigner ? <CartaoDoSigner /> : null}
        </section>

        {podeEnviar ? (
          <FormularioDeEnvio
            key={pedido.numero}
            empresaInicial={pedido.empresa}
            focarAoMontar={pedido.numero > 0}
          />
        ) : (
          <SoConsulta />
        )}

        <section aria-labelledby="titulo-lista" className="flex flex-col gap-md">
          <h2 id="titulo-lista" className="text-headline-sm text-foreground">
            Empresas e certificados
          </h2>
          <ListaDoCofre
            controle={controle}
            consulta={consulta}
            aoEnviar={iniciarEnvio}
            comSigner={podeVerSigner}
          />
        </section>

        <DetalheDaEmpresa
          empresaId={controle.empresaAberta}
          aoFechar={() => controle.abrirEmpresa(null)}
          aoEnviar={iniciarEnvio}
          signer={{ podeConsultar: podeVerSigner, podeTestar: podeTestarSigner }}
        />
      </>
    );
  };

  return (
    <div className="flex flex-col gap-xl">
      <Cabecalho podeEnviar={podeEnviar} aoEnviar={levarAoFormulario} />
      {corpo()}
    </div>
  );
};

