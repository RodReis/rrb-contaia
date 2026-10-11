/**
 * Orquestração comum das importações por arquivo (SPEC-013 §3.2–§3.11, §6.1–§6.4; SPEC-014 idem).
 *
 * O caso de uso controla a transação; o domínio valida; o repositório persiste. O que muda de um
 * domínio para outro (plano de contas, empregados) entra pela `EstrategiaDeImportacao`. Regras
 * que atravessam o arquivo:
 *
 * 1. **Arquivo recusado não deixa rastro**: tamanho, formato, cabeçalho e mapeamento são
 *    conferidos ANTES de qualquer storage, tentativa ou job.
 * 2. **A confirmação é uma transação só**: confirmar → aplicar → eventos → finalizar → pendência →
 *    notificação. Qualquer falha reverte tudo; numa 2ª transação curta a tentativa passa por
 *    APLICANDO e termina em `FALHA` (evento append-only com código estável). Só quando essa FALHA
 *    é registrada a resposta afirma que nada foi alterado.
 * 3. **Nada do conteúdo vai para log nem para a resposta**: só ids, `correlationId` e o tipo/código
 *    técnico da falha. O `detail` de um erro do PostgreSQL (23514 traz a linha com CPF e nome)
 *    nunca é lido.
 * 4. **Empresa arquivada ou em cadastro é somente consulta** (SPEC-003 §3.5): enviar, confirmar e
 *    cancelar recusam; prévia, histórico, relatório e arquivo continuam disponíveis.
 * 5. **Planilha (SPEC-015)**: XLSX/ODS são lidos em processo filho (`importacao/planilha.ts`) e
 *    revalidados por inteiro (formato, aba, cabeçalho, mapeamento por letra) antes do storage; a
 *    configuração (formato, aba, linha do cabeçalho) entra na identidade da tentativa.
 */
import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio } from '@contaia/domain';
import {
  carregarSituacaoDaEmpresa,
  comContextoHumano,
  type CancelamentoDaPrevia,
  type ConfirmacaoDaPrevia,
  type DiagnosticoDaTentativa,
  type EstadoFinalDaAplicacao,
  type MapeamentoDaImportacao,
  type NovaTentativa,
  type NovoEventoDeImportacao,
  type TotaisDaImportacao,
} from '@contaia/db';
import {
  lerCsv,
  tipoDeConteudoDoFormato,
  type FormatoDeArquivo,
  type HistoricoDeImportacoes,
  type InspecaoDePlanilha,
  type TipoDeArquivo,
} from '@contaia/shared';
import { Logger } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import type { StorageService } from '../comum/storage.service';
import { relatorioDisponivel, temDiagnostico, temResultadoDaValidacao, type TentativaApresentavel } from './apresentacao';
import type { FilaDeValidacao } from './fila';
import {
  LEITURA_DE_PLANILHAS_DO_PROCESSO,
  erroDePlanilha,
  exigirConfiguracao,
  formatoDoArquivo,
  inspecionarPlanilha,
  revalidarAba,
  traduzirErroDoLeitor,
  type CamposDePlanilhaInformados,
  type ConfiguracaoDaTentativa,
  type LeituraDePlanilhas,
} from './planilha';

/** Tenant e autor da sessão; `correlationId` da requisição. Nunca vêm do corpo. */
export type ContextoDaImportacao = Readonly<{ tenantId: string; usuarioId: string; correlationId: string }>;

/** `planilha`: `aba` e `linhaCabecalho` que vieram no multipart (o CSV os ignora). */
export type ArquivoEnviado = Readonly<{
  buffer: Buffer;
  nome: string;
  mimetype: string;
  planilha?: CamposDePlanilhaInformados;
}>;

export type RelatorioDaImportacao = Readonly<{ nomeDoArquivo: string; conteudo: Readable }>;

export type OriginalDaImportacao = Readonly<{ nome: string; conteudo: Buffer; formato: FormatoDeArquivo }>;

/** Amostra da prévia e páginas de rejeição. */
export const ITENS_POR_PAGINA_DE_REJEICOES = 20;
const LIMITE_DO_NOME_DO_ARQUIVO = 255;

/** Código estável do evento de falha técnica na aplicação (nunca a mensagem da exceção). */
export const CODIGO_DA_FALHA_NA_APLICACAO = 'FALHA_NA_APLICACAO';

