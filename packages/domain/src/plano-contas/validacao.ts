/**
 * Validação integral do lote de importação do plano de contas (SPEC-013 §3.4).
 *
 * O worker valida o arquivo inteiro antes de formar a prévia. A ordem física das linhas não
 * define a hierarquia: uma conta-pai válida pode aparecer depois da filha. Erro de linha não
 * interrompe a validação das demais.
 */

export type TipoDaConta = 'analitica' | 'sintetica';
export type NaturezaDaConta = 'devedora' | 'credora';

export interface LinhaDeEntrada {
  readonly numeroDaLinha: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: TipoDaConta;
  readonly natureza: NaturezaDaConta;
  readonly contaPai: string | null;
}

export interface ContaVigente {
  readonly codigo: string;
  readonly tipo: TipoDaConta;
  readonly arquivada: boolean;
  readonly temFilhas: boolean;
}

export type CodigoDeErroDaLinha =
  | 'CAMPO_OBRIGATORIO_AUSENTE'
  | 'VALOR_FORA_DO_DOMINIO'
  | 'CODIGO_DUPLICADO_NO_ARQUIVO'
  | 'CONTA_PAI_INEXISTENTE'
  | 'CONTA_PAI_REJEITADA'
  | 'CICLO_HIERARQUICO'
  | 'SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA'
  | 'CONTA_ARQUIVADA';

export interface LinhaRejeitada {
  readonly numeroDaLinha: number;
  readonly codigo: string | null;
  readonly campo: string | null;
  readonly codigoDeErro: CodigoDeErroDaLinha;
}

export interface LinhaAceita {
  readonly numeroDaLinha: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: TipoDaConta;
  readonly natureza: NaturezaDaConta;
  readonly contaPai: string | null;
}

export interface ResultadoDaValidacao {
  readonly aceitas: readonly LinhaAceita[];
  readonly rejeitadas: readonly LinhaRejeitada[];
}

const TIPOS_VALIDOS: readonly TipoDaConta[] = ['analitica', 'sintetica'];
const NATUREZAS_VALIDAS: readonly NaturezaDaConta[] = ['devedora', 'credora'];

const rejeicao = (
  linha: LinhaDeEntrada,
  codigoDeErro: CodigoDeErroDaLinha,
  campo: string | null = null,
): LinhaRejeitada => ({
  numeroDaLinha: linha.numeroDaLinha,
  codigo: linha.codigo || null,
  campo,
  codigoDeErro,
});

/**
 * Valida os campos obrigatórios e o domínio de cada linha, isoladamente das demais.
 * Não decide hierarquia, duplicidade nem conflito com o plano vigente.
 */
const validarCamposDaLinha = (linha: LinhaDeEntrada): LinhaRejeitada | null => {
  if (!linha.codigo) {
    return rejeicao(linha, 'CAMPO_OBRIGATORIO_AUSENTE', 'codigo');
  }
  if (!linha.nome) {
    return rejeicao(linha, 'CAMPO_OBRIGATORIO_AUSENTE', 'nome');
  }
  if (!TIPOS_VALIDOS.includes(linha.tipo)) {
    return rejeicao(linha, 'VALOR_FORA_DO_DOMINIO', 'tipo');
  }
  if (!NATUREZAS_VALIDAS.includes(linha.natureza)) {
    return rejeicao(linha, 'VALOR_FORA_DO_DOMINIO', 'natureza');
  }

  return null;
};

/**
 * Detecta ciclos no grafo de conta-pai formado só pelas linhas candidatas (já aprovadas nas
 * etapas anteriores). Toda linha que participa de um ciclo é rejeitada.
 */
const codigosEmCiclo = (candidatas: readonly LinhaDeEntrada[]): ReadonlySet<string> => {
  const paiPorCodigo = new Map<string, string | null>(candidatas.map((l) => [l.codigo, l.contaPai]));
  const emCiclo = new Set<string>();

  for (const inicial of candidatas) {
    const visitados = new Set<string>();
    let atual: string | null = inicial.codigo;

    while (atual !== null) {
      if (visitados.has(atual)) {
        if (atual === inicial.codigo || visitados.has(inicial.codigo)) {
          emCiclo.add(inicial.codigo);
        }
        break;
      }
      visitados.add(atual);
      const proximoPai = paiPorCodigo.get(atual);
      atual = proximoPai === undefined ? null : proximoPai;
    }
  }

  return emCiclo;
};

