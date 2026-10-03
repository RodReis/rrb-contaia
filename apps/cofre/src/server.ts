/**
 * Servidor HTTP do cofre (SPEC-011 §6.2). Rotas:
 *  - GET  /health                                  saúde (Vault inicializado e desselado)
 *  - OPTIONS|POST /ingestao                        navegador → cofre, CORS restrito, sem cookies
 *  - POST /segredos/:referencia/inutilizar|restaurar   API → cofre, Bearer de serviço
 * Não há rota que leia ou devolva segredo, nem download.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type forge from 'node-forge';
import type { ClienteDaApi } from './api.js';
import { ingerir, type RegistroDeLog } from './ingestao.js';
import { ErroDeFormulario, lerFormulario } from './multipart.js';
import { montarProblema, type CodigoDoCofre } from './problema.js';
import { criarRegistroDeJti } from './ticket.js';
import { caminhoDoSegredo, ErroDoVault, type ClienteDoVault } from './vault.js';

export type DependenciasDoServidor = Readonly<{
  vault: ClienteDoVault;
  api: ClienteDaApi;
  raizes: readonly forge.pki.Certificate[];
  ticketSecret: string;
  serviceToken: string;
  origensPermitidas: readonly string[];
  agora?: () => Date;
  log?: (registro: RegistroDeLog) => void;
}>;

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

    let formulario;
    try {
      formulario = await lerFormulario(req);
    } catch {
      problema(res, 'REQUISICAO_INVALIDA', correlationId, cors);
      return;
    }

    const resultado = await ingerir(formulario, {
      ticketSecret: deps.ticketSecret,
      raizes: deps.raizes,
      vault: deps.vault,
      api: deps.api,
      jti,
      agora,
      log,
    });

    if (resultado.ok) {
      responder(res, 200, resultado.corpo, { ...cors, 'x-correlation-id': resultado.correlationId });
      return;
    }

    // Corpo acima do limite: a conexão não é reaproveitada; o resto do corpo é descartado (multipart.ts).
    const cabecalhosExtras = resultado.codigo === 'CERTIFICADO_TAMANHO_EXCEDIDO' ? { connection: 'close' } : {};
    problema(res, resultado.codigo, resultado.correlationId, { ...cors, ...cabecalhosExtras });
  };

  const tratarSegredo = async (
    req: IncomingMessage,
    res: ServerResponse,
    referencia: string,
    operacao: 'inutilizar' | 'restaurar',
  ): Promise<void> => {
    const correlationId = (req.headers['x-correlation-id'] as string | undefined) ?? randomUUID();

    if (!bearerValido(req, deps.serviceToken)) {
      problema(res, 'NAO_AUTORIZADO', correlationId);
      return;
    }

    try {
      const corpo = (await lerCorpoJson(req)) as { tenantId?: unknown; empresaId?: unknown };
      const escopo = {
        tenantId: String(corpo.tenantId),
        empresaId: String(corpo.empresaId),
        referencia,
      };
      caminhoDoSegredo(escopo); // valida UUIDs antes de tocar o Vault
      if (operacao === 'inutilizar') await deps.vault.inutilizar(escopo);
      else await deps.vault.restaurar(escopo);
      log({ nivel: 'info', evento: `segredo_${operacao}`, correlationId, referencia });
      responder(res, 200, { referencia, estado: operacao === 'inutilizar' ? 'INUTILIZADO' : 'RESTAURADO' }, {
        'x-correlation-id': correlationId,
      });
    } catch (erro) {
      // Id fora do formato (nunca chegou ao Vault) ou corpo malformado: erro do chamador.
      const invalida =
        erro instanceof ErroDeFormulario ||
        (erro instanceof ErroDoVault && erro.tipo === 'INESPERADA' && erro.statusHttp === null);
      log({ nivel: 'warn', evento: 'segredo_falhou', correlationId, operacao, invalida });
      problema(res, invalida ? 'REQUISICAO_INVALIDA' : 'COFRE_INDISPONIVEL', correlationId);
    }
  };

  return createServer((req, res) => {
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
};

export const escutar = (server: Server, porta: number, host = '0.0.0.0'): Promise<Server> =>
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
