import { indicesDasColunasDe, type RegistroDoCsv } from '../plano-contas/csv.js';
import { CAMPOS_DE_EMPREGADO, type CampoDeEmpregado, type MapeamentoDeEmpregados } from './campos.js';
import type { LinhaBrutaDeEmpregado } from './validacao.js';

/**
 * Registros tokenizados → entrada da validação de empregados.
 *
 * Todo texto é aparado. A matrícula é aparada e levada a Unicode NFC (acento composto = decomposto),
 * sem mexer na caixa nem nos zeros à esquerda (`00123` ≠ `123`). CPF e datas seguem como vieram:
 * é a validação que os interpreta. Registro com campos a mais que o cabeçalho leva
 * `defeitoDeEstrutura`, que a validação transforma em rejeição da linha.
 */
export const normalizarLinhasDeEmpregados = (
  cabecalho: readonly string[],
  registros: readonly RegistroDoCsv[],
  mapeamento: MapeamentoDeEmpregados,
): readonly LinhaBrutaDeEmpregado[] => {
  const indices = indicesDasColunasDe(CAMPOS_DE_EMPREGADO, cabecalho, mapeamento);

  return registros.map((registro) => {
    const celula = (campo: CampoDeEmpregado): string => (registro.celulas[indices[campo]] ?? '').trim();
    return {
      numeroDaLinha: registro.numeroDaLinha,
      cpf: celula('cpf'),
      nome: celula('nome'),
      matricula: celula('matricula').normalize('NFC'),
      dataNascimento: celula('data_nascimento'),
      dataAdmissao: celula('data_admissao'),
      ...(registro.camposAMais > 0 ? { defeitoDeEstrutura: 'CAMPOS_A_MAIS' as const } : {}),
    };
  });
};
