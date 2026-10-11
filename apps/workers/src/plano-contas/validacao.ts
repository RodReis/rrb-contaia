/**
 * Validação assíncrona do plano de contas (SPEC-013 §3.2–§3.5, §3.10–§3.11, §6.4).
 *
 * Um job = uma tentativa. Três passos, e NENHUMA transação fica aberta durante I/O do storage nem
 * durante o parse:
 *
 *   1. transação curta (contexto técnico da empresa): RECEBIDA → VALIDANDO, lê a versão do plano,
 *      a chave do original, o mapeamento e as contas vigentes — versão e contas saem da MESMA
 *      transação, então a prévia nunca combina a versão de um momento com o plano de outro;
 *   2. sem transação: lê o original no storage, faz o parse e a validação integral (pura) — na
 *      planilha (SPEC-015), a aba é lida no processo filho, na vaga do limitador do processo;
 *   3. transação curta: grava staging + versão + estado de uma vez (idempotente), o evento e, se o
 *      desfecho for terminal (REJEITADA), a notificação ao iniciador. Na planilha lida, antes disso e
 *      na MESMA transação: o que a leitura apurou na tentativa e o evento `LEITURA_PLANILHA` (a
 *      reentrega sobrescreve e nunca duplica).
 *
 * Reentrega: tentativa já além de VALIDANDO → `ESTADO_INVALIDO_PARA_ACAO` → ack sem efeito; ainda
 * em VALIDANDO (queda no meio) → refaz e o staging não duplica. Falha transitória relança (o BullMQ
 * repete com backoff); definitiva vira `UnrecoverableError(<código estável>)`. Na última tentativa
 * (ou na irrecuperável), o PROCESSADOR (`processador.ts`) chama `registrarFalhaDaValidacao` com o
 * job ainda ativo e leva a tentativa a FALHA; o consumidor só copia o job para a fila morta e
 * repete a FALHA como reforço idempotente.
 */
import {
  buscarTentativaDeImportacao,
  carregarContasVigentes,
  criarNotificacaoDeImportacao,
  gravarResultadoDaValidacao,
  iniciarValidacaoDaImportacao,
  registrarEventoDeImportacao,
  registrarFalhaDaImportacao,
  registrarLeituraDaPlanilhaDaImportacao,
  type MapeamentoDaImportacao,
} from '@contaia/db';
import { CODIGOS_DE_ERRO, type ContaVigente } from '@contaia/domain';
import { ComandoValidarImportacaoSchema, type ComandoValidarImportacao } from '@contaia/shared';

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
import { analisarPlanilha, configuracaoDaPlanilha, type ConfiguracaoDaPlanilha } from '../importacao/planilha.js';
import { analisarAba, analisarArquivo, type ResultadoDaAnalise } from './analise.js';

export {
  CODIGOS_DA_FALHA_DA_VALIDACAO,
  motivoDaFalhaDaValidacao,
  motivoEncerraEmFalha,
  type CodigoDaFalhaDaValidacao,
  type DependenciasDaValidacao,
  type ResultadoDaValidacaoDoJob,
} from '../importacao/falhas.js';

/** Identidade técnica do worker nas transações por empresa (classe `empresa` da RLS). */
export const IDENTIDADE_DO_WORKER_DO_PLANO = 'workers-plano-contas';

type Inicio = Readonly<{
  planoVersaoNaValidacao: number;
  arquivoChave: string;
  mapeamento: MapeamentoDaImportacao;
  /** `null` = CSV. */
  planilha: ConfiguracaoDaPlanilha | null;
  contasVigentes: readonly ContaVigente[];
}>;

const naEmpresa = naEmpresaDoComando(IDENTIDADE_DO_WORKER_DO_PLANO);

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
        planilha: configuracaoDaPlanilha(tentativa),
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

      if (analise.tipo === 'LINHAS' && analise.leitura !== undefined) {
        // Antes do resultado: a gravação da leitura só vale com a tentativa ainda em VALIDANDO.
        await registrarLeituraDaPlanilhaDaImportacao(c, { empresaId, tentativaId, ...analise.leitura });
        await registrarEventoDeImportacao(c, {
          empresaId, tentativaId, acao: 'LEITURA_PLANILHA', estadoAnterior: 'VALIDANDO', estadoNovo: 'VALIDANDO',
          usuarioId: null, totais: null, codigo: null, correlationId, agora,
        });
      }

      const gravado = await gravarResultadoDaValidacao(c, empresaId, tentativaId, linhas, inicio.planoVersaoNaValidacao, agora);

      if (!gravado.transicionou) {
        return { desfecho: 'JA_PROCESSADA' } as const;
      }

      const sucesso = gravado.estado === 'AGUARDANDO_CONFIRMACAO';
      await registrarEventoDeImportacao(c, {
        empresaId, tentativaId, acao: sucesso ? 'VALIDACAO_SUCESSO' : 'VALIDACAO_REJEITADA',
        estadoAnterior: 'VALIDANDO', estadoNovo: gravado.estado, usuarioId: null, totais: gravado.totais,
        // Código só no desfecho de rejeição (defeito do arquivo); a validação bem-sucedida não tem.
        codigo: sucesso ? null : codigo, correlationId, agora,
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
  const { planilha, mapeamento, contasVigentes } = inicio;
  const analise =
    planilha === null
      ? analisarArquivo(bytes, mapeamento, contasVigentes)
      : await analisarPlanilha(deps, bytes, planilha, (leitura) => analisarAba(leitura, planilha.linhaCabecalho, mapeamento, contasVigentes));

  return gravar(deps, comando, inicio, analise);
};

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
