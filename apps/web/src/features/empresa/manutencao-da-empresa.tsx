/**
 * Manutenção da empresa ativa (SPEC-003 §3.1, §3.2 e §3.5): abas Identificação,
 * Dados fiscais e Endereços, com arquivamento e reativação.
 *
 * A aba aberta vive na URL (`?aba=`): o link da notificação de importação
 * (`?aba=plano-contas&tentativa=…`, SPEC-013 §3.10) cai direto no Plano de contas, e
 * aba desconhecida ou sem permissão volta para a primeira permitida.
 *
 * Os formulários são os mesmos do cadastro, com o salvamento trocado: aqui cada
 * alteração precisa gerar evento no Histórico de Informações, e a rota do
 * wizard não registra nada. Duplicar os formulários faria duas telas
 * divergirem com o tempo; trocar só o salvamento mantém uma fonte.
 */
'use client';

import { formatarCnpj } from '@contaia/domain';
import * as Tabs from '@radix-ui/react-tabs';
import { Archive, History, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/cn';
import { AbaDeColaboradores } from '../carteira/aba-de-colaboradores';
import { AlertaDePendencias } from '../pendencias/alerta-de-pendencias';
import { AbaPlanoDeContas } from '../plano-contas/aba-plano-de-contas';
import { CONSULTA_DO_PLANO, concede } from '../plano-contas/permissoes';
import { ADMINISTRACAO_DE_USUARIOS, pode } from '../usuarios/permissoes';
import { useSessao } from '../usuarios/queries';
import { AbaDeDocumentos } from './aba-de-documentos';
import { AbaDeEnderecos } from './aba-de-enderecos';
import { AtualizacaoPelaCnpja } from './atualizacao-pela-cnpja';
import { DialogoDeJustificativa } from './dialogo-de-justificativa';
import { FormularioFiscal } from './formulario-fiscal';
import { FormularioIdentificacao } from './formulario-identificacao';
import {
  useArquivarEmpresa,
  useReativarEmpresa,
  useSalvarFiscaisMantidos,
  useSalvarIdentificacaoMantida,
} from './manutencao-queries';
import type { VisaoDaEmpresa } from './api';

const ABAS = [
  { id: 'identificacao', rotulo: 'Identificação' },
  { id: 'fiscal', rotulo: 'Dados fiscais' },
  { id: 'enderecos', rotulo: 'Endereços' },
  { id: 'documentos', rotulo: 'Documentos' },
  { id: 'plano-contas', rotulo: 'Plano de contas' },
  { id: 'colaboradores', rotulo: 'Colaboradores' },
] as const;

type IdDaAba = (typeof ABAS)[number]['id'];

/**
 * Aba ativa: a da URL, se existir e for permitida; senão a primeira. A escolha por clique vale na
 * hora (sem esperar a navegação) e some assim que a URL a reflete — ou muda por fora, como no
 * "voltar" do navegador ou num link de notificação.
 */
const useAbaNaUrl = (empresaId: string, permitidas: readonly IdDaAba[]) => {
  const navegador = useRouter();
  const parametros = useSearchParams();
  const naUrl = parametros.get('aba');
  const [escolha, definirEscolha] = useState<Readonly<{ urlVista: string | null; aba: string }> | null>(null);
  const pedida = escolha !== null && escolha.urlVista === naUrl ? escolha.aba : naUrl;
  const ativa = permitidas.find((aba) => aba === pedida) ?? permitidas[0] ?? 'identificacao';

  const abrir = (aba: string): void => {
    definirEscolha({ urlVista: naUrl, aba });
    const proximos = new URLSearchParams();

    if (aba !== permitidas[0]) {
      proximos.set('aba', aba);
    }

    const consulta = proximos.toString();
    navegador.replace(consulta === '' ? `/empresas/${empresaId}` : `/empresas/${empresaId}?${consulta}`, {
      scroll: false,
    });
  };

  return { ativa, abrir, pedida };
};

/** Abas que só existem depois que a sessão diz o que o papel pode. */
const ABAS_QUE_DEPENDEM_DA_SESSAO: readonly string[] = ['plano-contas', 'colaboradores'];

// Ativo e inativo com a mesma métrica de fonte: trocar o peso mudaria a largura
// e deslocaria o layout (COMPONENTS.md §2.5).
const CLASSES_DA_ABA = [
  // `basis-0 min-w-[8rem]`: as abas dividem a linha por igual e param de
  // encolher antes de o rótulo quebrar no meio, como acontecia em 375px.
  'flex-1 basis-0 min-w-[8rem] rounded-md px-md py-sm text-center text-title-sm transition-colors duration-fast ease-out',
  'text-muted-foreground hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  'data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-[var(--elevation-1)]',
];

const Cabecalho = ({
  visao,
  arquivada,
}: {
  visao: VisaoDaEmpresa;
  arquivada: boolean;
}) => {
  const identificacao = visao.cadastro.identificacao;
  const nome = identificacao?.nomeFantasia ?? identificacao?.razaoSocial ?? 'Empresa';
  const arquivar = useArquivarEmpresa(visao.id);
  const reativar = useReativarEmpresa(visao.id);

  return (
    <div className="flex flex-col gap-md">
      <header className="flex flex-col gap-md tablet:flex-row tablet:items-start tablet:justify-between">
        <div className="flex flex-col gap-xs">
          <div className="flex flex-wrap items-center gap-sm">
            <h1 className="font-display text-headline-lg text-foreground">{nome}</h1>
            <StatusBadge
              tom={arquivada ? 'neutro' : 'conforme'}
              rotulo={arquivada ? 'Arquivada' : 'Ativa'}
            />
          </div>
          <p className="font-mono text-code-sm tabular-nums text-muted-foreground">
            {formatarCnpj(identificacao?.cnpj ?? '')}
          </p>
          {identificacao?.razaoSocial !== undefined &&
          identificacao.razaoSocial !== nome ? (
            <p className="text-body-sm text-muted-foreground">{identificacao.razaoSocial}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-sm">
          <Button asChild variante="fantasma" tamanho="compacto">
            <Link href={`/historico?empresaId=${visao.id}`}>
              <History aria-hidden="true" />
              Ver histórico
            </Link>
          </Button>

          {arquivada ? (
            <DialogoDeJustificativa
              gatilho={
                <Button tamanho="compacto">
                  <RotateCcw aria-hidden="true" />
                  Reativar empresa
                </Button>
              }
              titulo={`Reativar ${nome}?`}
              descricao="A empresa volta a ficar editável com todos os dados preservados. A reativação fica registrada com autor, data e justificativa."
              rotuloDeConfirmacao="Reativar empresa"
              ocupado={reativar.isPending}
              aoConfirmar={(justificativa) => reativar.mutateAsync(justificativa)}
            />
          ) : (
            <DialogoDeJustificativa
              gatilho={
                <Button variante="contorno" tamanho="compacto">
                  <Archive aria-hidden="true" />
                  Arquivar empresa
                </Button>
              }
              titulo={`Arquivar ${nome}?`}
              descricao="A empresa fica somente para consulta até ser reativada. Nenhum dado é excluído, e o arquivamento fica registrado com autor, data e justificativa."
              rotuloDeConfirmacao="Arquivar empresa"
              destrutivo
              ocupado={arquivar.isPending}
              aoConfirmar={(justificativa) => arquivar.mutateAsync(justificativa)}
            />
          )}
        </div>
      </header>

      <AlertaDePendencias empresaId={visao.id} />
    </div>
  );
};

export const ManutencaoDaEmpresa = ({
  visao,
  arquivada,
}: {
  visao: VisaoDaEmpresa;
  arquivada: boolean;
}) => {
  const salvarIdentificacao = useSalvarIdentificacaoMantida(visao.id);
  const salvarFiscais = useSalvarFiscaisMantidos(visao.id);
  const { data: sessao, isPending: carregandoSessao } = useSessao();
  // Só o administrador gere carteira (SPEC-009 §3.1): a aba não existe para os demais papéis.
  const administraCarteira = sessao !== undefined && pode(sessao, ADMINISTRACAO_DE_USUARIOS);
  // Plano de contas aparece para quem consulta (SPEC-013 §3.12); a API revalida em cada rota.
  const consultaPlano = sessao !== undefined && concede(sessao, CONSULTA_DO_PLANO);
  const abas = ABAS.filter(
    (aba) =>
      (aba.id !== 'colaboradores' || administraCarteira) && (aba.id !== 'plano-contas' || consultaPlano),
  );
  const aba = useAbaNaUrl(
    visao.id,
    abas.map((item) => item.id),
  );
  // Deep link (`?aba=plano-contas`, link da notificação) com a sessão ainda a caminho: a aba
  // pedida ainda não existe, e cair em Identificação para trocar logo depois piscaria a tela.
  const esperandoAbaPedida =
    sessao === undefined && carregandoSessao && aba.pedida !== null && ABAS_QUE_DEPENDEM_DA_SESSAO.includes(aba.pedida);
  const nomeDaEmpresa =
    visao.cadastro.identificacao?.nomeFantasia ?? visao.cadastro.identificacao?.razaoSocial ?? 'a empresa';

  return (
    <div className="flex flex-col gap-xl">
      <Cabecalho visao={visao} arquivada={arquivada} />

      {arquivada ? (
        <p
          role="status"
          className="rounded-md border border-border bg-muted/40 px-md py-sm text-body-sm text-muted-foreground"
        >
          Esta empresa está arquivada e permanece somente para consulta. Reative-a para
          voltar a editar os dados.
        </p>
      ) : null}

      {esperandoAbaPedida ? (
        <div className="flex flex-col gap-lg" aria-busy="true">
          <span className="sr-only">Carregando a aba da empresa</span>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <Tabs.Root value={aba.ativa} onValueChange={aba.abrir} className="flex flex-col gap-lg">
          <Tabs.List
            aria-label="Seções da empresa"
            className="flex flex-wrap gap-xs rounded-md bg-secondary p-xs"
          >
            {abas.map((aba) => (
              <Tabs.Trigger key={aba.id} value={aba.id} className={cn(CLASSES_DA_ABA)}>
                {aba.rotulo}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <Tabs.Content
            value="identificacao"
            className="flex flex-col gap-lg focus-visible:outline-none"
          >
            <FormularioIdentificacao
              visao={visao}
              rotuloDeEnvio="Salvar alterações"
              somenteLeitura={arquivada}
              ocupado={salvarIdentificacao.isPending}
              aoSalvar={(dados) =>
                salvarIdentificacao.mutate({
                  razaoSocial: dados.razaoSocial,
                  nomeFantasia: dados.nomeFantasia,
                  telefone: (dados.telefone ?? '').length > 0 ? (dados.telefone ?? null) : null,
                  email: (dados.email ?? '').length > 0 ? (dados.email ?? null) : null,
                })
              }
            />

            <AtualizacaoPelaCnpja empresaId={visao.id} somenteLeitura={arquivada} />
          </Tabs.Content>

          <Tabs.Content value="fiscal" className="focus-visible:outline-none">
            <FormularioFiscal
              visao={visao}
              rotuloDeEnvio="Salvar alterações"
              exigeVigencia
              somenteLeitura={arquivada}
              ocupado={salvarFiscais.isPending}
              aoSalvar={(dados, vigencia) =>
                salvarFiscais.mutate({
                  dados: {
                    ...dados,
                    // O formulário usa `undefined` para "não escolhido"; o
                    // contrato da API usa `null`. A conversão é aqui, na
                    // fronteira, e não espalhada pelo schema.
                    enquadramentoSimples: dados.enquadramentoSimples ?? null,
                    inscricaoEstadual: {
                      situacao: dados.inscricaoEstadual.situacao,
                      numero: dados.inscricaoEstadual.numero ?? null,
                    },
                    inscricaoMunicipal: {
                      situacao: dados.inscricaoMunicipal.situacao,
                      numero: dados.inscricaoMunicipal.numero ?? null,
                    },
                  },
                  vigencia,
                })
              }
            />
          </Tabs.Content>

          <Tabs.Content value="enderecos" className="focus-visible:outline-none">
            <AbaDeEnderecos empresaId={visao.id} somenteLeitura={arquivada} />
          </Tabs.Content>

          <Tabs.Content value="documentos" className="focus-visible:outline-none">
            <AbaDeDocumentos empresaId={visao.id} somenteLeitura={arquivada} />
          </Tabs.Content>

          {consultaPlano ? (
            <Tabs.Content value="plano-contas" className="focus-visible:outline-none">
              <AbaPlanoDeContas empresaId={visao.id} somenteLeitura={arquivada} />
            </Tabs.Content>
          ) : null}

          {administraCarteira ? (
            <Tabs.Content value="colaboradores" className="focus-visible:outline-none">
              <AbaDeColaboradores empresaId={visao.id} empresaNome={nomeDaEmpresa} />
            </Tabs.Content>
          ) : null}
        </Tabs.Root>
      )}
    </div>
  );
};
