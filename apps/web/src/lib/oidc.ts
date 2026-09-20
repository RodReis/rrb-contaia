/**
 * Fluxo OIDC com o Keycloak (ADR-011).
 *
 * Authorization Code com PKCE. O token fica em cookie `httpOnly`, nunca em
 * `localStorage` (ARCHITECTURE.md §6) — o cliente não lê credencial.
 */
import { createHash, randomBytes } from 'node:crypto';

export const COOKIE_DE_SESSAO = 'contaia_sessao';
/**
 * `id_token` da sessão. Serve só para o logout: sem `id_token_hint` o Keycloak
 * 26 exibe uma tela de confirmação e, se ela não for respondida, a sessão do
 * provedor continua aberta — o "sair" não sairia de fato.
 */
export const COOKIE_DE_ID_TOKEN = 'contaia_id_token';
export const COOKIE_DE_VERIFICADOR = 'contaia_pkce';
export const COOKIE_DE_RETORNO = 'contaia_retorno';

const base64url = (dados: Buffer): string =>
  dados.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const emissor = (): string =>
  process.env['KEYCLOAK_ISSUER_URL'] ?? 'http://127.0.0.1:18080/realms/contaia';

export const clienteId = (): string => process.env['KEYCLOAK_CLIENT_ID'] ?? 'contaia-web';

const clienteSegredo = (): string =>
  process.env['KEYCLOAK_CLIENT_SECRET'] ?? 'contaia-web-local-secret';

/**
 * Origem canônica da aplicação.
 *
 * Não se deriva do request: `nextUrl.origin` resolve pelo host interno do
 * servidor e pode devolver `localhost` quando o usuário entrou por
 * `127.0.0.1`. São origens distintas para cookie, então o redirect levaria o
 * navegador para fora do domínio onde a sessão foi gravada.
 */
export const origemDaAplicacao = (): string =>
  process.env['WEB_ORIGIN'] ?? 'http://127.0.0.1:15100';

export const urlDeRetorno = (): string => `${origemDaAplicacao()}/api/auth/retorno`;

export const gerarVerificador = (): string => base64url(randomBytes(32));

/**
 * Opções do cookie de sessão.
 *
 * `Secure` acompanha o protocolo real da origem, não o modo de build: o
 * ambiente local roda o build de produção em HTTP simples (ADR-012) e um
 * cookie `Secure` ali é descartado pelo navegador — a sessão nunca se forma.
 */
export const opcoesDeCookie = (
  maxAge: number,
): Readonly<{
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
}> => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: (process.env['WEB_ORIGIN'] ?? '').startsWith('https://'),
  path: '/',
  maxAge,
});

export const desafioDe = (verificador: string): string =>
  base64url(createHash('sha256').update(verificador).digest());

export const urlDeAutorizacao = (verificador: string, estado: string): string => {
  const parametros = new URLSearchParams({
    client_id: clienteId(),
    redirect_uri: urlDeRetorno(),
    response_type: 'code',
    scope: 'openid profile email',
    code_challenge: desafioDe(verificador),
    code_challenge_method: 'S256',
    state: estado,
  });

  return `${emissor()}/protocol/openid-connect/auth?${parametros.toString()}`;
};

export type TokensDaSessao = Readonly<{
  accessToken: string;
  idToken: string | null;
  expiraEm: number;
}>;

export const trocarCodigoPorToken = async (
  codigo: string,
  verificador: string,
): Promise<TokensDaSessao> => {
  const resposta = await fetch(`${emissor()}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clienteId(),
      client_secret: clienteSegredo(),
      code: codigo,
      redirect_uri: urlDeRetorno(),
      code_verifier: verificador,
    }),
  });

  if (!resposta.ok) {
    throw new Error(`troca de código recusada pelo provedor (${resposta.status})`);
  }

  const corpo: unknown = await resposta.json();
  const token = (corpo as { access_token?: unknown }).access_token;
  const idToken = (corpo as { id_token?: unknown }).id_token;
  const expira = (corpo as { expires_in?: unknown }).expires_in;

  if (typeof token !== 'string') {
    throw new Error('resposta do provedor sem access_token');
  }

  return {
    accessToken: token,
    idToken: typeof idToken === 'string' ? idToken : null,
    expiraEm: typeof expira === 'number' ? expira : 300,
  };
};

export const urlDeSaida = (idToken: string | null): string => {
  const parametros = new URLSearchParams({
    client_id: clienteId(),
    post_logout_redirect_uri: `${origemDaAplicacao()}/acesso`,
  });

  if (idToken !== null) {
    parametros.set('id_token_hint', idToken);
  }

  return `${emissor()}/protocol/openid-connect/logout?${parametros.toString()}`;
};
