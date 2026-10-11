/**
 * Planilha (XLSX/ODS) na fronteira da API (SPEC-015 §3.1–§3.4, §7): decisão do formato, leitura em
 * processo filho com limite de concorrência, revalidação de aba/cabeçalho/mapeamento no envio e a
 * inspeção sem estado. Nada daqui persiste: quem grava é o orquestrador.
 *
 * Regras:
 * 1. **Formato por extensão + conteúdo, nunca pelo `Content-Type`** (livre no multipart). `.xlsx`/`.ods`
 *    passam pelo `detectarFormato` (diretório central do ZIP e partes pequenas, barato no processo
 *    principal); qualquer outro nome segue o caminho do CSV exatamente como nas F13/F14.
 * 2. **Todo conteúdo de planilha é lido no processo filho** (`lerPlanilhaIsolada`). Uma leitura
 *    de envio leva até ~40 s no pior caso (10 s para subir o filho + 30 s de trabalho); a inspeção usa
 *    DOIS filhos em sequência no mesmo slot do limitador, então chega a ~80 s. Não há prazo menor
 *    aqui, para um arquivo legítimo lento não virar erro falso.
 * 3. **No máximo `LEITURAS_SIMULTANEAS_DE_PLANILHA` leituras por processo**, somando inspeção e envio
 *    dos dois domínios: o pai segura por instantes o JSON do filho (até ~330 MB de pico por leitura).
 *    O excedente é recusado na hora com 503 `SERVICO_OCUPADO` (`Retry-After`), sem fila de espera.
 * 4. **Erro de conteúdo nunca é 500**: o leitor devolve código estável; falha técnica do filho vira
 *    503 com `correlationId`, sem o motivo interno.
 */
import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  conferirCabecalho,
  diagnosticosDaTabela,
  resumoDaAba,
  rotulosDasColunas,
  amostraDaAba,
  sugerirLinhaDeCabecalho,
  tabelaParaRegistros,
  type CampoInvalido,
  type CodigoDeErro,
  type LeituraDaAba,
} from '@contaia/domain';
import {
  ErroDeInfraestrutura,
  ErroDePlanilha,
  detectarFormato,
  lerPlanilhaIsolada,
  type Inspecao,
} from '@contaia/planilhas';
import {
  InspecaoDePlanilhaSchema,
  MENSAGEM_DO_ERRO_DE_PLANILHA,
  conteudoConfereComOTipo,
  formatoPelaExtensao,
  mensagemDaFalha,
  tipoDeConteudoDoFormato,
  validarArquivo,
  type CodigoDeErroDePlanilha,
  type FormatoDeArquivo,
  type InspecaoDePlanilha,
  type TipoDeArquivo,
} from '@contaia/shared';

import type { ArquivoEnviado } from './orquestrador';

/** Leituras de planilha simultâneas por processo da API (inspeção + envio, os dois domínios). */
export const LEITURAS_SIMULTANEAS_DE_PLANILHA = 2;
/** Linhas da amostra da inspeção: é entre elas que o usuário escolhe o cabeçalho. */
const LINHAS_DA_AMOSTRA = 30;
/** O schema da inspeção aceita até 1.000 abas; o leitor, até 2.000. Acima disso é limite do arquivo. */
const ABAS_NA_INSPECAO = 1000;
const CABECALHO_EM_BRANCO = 'A linha de cabeçalho escolhida está em branco; escolha outra linha.';

export type FormatoDePlanilha = Exclude<FormatoDeArquivo, 'CSV'>;

/** O que a API pede ao leitor (o real roda em processo filho; os testes o dublam). */
export type LeitorDePlanilhas = Readonly<{
  inspecionar(bytes: Uint8Array): Promise<Inspecao>;
  lerAba(bytes: Uint8Array, abaPosicao: number): Promise<LeituraDaAba>;
}>;

export const LEITOR_ISOLADO: LeitorDePlanilhas = {
  inspecionar: (bytes) => lerPlanilhaIsolada(bytes, { tipo: 'inspecionar' }),
  lerAba: (bytes, abaPosicao) => lerPlanilhaIsolada(bytes, { tipo: 'ler-aba', abaPosicao }),
};

const servicoOcupado = (): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.SERVICO_OCUPADO, MENSAGEM_DO_ERRO_DE_PLANILHA.SERVICO_OCUPADO);

/** Semáforo sem fila: acima do máximo recusa na hora (quem espera é o cliente, com `Retry-After`). */
export class LimitadorDeLeituras {
  private emUso = 0;

  constructor(private readonly maximo: number) {}

  async executar<T>(tarefa: () => Promise<T>): Promise<T> {
    if (this.emUso >= this.maximo) {
      throw servicoOcupado();
    }

    this.emUso += 1;
    try {
      return await tarefa();
    } finally {
      this.emUso -= 1;
    }
  }
}

