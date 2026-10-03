/**
 * Carteira do colaborador (SPEC-009).
 *
 * A carteira define EM QUAIS empresas o usuário atua; os papéis definem O QUE
 * ele faz. Uma condição nunca substitui a outra. Tudo aqui é cálculo puro: sem
 * banco, rede ou relógio.
 */
import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeValidacao } from '../erros.js';
import type { CampoInvalido } from '../erros.js';
import type { EstadoDoUsuario } from '../usuarios/ciclo-de-vida.js';

export type OperacaoDeCarteira = 'ADICIONAR' | 'REMOVER';

export type UsuarioParaCarteira = Readonly<{
  id: string;
  estado: EstadoDoUsuario;
  /** Revisão monotônica da carteira do usuário; só sobe quando o conjunto muda. */
  revisao: number;
  /** Empresas com vínculo ativo hoje. */
  empresasVinculadas: readonly string[];
}>;

export type EmpresaParaCarteira = Readonly<{
  id: string;
  status: 'CADASTRO_INCOMPLETO' | 'ATIVA';
  situacao: 'ativo' | 'arquivado';
}>;

export type EfeitoNoUsuario = Readonly<{
  usuarioId: string;
  adicionadas: readonly string[];
  removidas: readonly string[];
  revisaoNova: number;
}>;

export type PlanoDeCarteira = Readonly<{
  efeitos: readonly EfeitoNoUsuario[];
  /** Nada mudaria: a operação não gera evento, notificação nem revisão. */
  semEfeito: boolean;
}>;

/**
 * Convidado e convite expirado (ambos `CONVIDADO` no banco) recebem carteira
 * antes da ativação; suspenso preserva e continua editável; arquivado perdeu os
 * vínculos e só volta por novo convite e nova atribuição.
 */
export const usuarioPodeReceberCarteira = (estado: EstadoDoUsuario): boolean =>
  estado !== 'ARQUIVADO';

/** Somente empresa ativa recebe novo vínculo (SPEC-009 §3.4). */
export const empresaAceitaVinculo = (empresa: EmpresaParaCarteira): boolean =>
  empresa.status === 'ATIVA' && empresa.situacao === 'ativo';

const unicos = <T>(itens: readonly T[]): T[] => [...new Set(itens)];

type EntradaDoPlano = Readonly<{
  operacao: OperacaoDeCarteira;
  usuarios: readonly UsuarioParaCarteira[];
  empresas: readonly EmpresaParaCarteira[];
  /** Revisão que o cliente viu de cada colaborador, por id. */
  revisoesEsperadas: Readonly<Record<string, number>>;
}>;

const exigirRevisoesAtuais = (
  usuarios: readonly UsuarioParaCarteira[],
  esperadas: Readonly<Record<string, number>>,
): void => {
  const desatualizado = usuarios.some((u) => esperadas[u.id] !== u.revisao);
  if (desatualizado) {
    throw new ErroDeConflito(
      CODIGOS_DE_ERRO.REVISAO_NAO_CONFIRMADA,
      'A carteira mudou desde que você a abriu. Recarregue e revise antes de salvar.',
    );
  }
};

const problemasDoLote = ({
  operacao,
  usuarios,
  empresas,
}: Pick<EntradaDoPlano, 'operacao' | 'usuarios' | 'empresas'>): CampoInvalido[] => {
  const problemas: CampoInvalido[] = [];

  if (usuarios.length === 0) {
    problemas.push({ campo: 'usuarios', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO });
  }
  if (empresas.length === 0) {
    problemas.push({ campo: 'empresas', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO });
  }

  for (const usuario of usuarios) {
    if (!usuarioPodeReceberCarteira(usuario.estado)) {
      problemas.push({
        campo: `usuarios.${usuario.id}`,
        codigo: CODIGOS_DE_ERRO.USUARIO_ARQUIVADO_USE_NOVO_CONVITE,
      });
    }
  }

  // Remover vínculo de empresa arquivada é tolerado: o arquivamento já o encerrou.
  if (operacao === 'ADICIONAR') {
    for (const empresa of empresas) {
      if (!empresaAceitaVinculo(empresa)) {
        problemas.push({
          campo: `empresas.${empresa.id}`,
          codigo:
            empresa.situacao === 'arquivado'
              ? CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA
              : CODIGOS_DE_ERRO.ETAPA_INCOMPLETA,
        });
      }
    }
  }

  return problemas;
};

/**
 * Lote atômico (SPEC-009 §3.2): qualquer item inválido derruba a operação
 * inteira, listando todos os problemas. Revisão desatualizada é conflito e vale
 * antes das demais validações, porque o cliente decidiu sobre um estado velho.
 */
