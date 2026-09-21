/**
 * Casos de uso dos documentos da empresa (SPEC-004 §7, categoria Regras).
 *
 * O banco e o storage entram por dublê: o que se prova aqui é a decisão do
 * caso de uso — o upload nunca aprova sozinho, a substituição arquiva a
 * anterior, falha de leitura não registra acesso concluído, e a empresa
 * arquivada não aceita escrita. A persistência real tem provas próprias em
 * `packages/db`.
 */
import { CODIGOS_DE_ERRO } from '@contaia/domain';
import type { ErroDeDominio } from '@contaia/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentosDaEmpresaService } from './documentos.service';

const AUTOR = { usuarioId: '00000000-0000-7000-8000-00000000aaaa' } as const;
const TENANT = '00000000-0000-7000-8000-00000000bbbb';
const EMPRESA = '00000000-0000-7000-8000-00000000cccc';
const EXIGENCIA = '00000000-0000-7000-8000-00000000dddd';
const VERSAO = '00000000-0000-7000-8000-00000000eeee';
const HOJE = new Date('2026-09-20T12:00:00Z');

const empresaPersistida = (situacao: 'ativo' | 'arquivado' = 'ativo') => ({
  id: EMPRESA,
  situacao,
  cadastro: {
    status: 'ATIVA' as const,
    identificacao: { cnpj: '11222333000181', razaoSocial: 'Alfa Ltda' },
    dadosFiscais: {
      inscricaoEstadual: { situacao: 'ISENTO', numero: null },
      inscricaoMunicipal: { situacao: 'NAO_SE_APLICA', numero: null },
    },
    enderecoPrincipal: null,
    situacaoCadastralExterna: 'Ativa',
    validadoPorFonteExterna: true,
    versao: 1,
  },
});

const exigenciaPersistida = (
  sobrescrita: Partial<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  id: EXIGENCIA,
  codigo: 'CARTAO_CNPJ',
  nome: 'Cartão CNPJ',
  descricao: null,
  dataLimite: null,
  estado: 'PENDENTE',
  justificativa: null,
  aplicavel: true,
  versao: 0,
  ...sobrescrita,
});

const versaoPersistida = (
  sobrescrita: Partial<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  id: VERSAO,
  exigenciaId: EXIGENCIA,
  numero: 1,
  chaveStorage: 'tenant/documento_da_empresa/arquivo.pdf',
  nomeOriginal: 'cartao.pdf',
  tipoConteudo: 'application/pdf',
  tamanhoBytes: 2048,
  validade: null,
  vigente: true,
  enviadoPor: AUTOR.usuarioId,
  criadoEm: '2026-09-20T12:00:00.000Z',
  ...sobrescrita,
});

const { estado } = vi.hoisted(() => ({
  estado: {
    empresa: null as Record<string, unknown> | null,
    exigencias: [] as Record<string, unknown>[],
    versoes: [] as Record<string, unknown>[],
    eventos: [] as Record<string, unknown>[],
    versaoInserida: null as Record<string, unknown> | null,
    arquivamentos: 0,
    gravacaoAceita: true,
    estadoDefinido: null as Record<string, unknown> | null,
    origemReconciliada: null as string | null,
  },
}));

