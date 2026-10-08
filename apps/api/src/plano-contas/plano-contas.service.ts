/**
 * Casos de uso da importação do plano de contas por CSV (SPEC-013 §3.2–§3.10, §6.1–§6.4).
 *
 * O caso de uso controla a transação; o domínio valida; o repositório persiste. Três regras
 * atravessam o arquivo:
 *
 * 1. **Arquivo recusado não deixa rastro** (§3.2): tamanho, formato, cabeçalho e mapeamento são
 *    conferidos ANTES de qualquer storage, tentativa ou job.
 * 2. **A confirmação é uma transação só** (§3.6): confirmar → aplicar → eventos → finalizar →
 *    pendência → notificação. Qualquer falha reverte tudo — inclusive a mudança de estado —, então
 *    a tentativa volta a `AGUARDANDO_CONFIRMACAO` e "nenhuma conta foi alterada" é verdade.
 * 3. **Nada do conteúdo vai para log**: só ids, `correlationId` e o código técnico da falha.
 */
import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  CAMPOS_DO_CONTRATO,
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  gerarRelatorioCsv,
  validarMapeamento,
  type CampoDoContrato,
  type Mapeamento,
} from '@contaia/domain';
import {
  aplicarLinhasNoPlano,
  buscarTentativaDeImportacao,
  cancelarImportacao,
  comContextoHumano,
  confirmarImportacao,
  criarNotificacaoDeImportacao,
  criarTentativaDeImportacao,
  finalizarImportacao,
  listarHistoricoDeImportacoes,
  listarLinhasParaRelatorio,
  listarPlanoDeContas,
  listarRejeicoesDaImportacao,
  registrarEventoDeImportacao,
  type NovoEventoDeImportacao,
  type ResultadoDaAplicacao,
  type TentativaDeImportacao,
  type TotaisDaImportacao,
} from '@contaia/db';
import {
  conteudoConfereComOTipo,
  lerCsv,
  mensagemDaFalha,
  validarArquivo,
  type HistoricoDeImportacoes,
  type PaginaDeRejeicoesDaImportacao,
  type PaginaDoPlanoDeContas,
  type PreviaDaImportacao,
} from '@contaia/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { PoolDoBanco } from '../banco/pool.provider';
import { StorageService } from '../comum/storage.service';
import { reconciliarPendenciaDoPlano } from './pendencia-do-plano';
import {
  paraPaginaDeRejeicoes,
  paraPaginaDoPlano,
  paraPrevia,
  relatorioDisponivel,
  temResultadoDaValidacao,
} from './plano-contas.apresentacao';
import { FILA_DE_VALIDACAO_DO_PLANO, type FilaDeValidacaoDoPlano } from './plano-contas.fila';

/** Tenant e autor da sessão; `correlationId` da requisição. Nunca vêm do corpo. */
export type ContextoDaImportacao = Readonly<{ tenantId: string; usuarioId: string; correlationId: string }>;

export type ArquivoDoPlano = Readonly<{ buffer: Buffer; nome: string; mimetype: string }>;

/** Mapeamento como chegou (campos podem faltar): a ausência vira `MAPEAMENTO_INCOMPLETO`. */
export type MapeamentoInformado = Readonly<{ [Campo in CampoDoContrato]?: string | undefined }>;

export type RelatorioDaImportacao = Readonly<{ nomeDoArquivo: string; conteudo: Readable }>;

export type OriginalDaImportacao = Readonly<{ nome: string; conteudo: Buffer }>;

const TIPO_DO_ARQUIVO = 'IMPORTACAO_PLANO_CONTAS' as const;
const TIPO_DO_ORIGINAL = 'text/csv';
/** Amostra da prévia e páginas de rejeição (SPEC-013 §3.5). */
export const ITENS_POR_PAGINA_DE_REJEICOES = 20;
export const ITENS_POR_PAGINA_DO_PLANO = 50;
const LIMITE_DO_NOME_DO_ARQUIVO = 255;

