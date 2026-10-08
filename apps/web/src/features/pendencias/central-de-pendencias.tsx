/**
 * Central de Pendências (SPEC-005 §2, §6).
 *
 * Mesma estrutura de `lista-de-empresas.tsx`: filtros e página vivem na URL
 * (FRONTEND.md §7), tabela desktop + cartões mobile, dois `EmptyState`
 * distintos (PATTERNS.md §5).
 *
 * Decisão de design (protocolo `frontend-design` aplicado manualmente — sem
 * sessão interativa da skill neste ambiente, registrado no relatório da
 * Task 9): pendência aberta é tarefa que pede ação, não falha do sistema.
 * A Central abre em `estado=ABERTA` (mesmo espírito do filtro padrão `ATIVA`
 * da lista de empresas — mostra primeiro o que precisa de atenção), e o vazio
 * de "nada pendente" usa tom positivo ("Sem pendências"), nunca alarmante,
 * porque zero pendência é o resultado desejado, não uma ausência a lamentar
 * (SPEC-005 §6). Tons de `StatusBadge`: `critico` para o que já perdeu o
 * prazo ou foi rejeitado (vencimento requer ação corretiva imediata, mesma
 * classe de urgência de um erro real); `atencao` para o que falta ou precisa
 * de decisão sem estar necessariamente atrasado; `conforme` para o que já foi
 * resolvido — o mesmo verde que a lista de empresas usa para "Ativa".
 *
 * Import cruzado `../empresa/dialogo-de-justificativa`: decisão registrada no
 * relatório da Task 9. Há precedente direto no projeto (`manutencao-da-empresa.tsx`,
 * da feature `empresa`, já importa `AlertaDePendencias` da feature `pendencias`
 * irmã) — import cruzado entre features irmãs já é aceito aqui. Mover o
 * diálogo para `@/components/` duplicaria uma decisão de organização que o
 * projeto já tomou de outro jeito, sem ganho: o componente é específico do
 * fluxo de justificativa obrigatória, não um primitivo do design system.
 */
'use client';

