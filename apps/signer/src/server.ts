/**
 * Servidor mTLS interno do Signer (SPEC-012 §3.1, §6.2).
 *
 * Ordem fixa, e cada degrau recusa ANTES do seguinte: handshake mTLS contra a CA interna →
 * identidade (URN do certificado) → rota → alçada → corpo/consulta validados pelo contrato →
 * serviço. Nada disso lê o Vault: o segredo só é tocado dentro dos serviços, depois que
 * identidade, alçada e contexto já passaram.
 */
import { randomUUID } from 'node:crypto';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';
import {
  ComandoAssinarSchema,
  ComandoDiagnosticarSchema,
  ComandoExecutarMtlsSchema,
  ConsultaEstadosSchema,
  ConsultaHistoricoSchema,
} from '@contaia/shared';

import { identidadeDoSan, permitido, type IdentidadeDeServico, type Operacao } from './alcada.js';
import { ErroDoSigner, type CodigoDoSigner } from './erro.js';
import { montarProblema } from './problema.js';
import type { ServicosDoSigner } from './servicos.js';

export type { ServicosDoSigner } from './servicos.js';

const LIMITE_DO_CORPO_BYTES = 2 * 1024 * 1024;
const CORRELATION_ID = /^[A-Za-z0-9._:-]{8,128}$/u;

/** O que o servidor precisa de um schema do contrato; evita depender do `zod` diretamente. */
type Esquema = Readonly<{
  safeParse(
    valor: unknown,
  ): { success: true; data: unknown } | { success: false; error: { issues: readonly { path: readonly PropertyKey[] }[] } };
}>;

type Rota = Readonly<{
  metodo: 'GET' | 'POST';
  caminho: string;
  operacao: Operacao;
  /** Contrato validado da entrada; `null` quando a rota não recebe nada (saúde). */
  schema: Esquema | null;
  executar: (
    servicos: ServicosDoSigner,
    identidade: IdentidadeDeServico,
    entrada: never,
  ) => Promise<unknown>;
}>;

const ROTAS: readonly Rota[] = [
  { metodo: 'GET', caminho: '/v1/saude', operacao: 'saude', schema: null, executar: (s) => s.saude() },
  {
    metodo: 'POST',
    caminho: '/v1/assinar',
    operacao: 'assinar',
    schema: ComandoAssinarSchema,
    executar: (s, id, entrada) => s.assinar(id, entrada),
  },
  {
    metodo: 'POST',
    caminho: '/v1/executar-mtls',
    operacao: 'executar-mtls',
    schema: ComandoExecutarMtlsSchema,
    executar: (s, id, entrada) => s.executarMtls(id, entrada),
  },
  {
    metodo: 'POST',
    caminho: '/v1/diagnosticar',
    operacao: 'diagnosticar',
    schema: ComandoDiagnosticarSchema,
    executar: (s, id, entrada) => s.diagnosticar(id, entrada),
  },
  {
    metodo: 'GET',
    caminho: '/v1/estados',
    operacao: 'estados',
    schema: ConsultaEstadosSchema,
    executar: (s, id, entrada) => s.estados(id, entrada),
  },
  {
    metodo: 'GET',
    caminho: '/v1/historico',
    operacao: 'historico',
    schema: ConsultaHistoricoSchema,
    executar: (s, id, entrada) => s.historico(id, entrada),
  },
];

const enviar = (resposta: ServerResponse, status: number, tipo: string, corpo: unknown): void => {
  const texto = JSON.stringify(corpo);

  resposta.writeHead(status, {
    'content-type': `${tipo}; charset=utf-8`,
    'content-length': Buffer.byteLength(texto),
    'cache-control': 'no-store',
  });
  resposta.end(texto);
};

const enviarProblema = (
  resposta: ServerResponse,
  codigo: CodigoDoSigner,
  status: number,
  correlationId: string,
): void => enviar(resposta, status, 'application/problem+json', montarProblema(codigo, status, correlationId));

const lerCorpo = (requisicao: IncomingMessage): Promise<string> =>
  new Promise((resolver, rejeitar) => {
    const partes: Buffer[] = [];
    let total = 0;

    requisicao.on('data', (parte: Buffer) => {
      total += parte.length;
      if (total > LIMITE_DO_CORPO_BYTES) {
        requisicao.destroy();
        rejeitar(new ErroDoSigner('REQUISICAO_INVALIDA'));
        return;
      }
      partes.push(parte);
    });
    requisicao.on('end', () => resolver(Buffer.concat(partes).toString('utf8')));
    requisicao.on('error', () => rejeitar(new ErroDoSigner('REQUISICAO_INVALIDA')));
  });

/** Consulta GET: a query vira objeto; a página é o único campo numérico. */
const consultaDe = (url: URL): Record<string, unknown> => {
  const consulta: Record<string, unknown> = Object.fromEntries(url.searchParams);

  if (typeof consulta['pagina'] === 'string') {
    consulta['pagina'] = Number(consulta['pagina']);
  }

  return consulta;
};