/** Chave endereçada por conteúdo: reenviar os mesmos bytes não deixa original órfão. */
export const chaveDoOriginal = (tenantId: string, empresaId: string, hash: string): string =>
  `${tenantId}/${empresaId}/plano-contas/${hash}.csv`;

const sha256 = (conteudo: Buffer): string => createHash('sha256').update(conteudo).digest('hex');

const naoEncontrada = (): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA, 'Tentativa de importação não encontrada.');

const falhaTecnica = (mensagem: string): ErroDeDominio => new ErroDeDominio(CODIGOS_DE_ERRO.FALHA_TECNICA, mensagem);

/** Só o tipo e o código técnico: a mensagem de um erro do banco pode carregar valores da linha. */
const descreverFalha = (erro: unknown): string => {
  if (!(erro instanceof Error)) {
    return 'desconhecida';
  }

  const codigo = (erro as Error & { code?: unknown }).code;

  return typeof codigo === 'string' ? `${erro.name} ${codigo}` : erro.name;
};

const recusarArquivo = (arquivo: ArquivoDoPlano): void => {
  const falha = validarArquivo(TIPO_DO_ARQUIVO, {
    tipoConteudo: arquivo.mimetype,
    tamanhoBytes: arquivo.buffer.byteLength,
  });

  if (falha === 'TAMANHO_EXCEDIDO') {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE, mensagemDaFalha(TIPO_DO_ARQUIVO, falha));
  }

  if (falha === 'ARQUIVO_VAZIO') {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_VAZIO, 'O arquivo está vazio.');
  }

  const campos = [{ campo: 'arquivo', codigo: CODIGOS_DE_ERRO.ARQUIVO_INVALIDO }] as const;

  if (falha !== null) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, mensagemDaFalha(TIPO_DO_ARQUIVO, falha), campos);
  }

  // O `Content-Type` do multipart é declarado por quem envia: os bytes precisam parecer texto.
  if (!conteudoConfereComOTipo(arquivo.mimetype, arquivo.buffer.subarray(0, 16))) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,
      mensagemDaFalha(TIPO_DO_ARQUIVO, 'CONTEUDO_NAO_CONFERE'),
      campos,
    );
  }
};

/** Os cinco campos do contrato, aparados: a identidade idempotente não depende de espaço. */
const normalizarMapeamento = (informado: MapeamentoInformado): Mapeamento =>
  Object.fromEntries(CAMPOS_DO_CONTRATO.map((campo) => [campo, (informado[campo] ?? '').trim()])) as Mapeamento;

const exigirMapeamentoCompleto = (cabecalho: readonly string[], mapeamento: Mapeamento): void => {
  const pendencias = validarMapeamento(cabecalho, mapeamento);

  if (pendencias.length > 0) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO,
      'Associe uma coluna do arquivo, sem repetir, a cada campo obrigatório.',
      pendencias.map((pendencia) => ({ campo: pendencia.campo, codigo: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO })),
      { pendencias },
    );
  }
};

const nomeDoArquivo = (nome: string): string => nome.trim().slice(0, LIMITE_DO_NOME_DO_ARQUIVO) || 'plano-de-contas.csv';

/** Rejeitadas da validação mais as válidas que acharam conta arquivada na aplicação (não tocadas). */
const totaisFinais = (validacao: TotaisDaImportacao | null, aplicacao: ResultadoDaAplicacao): TotaisDaImportacao => ({
  lidas: validacao?.lidas ?? 0,
  novas: aplicacao.incluidas,
  atualizadas: aplicacao.atualizadas,
  rejeitadas: (validacao?.rejeitadas ?? 0) + aplicacao.ignoradas.length,
});

@Injectable()
export class PlanoContasService {
  private readonly logger = new Logger(PlanoContasService.name);

  constructor(
    private readonly pool: PoolDoBanco,
    private readonly storage: StorageService,
    @Inject(FILA_DE_VALIDACAO_DO_PLANO) private readonly fila: FilaDeValidacaoDoPlano,
  ) {}