/** Leitor e limitador que a API usa. Os dois domínios recebem o MESMO objeto: o teto é do processo. */
export type LeituraDePlanilhas = Readonly<{ leitor: LeitorDePlanilhas; limitador: LimitadorDeLeituras }>;

export const LEITURA_DE_PLANILHAS_DO_PROCESSO: LeituraDePlanilhas = {
  leitor: LEITOR_ISOLADO,
  limitador: new LimitadorDeLeituras(LEITURAS_SIMULTANEAS_DE_PLANILHA),
};

/** Token opcional para os testes trocarem o leitor (dublê lento) e o limitador. */
export const LEITURA_DE_PLANILHAS = Symbol('LEITURA_DE_PLANILHAS');

// -- Códigos e mensagens ------------------------------------------------------------------------

const MENSAGENS_DOS_CODIGOS_COMUNS: Readonly<Partial<Record<CodigoDeErro, string>>> = {
  ARQUIVO_VAZIO: 'O arquivo está vazio.',
  ARQUIVO_ACIMA_DO_LIMITE: 'O arquivo passa do limite de 10 MB ou de 10.000 linhas de dados.',
};

/** Campo da tela a que o código se refere (foco e mensagem no lugar certo). */
const campoDoCodigo = (codigo: CodigoDeErro): string => {
  if (codigo === 'ABA_INEXISTENTE' || codigo === 'ABA_SEM_DADOS' || codigo === 'PLANILHA_SEM_ABA_UTILIZAVEL') {
    return 'aba';
  }
  return codigo === 'CABECALHO_INVALIDO' || codigo === 'CABECALHO_MESCLADO' ? 'linhaCabecalho' : 'arquivo';
};

const ehCodigoDePlanilha = (codigo: string): codigo is CodigoDeErroDePlanilha => codigo in MENSAGEM_DO_ERRO_DE_PLANILHA;

/** Erro de arquivo/estrutura com a mensagem FIXA do código (nunca nome de aba, coluna ou célula). */
export const erroDePlanilha = (codigo: CodigoDeErro, mensagem?: string): ErroDeDominio =>
  new ErroDeDominio(
    codigo,
    mensagem ?? (ehCodigoDePlanilha(codigo) ? MENSAGEM_DO_ERRO_DE_PLANILHA[codigo] : (MENSAGENS_DOS_CODIGOS_COMUNS[codigo] ?? codigo)),
    [{ campo: campoDoCodigo(codigo), codigo }],
  );

/**
 * Erro do leitor → erro de domínio. O `detalhe` interno do `ErroDePlanilha` não sai na resposta (o
 * orquestrador o registra no log, sem conteúdo). Falha técnica do filho é 503: o arquivo pode ser bom.
 */
export const traduzirErroDoLeitor = (erro: unknown): ErroDeDominio => {
  if (erro instanceof ErroDePlanilha) {
    return erroDePlanilha(erro.codigo);
  }

  if (erro instanceof ErroDeInfraestrutura) {
    return new ErroDeDominio(
      CODIGOS_DE_ERRO.SERVICO_OCUPADO,
      'Não foi possível ler a planilha agora por uma falha técnica. Tente novamente em instantes.',
    );
  }

  throw erro;
};

/**
 * Linha de log da falha do leitor, só com o que é estável e sem conteúdo: código/detalhe do
 * `ErroDePlanilha`, ou classe/motivo do `ErroDeInfraestrutura` mais classe e `code` da causa. A
 * mensagem nunca entra (a da causa pode trazer caminho, stderr do filho ou texto do arquivo).
 */
export const descreverFalhaDoLeitor = (erro: unknown): string => {
  if (erro instanceof ErroDePlanilha) {
    return `${erro.codigo}/${erro.detalhe ?? '-'}`;
  }

  if (!(erro instanceof Error)) {
    return 'desconhecida';
  }

  const base = `${erro.name}/${erro instanceof ErroDeInfraestrutura ? (erro.motivo ?? '-') : '-'}`;
  const causa = erro.cause;

  if (!(causa instanceof Error)) {
    return base;
  }

  const codigo = (causa as Error & { code?: unknown }).code;

  return `${base} (causa: ${causa.name}${typeof codigo === 'string' && /^[A-Z0-9_]{1,40}$/u.test(codigo) ? ` ${codigo}` : ''})`;
};

// -- Formato --------------------------------------------------------------------------------------

