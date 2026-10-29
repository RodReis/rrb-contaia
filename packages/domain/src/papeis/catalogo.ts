/**
 * Catálogo controlado de permissões (SPEC-008 §3.2).
 *
 * Só entra aqui capacidade já entregue por SPEC aprovada. A chave é estável
 * (`<módulo>.<funcionalidade>.<ação>`): renomear o texto de interface não cria
 * permissão nova. O servidor autoriza por chave; a interface só lê este catálogo.
 */

export const ROTULO_DA_ACAO = {
  consultar: 'Consultar',
  criar: 'Criar',
  editar: 'Editar',
  arquivar: 'Arquivar',
  reativar: 'Reativar',
  dispensar: 'Dispensar',
  desativar: 'Desativar',
  enviar: 'Enviar',
  substituir: 'Substituir',
  visualizar: 'Visualizar',
  baixar: 'Baixar',
  aprovar: 'Aprovar',
  rejeitar: 'Rejeitar',
  abrir_origem: 'Abrir origem',
  marcar_lida: 'Marcar como lida',
  administrar: 'Administrar',
  testar: 'Testar',
  importar: 'Importar',
  confirmar_importacao: 'Confirmar importação',
  baixar_relatorio: 'Baixar relatório',
  simular: 'Simular',
  manter_plano_contas: 'Manter plano de contas',
  manter_centros_custo: 'Manter centros de custo',
  preparar_rascunho: 'Preparar rascunho',
  efetivar: 'Efetivar',
  cancelar_estornar: 'Cancelar e estornar',
  reabrir: 'Reabrir',
  reprocessar: 'Reprocessar',
  publicar: 'Publicar',
  revelar: 'Revelar',
  confirmar: 'Confirmar',
  operar: 'Operar',
  revogar: 'Revogar',
  manter_regras: 'Manter regras',
  processar_origens: 'Processar origens',
} as const;

export type AcaoDoCatalogo = keyof typeof ROTULO_DA_ACAO;

type Funcionalidade = Readonly<{
  id: string;
  rotulo: string;
  acoes: readonly (AcaoDoCatalogo | 'revelar')[];
}>;

type Modulo = Readonly<{
  id: string;
  rotulo: string;
  funcionalidades: readonly Funcionalidade[];
}>;

