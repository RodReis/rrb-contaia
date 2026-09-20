/**
 * Persistência por etapa, ativação e unicidade global do CNPJ, sempre pelo
 * caminho de aplicação: role `contaia_app`, dentro do contexto de tenant.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { comContextoDeTenant, semContexto } from '../contexto.js';
import { criarPool } from '../client.js';
import {
  arquivarArquivo,
  carregarCadastro,
  cnpjEmUsoPorOutroTenant,
  listarArquivos,
  marcarComoAtivo,
  registrarArquivo,
  salvarEnderecoPrincipal,
  salvarIdentificacao,
  salvarResponsavel,
} from './escritorio.js';

/** CNPJ exclusivo desta suíte: outra suíte usando o mesmo valor colidiria na
 *  unicidade global, que é justamente o que se quer provar aqui. */
const CNPJ_DA_SUITE = '22111000000133';

const poolAdmin = criarPool();
let poolApp: Pool;
let tenantA = '';
let tenantB = '';

const urlDaAplicacao = (): string => {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  url.username = 'contaia_app';
  url.password = 'contaia_app_local';

  return url.toString();
};

beforeAll(async () => {
  // Resíduo de execução anterior derrubaria a unicidade antes do primeiro
  // assert: a suíte começa limpando o que ela mesma cria.
  await poolAdmin.query(
    `update app.tenant set logo_arquivo_id = null where cnpj = $1 or razao_social in ('Repo A', 'Repo B')`,
    [CNPJ_DA_SUITE],
  );
  await poolAdmin.query(
    `delete from app.escritorio_arquivo where tenant_id in
       (select id from app.tenant where cnpj = $1 or razao_social in ('Repo A', 'Repo B'))`,
    [CNPJ_DA_SUITE],
  );
  await poolAdmin.query(
    `delete from app.escritorio_endereco where tenant_id in
       (select id from app.tenant where cnpj = $1 or razao_social in ('Repo A', 'Repo B'))`,
    [CNPJ_DA_SUITE],
  );
  await poolAdmin.query(
    `delete from app.tenant where cnpj = $1 or razao_social in ('Repo A', 'Repo B')`,
    [CNPJ_DA_SUITE],
  );

  const { rows } = await poolAdmin.query<{ id: string }>(
    `insert into app.tenant (razao_social) values ('Repo A'), ('Repo B') returning id`,
  );

  tenantA = rows[0]?.id ?? '';
  tenantB = rows[1]?.id ?? '';

  poolApp = new Pool({ connectionString: urlDaAplicacao(), max: 5 });
});

afterAll(async () => {
  await poolAdmin.query('update app.tenant set logo_arquivo_id = null where id = any($1)', [
    [tenantA, tenantB],
  ]);
  await poolAdmin.query('delete from app.escritorio_arquivo where tenant_id = any($1)', [
    [tenantA, tenantB],
  ]);
  await poolAdmin.query('delete from app.escritorio_endereco where tenant_id = any($1)', [
    [tenantA, tenantB],
  ]);
  await poolAdmin.query('delete from app.tenant where id = any($1)', [[tenantA, tenantB]]);
  await poolApp.end();
  await poolAdmin.end();
});

describe('persistência por etapa', () => {
  it('parte de um cadastro incompleto e sem etapa alguma salva', async () => {
    const cadastro = await comContextoDeTenant(poolApp, tenantA, (cliente) =>
      carregarCadastro(cliente, tenantA),
    );

    expect(cadastro?.status).toBe('CADASTRO_INCOMPLETO');
    expect(cadastro?.responsavel).toBeNull();
    expect(cadastro?.enderecoPrincipal).toBeNull();
    expect(cadastro?.documentosArquivoIds).toEqual([]);
  });

  it('salva identificação, responsável, endereço e documento e recarrega tudo', async () => {
    await comContextoDeTenant(poolApp, tenantA, async (cliente) => {
      const logoId = await registrarArquivo(cliente, tenantA, {
        tipo: 'LOGO',
        chaveStorage: `${tenantA}/logo.png`,
        nomeOriginal: 'logo.png',
        tipoConteudo: 'image/png',
        tamanhoBytes: 2048,
      });

      await salvarIdentificacao(cliente, tenantA, {
        cnpj: CNPJ_DA_SUITE,
        razaoSocial: 'Escritório Repo A',
        logoArquivoId: logoId,
      });

      await salvarResponsavel(cliente, tenantA, {
        nomeCompleto: 'Maria Souza',
        cpf: '52998224725',
        crc: '1SP123456/O-5',
        email: 'maria@escritorio.cnt.br',
        telefone: '11987654321',
      });

      await salvarEnderecoPrincipal(cliente, tenantA, {
        cep: '01310100',
        logradouro: 'Avenida Paulista',
        numero: '1000',
        complemento: null,
        bairro: 'Bela Vista',
        municipio: 'São Paulo',
        uf: 'SP',
      });

      await registrarArquivo(cliente, tenantA, {
        tipo: 'DOCUMENTO',
        chaveStorage: `${tenantA}/contrato.pdf`,
        nomeOriginal: 'contrato.pdf',
        tipoConteudo: 'application/pdf',
        tamanhoBytes: 4096,
      });
    });

    const cadastro = await comContextoDeTenant(poolApp, tenantA, (cliente) =>
      carregarCadastro(cliente, tenantA),
    );

    expect(cadastro?.identificacao?.cnpj).toBe(CNPJ_DA_SUITE);
    expect(cadastro?.identificacao?.logoArquivoId).not.toBeNull();
    expect(cadastro?.responsavel?.cpf).toBe('52998224725');
    expect(cadastro?.enderecoPrincipal?.municipio).toBe('São Paulo');
    expect(cadastro?.documentosArquivoIds).toHaveLength(1);
    expect(cadastro?.status).toBe('CADASTRO_INCOMPLETO');
  });

  it('substitui o endereço principal em vez de criar um segundo', async () => {
    await comContextoDeTenant(poolApp, tenantA, (cliente) =>
      salvarEnderecoPrincipal(cliente, tenantA, {
        cep: '04538133',
        logradouro: 'Avenida Brigadeiro Faria Lima',
        numero: '3477',
        complemento: '14º andar',
        bairro: 'Itaim Bibi',
        municipio: 'São Paulo',
        uf: 'SP',
      }),
    );

    const cadastro = await comContextoDeTenant(poolApp, tenantA, (cliente) =>
      carregarCadastro(cliente, tenantA),
    );

    expect(cadastro?.enderecoPrincipal?.numero).toBe('3477');

    const { rows } = await poolAdmin.query(
      `select id from app.escritorio_endereco where tenant_id = $1 and principal and situacao = 'ativo'`,
      [tenantA],
    );

    expect(rows).toHaveLength(1);
  });
});

