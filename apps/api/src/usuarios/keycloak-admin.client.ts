/**
 * Cliente da Admin API do Keycloak (SPEC-007 §3.4).
 *
 * O Keycloak guarda identidade, credencial e sessões; o PostgreSQL guarda
 * perfil, estado e papéis. Este cliente só fala com a identidade, autenticado
 * por uma service account (`client_credentials`) com permissão de gerir
 * usuários e nada além.
 *
 * Falha de rede, timeout ou 5xx viram `IDENTIDADE_INDISPONIVEL`: o caso de uso
 * desfaz a transação inteira em vez de deixar estado parcial. Senha e token
 * nunca entram em log.
 */
import { Injectable, Logger } from '@nestjs/common';

import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio, normalizarEmail } from '@contaia/domain';

const TIMEOUT_MS = 5_000;
/** Renova o token um pouco antes de vencer, para não usá-lo no limite. */
const FOLGA_DO_TOKEN_MS = 30_000;

/**
 * Onde ESTE processo alcança o Keycloak: em contêiner o endereço interno (`KEYCLOAK_INTERNAL_URL`),
 * que difere do público que o navegador e o `iss` dos tokens usam.
 */
const emissor = (): string =>
  process.env['KEYCLOAK_INTERNAL_URL'] ??
  process.env['KEYCLOAK_ISSUER_URL'] ??
  'http://127.0.0.1:18080/realms/contaia';

const baseAdmin = (): string => emissor().replace('/realms/', '/admin/realms/');

const indisponivel = (): ErroDeDominio =>
  new ErroDeDominio(
    CODIGOS_DE_ERRO.IDENTIDADE_INDISPONIVEL,
    'O serviço de identidade está indisponível. Tente novamente em instantes.',
  );

export type NovaIdentidade = Readonly<{ email: string; nome: string }>;

@Injectable()
export class KeycloakAdminClient {
  private readonly logger = new Logger(KeycloakAdminClient.name);
  private token: Readonly<{ valor: string; expiraEm: number }> | null = null;

  private async obterToken(): Promise<string> {
    if (this.token !== null && Date.now() < this.token.expiraEm - FOLGA_DO_TOKEN_MS) {
      return this.token.valor;
    }

    const clientId = process.env['KEYCLOAK_ADMIN_CLIENT_ID'] ?? 'contaia-api-admin';
    const segredo = process.env['KEYCLOAK_ADMIN_CLIENT_SECRET'];

    if (segredo === undefined || segredo === '') {
      this.logger.error('KEYCLOAK_ADMIN_CLIENT_SECRET não configurado.');

      throw indisponivel();
    }

    let resposta: Response;

    try {
      resposta = await fetch(`${emissor()}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: segredo,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      this.logger.warn('falha de rede ao obter o token de administração do Keycloak');

      throw indisponivel();
    }

    const corpo: unknown = resposta.ok ? await resposta.json().catch(() => null) : null;
    const dados = (corpo ?? {}) as { access_token?: unknown; expires_in?: unknown };

    if (typeof dados.access_token !== 'string' || typeof dados.expires_in !== 'number') {
      this.logger.warn(`Keycloak recusou o token de administração (HTTP ${resposta.status})`);

      throw indisponivel();
    }

    this.token = { valor: dados.access_token, expiraEm: Date.now() + dados.expires_in * 1000 };

    return this.token.valor;
  }

  /** Chamada autenticada. Nunca registra corpo, que pode conter senha. */
  private async chamar(metodo: string, caminho: string, corpo?: unknown): Promise<Response> {
    const token = await this.obterToken();
    let resposta: Response;

    try {
      resposta = await fetch(`${baseAdmin()}${caminho}`, {
        method: metodo,
        headers: {
          authorization: `Bearer ${token}`,
          ...(corpo === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      this.logger.warn(`falha de rede em ${metodo} ${caminho.replace(/\/users\/[^/]+/, '/users/:id')}`);

      throw indisponivel();
    }

    if (resposta.status === 401) {
      // Token revogado ou rotacionado: a próxima chamada pede outro.
      this.token = null;
    }

    return resposta;
  }

  private exigirSucesso(resposta: Response, operacao: string): void {
    if (!resposta.ok) {
      this.logger.warn(`Keycloak respondeu HTTP ${resposta.status} em ${operacao}`);

      throw indisponivel();
    }
  }

  /** Cria a identidade desabilitada: só passa a valer quando o convite é aceito. */
  async criar(identidade: NovaIdentidade): Promise<string> {
    const email = normalizarEmail(identidade.email);
    const [primeiroNome = identidade.nome, ...resto] = identidade.nome.trim().split(/\s+/);

    const resposta = await this.chamar('POST', '/users', {
      username: email,
      email,
      firstName: primeiroNome,
      // O perfil padrão do Keycloak exige sobrenome; nome de uma palavra só recebe um marcador.
      lastName: resto.length > 0 ? resto.join(' ') : '-',
      enabled: false,
      emailVerified: true,
    });

    if (resposta.status === 409) {
      throw new ErroDeConflito(
        CODIGOS_DE_ERRO.EMAIL_JA_UTILIZADO,
        'Este e-mail já está em uso.',
      );
    }

    this.exigirSucesso(resposta, 'criar usuário');

    const sub = resposta.headers.get('location')?.split('/').pop();

    if (sub === undefined || sub === '') {
      this.logger.warn('Keycloak criou o usuário sem informar o identificador');

      throw indisponivel();
    }

    return sub;
  }

  async definirSenhaEAtivar(sub: string, senha: string): Promise<void> {
    const resposta = await this.chamar('PUT', `/users/${sub}/reset-password`, {
      type: 'password',
      value: senha,
      temporary: false,
    });

    if (resposta.status === 400) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.SENHA_FRACA,
        'A senha não atende à política de segurança.',
      );
    }

    this.exigirSucesso(resposta, 'definir senha');

    await this.habilitar(sub, true);
  }

  async habilitar(sub: string, ligado: boolean): Promise<void> {
    this.exigirSucesso(
      await this.chamar('PUT', `/users/${sub}`, { enabled: ligado }),
      'alterar habilitação',
    );
  }

  async encerrarSessoes(sub: string): Promise<void> {
    this.exigirSucesso(await this.chamar('POST', `/users/${sub}/logout`), 'encerrar sessões');
  }

  async atualizarEmail(sub: string, email: string): Promise<void> {
    const normalizado = normalizarEmail(email);

    this.exigirSucesso(
      await this.chamar('PUT', `/users/${sub}`, { email: normalizado, username: normalizado }),
      'atualizar e-mail',
    );
  }

  /** Compensação de `criar`: idempotente, usuário já ausente não é erro. */
  async remover(sub: string): Promise<void> {
    const resposta = await this.chamar('DELETE', `/users/${sub}`);

    if (resposta.status === 404) {
      return;
    }

    this.exigirSucesso(resposta, 'remover usuário');
  }
}