export const CATALOGO = [
  {
    id: 'escritorio',
    rotulo: 'Cadastro do escritório',
    funcionalidades: [{ id: 'dados', rotulo: 'Dados do escritório', acoes: ['consultar', 'editar'] }],
  },
  {
    id: 'empresas',
    rotulo: 'Empresas',
    funcionalidades: [
      {
        id: 'cadastro',
        rotulo: 'Cadastro e ciclo de vida',
        acoes: ['consultar', 'criar', 'editar', 'arquivar', 'reativar'],
      },
      { id: 'historico', rotulo: 'Histórico cadastral', acoes: ['consultar'] },
      // SPEC-013: importação por CSV. Confirmar não implica Importar; toda ação implica Consultar.
      {
        id: 'plano_contas',
        rotulo: 'Plano de contas',
        acoes: ['consultar', 'importar', 'confirmar_importacao', 'baixar_relatorio'],
      },
      // SPEC-014: importação de empregados por CSV, mesmas quatro ações e mesmas dependências.
      {
        id: 'empregados',
        rotulo: 'Empregados',
        acoes: ['consultar', 'importar', 'confirmar_importacao', 'baixar_relatorio'],
      },
    ],
  },
  {
    id: 'contabil',
    rotulo: 'Contabilidade',
    funcionalidades: [
      {
        id: 'estrutura_contabil',
        rotulo: 'Estrutura contábil',
        acoes: ['consultar', 'manter_plano_contas', 'manter_centros_custo', 'arquivar', 'reativar'],
      },
      {
        id: 'lancamentos',
        rotulo: 'Lançamentos',
        acoes: ['consultar', 'preparar_rascunho', 'efetivar', 'cancelar_estornar'],
      },
      {
        id: 'automatizacao',
        rotulo: 'Automatização contábil',
        acoes: ['consultar', 'simular', 'manter_regras', 'publicar', 'processar_origens'],
      },
    ],
  },
  {
    id: 'documentos',
    rotulo: 'Documentos da empresa',
    funcionalidades: [
      { id: 'exigencias', rotulo: 'Exigências', acoes: ['consultar', 'criar', 'dispensar'] },
      {
        id: 'arquivos',
        rotulo: 'Arquivos e versões',
        acoes: ['consultar', 'enviar', 'substituir', 'visualizar', 'baixar'],
      },
      { id: 'analise', rotulo: 'Análise documental', acoes: ['consultar', 'aprovar', 'rejeitar'] },
      { id: 'historico', rotulo: 'Histórico documental', acoes: ['consultar'] },
    ],
  },
  {
    id: 'pendencias',
    rotulo: 'Central de Pendências',
    funcionalidades: [
      { id: 'pendencias', rotulo: 'Pendências', acoes: ['consultar', 'abrir_origem'] },
    ],
  },
  {
    id: 'notificacoes',
    rotulo: 'Notificações de pendências',
    funcionalidades: [
      { id: 'sino', rotulo: 'Sino e histórico', acoes: ['consultar', 'marcar_lida'] },
    ],
  },
  {
    id: 'certificados',
    rotulo: 'Cofre de certificados A1',
    funcionalidades: [
      {
        id: 'cofre',
        rotulo: 'Cofre',
        acoes: ['consultar', 'criar', 'substituir', 'editar', 'desativar'],
      },
      { id: 'historico', rotulo: 'Histórico de certificados', acoes: ['consultar'] },
      // SPEC-012: estado, histórico e teste manual do Signer. `Testar` só dispara o diagnóstico
      // do próprio Signer — ninguém assina XML pela interface.
      { id: 'signer', rotulo: 'Signer (mTLS de teste)', acoes: ['consultar', 'testar'] },
    ],
  },
  {
    // SPEC-025: gestão local, sem integração oficial com a RFB.
    id: 'procuracoes',
    rotulo: 'Procurações RFB/e-CAC',
    funcionalidades: [
      {
        id: 'registro',
        rotulo: 'Registro e operações RFB simuladas',
        acoes: ['consultar', 'administrar', 'confirmar', 'testar', 'operar', 'revogar', 'arquivar'],
      },
    ],
  },
  {
    id: 'obrigacoes',
    rotulo: 'Agenda de obrigações',
    funcionalidades: [
      { id: 'agenda', rotulo: 'Agenda e ocorrências', acoes: ['consultar', 'baixar', 'reabrir', 'reprocessar'] },
    ],
  },
  {
    // SPEC-016 §3.7: consultar regras publicadas e simular. Criar, editar, publicar e arquivar o
    // catálogo é do `super_admin` da plataforma (papel de realm), nunca de papel de escritório.
    id: 'fiscal',
    rotulo: 'Motor tributário',
    funcionalidades: [
      { id: 'motor_tributario', rotulo: 'Regras publicadas e simulador', acoes: ['consultar', 'simular'] },
    ],
  },
  {
    id: 'historico',
    rotulo: 'Histórico de Informações',
    funcionalidades: [{ id: 'global', rotulo: 'Histórico global', acoes: ['consultar'] }],
  },
] as const satisfies readonly Modulo[];

/**
 * Área exclusiva do `admin_escritorio` (SPEC-008 §3.3): aparece no editor
 * bloqueada e nunca entra na matriz de um papel personalizado. `auditor_readonly`
 * mantém somente a permissão padrão de consulta de usuários; payload integral é admin-only (SPEC-024).
 */
export const AREA_EXCLUSIVA = {
  id: 'usuarios',
  rotulo: 'Usuários e permissões',
  funcionalidades: [
    {
      id: 'usuarios_e_papeis',
      rotulo: 'Usuários e papéis',
      acoes: ['consultar', 'administrar'],
    },
    {
      id: 'auditoria_payload',
      rotulo: 'Conteúdo integral da auditoria',
      acoes: ['revelar'],
    },
  ],
} as const satisfies Modulo;

