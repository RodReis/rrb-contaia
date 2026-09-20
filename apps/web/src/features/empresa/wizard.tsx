/**
 * Wizard de cadastro da empresa cliente (SPEC-002 §3.2).
 *
 * Persistente por etapa: cada `Salvar e continuar` grava no servidor, então sair
 * do fluxo preserva o progresso como `CADASTRO_INCOMPLETO` e uma nova sessão
 * retoma a primeira etapa pendente — a etapa exibida é derivada do que o
 * servidor informa, não de estado local.
 */
'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ETAPAS_DA_EMPRESA, formatarCep, formatarCnpj, formatarTelefone } from '@contaia/domain';
import type { EtapaDaEmpresa } from '@contaia/domain';

import { Button } from '@/components/ui/button';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { Stepper, type SituacaoDaEtapa } from '@/components/ui/stepper';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { FormularioEndereco } from './formulario-endereco';
import { FormularioFiscal } from './formulario-fiscal';
import { FormularioIdentificacao } from './formulario-identificacao';
import { useAtivarEmpresa, useEmpresa } from './queries';
import type { VisaoDaEmpresa } from './api';

const ROTULO_DA_ETAPA: Readonly<Record<EtapaDaEmpresa, string>> = {
  identificacao: 'Identificação',
  fiscal: 'Dados fiscais',
  endereco: 'Endereço principal',
  revisao: 'Revisão e ativação',
};

const ROTULO_DO_REGIME: Readonly<Record<string, string>> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
};

const ROTULO_DA_INSCRICAO: Readonly<Record<string, string>> = {
  POSSUI: 'Possui',
  ISENTO: 'Isento',
  NAO_SE_APLICA: 'Não se aplica',
};

const situacaoDa = (
  etapa: EtapaDaEmpresa,
  atual: EtapaDaEmpresa,
  concluidas: readonly EtapaDaEmpresa[],
): SituacaoDaEtapa => {
  if (etapa === atual) {
    return 'atual';
  }

  return concluidas.includes(etapa) ? 'concluida' : 'pendente';
};

const Linha = ({ rotulo, valor }: { rotulo: string; valor: string }) => (
  <div className="flex flex-col gap-xs border-b border-border py-sm last:border-b-0">
    <dt className="text-label-sm uppercase text-muted-foreground">{rotulo}</dt>
    <dd className="text-body-md text-foreground">{valor}</dd>
  </div>
);

const LinhaMono = ({ rotulo, valor }: { rotulo: string; valor: string }) => (
  <div className="flex flex-col gap-xs border-b border-border py-sm last:border-b-0">
    <dt className="text-label-sm uppercase text-muted-foreground">{rotulo}</dt>
    <dd className="font-mono text-code-sm tabular-nums text-foreground">{valor}</dd>
  </div>
);

const Secao = ({
  titulo,
  aoEditar,
  children,
}: {
  titulo: string;
  aoEditar: () => void;
  children: React.ReactNode;
}) => (
  <section className="flex flex-col gap-sm rounded-lg border border-border bg-card p-lg">
    <div className="flex items-center justify-between gap-sm">
      <h3 className="text-headline-sm text-foreground">{titulo}</h3>
      <Button variante="fantasma" tamanho="compacto" onClick={aoEditar}>
        Editar
      </Button>
    </div>
    <dl>{children}</dl>
  </section>
);

