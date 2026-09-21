/**
 * Documentos da empresa cliente (SPEC-004 §7, categoria Banco e Storage).
 *
 * Roda com a role `contaia_app`, sem BYPASSRLS — o caminho real da aplicação.
 *
 * O que estas provas defendem, em ordem de gravidade: exigência, versão e
 * evento de um escritório não vazam para o outro; o evento documental é
 * append-only no banco, não só na interface; a versão do arquivo é somente
 * leitura e não pode ser excluída; a exigência mantém no máximo um arquivo
 * vigente; e a análise concorrente conflita em vez de sobrescrever.
 */
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool } from './client.js';
import { criarEmpresa } from './repositorios/empresa.js';
import {
  arquivarVersaoVigente,
  carregarExigencia,
  carregarVersao,
  carregarVersaoVigente,
  definirAplicabilidade,
  definirEstadoDaExigencia,
  inserirExigencia,
  inserirVersao,
  listarExigencias,
  listarHistoricoDocumental,
  listarVersoes,
  registrarEventosDocumentais,
} from './repositorios/documentos-empresa.js';

const urlDaAplicacao = (): string => {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  url.username = 'contaia_app';
  url.password = 'contaia_app_local';

  return url.toString();
};

const poolAdmin = criarPool();
let poolApp: Pool;
let tenantA = '';
let tenantB = '';
let usuarioA = '';
let usuarioB = '';

const comTenant = async <T>(
  tenantId: string | null,
  executar: (cliente: PoolClient) => Promise<T>,
): Promise<T> => {
  const cliente = await poolApp.connect();

  try {
    await cliente.query('begin');

    if (tenantId !== null) {
      await cliente.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    }

    const resultado = await executar(cliente);
    await cliente.query('commit');

    return resultado;
  } catch (erro) {
    await cliente.query('rollback');
    throw erro;
  } finally {
    cliente.release();
  }
};

// Mesmo motivo da suíte da F3: as suítes de banco rodam em paralelo sobre o
// mesmo PostgreSQL, então cada execução gera os próprios CNPJs e limpa
// exclusivamente pelas próprias razões sociais.
const SUFIXO = String(process.pid).padStart(6, '0').slice(-6);
const CNPJ_ESCRITORIO_A = `81${SUFIXO}000151`;
const CNPJ_ESCRITORIO_B = `82${SUFIXO}000152`;
const CNPJ_EMPRESA = `83${SUFIXO}000153`;

const RAZOES = [`Escritório Documentos A ${SUFIXO}`, `Escritório Documentos B ${SUFIXO}`];

const limpar = async (): Promise<void> => {
  const { rows } = await poolAdmin.query<{ id: string }>(
    `select id from app.tenant where razao_social = any($1)`,
    [RAZOES],
  );

  const ids = rows.map((linha) => linha.id);

  if (ids.length === 0) {
    return;
  }

  // As triggers recusam DELETE e UPDATE até para o dono da tabela — é
  // exatamente o comportamento que as provas abaixo exigem. Limpar fixture é a
  // única exceção legítima, e ela desliga as triggers explicitamente em vez de
  // enfraquecê-las.
  await poolAdmin.query(
    'alter table app.empresa_evento_documental disable trigger empresa_evento_documental_append_only',
  );
  await poolAdmin.query(
    'alter table app.empresa_documento_versao disable trigger empresa_documento_versao_somente_leitura',
  );

  try {
    await poolAdmin.query('delete from app.empresa_evento_documental where tenant_id = any($1)', [
      ids,
    ]);
    await poolAdmin.query('delete from app.empresa_documento_versao where tenant_id = any($1)', [
      ids,
    ]);
  } finally {
    await poolAdmin.query(
      'alter table app.empresa_evento_documental enable trigger empresa_evento_documental_append_only',
    );
    await poolAdmin.query(
      'alter table app.empresa_documento_versao enable trigger empresa_documento_versao_somente_leitura',
    );
  }

  await poolAdmin.query(
    'delete from app.empresa_exigencia_documental where tenant_id = any($1)',
    [ids],
  );
  await poolAdmin.query('delete from app.empresa where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.usuario where tenant_id = any($1)', [ids]);
  await poolAdmin.query('delete from app.tenant where id = any($1)', [ids]);
};

