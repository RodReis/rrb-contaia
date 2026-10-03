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

/** Teto de clientes distintos na memória: quem inventa um a cada tentativa não a enche. */
const MAXIMO_DE_CHAVES = 10_000;
/** A varredura de janelas vencidas custa O(n): roda no máximo uma vez por intervalo. */
const INTERVALO_DE_LIMPEZA_MS = 1_000;
/** Teto de uma rota somando todos os clientes: segura quem troca de cliente a cada tentativa. */
const TETO_GLOBAL_POR_ROTA = 300;

export class LimitadorDeTentativas {
  private readonly janelas = new Map<string, { inicio: number; contagem: number }>();
  private ultimaLimpeza = 0;

  constructor(
    private readonly maximo: number,
    private readonly janelaMs: number,
  ) {}

  tentar(chave: string, agora: number, maximo: number = this.maximo): boolean {
    this.descartarVencidas(agora);

    const atual = this.janelas.get(chave);

    // A varredura é espaçada: a janela desta chave pode ter vencido sem ter sido descartada.
    if (atual === undefined || agora - atual.inicio >= this.janelaMs) {
      if (atual === undefined) {
        this.abrirEspaco();
      }

      this.janelas.set(chave, { inicio: agora, contagem: 1 });

      return true;
    }

    if (atual.contagem >= maximo) {
      return false;
    }

    atual.contagem += 1;

    return true;
  }

  tamanho(): number {
    return this.janelas.size;
  }

  private descartarVencidas(agora: number): void {
    if (agora - this.ultimaLimpeza < INTERVALO_DE_LIMPEZA_MS) {
      return;
    }

    this.ultimaLimpeza = agora;

    for (const [chave, janela] of this.janelas) {
      if (agora - janela.inicio >= this.janelaMs) {
        this.janelas.delete(chave);
      }
    }
  }

  // O `Map` guarda a ordem de inserção: o primeiro é o mais antigo.
  private abrirEspaco(): void {
    while (this.janelas.size >= MAXIMO_DE_CHAVES) {
      const maisAntiga = this.janelas.keys().next();

      if (maisAntiga.done === true) {
        return;
      }

      this.janelas.delete(maisAntiga.value);
    }
  }
}

/**
 * Quem está do outro lado: a web fica na frente da API e escreve o cliente como
 * ÚLTIMA entrada de X-Forwarded-For. O início da lista vem do cliente e não vale.
 */
const clienteDa = (requisicao: Request): string => {
  const entradas = requisicao.header('x-forwarded-for')?.split(',') ?? [];
  const encaminhado = entradas[entradas.length - 1]?.trim();

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

    const agora = Date.now();
    const doCliente = this.limitador.tentar(`${rota}:${clienteDa(requisicao)}`, agora);

    if (!doCliente || !this.limitador.tentar(`${rota}:*`, agora, TETO_GLOBAL_POR_ROTA)) {
      throw new HttpException(
        'Muitas tentativas. Aguarde um instante e tente de novo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
