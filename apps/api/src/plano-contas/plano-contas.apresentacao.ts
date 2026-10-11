/**
 * DTOs de saída da importação do plano de contas (SPEC-013 §3.5, §3.9). A entidade persistida
 * nunca sai como veio: tenant, iniciador, chave do storage e a versão interna da conta ficam no
 * servidor. As flags de ação saem do estado — a permissão continua conferida em cada rota.
 */
import type {
  ContaDoPlano,
  DiagnosticoDaTentativa,
  PaginaDeRejeicoes,
  PaginaDoPlano,
  RejeicaoDaLinha,
  TentativaDeImportacao,
} from '@contaia/db';
import type {
  ContaDoPlanoDeContas,
  DiagnosticoDaImportacao,
  PaginaDeRejeicoesDaImportacao,
  PaginaDoPlanoDeContas,
  PreviaDaImportacao,
  RejeicaoDaImportacao,
} from '@contaia/shared';

import { mensagensDoDiagnostico, montarPrevia, paraDiagnosticoCom } from '../importacao/apresentacao';

export { relatorioDisponivel, temDiagnostico, temResultadoDaValidacao } from '../importacao/apresentacao';

const paraRejeicao = (rejeicao: RejeicaoDaLinha): RejeicaoDaImportacao => ({
  numeroDaLinha: rejeicao.numeroDaLinha,
  codigo: rejeicao.codigo,
  campo: rejeicao.campo,
  codigoDeErro: rejeicao.codigoDeErro,
  mensagem: rejeicao.mensagem,
});

export const paraPaginaDeRejeicoes = (pagina: PaginaDeRejeicoes): PaginaDeRejeicoesDaImportacao => ({
  pagina: pagina.pagina,
  itensPorPagina: pagina.itensPorPagina,
  total: pagina.total,
  itens: pagina.itens.map(paraRejeicao),
});

const MENSAGENS_DO_DIAGNOSTICO = mensagensDoDiagnostico(
  'Uma falha técnica interrompeu a aplicação e nenhuma conta foi alterada. Envie o arquivo de novo.',
);

export const paraDiagnostico = (diagnostico: DiagnosticoDaTentativa | null): DiagnosticoDaImportacao | null =>
  paraDiagnosticoCom(MENSAGENS_DO_DIAGNOSTICO, diagnostico);

export const paraPrevia = (
  tentativa: TentativaDeImportacao,
  amostra: readonly RejeicaoDaLinha[],
  diagnostico: DiagnosticoDaTentativa | null = null,
): PreviaDaImportacao =>
  montarPrevia(tentativa, tentativa.planoVersaoNaValidacao, amostra.map(paraRejeicao), paraDiagnostico(diagnostico));

const paraConta = (conta: ContaDoPlano): ContaDoPlanoDeContas => ({
  id: conta.id,
  codigo: conta.codigo,
  nome: conta.nome,
  tipo: conta.tipo,
  natureza: conta.natureza,
  contaPai: conta.contaPai,
  arquivada: conta.arquivada,
  atualizadoEm: conta.atualizadoEm.toISOString(),
});

export const paraPaginaDoPlano = (pagina: PaginaDoPlano): PaginaDoPlanoDeContas => ({
  pagina: pagina.pagina,
  itensPorPagina: pagina.itensPorPagina,
  total: pagina.total,
  itens: pagina.itens.map(paraConta),
});