beforeAll(async () => {
  await limpar();

  const { rows } = await poolAdmin.query<{ id: string }>(
    `insert into app.tenant (cnpj, razao_social, status)
     values ($1, $3, 'ATIVO'), ($2, $4, 'ATIVO')
     returning id`,
    [CNPJ_ESCRITORIO_A, CNPJ_ESCRITORIO_B, RAZOES[0], RAZOES[1]],
  );

  tenantA = rows[0]?.id ?? '';
  tenantB = rows[1]?.id ?? '';

  const usuarios = await poolAdmin.query<{ id: string }>(
    `insert into app.usuario (tenant_id, sub_oidc, email, nome, papel)
     values ($1, $3, 'docs-a@local', 'Admin Docs A', 'admin_escritorio'),
            ($2, $4, 'docs-b@local', 'Admin Docs B', 'admin_escritorio')
     returning id`,
    [tenantA, tenantB, `sub-documentos-a-${SUFIXO}`, `sub-documentos-b-${SUFIXO}`],
  );

  usuarioA = usuarios.rows[0]?.id ?? '';
  usuarioB = usuarios.rows[1]?.id ?? '';

  poolApp = new Pool({ connectionString: urlDaAplicacao(), max: 5 });
});

afterAll(async () => {
  await poolApp.end();
  await limpar();
  await poolAdmin.end();
});

const criarEmpresaAtiva = async (
  tenantId: string,
  cnpj: string = CNPJ_EMPRESA,
): Promise<string> =>
  comTenant(tenantId, async (cliente) => {
    const empresaId = await criarEmpresa(cliente, tenantId, cnpj);

    await cliente.query(
      `update app.empresa set status = 'ATIVA', razao_social = 'Empresa Documentos'
        where tenant_id = $1 and id = $2`,
      [tenantId, empresaId],
    );

    return empresaId;
  });

const exigenciaPadrao = (nome = 'Cartão CNPJ') =>
  ({
    codigo: 'CARTAO_CNPJ',
    nome,
    descricao: null,
    dataLimite: null,
    aplicavel: true,
  }) as const;

const arquivo = (nome = 'cartao.pdf') =>
  ({
    chaveStorage: `tenant/documento_da_empresa/${nome}`,
    nomeOriginal: nome,
    tipoConteudo: 'application/pdf',
    tamanhoBytes: 2048,
    validade: null,
  }) as const;

