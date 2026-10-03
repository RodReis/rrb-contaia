/**
 * Caso de uso da ingestão (SPEC-011 §3.1, §3.3, §6.2): valida tudo ANTES de gravar,
 * grava no Vault com o token write-only, pede à API que ative e, se a ativação falhar,
 * compensa. Devolve só metadados ou um código estável — nunca arquivo, senha ou chave.
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
import type { ClienteDaApi } from './api.js';
import type { FormularioDeIngestao } from './multipart.js';
import { abrirPkcs12 } from './pkcs12.js';
import { ehCodigoDeRecusa } from './problema.js';
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
}>;

export type ResultadoDaIngestao =
  | Readonly<{ ok: true; corpo: RespostaDaIngestao; correlationId: string }>
  | Readonly<{ ok: false; codigo: CodigoDeRecusaDaIngestao; correlationId: string }>;

const temExtensaoAceita = (nome: string): boolean =>
  EXTENSOES_DO_CERTIFICADO.some((extensao) => nome.toLowerCase().endsWith(extensao));

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

const codigoDaFalhaDaApi = (codigo: string | null): CodigoDeRecusaDaIngestao =>
  ehCodigoDeRecusa(codigo) ? codigo : 'COFRE_INDISPONIVEL';

export const ingerir = async (
  formulario: FormularioDeIngestao,
  deps: DependenciasDaIngestao,
): Promise<ResultadoDaIngestao> => {
  const agora = deps.agora();
  const carga: CargaDoTicket | null =
    formulario.ticket === null ? null : verificarTicket(formulario.ticket, deps.ticketSecret, agora);
  const semTicket = { ok: false, codigo: 'CERTIFICADO_TICKET_INVALIDO', correlationId: randomUUID() } as const;

  // Corpo gigante cortado antes de chegar ao ticket: não há como auditar, mas o motivo é claro.
  if (carga === null && formulario.excedeuLimite) {
    return { ok: false, codigo: 'CERTIFICADO_TAMANHO_EXCEDIDO', correlationId: semTicket.correlationId };
  }

  // Primeira apresentação consome o jti, mesmo que a validação adiante falhe.
  if (carga === null || formulario.ticket === null || !deps.jti.consumir(carga.jti, carga.exp, agora)) {
    deps.log({ nivel: 'info', evento: 'ingestao_recusada', correlationId: semTicket.correlationId, codigo: semTicket.codigo });
    return semTicket;
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

    const aberto = abrirPkcs12(arquivo.bytes, senha, deps.raizes, agora);
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

    const ativacao = await deps.api.ativar(
      { ticket, metadados: aberto.metadados, referenciaDoSegredo: escopo.referencia },
      correlationId,
    );

    if (!ativacao.ok) {
      await compensar(deps, escopo, correlationId);
      const codigo = codigoDaFalhaDaApi(ativacao.codigo);
      deps.log({ nivel: 'warn', evento: 'ativacao_falhou', correlationId, codigo, statusDaApi: ativacao.status });
      return { ok: false, codigo, correlationId };
    }

    deps.log({ nivel: 'info', evento: 'ingestao_concluida', correlationId });
    return { ok: true, corpo: ativacao.corpo, correlationId };
  } finally {
    // O que dá para apagar da memória: os bytes do PKCS#12. (Strings JS são imutáveis.)
    formulario.arquivo?.bytes.fill(0);
  }
};