vi.mock('@contaia/db', () => ({
  comContextoDeTenant: async (
    _pool: unknown,
    _tenantId: string,
    executar: (cliente: unknown) => Promise<unknown>,
  ) => executar({}),
  carregarEmpresa: async () => estado.empresa,
  listarExigencias: async () => estado.exigencias,
  carregarExigencia: async (_c: unknown, _t: string, _e: string, id: string) =>
    estado.exigencias.find((exigencia) => exigencia['id'] === id) ?? null,
  inserirExigencia: async (
    _c: unknown,
    _t: string,
    _e: string,
    exigencia: Record<string, unknown>,
  ) => {
    const id = `novo-${estado.exigencias.length}`;
    estado.exigencias.push({ ...exigenciaPersistida(), ...exigencia, id });

    return id;
  },
  definirEstadoDaExigencia: async (
    _c: unknown,
    _t: string,
    _e: string,
    _id: string,
    entrada: Record<string, unknown>,
  ) => {
    estado.estadoDefinido = entrada;

    return estado.gravacaoAceita;
  },
  definirAplicabilidade: async () => undefined,
  listarVersoes: async () => estado.versoes,
  carregarVersao: async (_c: unknown, _t: string, _e: string, id: string) =>
    estado.versoes.find((versao) => versao['id'] === id) ?? null,
  carregarVersaoVigente: async () =>
    estado.versoes.find((versao) => versao['vigente'] === true) ?? null,
  arquivarVersaoVigente: async () => {
    estado.arquivamentos += 1;
    estado.versoes = estado.versoes.map((versao) => ({ ...versao, vigente: false }));
  },
  inserirVersao: async (
    _c: unknown,
    _t: string,
    _e: string,
    versao: Record<string, unknown>,
  ) => {
    const inserida = versaoPersistida({
      ...versao,
      id: `versao-${estado.versoes.length + 1}`,
      numero: estado.versoes.length + 1,
      vigente: true,
    });

    estado.versaoInserida = inserida;
    estado.versoes = [inserida, ...estado.versoes];

    return inserida;
  },
  registrarEventosDocumentais: async (
    _c: unknown,
    _t: string,
    eventos: Record<string, unknown>[],
  ) => {
    estado.eventos.push(...eventos);
  },
  listarHistoricoDocumental: async () => ({ eventos: [], total: 0 }),
  // Central de Pendências (SPEC-005): os hooks de reconciliação chamam estas
  // duas direto no repositório, dentro da mesma transação. Sem mocká-las, o
  // teste chamaria a implementação real e tentaria conectar ao banco.
  //
  // Captura a `origem` recebida: prova do achado CRITICAL — o hook documental
  // precisa filtrar só 'DOCUMENTAL', nunca ver pendências CADASTRAIS abertas.
  listarAbertasDaEmpresa: async (_c: unknown, _e: string, origem: string | null) => {
    estado.origemReconciliada = origem;

    return [];
  },
  reconciliar: async () => undefined,
}));

const storage = {
  enviar: vi.fn(async () => 'tenant/documento_da_empresa/novo.pdf'),
  obter: vi.fn(async () => ({
    conteudo: Buffer.from('conteudo'),
    tipoConteudo: 'application/pdf',
  })),
};

const criarService = (): DocumentosDaEmpresaService =>
  new DocumentosDaEmpresaService(
    { instancia: {} } as never,
    storage as never,
  );

/** Com assinatura `%PDF`: o caso de uso confere os bytes, não só o tipo. */
const pdf = (tamanho = 2048) => {
  const conteudo = Buffer.alloc(tamanho, 1);
  conteudo.write('%PDF-1.4', 0, 'ascii');

  return { nomeOriginal: 'cartao.pdf', tipoConteudo: 'application/pdf', conteudo } as const;
};

const codigoDoErro = async (executar: () => Promise<unknown>): Promise<string> => {
  try {
    await executar();
  } catch (erro) {
    return (erro as ErroDeDominio).codigo;
  }

  throw new Error('esperava erro de domínio');
};

beforeEach(() => {
  estado.empresa = empresaPersistida();
  estado.exigencias = [exigenciaPersistida()];
  estado.versoes = [];
  estado.eventos = [];
  estado.versaoInserida = null;
  estado.arquivamentos = 0;
  estado.gravacaoAceita = true;
  estado.estadoDefinido = null;
  storage.enviar.mockClear();
  storage.obter.mockClear();
});