describe('isolamento por tenant (I-1, I-2)', () => {
  it('exigência do escritório A não é lida pelo escritório B', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA);

    const exigenciaId = await comTenant(tenantA, (cliente) =>
      inserirExigencia(cliente, tenantA, empresaId, exigenciaPadrao()),
    );

    const pelaA = await comTenant(tenantA, (cliente) =>
      carregarExigencia(cliente, tenantA, empresaId, exigenciaId),
    );
    const pelaB = await comTenant(tenantB, (cliente) =>
      carregarExigencia(cliente, tenantB, empresaId, exigenciaId),
    );

    expect(pelaA?.nome).toBe('Cartão CNPJ');
    expect(pelaB).toBeNull();
  });

  it('consulta sem contexto de tenant não retorna exigência alguma', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `84${SUFIXO}000154`);

    await comTenant(tenantA, (cliente) =>
      inserirExigencia(cliente, tenantA, empresaId, exigenciaPadrao('Contrato social')),
    );

    const semContexto = await comTenant(null, (cliente) =>
      listarExigencias(cliente, tenantA, empresaId),
    );

    expect(semContexto).toEqual([]);
  });

  it('escritório B não consegue gravar exigência na empresa do A', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `85${SUFIXO}000155`);

    await expect(
      comTenant(tenantB, (cliente) =>
        inserirExigencia(cliente, tenantB, empresaId, exigenciaPadrao()),
      ),
    ).rejects.toThrow();
  });

  it('versão e evento do A não aparecem para o B', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `86${SUFIXO}000156`);

    const { exigenciaId, versaoId } = await comTenant(tenantA, async (cliente) => {
      const exigenciaId = await inserirExigencia(
        cliente,
        tenantA,
        empresaId,
        exigenciaPadrao(),
      );
      const versao = await inserirVersao(cliente, tenantA, empresaId, {
        exigenciaId,
        enviadoPor: usuarioA,
        ...arquivo(),
      });

      await registrarEventosDocumentais(cliente, tenantA, [
        {
          empresaId,
          exigenciaId,
          versaoId: versao.id,
          acao: 'ENVIO',
          estadoAnterior: 'PENDENTE',
          estadoNovo: 'ENVIADO',
          justificativa: null,
          usuarioId: usuarioA,
        },
      ]);

      return { exigenciaId, versaoId: versao.id };
    });

    const versaoPeloB = await comTenant(tenantB, (cliente) =>
      carregarVersao(cliente, tenantB, empresaId, versaoId),
    );
    const historicoPeloB = await comTenant(tenantB, (cliente) =>
      listarHistoricoDocumental(cliente, tenantB, empresaId, { limite: 50, deslocamento: 0 }),
    );
    const versoesPeloB = await comTenant(tenantB, (cliente) =>
      listarVersoes(cliente, tenantB, exigenciaId),
    );

    expect(versaoPeloB).toBeNull();
    expect(historicoPeloB.eventos).toEqual([]);
    expect(versoesPeloB).toEqual([]);
  });
});

describe('uma versão vigente por exigência (§2.3)', () => {
  it('substituição arquiva a anterior e a nova vira vigente, preservando as duas', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `87${SUFIXO}000157`);

    const { exigenciaId, primeira, segunda } = await comTenant(tenantA, async (cliente) => {
      const exigenciaId = await inserirExigencia(
        cliente,
        tenantA,
        empresaId,
        exigenciaPadrao(),
      );

      const primeira = await inserirVersao(cliente, tenantA, empresaId, {
        exigenciaId,
        enviadoPor: usuarioA,
        ...arquivo('primeira.pdf'),
      });

      await arquivarVersaoVigente(cliente, tenantA, exigenciaId);

      const segunda = await inserirVersao(cliente, tenantA, empresaId, {
        exigenciaId,
        enviadoPor: usuarioA,
        ...arquivo('segunda.pdf'),
      });

      return { exigenciaId, primeira, segunda };
    });

    const versoes = await comTenant(tenantA, (cliente) =>
      listarVersoes(cliente, tenantA, exigenciaId),
    );
    const vigente = await comTenant(tenantA, (cliente) =>
      carregarVersaoVigente(cliente, tenantA, exigenciaId),
    );

    expect(primeira.numero).toBe(1);
    expect(segunda.numero).toBe(2);
    // Versão anterior preservada, não apagada.
    expect(versoes).toHaveLength(2);
    expect(vigente?.id).toBe(segunda.id);
    expect(versoes.filter((versao) => versao.vigente)).toHaveLength(1);
  });

  it('o banco recusa uma segunda versão vigente na mesma exigência', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `88${SUFIXO}000158`);

    await expect(
      comTenant(tenantA, async (cliente) => {
        const exigenciaId = await inserirExigencia(
          cliente,
          tenantA,
          empresaId,
          exigenciaPadrao(),
        );

        await inserirVersao(cliente, tenantA, empresaId, {
          exigenciaId,
          enviadoPor: usuarioA,
          ...arquivo('uma.pdf'),
        });

        // Sem arquivar a anterior: é exatamente o esquecimento que o índice
        // parcial único precisa transformar em erro.
        return inserirVersao(cliente, tenantA, empresaId, {
          exigenciaId,
          enviadoPor: usuarioA,
          ...arquivo('outra.pdf'),
        });
      }),
    ).rejects.toThrow();
  });
});