const Revisao = ({
  visao,
  aoEditar,
}: {
  visao: VisaoDaEmpresa;
  aoEditar: (etapa: EtapaDaEmpresa) => void;
}) => {
  const navegador = useRouter();
  const { identificacao, dadosFiscais, enderecoPrincipal, status } = visao.cadastro;
  const [confirmacaoAberta, definirConfirmacao] = useState(false);

  const ativar = useAtivarEmpresa(visao.id, () => navegador.push('/empresas'));
  const jaAtiva = status === 'ATIVA';

  const pendencias = ETAPAS_DA_EMPRESA.filter(
    (etapa) => etapa !== 'revisao' && !visao.etapasConcluidas.includes(etapa),
  );

  const nome = identificacao?.nomeFantasia ?? identificacao?.razaoSocial ?? 'esta empresa';
  const cnpjFormatado =
    identificacao !== null && identificacao.cnpj.length > 0
      ? formatarCnpj(identificacao.cnpj)
      : '—';

  return (
    <div className="flex flex-col gap-lg">
      {pendencias.length > 0 ? (
        <div
          role="alert"
          className="flex flex-col gap-xs rounded-md border border-warning-indicator/40 bg-warning px-md py-md"
        >
          <p className="text-title-sm text-warning-foreground">
            Faltam etapas para ativar a empresa
          </p>
          <ul className="list-inside list-disc text-body-sm text-warning-foreground/90">
            {pendencias.map((etapa) => (
              <li key={etapa}>{ROTULO_DA_ETAPA[etapa]}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {visao.exigeConfirmacaoDeSituacaoExterna ? (
        <div
          role="alert"
          className="flex items-start gap-sm rounded-md border border-warning-indicator/40 bg-warning px-md py-md"
        >
          <CircleAlert
            className="size-icon-md shrink-0 text-warning-indicator"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-xs">
            <p className="text-title-sm text-warning-foreground">
              Situação cadastral na fonte externa: {visao.cadastro.situacaoCadastralExterna}
            </p>
            <p className="text-body-sm text-warning-foreground/90">
              A empresa pode ser ativada, mas a ativação exige confirmação explícita desta
              situação.
            </p>
          </div>
        </div>
      ) : null}

      {!visao.cadastro.validadoPorFonteExterna ? (
        <p className="text-body-sm text-muted-foreground">
          Os dados desta empresa não foram validados pela base pública de CNPJ.
        </p>
      ) : null}

      <Secao titulo="Identificação" aoEditar={() => aoEditar('identificacao')}>
        <LinhaMono rotulo="CNPJ" valor={cnpjFormatado} />
        <Linha rotulo="Razão social" valor={identificacao?.razaoSocial || '—'} />
        <Linha rotulo="Nome fantasia" valor={identificacao?.nomeFantasia || '—'} />
        <LinhaMono
          rotulo="Telefone"
          valor={
            identificacao?.telefone !== null && identificacao?.telefone !== undefined
              ? formatarTelefone(identificacao.telefone)
              : '—'
          }
        />
        <Linha rotulo="E-mail" valor={identificacao?.email ?? '—'} />
      </Secao>

      <Secao titulo="Dados fiscais" aoEditar={() => aoEditar('fiscal')}>
        <Linha
          rotulo="Regime tributário"
          valor={
            dadosFiscais?.regimeTributario === null || dadosFiscais?.regimeTributario === undefined
              ? '—'
              : (ROTULO_DO_REGIME[dadosFiscais.regimeTributario] ??
                dadosFiscais.regimeTributario)
          }
        />
        {dadosFiscais?.regimeTributario === 'SIMPLES_NACIONAL' ? (
          <Linha
            rotulo="Enquadramento"
            valor={dadosFiscais.enquadramentoSimples === 'MEI' ? 'MEI' : 'Não MEI'}
          />
        ) : null}
        <LinhaMono rotulo="CNAE principal" valor={dadosFiscais?.cnaePrincipal || '—'} />
        <LinhaMono
          rotulo="CNAEs secundários"
          valor={
            dadosFiscais === null || dadosFiscais.cnaesSecundarios.length === 0
              ? '—'
              : dadosFiscais.cnaesSecundarios.join(', ')
          }
        />
        <Linha
          rotulo="Inscrição estadual"
          valor={
            dadosFiscais === null
              ? '—'
              : `${ROTULO_DA_INSCRICAO[dadosFiscais.inscricaoEstadual.situacao] ?? '—'}${
                  dadosFiscais.inscricaoEstadual.numero !== null
                    ? ` — ${dadosFiscais.inscricaoEstadual.numero}`
                    : ''
                }`
          }
        />
        <Linha
          rotulo="Inscrição municipal"
          valor={
            dadosFiscais === null
              ? '—'
              : `${ROTULO_DA_INSCRICAO[dadosFiscais.inscricaoMunicipal.situacao] ?? '—'}${
                  dadosFiscais.inscricaoMunicipal.numero !== null
                    ? ` — ${dadosFiscais.inscricaoMunicipal.numero}`
                    : ''
                }`
          }
        />
      </Secao>

      <Secao titulo="Endereço principal" aoEditar={() => aoEditar('endereco')}>
        <LinhaMono
          rotulo="CEP"
          valor={
            enderecoPrincipal !== null && enderecoPrincipal.cep.length > 0
              ? formatarCep(enderecoPrincipal.cep)
              : '—'
          }
        />
        <Linha
          rotulo="Logradouro"
          valor={
            enderecoPrincipal === null
              ? '—'
              : `${enderecoPrincipal.logradouro}, ${enderecoPrincipal.numero}${
                  enderecoPrincipal.complemento !== null &&
                  enderecoPrincipal.complemento.length > 0
                    ? ` — ${enderecoPrincipal.complemento}`
                    : ''
                }`
          }
        />
        <Linha
          rotulo="Município"
          valor={
            enderecoPrincipal === null
              ? '—'
              : `${enderecoPrincipal.bairro}, ${enderecoPrincipal.municipio}/${enderecoPrincipal.uf}`
          }
        />
      </Secao>

      {/* Empresa já ativa: a revisão vira consulta pura, sem repetir a ação
          de ativar (já concluída) nem convidar a clicar de novo. */}
      {jaAtiva ? null : (
      <div className="flex justify-end">
        {/* Situação irregular exige ato explícito: a confirmação vai para
            AlertDialog, que não fecha por clique fora (COMPONENTS.md §3.9). */}
        {visao.exigeConfirmacaoDeSituacaoExterna ? (
          <AlertDialog.Root open={confirmacaoAberta} onOpenChange={definirConfirmacao}>
            <AlertDialog.Trigger asChild>
              <Button disabled={!visao.podeAtivar || ativar.isPending}>
                {ativar.isPending ? 'Ativando…' : 'Ativar empresa'}
              </Button>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="fixed inset-0 z-50 bg-primary/40" />
              <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-[28rem] -translate-x-1/2 -translate-y-1/2 flex-col gap-md rounded-lg border border-border bg-popover p-lg text-popover-foreground shadow-lg">
                <AlertDialog.Title className="text-headline-sm text-foreground">
                  Ativar {nome} com situação {visao.cadastro.situacaoCadastralExterna}?
                </AlertDialog.Title>
                <AlertDialog.Description className="text-body-md text-muted-foreground">
                  A base pública indica que o CNPJ {cnpjFormatado} não está com situação Ativa.
                  A empresa será ativada no ContaIA mesmo assim, e essa escolha fica registrada.
                </AlertDialog.Description>
                <div className="flex flex-wrap justify-end gap-sm">
                  <AlertDialog.Cancel asChild>
                    <Button variante="contorno" tamanho="compacto">
                      Cancelar
                    </Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action asChild>
                    <Button
                      tamanho="compacto"
                      onClick={() => ativar.mutate(true)}
                      disabled={ativar.isPending}
                    >
                      Confirmar e ativar
                    </Button>
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        ) : (
          <Button
            onClick={() => ativar.mutate(false)}
            disabled={!visao.podeAtivar || ativar.isPending}
          >
            {ativar.isPending ? 'Ativando…' : 'Ativar empresa'}
          </Button>
        )}
      </div>
      )}
    </div>
  );
};

export const WizardDaEmpresa = ({ empresaId }: { empresaId: string }) => {
  const { data: visao, isPending, isError, error, refetch } = useEmpresa(empresaId);
  // `null` significa "ainda não navegou": a etapa exibida vem da primeira
  // incompleta que o servidor informa. Guardar a escolha só quando o usuário
  // navega evita sincronizar estado com efeito.
  const [etapaEscolhida, definirEtapa] = useState<EtapaDaEmpresa | null>(null);

  if (isPending) {
    return (
      <div className="flex flex-col gap-lg" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando o cadastro da empresa</span>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError) {
    const problema = error instanceof ErroDaApi ? error.problema : null;

    return (
      <div className="flex flex-col gap-lg">
        <ErroDeTela
          nivel={2}
          titulo="Não foi possível carregar a empresa"
          descricao={
            problema === null ? 'Tente novamente em instantes.' : mensagemDoCodigo(problema.code)
          }
          correlationId={problema?.correlationId}
          acao={
            <div className="flex flex-wrap gap-sm">
              <Button variante="contorno" tamanho="compacto" onClick={() => void refetch()}>
                Tentar de novo
              </Button>
              <Button asChild variante="fantasma" tamanho="compacto">
                <Link href="/empresas">Voltar para a lista</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const atual = etapaEscolhida ?? visao.proximaEtapa ?? 'revisao';
  const ativa = visao.cadastro.status === 'ATIVA';
  const nome =
    visao.cadastro.identificacao?.nomeFantasia ??
    visao.cadastro.identificacao?.razaoSocial ??
    'Empresa';

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-col gap-sm">
        <div className="flex flex-wrap items-center gap-sm">
          <h1 className="font-display text-headline-lg text-foreground">{nome}</h1>
          <StatusBadge
            tom={ativa ? 'conforme' : 'atencao'}
            rotulo={ativa ? 'Ativa' : 'Cadastro incompleto'}
          />
        </div>
        <p className="max-w-prose text-body-md text-muted-foreground">
          {ativa
            ? 'Empresa ativa. Consulte os dados do cadastro abaixo.'
            : 'Conclua as quatro etapas para ativar a empresa. O progresso é salvo a cada etapa e pode ser retomado depois.'}
        </p>
      </header>

      <Stepper
        etapas={ETAPAS_DA_EMPRESA.map((etapa) => ({
          id: etapa,
          rotulo: ROTULO_DA_ETAPA[etapa],
          situacao: situacaoDa(etapa, atual, visao.etapasConcluidas),
        }))}
        onSelecionar={(id) => definirEtapa(id as EtapaDaEmpresa)}
      />

      <section aria-label={ROTULO_DA_ETAPA[atual]} className="flex flex-col gap-lg">
        <h2 className="text-headline-md text-foreground">{ROTULO_DA_ETAPA[atual]}</h2>

        {atual === 'identificacao' ? (
          <FormularioIdentificacao
            visao={visao}
            aoAvancar={() => definirEtapa('fiscal')}
            rotuloDeEnvio={ativa ? 'Salvar' : 'Salvar e continuar'}
          />
        ) : null}

        {atual === 'fiscal' ? (
          <FormularioFiscal
            visao={visao}
            aoAvancar={() => definirEtapa('endereco')}
            rotuloDeEnvio={ativa ? 'Salvar' : 'Salvar e continuar'}
          />
        ) : null}

        {atual === 'endereco' ? (
          <FormularioEndereco
            visao={visao}
            aoAvancar={() => definirEtapa('revisao')}
            rotuloDeEnvio={ativa ? 'Salvar' : 'Salvar e continuar'}
          />
        ) : null}

        {atual === 'revisao' ? <Revisao visao={visao} aoEditar={definirEtapa} /> : null}
      </section>
    </div>
  );
};