export const planejarOperacao = (entrada: EntradaDoPlano): PlanoDeCarteira => {
  const usuarios = [...new Map(entrada.usuarios.map((u) => [u.id, u])).values()];
  const empresas = [...new Map(entrada.empresas.map((e) => [e.id, e])).values()];

  exigirRevisoesAtuais(usuarios, entrada.revisoesEsperadas);

  const problemas = problemasDoLote({ operacao: entrada.operacao, usuarios, empresas });
  if (problemas.length > 0) {
    throw new ErroDeValidacao(problemas);
  }

  const idsDasEmpresas = unicos(empresas.map((e) => e.id));
  const efeitos: EfeitoNoUsuario[] = [];

  for (const usuario of usuarios) {
    const vinculadas = new Set(usuario.empresasVinculadas);
    const adicionadas =
      entrada.operacao === 'ADICIONAR' ? idsDasEmpresas.filter((id) => !vinculadas.has(id)) : [];
    const removidas =
      entrada.operacao === 'REMOVER' ? idsDasEmpresas.filter((id) => vinculadas.has(id)) : [];

    if (adicionadas.length === 0 && removidas.length === 0) {
      continue;
    }
    efeitos.push({ usuarioId: usuario.id, adicionadas, removidas, revisaoNova: usuario.revisao + 1 });
  }

  return { efeitos, semEfeito: efeitos.length === 0 };
};

export type DecisaoDeAcesso =
  | 'PERMITIDO'
  | 'EMPRESA_INEXISTENTE'
  | 'USUARIO_INATIVO'
  | 'FORA_DA_CARTEIRA'
  | 'SEM_PERMISSAO';

/**
 * Decisão de acesso empresarial (SPEC-009 §3.5), na ordem da SPEC: tenant,
 * usuário ativo, vínculo na carteira, permissão do papel. Empresa de outro
 * tenant é indistinguível de inexistente — nada vaza.
 */
export const decidirAcessoEmpresarial = (
  entrada: Readonly<{
    empresaDoTenant: boolean;
    usuarioAtivo: boolean;
    vinculoAtivo: boolean;
    permissaoConcedida: boolean;
  }>,
): DecisaoDeAcesso => {
  if (!entrada.empresaDoTenant) return 'EMPRESA_INEXISTENTE';
  if (!entrada.usuarioAtivo) return 'USUARIO_INATIVO';
  if (!entrada.vinculoAtivo) return 'FORA_DA_CARTEIRA';
  if (!entrada.permissaoConcedida) return 'SEM_PERMISSAO';
  return 'PERMITIDO';
};

type EntradaDaAlteracao = Readonly<{
  usuarios: readonly UsuarioParaCarteira[];
  /** Empresas realmente encontradas no tenant, entre as pedidas. */
  empresas: readonly EmpresaParaCarteira[];
  adicionar: readonly string[];
  remover: readonly string[];
  revisoesEsperadas: Readonly<Record<string, number>>;
}>;

const problemasDeSelecao = (entrada: EntradaDaAlteracao): CampoInvalido[] => {
  const problemas: CampoInvalido[] = [];
  const conhecidas = new Set(entrada.empresas.map((e) => e.id));
  const pedidas = unicos([...entrada.adicionar, ...entrada.remover]);

  if (pedidas.length === 0) {
    problemas.push({ campo: 'empresas', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO });
  }
  for (const id of pedidas) {
    if (!conhecidas.has(id)) {
      problemas.push({ campo: `empresas.${id}`, codigo: CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA });
    }
  }
  const remover = new Set(entrada.remover);
  for (const id of unicos(entrada.adicionar).filter((id) => remover.has(id))) {
    problemas.push({ campo: `empresas.${id}`, codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO });
  }
  return problemas;
};

/**
 * Alteração completa de carteira: adições e remoções na mesma operação (a
 * página de gestão individual salva as duas de uma vez; a Central em lote usa
 * só um lado). Cada colaborador afetado ganha uma única revisão nova.
 */
export const planejarAlteracao = (entrada: EntradaDaAlteracao): PlanoDeCarteira => {
  const usuarios = [...new Map(entrada.usuarios.map((u) => [u.id, u])).values()];

  exigirRevisoesAtuais(usuarios, entrada.revisoesEsperadas);

  const problemas = problemasDeSelecao(entrada);
  if (problemas.length > 0) {
    throw new ErroDeValidacao(problemas);
  }

  const doLado = (ids: readonly string[]): EmpresaParaCarteira[] =>
    entrada.empresas.filter((e) => ids.includes(e.id));
  const planos = (
    [
      ['ADICIONAR', entrada.adicionar],
      ['REMOVER', entrada.remover],
    ] as const
  )
    .filter(([, ids]) => ids.length > 0)
    .map(([operacao, ids]) =>
      planejarOperacao({
        operacao,
        usuarios,
        empresas: doLado(ids),
        revisoesEsperadas: entrada.revisoesEsperadas,
      }),
    );

  const porUsuario = new Map<string, EfeitoNoUsuario>();
  for (const efeito of planos.flatMap((plano) => plano.efeitos)) {
    const anterior = porUsuario.get(efeito.usuarioId);
    porUsuario.set(
      efeito.usuarioId,
      anterior === undefined
        ? efeito
        : {
            usuarioId: efeito.usuarioId,
            adicionadas: [...anterior.adicionadas, ...efeito.adicionadas],
            removidas: [...anterior.removidas, ...efeito.removidas],
            revisaoNova: efeito.revisaoNova,
          },
    );
  }

  const efeitos = [...porUsuario.values()];
  return { efeitos, semEfeito: efeitos.length === 0 };
};
