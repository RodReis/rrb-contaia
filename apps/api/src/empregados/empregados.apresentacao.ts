/**
 * Saída da importação de empregados (SPEC-014 §3.5, §3.9): o envelope comum da prévia com a
 * rejeição de empregado (CPF e matrícula como vieram) e o diagnóstico que diz o que não mudou.
 */
import type { DiagnosticoDaTentativa, TentativaDoCiclo } from '@contaia/db';
import type { PreviaDaImportacaoDeEmpregados, RejeicaoDeEmpregado } from '@contaia/shared';

import { mensagensDoDiagnostico, montarPrevia, paraDiagnosticoCom } from '../importacao/apresentacao';

const MENSAGENS_DO_DIAGNOSTICO = mensagensDoDiagnostico(
  'Uma falha técnica interrompeu a aplicação e nenhum empregado foi alterado. Envie o arquivo de novo.',
);

export const paraPreviaDeEmpregados = (
  tentativa: TentativaDoCiclo,
  amostra: readonly RejeicaoDeEmpregado[],
  diagnostico: DiagnosticoDaTentativa | null,
): PreviaDaImportacaoDeEmpregados =>
  montarPrevia(tentativa, tentativa.versaoNaValidacao, amostra, paraDiagnosticoCom(MENSAGENS_DO_DIAGNOSTICO, diagnostico, tentativa.formato));
