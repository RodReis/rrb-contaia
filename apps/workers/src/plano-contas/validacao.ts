/**
 * Validação assíncrona do plano de contas (SPEC-013 §3.2–§3.5, §3.10–§3.11, §6.4).
 *
 * Um job = uma tentativa. Três passos, e NENHUMA transação fica aberta durante I/O do storage nem
 * durante o parse:
 *
 *   1. transação curta (contexto técnico da empresa): RECEBIDA → VALIDANDO, lê a versão do plano,
 *      a chave do original, o mapeamento e as contas vigentes — versão e contas saem da MESMA
 *      transação, então a prévia nunca combina a versão de um momento com o plano de outro;
 *   2. sem transação: lê o original no storage, faz o parse e a validação integral (pura);
 *   3. transação curta: grava staging + versão + estado de uma vez (idempotente), o evento e, se o
 *      desfecho for terminal (REJEITADA), a notificação ao iniciador.
 *
 * Reentrega: tentativa já além de VALIDANDO → `ESTADO_INVALIDO_PARA_ACAO` → ack sem efeito; ainda
 * em VALIDANDO (queda no meio) → refaz e o staging não duplica. Falha transitória relança (o BullMQ
 * repete com backoff); definitiva vira `UnrecoverableError(<código estável>)`. Esgotadas as
 * tentativas, `registrarFalhaDaValidacao` leva a tentativa a FALHA (ver o consumidor).
 */
import {
  buscarTentativaDeImportacao,
  carregarContasVigentes,
  comContexto,
  criarNotificacaoDeImportacao,
  gravarResultadoDaValidacao,
  iniciarValidacaoDaImportacao,
  registrarEventoDeImportacao,
  registrarFalhaDaImportacao,
  type MapeamentoDaImportacao,
  type TotaisDaPrevia,
} from '@contaia/db';
import { CODIGOS_DE_ERRO, ErroDeDominio, contextoTecnico, type ContaVigente } from '@contaia/domain';
import { ComandoValidarImportacaoSchema, type ComandoValidarImportacao } from '@contaia/shared';
import { UnrecoverableError } from 'bullmq';
import type { Pool, PoolClient } from 'pg';

import { analisarArquivo, type CodigoDeArquivoRecusado } from './analise.js';
import { ErroDoArmazenamento } from './leitura-s3.js';

/** Identidade técnica do worker nas transações por empresa (classe `empresa` da RLS). */
export const IDENTIDADE_DO_WORKER_DO_PLANO = 'workers-plano-contas';

/** Códigos estáveis de falha técnica (evento `FALHA_TECNICA` e fila morta). Nunca mensagem crua. */
export const CODIGOS_DA_FALHA_DA_VALIDACAO = {
  PAYLOAD_INVALIDO: 'PAYLOAD_INVALIDO',
  TENTATIVA_NAO_ENCONTRADA: 'TENTATIVA_NAO_ENCONTRADA',
  ORIGINAL_NAO_ENCONTRADO: 'ORIGINAL_NAO_ENCONTRADO',
  ARMAZENAMENTO_INDISPONIVEL: 'ARMAZENAMENTO_INDISPONIVEL',
  FALHA_NA_VALIDACAO: 'FALHA_NA_VALIDACAO',
} as const;
export type CodigoDaFalhaDaValidacao = (typeof CODIGOS_DA_FALHA_DA_VALIDACAO)[keyof typeof CODIGOS_DA_FALHA_DA_VALIDACAO];

const CODIGOS_CONHECIDOS: readonly string[] = Object.values(CODIGOS_DA_FALHA_DA_VALIDACAO);

/** Sem tentativa identificável (ou de outro tenant/empresa): não há o que marcar como FALHA. */
const SEM_TENTATIVA: readonly CodigoDaFalhaDaValidacao[] = ['PAYLOAD_INVALIDO', 'TENTATIVA_NAO_ENCONTRADA'];

export type DependenciasDaValidacao = Readonly<{
  pool: Pool;
  /** Lê o original pela chave; falha com `ErroDoArmazenamento` (código estável). */
  ler: (chave: string) => Promise<Buffer>;
  agora: () => Date;
}>;

export type ResultadoDaValidacaoDoJob =
  | Readonly<{ desfecho: 'AGUARDANDO_CONFIRMACAO' | 'REJEITADA'; totais: TotaisDaPrevia }>
  /** Reentrega de tentativa já validada (ou encerrada): ack, sem efeito. */
  | Readonly<{ desfecho: 'JA_PROCESSADA' }>;

