/**
 * Limite de tentativas para rotas públicas (aceite do convite): impede varrer
 * tokens e adivinhar senha por força bruta. Janela fixa, em memória do processo.
 *
 * ponytail: contagem em memória, por processo. Com mais de uma instância da API
 * o limite vira por instância; trocar por Redis (já no Compose) se escalar.
 */
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

export class LimitadorDeTentativas {
  private readonly janelas = new Map<string, { inicio: number; contagem: number }>();

  constructor(
    private readonly maximo: number,
    private readonly janelaMs: number,
  ) {}

  tentar(chave: string, agora: number): boolean {
    this.descartarVencidas(agora);

    const atual = this.janelas.get(chave);

    if (atual === undefined) {
      this.janelas.set(chave, { inicio: agora, contagem: 1 });

      return true;
    }

    if (atual.contagem >= this.maximo) {
      return false;
    }

    atual.contagem += 1;

    return true;
  }

  tamanho(): number {
    return this.janelas.size;
  }

  // O(n) por chamada, limitado pelos clientes distintos dentro de uma janela.
  private descartarVencidas(agora: number): void {
    for (const [chave, janela] of this.janelas) {
      if (agora - janela.inicio >= this.janelaMs) {
        this.janelas.delete(chave);
      }
    }
  }
}

/** Quem está atrás do proxy da web é identificado por X-Forwarded-For. */
const clienteDa = (requisicao: Request): string => {
  const encaminhado = requisicao.header('x-forwarded-for')?.split(',')[0]?.trim();

  return encaminhado !== undefined && encaminhado !== ''
    ? encaminhado
    : (requisicao.ip ?? 'desconhecido');
};

@Injectable()
export class GuardDeLimiteDeTentativas implements CanActivate {
  constructor(private readonly limitador: LimitadorDeTentativas) {}

  canActivate(contexto: ExecutionContext): boolean {
    const requisicao = contexto.switchToHttp().getRequest<Request>();
    // O padrão da rota (`/convites/:token`), não a URL: variar o token não zera a contagem.
    const rota = (requisicao.route as { path?: string } | undefined)?.path ?? requisicao.path;

    if (!this.limitador.tentar(`${rota}:${clienteDa(requisicao)}`, Date.now())) {
      throw new HttpException(
        'Muitas tentativas. Aguarde um instante e tente de novo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
