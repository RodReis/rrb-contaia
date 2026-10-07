/**
 * Casos de uso da API para o Signer (SPEC-012 §3.1, §3.9, §5). A API CONSULTA e DIAGNOSTICA: nada
 * aqui assina XML nem executa operação funcional — a alçada do Signer recusaria, e este serviço
 * sequer tem o método. Autorização por chave do catálogo no controller; a regra "admin ou contador"
 * do teste manual é conferida aqui, junto da chave (como no cofre, SPEC-011 §3.2).
 */
import {
  CODIGOS_DE_ERRO,
  ErroDeConflito,
  ErroDeDominio,
  FINALIDADES,
  dataCivilEmSaoPaulo,
  estadoDoServico,
  podeMutarCofre,
  type Finalidade,
} from '@contaia/domain';
import { comContextoHumano, estadoDoServicoParaPainel } from '@contaia/db';
import type {
  HistoricoPublicoDoSigner,
  ItemDoHistoricoDoSigner,
  ItemDoHistoricoPublico,
  PainelDoServicoSigner,
  RespostaDeEstados,
  ResultadoDoTesteManual,
} from '@contaia/shared';
import {
  ErroDoClienteDoSigner,
  enfileirarDiagnostico,
  type ClienteDoSigner,
  type FilaQueEnfileira,
} from '@contaia/signer-client';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { PoolDoBanco } from '../banco/pool.provider';
import type { SessaoDoCofre } from '../certificados/visoes';
import { CLIENTE_DO_SIGNER, FILA_DE_DIAGNOSTICO_DA_API } from './signer.tokens';

type ClienteDeConsulta = Pick<ClienteDoSigner, 'diagnosticar' | 'estados' | 'historico'>;

export type FiltroDoHistoricoDoSigner = Readonly<{
  pagina: number;
  finalidade?: Finalidade;
  resultado?: 'SUCESSO' | 'FALHA' | 'RECUSA';
}>;

const semAutorizacao = (): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Sem autorização para este recurso.');

const indisponivel = (): ErroDeDominio =>
  new ErroDeDominio(
    CODIGOS_DE_ERRO.SIGNER_INDISPONIVEL,
    'O Signer está indisponível. Tente novamente em instantes.',
  );

/** Cópia campo a campo: a referência do segredo (UUID opaco do Vault) nunca chega ao navegador. */
const paraPublico = (item: ItemDoHistoricoDoSigner): ItemDoHistoricoPublico => ({
  id: item.id,
  finalidade: item.finalidade,
  resultado: item.resultado,
  codigo: item.codigo,
  iniciadoEm: item.iniciadoEm,
  latenciaMs: item.latenciaMs,
  reutilizado: item.reutilizado,
  origemDiagnostico: item.origemDiagnostico,
  identidadeTecnica: item.identidadeTecnica,
  correlationId: item.correlationId,
});

@Injectable()
export class SignerService {
  private readonly logger = new Logger(SignerService.name);
  /** Empresas com teste manual em curso (por processo): o painel não dispara um segundo. */
  private readonly emAndamento = new Set<string>();

  constructor(
    private readonly pool: PoolDoBanco,
    @Inject(CLIENTE_DO_SIGNER) private readonly cliente: ClienteDeConsulta,
    @Inject(FILA_DE_DIAGNOSTICO_DA_API) private readonly fila: FilaQueEnfileira,
  ) {}

  /** Único ponto que lê o relógio (I-11): os testes o substituem. */
  protected agora(): Date {
    return new Date();
  }

  // -- Cartão geral -----------------------------------------------------------------------

  async painelDoServico(sessao: SessaoDoCofre, correlationId: string): Promise<PainelDoServicoSigner> {
    const bruto = await comContextoHumano(
      this.pool.instancia,
      { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
      (cliente) => estadoDoServicoParaPainel(cliente),
    );
    const { estado, desatualizado } = estadoDoServico({
      ultimaVerificacaoEm: bruto.ultimaVerificacaoEm,
      ultimoResultado: bruto.ultimoResultado,
      incidenteAberto: bruto.incidenteAberto,
      agora: this.agora(),
    });

    return {
      estado,
      desatualizado,
      ultimaVerificacaoEm: bruto.ultimaVerificacaoEm?.toISOString() ?? null,
      ultimaLatenciaMs: bruto.ultimaLatenciaMs,
      incidenteAberto: bruto.incidenteAberto,
    };
  }

  // -- Estado e histórico por empresa -----------------------------------------------------

  /**
   * Estados em lote. Cada empresa precisa estar na carteira de quem pergunta (a RLS devolve só as
   * dela): uma que não aparece recusa o lote inteiro, sem dizer se existe.
   */
  async estados(sessao: SessaoDoCofre, empresaIds: readonly string[], correlationId: string): Promise<RespostaDeEstados> {
    const distintas = [...new Set(empresaIds)];
    const visiveis = await comContextoHumano(
      this.pool.instancia,
      { tenantId: sessao.tenantId, usuarioId: sessao.usuarioId, correlationId },
      async (cliente) => {
        const { rows } = await cliente.query<{ id: string }>('select id from app.empresa where id = any($1::uuid[])', [distintas]);

        return rows.length;
      },
    );

    if (visiveis !== distintas.length) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.EMPRESA_FORA_DA_CARTEIRA,
        'Há empresa fora da sua carteira nesta consulta.',
      );
    }

