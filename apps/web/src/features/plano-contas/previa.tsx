/**
 * Prévia em `AGUARDANDO_CONFIRMACAO` (SPEC-013 §3.5, §3.6, §3.8): nada mudou no plano ainda. A
 * pessoa vê os totais e as rejeições e decide — `Confirmar importação` aplica só as linhas válidas
 * numa transação; `Cancelar importação` encerra a tentativa sem tocar no plano. As duas passam por
 * `AlertDialog` com os números da decisão.
 *
 * Conflito de versão (o plano mudou depois da validação, HTTP 409): nada foi aplicado e a prévia
 * ficou obsoleta. A saída é cancelar e enviar o arquivo de novo; a tela não promete revalidar esta
 * mesma tentativa, porque o servidor não faz isso.
 */
'use client';

import type { PreviaDaImportacao } from '@contaia/shared';
import { Ban, CheckCircle2, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmacaoDeAcao } from '@/components/ui/confirmacao-de-acao';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { plural } from './apresentacao';
import type { PermissoesDoPlano } from './permissoes';
import { useCancelarImportacao, useConfirmarImportacao } from './queries';
import { ResumoDaTentativa } from './resumo-da-tentativa';
import { TabelaDeRejeicoes } from './tabela-de-rejeicoes';

const explicarRecusa = (erro: unknown): string | null => {
  if (!(erro instanceof ErroDaApi)) {
    return null;
  }

  // O conflito de versão não passa por aqui: ele troca as ações pelo `PainelDeConflito`.
  return erro.problema.code === 'ESTADO_INVALIDO_PARA_ACAO' ? mensagemDoCodigo(erro.problema.code) : null;
};

const textoDaDecisao = (totais: NonNullable<PreviaDaImportacao['totais']>): string =>
  [
    `${plural(totais.novas, 'conta nova será incluída', 'contas novas serão incluídas')} e ${plural(
      totais.atualizadas,
      'existente será atualizada',
      'existentes serão atualizadas',
    )} pelo código, numa única transação.`,
    totais.rejeitadas > 0
      ? `${plural(totais.rejeitadas, 'linha rejeitada fica', 'linhas rejeitadas ficam')} de fora e no relatório.`
      : '',
    'Contas que não estão no arquivo continuam como estão.',
  ]
    .filter((frase) => frase !== '')
    .join(' ');

/**
 * O conflito chega com o diálogo de confirmação aberto; ele some junto com o botão e o foco vem
 * para cá, onde está a explicação e a única saída possível.
 */
const PainelDeConflito = ({
  nomeDoArquivo,
  aoCancelar,
}: {
  nomeDoArquivo: string;
  aoCancelar: () => Promise<unknown>;
}) => {
  const titulo = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    titulo.current?.focus();
  }, []);

  return (
    <div role="alert" className="flex flex-col gap-sm rounded-md border border-danger-indicator/40 bg-danger px-md py-md">
      <p ref={titulo} tabIndex={-1} className="text-title-sm text-danger-foreground focus-visible:outline-none">
        O plano de contas mudou depois desta validação
      </p>
      <p className="max-w-prose text-body-sm text-danger-foreground">
        Nenhuma conta foi alterada. Esta prévia ficou obsoleta: cancele-a e envie o arquivo de novo, para a validação
        usar o plano atual.
      </p>
      <div>
        <ConfirmacaoDeAcao
          gatilho={
            <Button variante="contorno" tamanho="compacto">
              <RefreshCw aria-hidden="true" />
              Cancelar e validar novamente
            </Button>
          }
          titulo="Cancelar esta prévia?"
          descricao={`A tentativa de ${nomeDoArquivo} fica no histórico como cancelada e o plano não muda. Em seguida, envie o arquivo de novo.`}
          rotuloDeConfirmacao="Cancelar prévia"
          destrutivo
          aoConfirmar={aoCancelar}
        />
      </div>
    </div>
  );
};