type ChavesDe<M> = M extends {
  id: infer Mod extends string;
  funcionalidades: readonly (infer F)[];
}
  ? F extends { id: infer Fun extends string; acoes: readonly (infer A extends string)[] }
    ? `${Mod}.${Fun}.${A}`
    : never
  : never;

export type ChaveDoCatalogo = ChavesDe<(typeof CATALOGO)[number]>;
export type ChaveExclusiva = ChavesDe<typeof AREA_EXCLUSIVA>;
export type ChaveDePermissao = ChaveDoCatalogo | ChaveExclusiva;

const chavesDoModuloDef = (modulo: Modulo): readonly string[] =>
  modulo.funcionalidades.flatMap((funcionalidade) =>
    funcionalidade.acoes.map((acao) => `${modulo.id}.${funcionalidade.id}.${acao}`),
  );

export const CHAVES_DO_CATALOGO: readonly ChaveDoCatalogo[] = CATALOGO.flatMap(
  chavesDoModuloDef,
) as ChaveDoCatalogo[];

export const CHAVES_EXCLUSIVAS: readonly ChaveExclusiva[] = chavesDoModuloDef(
  AREA_EXCLUSIVA,
) as ChaveExclusiva[];

const NO_CATALOGO: ReadonlySet<string> = new Set(CHAVES_DO_CATALOGO);
const EXCLUSIVAS: ReadonlySet<string> = new Set(CHAVES_EXCLUSIVAS);

export const ehChaveDoCatalogo = (valor: unknown): valor is ChaveDoCatalogo =>
  typeof valor === 'string' && NO_CATALOGO.has(valor);

export const ehChaveExclusiva = (valor: unknown): valor is ChaveExclusiva =>
  typeof valor === 'string' && EXCLUSIVAS.has(valor);

export const moduloDa = (chave: ChaveDePermissao): string => chave.split('.')[0] ?? '';

/** Chaves de um módulo do catálogo (ou da área exclusiva), na ordem do catálogo. */
export const chavesDoModulo = (moduloId: string): readonly ChaveDePermissao[] =>
  [...CHAVES_DO_CATALOGO, ...CHAVES_EXCLUSIVAS].filter((chave) => moduloDa(chave) === moduloId);

/**
 * `Consultar` da mesma funcionalidade, que toda outra ação implica (SPEC-008
 * §3.3). `null` para o próprio `Consultar`.
 */
export const consultaImplicada = (chave: ChaveDePermissao): ChaveDePermissao | null => {
  const [modulo, funcionalidade, acao] = chave.split('.');

  return acao === 'consultar' ? null : (`${modulo}.${funcionalidade}.consultar` as ChaveDePermissao);
};

/**
 * Dependência além de `Consultar`: substituir um arquivo é enviar uma versão nova pela mesma
 * rota, então `Substituir` sem `Enviar` seria permissão que não concede nada (403). O editor
 * e o servidor tratam as duas como par: conceder `Substituir` concede `Enviar`.
 */
export const ENVIO_IMPLICADO: Readonly<Partial<Record<ChaveDePermissao, ChaveDePermissao>>> = {
  'documentos.arquivos.substituir': 'documentos.arquivos.enviar',
};

/** Chaves que dependem de `Consultar` na mesma funcionalidade. */
export const dependentesDeConsulta = (chave: ChaveDePermissao): readonly ChaveDePermissao[] => {
  const [modulo, funcionalidade, acao] = chave.split('.');

  if (acao !== 'consultar') {
    return [];
  }

  return [...CHAVES_DO_CATALOGO, ...CHAVES_EXCLUSIVAS].filter((candidata) => {
    const [m, f, a] = candidata.split('.');

    return m === modulo && f === funcionalidade && a !== 'consultar';
  });
};
