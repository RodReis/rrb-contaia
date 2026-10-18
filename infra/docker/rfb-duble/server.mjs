import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const porChave = new Map();
const rotas = new Map([
  ['/v1/cnpj/status', 'CNPJ_STATUS'],
  ['/v1/certidao/consultar', 'CERTIDAO_CONSULTADA'],
  ['/v1/certidao/emitir', 'CERTIDAO_EMITIDA'],
]);

const server = createServer(async (req, res) => {
  const code = rotas.get(req.url ?? '');
  if (req.method !== 'POST' || code === undefined) {
    res
      .writeHead(404, { 'content-type': 'application/json' })
      .end('{"code":"NAO_ENCONTRADO","summary":{}}');
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    res
      .writeHead(400, { 'content-type': 'application/json' })
      .end('{"code":"REQUISICAO_INVALIDA","summary":{}}');
    return;
  }
  if (
    typeof body.cnpj !== 'string' ||
    !/^[0-9A-Z]{14}$/.test(body.cnpj) ||
    !req.headers['idempotency-key']
  ) {
    res
      .writeHead(422, { 'content-type': 'application/json' })
      .end('{"code":"REQUISICAO_INVALIDA","summary":{}}');
    return;
  }
  const key = `${req.url}:${body.cnpj}:${String(req.headers['idempotency-key'])}`;
  let out = porChave.get(key);
  if (!out) {
    out = {
      code: 'OK',
      summary: {
        operacao: code,
        cnpj: body.cnpj,
        numero:
          code === 'CERTIDAO_EMITIDA'
            ? `DUBLE-${createHash('sha256').update(key).digest('hex').slice(0, 12).toUpperCase()}`
            : null,
      },
    };
    porChave.set(key, out);
  }
  res
    .writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    })
    .end(JSON.stringify(out));
});

server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