const codigoDeContrato = (erro: { issues: readonly { path: readonly PropertyKey[] }[] }): CodigoDoSigner =>
  erro.issues.some((problema) => problema.path[0] === 'finalidade')
    ? 'SIGNER_FINALIDADE_INVALIDA'
    : 'SIGNER_CONTEXTO_INVALIDO';

const identidadeDoPeer = (requisicao: IncomingMessage): IdentidadeDeServico | null => {
  const socket = requisicao.socket as TLSSocket;

  // `rejectUnauthorized` já barrou o handshake; conferir `authorized` é a segunda trava.
  if (!socket.authorized) {
    return null;
  }

  return identidadeDoSan(socket.getPeerCertificate().subjectaltname);
};

export type OpcoesDoServidor = Readonly<{
  certificadoPem: string;
  chavePem: string;
  caInternaPem: string;
  servicos: ServicosDoSigner;
}>;

export const criarServidorDoSigner = ({
  certificadoPem,
  chavePem,
  caInternaPem,
  servicos,
}: OpcoesDoServidor): https.Server => {
  const tratar = async (requisicao: IncomingMessage, resposta: ServerResponse): Promise<void> => {
    const cabecalho = requisicao.headers['x-correlation-id'];
    let correlationId = typeof cabecalho === 'string' && CORRELATION_ID.test(cabecalho) ? cabecalho : randomUUID();

    const identidade = identidadeDoPeer(requisicao);

    if (identidade === null) {
      enviarProblema(resposta, 'SIGNER_IDENTIDADE_INVALIDA', 401, correlationId);
      return;
    }

    const url = new URL(requisicao.url ?? '/', 'https://signer.local');
    const rota = ROTAS.find((candidata) => candidata.metodo === requisicao.method && candidata.caminho === url.pathname);

    if (rota === undefined) {
      enviarProblema(resposta, 'ROTA_NAO_ENCONTRADA', 404, correlationId);
      return;
    }
    if (!permitido(identidade, rota.operacao)) {
      enviarProblema(resposta, 'SIGNER_ALCADA_NEGADA', 403, correlationId);
      return;
    }

    let entrada: unknown;

    if (rota.schema !== null) {
      let bruta: unknown;

      if (rota.metodo === 'GET') {
        bruta = consultaDe(url);
      } else {
        try {
          bruta = JSON.parse(await lerCorpo(requisicao));
        } catch {
          enviarProblema(resposta, 'REQUISICAO_INVALIDA', 400, correlationId);
          return;
        }
      }

      const candidatoCorrelacao = (bruta as { correlationId?: unknown } | null)?.correlationId;
      if (cabecalho === undefined && typeof candidatoCorrelacao === 'string' && CORRELATION_ID.test(candidatoCorrelacao)) {
        correlationId = candidatoCorrelacao;
      }

      const validado = rota.schema.safeParse(bruta);

      if (!validado.success) {
        enviarProblema(resposta, codigoDeContrato(validado.error), 400, correlationId);
        return;
      }
      entrada = validado.data;
    }

    try {
      enviar(resposta, 200, 'application/json', await rota.executar(servicos, identidade, entrada as never));
    } catch (erro) {
      if (erro instanceof ErroDoSigner) {
        enviarProblema(resposta, erro.codigo, erro.status, correlationId);
        return;
      }
      // Só a classe e a correlação: a mensagem pode carregar dado externo ou segredo.
      console.error(JSON.stringify({ evento: 'erro-inesperado', correlationId, classe: (erro as Error)?.name ?? 'desconhecida' }));
      enviarProblema(resposta, 'SIGNER_INDISPONIVEL', 500, correlationId);
    }
  };

  const servidor = https.createServer(
    {
      cert: certificadoPem,
      key: chavePem,
      ca: caInternaPem,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
    },
    (requisicao, resposta) => {
      tratar(requisicao, resposta).catch(() => {
        if (!resposta.headersSent) {
          enviarProblema(resposta, 'SIGNER_INDISPONIVEL', 500, randomUUID());
        }
      });
    },
  );

  servidor.requestTimeout = 30_000;

  // Handshake recusado (sem certificado, CA errada, vencido): nada a responder nem a registrar.
  servidor.on('tlsClientError', () => {});

  return servidor;
};

export const escutar = (servidor: https.Server, porta: number, host = '0.0.0.0'): Promise<https.Server> =>
  new Promise((resolver, rejeitar) => {
    servidor.once('error', rejeitar);
    servidor.listen(porta, host, () => resolver(servidor));
  });

export const encerrarComGraca = (servidor: https.Server): void => {
  const fechar = (): void => {
    servidor.close(() => process.exit(0));
  };

  process.on('SIGTERM', fechar);
  process.on('SIGINT', fechar);
};
