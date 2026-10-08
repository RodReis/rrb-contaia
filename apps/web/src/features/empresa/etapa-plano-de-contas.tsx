/**
 * Etapa final opcional do cadastro da empresa: plano de contas (SPEC-013 §3.1, §5.2).
 *
 * Aparece na tela que sucede a ativação. Empresa em `CADASTRO_INCOMPLETO` não está em carteira nem
 * guarda dado operacional, então o plano só pode ser importado depois de ativar — por isso esta
 * etapa não pertence a `ETAPAS_DA_EMPRESA` (o domínio segue com quatro etapas) e nunca bloqueia a
 * ativação. É um passo a mais, mostrado como tal: os quatro anteriores aparecem concluídos e este,
 * "opcional", como o atual. O fluxo de importação é o da aba "Plano de contas" da manutenção
 * (`AbaPlanoDeContas`), sem cópia: a tentativa abre na URL da empresa e uma recarga cai na aba.
 */
'use client';

import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { ETAPAS_DA_EMPRESA } from '@contaia/domain';
import type { EtapaDaEmpresa } from '@contaia/domain';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { Stepper, type EtapaDoStepper } from '@/components/ui/stepper';
import { AbaPlanoDeContas } from '../plano-contas/aba-plano-de-contas';
import { naoTerminada } from '../plano-contas/apresentacao';
import { permissoesDoPlano } from '../plano-contas/permissoes';
import { useTentativa } from '../plano-contas/queries';
import { useEstadoNaUrl } from '../plano-contas/use-estado-na-url';
import { useSessao } from '../usuarios/queries';
import { useEmpresa } from './queries';
import { ROTULO_DA_ETAPA } from './wizard';

const etapaConcluida = (etapa: EtapaDaEmpresa): EtapaDoStepper => ({
  id: etapa,
  rotulo: ROTULO_DA_ETAPA[etapa],
  situacao: 'concluida',
});

const ETAPAS_DO_PASSO: readonly EtapaDoStepper[] = [
  ...ETAPAS_DA_EMPRESA.map(etapaConcluida),
  { id: 'plano-de-contas', rotulo: 'Plano de contas (opcional)', situacao: 'atual' },
];

/** Estados em que o plano ganhou contas: a pendência deixa de ser promessa. */
const ESTADOS_COM_CONTAS_APLICADAS: readonly string[] = ['CONCLUIDA', 'CONCLUIDA_COM_REJEICOES'];

const ID_DO_TITULO = 'etapa-plano-de-contas-titulo';

export const EtapaDePlanoDeContas = ({ empresaId }: { empresaId: string }) => {
  const navegador = useRouter();
  const { data: visao } = useEmpresa(empresaId);
  const { data: sessao, isPending: carregandoSessao } = useSessao();
  const permissoes = permissoesDoPlano(sessao, false);
  const { tentativaId } = useEstadoNaUrl(empresaId);
  const { data: tentativa } = useTentativa(empresaId, tentativaId);
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
  const semNadaAFazer =
    (tentativa !== undefined && !naoTerminada(tentativa.estado)) || (!carregandoSessao && !permissoes.importar);
  const pendenciaAberta = tentativa === undefined || !ESTADOS_COM_CONTAS_APLICADAS.includes(tentativa.estado);
  const sair = (): void => navegador.push('/empresas');

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-col gap-sm">
        <div className="flex flex-wrap items-center gap-sm">
          <h1 className="font-display text-headline-lg text-foreground">{nome}</h1>
          <StatusBadge tom="conforme" rotulo="Ativa" />
        </div>
        <p className="max-w-prose text-body-md text-muted-foreground">
          Empresa ativada. Falta só o plano de contas, e ele é opcional: nada do cadastro depende dele.
        </p>
      </header>

      <Stepper etapas={ETAPAS_DO_PASSO} />

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
            {permissoes.importar || carregandoSessao ? null : (
              <p>
                <span className="text-title-sm text-foreground">Seu papel não importa plano de contas.</span> O envio
                de CSV é feito por quem tem a permissão Importar em Empresas → Plano de contas.
              </p>
            )}
            {pendenciaAberta ? (
              <p>
                Sem importar agora, a pendência Plano de contas incompleto continua visível na Central de Pendências
                até existir ao menos uma conta válida.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap justify-end gap-sm">
            {semNadaAFazer ? (
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
        {permissoes.importar ? (
          <AbaPlanoDeContas empresaId={empresaId} somenteLeitura={false} comCabecalho={false} />
        ) : null}
      </section>
    </div>
  );
};