import { ClipboardCheck, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { dataCivilEmSaoPaulo } from '@contaia/domain';

import { Button } from '@/components/ui/button';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { SemCarteira } from '@/components/ui/sem-carteira';
import { Select } from '@/components/ui/select';
import { StatusBadge, type TomDoStatus } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { DialogoDeJustificativa } from '../empresa/dialogo-de-justificativa';
import { CONSULTA_DO_PLANO, concede } from '../plano-contas/permissoes';
import { useSessao } from '../usuarios/queries';
import type {
  EstadoDaPendencia,
  OrigemDaPendencia,
  Pendencia,
  TipoDaPendencia,
} from './api';
import { useDispensarPendencia, usePendencias } from './queries';

const POR_PAGINA = 25;

const ESTADO_PADRAO: EstadoDaPendencia = 'ABERTA';

const ROTULO_DA_ORIGEM: Readonly<Record<OrigemDaPendencia, string>> = {
  CADASTRAL: 'Cadastral',
  DOCUMENTAL: 'Documental',
  CERTIFICADO: 'Certificado',
  PLANO_CONTAS: 'Plano de contas',
};

const ROTULO_DO_TIPO: Readonly<Record<TipoDaPendencia, string>> = {
  CAMPO_AUSENTE: 'Campo ausente',
  CAMPO_INVALIDO: 'Campo inválido',
  DOCUMENTO_AUSENTE: 'Documento ausente',
  DOCUMENTO_REJEITADO: 'Documento rejeitado',
  DOCUMENTO_VENCIDO: 'Documento vencido',
  EXIGENCIA_ESPECIFICA: 'Exigência específica',
  CERTIFICADO_AUSENTE: 'Certificado ausente',
  CERTIFICADO_VENCIDO: 'Certificado vencido',
  CERTIFICADO_SEM_RESPONSAVEL: 'Certificado sem responsável',
  PLANO_CONTAS_INCOMPLETO: 'Plano de contas incompleto',
};

const OPCOES_DE_ORIGEM = [
  { valor: 'CADASTRAL', rotulo: 'Cadastral' },
  { valor: 'DOCUMENTAL', rotulo: 'Documental' },
  { valor: 'CERTIFICADO', rotulo: 'Certificado' },
  { valor: 'PLANO_CONTAS', rotulo: 'Plano de contas' },
] as const;

const OPCOES_DE_TIPO = (Object.keys(ROTULO_DO_TIPO) as TipoDaPendencia[]).map((tipo) => ({
  valor: tipo,
  rotulo: ROTULO_DO_TIPO[tipo],
}));

const OPCOES_DE_ESTADO = [
  { valor: 'ABERTA', rotulo: 'Abertas' },
  { valor: 'RESOLVIDA', rotulo: 'Resolvidas' },
] as const;

const OPCOES_DE_VENCIMENTO = [
  { valor: 'VENCIDAS', rotulo: 'Vencidas' },
  { valor: 'PROXIMAS', rotulo: 'Próximas do vencimento' },
] as const;

const ehOrigem = (valor: string | null): valor is OrigemDaPendencia =>
  valor === 'CADASTRAL' ||
  valor === 'DOCUMENTAL' ||
  valor === 'CERTIFICADO' ||
  valor === 'PLANO_CONTAS';

const ehTipo = (valor: string | null): valor is TipoDaPendencia =>
  valor !== null && valor in ROTULO_DO_TIPO;

const ehEstado = (valor: string | null): valor is EstadoDaPendencia =>
  valor === 'ABERTA' || valor === 'RESOLVIDA';

const ehVencimento = (valor: string | null): valor is 'VENCIDAS' | 'PROXIMAS' =>
  valor === 'VENCIDAS' || valor === 'PROXIMAS';

/**
 * Mapeamento tom/rótulo do tipo, combinando urgência de prazo (SPEC-005 §6,
 * sugestão do brief da Task 9): vencida ou rejeitada é `critico`; o que falta
 * ou pede decisão é `atencao`; resolvida é `conforme`.
 *
 * `dataLimite` já vem como string civil `YYYY-MM-DD` do backend (mesmo
 * formato usado em `listarCentral`, `packages/db/src/repositorios/pendencias.ts`).
 * Comparar como string contra a data civil de hoje em `America/Sao_Paulo`
 * (`dataCivilEmSaoPaulo`, `@contaia/domain`) evita o problema de fuso perto da
 * meia-noite que `new Date(...)` teria — mesma técnica de `validarVigencia`
 * em `packages/domain/src/empresa/manutencao.ts`.
 */
const tomDaPendencia = (pendencia: Pendencia, hoje: string): TomDoStatus => {
  if (pendencia.estado === 'RESOLVIDA') {
    return 'conforme';
  }

  const vencida = pendencia.dataLimite !== null && pendencia.dataLimite < hoje;

  if (
    vencida ||
    pendencia.tipo === 'DOCUMENTO_VENCIDO' ||
    pendencia.tipo === 'DOCUMENTO_REJEITADO' ||
    pendencia.tipo === 'CERTIFICADO_VENCIDO'
  ) {
    return 'critico';
  }

  return 'atencao';
};

const formatarData = (iso: string | null): string =>
  iso === null ? '—' : new Date(iso).toLocaleDateString('pt-BR');

const Cabecalho = ({ total }: { total: number | null }) => (
  <header className="flex flex-col gap-md tablet:flex-row tablet:items-end tablet:justify-between">
    <div className="flex flex-col gap-xs">
      <h1 className="font-display text-headline-lg text-foreground">Central de Pendências</h1>
      <p className="max-w-prose text-body-md text-muted-foreground">
        {total === null
          ? 'Pendências cadastrais e documentais das empresas deste escritório.'
          : total === 1
            ? '1 pendência encontrada.'
            : `${total.toLocaleString('pt-BR')} pendências encontradas.`}
      </p>
    </div>
  </header>
);

/**
 * Atalho da pendência de plano de contas para a aba da empresa, só para quem consulta o plano
 * (SPEC-013 §3.10, §3.12). A sessão é lida aqui, e não na linha, para as demais origens não
 * dependerem dela.
 */
const AtalhoDoPlanoDeContas = ({ pendencia }: { pendencia: Pendencia }) => {
  const { data: sessao } = useSessao();

  if (sessao === undefined || !concede(sessao, CONSULTA_DO_PLANO)) {
    return null;
  }

  return (
    <Button asChild variante="contorno" tamanho="compacto">
      <Link
        href={`/empresas/${pendencia.empresaId}?aba=plano-contas`}
        aria-label={`Abrir a aba Plano de contas de ${pendencia.empresaNome}`}
      >
        Abrir aba Plano de contas
      </Link>
    </Button>
  );
};

const AcaoDeDispensa = ({ pendencia }: { pendencia: Pendencia }) => {
  const dispensar = useDispensarPendencia();

  // Plano de contas incompleto também não se dispensa (SPEC-013 §3.10): resolve-se com a
  // primeira conta válida, na aba "Plano de contas" da empresa.
  if (pendencia.origem === 'PLANO_CONTAS') {
    return <AtalhoDoPlanoDeContas pendencia={pendencia} />;
  }

  // Pendência do cofre não se dispensa: resolve-se cadastrando o certificado ou escolhendo o
  // responsável (SPEC-011 §3.4–3.5). A ação leva ao registro da empresa no cofre.
  if (pendencia.origem === 'CERTIFICADO') {
    return (
      <Button asChild variante="contorno" tamanho="compacto">
        <Link
          href={`/configuracoes/cofre?empresa=${pendencia.empresaId}`}
          aria-label={`Abrir ${pendencia.empresaNome} no cofre de certificados`}
        >
          Abrir no cofre
        </Link>
      </Button>
    );
  }

  return (
    <DialogoDeJustificativa
      gatilho={
        <Button variante="fantasma" tamanho="compacto">
          Dispensar
        </Button>
      }
      titulo="Dispensar pendência"
      descricao={`A pendência "${ROTULO_DO_TIPO[pendencia.tipo]}" de ${pendencia.empresaNome} será marcada como resolvida.`}
      rotuloDeConfirmacao="Dispensar pendência"
      ocupado={dispensar.isPending}
      aoConfirmar={(justificativa) =>
        dispensar.mutateAsync({
          empresaId: pendencia.empresaId,
          pendenciaId: pendencia.id,
          justificativa,
        })
      }
    />
  );
};

const LinhaDaPendencia = ({ pendencia, hoje }: { pendencia: Pendencia; hoje: string }) => (
  <tr className="border-b border-border last:border-b-0 hover:bg-accent/40">
    <td className="px-md py-sm text-body-md text-foreground">{pendencia.empresaNome}</td>
    <td className="px-md py-sm text-body-sm text-muted-foreground">
      {ROTULO_DA_ORIGEM[pendencia.origem]}
    </td>
    <td className="px-md py-sm text-body-md">
      <StatusBadge tom={tomDaPendencia(pendencia, hoje)} rotulo={ROTULO_DO_TIPO[pendencia.tipo]} />
    </td>
    <td className="px-md py-sm text-body-sm text-muted-foreground">
      {formatarData(pendencia.dataLimite)}
    </td>
    <td className="px-md py-sm text-right">
      {pendencia.estado === 'ABERTA' ? <AcaoDeDispensa pendencia={pendencia} /> : null}
    </td>
  </tr>
);

const CartaoDaPendencia = ({ pendencia, hoje }: { pendencia: Pendencia; hoje: string }) => (
  <li className="flex flex-col gap-sm rounded-lg border border-border bg-card p-md">
    <div className="flex items-start justify-between gap-sm">
      <span className="text-title-sm text-foreground">{pendencia.empresaNome}</span>
      <StatusBadge tom={tomDaPendencia(pendencia, hoje)} rotulo={ROTULO_DO_TIPO[pendencia.tipo]} />
    </div>
    <span className="text-body-sm text-muted-foreground">
      {ROTULO_DA_ORIGEM[pendencia.origem]} · Prazo: {formatarData(pendencia.dataLimite)}
    </span>
    {pendencia.estado === 'ABERTA' ? <AcaoDeDispensa pendencia={pendencia} /> : null}
  </li>
);

const EsqueletoDaTabela = () => (
  <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
    <span className="sr-only">Carregando as pendências</span>
    <Skeleton className="h-9 w-full" />
    {Array.from({ length: 6 }, (_, indice) => (
      <Skeleton key={indice} className="h-12 w-full" />
    ))}
  </div>
);

export const CentralDePendencias = () => {
  const navegador = useRouter();
  const parametros = useSearchParams();

  const empresaIdNaUrl = parametros.get('empresaId');
  const origemNaUrl = parametros.get('origem');
  const tipoNaUrl = parametros.get('tipo');
  const estadoNaUrl = parametros.get('estado');
  const vencimentoNaUrl = parametros.get('vencimento');
  const paginaNaUrl = Math.max(1, Number(parametros.get('pagina') ?? '1') || 1);

  const filtro = useMemo(
    () => ({
      empresaId: empresaIdNaUrl,
      origem: ehOrigem(origemNaUrl) ? origemNaUrl : null,
      tipo: ehTipo(tipoNaUrl) ? tipoNaUrl : null,
      estado: ehEstado(estadoNaUrl) ? estadoNaUrl : ESTADO_PADRAO,
      vencimento: ehVencimento(vencimentoNaUrl) ? vencimentoNaUrl : null,
      limite: POR_PAGINA,
      deslocamento: (paginaNaUrl - 1) * POR_PAGINA,
    }),
    [empresaIdNaUrl, origemNaUrl, tipoNaUrl, estadoNaUrl, vencimentoNaUrl, paginaNaUrl],
  );

  const { data, isPending, isError, error, refetch, isPlaceholderData } = usePendencias(filtro);

  // Data civil de hoje em `America/Sao_Paulo`, recalculada a cada render:
  // é uma string curta e barata de derivar, sem justificar `useMemo`
  // (regra do projeto: nunca `useEffect` para estado derivado).
  const hoje = dataCivilEmSaoPaulo(new Date());

  const definirFiltro = (chave: string, valor: string | null): void => {
    const proximos = new URLSearchParams(parametros.toString());

    if (valor === null) {
      proximos.delete(chave);
    } else {
      proximos.set(chave, valor);
    }

    proximos.delete('pagina');
    navegador.replace(`/pendencias?${proximos.toString()}`, { scroll: false });
  };

  const irParaPagina = (pagina: number): void => {
    const proximos = new URLSearchParams(parametros.toString());

    if (pagina <= 1) {
      proximos.delete('pagina');
    } else {
      proximos.set('pagina', String(pagina));
    }

    navegador.replace(`/pendencias?${proximos.toString()}`, { scroll: false });
  };

  const limparFiltros = (): void => {
    navegador.replace('/pendencias', { scroll: false });
  };

  // O filtro padrão (`estado=ABERTA`, sem os demais) não conta como filtro
  // ativo: ele é a visão de abertura.
  const temFiltroAtivo =
    empresaIdNaUrl !== null ||
    ehOrigem(origemNaUrl) ||
    ehTipo(tipoNaUrl) ||
    (ehEstado(estadoNaUrl) && estadoNaUrl !== ESTADO_PADRAO) ||
    ehVencimento(vencimentoNaUrl);

  const totalDePaginas = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / POR_PAGINA));

  const barraDeFiltro = (
    <div className="flex flex-col gap-md tablet:flex-row tablet:items-end tablet:flex-wrap">
      <div className="w-full tablet:w-[10rem]">
        <Select
          rotulo="Estado"
          opcoes={OPCOES_DE_ESTADO}
          valor={ehEstado(estadoNaUrl) ? estadoNaUrl : ESTADO_PADRAO}
          onValorChange={(valor) => definirFiltro('estado', valor === ESTADO_PADRAO ? null : valor)}
        />
      </div>
      <div className="w-full tablet:w-[10rem]">
        <Select
          rotulo="Origem"
          opcoes={OPCOES_DE_ORIGEM}
          valor={ehOrigem(origemNaUrl) ? origemNaUrl : undefined}
          onValorChange={(valor) => definirFiltro('origem', valor)}
          placeholder="Todas"
        />
      </div>
      <div className="w-full tablet:w-[14rem]">
        <Select
          rotulo="Tipo"
          opcoes={OPCOES_DE_TIPO}
          valor={ehTipo(tipoNaUrl) ? tipoNaUrl : undefined}
          onValorChange={(valor) => definirFiltro('tipo', valor)}
          placeholder="Todos"
        />
      </div>
      <div className="w-full tablet:w-[12rem]">
        <Select
          rotulo="Vencimento"
          opcoes={OPCOES_DE_VENCIMENTO}
          valor={ehVencimento(vencimentoNaUrl) ? vencimentoNaUrl : undefined}
          onValorChange={(valor) => definirFiltro('vencimento', valor)}
          placeholder="Todos"
        />
      </div>
      {temFiltroAtivo ? (
        <Button variante="contorno" tamanho="compacto" onClick={limparFiltros}>
          Limpar filtros
        </Button>
      ) : null}
    </div>
  );

  if (isPending) {
    return (
      <div className="flex flex-col gap-xl">
        <Cabecalho total={null} />
        {barraDeFiltro}
        <EsqueletoDaTabela />
      </div>
    );
  }

  if (isError) {
    const problema = error instanceof ErroDaApi ? error.problema : null;

    return (
      <div className="flex flex-col gap-xl">
        <Cabecalho total={null} />
        {barraDeFiltro}
        <ErroDeTela
          nivel={2}
          titulo="Não foi possível carregar as pendências"
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
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-xl">
      <Cabecalho total={data.total} />
      {barraDeFiltro}

      {data.escopoDeEmpresas === 'NENHUMA' ? (
        <SemCarteira descricao="Quando houver empresas atribuídas à sua carteira, as pendências delas aparecem aqui. Enquanto isso, você acessa apenas as áreas que não dependem de uma empresa." />
      ) : data.pendencias.length === 0 ? (
        temFiltroAtivo ? (
          <EmptyState
            nivel={2}
            icone={<Search />}
            titulo="Nenhuma pendência encontrada"
            descricao="Nenhuma pendência corresponde ao filtro aplicado. Ajuste os critérios para ver mais resultados."
            acao={
              <Button variante="contorno" tamanho="compacto" onClick={limparFiltros}>
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            nivel={2}
            icone={<ClipboardCheck />}
            titulo="Sem pendências"
            descricao="Nenhuma pendência cadastral ou documental em aberto no momento."
          />
        )
      ) : (
        <div
          className={isPlaceholderData ? 'opacity-60 transition-opacity duration-fast' : undefined}
        >
          <ul className="flex flex-col gap-sm tablet:hidden">
            {data.pendencias.map((pendencia) => (
              <CartaoDaPendencia key={pendencia.id} pendencia={pendencia} hoje={hoje} />
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-lg border border-border bg-card tablet:block">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                Pendências cadastrais e documentais das empresas deste escritório
              </caption>
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">
                    Empresa
                  </th>
                  <th scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">
                    Origem
                  </th>
                  <th scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">
                    Tipo
                  </th>
                  <th scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">
                    Prazo
                  </th>
                  <th scope="col" className="px-md py-sm text-right text-label-sm uppercase text-muted-foreground">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.pendencias.map((pendencia) => (
                  <LinhaDaPendencia key={pendencia.id} pendencia={pendencia} hoje={hoje} />
                ))}
              </tbody>
            </table>
          </div>

          {totalDePaginas > 1 ? (
            <nav
              className="flex items-center justify-between gap-md pt-md"
              aria-label="Paginação das pendências"
            >
              <p className="text-body-sm text-muted-foreground">
                Página {paginaNaUrl} de {totalDePaginas}
              </p>
              <div className="flex gap-xs">
                <Button
                  variante="contorno"
                  tamanho="compacto"
                  disabled={paginaNaUrl <= 1}
                  onClick={() => irParaPagina(paginaNaUrl - 1)}
                >
                  Anterior
                </Button>
                <Button
                  variante="contorno"
                  tamanho="compacto"
                  disabled={paginaNaUrl >= totalDePaginas}
                  onClick={() => irParaPagina(paginaNaUrl + 1)}
                >
                  Próxima
                </Button>
              </div>
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
};
