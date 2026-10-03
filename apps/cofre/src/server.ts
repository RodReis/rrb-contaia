/**
 * Servidor HTTP do cofre (SPEC-011 §6.2). Rotas:
 *  - GET  /health                                  saúde (Vault inicializado e desselado)
 *  - OPTIONS|POST /ingestao                        navegador → cofre, CORS restrito, sem cookies
 *  - POST /segredos/:referencia/inutilizar|restaurar   API → cofre, Bearer COFRE_ADMIN_TOKEN
 *    (credencial distinta da COFRE_SERVICE_TOKEN, que é a do sentido cofre → API)
 * Não há rota que leia ou devolva segredo, nem download.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type forge from 'node-forge';
import type { ClienteDaApi } from './api.js';
import type { CargaDoTicket } from '@contaia/shared';
import { autorizarTicket, ingerir, type RegistroDeLog } from './ingestao.js';
import { descartarCorpo, ErroDeFormulario, lerFormulario } from './multipart.js';
import { montarProblema, montarProblemaRepassado, type CodigoDoCofre } from './problema.js';
import { criarRegistroDeJti } from './ticket.js';
import type { ClienteDoVault, EscopoDoSegredo } from './vault.js';

export type DependenciasDoServidor = Readonly<{
  vault: ClienteDoVault;
  api: ClienteDaApi;
  raizes: readonly forge.pki.Certificate[];
  ticketSecret: string;
  /** Bearer das rotas `/segredos/*` (API → cofre). Não é o token do sentido cofre → API. */
  adminToken: string;
  origensPermitidas: readonly string[];
  /** Ingestões em andamento ao mesmo tempo (cada uma pode reter ~10 MB + worker). */
  maxIngestoesSimultaneas?: number;
  agora?: () => Date;
  log?: (registro: RegistroDeLog) => void;
  esperar?: (ms: number) => Promise<void>;
}>;

export const MAX_INGESTOES_SIMULTANEAS_PADRAO = 4;
const SEGUNDOS_PARA_TENTAR_DE_NOVO = 5;
const CORRELATION_ID_VALIDO = /^[A-Za-z0-9._-]{1,64}$/;

/** `x-correlation-id` vem de fora: só formato inofensivo entra em log e resposta. */
export const correlationIdDe = (cabecalho: string | string[] | undefined): string =>
  typeof cabecalho === 'string' && CORRELATION_ID_VALIDO.test(cabecalho) ? cabecalho : randomUUID();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIMITE_DO_CORPO_INTERNO_BYTES = 4 * 1024;

const logPadrao = (registro: RegistroDeLog): void => {
  process.stdout.write(`${JSON.stringify({ servico: 'cofre', ...registro })}\n`);
};

const digest = (texto: string): Buffer => createHash('sha256').update(texto).digest();

const bearerValido = (req: IncomingMessage, esperado: string): boolean => {
  const cabecalho = req.headers.authorization ?? '';
  const recebido = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';
  // Compara digests de tamanho fixo: o tempo não revela o comprimento do segredo.
  return timingSafeEqual(digest(recebido), digest(esperado));
};

/** `null` para qualquer coisa que não seja `{tenantId, empresaId}` com UUIDs. */
const escopoDoCorpo = (corpo: unknown, referencia: string): EscopoDoSegredo | null => {
  if (typeof corpo !== 'object' || corpo === null) return null;
  const { tenantId, empresaId } = corpo as Record<string, unknown>;
  if (typeof tenantId !== 'string' || typeof empresaId !== 'string') return null;
  return [tenantId, empresaId, referencia].every((id) => UUID.test(id))
    ? { tenantId, empresaId, referencia }
    : null;
};

