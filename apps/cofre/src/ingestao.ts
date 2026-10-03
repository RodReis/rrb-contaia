/**
 * Caso de uso da ingestão (SPEC-011 §3.1, §3.3, §6.2): valida tudo ANTES de gravar,
 * grava no Vault com o token write-only, pede à API que ative e, se a API recusar de
 * forma definitiva, compensa. Devolve só metadados ou um código estável — nunca arquivo,
 * senha ou chave.
 */
import { randomUUID } from 'node:crypto';
import type forge from 'node-forge';
import { avaliarCertificado } from '@contaia/domain';
import {
  EXTENSOES_DO_CERTIFICADO,
  type CargaDoTicket,
  type CodigoDeRecusaDaIngestao,
  type RespostaDaIngestao,
} from '@contaia/shared';
import type { ClienteDaApi, RecusaDefinitiva, RespostaDaApi } from './api.js';
import type { FormularioDeIngestao } from './multipart.js';
import { abrirPkcs12 } from './pkcs12.js';
import { CODIGOS_REPASSADOS_DA_API, ehCodigoDeRecusa, type ProblemaRepassado } from './problema.js';
import { verificarTicket, type criarRegistroDeJti } from './ticket.js';
import type { ClienteDoVault, EscopoDoSegredo } from './vault.js';

export type RegistroDeLog = Readonly<Record<string, string | number | boolean | null>>;

export type DependenciasDaIngestao = Readonly<{
  ticketSecret: string;
  raizes: readonly forge.pki.Certificate[];
  vault: ClienteDoVault;
  api: ClienteDaApi;
  jti: ReturnType<typeof criarRegistroDeJti>;
  agora: () => Date;
  log: (registro: RegistroDeLog) => void;
  /** Espera entre tentativas da ativação; injetável para o teste não dormir. */
  esperar?: (ms: number) => Promise<void>;
}>;

export type ResultadoDaIngestao =
  | Readonly<{ ok: true; corpo: RespostaDaIngestao; correlationId: string }>
  | Readonly<{ ok: false; codigo: CodigoDeRecusaDaIngestao; correlationId: string }>
  /** Recusa definitiva da API com um código que o usuário precisa ver. */
  | Readonly<{ ok: false; repassado: ProblemaRepassado; correlationId: string }>;

/** Esperas entre as tentativas da ativação em desfecho ambíguo (rede, timeout, 5xx): 3 tentativas. */
export const ESPERAS_ENTRE_TENTATIVAS_MS: readonly number[] = [250, 750];

const dormir = (ms: number): Promise<void> => new Promise((resolver) => setTimeout(resolver, ms));

const temExtensaoAceita = (nome: string): boolean =>
  EXTENSOES_DO_CERTIFICADO.some((extensao) => nome.toLowerCase().endsWith(extensao));

/**
 * Primeiro ato da ingestão, chamado assim que o campo `ticket` chega (antes do arquivo):
 * assinatura + expiração, e o `jti` é consumido NA PRIMEIRA APRESENTAÇÃO, mesmo que a
 * validação adiante falhe (nova tentativa = novo ticket).
 */
export const autorizarTicket = (
  ticket: string,
  deps: Pick<DependenciasDaIngestao, 'ticketSecret' | 'jti' | 'agora'>,
): CargaDoTicket | null => {
  const agora = deps.agora();
  const carga = verificarTicket(ticket, deps.ticketSecret, agora);
  return carga !== null && deps.jti.consumir(carga.jti, carga.exp, agora) ? carga : null;
};

/**
 * Compensação (SPEC-011 §7): a versão gravada não foi ativada, então some de vez.
 * Se o destroy falhar, ao menos o delete a torna ilegível; a falha dupla vai ao log
 * com a referência opaca (que não é segredo) para limpeza operacional.
 */
const compensar = async (
  deps: DependenciasDaIngestao,
  escopo: EscopoDoSegredo,
  correlationId: string,
): Promise<void> => {
  try {
    await deps.vault.destruir(escopo);
    return;
  } catch {
    // tenta o delete reversível abaixo
  }
  try {
    await deps.vault.inutilizar(escopo);
    deps.log({ nivel: 'warn', evento: 'compensacao_parcial', correlationId, referencia: escopo.referencia });
  } catch {
    deps.log({ nivel: 'error', evento: 'compensacao_falhou', correlationId, referencia: escopo.referencia });
  }
};

/**
 * A API pode ter comitado antes de a resposta se perder, então só um "não" definitivo
 * autoriza destruir o segredo. Fora disso repete (a ativação é idempotente por ticket +
 * referência); se continuar ambíguo, devolve o último desfecho SEM compensar.
 */
const ativarComTentativas = async (
  deps: DependenciasDaIngestao,
  pedido: Parameters<ClienteDaApi['ativar']>[0],
  correlationId: string,
): Promise<RespostaDaApi> => {
  const esperar = deps.esperar ?? dormir;
  let ultima: RespostaDaApi = { ok: false, definitiva: false, status: null };

  for (let tentativa = 0; tentativa <= ESPERAS_ENTRE_TENTATIVAS_MS.length; tentativa++) {
    if (tentativa > 0) await esperar(ESPERAS_ENTRE_TENTATIVAS_MS[tentativa - 1] ?? 0);
    ultima = await deps.api.ativar(pedido, correlationId);
    if (ultima.ok || ultima.definitiva) return ultima;
  }

  return ultima;
};