describe('checklist padrão', () => {
  it('é semeado na primeira abertura, respeitando a aplicabilidade do cadastro', async () => {
    estado.exigencias = [];

    const visao = await criarService().consultar(TENANT, EMPRESA, AUTOR, HOJE);

    const estadual = visao.exigencias.find(
      (exigencia) => exigencia.codigo === 'INSCRICAO_ESTADUAL',
    );
    const municipal = visao.exigencias.find(
      (exigencia) => exigencia.codigo === 'INSCRICAO_MUNICIPAL',
    );

    expect(visao.exigencias).toHaveLength(7);
    // Isento exige comprovante de isenção; não se aplica não exige nada.
    expect(estadual?.aplicavel).toBe(true);
    expect(municipal?.aplicavel).toBe(false);
  });

  it('não duplica na segunda abertura', async () => {
    estado.exigencias = [];
    const service = criarService();

    await service.consultar(TENANT, EMPRESA, AUTOR, HOJE);
    const segunda = await service.consultar(TENANT, EMPRESA, AUTOR, HOJE);

    expect(segunda.exigencias).toHaveLength(7);
  });

  it('cada exigência criada gera evento auditável', async () => {
    estado.exigencias = [];

    await criarService().consultar(TENANT, EMPRESA, AUTOR, HOJE);

    expect(estado.eventos.filter((evento) => evento['acao'] === 'EXIGENCIA_CRIADA')).toHaveLength(
      7,
    );
  });

  it('reconcilia a Central assim que semeia o checklist (achado IMPORTANT)', async () => {
    // Antes da correção, o checklist padrão só virava pendência na Central na
    // próxima mutação (envio, análise etc.) — não na primeira abertura da aba.
    estado.exigencias = [];

    await criarService().consultar(TENANT, EMPRESA, AUTOR, HOJE);

    expect(estado.origemReconciliada).toBe('DOCUMENTAL');
  });
});

describe('envio de arquivo', () => {
  it('entra como ENVIADO e nunca aprova sozinho, mesmo vindo do administrador', async () => {
    await criarService().enviarArquivo(
      TENANT,
      EMPRESA,
      EXIGENCIA,
      AUTOR,
      pdf(),
      null,
      0,
      HOJE,
    );

    expect(estado.estadoDefinido?.['estado']).toBe('ENVIADO');
    expect(estado.eventos.at(-1)?.['acao']).toBe('ENVIO');
    expect(estado.eventos.at(-1)?.['estadoNovo']).toBe('ENVIADO');
  });

  it('recusa formato fora de PDF, JPG e PNG antes de subir qualquer byte', async () => {
    const codigo = await codigoDoErro(() =>
      criarService().enviarArquivo(
        TENANT,
        EMPRESA,
        EXIGENCIA,
        AUTOR,
        {
          nomeOriginal: 'contrato.docx',
          tipoConteudo:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          conteudo: Buffer.alloc(16, 1),
        },
        null,
        0,
        HOJE,
      ),
    );

    expect(codigo).toBe(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO);
    expect(storage.enviar).not.toHaveBeenCalled();
  });

  it('recusa arquivo acima de 20 MB antes de subir qualquer byte', async () => {
    const codigo = await codigoDoErro(() =>
      criarService().enviarArquivo(
        TENANT,
        EMPRESA,
        EXIGENCIA,
        AUTOR,
        pdf(20 * 1024 * 1024 + 1),
        null,
        0,
        HOJE,
      ),
    );

    expect(codigo).toBe(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO);
    expect(storage.enviar).not.toHaveBeenCalled();
  });

  it('substituição arquiva a vigente e registra SUBSTITUICAO, não ENVIO', async () => {
    estado.exigencias = [exigenciaPersistida({ estado: 'APROVADO' })];
    estado.versoes = [versaoPersistida()];

    await criarService().enviarArquivo(
      TENANT,
      EMPRESA,
      EXIGENCIA,
      AUTOR,
      pdf(),
      null,
      0,
      HOJE,
    );

    expect(estado.arquivamentos).toBe(1);
    expect(estado.eventos.at(-1)?.['acao']).toBe('SUBSTITUICAO');
    // Documento substituído volta para análise: aprovado não permanece.
    expect(estado.estadoDefinido?.['estado']).toBe('ENVIADO');
  });

  it('recusa envio em exigência que não se aplica à empresa', async () => {
    estado.exigencias = [exigenciaPersistida({ aplicavel: false })];

    const codigo = await codigoDoErro(() =>
      criarService().enviarArquivo(TENANT, EMPRESA, EXIGENCIA, AUTOR, pdf(), null, 0, HOJE),
    );

    expect(codigo).toBe(CODIGOS_DE_ERRO.EXIGENCIA_NAO_APLICAVEL);
    expect(storage.enviar).not.toHaveBeenCalled();
  });

  it('recusa envio em exigência dispensada: a dispensa precisa ser revertida antes', async () => {
    estado.exigencias = [
      exigenciaPersistida({ estado: 'DISPENSADO', justificativa: 'Liberada.' }),
    ];

    const codigo = await codigoDoErro(() =>
      criarService().enviarArquivo(TENANT, EMPRESA, EXIGENCIA, AUTOR, pdf(), null, 0, HOJE),
    );

    expect(codigo).toBe(CODIGOS_DE_ERRO.TRANSICAO_DOCUMENTAL_INVALIDA);
    expect(storage.enviar).not.toHaveBeenCalled();
  });

  it('empresa arquivada não recebe documento', async () => {
    estado.empresa = empresaPersistida('arquivado');

    const codigo = await codigoDoErro(() =>
      criarService().enviarArquivo(TENANT, EMPRESA, EXIGENCIA, AUTOR, pdf(), null, 0, HOJE),
    );

    expect(codigo).toBe(CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA);
  });

  it('recusa validade fora do formato de data civil', async () => {
    const codigo = await codigoDoErro(() =>
      criarService().enviarArquivo(
        TENANT,
        EMPRESA,
        EXIGENCIA,
        AUTOR,
        pdf(),
        '20/09/2026',
        0,
        HOJE,
      ),
    );

    expect(codigo).toBe(CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO);
  });
});

