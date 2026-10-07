/**
 * Painel operacional do Signer na empresa (SPEC-012 §5.3): estado atual de DF-e e eSocial, o botão
 * `Testar mTLS` quando autorizado, o resultado acionável do teste com o código de suporte e o
 * histórico paginado. Mora dentro do detalhe da empresa no cofre, que já identifica empresa e CNPJ e
 * traz o resumo do certificado só por metadados.
 *
 * O teste só dispara o diagnóstico do próprio Signer; nenhum conteúdo de operação passa por aqui.
 */
'use client';

import { Lock, LoaderCircle, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import type { ResultadoDoTesteManual } from '@contaia/shared';
import { CODIGOS_DE_ERRO } from '@contaia/domain';

import {
  APRESENTACAO_DA_FINALIDADE_NO_SIGNER,
  ROTULO_DA_FINALIDADE,
  mensagemDoSigner,
} from './apresentacao';
import { FinalidadeDoSigner } from './estado-na-linha';
import { HistoricoDoSigner } from './historico-do-signer';
import { useEstadoDaEmpresaNoSigner, useTestarMtls } from './queries';

const ID_DA_AJUDA = 'ajuda-do-teste-mtls';

const LinhaDoResultado = ({ resultado }: { resultado: ResultadoDoTesteManual }) => {
  const rotulo = ROTULO_DA_FINALIDADE[resultado.finalidade];

  return resultado.resultado === 'SUCESSO' ? (
    <p className="text-body-sm text-foreground">{rotulo}: teste concluído com sucesso.</p>
  ) : (
    <p className="text-body-sm text-foreground [overflow-wrap:anywhere]">
      <span className="font-semibold">{rotulo}: falhou.</span>{' '}
      {mensagemDoSigner(resultado.codigo ?? CODIGOS_DE_ERRO.SIGNER_INDISPONIVEL)}
    </p>
  );
};

/** O código de suporte (`correlationId`) de cada teste, uma vez só quando as finalidades o dividem. */
const ResultadoDoTeste = ({ resultados }: { resultados: readonly ResultadoDoTesteManual[] | undefined }) => {
  const codigos = [...new Set((resultados ?? []).map((resultado) => resultado.correlationId))];
  const falhou = (resultados ?? []).some((resultado) => resultado.resultado === 'FALHA');

  // A região viva fica SEMPRE montada: leitor de tela só anuncia mudança numa região que já existia.
  return (
    <div
      role="status"
      aria-label="Resultado do teste mTLS"
      className={
        resultados === undefined
          ? undefined
          : falhou
            ? 'flex flex-col gap-xs rounded-md border border-danger-indicator/40 bg-danger px-md py-sm'
            : 'flex flex-col gap-xs rounded-md border border-success-indicator/40 bg-success px-md py-sm'
      }
    >
      {(resultados ?? []).map((resultado) => (
        <LinhaDoResultado key={resultado.finalidade} resultado={resultado} />
      ))}
      {codigos.map((codigo) => (
        <p key={codigo} className="text-body-sm text-muted-foreground">
          Código de suporte: <span className="font-mono text-code-sm [overflow-wrap:anywhere]">{codigo}</span>
        </p>
      ))}
    </div>
  );
};

const EstadoDaEmpresa = ({ empresaId }: { empresaId: string }) => {
  const consulta = useEstadoDaEmpresaNoSigner(empresaId, true);
  const estado = consulta.data;

  if (estado === undefined) {
    if (consulta.isPending) {
      return (
        <div className="flex flex-col gap-sm" aria-busy="true">
          <span className="sr-only">Carregando o estado do Signer da empresa</span>
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      );
    }

    const problema = consulta.error instanceof ErroDaApi ? consulta.error.problema : null;

    if (problema?.code === 'SEM_AUTORIZACAO') {
      return (
        <EmptyState
          icone={<Lock />}
          titulo="Você não tem permissão para ver o Signer"
          descricao="O seu papel não inclui a consulta do estado do Signer. Se você precisa dela, peça a um administrador do escritório."
        />
      );
    }

    return (
      <ErroDeTela
        titulo="Não foi possível ler o estado do Signer da empresa"
        descricao={problema === null ? mensagemDoCodigo('FALHA_DE_REDE') : mensagemDoSigner(problema.code)}
        correlationId={problema?.correlationId}
        acao={
          <Button variante="contorno" tamanho="compacto" onClick={() => void consulta.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  const resumo = APRESENTACAO_DA_FINALIDADE_NO_SIGNER[estado.resumo];

  return (
    <div className="flex flex-col gap-sm">
      <div role="group" aria-label="Resumo do Signer mTLS" className="flex flex-wrap items-center gap-xs">
        <StatusBadge tom={resumo.tom} rotulo={resumo.rotulo} />
        {consulta.isError ? <span className="text-body-sm text-warning-foreground">Desatualizado</span> : null}
      </div>
      <ul className="flex flex-col gap-sm" aria-label="Finalidades do Signer mTLS">
        {estado.finalidades.map((finalidade) => (
          <FinalidadeDoSigner key={finalidade.finalidade} finalidade={finalidade} comMotivo />
        ))}
      </ul>
    </div>
  );
};

const TesteManual = ({
  empresaId,
  temCertificadoVigente,
}: {
  empresaId: string;
  temCertificadoVigente: boolean;
}) => {
  const teste = useTestarMtls(empresaId);

  return (
    <div className="flex flex-col gap-sm">
      <div className="flex flex-wrap items-center gap-md">
        <Button
          onClick={() => teste.mutate(undefined)}
          disabled={!temCertificadoVigente || teste.isPending}
          aria-busy={teste.isPending}
          aria-describedby={ID_DA_AJUDA}
        >
          {teste.isPending ? (
            <>
              <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
              Testando mTLS…
            </>
          ) : (
            <>
              <ShieldCheck aria-hidden="true" />
              Testar mTLS
            </>
          )}
        </Button>
        <p id={ID_DA_AJUDA} className="max-w-prose text-body-sm text-muted-foreground">
          {temCertificadoVigente
            ? 'Assina um documento de teste e abre uma conexão mTLS com os dublês de DF-e e eSocial. Nada é enviado a órgão real.'
            : 'A empresa não tem certificado A1 vigente. Cadastre um no cofre para poder testar.'}
        </p>
      </div>
      <ResultadoDoTeste resultados={teste.data} />
    </div>
  );
};

export const PainelDoSigner = ({
  empresaId,
  temCertificadoVigente,
  podeTestar,
}: {
  empresaId: string;
  temCertificadoVigente: boolean;
  podeTestar: boolean;
}) => (
  <section aria-labelledby="detalhe-signer" className="flex flex-col gap-lg">
    <h3 id="detalhe-signer" className="text-label-sm uppercase text-muted-foreground">
      Signer mTLS
    </h3>

    <EstadoDaEmpresa empresaId={empresaId} />

    {podeTestar ? (
      <TesteManual empresaId={empresaId} temCertificadoVigente={temCertificadoVigente} />
    ) : (
      <p className="rounded-md bg-muted px-md py-sm text-body-sm text-muted-foreground">
        Seu papel permite apenas consultar o Signer. O teste manual é com administradores e
        contadores da carteira.
      </p>
    )}

    <div className="flex flex-col gap-sm">
      <h4 className="text-label-sm uppercase text-muted-foreground">Histórico do Signer</h4>
      <HistoricoDoSigner empresaId={empresaId} />
    </div>
  </section>
);