/** Token opcional dos prazos do relatório (os testes encurtam; a API usa os padrões). */
export const PRAZOS_DO_RELATORIO = Symbol('PRAZOS_DO_RELATORIO');

export type PrazosDoRelatorio = Readonly<{ ociosidadeMs: number; totalMs: number }>;

/**
 * Enquanto o cliente não lê, o cursor espera a contrapressão do fluxo — e a sessão fica "idle in
 * transaction" segurando uma conexão do pool (10). Acima disto o próprio PostgreSQL encerra a
 * sessão; o erro da conexão destrói o fluxo e a conexão sai do pool.
 */
export const OCIOSIDADE_MAXIMA_DO_RELATORIO_MS = 30_000;
/** Teto do download inteiro, mesmo com um leitor que lê aos pinguinhos. */
export const PRAZO_TOTAL_DO_RELATORIO_MS = 5 * 60_000;

/** O mínimo que o orquestrador lê de uma tentativa, qualquer que seja o domínio. */
export type TentativaOrquestrada = TentativaApresentavel &
  Readonly<{ tenantId: string; empresaId: string; arquivoChave: string }>;

export type PaginaDe<Item> = Readonly<{ pagina: number; itensPorPagina: number; total: number; itens: readonly Item[] }>;

/** Persistência do ciclo de vida, com as assinaturas do repositório de cada domínio. */
export type RepositorioDaImportacao<Tentativa extends TentativaOrquestrada, Rejeicao> = Readonly<{
  criar(cliente: PoolClient, nova: NovaTentativa): Promise<Tentativa & Readonly<{ reutilizada: boolean }>>;
  buscar(cliente: PoolClient, empresaId: string, tentativaId: string): Promise<Tentativa | null>;
  confirmar(cliente: PoolClient, confirmacao: ConfirmacaoDaPrevia): Promise<Tentativa>;
  cancelar(cliente: PoolClient, cancelamento: CancelamentoDaPrevia): Promise<Tentativa>;
  registrarEvento(cliente: PoolClient, evento: NovoEventoDeImportacao): Promise<void>;
  registrarFalha(cliente: PoolClient, empresaId: string, tentativaId: string, agora: Date): Promise<unknown>;
  finalizar(
    cliente: PoolClient,
    empresaId: string,
    tentativaId: string,
    estadoFinal: EstadoFinalDaAplicacao,
    totais: TotaisDaImportacao,
    agora: Date,
  ): Promise<void>;
  listarRejeicoes(
    cliente: PoolClient,
    empresaId: string,
    tentativaId: string,
    pagina: number,
    porPagina: number,
  ): Promise<PaginaDe<Rejeicao>>;
  buscarDiagnostico(cliente: PoolClient, empresaId: string, tentativaId: string): Promise<DiagnosticoDaTentativa | null>;
  listarHistorico(cliente: PoolClient, empresaId: string, pagina: number): Promise<HistoricoDeImportacoes>;
}>;

export type ResultadoDaAplicacaoNaBase = Readonly<{
  incluidas: number;
  atualizadas: number;
  /** Linhas válidas que acharam o registro arquivado: a base mudou sob a prévia. */
  ignoradas: number;
}>;

export type EntradaDaPendencia = Readonly<{ tenantId: string; empresaId: string; usuarioId: string | null; agora: Date }>;

/** Textos PT-BR que dizem o que o domínio protege ("nenhuma conta", "nenhum empregado"). */
export type TextosDaImportacao = Readonly<{
  empresaArquivada: string;
  empresaNaoAtiva: string;
  storageIndisponivel: string;
  conflitoPorArquivado: string;
  falhaRegistrada: string;
}>;

