/**
 * Aceite público do convite (SPEC-007 §3.2).
 *
 * Quem chega aqui só tem um link: não há sessão nem tenant. O token é validado
 * pela forma antes de qualquer consulta, resolvido pelo hash numa função
 * estreita do banco, e todo motivo de recusa — inexistente, usado, invalidado,
 * vencido, usuário fora de CONVIDADO — responde igual (`CONVITE_INVALIDO`), para
 * o link não virar oráculo.
 *
 * Aceitar define a senha no Keycloak e ativa o usuário numa transação que
 * também consome o convite: se qualquer passo falha, nada fica consumido e o
 * mesmo link continua valendo.
 */
import { Injectable, Logger } from '@nestjs/common';

import {
  atualizarEstadoDoUsuario,
  carregarUsuario,
  comContextoDeTenant,
  consumirConvite,
  reconciliarConvitesExpirados,
  registrarEventoDeUsuario,
  resolverConvite,
  semContexto,
} from '@contaia/db';
import type { ConviteResolvido } from '@contaia/db';
import { CODIGOS_DE_ERRO, ErroDeDominio, conviteVigente, transicionar } from '@contaia/domain';

import { PoolDoBanco } from '../banco/pool.provider';
import { KeycloakAdminClient } from './keycloak-admin.client';
import { TOKEN_DE_CONVITE, hashDoToken } from './token-de-convite';

export type VisaoDoConvite = Readonly<{
  nome: string;
  emailMascarado: string;
  expiraEm: string;
}>;

const conviteInvalido = (): ErroDeDominio =>
  new ErroDeDominio(
    CODIGOS_DE_ERRO.CONVITE_INVALIDO,
    'Este convite não é válido. Peça um novo link ao administrador do escritório.',
  );

/** `a***@dominio.com`: confirma ao convidado que é o convite dele sem expor o endereço inteiro. */
export const mascararEmail = (email: string): string => {
  const arroba = email.indexOf('@');

  return arroba <= 0 ? '***' : `${email.slice(0, 1)}***${email.slice(arroba)}`;
};

@Injectable()
export class ConvitesService {
  private readonly logger = new Logger(ConvitesService.name);

  constructor(
    private readonly pool: PoolDoBanco,
    private readonly identidade: KeycloakAdminClient,
  ) {}

  async consultar(token: string): Promise<VisaoDoConvite> {
    const convite = await this.localizarVigente(token, new Date());

    return comContextoDeTenant(this.pool.instancia, convite.tenantId, async (cliente) => {
      const usuario = await carregarUsuario(cliente, convite.tenantId, convite.usuarioId);

      if (usuario === null) {
        throw conviteInvalido();
      }

      return {
        nome: usuario.nome,
        emailMascarado: mascararEmail(usuario.email),
        expiraEm: convite.expiraEm.toISOString(),
      };
    });
  }

  async aceitar(token: string, senha: string): Promise<void> {
    const convite = await this.localizarVigente(token, new Date());
    // Compensações do Keycloak já aplicado, caso o commit falhe depois.
    const compensacoes: Array<() => Promise<void>> = [];

    try {
      await comContextoDeTenant(this.pool.instancia, convite.tenantId, async (cliente) => {
        // Primeiro passo de propósito: sob duas aceitações simultâneas a segunda
        // espera aqui, encontra o convite já usado e sai antes de tocar no Keycloak.
        if (!(await consumirConvite(cliente, convite.tenantId, convite.conviteId))) {
          throw conviteInvalido();
        }

        const usuario = await carregarUsuario(cliente, convite.tenantId, convite.usuarioId);

        if (usuario === null) {
          throw conviteInvalido();
        }

        const novoEstado = transicionar(usuario.estado, 'ACEITAR');

        await this.identidade.definirSenhaEAtivar(usuario.subOidc, senha);
        compensacoes.push(() => this.identidade.habilitar(usuario.subOidc, false));

        await atualizarEstadoDoUsuario(cliente, convite.tenantId, usuario.id, novoEstado);
        await registrarEventoDeUsuario(cliente, convite.tenantId, {
          tipo: 'CONVITE_ACEITO',
          usuarioAfetadoId: usuario.id,
          autorId: usuario.id,
          antes: { estado: usuario.estado },
          depois: { estado: novoEstado },
        });
      });
    } catch (erro) {
      for (const compensar of compensacoes.reverse()) {
        try {
          await compensar();
        } catch {
          this.logger.error('falha ao compensar a identidade; conferir o usuário no Keycloak');
        }
      }

      throw erro;
    }
  }

  /** Resolve o link pelo hash e só devolve convite pendente, no prazo, de usuário CONVIDADO. */
  private async localizarVigente(token: string, agora: Date): Promise<ConviteResolvido> {
    if (!TOKEN_DE_CONVITE.test(token)) {
      throw conviteInvalido();
    }

    const convite = await semContexto(this.pool.instancia, (cliente) =>
      resolverConvite(cliente, hashDoToken(token)),
    );

    if (
      convite === null ||
      convite.usuarioEstado !== 'CONVIDADO' ||
      convite.usadoEm !== null ||
      convite.invalidadoEm !== null
    ) {
      throw conviteInvalido();
    }

    if (!conviteVigente(convite, agora)) {
      // Expiração é preguiçosa (sem worker): o evento nasce na primeira observação,
      // numa transação própria que se confirma mesmo com a recusa que vem a seguir.
      await comContextoDeTenant(this.pool.instancia, convite.tenantId, (cliente) =>
        reconciliarConvitesExpirados(cliente, convite.tenantId, agora),
      );

      throw conviteInvalido();
    }

    return convite;
  }
}
