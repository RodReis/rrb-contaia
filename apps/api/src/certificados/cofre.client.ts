/**
 * Cliente do cofre (SPEC-011 §6.2): a API principal só pede ao cofre para inutilizar ou
 * restaurar a versão de um segredo — nunca lê, lista nem recebe conteúdo. Não existe
 * método de leitura aqui, de propósito. A autenticação é o Bearer de serviço
 * `COFRE_SERVICE_TOKEN`; o token do Vault jamais chega a este processo.
 *
 * Vault ou cofre fora do ar é erro estável (`COFRE_INDISPONIVEL`): sem fallback para banco,
 * disco ou log. Nem o corpo da resposta entra em mensagem de erro ou log.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { Injectable, Logger } from '@nestjs/common';

import { TAMANHO_MINIMO_DO_SEGREDO } from './ticket';

const TEMPO_LIMITE_MS = 5_000;

export type EscopoDoSegredo = Readonly<{ tenantId: string; empresaId: string }>;

export const configuracaoDoCofre = (): Readonly<{
  ticketSecret: string;
  serviceToken: string;
  cofreUrl: string;
  publicUrl: string;
}> => {
  const env = process.env;

  return {
    ticketSecret: env['COFRE_TICKET_SECRET'] ?? '',
    serviceToken: env['COFRE_SERVICE_TOKEN'] ?? '',
    cofreUrl: (env['COFRE_URL'] ?? '').replace(/\/+$/u, ''),
    publicUrl: (env['COFRE_PUBLIC_URL'] ?? '').replace(/\/+$/u, ''),
  };
};

const cofreIndisponivel = (): ErroDeDominio =>
  new ErroDeDominio(
    CODIGOS_DE_ERRO.COFRE_INDISPONIVEL,
    'O cofre está indisponível no momento. Nada foi alterado; tente novamente.',
  );

@Injectable()
export class CofreClient {
  private readonly logger = new Logger(CofreClient.name);

  /** Deixa a versão do segredo inutilizável (`delete` do KV v2): base da desativação. */
  inutilizar(referencia: string, escopo: EscopoDoSegredo, correlationId: string): Promise<void> {
    return this.chamar('inutilizar', referencia, escopo, correlationId);
  }

  /** Desfaz `inutilizar` (`undelete`): compensação quando a desativação não se concluiu. */
  restaurar(referencia: string, escopo: EscopoDoSegredo, correlationId: string): Promise<void> {
    return this.chamar('restaurar', referencia, escopo, correlationId);
  }

  private async chamar(
    acao: 'inutilizar' | 'restaurar',
    referencia: string,
    escopo: EscopoDoSegredo,
    correlationId: string,
  ): Promise<void> {
    const { cofreUrl, serviceToken } = configuracaoDoCofre();

    if (cofreUrl.length === 0 || serviceToken.length < TAMANHO_MINIMO_DO_SEGREDO) {
      this.logger.error(`cofre não configurado [${correlationId}]`);
      throw cofreIndisponivel();
    }

    try {
      const resposta = await fetch(
        `${cofreUrl}/segredos/${encodeURIComponent(referencia)}/${acao}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${serviceToken}`,
            'content-type': 'application/json',
            'x-correlation-id': correlationId,
          },
          body: JSON.stringify({ tenantId: escopo.tenantId, empresaId: escopo.empresaId }),
          signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        },
      );

      if (!resposta.ok) {
        this.logger.warn(`cofre recusou ${acao}: status ${resposta.status} [${correlationId}]`);
        throw cofreIndisponivel();
      }
    } catch (erro) {
      if (erro instanceof ErroDeDominio) {
        throw erro;
      }

      // Só o tipo da falha: a mensagem do fetch pode carregar a URL.
      this.logger.warn(
        `cofre inacessível em ${acao}: ${erro instanceof Error ? erro.name : 'erro'} [${correlationId}]`,
      );
      throw cofreIndisponivel();
    }
  }
}