export const validarLinhasDoPlano = (entrada: {
  readonly linhas: readonly LinhaDeEntrada[];
  readonly contasVigentes: readonly ContaVigente[];
}): ResultadoDaValidacao => {
  const { linhas, contasVigentes } = entrada;
  const rejeitadas: LinhaRejeitada[] = [];
  const vigentePorCodigo = new Map(contasVigentes.map((c) => [c.codigo, c]));

  // 1) campos obrigatórios e domínio — isolado por linha.
  const comCamposValidos: LinhaDeEntrada[] = [];
  for (const linha of linhas) {
    const erro = validarCamposDaLinha(linha);
    if (erro) {
      rejeitadas.push(erro);
    } else {
      comCamposValidos.push(linha);
    }
  }

  // 2) duplicidade de código no arquivo — toda ocorrência do código repetido é rejeitada.
  const ocorrenciasPorCodigo = new Map<string, LinhaDeEntrada[]>();
  for (const linha of comCamposValidos) {
    const lista = ocorrenciasPorCodigo.get(linha.codigo) ?? [];
    lista.push(linha);
    ocorrenciasPorCodigo.set(linha.codigo, lista);
  }
  const semDuplicidade: LinhaDeEntrada[] = [];
  for (const [, ocorrencias] of ocorrenciasPorCodigo) {
    if (ocorrencias.length > 1) {
      for (const linha of ocorrencias) {
        rejeitadas.push(rejeicao(linha, 'CODIGO_DUPLICADO_NO_ARQUIVO'));
      }
    } else {
      semDuplicidade.push(ocorrencias[0]!);
    }
  }

  // 3) conflito estrutural com o plano vigente: arquivada, ou sintética-com-filhas virando analítica.
  const semConflitoVigente: LinhaDeEntrada[] = [];
  for (const linha of semDuplicidade) {
    const vigente = vigentePorCodigo.get(linha.codigo);
    if (vigente?.arquivada) {
      rejeitadas.push(rejeicao(linha, 'CONTA_ARQUIVADA'));
      continue;
    }
    if (vigente?.temFilhas && vigente.tipo === 'sintetica' && linha.tipo === 'analitica') {
      rejeitadas.push(rejeicao(linha, 'SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA'));
      continue;
    }
    semConflitoVigente.push(linha);
  }

  // 4) ciclo hierárquico entre as linhas candidatas restantes.
  const codigosCandidatos = new Set(semConflitoVigente.map((l) => l.codigo));
  const candidatasParaCiclo = semConflitoVigente.filter(
    (l) => l.contaPai === null || codigosCandidatos.has(l.contaPai),
  );
  const emCiclo = codigosEmCiclo(candidatasParaCiclo);
  const semCiclo: LinhaDeEntrada[] = [];
  for (const linha of semConflitoVigente) {
    if (emCiclo.has(linha.codigo)) {
      rejeitadas.push(rejeicao(linha, 'CICLO_HIERARQUICO'));
    } else {
      semCiclo.push(linha);
    }
  }

  // 5) conta-pai inexistente ou rejeitada — resolvido por ponto fixo, pois pai válido pode
  //    aparecer depois da filha e rejeição de pai propaga para a filha.
  const codigosValidosNoLote = new Set(semCiclo.map((l) => l.codigo));
  const codigosRejeitados = new Set(rejeitadas.map((r) => r.codigo).filter((c): c is string => c !== null));
  const pendentes = new Map(semCiclo.map((l) => [l.codigo, l]));
  const aceitas: LinhaAceita[] = [];

  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const [codigo, linha] of pendentes) {
      if (linha.contaPai === null) {
        aceitas.push(linha);
        pendentes.delete(codigo);
        mudou = true;
        continue;
      }
      if (vigentePorCodigo.has(linha.contaPai) && !vigentePorCodigo.get(linha.contaPai)?.arquivada) {
        aceitas.push(linha);
        pendentes.delete(codigo);
        mudou = true;
        continue;
      }
      if (aceitas.some((a) => a.codigo === linha.contaPai)) {
        aceitas.push(linha);
        pendentes.delete(codigo);
        mudou = true;
        continue;
      }
      if (codigosRejeitados.has(linha.contaPai) || !codigosValidosNoLote.has(linha.contaPai)) {
        if (!vigentePorCodigo.has(linha.contaPai)) {
          rejeitadas.push(rejeicao(linha, codigosRejeitados.has(linha.contaPai) ? 'CONTA_PAI_REJEITADA' : 'CONTA_PAI_INEXISTENTE'));
          codigosRejeitados.add(linha.codigo);
          pendentes.delete(codigo);
          mudou = true;
        }
      }
    }
  }

  // linhas restantes em `pendentes` dependem de um pai que também está pendente e nunca resolveu
  // (situação coberta pela detecção de ciclo acima; chegar aqui indica pai ausente do lote).
  for (const [, linha] of pendentes) {
    rejeitadas.push(rejeicao(linha, 'CONTA_PAI_INEXISTENTE'));
  }

  aceitas.sort((a, b) => a.numeroDaLinha - b.numeroDaLinha);
  rejeitadas.sort((a, b) => a.numeroDaLinha - b.numeroDaLinha);

  return { aceitas, rejeitadas };
};
