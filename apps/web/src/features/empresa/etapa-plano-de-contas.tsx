/**
 * Etapa final opcional do cadastro da empresa: plano de contas (SPEC-013 §3.1, §5.2).
 *
 * Aparece na tela que sucede a ativação. Empresa em `CADASTRO_INCOMPLETO` não está em carteira nem
 * guarda dado operacional, então o plano só pode ser importado depois de ativar — por isso esta
 * etapa não pertence a `ETAPAS_DA_EMPRESA` (o domínio segue com quatro etapas) e nunca bloqueia a
 * ativação. É um passo a mais, mostrado como tal: os quatro anteriores aparecem concluídos e este,
 * "opcional", como o atual. O fluxo de importação é o da aba "Plano de contas" da manutenção
 * (`AbaPlanoDeContas`), sem cópia: a tentativa abre na URL da empresa e uma recarga cai na aba.
 *
 * Para quem consulta empregados (SPEC-014 §3.1), a etapa de empregados vem depois desta: sair do
 * plano leva a ela, na mesma página. Para os demais, o caminho segue sendo a lista de empresas.
 */
'use client';

import { ArrowRight, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { ETAPAS_DA_EMPRESA } from '@contaia/domain';
import type { EtapaDaEmpresa } from '@contaia/domain';

import { Button } from '@/components/ui/button';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { Stepper, type EtapaDoStepper } from '@/components/ui/stepper';
import { AbaPlanoDeContas } from '../plano-contas/aba-plano-de-contas';
import { ESTADOS_COM_LINHAS_APLICADAS, naoTerminada } from '../importacao/apresentacao';
import { permissoesDoPlano } from '../plano-contas/permissoes';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { useContasDoPlano, useTentativa } from '../plano-contas/queries';
import { useEstadoNaUrl } from '../plano-contas/use-estado-na-url';
import { consultaEmpregados } from '../empregados/permissoes';
import { useSessao } from '../usuarios/queries';
import { useEmpresa } from './queries';
import { ROTULO_DA_ETAPA } from './wizard';

const etapaConcluida = (etapa: EtapaDaEmpresa): EtapaDoStepper => ({
  id: etapa,
  rotulo: ROTULO_DA_ETAPA[etapa],
  situacao: 'concluida',
});

export const ETAPAS_CONCLUIDAS_DO_CADASTRO: readonly EtapaDoStepper[] = ETAPAS_DA_EMPRESA.map(etapaConcluida);

const ETAPA_DO_PLANO: EtapaDoStepper = { id: 'plano-de-contas', rotulo: 'Plano de contas (opcional)', situacao: 'atual' };

export const ETAPA_DE_EMPREGADOS: EtapaDoStepper = { id: 'empregados', rotulo: 'Empregados (opcional)', situacao: 'pendente' };

const ID_DO_TITULO = 'etapa-plano-de-contas-titulo';

export const EtapaDePlanoDeContas = ({
  empresaId,
  aoSeguirParaEmpregados,
}: {
  empresaId: string;
  /** Próxima etapa, na mesma página, para quem consulta empregados. */
  aoSeguirParaEmpregados: () => void;
}) => {
  const navegador = useRouter();
  const { data: visao } = useEmpresa(empresaId);
  const consultaDaSessao = useSessao();
  const { data: sessao } = consultaDaSessao;
  const carregandoSessao = consultaDaSessao.isPending;
  // Erro ao ler a sessão não é falta de permissão: sem a resposta, a tela não sabe o que o papel pode.
  const sessaoIndisponivel = consultaDaSessao.isError && sessao === undefined;
  const problemaDaSessao = consultaDaSessao.error instanceof ErroDaApi ? consultaDaSessao.error.problema : null;
  const permissoes = permissoesDoPlano(sessao, false);
  const { tentativaId } = useEstadoNaUrl(empresaId);
  const { data: tentativa } = useTentativa(empresaId, tentativaId);
  // A primeira página do plano diz se já existe conta (é a mesma consulta da aba, em cache).
  const { data: plano } = useContasDoPlano(empresaId, 1, '');
  const titulo = useRef<HTMLHeadingElement>(null);

  // A ativação troca a revisão por esta etapa: o foco vai para o título, em vez de ficar no botão
  // "Ativar empresa" que acabou de sair da tela.
  useEffect(() => {
    titulo.current?.focus();
  }, []);

  const nome =
    visao?.cadastro.identificacao?.nomeFantasia ?? visao?.cadastro.identificacao?.razaoSocial ?? 'Empresa';
  // Sem nada a fazer aqui (importação terminada ou papel que não importa), o caminho é "Concluir";
  // enquanto há o que importar, é "Continuar sem importar".
  const semPermissaoDeImportar = sessao !== undefined && !permissoes.importar;
  const semNadaAFazer = (tentativa !== undefined && !naoTerminada(tentativa.estado)) || semPermissaoDeImportar;
  // A pendência existe enquanto o plano não tem conta: vale o plano (e a tentativa que acabou de
  // aplicar contas, antes de o plano ser relido), não só a tentativa aberta na URL.
  const aplicouAgora = tentativa !== undefined && ESTADOS_COM_LINHAS_APLICADAS.includes(tentativa.estado);
  // Enquanto o plano não chegou, o aviso não aparece: não se promete nem se nega a pendência.
  const pendenciaAberta = !aplicouAgora && plano !== undefined && plano.total === 0;
  const seguirParaEmpregados = consultaEmpregados(sessao);
  const sair = (): void => (seguirParaEmpregados ? aoSeguirParaEmpregados() : navegador.push('/empresas'));
  const etapas = seguirParaEmpregados
    ? [...ETAPAS_CONCLUIDAS_DO_CADASTRO, ETAPA_DO_PLANO, ETAPA_DE_EMPREGADOS]
    : [...ETAPAS_CONCLUIDAS_DO_CADASTRO, ETAPA_DO_PLANO];

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-col gap-sm">
        <div className="flex flex-wrap items-center gap-sm">
          <h1 className="font-display text-headline-lg text-foreground">{nome}</h1>
          <StatusBadge tom="conforme" rotulo="Ativa" />
        </div>
        <p className="max-w-prose text-body-md text-muted-foreground">
          {seguirParaEmpregados
            ? 'Empresa ativada. Faltam o plano de contas e os empregados, ambos opcionais: nada do cadastro depende deles.'
            : 'Empresa ativada. Falta só o plano de contas, e ele é opcional: nada do cadastro depende dele.'}
        </p>
      </header>

      {/* Com a etapa de empregados são seis: em colunas iguais para caber em 768 px sem rolar. */}
      <Stepper etapas={etapas} compacto={seguirParaEmpregados} />

      <section aria-labelledby={ID_DO_TITULO} className="flex flex-col gap-lg">
        <div className="flex flex-col gap-md rounded-lg border border-border bg-card p-lg">
          <div className="flex flex-wrap items-center gap-sm">
            <h2
              id={ID_DO_TITULO}
              ref={titulo}
              tabIndex={-1}
              className="font-display text-headline-md text-foreground focus-visible:outline-none"
            >
              Plano de contas
            </h2>
            <StatusBadge tom="neutro" rotulo="Etapa opcional" />
          </div>

          <div className="flex max-w-prose flex-col gap-xs text-body-md text-muted-foreground">
            <p>
              A empresa já está ativa. O plano de contas pode ser importado agora por CSV ou depois, na aba Plano de
              contas desta empresa. Nenhuma conta muda antes da sua confirmação.
            </p>
            {semPermissaoDeImportar ? (
              <p>
                <span className="text-title-sm text-foreground">
                  Seu papel pode consultar o plano de contas, mas não tem permissão para importar.
                </span>{' '}
                O envio de CSV é feito por quem tem a permissão Importar em Empresas → Plano de contas.
              </p>
            ) : null}
            {pendenciaAberta ? (
              <p>
                Sem importar agora, a pendência Plano de contas incompleto continua visível na Central de Pendências
                até existir ao menos uma conta válida.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap justify-end gap-sm">
            {semNadaAFazer && seguirParaEmpregados ? (
              <Button onClick={sair}>
                Seguir para empregados
                <ArrowRight aria-hidden="true" />
              </Button>
            ) : semNadaAFazer ? (
              <Button onClick={sair}>
                <Check aria-hidden="true" />
                Concluir
              </Button>
            ) : (
              <Button variante="contorno" onClick={sair}>
                Continuar sem importar
              </Button>
            )}
          </div>
        </div>

        {carregandoSessao ? (
          <div aria-busy="true" aria-live="polite">
            <span className="sr-only">Carregando permissões</span>
            <Skeleton className="h-40 w-full" />
          </div>
        ) : null}
        {sessaoIndisponivel ? (
          <ErroDeTela
            titulo="Não foi possível conferir as suas permissões"
            descricao={problemaDaSessao === null ? mensagemDoCodigo('FALHA_DE_REDE') : mensagemDoCodigo(problemaDaSessao.code)}
            correlationId={problemaDaSessao?.correlationId}
            acao={
              <Button variante="contorno" tamanho="compacto" onClick={() => void consultaDaSessao.refetch()}>
                Tentar de novo
              </Button>
            }
          />
        ) : null}
        {permissoes.importar ? (
          <AbaPlanoDeContas empresaId={empresaId} somenteLeitura={false} comCabecalho={false} />
        ) : null}
      </section>
    </div>
  );
};
