/**
 * Validação assíncrona de empregados (SPEC-014 §3.2–§3.5, §3.10–§3.11, §6.4).
 *
 * Um job = uma tentativa. Três passos, e NENHUMA transação fica aberta durante I/O do storage nem
 * durante o parse:
 *
 *   1. transação curta (contexto técnico da empresa): RECEBIDA → VALIDANDO, lê a versão da base, a
 *      chave do original, o mapeamento e os empregados vigentes — versão e vigentes saem da MESMA
 *      transação, então a prévia nunca combina a versão de um momento com a base de outro;
 *   2. sem transação: lê o original no storage, faz o parse e a validação integral (pura);
 *   3. transação curta: grava staging + versão + estado de uma vez (idempotente), o evento e, se o
 *      desfecho for terminal (REJEITADA), a notificação ao iniciador e aos administradores.
 *
 * Reentrega: tentativa já além de VALIDANDO → `ESTADO_INVALIDO_PARA_ACAO` → ack sem efeito; ainda
 * em VALIDANDO (queda no meio) → refaz e o staging não duplica. Falha transitória relança (o BullMQ
 * repete com backoff); definitiva vira `UnrecoverableError(<código estável>)`. Na última tentativa
 * (ou na irrecuperável), o PROCESSADOR chama `registrarFalhaDaValidacaoDeEmpregados` com o job
 * ainda ativo e leva a tentativa a FALHA; o consumidor só copia o job para a fila morta e repete a
 * FALHA como reforço idempotente.
 *
 * O worker NUNCA aplica empregados: a aplicação é da API, na confirmação. Nada aqui (log, erro,
 * evento) carrega CPF, nome ou valor de linha: só código estável e correlationId.
 */
import {
  DESCRITOR_EMPREGADOS as D,
  carregarEmpregadosVigentes,
  cicloDeImportacao as ciclo,
  criarNotificacoesDeImportacaoDeEmpregados,
  gravarResultadoDaValidacaoDeEmpregados,
  listarAdminsAutorizadosDaEmpresa,
} from '@contaia/db';
import { CODIGOS_DE_ERRO, type EmpregadoVigente } from '@contaia/domain';
import { ComandoValidarImportacaoSchema, type ComandoValidarImportacao } from '@contaia/shared';
import type { PoolClient } from 'pg';

import type { CodigoDeArquivoRecusado } from '../importacao/arquivo-recusado.js';
import {
  ehErroDeDominio,
  lerOriginal,
  motivoEncerraEmFalha,
  naEmpresaDoComando,
  naoEncontrada,
  validarComando,
  type CodigoDaFalhaDaValidacao,
  type DependenciasDaValidacao,
  type ResultadoDaValidacaoDoJob,
} from '../importacao/falhas.js';
import { analisarArquivo, type ResultadoDaAnalise } from './analise.js';

export {
  CODIGOS_DA_FALHA_DA_VALIDACAO,
  motivoDaFalhaDaValidacao,
  motivoEncerraEmFalha,
  type CodigoDaFalhaDaValidacao,
  type DependenciasDaValidacao,
  type ResultadoDaValidacaoDoJob,
} from '../importacao/falhas.js';

/** Identidade técnica do worker nas transações por empresa (classe `empresa` da RLS). */
export const IDENTIDADE_DO_WORKER_DE_EMPREGADOS = 'workers-empregados';

type Inicio = Readonly<{
  versaoNaValidacao: number;
  arquivoChave: string;
  mapeamento: unknown;
  usuarioIniciadorId: string;
  vigentes: ReadonlyMap<string, EmpregadoVigente>;
}>;

const naEmpresa = naEmpresaDoComando(IDENTIDADE_DO_WORKER_DE_EMPREGADOS);

/**
 * Iniciador e administradores autorizados da empresa (SPEC-014 §3.10), sem repetir ninguém. A
 * notificação é idempotente por (tentativa, usuário): reentrega não duplica.
 */
const notificar = async (c: PoolClient, comando: ComandoValidarImportacao, usuarioIniciadorId: string, agora: Date): Promise<void> => {
  const administradores = await listarAdminsAutorizadosDaEmpresa(c, comando.empresaId);

  await criarNotificacoesDeImportacaoDeEmpregados(c, {
    empresaId: comando.empresaId,
    tentativaId: comando.tentativaId,
    destinatarios: [...new Set([usuarioIniciadorId, ...administradores])],
    agora,
  });
};

