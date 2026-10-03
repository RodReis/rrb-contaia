/**
 * Leitura do `multipart/form-data` da ingestão, toda em memória (SPEC-011 §6.2):
 * nada de arquivo temporário. O limite de 10 MB é imposto por `busboy`
 * (`limits.fileSize`) e por um contador de bytes da requisição inteira, de modo
 * que um corpo gigante é cortado sem ser lido até o fim.
 */
import type { IncomingMessage } from 'node:http';
import busboy from 'busboy';
import { LIMITE_DO_CERTIFICADO_BYTES } from '@contaia/shared';

/** Folga para cabeçalhos de parte, ticket e senha em volta do arquivo. */
const MARGEM_DO_CORPO_BYTES = 64 * 1024;
const LIMITE_DE_CAMPO_BYTES = 8 * 1024;
/**
 * Depois de recusar por tamanho o corpo ainda é descartado (sem guardar nada) para o
 * navegador conseguir ler o 413 em vez de ver a conexão cair; passado este teto, a
 * conexão é derrubada.
 */
const TETO_DE_DESCARTE_BYTES = 4 * LIMITE_DO_CERTIFICADO_BYTES;

/**
 * Resolve quando o corpo acabou (ou a conexão caiu): só então o 413 é escrito, porque
 * responder e fechar com corpo pendente faz o TCP mandar RST e o navegador nunca lê a resposta.
 */
const descartarCorpo = (req: IncomingMessage, jaRecebido = 0): Promise<void> =>
  new Promise((resolver) => {
    let total = jaRecebido;
    req.on('data', (parte: Buffer) => {
      total += parte.length;
      if (total > TETO_DE_DESCARTE_BYTES) {
        req.destroy();
        resolver();
      }
    });
    req.on('end', resolver);
    req.on('close', resolver);
    req.on('error', resolver);
    req.resume();
  });

export type FormularioDeIngestao = Readonly<{
  ticket: string | null;
  senha: string | null;
  arquivo: Readonly<{ nome: string; bytes: Buffer }> | null;
  /** O arquivo (ou o corpo) passou do limite; `arquivo` não é confiável. */
  excedeuLimite: boolean;
}>;

export class ErroDeFormulario extends Error {}

export const lerFormulario = (req: IncomingMessage): Promise<FormularioDeIngestao> =>
  new Promise((resolver, rejeitar) => {
    const tamanhoDeclarado = Number(req.headers['content-length'] ?? 0);
    if (tamanhoDeclarado > LIMITE_DO_CERTIFICADO_BYTES + MARGEM_DO_CORPO_BYTES) {
      void descartarCorpo(req).then(() =>
        resolver({ ticket: null, senha: null, arquivo: null, excedeuLimite: true }),
      );
      return;
    }

    let leitor: busboy.Busboy;
    try {
      leitor = busboy({
        headers: req.headers,
        defParamCharset: 'utf8',
        limits: {
          fileSize: LIMITE_DO_CERTIFICADO_BYTES + 1,
          files: 1,
          fields: 4,
          parts: 6,
          fieldSize: LIMITE_DE_CAMPO_BYTES,
        },
      });
    } catch {
      rejeitar(new ErroDeFormulario('content-type'));
      return;
    }

    const campos: Record<string, string> = {};
    let arquivo: { nome: string; bytes: Buffer } | null = null;
    let excedeuLimite = false;
    let recebido = 0;
    let encerrado = false;
    let cortado = false;

    const encerrar = (resultado: FormularioDeIngestao): void => {
      if (encerrado) return;
      encerrado = true;
      req.unpipe(leitor);
      resolver(resultado);
    };

    req.on('data', (parte: Buffer) => {
      recebido += parte.length;
      if (!cortado && recebido > LIMITE_DO_CERTIFICADO_BYTES + MARGEM_DO_CORPO_BYTES) {
        // O ticket vem antes do arquivo no formulário: já dá para auditar a recusa.
        cortado = true;
        const ticket = campos['ticket'] ?? null;
        void descartarCorpo(req, recebido).then(() =>
          encerrar({ ticket, senha: null, arquivo: null, excedeuLimite: true }),
        );
      }
    });

    leitor.on('field', (nome, valor, info) => {
      if (info.valueTruncated) rejeitar(new ErroDeFormulario('campo'));
      else campos[nome] = valor;
    });

    leitor.on('file', (nome, fluxo, info) => {
      if (nome !== 'arquivo') {
        fluxo.resume();
        return;
      }
      const partes: Buffer[] = [];
      fluxo.on('data', (parte: Buffer) => partes.push(parte));
      fluxo.on('limit', () => {
        excedeuLimite = true;
      });
      fluxo.on('end', () => {
        arquivo = { nome: info.filename, bytes: Buffer.concat(partes) };
        partes.length = 0;
      });
    });

    leitor.on('error', () => rejeitar(new ErroDeFormulario('multipart')));
    leitor.on('close', () =>
      encerrar({
        ticket: campos['ticket'] ?? null,
        senha: campos['senha'] ?? null,
        arquivo: excedeuLimite ? null : arquivo,
        excedeuLimite,
      }),
    );

    req.pipe(leitor);
  });