describe('análise', () => {
  it('aprova o que está aguardando análise e registra o evento', async () => {
    estado.exigencias = [exigenciaPersistida({ estado: 'ENVIADO' })];
    estado.versoes = [versaoPersistida()];

    await criarService().aprovar(TENANT, EMPRESA, EXIGENCIA, AUTOR, 0, HOJE);

    expect(estado.estadoDefinido?.['estado']).toBe('APROVADO');
    expect(estado.eventos.at(-1)).toMatchObject({
      acao: 'APROVACAO',
      estadoAnterior: 'ENVIADO',
      estadoNovo: 'APROVADO',
      usuarioId: AUTOR.usuarioId,
    });
  });

  it('não aprova exigência sem arquivo enviado', async () => {
    const codigo = await codigoDoErro(() =>
      criarService().aprovar(TENANT, EMPRESA, EXIGENCIA, AUTOR, 0, HOJE),
    );

    expect(codigo).toBe(CODIGOS_DE_ERRO.DOCUMENTO_SEM_ARQUIVO);
  });

  it('rejeição registra a justificativa e mantém a exigência pendente de nova versão', async () => {
    estado.exigencias = [exigenciaPersistida({ estado: 'ENVIADO' })];
    estado.versoes = [versaoPersistida()];

    await criarService().rejeitar(
      TENANT,
      EMPRESA,
      EXIGENCIA,
      AUTOR,
      'Documento ilegível.',
      0,
      HOJE,
    );

    expect(estado.estadoDefinido).toMatchObject({
      estado: 'REJEITADO',
      justificativa: 'Documento ilegível.',
    });
    expect(estado.eventos.at(-1)?.['justificativa']).toBe('Documento ilegível.');
  });

  it('dispensa não exige arquivo, mas exige justificativa', async () => {
    await criarService().dispensar(
      TENANT,
      EMPRESA,
      EXIGENCIA,
      AUTOR,
      'Empresa dispensada por decisão do escritório.',
      0,
      HOJE,
    );

    expect(estado.estadoDefinido?.['estado']).toBe('DISPENSADO');
    expect(estado.eventos.at(-1)?.['acao']).toBe('DISPENSA');
  });

  it('não aprova documento vencido: o estado analisado é o observado', async () => {
    estado.exigencias = [exigenciaPersistida({ estado: 'APROVADO' })];
    estado.versoes = [versaoPersistida({ validade: '2026-09-19' })];

    const codigo = await codigoDoErro(() =>
      criarService().aprovar(TENANT, EMPRESA, EXIGENCIA, AUTOR, 0, HOJE),
    );

    expect(codigo).toBe(CODIGOS_DE_ERRO.TRANSICAO_DOCUMENTAL_INVALIDA);
  });

  it('análise concorrente vira conflito explícito, sem sobrescrita', async () => {
    estado.exigencias = [exigenciaPersistida({ estado: 'ENVIADO' })];
    estado.versoes = [versaoPersistida()];
    estado.gravacaoAceita = false;

    const codigo = await codigoDoErro(() =>
      criarService().aprovar(TENANT, EMPRESA, EXIGENCIA, AUTOR, 0, HOJE),
    );

    expect(codigo).toBe(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO);
    // Nada de evento: a ação não aconteceu.
    expect(estado.eventos).toHaveLength(0);
  });
});