const resultadoDaRecusaDefinitiva = (recusa: RecusaDefinitiva, correlationId: string): ResultadoDaIngestao => {
  if (ehCodigoDeRecusa(recusa.codigo)) return { ok: false, codigo: recusa.codigo, correlationId };

  if (CODIGOS_REPASSADOS_DA_API.has(recusa.codigo)) {
    return {
      ok: false,
      repassado: { codigo: recusa.codigo, status: recusa.status, titulo: recusa.titulo, detalhe: recusa.detalhe },
      correlationId,
    };
  }

  return { ok: false, codigo: 'COFRE_INDISPONIVEL', correlationId };
};

/**
 * `carga` é o ticket já verificado por `autorizarTicket` (nulo = ticket inválido, replay ou
 * corpo grande demais para sequer chegar ao ticket).
 */
export const ingerir = async (
  formulario: FormularioDeIngestao,
  carga: CargaDoTicket | null,
  deps: DependenciasDaIngestao,
): Promise<ResultadoDaIngestao> => {
  const agora = deps.agora();

  if (carga === null || formulario.ticket === null) {
    const correlationId = randomUUID();
    // Corpo gigante cortado antes de chegar ao ticket: não há como auditar, mas o motivo é claro.
    const codigo =
      formulario.excedeuLimite && formulario.ticket === null
        ? 'CERTIFICADO_TAMANHO_EXCEDIDO'
        : 'CERTIFICADO_TICKET_INVALIDO';
    deps.log({ nivel: 'info', evento: 'ingestao_recusada', correlationId, codigo });
    return { ok: false, codigo, correlationId };
  }

  const { correlationId } = carga;
  const ticket = formulario.ticket;

  const recusar = async (codigo: CodigoDeRecusaDaIngestao): Promise<ResultadoDaIngestao> => {
    const auditada = await deps.api.recusar({ ticket, codigo }, correlationId);
    deps.log({ nivel: 'info', evento: 'ingestao_recusada', correlationId, codigo, auditada });
    return { ok: false, codigo, correlationId };
  };

  try {
    if (formulario.excedeuLimite) return await recusar('CERTIFICADO_TAMANHO_EXCEDIDO');

    const { arquivo, senha } = formulario;
    if (arquivo === null || arquivo.bytes.length === 0) return await recusar('CERTIFICADO_ARQUIVO_VAZIO');
    if (!temExtensaoAceita(arquivo.nome)) return await recusar('CERTIFICADO_EXTENSAO_INVALIDA');
    if (senha === null || senha === '') return await recusar('CERTIFICADO_SENHA_INCORRETA');

    const aberto = await abrirPkcs12(arquivo.bytes, senha, deps.raizes, agora);
    if (!aberto.ok) return await recusar(aberto.codigo);

    const avaliacao = avaliarCertificado(aberto.extraido, { cnpjDaEmpresa: carga.cnpjDaEmpresa, agora });
    if (!avaliacao.ok) return await recusar(avaliacao.codigo);

    const escopo: EscopoDoSegredo = {
      tenantId: carga.tenantId,
      empresaId: carga.empresaId,
      referencia: randomUUID(),
    };

    try {
      await deps.vault.gravar(escopo, {
        pkcs12Base64: arquivo.bytes.toString('base64'),
        senha,
        impressaoDigital: aberto.metadados.impressaoDigital,
      });
    } catch (erro) {
      deps.log({
        nivel: 'error',
        evento: 'vault_gravacao_falhou',
        correlationId,
        motivo: erro instanceof Error ? erro.name : 'desconhecido',
      });
      return await recusar('COFRE_INDISPONIVEL');
    }

    const ativacao = await ativarComTentativas(
      deps,
      { ticket, metadados: aberto.metadados, referenciaDoSegredo: escopo.referencia },
      correlationId,
    );

    if (ativacao.ok) {
      deps.log({ nivel: 'info', evento: 'ingestao_concluida', correlationId });
      return { ok: true, corpo: ativacao.corpo, correlationId };
    }

    if (ativacao.definitiva) {
      // A API disse "não": nada foi ativado, o segredo gravado não serve a ninguém.
      await compensar(deps, escopo, correlationId);
      deps.log({
        nivel: 'warn',
        evento: 'ativacao_recusada',
        correlationId,
        codigo: ativacao.codigo,
        statusDaApi: ativacao.status,
      });
      return resultadoDaRecusaDefinitiva(ativacao, correlationId);
    }

    // Ambíguo mesmo depois das tentativas: a API pode ter ativado. Destruir o segredo
    // deixaria um certificado vigente sem segredo; uma referência órfã é inofensiva.
    deps.log({
      nivel: 'error',
      evento: 'ativacao_ambigua',
      correlationId,
      referencia: escopo.referencia,
      statusDaApi: ativacao.status,
    });
    return { ok: false, codigo: 'COFRE_INDISPONIVEL', correlationId };
  } finally {
    // O que dá para apagar da memória: os bytes do PKCS#12. (Strings JS são imutáveis.)
    formulario.arquivo?.bytes.fill(0);
  }
};