/** CSV: a mesma conferência das F13/F14, agora com o nome (`.xls`/`.xlsm` recusados pela extensão). */
const conferirCsv = (tipo: TipoDeArquivo, arquivo: ArquivoEnviado): void => {
  const falha = validarArquivo(tipo, { tipoConteudo: arquivo.mimetype, tamanhoBytes: arquivo.buffer.byteLength, nome: arquivo.nome });

  if (falha === 'TAMANHO_EXCEDIDO') {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE, mensagemDaFalha(tipo, falha));
  }

  if (falha === 'ARQUIVO_VAZIO') {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_VAZIO, 'O arquivo está vazio.');
  }

  if (falha === 'FORMATO_XLS_NAO_SUPORTADO' || falha === 'FORMATO_XLSM_NAO_SUPORTADO') {
    throw erroDePlanilha(falha);
  }

  const campos: readonly CampoInvalido[] = [{ campo: 'arquivo', codigo: CODIGOS_DE_ERRO.ARQUIVO_INVALIDO }];

  if (falha !== null) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, mensagemDaFalha(tipo, falha), campos);
  }

  // O `Content-Type` do multipart é declarado por quem envia: os bytes precisam parecer texto.
  if (!conteudoConfereComOTipo(arquivo.mimetype, arquivo.buffer.subarray(0, 16))) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, mensagemDaFalha(tipo, 'CONTEUDO_NAO_CONFERE'), campos);
  }
};

/**
 * Formato do arquivo enviado, ou o código estável da recusa. Tamanho, vazio e `.xls`/`.xlsm` pela
 * regra comum (`validarArquivo` com o nome); para `.xlsx`/`.ods`, o tipo declarado é ignorado e o
 * conteúdo decide (`detectarFormato`: cifrado, XLS/XLSM renomeado, extensão trocada, ZIP quebrado).
 */
export const formatoDoArquivo = (tipo: TipoDeArquivo, arquivo: ArquivoEnviado): FormatoDeArquivo => {
  const pelaExtensao = formatoPelaExtensao(arquivo.nome);

  if (pelaExtensao !== 'XLSX' && pelaExtensao !== 'ODS') {
    conferirCsv(tipo, arquivo);
    return 'CSV';
  }

  const falha = validarArquivo(tipo, {
    tipoConteudo: tipoDeConteudoDoFormato(pelaExtensao),
    tamanhoBytes: arquivo.buffer.byteLength,
    nome: arquivo.nome,
  });

  if (falha === 'TAMANHO_EXCEDIDO') {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE, mensagemDaFalha(tipo, falha));
  }

  if (falha !== null) {
    throw erroDePlanilha(falha === 'ARQUIVO_VAZIO' ? CODIGOS_DE_ERRO.ARQUIVO_VAZIO : CODIGOS_DE_ERRO.ARQUIVO_INVALIDO);
  }

  try {
    return detectarFormato(arquivo.buffer, pelaExtensao === 'XLSX' ? '.xlsx' : '.ods').formato;
  } catch (erro) {
    if (erro instanceof ErroDePlanilha) {
      throw erroDePlanilha(erro.codigo);
    }
    // Bytes hostis no farejador do processo principal: nunca 500.
    throw erroDePlanilha(CODIGOS_DE_ERRO.ARQUIVO_CORROMPIDO);
  }
};

// -- Envio: revalidação da configuração ---------------------------------------------------------

export type CamposDePlanilhaInformados = Readonly<{ aba?: number | undefined; linhaCabecalho?: number | undefined }>;

export type ConfiguracaoDaTentativa = Readonly<{
  formato: FormatoDePlanilha;
  abaNome: string;
  abaPosicao: number;
  linhaCabecalho: number;
}>;

/** Aba e cabeçalho são obrigatórios no envio de planilha (400 antes de qualquer leitura). */
export const exigirConfiguracao = (
  informado: CamposDePlanilhaInformados | undefined,
): Readonly<{ aba: number; linhaCabecalho: number }> => {
  const aba = informado?.aba;
  const linhaCabecalho = informado?.linhaCabecalho;

  if (aba === undefined || linhaCabecalho === undefined) {
    const ausentes = [aba === undefined ? 'aba' : null, linhaCabecalho === undefined ? 'linhaCabecalho' : null].filter(
      (campo): campo is string => campo !== null,
    );

    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.CONFIGURACAO_DE_PLANILHA_INCOMPLETA,
      MENSAGEM_DO_ERRO_DE_PLANILHA.CONFIGURACAO_DE_PLANILHA_INCOMPLETA,
      ausentes.map((campo) => ({ campo, codigo: CODIGOS_DE_ERRO.CONFIGURACAO_DE_PLANILHA_INCOMPLETA })),
    );
  }

  return { aba, linhaCabecalho };
};

/**
 * Aba lida + cabeçalho escolhido + mapeamento por LETRA → o mapeamento canônico da identidade, ou o
 * código estável. Aba e cabeçalho pela regra do domínio (`conferirCabecalho`, a mesma do worker); as
 * letras existentes são as do cabeçalho: o `validarMapeamento` confere ausência, coluna inexistente e letra repetida
 * entre campos. `tabelaParaRegistros` fecha o que o CSV também fecha antes do storage (só cabeçalho,
 * mais de 10.000 linhas de dados).
 */
