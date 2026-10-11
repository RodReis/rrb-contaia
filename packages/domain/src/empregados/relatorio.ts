/**
 * Relatório CSV completo da importação de empregados (SPEC-014 §3.9), no mesmo formato da F13:
 * BOM UTF-8, `;`, CRLF e neutralização de fórmulas (a matrícula "+0012" sai com apóstrofo na frente).
 */
import { gerarRelatorioCsvDe } from '../plano-contas/relatorio.js';
import type { CodigoDeErroDeEmpregado } from './campos.js';

/** Valores como lidos do arquivo e o resultado da validação; compatível com a linha de staging. */
export type LinhaDoRelatorioDeEmpregados = Readonly<{
  numeroDaLinha: number;
  cpf: string | null;
  nome: string | null;
  matricula: string | null;
  dataNascimento: string | null;
  dataAdmissao: string | null;
  status: 'VALIDA' | 'REJEITADA';
  acao: 'INCLUIR' | 'ATUALIZAR' | null;
  codigoDeErro: CodigoDeErroDeEmpregado | null;
  campo: string | null;
  mensagem: string | null;
}>;

const COLUNAS = [
  'linha',
  'cpf',
  'nome',
  'matricula',
  'data_nascimento',
  'data_admissao',
  'status',
  'acao',
  'codigo_de_erro',
  'campo',
  'mensagem',
] as const;

export const gerarRelatorioCsvDeEmpregados = (
  linhas: AsyncIterable<LinhaDoRelatorioDeEmpregados>,
): AsyncGenerator<string, void, undefined> =>
  gerarRelatorioCsvDe(
    COLUNAS,
    (linha: LinhaDoRelatorioDeEmpregados) => [
      linha.numeroDaLinha,
      linha.cpf,
      linha.nome,
      linha.matricula,
      linha.dataNascimento,
      linha.dataAdmissao,
      linha.status,
      linha.acao,
      linha.codigoDeErro,
      linha.campo,
      linha.mensagem,
    ],
    linhas,
  );
