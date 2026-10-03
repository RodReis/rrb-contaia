/**
 * Leitura do `multipart/form-data` da ingestão, toda em memória (SPEC-011 §6.2):
 * nada de arquivo temporário. O limite de 10 MB é imposto por `busboy`
 * (`limits.fileSize`) e por um contador de bytes da requisição inteira, de modo
 * que um corpo gigante é cortado sem ser lido até o fim.
 *
 * O `ticket` TEM de ser a primeira parte: ele é conferido assim que chega (callback
 * `aoVerTicket`) e, se não for aceito, o resto do corpo é só descartado — o arquivo
 * nunca é acumulado em memória para quem não tem autorização.
 */
import type { IncomingMessage } from 'node:http';
import busboy from 'busboy';
import { LIMITE_DO_CERTIFICADO_BYTES } from '@contaia/shared';

/** Folga para cabeçalhos de parte, ticket e senha em volta do arquivo. */
const MARGEM_DO_CORPO_BYTES = 64 * 1024;
const LIMITE_DE_CAMPO_BYTES = 8 * 1024;
/**
 * Depois de recusar o corpo ele ainda é descartado (sem guardar nada) para o navegador
 * conseguir ler a resposta em vez de ver a conexão cair; passado este teto, a conexão é derrubada.
 */
const TETO_DE_DESCARTE_BYTES = 4 * LIMITE_DO_CERTIFICADO_BYTES;

/**
 * Resolve quando o corpo acabou (ou a conexão caiu): só então a resposta é escrita, porque
 * responder e fechar com corpo pendente faz o TCP mandar RST e o navegador nunca lê a resposta.
 */
export const descartarCorpo = (req: IncomingMessage, jaRecebido = 0): Promise<void> =>
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

export const lerFormulario = (
  req: IncomingMessage,
  /** Recebe o ticket assim que ele chega; `false` interrompe a leitura (o corpo é descartado). */
  aoVerTicket: (ticket: string) => boolean,
): Promise<FormularioDeIngestao> =>
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
    let primeiraParte = true;

    const encerrar = (resultado: FormularioDeIngestao): void => {
      if (encerrado) return;
      encerrado = true;
      req.unpipe(leitor);
      resolver(resultado);
    };

    /** Para de acumular: o busboy larga o fluxo e o resto do corpo é só descartado. */
    const interromper = (resultado: FormularioDeIngestao): void => {
      if (cortado) return;
      cortado = true;
      req.unpipe(leitor);
      void descartarCorpo(req, recebido).then(() => encerrar(resultado));
    };

    req.on('data', (parte: Buffer) => {
      recebido += parte.length;
      if (!cortado && recebido > LIMITE_DO_CERTIFICADO_BYTES + MARGEM_DO_CORPO_BYTES) {
        interromper({ ticket: campos['ticket'] ?? null, senha: null, arquivo: null, excedeuLimite: true });
      }
    });

    /** `true` se a parte pode seguir; `false` se a ingestão foi interrompida por ticket ausente/recusado. */
    const conferirOrdem = (nome: string, valor: string | null): boolean => {
      if (!primeiraParte) return true;
      primeiraParte = false;
      if (nome === 'ticket' && valor !== null && aoVerTicket(valor)) return true;
      interromper({ ticket: nome === 'ticket' ? valor : null, senha: null, arquivo: null, excedeuLimite: false });
      return false;
    };

    leitor.on('field', (nome, valor, info) => {
      if (cortado) return;
      if (info.valueTruncated) {
        if (conferirOrdem(nome, null)) rejeitar(new ErroDeFormulario('campo'));
        return;
      }
      if (conferirOrdem(nome, valor)) campos[nome] = valor;
    });

    leitor.on('file', (nome, fluxo, info) => {
      if (cortado || !conferirOrdem(nome, null) || nome !== 'arquivo') {
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

    leitor.on('error', () => {
      if (!cortado) rejeitar(new ErroDeFormulario('multipart'));
    });
    leitor.on('close', () => {
      if (cortado) return;
      encerrar({
        ticket: campos['ticket'] ?? null,
        senha: campos['senha'] ?? null,
        arquivo: excedeuLimite ? null : arquivo,
        excedeuLimite,
      });
    });

    req.pipe(leitor);
  });