  /** Único ponto que lê o relógio (I-11): os testes o substituem. */
  protected agora(): Date {
    return new Date();
  }

  // -- Envio ------------------------------------------------------------------------------------

  async enviar(
    contexto: ContextoDaImportacao,
    empresaId: string,
    arquivo: ArquivoDoPlano,
    informado: MapeamentoInformado,
  ): Promise<PreviaDaImportacao> {
    recusarArquivo(arquivo);
    const lido = lerCsv(arquivo.buffer);
    const mapeamento = normalizarMapeamento(informado);
    exigirMapeamentoCompleto(lido.cabecalho, mapeamento);

    const hash = sha256(arquivo.buffer);
    const chave = chaveDoOriginal(contexto.tenantId, empresaId, hash);

    try {
      await this.storage.enviarComChave(chave, arquivo.buffer, TIPO_DO_ORIGINAL);
    } catch (erro) {
      this.logger.error(`falha ao guardar o original do plano [${contexto.correlationId}]: ${descreverFalha(erro)}`);
      throw falhaTecnica('Não foi possível guardar o arquivo agora. Nenhuma conta foi alterada; envie de novo.');
    }

    const agora = this.agora();
    const { tentativa, previa } = await comContextoHumano(this.pool.instancia, contexto, async (cliente) => {
      const criada = await criarTentativaDeImportacao(cliente, {
        tenantId: contexto.tenantId,
        empresaId,
        hashArquivo: hash,
        mapeamento,
        arquivoNome: nomeDoArquivo(arquivo.nome),
        arquivoTamanho: arquivo.buffer.byteLength,
        arquivoChave: chave,
        usuarioIniciadorId: contexto.usuarioId,
        correlationId: contexto.correlationId,
        agora,
      });

      await registrarEventoDeImportacao(
        cliente,
        this.evento(contexto, criada, agora, {
          acao: criada.reutilizada ? 'REUTILIZACAO' : 'CRIACAO',
          estadoAnterior: criada.reutilizada ? criada.estado : null,
          estadoNovo: criada.estado,
          totais: criada.totais,
        }),
      );

      return { tentativa: criada, previa: await this.montarPrevia(cliente, criada) };
    });

    // Depois do commit, para o worker já encontrar a tentativa. Reuso de tentativa ainda RECEBIDA
    // (envio anterior sem fila) reenfileira; nos demais estados o job já rodou ou está rodando.
    if (tentativa.estado === 'RECEBIDA') {
      await this.enfileirar(tentativa);
    }

    return previa;
  }