describe('vencimento (§2.4)', () => {
  it('exibe VENCIDO quando a validade do aprovado já passou', async () => {
    estado.exigencias = [exigenciaPersistida({ estado: 'APROVADO' })];
    estado.versoes = [versaoPersistida({ validade: '2026-09-19' })];

    const visao = await criarService().consultar(TENANT, EMPRESA, AUTOR, HOJE);

    expect(visao.exigencias[0]?.estado).toBe('VENCIDO');
  });

  it('mantém APROVADO enquanto a validade é hoje ou futura', async () => {
    estado.exigencias = [exigenciaPersistida({ estado: 'APROVADO' })];
    estado.versoes = [versaoPersistida({ validade: '2026-09-20' })];

    const visao = await criarService().consultar(TENANT, EMPRESA, AUTOR, HOJE);

    expect(visao.exigencias[0]?.estado).toBe('APROVADO');
  });
});

describe('visualização e download (§3.2)', () => {
  it('registra o acesso com autor e devolve o tipo gravado no banco', async () => {
    estado.versoes = [versaoPersistida()];

    const arquivo = await criarService().obterArquivo(
      TENANT,
      EMPRESA,
      EXIGENCIA,
      VERSAO,
      AUTOR,
      'DOWNLOAD',
    );

    expect(arquivo.tipoConteudo).toBe('application/pdf');
    expect(arquivo.nomeOriginal).toBe('cartao.pdf');
    expect(estado.eventos.at(-1)).toMatchObject({
      acao: 'DOWNLOAD',
      versaoId: VERSAO,
      usuarioId: AUTOR.usuarioId,
    });
  });

  it('falha de leitura no storage não registra acesso concluído (§4)', async () => {
    estado.versoes = [versaoPersistida()];
    storage.obter.mockRejectedValueOnce(new Error('storage fora do ar'));

    await expect(
      criarService().obterArquivo(TENANT, EMPRESA, EXIGENCIA, VERSAO, AUTOR, 'VISUALIZACAO'),
    ).rejects.toThrow();

    expect(estado.eventos).toHaveLength(0);
  });

  it('versão de outra exigência não é entregue', async () => {
    estado.versoes = [versaoPersistida({ exigenciaId: 'outra-exigencia' })];

    const codigo = await codigoDoErro(() =>
      criarService().obterArquivo(TENANT, EMPRESA, EXIGENCIA, VERSAO, AUTOR, 'DOWNLOAD'),
    );

    expect(codigo).toBe(CODIGOS_DE_ERRO.VERSAO_NAO_ENCONTRADA);
    expect(storage.obter).not.toHaveBeenCalled();
  });
});