    return this.chamar(() => this.cliente.estados({ tenantId: sessao.tenantId, empresaIds: distintas, correlationId }));
  }

  async historico(
    sessao: SessaoDoCofre,
    empresaId: string,
    filtro: FiltroDoHistoricoDoSigner,
    correlationId: string,
  ): Promise<HistoricoPublicoDoSigner> {
    const pagina = await this.chamar(() =>
      this.cliente.historico({
        tenantId: sessao.tenantId,
        empresaId,
        correlationId,
        pagina: filtro.pagina,
        ...(filtro.finalidade === undefined ? {} : { finalidade: filtro.finalidade }),
        ...(filtro.resultado === undefined ? {} : { resultado: filtro.resultado }),
      }),
    );

    return { ...pagina, itens: pagina.itens.map(paraPublico) };
  }

  // -- Teste manual -----------------------------------------------------------------------

  /**
   * Diagnóstico por pedido de uma pessoa (SPEC-012 §3.9): só admin do escritório ou contador (da
   * carteira, conferida antes pela guarda de empresa) e só com a chave `testar`. Uma finalidade que
   * falha NÃO é erro da chamada — é o resultado que a tela mostra; as duas são sempre relatadas.
   */
  async testarManual(
    sessao: SessaoDoCofre,
    empresaId: string,
    finalidade: Finalidade | undefined,
    correlationId: string,
  ): Promise<ResultadoDoTesteManual[]> {
    if (!podeMutarCofre(sessao.papeis) || !sessao.permissoes.includes('certificados.signer.testar')) {
      throw semAutorizacao();
    }

    const chave = `${sessao.tenantId}:${empresaId}`;

    if (this.emAndamento.has(chave)) {
      throw new ErroDeConflito(
        CODIGOS_DE_ERRO.SIGNER_TESTE_EM_ANDAMENTO,
        'Já há um teste do Signer em andamento para esta empresa.',
      );
    }

    this.emAndamento.add(chave);

    try {
      const alvos: readonly Finalidade[] = finalidade === undefined ? FINALIDADES : [finalidade];

      return await Promise.all(alvos.map((alvo) => this.diagnosticarUma(sessao, empresaId, alvo, correlationId)));
    } finally {
      this.emAndamento.delete(chave);
    }
  }

  private async diagnosticarUma(
    sessao: SessaoDoCofre,
    empresaId: string,
    finalidade: Finalidade,
    correlationId: string,
  ): Promise<ResultadoDoTesteManual> {
    try {
      await this.cliente.diagnosticar({
        tenantId: sessao.tenantId,
        empresaId,
        finalidade,
        correlationId,
        origem: 'MANUAL',
        usuarioOriginadorId: sessao.usuarioId,
      });

      return { finalidade, resultado: 'SUCESSO', codigo: null, correlationId };
    } catch (erro) {
      const codigo = erro instanceof ErroDoClienteDoSigner ? erro.codigo : 'SIGNER_INDISPONIVEL';

      this.logger.warn(`teste manual falhou (${finalidade}): ${codigo} [${correlationId}]`);

      return { finalidade, resultado: 'FALHA', codigo, correlationId };
    }
  }

  // -- Diagnóstico depois do cadastro/substituição (gancho da F11) ------------------------

  /**
   * DF-e e eSocial entram na fila como trabalhos separados, autor técnico `sistema` (sem usuário).
   * Falhar aqui NUNCA desfaz a ativação do certificado: o A1 já está vigente; o estado fica
   * "não testado" até o próximo diagnóstico.
   */
  async agendarDiagnosticosPosCadastro(tenantId: string, empresaId: string, correlationId: string): Promise<void> {
    const resultados = await Promise.allSettled(
      FINALIDADES.map((finalidade) =>
        enfileirarDiagnostico(this.fila, { tenantId, empresaId, finalidade, correlationId, origem: 'AUTOMATICO' }),
      ),
    );

    for (const resultado of resultados) {
      if (resultado.status === 'rejected') {
        this.logger.warn(`diagnóstico pós-cadastro não enfileirado [${correlationId}]`);
      }
    }
  }

  /** Falha de transporte, contexto ou serviço vira 503 acionável; o motivo vai só para o log. */
  private async chamar<T>(chamada: () => Promise<T>): Promise<T> {
    try {
      return await chamada();
    } catch (erro) {
      this.logger.warn(`Signer recusou ou não respondeu: ${erro instanceof ErroDoClienteDoSigner ? erro.codigo : 'erro desconhecido'}`);

      throw indisponivel();
    }
  }
}

/** Para o controller: hoje em data civil, sem expor o relógio. */
export const hojeCivil = (agora: Date): string => dataCivilEmSaoPaulo(agora);
