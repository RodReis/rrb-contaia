/**
 * Prévia em `AGUARDANDO_CONFIRMACAO` (SPEC-013/014 §3.5, §3.6, §3.8): nada mudou na base ainda. A
 * pessoa vê os totais e as rejeições e decide — `Confirmar importação` aplica só as linhas válidas
 * numa transação; `Cancelar importação` encerra a tentativa sem tocar na base. As duas passam por
 * `AlertDialog` com os números da decisão.
 *
 * Conflito de versão (a base mudou depois da validação, HTTP 409): nada foi aplicado e a prévia
 * ficou obsoleta. A saída é cancelar e enviar o arquivo de novo; a tela não promete revalidar esta
 * mesma tentativa, porque o servidor não faz isso.
 */
'use client';

import { Ban, CheckCircle2, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmacaoDeAcao } from '@/components/ui/confirmacao-de-acao';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { plural } from './apresentacao';
import type { DominioDaImportacao, PermissoesDaImportacao, PreviaBase, Totais } from './dominio';
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

/**
 * O conflito chega com o diálogo de confirmação aberto; ele some junto com o botão e o foco vem
 * para cá, onde está a explicação e a única saída possível.
 */
const PainelDeConflito = ({
  dominio,
  nomeDoArquivo,
  aoCancelar,
}: {
  dominio: DominioDaImportacao;
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
        {dominio.textos.conflito.titulo}
      </p>
      <p className="max-w-prose text-body-sm text-danger-foreground">{dominio.textos.conflito.descricao}</p>
      <div>
        <ConfirmacaoDeAcao
          gatilho={
            <Button variante="contorno" tamanho="compacto">
              <RefreshCw aria-hidden="true" />
              Cancelar e validar novamente
            </Button>
          }
          titulo="Cancelar esta prévia?"
          descricao={dominio.textos.conflito.cancelar(nomeDoArquivo)}
          rotuloDeConfirmacao="Cancelar prévia"
          rotuloDeRecusa="Manter prévia"
          destrutivo
          aoConfirmar={aoCancelar}
        />
      </div>
    </div>
  );
};

const AvisoDaPrevia = ({ totais }: { totais: Totais }) =>
  totais.rejeitadas === 0 ? (
    <p className="flex items-start gap-xs rounded-md bg-success px-md py-sm text-body-sm text-success-foreground">
      <CheckCircle2 className="mt-xs size-icon-xs shrink-0" aria-hidden="true" />
      {totais.lidas === 1 ? 'A única linha lida é válida.' : `Todas as ${plural(totais.lidas, 'linha lida é válida', 'linhas lidas são válidas')}.`}{' '}
      Nada foi aplicado ainda: revise e confirme.
    </p>
  ) : (
    <p className="flex items-start gap-xs rounded-md bg-warning px-md py-sm text-body-sm text-warning-foreground">
      <TriangleAlert className="mt-xs size-icon-xs shrink-0" aria-hidden="true" />
      {plural(totais.rejeitadas, 'linha foi rejeitada', 'linhas foram rejeitadas')} e fica de fora. As demais podem ser
      aplicadas agora; para incluir as rejeitadas, corrija o CSV de origem e envie de novo depois.
    </p>
  );

export const Previa = ({
  dominio,
  empresaId,
  previa,
  permissoes,
  paginaDasRejeicoes,
  aoIrParaRejeicoes,
  aoNovaImportacao,
  aoBaixarRelatorio,
  relatorio,
}: {
  dominio: DominioDaImportacao;
  empresaId: string;
  previa: PreviaBase;
  permissoes: PermissoesDaImportacao;
  paginaDasRejeicoes: number;
  aoIrParaRejeicoes: (pagina: number) => void;
  aoNovaImportacao: () => void;
  aoBaixarRelatorio: (() => void) | null;
  relatorio: ReactNode;
}) => {
  const confirmar = useConfirmarImportacao(dominio, empresaId, previa.tentativaId, aoBaixarRelatorio);
  const cancelar = useCancelarImportacao(dominio, empresaId, previa.tentativaId);
  const conflito = confirmar.error instanceof ErroDaApi && confirmar.error.problema.code === 'CONFLITO_DE_VERSAO';
  const totais = previa.totais;

  const acoes = (): ReactNode => {
    if (!permissoes.confirmar) {
      return (
        <p className="max-w-prose text-body-sm text-muted-foreground">{dominio.textos.confirmacaoNegada}</p>
      );
    }

    // A permissão diz quem pode; as flags da API dizem se esta prévia ainda aceita a ação. Sem a
    // versão validada não há o que confirmar: a tela não inventa uma.
    const versaoDaPrevia = previa.versaoDaPrevia;
    const podeConfirmar = previa.podeConfirmar && versaoDaPrevia !== null && totais !== null;

    if (conflito && previa.podeCancelar) {
      return (
        <PainelDeConflito
          dominio={dominio}
          nomeDoArquivo={previa.arquivo.nome}
          aoCancelar={() => cancelar.mutateAsync(undefined, { onSuccess: aoNovaImportacao })}
        />
      );
    }

    if (!podeConfirmar && !previa.podeCancelar) {
      return (
        <p className="max-w-prose text-body-sm text-muted-foreground">
          Esta prévia não aceita mais confirmação nem cancelamento. Feche a tentativa e abra-a de novo pelo histórico para
          ver a situação atual.
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-sm tablet:flex-row tablet:items-center tablet:justify-end">
        {previa.podeCancelar ? (
          <ConfirmacaoDeAcao
            gatilho={
              <Button variante="contorno" tamanho="compacto" disabled={confirmar.isPending}>
                <Ban aria-hidden="true" />
                Cancelar importação
              </Button>
            }
            titulo={`Cancelar a importação de ${previa.arquivo.nome}?`}
            descricao={dominio.textos.descricaoDoCancelamento}
            rotuloDeConfirmacao="Cancelar importação"
            rotuloDeRecusa="Manter prévia"
            destrutivo
            explicarBloqueio={explicarRecusa}
            aoConfirmar={() => cancelar.mutateAsync()}
          />
        ) : null}
        {podeConfirmar ? (
          <ConfirmacaoDeAcao
            gatilho={
              <Button tamanho="compacto" disabled={confirmar.isPending}>
                {confirmar.isPending ? (
                  <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 aria-hidden="true" />
                )}
                Confirmar importação
              </Button>
            }
            titulo={dominio.textos.tituloDaConfirmacao(previa.arquivo.nome)}
            descricao={dominio.textos.decisao(totais)}
            rotuloDeConfirmacao="Confirmar importação"
            explicarBloqueio={explicarRecusa}
            aoConfirmar={() => confirmar.mutateAsync(versaoDaPrevia)}
          />
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-lg">
      <ResumoDaTentativa dominio={dominio} previa={previa} />
      {totais === null ? null : <AvisoDaPrevia totais={totais} />}

      <TabelaDeRejeicoes
        dominio={dominio}
        empresaId={empresaId}
        previa={previa}
        pagina={paginaDasRejeicoes}
        aoIr={aoIrParaRejeicoes}
      />

      {confirmar.isPending ? (
        <p role="status" className="flex items-center gap-xs rounded-md bg-info px-md py-sm text-body-sm text-info-foreground">
          <LoaderCircle className="size-icon-sm motion-safe:animate-spin" aria-hidden="true" />
          {dominio.textos.confirmando}
        </p>
      ) : null}

      <div className="flex flex-col gap-md border-t border-border pt-md tablet:flex-row tablet:items-start tablet:justify-between">
        {relatorio}
        {acoes()}
      </div>
    </div>
  );
};