  private async enfileirar(tentativa: TentativaDeImportacao): Promise<void> {
    try {
      await this.fila.enfileirar({
        tenantId: tentativa.tenantId,
        empresaId: tentativa.empresaId,
        tentativaId: tentativa.id,
        correlationId: tentativa.correlationId,
      });
    } catch (erro) {
      this.logger.warn(
        `validação da tentativa ${tentativa.id} não enfileirada [${tentativa.correlationId}]: ${descreverFalha(erro)}`,
      );
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.FILA_INDISPONIVEL,
        'O arquivo foi recebido, mas a validação não pôde ser agendada. Envie o mesmo arquivo de novo em instantes.',
        [],
        { tentativaId: tentativa.id },
      );
    }
  }

  // -- Confirmação e cancelamento --------------------------------------------------------------

  async confirmar(
    contexto: ContextoDaImportacao,
    empresaId: string,
    tentativaId: string,
    versaoDaPrevia: number,
  ): Promise<PreviaDaImportacao> {
    const agora = this.agora();

    try {
      return await comContextoHumano(this.pool.instancia, contexto, async (cliente) => {
        const confirmada = await confirmarImportacao(cliente, {
          empresaId,
          tentativaId,
          usuarioId: contexto.usuarioId,
          versaoDaPrevia,
        });
        await registrarEventoDeImportacao(
          cliente,
          this.evento(contexto, confirmada, agora, {
            acao: 'CONFIRMAR',
            estadoAnterior: 'AGUARDANDO_CONFIRMACAO',
            estadoNovo: 'APLICANDO',
            totais: null,
          }),
        );

        const totais = totaisFinais(confirmada.totais, await aplicarLinhasNoPlano(cliente, empresaId, tentativaId, agora));
        const estadoFinal = totais.rejeitadas > 0 ? 'CONCLUIDA_COM_REJEICOES' : 'CONCLUIDA';

        await registrarEventoDeImportacao(
          cliente,
          this.evento(contexto, confirmada, agora, {
            acao: estadoFinal === 'CONCLUIDA' ? 'APLICACAO_SUCESSO' : 'APLICACAO_SUCESSO_COM_REJEICOES',
            estadoAnterior: 'APLICANDO',
            estadoNovo: estadoFinal,
            totais,
          }),
        );
        await finalizarImportacao(cliente, empresaId, tentativaId, estadoFinal, totais, agora);
        await reconciliarPendenciaDoPlano(cliente, {
          tenantId: contexto.tenantId,
          empresaId,
          usuarioId: contexto.usuarioId,
          agora,
        });
        // Só se chega aqui quando ESTA chamada transicionou: a repetida parou no `confirmar`.
        await criarNotificacaoDeImportacao(cliente, { empresaId, tentativaId, agora });

        return this.montarPrevia(cliente, await this.exigirTentativa(cliente, empresaId, tentativaId));
      });
    } catch (erro) {
      if (erro instanceof ErroDeDominio) {
        throw erro;
      }

      this.logger.error(
        `falha técnica ao aplicar a tentativa ${tentativaId} [${contexto.correlationId}]: ${descreverFalha(erro)}`,
      );
      throw falhaTecnica('A importação não pôde ser aplicada por um problema técnico. Nenhuma conta foi alterada; confirme de novo.');
    }
  }

  async cancelar(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string): Promise<PreviaDaImportacao> {
    const agora = this.agora();

    return comContextoHumano(this.pool.instancia, contexto, async (cliente) => {
      const cancelada = await cancelarImportacao(cliente, {
        empresaId,
        tentativaId,
        usuarioId: contexto.usuarioId,
        agora,
      });
      await registrarEventoDeImportacao(
        cliente,
        this.evento(contexto, cancelada, agora, {
          acao: 'CANCELAR',
          estadoAnterior: 'AGUARDANDO_CONFIRMACAO',
          estadoNovo: 'CANCELADA',
          totais: cancelada.totais,
        }),
      );

      return this.montarPrevia(cliente, cancelada);
    });
  }

  // -- Consultas --------------------------------------------------------------------------------

  async previa(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string): Promise<PreviaDaImportacao> {
    return comContextoHumano(this.pool.instancia, contexto, async (cliente) =>
      this.montarPrevia(cliente, await this.exigirTentativa(cliente, empresaId, tentativaId)),
    );
  }

  async historico(contexto: ContextoDaImportacao, empresaId: string, pagina: number): Promise<HistoricoDeImportacoes> {
    return comContextoHumano(this.pool.instancia, contexto, (cliente) =>
      listarHistoricoDeImportacoes(cliente, empresaId, pagina),
    );
  }

  async rejeicoes(
    contexto: ContextoDaImportacao,
    empresaId: string,
    tentativaId: string,
    pagina: number,
  ): Promise<PaginaDeRejeicoesDaImportacao> {
    return comContextoHumano(this.pool.instancia, contexto, async (cliente) => {
      await this.exigirTentativa(cliente, empresaId, tentativaId);

      return paraPaginaDeRejeicoes(
        await listarRejeicoesDaImportacao(cliente, empresaId, tentativaId, pagina, ITENS_POR_PAGINA_DE_REJEICOES),
      );
    });
  }

  async plano(
    contexto: ContextoDaImportacao,
    empresaId: string,
    pagina: number,
    busca?: string,
  ): Promise<PaginaDoPlanoDeContas> {
    return comContextoHumano(this.pool.instancia, contexto, async (cliente) =>
      paraPaginaDoPlano(await listarPlanoDeContas(cliente, empresaId, pagina, ITENS_POR_PAGINA_DO_PLANO, busca)),
    );
  }

  async arquivoOriginal(
    contexto: ContextoDaImportacao,
    empresaId: string,
    tentativaId: string,
  ): Promise<OriginalDaImportacao> {
    const tentativa = await comContextoHumano(this.pool.instancia, contexto, (cliente) =>
      this.exigirTentativa(cliente, empresaId, tentativaId),
    );
    const { conteudo } = await this.storage.obter(tentativa.arquivoChave);

    return { nome: tentativa.arquivoNome, conteudo };
  }

  /**
   * Relatório CSV completo, gerado do staging sob demanda e entregue em fluxo. O cursor vive na
   * transação, que fica aberta enquanto o cliente lê: o fim do fluxo, um erro ou o cliente que
   * desiste (o `conteudo` destruído) encerram o cursor e devolvem a conexão ao pool. Tentativa
   * inexistente ou sem resultado falha ANTES de devolver o fluxo, para virar problem+json.
   */
  async relatorio(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string): Promise<RelatorioDaImportacao> {
    const conteudo = new PassThrough();
    let aberta = false;
    let abrir: (tentativa: TentativaDeImportacao) => void = () => undefined;
    let recusar: (erro: unknown) => void = () => undefined;
    const abertura = new Promise<TentativaDeImportacao>((resolver, rejeitar) => {
      abrir = resolver;
      recusar = rejeitar;
    });

    void comContextoHumano(this.pool.instancia, contexto, async (cliente) => {
      const tentativa = await this.exigirTentativa(cliente, empresaId, tentativaId);

      if (!relatorioDisponivel(tentativa.estado)) {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO,
          'O relatório fica disponível quando a validação terminar.',
        );
      }

      aberta = true;
      abrir(tentativa);
      await pipeline(
        Readable.from(gerarRelatorioCsv(listarLinhasParaRelatorio(cliente, empresaId, tentativaId))),
        conteudo,
      );
    }).catch((erro: unknown) => {
      recusar(erro);

      if (!aberta) {
        conteudo.destroy();

        return;
      }

      if ((erro as { code?: unknown }).code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        this.logger.warn(`relatório da tentativa ${tentativaId} interrompido [${contexto.correlationId}]: ${descreverFalha(erro)}`);
      }
    });

    const tentativa = await abertura;
    const base = tentativa.arquivoNome.replace(/\.csv$/iu, '');

    return { nomeDoArquivo: `relatorio-${base}.csv`, conteudo };
  }

  // -- Apoio ------------------------------------------------------------------------------------

  private async exigirTentativa(
    cliente: PoolClient,
    empresaId: string,
    tentativaId: string,
  ): Promise<TentativaDeImportacao> {
    const tentativa = await buscarTentativaDeImportacao(cliente, empresaId, tentativaId);

    if (tentativa === null) {
      throw naoEncontrada();
    }

    return tentativa;
  }

  private async montarPrevia(cliente: PoolClient, tentativa: TentativaDeImportacao): Promise<PreviaDaImportacao> {
    const amostra = temResultadoDaValidacao(tentativa.estado)
      ? (await listarRejeicoesDaImportacao(cliente, tentativa.empresaId, tentativa.id, 1, ITENS_POR_PAGINA_DE_REJEICOES)).itens
      : [];

    return paraPrevia(tentativa, amostra);
  }

  private evento(
    contexto: ContextoDaImportacao,
    tentativa: TentativaDeImportacao,
    agora: Date,
    dados: Pick<NovoEventoDeImportacao, 'acao' | 'estadoAnterior' | 'estadoNovo' | 'totais'>,
  ): NovoEventoDeImportacao {
    return {
      ...dados,
      empresaId: tentativa.empresaId,
      tentativaId: tentativa.id,
      usuarioId: contexto.usuarioId,
      codigo: null,
      correlationId: contexto.correlationId,
      agora,
    };
  }
}
