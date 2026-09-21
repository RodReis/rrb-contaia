/**
 * Aba Documentos da empresa (SPEC-004 §2 e §4).
 *
 * Uma linha por exigência, com o estado como leitura primária e as ações
 * disponíveis naquele estado — e só elas. O que a spec chama de "análise
 * explícita" aparece aqui como decisão separada do envio: quem sobe o arquivo
 * não o aprova no mesmo gesto, nem sendo o administrador.
 *
 * Versões anteriores ficam num detalhe recolhido, somente leitura: elas não
 * podem ser excluídas pela interface (§3.2), então não há ação de exclusão
 * para esconder nem para desabilitar.
 */
'use client';

import type { EstadoDoDocumento } from '@contaia/domain';
import {
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  FilePlus2,
  FileText,
  History,
  MinusCircle,
  Upload,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { AreaDeTexto } from '@/components/ui/area-de-texto';
import { Campo } from '@/components/ui/campo';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { cn } from '@/lib/cn';
import { DialogoDeJustificativa } from './dialogo-de-justificativa';
import { enderecoDoConteudo, type ExigenciaDocumental } from './documentos-api';
import {
  useAprovarDocumento,
  useCriarExigencia,
  useDispensarExigencia,
  useDocumentos,
  useEnviarArquivo,
  useRejeitarDocumento,
} from './documentos-queries';
import { EnvioDeDocumento } from './envio-de-documento';
import { APARENCIA_DO_ESTADO } from './estado-do-documento';
import { HistoricoDocumental } from './historico-documental';

const formatarData = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

const formatarDataCivil = (data: string): string => {
  const [ano, mes, dia] = data.split('-');

  return ano === undefined || mes === undefined || dia === undefined
    ? data
    : `${dia}/${mes}/${ano}`;
};

const formatarTamanho = (bytes: number): string => {
  const mega = bytes / (1024 * 1024);

  return mega >= 1
    ? `${mega.toFixed(1).replace('.', ',')} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

/** Ações possíveis por estado (§2.4). Fonte única, para tela e teste. */
const PODE_ENVIAR: Readonly<Record<EstadoDoDocumento, boolean>> = {
  PENDENTE: true,
  ENVIADO: true,
  APROVADO: true,
  REJEITADO: true,
  VENCIDO: true,
  // Dispensada não recebe arquivo: a dispensa precisa ser revertida antes.
  DISPENSADO: false,
};

const LinhaDaExigencia = ({
  empresaId,
  exigencia,
  somenteLeitura,
}: {
  empresaId: string;
  exigencia: ExigenciaDocumental;
  somenteLeitura: boolean;
}) => {
  const [versoesAbertas, definirVersoesAbertas] = useState(false);

  const enviar = useEnviarArquivo(empresaId, exigencia.id);
  const aprovar = useAprovarDocumento(empresaId, exigencia.id);
  const rejeitar = useRejeitarDocumento(empresaId, exigencia.id);
  const dispensar = useDispensarExigencia(empresaId, exigencia.id);

  const aparencia = APARENCIA_DO_ESTADO[exigencia.estado];
  const vigente = exigencia.versoes.find((versao) => versao.vigente) ?? null;
  const anteriores = exigencia.versoes.filter((versao) => !versao.vigente);
  const aguardandoAnalise = exigencia.estado === 'ENVIADO';
  const ocupado =
    enviar.isPending || aprovar.isPending || rejeitar.isPending || dispensar.isPending;

  return (
    <li
      className={cn(
        'flex flex-col gap-md rounded-lg border bg-card p-lg',
        // Tingimento sutil reforça o badge, nunca o substitui (COMPONENTS.md §3.1).
        exigencia.estado === 'REJEITADO'
          ? 'border-danger-indicator/40'
          : exigencia.estado === 'VENCIDO'
            ? 'border-warning-indicator/40'
            : 'border-border',
        !exigencia.aplicavel && 'opacity-70',
      )}
    >
      <div className="flex flex-col gap-sm tablet:flex-row tablet:items-start tablet:justify-between">
        <div className="flex flex-col gap-xs">
          <div className="flex flex-wrap items-center gap-sm">
            <h3 className="text-title-sm text-foreground">{exigencia.nome}</h3>
            <StatusBadge tom={aparencia.tom} rotulo={aparencia.rotulo} />
            {exigencia.aplicavel ? null : (
              <StatusBadge tom="neutro" rotulo="Não se aplica" />
            )}
          </div>

          {exigencia.descricao === null ? null : (
            <p className="text-body-sm text-muted-foreground">{exigencia.descricao}</p>
          )}

          {exigencia.dataLimite === null ? null : (
            <p className="text-body-sm text-muted-foreground">
              Prazo de entrega: {formatarDataCivil(exigencia.dataLimite)}
            </p>
          )}

          {vigente === null ? (
            <p className="text-body-sm text-muted-foreground">Nenhum arquivo enviado.</p>
          ) : (
            <p className="flex flex-wrap items-center gap-xs text-body-sm text-muted-foreground">
              <FileText className="size-icon-sm shrink-0" aria-hidden="true" />
              <span className="text-foreground">{vigente.nomeOriginal}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-code-sm tabular-nums">
                {formatarTamanho(vigente.tamanhoBytes)}
              </span>
              <span aria-hidden="true">·</span>
              <span>versão {vigente.numero}</span>
              {vigente.validade === null ? null : (
                <>
                  <span aria-hidden="true">·</span>
                  <span>validade {formatarDataCivil(vigente.validade)}</span>
                </>
              )}
            </p>
          )}

          {/*
            Justificativa de rejeição e de dispensa é a informação que a pessoa
            precisa para agir: fica na linha, não escondida no histórico.
          */}
          {exigencia.justificativa === null ? null : (
            <p className="rounded-md bg-muted px-md py-sm text-body-sm text-muted-foreground">
              <span className="text-foreground">Justificativa:</span>{' '}
              {exigencia.justificativa}
            </p>
          )}

          {aguardandoAnalise ? (
            <p className="text-body-sm text-muted-foreground">
              Este arquivo ainda depende de análise para valer.
            </p>
          ) : null}
        </div>

        {somenteLeitura ? null : (
          <div className="flex flex-wrap gap-sm tablet:justify-end">
            {PODE_ENVIAR[exigencia.estado] ? (
              <EnvioDeDocumento
                gatilho={
                  <Button variante={vigente === null ? 'primaria' : 'contorno'} tamanho="compacto">
                    <Upload aria-hidden="true" />
                    {vigente === null ? 'Enviar arquivo' : 'Substituir'}
                  </Button>
                }
                titulo={`${vigente === null ? 'Enviar' : 'Substituir'} — ${exigencia.nome}`}
                descricao="PDF, JPG ou PNG de até 20 MB."
                substituicao={vigente !== null}
                ocupado={enviar.isPending}
                aoEnviar={(entrada) =>
                  enviar.mutateAsync({ ...entrada, versao: exigencia.versao })
                }
              />
            ) : null}

            {aguardandoAnalise ? (
              <>
                <Button
                  tamanho="compacto"
                  disabled={ocupado}
                  onClick={() => void aprovar.mutateAsync(exigencia.versao)}
                >
                  <CheckCircle2 aria-hidden="true" />
                  Aprovar
                </Button>

                <DialogoDeJustificativa
                  gatilho={
                    <Button variante="contorno" tamanho="compacto" disabled={ocupado}>
                      <XCircle aria-hidden="true" />
                      Rejeitar
                    </Button>
                  }
                  titulo={`Rejeitar ${exigencia.nome}?`}
                  descricao="A exigência segue pendente até uma nova versão ser aprovada. A justificativa fica registrada com autor e data."
                  rotuloDeConfirmacao="Rejeitar documento"
                  destrutivo
                  ocupado={rejeitar.isPending}
                  aoConfirmar={(justificativa) =>
                    rejeitar.mutateAsync({ justificativa, versao: exigencia.versao })
                  }
                />
              </>
            ) : null}

            {exigencia.estado === 'DISPENSADO' ? null : (
              <DialogoDeJustificativa
                gatilho={
                  <Button variante="fantasma" tamanho="compacto" disabled={ocupado}>
                    <MinusCircle aria-hidden="true" />
                    Dispensar
                  </Button>
                }
                titulo={`Dispensar ${exigencia.nome}?`}
                descricao="A exigência deixa de ser cobrada desta empresa. Os arquivos já enviados continuam preservados, e a dispensa fica registrada com autor, data e justificativa."
                rotuloDeConfirmacao="Dispensar exigência"
                ocupado={dispensar.isPending}
                aoConfirmar={(justificativa) =>
                  dispensar.mutateAsync({ justificativa, versao: exigencia.versao })
                }
              />
            )}
          </div>
        )}
      </div>

      {exigencia.versoes.length === 0 ? null : (
        <div className="flex flex-col gap-sm border-t border-border pt-md">
          <div className="flex flex-wrap gap-sm">
            {vigente === null ? null : (
              <>
                <Button variante="contorno" tamanho="compacto" asChild>
                  <a
                    href={enderecoDoConteudo(empresaId, exigencia.id, vigente.id, 'conteudo')}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Eye aria-hidden="true" />
                    Visualizar
                  </a>
                </Button>

                <Button variante="fantasma" tamanho="compacto" asChild>
                  <a
                    href={enderecoDoConteudo(empresaId, exigencia.id, vigente.id, 'download')}
                    download={vigente.nomeOriginal}
                  >
                    <Download aria-hidden="true" />
                    Baixar
                  </a>
                </Button>
              </>
            )}

            {anteriores.length === 0 ? null : (
              <Button
                variante="fantasma"
                tamanho="compacto"
                aria-expanded={versoesAbertas}
                onClick={() => definirVersoesAbertas((aberto) => !aberto)}
              >
                <ChevronDown
                  className={cn(
                    'transition-transform duration-fast ease-out',
                    versoesAbertas && 'rotate-180',
                  )}
                  aria-hidden="true"
                />
                {anteriores.length === 1
                  ? '1 versão anterior'
                  : `${anteriores.length} versões anteriores`}
              </Button>
            )}
          </div>

          {versoesAbertas && anteriores.length > 0 ? (
            <ul className="flex flex-col gap-xs">
              {anteriores.map((versao) => (
                <li
                  key={versao.id}
                  className="flex flex-wrap items-center justify-between gap-sm rounded-md bg-muted px-md py-sm"
                >
                  <span className="flex flex-wrap items-center gap-xs text-body-sm text-muted-foreground">
                    <span className="font-mono text-code-sm tabular-nums">
                      v{versao.numero}
                    </span>
                    <span className="text-foreground">{versao.nomeOriginal}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatarData(versao.criadoEm)}</span>
                  </span>

                  <span className="flex gap-xs">
                    <Button variante="fantasma" tamanho="compacto" asChild>
                      <a
                        href={enderecoDoConteudo(empresaId, exigencia.id, versao.id, 'conteudo')}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Visualizar versão ${versao.numero} de ${exigencia.nome}`}
                      >
                        <Eye aria-hidden="true" />
                      </a>
                    </Button>

                    <Button variante="fantasma" tamanho="compacto" asChild>
                      <a
                        href={enderecoDoConteudo(empresaId, exigencia.id, versao.id, 'download')}
                        download={versao.nomeOriginal}
                        aria-label={`Baixar versão ${versao.numero} de ${exigencia.nome}`}
                      >
                        <Download aria-hidden="true" />
                      </a>
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </li>
  );
};