describe('exigência específica (§2.1)', () => {
  it('é criada com nome e gera evento', async () => {
    await criarService().criarExigencia(
      TENANT,
      EMPRESA,
      AUTOR,
      { nome: 'Termo de adesão', descricao: null, dataLimite: '2026-12-31' },
      HOJE,
    );

    expect(estado.eventos.at(-1)?.['acao']).toBe('EXIGENCIA_CRIADA');
    expect(estado.exigencias.at(-1)).toMatchObject({
      codigo: null,
      nome: 'Termo de adesão',
      dataLimite: '2026-12-31',
    });
  });

  it('recusa nome em branco, apontando o campo', async () => {
    // `ErroDeValidacao` responde `422` com `CAMPO_OBRIGATORIO` no topo; o
    // código específico vai em `campos`, que é o que a tela usa para marcar o
    // input certo (FRONTEND.md §14).
    try {
      await criarService().criarExigencia(
        TENANT,
        EMPRESA,
        AUTOR,
        { nome: '   ', descricao: null, dataLimite: null },
        HOJE,
      );
      throw new Error('esperava erro de validação');
    } catch (erro) {
      const dominio = erro as ErroDeDominio;

      expect(dominio.codigo).toBe(CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO);
      expect(dominio.campos).toEqual([
        { campo: 'nome', codigo: CODIGOS_DE_ERRO.NOME_DA_EXIGENCIA_OBRIGATORIO },
      ]);
    }
  });

  it('reconcilia a Central imediatamente após criar a exigência (achado IMPORTANT)', async () => {
    // Antes da correção, `criarExigencia` não chamava o hook de reconciliação:
    // a exigência só virava pendência na próxima mutação qualquer.
    await criarService().criarExigencia(
      TENANT,
      EMPRESA,
      AUTOR,
      { nome: 'Termo de adesão', descricao: null, dataLimite: null },
      HOJE,
    );

    expect(estado.origemReconciliada).toBe('DOCUMENTAL');
  });
});

describe('Central de Pendências — reconciliação por origem (SPEC-005, achado CRITICAL)', () => {
  it('reconcilia só a origem DOCUMENTAL, nunca a CADASTRAL', async () => {
    estado.exigencias = [exigenciaPersistida({ estado: 'ENVIADO' })];
    estado.versoes = [versaoPersistida()];

    await criarService().aprovar(TENANT, EMPRESA, EXIGENCIA, AUTOR, 0, HOJE);

    expect(estado.origemReconciliada).toBe('DOCUMENTAL');
  });
});

describe('achados da revisão de segurança', () => {
  it('recusa arquivo cujos bytes não conferem com o tipo declarado', async () => {
    // HTML renomeado para `.pdf` e anunciado como `application/pdf`: o
    // `Content-Type` do multipart é escolhido por quem envia.
    const codigo = await codigoDoErro(() =>
      criarService().enviarArquivo(
        TENANT,
        EMPRESA,
        EXIGENCIA,
        AUTOR,
        {
          nomeOriginal: 'cartao.pdf',
          tipoConteudo: 'application/pdf',
          conteudo: Buffer.from('<html><script>alert(1)</script></html>'),
        },
        null,
        0,
        HOJE,
      ),
    );

    expect(codigo).toBe(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO);
    expect(storage.enviar).not.toHaveBeenCalled();
  });

  it('recusa o envio quando a versão lida pelo cliente já não é a atual', async () => {
    estado.exigencias = [exigenciaPersistida({ versao: 3 })];

    const codigo = await codigoDoErro(() =>
      criarService().enviarArquivo(TENANT, EMPRESA, EXIGENCIA, AUTOR, pdf(), null, 1, HOJE),
    );

    expect(codigo).toBe(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO);
    // O conflito é detectado antes do upload: 20 MB não sobem à toa.
    expect(storage.enviar).not.toHaveBeenCalled();
  });

  it('recusa a gravação quando a empresa é arquivada durante o upload', async () => {
    // O upload leva tempo; entre a conferência inicial e a gravação, outra
    // pessoa arquiva a empresa. Arquivar não mexe na versão da exigência,
    // então só a revalidação alcança este caso.
    storage.enviar.mockImplementationOnce(async () => {
      estado.empresa = empresaPersistida('arquivado');

      return 'tenant/documento_da_empresa/novo.pdf';
    });

    const codigo = await codigoDoErro(() =>
      criarService().enviarArquivo(TENANT, EMPRESA, EXIGENCIA, AUTOR, pdf(), null, 0, HOJE),
    );

    expect(codigo).toBe(CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA);
    // Nada gravado: nem versão, nem evento.
    expect(estado.versaoInserida).toBeNull();
    expect(estado.eventos).toHaveLength(0);
  });
});