describe('arquivos', () => {
  it('arquiva em vez de apagar: a linha continua no banco', async () => {
    const arquivos = await comContextoDeTenant(poolApp, tenantA, (cliente) =>
      listarArquivos(cliente, tenantA),
    );

    const documento = arquivos.find((arquivo) => arquivo.tipo === 'DOCUMENTO');
    expect(documento).toBeDefined();

    await comContextoDeTenant(poolApp, tenantA, (cliente) =>
      arquivarArquivo(cliente, tenantA, documento?.id ?? ''),
    );

    const restantes = await comContextoDeTenant(poolApp, tenantA, (cliente) =>
      listarArquivos(cliente, tenantA),
    );

    expect(restantes.some((arquivo) => arquivo.id === documento?.id)).toBe(false);

    const { rows } = await poolAdmin.query<{ situacao: string }>(
      'select situacao from app.escritorio_arquivo where id = $1',
      [documento?.id],
    );

    expect(rows[0]?.situacao).toBe('arquivado');
  });
});

describe('unicidade global do CNPJ', () => {
  it('acusa CNPJ em uso por outro tenant sem revelar de quem é', async () => {
    const emUso = await comContextoDeTenant(poolApp, tenantB, (cliente) =>
      cnpjEmUsoPorOutroTenant(cliente, CNPJ_DA_SUITE, tenantB),
    );

    expect(emUso).toBe(true);

    // O tenant B continua sem enxergar o escritório A.
    const visiveis = await comContextoDeTenant(poolApp, tenantB, (cliente) =>
      cliente.query('select id from app.tenant'),
    );

    expect(visiveis.rows).toHaveLength(1);
  });

  it('não acusa o próprio CNPJ como em uso', async () => {
    const emUso = await comContextoDeTenant(poolApp, tenantA, (cliente) =>
      cnpjEmUsoPorOutroTenant(cliente, CNPJ_DA_SUITE, tenantA),
    );

    expect(emUso).toBe(false);
  });
});

describe('ativação', () => {
  it('ativa o tenant e é idempotente na segunda chamada', async () => {
    await comContextoDeTenant(poolApp, tenantA, (cliente) => marcarComoAtivo(cliente, tenantA));

    const depoisDaPrimeira = await comContextoDeTenant(poolApp, tenantA, (cliente) =>
      carregarCadastro(cliente, tenantA),
    );

    expect(depoisDaPrimeira?.status).toBe('ATIVO');

    await comContextoDeTenant(poolApp, tenantA, (cliente) => marcarComoAtivo(cliente, tenantA));

    const depoisDaSegunda = await comContextoDeTenant(poolApp, tenantA, (cliente) =>
      carregarCadastro(cliente, tenantA),
    );

    expect(depoisDaSegunda?.status).toBe('ATIVO');
    // A segunda chamada não encontra linha em CADASTRO_INCOMPLETO: nada muda,
    // nem mesmo a versão.
    expect(depoisDaSegunda?.versao).toBe(depoisDaPrimeira?.versao);
  });
});

describe('sem contexto de tenant', () => {
  it('não carrega cadastro algum (I-2)', async () => {
    const cadastro = await semContexto(poolApp, (cliente) => carregarCadastro(cliente, tenantA));

    expect(cadastro).toBeNull();
  });
});