export type EstrategiaDeImportacao<Tentativa extends TentativaOrquestrada, Rejeicao, Previa, PaginaDeRejeicoes> = Readonly<{
  /** Para o log: "plano de contas", "empregados". */
  rotulo: string;
  tipoDoArquivo: TipoDeArquivo;
  nomePadraoDoArquivo: string;
  /** Chave endereçada por conteúdo do original no storage; a extensão é a do formato (`csv`, `xlsx`, `ods`). */
  chaveDoOriginal(tenantId: string, empresaId: string, hash: string, extensao: string): string;
  /** Mapeamento canônico (identidade idempotente) ou `MAPEAMENTO_INCOMPLETO`. */
  validarMapeamento(informado: unknown, cabecalho: readonly string[]): MapeamentoDaImportacao;
  repositorio: RepositorioDaImportacao<Tentativa, Rejeicao>;
  /** Aplica as linhas válidas na transação do chamador (depois de `confirmar`). */
  aplicar(cliente: PoolClient, empresaId: string, tentativaId: string, agora: Date): Promise<ResultadoDaAplicacaoNaBase>;
  reconciliarPendencia(cliente: PoolClient, entrada: EntradaDaPendencia): Promise<void>;
  /** Avisos do sino (idempotentes); quem recebe é decisão do domínio. */
  notificar(cliente: PoolClient, tentativa: Tentativa, agora: Date): Promise<void>;
  gerarRelatorio(cliente: PoolClient, empresaId: string, tentativaId: string): AsyncIterable<string>;
  paraPrevia(tentativa: Tentativa, amostra: readonly Rejeicao[], diagnostico: DiagnosticoDaTentativa | null): Previa;
  paraPaginaDeRejeicoes(pagina: PaginaDe<Rejeicao>): PaginaDeRejeicoes;
  textos: TextosDaImportacao;
}>;

export type DependenciasDoOrquestrador = Readonly<{
  pool: Pool;
  storage: Pick<StorageService, 'enviarComChave' | 'obter'>;
  fila: FilaDeValidacao;
  prazos?: PrazosDoRelatorio | undefined;
  /** Leitor de planilhas e o limitador do processo (padrão: o filho real e o teto único do processo). */
  leitura?: LeituraDePlanilhas | undefined;
  /** Único ponto que lê o relógio (I-11): o serviço repassa o seu, que os testes substituem. */
  agora: () => Date;
}>;

const sha256 = (conteudo: Buffer): string => createHash('sha256').update(conteudo).digest('hex');

const naoEncontrada = (): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA, 'Tentativa de importação não encontrada.');

const falhaTecnica = (mensagem: string, detalhes: Readonly<Record<string, unknown>> = {}): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.FALHA_TECNICA, mensagem, [], detalhes);

/** Só o tipo e o código técnico: mensagem e `detail` de um erro do banco podem carregar valores da linha. */
export const descreverFalha = (erro: unknown): string => {
  if (!(erro instanceof Error)) {
    return 'desconhecida';
  }

  const codigo = (erro as Error & { code?: unknown }).code;

  return typeof codigo === 'string' ? `${erro.name} ${codigo}` : erro.name;
};

const MENSAGEM_DA_FALHA_SEM_REGISTRO =
  'A confirmação não pôde ser concluída por um problema técnico. Consulte o estado atual da importação antes de tentar de novo.';

const totaisFinais = (validacao: TotaisDaImportacao | null, aplicacao: ResultadoDaAplicacaoNaBase): TotaisDaImportacao => ({
  lidas: validacao?.lidas ?? 0,
  novas: aplicacao.incluidas,
  atualizadas: aplicacao.atualizadas,
  rejeitadas: validacao?.rejeitadas ?? 0,
});

export class OrquestradorDeImportacao<Tentativa extends TentativaOrquestrada, Rejeicao, Previa, PaginaDeRejeicoes> {
  private readonly logger: Logger;

  private readonly prazos: PrazosDoRelatorio;

  private readonly leitura: LeituraDePlanilhas;

  constructor(
    private readonly estrategia: EstrategiaDeImportacao<Tentativa, Rejeicao, Previa, PaginaDeRejeicoes>,
    private readonly dependencias: DependenciasDoOrquestrador,
    contextoDoLog: string,
  ) {
    this.logger = new Logger(contextoDoLog);
    this.prazos = dependencias.prazos ?? { ociosidadeMs: OCIOSIDADE_MAXIMA_DO_RELATORIO_MS, totalMs: PRAZO_TOTAL_DO_RELATORIO_MS };
    this.leitura = dependencias.leitura ?? LEITURA_DE_PLANILHAS_DO_PROCESSO;
  }

  private get repositorio(): RepositorioDaImportacao<Tentativa, Rejeicao> {
    return this.estrategia.repositorio;
  }

  private transacao<T>(contexto: ContextoDaImportacao, executar: (cliente: PoolClient) => Promise<T>): Promise<T> {
    return comContextoHumano(this.dependencias.pool, contexto, executar);
  }