type Inicio = Readonly<{
  planoVersaoNaValidacao: number;
  arquivoChave: string;
  mapeamento: MapeamentoDaImportacao;
  contasVigentes: readonly ContaVigente[];
}>;

const validarComando = (dados: unknown): ComandoValidarImportacao => {
  const validado = ComandoValidarImportacaoSchema.safeParse(dados);

  if (!validado.success) {
    // Payload fora do contrato: repetir não conserta.
    throw new UnrecoverableError(CODIGOS_DA_FALHA_DA_VALIDACAO.PAYLOAD_INVALIDO);
  }

  return validado.data;
};

const naEmpresa = <T>(pool: Pool, comando: ComandoValidarImportacao, executar: (c: PoolClient) => Promise<T>): Promise<T> =>
  comContexto(
    pool,
    contextoTecnico({
      identidadeTecnica: IDENTIDADE_DO_WORKER_DO_PLANO,
      finalidade: 'PROCESSAMENTO_DE_EMPRESA',
      tenantId: comando.tenantId,
      empresaId: comando.empresaId,
      correlationId: comando.correlationId,
    }),
    executar,
  );

const ehErroDeDominio = (erro: unknown, codigo: string): boolean => erro instanceof ErroDeDominio && erro.codigo === codigo;

const naoEncontrada = (): UnrecoverableError => new UnrecoverableError(CODIGOS_DA_FALHA_DA_VALIDACAO.TENTATIVA_NAO_ENCONTRADA);

/** Passo 1: início, versão do plano e contas vigentes numa transação só. `null` = já processada. */
const iniciar = async (deps: DependenciasDaValidacao, comando: ComandoValidarImportacao): Promise<Inicio | null> => {
  const { empresaId, tentativaId, correlationId } = comando;

  try {
    return await naEmpresa(deps.pool, comando, async (c) => {
      const agora = deps.agora();
      const inicio = await iniciarValidacaoDaImportacao(c, empresaId, tentativaId, agora);

      if (inicio.transicionou) {
        await registrarEventoDeImportacao(c, {
          empresaId, tentativaId, acao: 'INICIAR_VALIDACAO', estadoAnterior: 'RECEBIDA', estadoNovo: 'VALIDANDO',
          usuarioId: null, totais: null, codigo: null, correlationId, agora,
        });
      }

      const tentativa = await buscarTentativaDeImportacao(c, empresaId, tentativaId);
      if (tentativa === null) {
        throw naoEncontrada();
      }

      return {
        planoVersaoNaValidacao: inicio.planoVersaoNaValidacao,
        arquivoChave: tentativa.arquivoChave,
        mapeamento: tentativa.mapeamento,
        contasVigentes: await carregarContasVigentes(c, empresaId),
      };
    });
  } catch (erro) {
    if (ehErroDeDominio(erro, CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO)) {
      return null;
    }
    if (ehErroDeDominio(erro, CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA)) {
      // Outro tenant, outra empresa ou id inexistente: nada é lido nem revelado.
      throw naoEncontrada();
    }

    throw erro;
  }
};

/** Passo 2 (sem transação): o original do storage. Objeto ausente é definitivo. */
const lerOriginal = async (deps: DependenciasDaValidacao, chave: string): Promise<Buffer> => {
  try {
    return await deps.ler(chave);
  } catch (erro) {
    if (erro instanceof ErroDoArmazenamento && erro.codigo === 'ORIGINAL_NAO_ENCONTRADO') {
      throw new UnrecoverableError(CODIGOS_DA_FALHA_DA_VALIDACAO.ORIGINAL_NAO_ENCONTRADO);
    }

    throw erro;
  }
};