const AvisoDaPrevia = ({ totais }: { totais: NonNullable<PreviaDaImportacao['totais']> }) =>
  totais.rejeitadas === 0 ? (
    <p className="flex items-start gap-xs rounded-md bg-success px-md py-sm text-body-sm text-success-foreground">
      <CheckCircle2 className="mt-xs size-icon-xs shrink-0" aria-hidden="true" />
      Todas as {plural(totais.lidas, 'linha lida é válida', 'linhas lidas são válidas')}. Nada foi aplicado ainda:
      revise e confirme.
    </p>
  ) : (
    <p className="flex items-start gap-xs rounded-md bg-warning px-md py-sm text-body-sm text-warning-foreground">
      <TriangleAlert className="mt-xs size-icon-xs shrink-0" aria-hidden="true" />
      {plural(totais.rejeitadas, 'linha foi rejeitada', 'linhas foram rejeitadas')} e fica de fora. As demais podem ser
      aplicadas agora; para incluir as rejeitadas, corrija o CSV de origem e envie de novo depois.
    </p>
  );

export const Previa = ({
  empresaId,
  previa,
  permissoes,
  paginaDasRejeicoes,
  aoIrParaRejeicoes,
  aoNovaImportacao,
  aoBaixarRelatorio,
  relatorio,
}: {
  empresaId: string;
  previa: PreviaDaImportacao;
  permissoes: PermissoesDoPlano;
  paginaDasRejeicoes: number;
  aoIrParaRejeicoes: (pagina: number) => void;
  aoNovaImportacao: () => void;
  aoBaixarRelatorio: (() => void) | null;
  relatorio: ReactNode;
}) => {
  const confirmar = useConfirmarImportacao(empresaId, previa.tentativaId, aoBaixarRelatorio);
  const cancelar = useCancelarImportacao(empresaId, previa.tentativaId);
  const conflito = confirmar.error instanceof ErroDaApi && confirmar.error.problema.code === 'CONFLITO_DE_VERSAO';
  const totais = previa.totais;

  const acoes = (): ReactNode => {
    if (!permissoes.confirmar) {
      return (
        <p className="max-w-prose text-body-sm text-muted-foreground">
          A confirmação ou o cancelamento desta prévia é feito por quem tem a permissão Confirmar importação.
        </p>
      );
    }

    if (conflito) {
      return (
        <PainelDeConflito
          nomeDoArquivo={previa.arquivo.nome}
          aoCancelar={() => cancelar.mutateAsync(undefined, { onSuccess: aoNovaImportacao })}
        />
      );
    }

    return (
      <div className="flex flex-col gap-sm tablet:flex-row tablet:items-center tablet:justify-end">
        <ConfirmacaoDeAcao
          gatilho={
            <Button variante="contorno" tamanho="compacto" disabled={confirmar.isPending}>
              <Ban aria-hidden="true" />
              Cancelar importação
            </Button>
          }
          titulo={`Cancelar a importação de ${previa.arquivo.nome}?`}
          descricao="Nenhuma conta é criada ou alterada. A tentativa, o arquivo e o relatório ficam no histórico como cancelados."
          rotuloDeConfirmacao="Cancelar importação"
          destrutivo
          explicarBloqueio={explicarRecusa}
          aoConfirmar={() => cancelar.mutateAsync()}
        />
        <ConfirmacaoDeAcao
          gatilho={
            <Button tamanho="compacto" disabled={confirmar.isPending || totais === null}>
              {confirmar.isPending ? (
                <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 aria-hidden="true" />
              )}
              Confirmar importação
            </Button>
          }
          titulo={`Confirmar a importação de ${previa.arquivo.nome}?`}
          descricao={totais === null ? '' : textoDaDecisao(totais)}
          rotuloDeConfirmacao="Confirmar importação"
          explicarBloqueio={explicarRecusa}
          aoConfirmar={() => confirmar.mutateAsync(previa.versaoDaPrevia ?? 0)}
        />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-lg">
      <ResumoDaTentativa previa={previa} />
      {totais === null ? null : <AvisoDaPrevia totais={totais} />}

      <TabelaDeRejeicoes
        empresaId={empresaId}
        previa={previa}
        pagina={paginaDasRejeicoes}
        aoIr={aoIrParaRejeicoes}
      />

      {confirmar.isPending ? (
        <p role="status" className="flex items-center gap-xs rounded-md bg-info px-md py-sm text-body-sm text-info-foreground">
          <LoaderCircle className="size-icon-sm motion-safe:animate-spin" aria-hidden="true" />
          Confirmação em andamento: aplicando as linhas válidas ao plano de contas.
        </p>
      ) : null}

      <div className="flex flex-col gap-md border-t border-border pt-md tablet:flex-row tablet:items-start tablet:justify-between">
        {relatorio}
        {acoes()}
      </div>
    </div>
  );
};