  /**
   * Escrita só em empresa ATIVA e não arquivada, com os códigos que o resto do repositório já usa
   * para isso (documentos, cofre). Fora do alcance responde como empresa inexistente.
   */
  private async exigirEmpresaQueAceitaImportacao(cliente: PoolClient, empresaId: string): Promise<void> {
    const situacao = await carregarSituacaoDaEmpresa(cliente, empresaId);

    if (situacao === null) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada neste escritório.');
    }

    if (situacao.arquivada) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA, this.estrategia.textos.empresaArquivada);
    }

    if (!situacao.ativa) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ATIVA, this.estrategia.textos.empresaNaoAtiva);
    }
  }

  // -- Envio ------------------------------------------------------------------------------------

  async enviar(contexto: ContextoDaImportacao, empresaId: string, arquivo: ArquivoEnviado, informado: unknown): Promise<Previa> {
    const formato = formatoDoArquivo(this.estrategia.tipoDoArquivo, arquivo);
    const { mapeamento, configuracao } =
      formato === 'CSV'
        ? { mapeamento: this.estrategia.validarMapeamento(informado, lerCsv(arquivo.buffer).cabecalho), configuracao: null }
        : await this.revalidarPlanilha(contexto, formato, arquivo, informado);

    // Antes do storage: arquivo recusado não deixa rastro (rechecado dentro da transação abaixo).
    await this.transacao(contexto, (cliente) => this.exigirEmpresaQueAceitaImportacao(cliente, empresaId));

    const hash = sha256(arquivo.buffer);
    const chave = this.estrategia.chaveDoOriginal(contexto.tenantId, empresaId, hash, formato.toLowerCase());

    try {
      await this.dependencias.storage.enviarComChave(chave, arquivo.buffer, tipoDeConteudoDoFormato(formato));
    } catch (erro) {
      this.logger.error(
        `falha ao guardar o original (${this.estrategia.rotulo}) [${contexto.correlationId}]: ${descreverFalha(erro)}`,
      );
      throw falhaTecnica(this.estrategia.textos.storageIndisponivel);
    }

    const agora = this.dependencias.agora();
    const { tentativa, previa } = await this.transacao(contexto, async (cliente) => {
      await this.exigirEmpresaQueAceitaImportacao(cliente, empresaId);
      const criada = await this.repositorio.criar(cliente, {
        tenantId: contexto.tenantId,
        empresaId,
        hashArquivo: hash,
        mapeamento,
        arquivoNome: arquivo.nome.trim().slice(0, LIMITE_DO_NOME_DO_ARQUIVO) || this.estrategia.nomePadraoDoArquivo,
        arquivoTamanho: arquivo.buffer.byteLength,
        arquivoChave: chave,
        usuarioIniciadorId: contexto.usuarioId,
        correlationId: contexto.correlationId,
        agora,
        // CSV fica com os padrões do banco (sem aba, cabeçalho na linha 1): identidade das F13/F14.
        ...(configuracao ?? {}),
      });

      await this.repositorio.registrarEvento(
        cliente,
        this.evento(contexto, criada, agora, {
          acao: criada.reutilizada ? 'REUTILIZACAO' : 'CRIACAO',
          estadoAnterior: criada.reutilizada ? criada.estado : null,
          estadoNovo: criada.estado,
          totais: criada.totais,
        }),
      );

      // A escolha de aba e cabeçalho fica na própria tentativa (imutável depois do INSERT); o evento
      // só marca a seleção na trilha, sem dado da planilha. Reuso não repete a seleção.
      if (configuracao !== null && !criada.reutilizada) {
        await this.repositorio.registrarEvento(
          cliente,
          this.evento(contexto, criada, agora, {
            acao: 'SELECAO_DE_PLANILHA',
            estadoAnterior: criada.estado,
            estadoNovo: criada.estado,
            totais: null,
          }),
        );
      }

      return { tentativa: criada, previa: await this.montarPrevia(cliente, criada) };
    });

    // Depois do commit, para o worker já encontrar a tentativa. Reuso de tentativa ainda RECEBIDA
    // (envio anterior sem fila) ou presa em VALIDANDO (job perdido) reenfileira: o helper da fila
    // não duplica job vivo e o worker refaz a validação a partir de VALIDANDO sem duplicar staging.
    // Nos demais estados a validação já terminou (reuso de terminal: sem job e sem aviso).
    if (tentativa.estado === 'RECEBIDA' || tentativa.estado === 'VALIDANDO') {
      await this.enfileirar(tentativa);
    }

    return previa;
  }

  /**
   * Planilha no envio: aba e cabeçalho obrigatórios (400), a aba lida no filho (na vaga do limitador)
   * e tudo conferido antes do storage. Devolve o mapeamento canônico e a configuração da identidade.
   */
  private async revalidarPlanilha(
    contexto: ContextoDaImportacao,
    formato: Exclude<FormatoDeArquivo, 'CSV'>,
    arquivo: ArquivoEnviado,
    informado: unknown,
  ): Promise<Readonly<{ mapeamento: MapeamentoDaImportacao; configuracao: ConfiguracaoDaTentativa }>> {
    const { aba, linhaCabecalho } = exigirConfiguracao(arquivo.planilha);
    const leitura = await this.lerPlanilha(contexto, () => this.leitura.leitor.lerAba(arquivo.buffer, aba));
    const mapeamento = revalidarAba(leitura, linhaCabecalho, this.estrategia.validarMapeamento, informado);

    return { mapeamento, configuracao: { formato, abaNome: leitura.aba.nome, abaPosicao: leitura.aba.posicao, linhaCabecalho } };
  }

  /** Leitura no filho dentro da vaga do limitador; o erro do leitor vira código estável (detalhe só no log). */
  private async lerPlanilha<T>(contexto: ContextoDaImportacao, ler: () => Promise<T>): Promise<T> {
    try {
      return await this.leitura.limitador.executar(ler);
    } catch (erro) {
      if (erro instanceof ErroDeDominio) {
        throw erro;
      }

      const traduzido = traduzirErroDoLeitor(erro);
      const detalhe = (erro as { detalhe?: unknown }).detalhe;
      const motivo =
        traduzido.codigo === CODIGOS_DE_ERRO.SERVICO_OCUPADO ? descreverFalha(erro) : `${traduzido.codigo}/${String(detalhe ?? '-')}`;
      this.logger.warn(`planilha não lida (${this.estrategia.rotulo}) [${contexto.correlationId}]: ${motivo}`);
      throw traduzido;
    }
  }

  // -- Inspeção (sem estado) ----------------------------------------------------------------------

  /**
   * Abas, aba escolhida, cabeçalho sugerido/escolhido, colunas, amostra e diagnósticos — nada é
   * gravado (sem storage, tentativa nem evento). Só planilha: o CSV é mapeado na tela pelo cabeçalho.
   */
  async inspecionar(
    contexto: ContextoDaImportacao,
    arquivo: ArquivoEnviado,
    pedido: CamposDePlanilhaInformados,
  ): Promise<InspecaoDePlanilha> {
    if (formatoDoArquivo(this.estrategia.tipoDoArquivo, arquivo) === 'CSV') {
      throw erroDePlanilha(
        CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,
        'A inspeção é só para planilhas .xlsx e .ods; o CSV segue direto para o mapeamento.',
      );
    }

    return this.lerPlanilha(contexto, () => inspecionarPlanilha(this.leitura.leitor, arquivo.buffer, pedido));
  }

  private async enfileirar(tentativa: Tentativa): Promise<void> {
    try {
      await this.dependencias.fila.enfileirar({
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

  async confirmar(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string, versaoDaPrevia: number): Promise<Previa> {
    const agora = this.dependencias.agora();

    try {
      return await this.transacao(contexto, async (cliente) => {
        await this.exigirEmpresaQueAceitaImportacao(cliente, empresaId);
        const confirmada = await this.repositorio.confirmar(cliente, {
          empresaId,
          tentativaId,
          usuarioId: contexto.usuarioId,
          versaoDaPrevia,
        });
        await this.repositorio.registrarEvento(
          cliente,
          this.evento(contexto, confirmada, agora, {
            acao: 'CONFIRMAR',
            estadoAnterior: 'AGUARDANDO_CONFIRMACAO',
            estadoNovo: 'APLICANDO',
            totais: null,
          }),
        );

        const aplicacao = await this.estrategia.aplicar(cliente, empresaId, tentativaId, agora);

        // Linha válida que achou o registro arquivado: a base mudou sob a prévia (o arquivamento
        // não sobe a versão). Nada é aplicado; a prévia precisa ser refeita.
        if (aplicacao.ignoradas > 0) {
          throw new ErroDeConflito(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO, this.estrategia.textos.conflitoPorArquivado);
        }

        const totais = totaisFinais(confirmada.totais, aplicacao);
        const estadoFinal = totais.rejeitadas > 0 ? 'CONCLUIDA_COM_REJEICOES' : 'CONCLUIDA';

        await this.repositorio.registrarEvento(
          cliente,
          this.evento(contexto, confirmada, agora, {
            acao: estadoFinal === 'CONCLUIDA' ? 'APLICACAO_SUCESSO' : 'APLICACAO_SUCESSO_COM_REJEICOES',
            estadoAnterior: 'APLICANDO',
            estadoNovo: estadoFinal,
            totais,
          }),
        );
        await this.repositorio.finalizar(cliente, empresaId, tentativaId, estadoFinal, totais, agora);
        await this.estrategia.reconciliarPendencia(cliente, {
          tenantId: contexto.tenantId,
          empresaId,
          usuarioId: contexto.usuarioId,
          agora,
        });
        // Só se chega aqui quando ESTA chamada transicionou: a repetida parou no `confirmar`.
        await this.estrategia.notificar(cliente, confirmada, agora);

        return this.montarPrevia(cliente, await this.exigirTentativa(cliente, empresaId, tentativaId));
      });
    } catch (erro) {
      if (erro instanceof ErroDeDominio) {
        throw erro;
      }

      this.logger.error(`falha técnica ao aplicar a tentativa ${tentativaId} [${contexto.correlationId}]: ${descreverFalha(erro)}`);
      const registrada = await this.registrarFalhaDaAplicacao(contexto, empresaId, tentativaId, versaoDaPrevia);
      throw falhaTecnica(registrada ? this.estrategia.textos.falhaRegistrada : MENSAGEM_DA_FALHA_SEM_REGISTRO, { tentativaId });
    }
  }

  /**
   * Depois do ROLLBACK da aplicação, numa transação curta e separada: a tentativa passa por
   * APLICANDO (com o confirmador) e termina em FALHA, com evento append-only de código estável e o
   * aviso. Só acontece se ela ainda estiver na MESMA prévia (o `confirmar` do repositório é o UPDATE
   * condicional); se algo mudou ou esta transação também falhar, fica só o registro no log — a
   * resposta continua sendo `FALHA_TECNICA`. Devolve se a FALHA foi gravada: sem ela não há prova
   * de que nada mudou, e a resposta não pode afirmar isso.
   */
  private async registrarFalhaDaAplicacao(
    contexto: ContextoDaImportacao,
    empresaId: string,
    tentativaId: string,
    versaoDaPrevia: number,
  ): Promise<boolean> {
    const agora = this.dependencias.agora();

    try {
      await this.transacao(contexto, async (cliente) => {
        const confirmada = await this.repositorio.confirmar(cliente, {
          empresaId,
          tentativaId,
          usuarioId: contexto.usuarioId,
          versaoDaPrevia,
        });
        await this.repositorio.registrarEvento(
          cliente,
          this.evento(contexto, confirmada, agora, {
            acao: 'CONFIRMAR',
            estadoAnterior: 'AGUARDANDO_CONFIRMACAO',
            estadoNovo: 'APLICANDO',
            totais: null,
          }),
        );
        await this.repositorio.registrarFalha(cliente, empresaId, tentativaId, agora);
        await this.repositorio.registrarEvento(cliente, {
          ...this.evento(contexto, confirmada, agora, {
            acao: 'FALHA_TECNICA',
            estadoAnterior: 'APLICANDO',
            estadoNovo: 'FALHA',
            totais: confirmada.totais,
          }),
          codigo: CODIGO_DA_FALHA_NA_APLICACAO,
        });
        await this.estrategia.notificar(cliente, confirmada, agora);
      });

      return true;
    } catch (erro) {
      const motivo = erro instanceof ErroDeDominio ? erro.codigo : descreverFalha(erro);
      this.logger.error(`FALHA da tentativa ${tentativaId} não registrada [${contexto.correlationId}]: ${motivo}`);

      return false;
    }
  }

  async cancelar(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string): Promise<Previa> {
    const agora = this.dependencias.agora();

    return this.transacao(contexto, async (cliente) => {
      await this.exigirEmpresaQueAceitaImportacao(cliente, empresaId);
      const cancelada = await this.repositorio.cancelar(cliente, { empresaId, tentativaId, usuarioId: contexto.usuarioId, agora });
      await this.repositorio.registrarEvento(
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

  async previa(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string): Promise<Previa> {
    return this.transacao(contexto, async (cliente) =>
      this.montarPrevia(cliente, await this.exigirTentativa(cliente, empresaId, tentativaId)),
    );
  }

  async historico(contexto: ContextoDaImportacao, empresaId: string, pagina: number): Promise<HistoricoDeImportacoes> {
    return this.transacao(contexto, (cliente) => this.repositorio.listarHistorico(cliente, empresaId, pagina));
  }

  async rejeicoes(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string, pagina: number): Promise<PaginaDeRejeicoes> {
    return this.transacao(contexto, async (cliente) => {
      await this.exigirTentativa(cliente, empresaId, tentativaId);

      return this.estrategia.paraPaginaDeRejeicoes(
        await this.repositorio.listarRejeicoes(cliente, empresaId, tentativaId, pagina, ITENS_POR_PAGINA_DE_REJEICOES),
      );
    });
  }

  async arquivoOriginal(contexto: ContextoDaImportacao, empresaId: string, tentativaId: string): Promise<OriginalDaImportacao> {
    const tentativa = await this.transacao(contexto, (cliente) => this.exigirTentativa(cliente, empresaId, tentativaId));
    const { conteudo } = await this.dependencias.storage.obter(tentativa.arquivoChave);

    return { nome: tentativa.arquivoNome, conteudo, formato: tentativa.formato };
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
    let abrir: (tentativa: Tentativa) => void = () => undefined;
    let recusar: (erro: unknown) => void = () => undefined;
    const abertura = new Promise<Tentativa>((resolver, rejeitar) => {
      abrir = resolver;
      recusar = rejeitar;
    });

    void this.transacao(contexto, async (cliente) => {
      const tentativa = await this.exigirTentativa(cliente, empresaId, tentativaId);

      if (!relatorioDisponivel(tentativa)) {
        throw new ErroDeDominio(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO, 'O relatório fica disponível quando a validação terminar.');
      }

      await cliente.query('select set_config($1, $2, true)', ['idle_in_transaction_session_timeout', `${this.prazos.ociosidadeMs}ms`]);

      aberta = true;
      abrir(tentativa);

      // Conexão derrubada (ociosidade estourada) ou prazo total: destruir o fluxo faz o pipeline
      // falhar, o cursor fechar e a transação reverter — a conexão volta (ou sai) do pool.
      const interromper = (erro: Error): void => {
        conteudo.destroy(erro);
      };
      const prazo = setTimeout(() => interromper(new Error('prazo do relatório esgotado')), this.prazos.totalMs);
      cliente.on('error', interromper);

      try {
        await pipeline(Readable.from(this.estrategia.gerarRelatorio(cliente, empresaId, tentativaId)), conteudo);
      } finally {
        clearTimeout(prazo);
        cliente.removeListener('error', interromper);
      }
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
    const base = tentativa.arquivoNome.replace(/\.(csv|xlsx|ods)$/iu, '');

    return { nomeDoArquivo: `relatorio-${base}.csv`, conteudo };
  }

  // -- Apoio ------------------------------------------------------------------------------------

  private async exigirTentativa(cliente: PoolClient, empresaId: string, tentativaId: string): Promise<Tentativa> {
    const tentativa = await this.repositorio.buscar(cliente, empresaId, tentativaId);

    if (tentativa === null) {
      throw naoEncontrada();
    }

    return tentativa;
  }

  private async montarPrevia(cliente: PoolClient, tentativa: Tentativa): Promise<Previa> {
    const amostra = temResultadoDaValidacao(tentativa)
      ? (await this.repositorio.listarRejeicoes(cliente, tentativa.empresaId, tentativa.id, 1, ITENS_POR_PAGINA_DE_REJEICOES)).itens
      : [];

    const diagnostico = temDiagnostico(tentativa)
      ? await this.repositorio.buscarDiagnostico(cliente, tentativa.empresaId, tentativa.id)
      : null;

    return this.estrategia.paraPrevia(tentativa, amostra, diagnostico);
  }

  private evento(
    contexto: ContextoDaImportacao,
    tentativa: Tentativa,
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