/** Passo 3: staging + versão + estado, evento e (se REJEITADA) a notificação, juntos. */
const gravar = async (
  deps: DependenciasDaValidacao,
  comando: ComandoValidarImportacao,
  inicio: Inicio,
  analise: ReturnType<typeof analisarArquivo>,
): Promise<ResultadoDaValidacaoDoJob> => {
  const { empresaId, tentativaId, correlationId } = comando;
  const linhas = analise.tipo === 'LINHAS' ? analise.linhas : [];
  const codigo: CodigoDeArquivoRecusado | null = analise.tipo === 'ARQUIVO_RECUSADO' ? analise.codigo : null;

  try {
    return await naEmpresa(deps.pool, comando, async (c) => {
      const agora = deps.agora();
      const gravado = await gravarResultadoDaValidacao(c, empresaId, tentativaId, linhas, inicio.planoVersaoNaValidacao, agora);

      if (!gravado.transicionou) {
        return { desfecho: 'JA_PROCESSADA' } as const;
      }

      const sucesso = gravado.estado === 'AGUARDANDO_CONFIRMACAO';
      await registrarEventoDeImportacao(c, {
        empresaId, tentativaId, acao: sucesso ? 'VALIDACAO_SUCESSO' : 'VALIDACAO_REJEITADA',
        estadoAnterior: 'VALIDANDO', estadoNovo: gravado.estado, usuarioId: null, totais: gravado.totais, codigo, correlationId, agora,
      });

      if (!sucesso) {
        // Desfecho terminal produzido pelo worker: só o iniciador é avisado. A prévia não notifica.
        await criarNotificacaoDeImportacao(c, { empresaId, tentativaId, agora });
      }

      return { desfecho: sucesso ? 'AGUARDANDO_CONFIRMACAO' : 'REJEITADA', totais: gravado.totais } as const;
    });
  } catch (erro) {
    // A tentativa saiu de VALIDANDO por outro caminho (ex.: FALHA registrada): nada a gravar.
    if (ehErroDeDominio(erro, CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO)) {
      return { desfecho: 'JA_PROCESSADA' };
    }

    throw erro;
  }
};

export const processarValidacao = async (deps: DependenciasDaValidacao, dados: unknown): Promise<ResultadoDaValidacaoDoJob> => {
  const comando = validarComando(dados);
  const inicio = await iniciar(deps, comando);

  if (inicio === null) {
    return { desfecho: 'JA_PROCESSADA' };
  }

  const bytes = await lerOriginal(deps, inicio.arquivoChave);
  const analise = analisarArquivo(bytes, inicio.mapeamento, inicio.contasVigentes);

  return gravar(deps, comando, inicio, analise);
};

/** Código estável da falha, para o evento e a fila morta. A mensagem crua nunca sai daqui. */
export const motivoDaFalhaDaValidacao = (erro: Error): CodigoDaFalhaDaValidacao => {
  if (erro instanceof UnrecoverableError && CODIGOS_CONHECIDOS.includes(erro.message)) {
    return erro.message as CodigoDaFalhaDaValidacao;
  }
  if (erro instanceof ErroDoArmazenamento) {
    return erro.codigo;
  }

  return CODIGOS_DA_FALHA_DA_VALIDACAO.FALHA_NA_VALIDACAO;
};

/** Há uma tentativa da empresa a encerrar em FALHA para este motivo? */
export const motivoEncerraEmFalha = (motivo: CodigoDaFalhaDaValidacao): boolean => !SEM_TENTATIVA.includes(motivo);

/**
 * Tentativas esgotadas (ou falha definitiva): VALIDANDO → FALHA, evento `FALHA_TECNICA` com o
 * código estável e notificação ao iniciador, numa transação. Só age sobre tentativa ainda em
 * VALIDANDO: validada, encerrada ou parada em RECEBIDA (o domínio não leva RECEBIDA a FALHA; o
 * reenvio do arquivo reenfileira) → `false`, sem efeito. Repetir é seguro: a segunda chamada
 * encontra FALHA e não grava outro evento nem outra notificação.
 */
export const registrarFalhaDaValidacao = async (
  deps: Pick<DependenciasDaValidacao, 'pool' | 'agora'>,
  dados: unknown,
  codigo: CodigoDaFalhaDaValidacao,
): Promise<boolean> => {
  const validado = ComandoValidarImportacaoSchema.safeParse(dados);

  if (!validado.success || !motivoEncerraEmFalha(codigo)) {
    return false;
  }

  const comando = validado.data;
  const { empresaId, tentativaId, correlationId } = comando;

  try {
    return await naEmpresa(deps.pool, comando, async (c) => {
      const atual = await buscarTentativaDeImportacao(c, empresaId, tentativaId);
      if (atual?.estado !== 'VALIDANDO') {
        return false;
      }

      const agora = deps.agora();
      const anterior = await registrarFalhaDaImportacao(c, empresaId, tentativaId, agora);
      await registrarEventoDeImportacao(c, {
        empresaId, tentativaId, acao: 'FALHA_TECNICA', estadoAnterior: anterior, estadoNovo: 'FALHA',
        usuarioId: null, totais: null, codigo, correlationId, agora,
      });
      await criarNotificacaoDeImportacao(c, { empresaId, tentativaId, agora });

      return true;
    });
  } catch (erro) {
    if (ehErroDeDominio(erro, CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO) || ehErroDeDominio(erro, CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA)) {
      return false;
    }

    throw erro;
  }
};