const NovaExigencia = ({ empresaId }: { empresaId: string }) => {
  const [aberto, definirAberto] = useState(false);
  const [nome, definirNome] = useState('');
  const [descricao, definirDescricao] = useState('');
  const [dataLimite, definirDataLimite] = useState('');
  const [erro, definirErro] = useState<string | undefined>(undefined);

  const criar = useCriarExigencia(empresaId);

  const alternar = (): void => {
    const proximo = !aberto;
    definirAberto(proximo);

    if (proximo) {
      definirNome('');
      definirDescricao('');
      definirDataLimite('');
      definirErro(undefined);
    }
  };

  const salvar = async (): Promise<void> => {
    if (nome.trim().length === 0) {
      definirErro('Informe o nome da exigência.');
      return;
    }

    try {
      await criar.mutateAsync({
        nome: nome.trim(),
        descricao: descricao.trim().length > 0 ? descricao.trim() : null,
        dataLimite: dataLimite.length > 0 ? dataLimite : null,
      });
      definirAberto(false);
    } catch {
      // Falha já virou toast na camada de dados; o formulário permanece aberto.
    }
  };

  if (!aberto) {
    return (
      <Button variante="contorno" tamanho="compacto" onClick={alternar}>
        <FilePlus2 aria-hidden="true" />
        Nova exigência
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-md rounded-lg border border-border bg-card p-lg">
      <h3 className="text-title-sm text-foreground">Nova exigência desta empresa</h3>

      <div className="grid gap-md tablet:grid-cols-2">
        <Campo
          rotulo="Nome"
          obrigatorio
          value={nome}
          onValorChange={(valor) => {
            definirNome(valor);
            definirErro(undefined);
          }}
          erro={erro}
          maxLength={120}
        />

        <Campo
          rotulo="Data-limite"
          type="date"
          value={dataLimite}
          onValorChange={definirDataLimite}
          ajuda="Opcional. Prazo para a empresa entregar."
        />
      </div>

      <AreaDeTexto
        rotulo="Descrição"
        value={descricao}
        onValorChange={definirDescricao}
        maxLength={500}
        ajuda="Opcional. Explique o que a empresa precisa enviar."
      />

      <div className="flex flex-wrap justify-end gap-sm">
        <Button variante="fantasma" tamanho="compacto" onClick={alternar}>
          Cancelar
        </Button>
        <Button tamanho="compacto" disabled={criar.isPending} onClick={() => void salvar()}>
          {criar.isPending ? 'Incluindo…' : 'Incluir exigência'}
        </Button>
      </div>
    </div>
  );
};

export const AbaDeDocumentos = ({
  empresaId,
  somenteLeitura,
}: {
  empresaId: string;
  somenteLeitura: boolean;
}) => {
  const [historicoAberto, definirHistoricoAberto] = useState(false);
  const { data, isPending, isError, error, refetch } = useDocumentos(empresaId);

  if (isPending) {
    return (
      <div className="flex flex-col gap-md" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando os documentos da empresa</span>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (isError) {
    const problema = error instanceof ErroDaApi ? error.problema : null;

    return (
      <ErroDeTela
        titulo="Não foi possível carregar os documentos"
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
    );
  }

  const aplicaveis = data.exigencias.filter((exigencia) => exigencia.aplicavel);
  const inaplicaveis = data.exigencias.filter((exigencia) => !exigencia.aplicavel);
  const pendentes = aplicaveis.filter(
    (exigencia) => exigencia.estado !== 'APROVADO' && exigencia.estado !== 'DISPENSADO',
  ).length;

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-col gap-sm tablet:flex-row tablet:items-center tablet:justify-between">
        <p className="text-body-sm text-muted-foreground">
          {aplicaveis.length === 0
            ? 'Nenhuma exigência aplicável a esta empresa.'
            : pendentes === 0
              ? `${aplicaveis.length} exigências em dia.`
              : `${pendentes} de ${aplicaveis.length} exigências aguardam providência.`}
        </p>

        <div className="flex flex-wrap gap-sm">
          <Button
            variante="fantasma"
            tamanho="compacto"
            aria-expanded={historicoAberto}
            onClick={() => definirHistoricoAberto((aberto) => !aberto)}
          >
            <History aria-hidden="true" />
            {historicoAberto ? 'Ocultar histórico' : 'Histórico documental'}
          </Button>

          {somenteLeitura ? null : <NovaExigencia empresaId={empresaId} />}
        </div>
      </div>

      {historicoAberto ? <HistoricoDocumental empresaId={empresaId} /> : null}

      {data.exigencias.length === 0 ? (
        <EmptyState
          icone={<FileText />}
          titulo="Nenhuma exigência documental"
          descricao="Esta empresa ainda não tem exigências cadastradas. Inclua uma exigência específica para começar a cobrar documentos."
          acao={somenteLeitura ? undefined : <NovaExigencia empresaId={empresaId} />}
        />
      ) : (
        <ul className="flex flex-col gap-md">
          {aplicaveis.map((exigencia) => (
            <LinhaDaExigencia
              key={exigencia.id}
              empresaId={empresaId}
              exigencia={exigencia}
              somenteLeitura={somenteLeitura}
            />
          ))}
        </ul>
      )}

      {inaplicaveis.length === 0 ? null : (
        <section className="flex flex-col gap-md">
          <h3 className="text-title-sm text-muted-foreground">Não se aplicam a esta empresa</h3>
          <p className="text-body-sm text-muted-foreground">
            Estas exigências saíram do checklist por causa do cadastro atual. Os arquivos já
            enviados continuam preservados.
          </p>

          <ul className="flex flex-col gap-md">
            {inaplicaveis.map((exigencia) => (
              <LinhaDaExigencia
                key={exigencia.id}
                empresaId={empresaId}
                exigencia={exigencia}
                somenteLeitura
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