describe('versão é somente leitura (§3.2)', () => {
  it('não pode ser excluída pela aplicação', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `89${SUFIXO}000159`);

    const versaoId = await comTenant(tenantA, async (cliente) => {
      const exigenciaId = await inserirExigencia(
        cliente,
        tenantA,
        empresaId,
        exigenciaPadrao(),
      );

      const versao = await inserirVersao(cliente, tenantA, empresaId, {
        exigenciaId,
        enviadoPor: usuarioA,
        ...arquivo(),
      });

      return versao.id;
    });

    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query('delete from app.empresa_documento_versao where id = $1', [versaoId]),
      ),
    ).rejects.toThrow();
  });

  it('não permite reescrever o metadado do arquivo já gravado', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `71${SUFIXO}000161`);

    const versaoId = await comTenant(tenantA, async (cliente) => {
      const exigenciaId = await inserirExigencia(
        cliente,
        tenantA,
        empresaId,
        exigenciaPadrao(),
      );

      const versao = await inserirVersao(cliente, tenantA, empresaId, {
        exigenciaId,
        enviadoPor: usuarioA,
        ...arquivo(),
      });

      return versao.id;
    });

    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query(
          `update app.empresa_documento_versao set chave_storage = 'outro' where id = $1`,
          [versaoId],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('evento documental é append-only (I-6)', () => {
  it('não aceita UPDATE nem DELETE, mesmo dentro do tenant', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `72${SUFIXO}000162`);

    const eventoId = await comTenant(tenantA, async (cliente) => {
      const exigenciaId = await inserirExigencia(
        cliente,
        tenantA,
        empresaId,
        exigenciaPadrao(),
      );

      await registrarEventosDocumentais(cliente, tenantA, [
        {
          empresaId,
          exigenciaId,
          versaoId: null,
          acao: 'EXIGENCIA_CRIADA',
          estadoAnterior: null,
          estadoNovo: 'PENDENTE',
          justificativa: null,
          usuarioId: usuarioA,
        },
      ]);

      const { rows } = await cliente.query<{ id: string }>(
        'select id from app.empresa_evento_documental where exigencia_id = $1',
        [exigenciaId],
      );

      return rows[0]?.id ?? '';
    });

    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query(
          `update app.empresa_evento_documental set justificativa = 'reescrito' where id = $1`,
          [eventoId],
        ),
      ),
    ).rejects.toThrow();

    await expect(
      comTenant(tenantA, (cliente) =>
        cliente.query('delete from app.empresa_evento_documental where id = $1', [eventoId]),
      ),
    ).rejects.toThrow();
  });

  it('registra visualização e download com autor, na ordem em que ocorreram', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `73${SUFIXO}000163`);

    await comTenant(tenantA, async (cliente) => {
      const exigenciaId = await inserirExigencia(
        cliente,
        tenantA,
        empresaId,
        exigenciaPadrao(),
      );

      const versao = await inserirVersao(cliente, tenantA, empresaId, {
        exigenciaId,
        enviadoPor: usuarioA,
        ...arquivo(),
      });

      await registrarEventosDocumentais(cliente, tenantA, [
        {
          empresaId,
          exigenciaId,
          versaoId: versao.id,
          acao: 'VISUALIZACAO',
          estadoAnterior: null,
          estadoNovo: null,
          justificativa: null,
          usuarioId: usuarioA,
        },
        {
          empresaId,
          exigenciaId,
          versaoId: versao.id,
          acao: 'DOWNLOAD',
          estadoAnterior: null,
          estadoNovo: null,
          justificativa: null,
          usuarioId: usuarioA,
        },
      ]);
    });

    const historico = await comTenant(tenantA, (cliente) =>
      listarHistoricoDocumental(cliente, tenantA, empresaId, { limite: 50, deslocamento: 0 }),
    );

    // Do mais recente para o mais antigo, com a `sequencia` desempatando os
    // eventos salvos na mesma transação.
    expect(historico.eventos.map((evento) => evento.acao)).toEqual([
      'DOWNLOAD',
      'VISUALIZACAO',
    ]);
    expect(historico.eventos[0]?.usuarioNome).toBe('Admin Docs A');
    expect(historico.total).toBe(2);
  });

  it('exige justificativa em rejeição e dispensa', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `74${SUFIXO}000164`);

    await expect(
      comTenant(tenantA, async (cliente) => {
        const exigenciaId = await inserirExigencia(
          cliente,
          tenantA,
          empresaId,
          exigenciaPadrao(),
        );

        return registrarEventosDocumentais(cliente, tenantA, [
          {
            empresaId,
            exigenciaId,
            versaoId: null,
            acao: 'REJEICAO',
            estadoAnterior: 'ENVIADO',
            estadoNovo: 'REJEITADO',
            justificativa: null,
            usuarioId: usuarioA,
          },
        ]);
      }),
    ).rejects.toThrow();
  });
});