export const revalidarAba = <Mapeamento>(
  leitura: LeituraDaAba,
  linhaCabecalho: number,
  validarMapeamento: (informado: unknown, cabecalho: readonly string[]) => Mapeamento,
  informado: unknown,
): Mapeamento => {
  const cabecalho = conferirCabecalho(leitura, linhaCabecalho);

  if (!cabecalho.ok) {
    throw erroDePlanilha(cabecalho.codigo, cabecalho.codigo === 'CABECALHO_INVALIDO' ? CABECALHO_EM_BRANCO : undefined);
  }

  const mapeamento = validarMapeamento(informado, cabecalho.letras);
  tabelaParaRegistros(leitura, linhaCabecalho, Object.values(mapeamento as Readonly<Record<string, string>>));

  return mapeamento;
};

// -- Inspeção ---------------------------------------------------------------------------------------

const SEM_ABA_ESCOLHIDA = {
  abaSelecionada: null,
  linhaCabecalhoSugerida: null,
  linhaCabecalho: null,
  colunas: [],
  amostra: [],
  linhasIgnoradasAntesDoCabecalho: 0,
  linhasOcultas: 0,
  cabecalhoMesclado: false,
  diagnosticos: [],
} as const;

/**
 * Inspeção sem estado: com uma só aba utilizável ela é escolhida; com várias, só se `aba` vier. O
 * cabeçalho é o pedido ou a primeira linha preenchida. Dois processos filhos (listar abas, ler a
 * escolhida), na MESMA vaga do limitador.
 */
export const inspecionarPlanilha = async (
  leitor: LeitorDePlanilhas,
  bytes: Uint8Array,
  pedido: CamposDePlanilhaInformados,
): Promise<InspecaoDePlanilha> => {
  const { formato, abas } = await leitor.inspecionar(bytes);

  if (abas.length > ABAS_NA_INSPECAO) {
    throw erroDePlanilha(CODIGOS_DE_ERRO.LIMITE_DE_PROCESSAMENTO_EXCEDIDO);
  }

  const utilizaveis = abas.filter((aba) => aba.utilizavel);

  if (utilizaveis.length === 0) {
    throw erroDePlanilha(CODIGOS_DE_ERRO.PLANILHA_SEM_ABA_UTILIZAVEL);
  }

  const escolhida = pedido.aba === undefined ? (utilizaveis.length === 1 ? utilizaveis[0] : undefined) : abas.find((aba) => aba.posicao === pedido.aba);

  if (pedido.aba !== undefined && escolhida === undefined) {
    throw erroDePlanilha(CODIGOS_DE_ERRO.ABA_INEXISTENTE);
  }

  if (escolhida === undefined) {
    return InspecaoDePlanilhaSchema.parse({ formato, abas, ...SEM_ABA_ESCOLHIDA });
  }

  if (!escolhida.utilizavel) {
    throw erroDePlanilha(CODIGOS_DE_ERRO.ABA_SEM_DADOS);
  }

  const leitura = await leitor.lerAba(bytes, escolhida.posicao);
  const sugerida = sugerirLinhaDeCabecalho(leitura);

  if (sugerida === null) {
    throw erroDePlanilha(CODIGOS_DE_ERRO.ABA_SEM_DADOS);
  }

  const linhaCabecalho = pedido.linhaCabecalho ?? sugerida;
  const colunas = rotulosDasColunas(leitura, linhaCabecalho);

  if (colunas.length === 0) {
    throw erroDePlanilha(CODIGOS_DE_ERRO.CABECALHO_INVALIDO, CABECALHO_EM_BRANCO);
  }

  const resumo = resumoDaAba(leitura, linhaCabecalho);
  const diagnosticos = diagnosticosDaTabela({
    cabecalho: [],
    registros: [],
    ignoradasAntesDoCabecalho: resumo.ignoradasAntesDoCabecalho,
    ocultas: resumo.ocultas,
    cabecalhoMesclado: resumo.cabecalhoMesclado,
    rejeicoesEstruturaisPorLinha: new Map(),
  });

  return InspecaoDePlanilhaSchema.parse({
    formato,
    abas,
    abaSelecionada: { nome: escolhida.nome, posicao: escolhida.posicao },
    linhaCabecalhoSugerida: sugerida,
    linhaCabecalho,
    colunas,
    amostra: amostraDaAba(leitura, LINHAS_DA_AMOSTRA),
    linhasIgnoradasAntesDoCabecalho: resumo.ignoradasAntesDoCabecalho,
    linhasOcultas: resumo.ocultas,
    cabecalhoMesclado: resumo.cabecalhoMesclado,
    diagnosticos,
  });
};
