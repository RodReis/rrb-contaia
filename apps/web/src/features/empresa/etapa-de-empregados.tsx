/**
 * Etapa final opcional do cadastro da empresa: empregados (SPEC-014 §3.1, §5.2). Vem depois do
 * plano de contas, na mesma página que sucede a ativação, e nunca bloqueia o cadastro: sem
 * empregado confirmado, a pendência "Empregados não importados" continua visível na Central de
 * Pendências. O fluxo é o da aba "Empregados" da manutenção (`AbaEmpregados`), sem cópia.
 *
 * Como a etapa do plano, não pertence a `ETAPAS_DA_EMPRESA`: o domínio segue com quatro etapas.
 */
'use client';

import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { Stepper, type EtapaDoStepper } from '@/components/ui/stepper';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { AbaEmpregados } from '../empregados/aba-empregados';
import { ABA_DE_EMPREGADOS, criarDominioDeEmpregados } from '../empregados/dominio';
import { permissoesDeEmpregados } from '../empregados/permissoes';
import { useEmpregados } from '../empregados/queries';
import { ESTADOS_COM_LINHAS_APLICADAS, naoTerminada } from '../importacao/apresentacao';
import { useTentativa } from '../importacao/queries';
import { useEstadoNaUrl } from '../importacao/use-estado-na-url';
import { useSessao } from '../usuarios/queries';
import { ETAPAS_CONCLUIDAS_DO_CADASTRO, ETAPA_DE_EMPREGADOS } from './etapa-plano-de-contas';
import { useEmpresa } from './queries';

const ETAPAS_DO_PASSO: readonly EtapaDoStepper[] = [
  ...ETAPAS_CONCLUIDAS_DO_CADASTRO,
  { id: 'plano-de-contas', rotulo: 'Plano de contas (opcional)', situacao: 'concluida' },
  { ...ETAPA_DE_EMPREGADOS, situacao: 'atual' },
];

const ID_DO_TITULO = 'etapa-de-empregados-titulo';

export const EtapaDeEmpregados = ({ empresaId }: { empresaId: string }) => {
  const navegador = useRouter();
  const { data: visao } = useEmpresa(empresaId);
  const consultaDaSessao = useSessao();
  const { data: sessao } = consultaDaSessao;
  const sessaoIndisponivel = consultaDaSessao.isError && sessao === undefined;
  const problemaDaSessao = consultaDaSessao.error instanceof ErroDaApi ? consultaDaSessao.error.problema : null;
  const permissoes = permissoesDeEmpregados(sessao, false);
  const nomeIdentificado = visao?.cadastro.identificacao?.nomeFantasia ?? visao?.cadastro.identificacao?.razaoSocial ?? null;
  const nome = nomeIdentificado ?? 'Empresa';
  const dominio = criarDominioDeEmpregados(nomeIdentificado);
  const { tentativaId } = useEstadoNaUrl(empresaId, ABA_DE_EMPREGADOS, 'empregados');
  const { data: tentativa } = useTentativa(dominio, empresaId, tentativaId);
  // A primeira página da base diz se já existe empregado (é a mesma consulta da aba, em cache).
  const { data: base } = useEmpregados(empresaId, 1, '');
  const titulo = useRef<HTMLHeadingElement>(null);

  // Vem do plano de contas: o foco vai para o título desta etapa, não fica no botão que saiu.
  useEffect(() => {
    titulo.current?.focus();
  }, []);

  const semPermissaoDeImportar = sessao !== undefined && !permissoes.importar;
  const semNadaAFazer = (tentativa !== undefined && !naoTerminada(tentativa.estado)) || semPermissaoDeImportar;
  const aplicouAgora = tentativa !== undefined && ESTADOS_COM_LINHAS_APLICADAS.includes(tentativa.estado);
  // Enquanto a base não chegou, o aviso não aparece: não se promete nem se nega a pendência.
  const pendenciaAberta = !aplicouAgora && base !== undefined && base.total === 0;
  const sair = (): void => navegador.push('/empresas');

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-col gap-sm">
        <div className="flex flex-wrap items-center gap-sm">
          <h1 className="font-display text-headline-lg text-foreground">{nome}</h1>
          <StatusBadge tom="conforme" rotulo="Ativa" />
        </div>
        <p className="max-w-prose text-body-md text-muted-foreground">
          Empresa ativada. Falta só a base de empregados, e ela é opcional: nada do cadastro depende dela.
        </p>
      </header>

      {/* Seis etapas: em colunas iguais para caber em 768 px sem rolar. */}
      <Stepper etapas={ETAPAS_DO_PASSO} compacto />

      <section aria-labelledby={ID_DO_TITULO} className="flex flex-col gap-lg">
        <div className="flex flex-col gap-md rounded-lg border border-border bg-card p-lg">
          <div className="flex flex-wrap items-center gap-sm">
            <h2
              id={ID_DO_TITULO}
              ref={titulo}
              tabIndex={-1}
              className="font-display text-headline-md text-foreground focus-visible:outline-none"
            >
              Empregados
            </h2>
            <StatusBadge tom="neutro" rotulo="Etapa opcional" />
          </div>

          <div className="flex max-w-prose flex-col gap-xs text-body-md text-muted-foreground">
            <p>
              A empresa já está ativa. Os empregados podem ser importados agora por CSV ou depois, na aba Empregados
              desta empresa. Nenhum empregado muda antes da sua confirmação.
            </p>
            {semPermissaoDeImportar ? (
              <p>
                <span className="text-title-sm text-foreground">{dominio.textos.semPermissaoDeImportar.titulo}</span>{' '}
                O envio de CSV é feito por quem tem a permissão Importar em Empresas → Empregados.
              </p>
            ) : null}
            {pendenciaAberta ? (
              <p>
                Sem importar agora, a pendência Empregados não importados continua visível na Central de Pendências até
                existir ao menos um empregado confirmado.
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

        {consultaDaSessao.isPending ? (
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
          <AbaEmpregados empresaId={empresaId} nomeDaEmpresa={nomeIdentificado} somenteLeitura={false} comCabecalho={false} />
        ) : null}
      </section>
    </div>
  );
};