describe('atomicidade entre ação e evento (§3.2, §5)', () => {
  it('falha na auditoria desfaz a mudança de estado da exigência', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `75${SUFIXO}000165`);

    const exigenciaId = await comTenant(tenantA, (cliente) =>
      inserirExigencia(cliente, tenantA, empresaId, exigenciaPadrao()),
    );

    await expect(
      comTenant(tenantA, async (cliente) => {
        const aplicado = await definirEstadoDaExigencia(cliente, tenantA, exigenciaId, {
          estado: 'DISPENSADO',
          justificativa: 'Dispensada nesta transação.',
          versaoEsperada: 0,
        });

        expect(aplicado).toBe(true);

        // Evento inválido: sem justificativa. O CHECK derruba a transação
        // inteira, e é isso que a spec exige.
        return registrarEventosDocumentais(cliente, tenantA, [
          {
            empresaId,
            exigenciaId,
            versaoId: null,
            acao: 'DISPENSA',
            estadoAnterior: 'PENDENTE',
            estadoNovo: 'DISPENSADO',
            justificativa: null,
            usuarioId: usuarioA,
          },
        ]);
      }),
    ).rejects.toThrow();

    const depois = await comTenant(tenantA, (cliente) =>
      carregarExigencia(cliente, tenantA, empresaId, exigenciaId),
    );

    expect(depois?.estado).toBe('PENDENTE');
    expect(depois?.justificativa).toBeNull();
  });
});

describe('análise concorrente (§5)', () => {
  it('a segunda análise não sobrescreve a primeira: o compare-and-swap recusa', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `76${SUFIXO}000166`);

    const exigenciaId = await comTenant(tenantA, (cliente) =>
      inserirExigencia(cliente, tenantA, empresaId, exigenciaPadrao()),
    );

    const primeira = await comTenant(tenantA, (cliente) =>
      definirEstadoDaExigencia(cliente, tenantA, exigenciaId, {
        estado: 'DISPENSADO',
        justificativa: 'Primeira análise.',
        versaoEsperada: 0,
      }),
    );

    // Mesma versão lida antes: é o cenário de duas telas abertas.
    const segunda = await comTenant(tenantA, (cliente) =>
      definirEstadoDaExigencia(cliente, tenantA, exigenciaId, {
        estado: 'APROVADO',
        justificativa: null,
        versaoEsperada: 0,
      }),
    );

    const depois = await comTenant(tenantA, (cliente) =>
      carregarExigencia(cliente, tenantA, empresaId, exigenciaId),
    );

    expect(primeira).toBe(true);
    expect(segunda).toBe(false);
    expect(depois?.estado).toBe('DISPENSADO');
    expect(depois?.justificativa).toBe('Primeira análise.');
  });
});