const lerCorpoJson = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolver, rejeitar) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on('data', (parte: Buffer) => {
      total += parte.length;
      if (total > LIMITE_DO_CORPO_INTERNO_BYTES) rejeitar(new ErroDeFormulario('corpo grande'));
      else partes.push(parte);
    });
    req.on('end', () => {
      try {
        resolver(JSON.parse(Buffer.concat(partes).toString('utf8')));
      } catch {
        rejeitar(new ErroDeFormulario('json'));
      }
    });
    req.on('error', () => rejeitar(new ErroDeFormulario('leitura')));
  });

export const criarServidorDoCofre = (deps: DependenciasDoServidor): Server => {
  const agora = deps.agora ?? ((): Date => new Date());
  const log = deps.log ?? logPadrao;
  const jti = criarRegistroDeJti();
  const maxIngestoes = deps.maxIngestoesSimultaneas ?? MAX_INGESTOES_SIMULTANEAS_PADRAO;
  let ingestoesEmAndamento = 0;

  const responder = (
    res: ServerResponse,
    status: number,
    corpo: unknown,
    cabecalhos: Record<string, string> = {},
    tipo = 'application/json',
  ): void => {
    res.writeHead(status, { 'content-type': tipo, 'cache-control': 'no-store', ...cabecalhos });
    res.end(JSON.stringify(corpo));
  };

  const problema = (
    res: ServerResponse,
    codigo: CodigoDoCofre,
    correlationId: string,
    cabecalhos: Record<string, string> = {},
  ): void => {
    const corpo = montarProblema(codigo, correlationId);
    responder(res, corpo.status, corpo, { 'x-correlation-id': correlationId, ...cabecalhos }, 'application/problem+json');
  };

  /** CORS só para as origens configuradas; sem credenciais, sem curinga. */
  const cabecalhosDeCors = (origem: string | undefined): Record<string, string> =>
    origem !== undefined && deps.origensPermitidas.includes(origem)
      ? {
          'access-control-allow-origin': origem,
          'access-control-expose-headers': 'x-correlation-id',
          vary: 'Origin',
        }
      : { vary: 'Origin' };

  const tratarIngestao = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const origem = req.headers.origin;
    const cors = cabecalhosDeCors(origem);
    const correlationId = randomUUID();

    if (origem !== undefined && !deps.origensPermitidas.includes(origem)) {
      problema(res, 'ORIGEM_NAO_PERMITIDA', correlationId, cors);
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...cors,
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
      });
      res.end();
      return;
    }

    // Capacidade: cada ingestão segura até ~10 MB do arquivo + um worker. Excedente espera fora.
    if (ingestoesEmAndamento >= maxIngestoes) {
      await descartarCorpo(req);
      problema(res, 'COFRE_INDISPONIVEL', correlationId, {
        ...cors,
        'retry-after': String(SEGUNDOS_PARA_TENTAR_DE_NOVO),
        connection: 'close',
      });
      return;
    }

    ingestoesEmAndamento++;
    try {
      const dependencias = {
        ticketSecret: deps.ticketSecret,
        raizes: deps.raizes,
        vault: deps.vault,
        api: deps.api,
        jti,
        agora,
        log,
        ...(deps.esperar ? { esperar: deps.esperar } : {}),
      };
      // O ticket é conferido assim que chega, antes de o arquivo ser lido.
      const autorizacao: { carga: CargaDoTicket | null } = { carga: null };
      let formulario;
      try {
        formulario = await lerFormulario(req, (ticket) => {
          autorizacao.carga = autorizarTicket(ticket, dependencias);
          return autorizacao.carga !== null;
        });
      } catch {
        problema(res, 'REQUISICAO_INVALIDA', correlationId, cors);
        return;
      }

      const resultado = await ingerir(formulario, autorizacao.carga, dependencias);

      if (resultado.ok) {
        responder(res, 200, resultado.corpo, { ...cors, 'x-correlation-id': resultado.correlationId });
        return;
      }

      if ('repassado' in resultado) {
        const corpo = montarProblemaRepassado(resultado.repassado, resultado.correlationId);
        responder(
          res,
          corpo.status,
          corpo,
          { ...cors, 'x-correlation-id': resultado.correlationId },
          'application/problem+json',
        );
        return;
      }

      // Corpo acima do limite: a conexão não é reaproveitada; o resto do corpo é descartado (multipart.ts).
      const cabecalhosExtras = resultado.codigo === 'CERTIFICADO_TAMANHO_EXCEDIDO' ? { connection: 'close' } : {};
      problema(res, resultado.codigo, resultado.correlationId, { ...cors, ...cabecalhosExtras });
    } finally {
      ingestoesEmAndamento--;
    }
  };

  const tratarSegredo = async (
    req: IncomingMessage,
    res: ServerResponse,
    referencia: string,
    operacao: 'inutilizar' | 'restaurar',
  ): Promise<void> => {
    const correlationId = correlationIdDe(req.headers['x-correlation-id']);

    if (!bearerValido(req, deps.adminToken)) {
      problema(res, 'NAO_AUTORIZADO', correlationId);
      return;
    }

    try {
      const corpo = await lerCorpoJson(req);
      const escopo = escopoDoCorpo(corpo, referencia);
      if (escopo === null) throw new ErroDeFormulario('escopo');
      if (operacao === 'inutilizar') await deps.vault.inutilizar(escopo);
      else await deps.vault.restaurar(escopo);
      log({ nivel: 'info', evento: `segredo_${operacao}`, correlationId, referencia });
      responder(res, 200, { referencia, estado: operacao === 'inutilizar' ? 'INUTILIZADO' : 'RESTAURADO' }, {
        'x-correlation-id': correlationId,
      });
    } catch (erro) {
      // Corpo malformado ou ids fora do formato (nunca chegou ao Vault): erro do chamador.
      const invalida = erro instanceof ErroDeFormulario;
      log({ nivel: 'warn', evento: 'segredo_falhou', correlationId, operacao, invalida });
      problema(res, invalida ? 'REQUISICAO_INVALIDA' : 'COFRE_INDISPONIVEL', correlationId);
    }
  };

  const servidor = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://cofre.local');
    const correlationId = randomUUID();

    const despachar = async (): Promise<void> => {
      if (req.method === 'GET' && url.pathname === '/health') {
        const pronto = await deps.vault.pronto();
        responder(res, pronto ? 200 : 503, { service: 'cofre', status: pronto ? 'ok' : 'indisponivel' });
        return;
      }

      if (url.pathname === '/ingestao' && (req.method === 'POST' || req.method === 'OPTIONS')) {
        await tratarIngestao(req, res);
        return;
      }

      const segredo = /^\/segredos\/([^/]+)\/(inutilizar|restaurar)$/.exec(url.pathname);
      if (req.method === 'POST' && segredo) {
        await tratarSegredo(req, res, segredo[1] as string, segredo[2] as 'inutilizar' | 'restaurar');
        return;
      }

      problema(res, 'ROTA_NAO_ENCONTRADA', correlationId);
    };

    despachar().catch((erro: unknown) => {
      // Erro inesperado: só o nome da classe vai ao log (a mensagem pode carregar dado).
      log({ nivel: 'error', evento: 'erro_interno', correlationId, motivo: erro instanceof Error ? erro.name : 'desconhecido' });
      if (!res.headersSent) problema(res, 'COFRE_INDISPONIVEL', correlationId);
      else res.end();
    });
  });

  // Upload lento (slowloris) não pode prender uma vaga indefinidamente.
  servidor.headersTimeout = 20_000;
  servidor.requestTimeout = 120_000;
  return servidor;
};

/** Padrão só loopback: expor o cofre em outra interface é decisão explícita (`COFRE_HOST`). */
export const HOST_PADRAO = '127.0.0.1';

export const escutar = (server: Server, porta: number, host = HOST_PADRAO): Promise<Server> =>
  new Promise((resolver) => {
    server.listen(porta, host, () => resolver(server));
  });

export const encerrarComGraca = (server: Server): void => {
  const fechar = (): void => {
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', fechar);
  process.on('SIGINT', fechar);
};