/** Passo 1: início, versão da base e vigentes numa transação só. `null` = já processada. */
const iniciar = async (deps: DependenciasDaValidacao, comando: ComandoValidarImportacao): Promise<Inicio | null> => {
  const { empresaId, tentativaId, correlationId } = comando;

  try {
    return await naEmpresa(deps.pool, comando, async (c) => {
      const agora = deps.agora();
      const inicio = await ciclo.iniciarValidacao(c, D, empresaId, tentativaId, agora);

      if (inicio.transicionou) {
        await ciclo.registrarEvento(c, D, {
          empresaId, tentativaId, acao: 'INICIAR_VALIDACAO', estadoAnterior: 'RECEBIDA', estadoNovo: 'VALIDANDO',
          usuarioId: null, totais: null, codigo: null, correlationId, agora,
        });
      }

      const tentativa = await ciclo.buscarTentativa(c, D, empresaId, tentativaId);
      if (tentativa === null) {
        throw naoEncontrada();
      }

      return {
        versaoNaValidacao: inicio.versaoNaValidacao,
        arquivoChave: tentativa.arquivoChave,
        mapeamento: tentativa.mapeamento,
        usuarioIniciadorId: tentativa.usuarioIniciadorId,
        vigentes: await carregarEmpregadosVigentes(c, empresaId),
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

/** Passo 3: staging + versão + estado, evento e (se REJEITADA) a notificação, juntos. */
const gravar = async (
  deps: DependenciasDaValidacao,
  comando: ComandoValidarImportacao,
  inicio: Inicio,
  analise: ResultadoDaAnalise,
): Promise<ResultadoDaValidacaoDoJob> => {
  const { empresaId, tentativaId, correlationId } = comando;
  const linhas = analise.tipo === 'LINHAS' ? analise.linhas : [];
  const codigo: CodigoDeArquivoRecusado | null = analise.tipo === 'ARQUIVO_RECUSADO' ? analise.codigo : null;

  try {
    return await naEmpresa(deps.pool, comando, async (c) => {
      const agora = deps.agora();
      const gravado = await gravarResultadoDaValidacaoDeEmpregados(c, empresaId, tentativaId, linhas, inicio.versaoNaValidacao, agora);

      if (!gravado.transicionou) {
        return { desfecho: 'JA_PROCESSADA' } as const;
      }

      const sucesso = gravado.estado === 'AGUARDANDO_CONFIRMACAO';
      await ciclo.registrarEvento(c, D, {
        empresaId, tentativaId, acao: sucesso ? 'VALIDACAO_SUCESSO' : 'VALIDACAO_REJEITADA',
        estadoAnterior: 'VALIDANDO', estadoNovo: gravado.estado, usuarioId: null, totais: gravado.totais,
        // Código só no desfecho de rejeição do arquivo; a validação bem-sucedida (e a rejeição por
        // linhas) não tem.
        codigo: sucesso ? null : codigo, correlationId, agora,
      });

      if (!sucesso) {
        // Desfecho terminal produzido pelo worker. A prévia não notifica: quem conclui é a API.
        await notificar(c, comando, inicio.usuarioIniciadorId, agora);
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

export const processarValidacaoDeEmpregados = async (deps: DependenciasDaValidacao, dados: unknown): Promise<ResultadoDaValidacaoDoJob> => {
  const comando = validarComando(dados);
  const inicio = await iniciar(deps, comando);

  if (inicio === null) {
    return { desfecho: 'JA_PROCESSADA' };
  }

  const bytes = await lerOriginal(deps, inicio.arquivoChave);
  const analise = analisarArquivo(bytes, inicio.mapeamento, inicio.vigentes);

  return gravar(deps, comando, inicio, analise);
};

/**
 * Tentativas esgotadas (ou falha definitiva): VALIDANDO → FALHA, evento `FALHA_TECNICA` com o
 * código estável e a correlationId, e notificação ao iniciador e aos administradores, numa
 * transação. Só age sobre tentativa ainda em VALIDANDO: validada, encerrada ou parada em RECEBIDA →
 * `false`, sem efeito. Repetir é seguro: a segunda chamada encontra FALHA e não grava outro evento
 * nem outra notificação.
 */
export const registrarFalhaDaValidacaoDeEmpregados = async (
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
      const atual = await ciclo.buscarTentativa(c, D, empresaId, tentativaId);
      if (atual?.estado !== 'VALIDANDO') {
        return false;
      }

      const agora = deps.agora();
      const anterior = await ciclo.registrarFalha(c, D, empresaId, tentativaId, agora);
      await ciclo.registrarEvento(c, D, {
        empresaId, tentativaId, acao: 'FALHA_TECNICA', estadoAnterior: anterior, estadoNovo: 'FALHA',
        usuarioId: null, totais: null, codigo, correlationId, agora,
      });
      await notificar(c, comando, atual.usuarioIniciadorId, agora);

      return true;
    });
  } catch (erro) {
    if (ehErroDeDominio(erro, CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO) || ehErroDeDominio(erro, CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA)) {
      return false;
    }

    throw erro;
  }
};