describe('aplicabilidade das inscrições (§2.2)', () => {
  it('torna a exigência inaplicável sem apagar as versões já enviadas', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `77${SUFIXO}000167`);

    const exigenciaId = await comTenant(tenantA, async (cliente) => {
      const exigenciaId = await inserirExigencia(cliente, tenantA, empresaId, {
        codigo: 'INSCRICAO_ESTADUAL',
        nome: 'Inscrição estadual',
        descricao: null,
        dataLimite: null,
        aplicavel: true,
      });

      await inserirVersao(cliente, tenantA, empresaId, {
        exigenciaId,
        enviadoPor: usuarioA,
        ...arquivo('inscricao.pdf'),
      });

      return exigenciaId;
    });

    await comTenant(tenantA, (cliente) =>
      definirAplicabilidade(cliente, tenantA, empresaId, 'INSCRICAO_ESTADUAL', false),
    );

    const exigencia = await comTenant(tenantA, (cliente) =>
      carregarExigencia(cliente, tenantA, empresaId, exigenciaId),
    );
    const versoes = await comTenant(tenantA, (cliente) =>
      listarVersoes(cliente, tenantA, exigenciaId),
    );

    expect(exigencia?.aplicavel).toBe(false);
    expect(versoes).toHaveLength(1);
  });

  it('o checklist padrão não duplica: cada código existe uma vez por empresa', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `78${SUFIXO}000168`);

    await comTenant(tenantA, (cliente) =>
      inserirExigencia(cliente, tenantA, empresaId, exigenciaPadrao()),
    );

    await expect(
      comTenant(tenantA, (cliente) =>
        inserirExigencia(cliente, tenantA, empresaId, exigenciaPadrao('Cartão CNPJ de novo')),
      ),
    ).rejects.toThrow();
  });
});

describe('autoria do evento', () => {
  it('só o vencimento apurado pela aplicação dispensa usuário', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `79${SUFIXO}000169`);

    const exigenciaId = await comTenant(tenantA, (cliente) =>
      inserirExigencia(cliente, tenantA, empresaId, exigenciaPadrao()),
    );

    await comTenant(tenantA, (cliente) =>
      registrarEventosDocumentais(cliente, tenantA, [
        {
          empresaId,
          exigenciaId,
          versaoId: null,
          acao: 'VENCIMENTO',
          estadoAnterior: 'APROVADO',
          estadoNovo: 'VENCIDO',
          justificativa: null,
          usuarioId: null,
        },
      ]),
    );

    await expect(
      comTenant(tenantA, (cliente) =>
        registrarEventosDocumentais(cliente, tenantA, [
          {
            empresaId,
            exigenciaId,
            versaoId: null,
            acao: 'APROVACAO',
            estadoAnterior: 'ENVIADO',
            estadoNovo: 'APROVADO',
            justificativa: null,
            usuarioId: null,
          },
        ]),
      ),
    ).rejects.toThrow();

    const historico = await comTenant(tenantA, (cliente) =>
      listarHistoricoDocumental(cliente, tenantA, empresaId, { limite: 50, deslocamento: 0 }),
    );

    expect(historico.eventos).toHaveLength(1);
    expect(historico.eventos[0]?.acao).toBe('VENCIMENTO');
    expect(historico.eventos[0]?.usuarioNome).toBeNull();
  });

  it('usuário de outro escritório não pode ser gravado como autor', async () => {
    const empresaId = await criarEmpresaAtiva(tenantA, `70${SUFIXO}000170`);

    const exigenciaId = await comTenant(tenantA, (cliente) =>
      inserirExigencia(cliente, tenantA, empresaId, exigenciaPadrao()),
    );

    await expect(
      comTenant(tenantA, (cliente) =>
        registrarEventosDocumentais(cliente, tenantA, [
          {
            empresaId,
            exigenciaId,
            versaoId: null,
            acao: 'APROVACAO',
            estadoAnterior: 'ENVIADO',
            estadoNovo: 'APROVADO',
            justificativa: null,
            usuarioId: usuarioB,
          },
        ]),
      ),
    ).rejects.toThrow();
  });
});
