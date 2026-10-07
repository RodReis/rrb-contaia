/**
 * Cofre de certificados — casos de uso da API contra o PostgreSQL REAL (papel `contaia_app`, RLS
 * valendo) e um cofre falso que guarda o estado do segredo. As provas que o dublê de banco das
 * `*.spec.ts` não alcança: concorrência entre transações e idempotência ponta a ponta.
 */
import { randomUUID } from 'node:crypto';

import { criarPool, criarPoolDaAplicacao } from '@contaia/db';
import { CODIGOS_DE_ERRO, ErroDeDominio, permissoesDosPapeisPadrao } from '@contaia/domain';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CertificadosService } from './certificados.service';
import type { CofreClient } from './cofre.client';
import type { SessaoDoCofre } from './visoes';

const SEGREDO_DO_TICKET = 'i'.repeat(40);
const CNPJ = '11222333000181';
const atraso = (ms: number): Promise<void> => new Promise((resolver) => setTimeout(resolver, ms));

/** Cofre falso com o estado do segredo (KV v2): `inutilizar` = delete, `restaurar` = undelete. */
class CofreFalso {
  readonly inutilizados = new Set<string>();
  chamadas: string[] = [];
  falhaAmbiguaNoInutilizar = false;

  async inutilizar(referencia: string): Promise<void> {
    this.chamadas.push(`inutilizar:${referencia}`);
    await atraso(40); // alarga a janela de corrida
    this.inutilizados.add(referencia);

    if (this.falhaAmbiguaNoInutilizar) {
      // O Vault aplicou, mas a resposta se perdeu (timeout).
      throw new ErroDeDominio(CODIGOS_DE_ERRO.COFRE_INDISPONIVEL, 'timeout');
    }
  }

  async restaurar(referencia: string): Promise<void> {
    this.chamadas.push(`restaurar:${referencia}`);
    this.inutilizados.delete(referencia);
  }
}

const admin = criarPool();
const app: Pool = criarPoolDaAplicacao();
const cofre = new CofreFalso();
const agendador = { agendarDiagnosticosPosCadastro: vi.fn() };
const servico = new CertificadosService(
  { instancia: app } as never,
  cofre as unknown as CofreClient,
  agendador as never,
);

const sufixo = `${String(process.pid).padStart(6, '0').slice(-6)}${String(Date.now()).slice(-6)}`;
let tenantId = '';
let usuarioId = '';
let sessao: SessaoDoCofre;
let rotulo = 0;

const unico = async (sql: string, parametros: unknown[]): Promise<string> => {
  const { rows } = await admin.query<{ id: string }>(sql, parametros);

  return rows[0]?.id ?? '';
};

const novaEmpresa = async (): Promise<string> => {
  rotulo += 1;
  const id = await unico(
    `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao)
     values ($1, $2, $3, 'ATIVA', 'ativo') returning id`,
    [tenantId, `${String(rotulo).padStart(2, '0')}${CNPJ.slice(2)}`, `Empresa API ${rotulo} ${sufixo}`],
  );
  await admin.query(`insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`, [
    tenantId,
    usuarioId,
    id,
  ]);

  return id;
};

const cnpjDa = async (empresaId: string): Promise<string> =>
  (await admin.query<{ cnpj: string }>('select cnpj from app.empresa where id = $1', [empresaId])).rows[0]?.cnpj ?? '';

const metadadosDe = (cnpj: string) => ({
  titular: 'EMPRESA DE TESTE',
  cnpjTitular: cnpj,
  autoridadeCertificadora: 'AC de Teste',
  cadeia: ['EMPRESA DE TESTE', 'AC de Teste'],
  numeroSerie: randomUUID(),
  impressaoDigital: 'AB'.repeat(32),
  naoAntes: new Date(Date.now() - 300 * 86_400_000).toISOString(),
  naoDepois: new Date(Date.now() + 200 * 86_400_000).toISOString(),
});

/** Cadastra pelo fluxo real: ticket emitido, depois ativação como o cofre faria. */
const cadastrar = async (empresaId: string, referencia = randomUUID()) => {
  const ticket = await servico.emitirTicket(sessao, empresaId, usuarioId, 'corr-emissao-01');
  const pedido = {
    ticket: ticket.ticket,
    referenciaDoSegredo: referencia,
    metadados: metadadosDe(await cnpjDa(empresaId)),
  };

  return { pedido, resposta: await servico.ativar(pedido, 'corr-ativacao-01') };
};

const contar = async (sql: string, parametros: unknown[]): Promise<number> =>
  Number((await admin.query<{ n: string }>(sql, parametros)).rows[0]?.n ?? 0);

const codigoDe = async (acao: () => Promise<unknown>): Promise<string> => {
  try {
    await acao();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : `OUTRO:${String(erro)}`;
  }

  return 'nao_lancou';
};

beforeAll(async () => {
  process.env['COFRE_TICKET_SECRET'] = SEGREDO_DO_TICKET;
  process.env['COFRE_PUBLIC_URL'] = 'http://127.0.0.1:15104';

  tenantId = await unico(`insert into app.tenant (razao_social, cnpj) values ($1, $2) returning id`, [
    `Escritório API Cofre ${sufixo}`,
    `MX${sufixo}`,
  ]);
  usuarioId = await unico(
    `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
     values ($1, $2, $3, 'Admin do Cofre', 'ATIVO') returning id`,
    [tenantId, `sub-api-cofre-${sufixo}`, `admin.${sufixo}@cofre-api.local`],
  );
  await admin.query(`insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, 'admin_escritorio')`, [
    tenantId,
    usuarioId,
  ]);
  sessao = {
    tenantId,
    usuarioId,
    papeis: ['admin_escritorio'],
    permissoes: permissoesDosPapeisPadrao(['admin_escritorio']),
  };
});

beforeEach(() => {
  cofre.inutilizados.clear();
  cofre.chamadas = [];
  cofre.falhaAmbiguaNoInutilizar = false;
});

afterAll(async () => {
  // As triggers append-only recusam DELETE até do dono; `replica` vale só nesta conexão.
  const cliente = await admin.connect();

  try {
    await cliente.query(`set session_replication_role = replica`);
    const { rows } = await cliente.query<{ tabela: string }>(
      `select table_name as tabela from information_schema.columns
        where table_schema = 'app' and column_name = 'tenant_id'`,
    );

    for (const { tabela } of rows) {
      await cliente.query(`delete from app.${tabela} where tenant_id = $1`, [tenantId]);
    }

    await cliente.query(`delete from app.tenant where id = $1`, [tenantId]);
  } finally {
    await cliente.query(`reset session_replication_role`);
    cliente.release();
  }

  await Promise.all([admin.end(), app.end()]);
});

describe('desativação concorrente', () => {
  it('duas desativações simultâneas: uma vence, a outra é 409 e NUNCA restaura o segredo da desativada', async () => {
    const empresa = await novaEmpresa();
    const referencia = randomUUID();
    await cadastrar(empresa, referencia);

    const resultados = await Promise.all(
      Array.from({ length: 3 }, () =>
        servico.desativar(sessao, empresa, 'Troca de titularidade', 'corr-desativar-01').then(
          () => 'ok',
          (erro: unknown) => (erro instanceof ErroDeDominio ? erro.codigo : String(erro)),
        ),
      ),
    );

    expect(resultados.filter((r) => r === 'ok')).toHaveLength(1);
    expect(resultados.filter((r) => r === CODIGOS_DE_ERRO.CERTIFICADO_VIGENTE_INEXISTENTE)).toHaveLength(2);
    // O cofre foi chamado UMA vez e o segredo continua inutilizado: a perdedora não restaurou nada.
    expect(cofre.chamadas).toEqual([`inutilizar:${referencia}`]);
    expect(cofre.inutilizados.has(referencia)).toBe(true);
    expect(
      await contar(
        `select count(*) as n from app.empresa_certificado where empresa_id = $1 and estado = 'DESATIVADO'`,
        [empresa],
      ),
    ).toBe(1);
    expect(
      await contar(
        `select count(*) as n from app.empresa_certificado_evento where empresa_id = $1 and acao = 'DESATIVACAO'`,
        [empresa],
      ),
    ).toBe(1);
  });

  it('inutilizar ambíguo (o Vault aplicou, a resposta se perdeu): devolve o segredo e o vigente segue utilizável', async () => {
    const empresa = await novaEmpresa();
    const referencia = randomUUID();
    await cadastrar(empresa, referencia);
    cofre.falhaAmbiguaNoInutilizar = true;

    expect(await codigoDe(() => servico.desativar(sessao, empresa, 'motivo', 'corr-desativar-02'))).toBe(
      CODIGOS_DE_ERRO.COFRE_INDISPONIVEL,
    );

    expect(cofre.chamadas).toEqual([`inutilizar:${referencia}`, `restaurar:${referencia}`]);
    expect(cofre.inutilizados.has(referencia)).toBe(false);
    expect(
      await contar(`select count(*) as n from app.empresa_certificado where empresa_id = $1 and estado = 'VIGENTE'`, [
        empresa,
      ]),
    ).toBe(1);
  });

  it('desativar depois de já desativada: 409 sem tocar no cofre (o caso do vigente nulo sob o lock)', async () => {
    const empresa = await novaEmpresa();
    await cadastrar(empresa);
    await servico.desativar(sessao, empresa, 'motivo', 'corr-desativar-03');
    cofre.chamadas = [];

    expect(await codigoDe(() => servico.desativar(sessao, empresa, 'de novo', 'corr-desativar-04'))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_VIGENTE_INEXISTENTE,
    );
    expect(cofre.chamadas).toEqual([]);
  });
});

describe('diagnóstico do Signer depois da ativação (SPEC-012 §3.9)', () => {
  beforeEach(() => {
    agendador.agendarDiagnosticosPosCadastro.mockReset();
    agendador.agendarDiagnosticosPosCadastro.mockResolvedValue(undefined);
  });

  it('a ativação confirmada agenda o diagnóstico da empresa, uma única vez', async () => {
    const empresa = await novaEmpresa();

    await cadastrar(empresa);

    expect(agendador.agendarDiagnosticosPosCadastro).toHaveBeenCalledTimes(1);
    expect(agendador.agendarDiagnosticosPosCadastro).toHaveBeenCalledWith(tenantId, empresa, 'corr-ativacao-01');
  });

  it('repetir a mesma ativação NÃO agenda de novo: nada foi ativado', async () => {
    const empresa = await novaEmpresa();
    const { pedido } = await cadastrar(empresa);
    agendador.agendarDiagnosticosPosCadastro.mockClear();

    await servico.ativar(pedido, 'corr-ativacao-02');

    expect(agendador.agendarDiagnosticosPosCadastro).not.toHaveBeenCalled();
  });

  it('ativação recusada pelo negócio não agenda nada', async () => {
    const empresa = await novaEmpresa();
    const ticket = await servico.emitirTicket(sessao, empresa, usuarioId, 'corr-emissao-03');

    await codigoDe(() =>
      servico.ativar(
        { ticket: ticket.ticket, referenciaDoSegredo: randomUUID(), metadados: metadadosDe('99888777000166') },
        'corr-ativacao-07',
      ),
    );

    expect(agendador.agendarDiagnosticosPosCadastro).not.toHaveBeenCalled();
  });

  it('falha do agendador nunca desfaz a ativação: o A1 já está vigente', async () => {
    agendador.agendarDiagnosticosPosCadastro.mockRejectedValue(new Error('redis fora do ar'));
    const empresa = await novaEmpresa();

    const { resposta } = await cadastrar(empresa);

    expect(resposta.certificado.estado).toBe('VIGENTE');
    expect(
      await contar(`select count(*) as n from app.empresa_certificado where empresa_id = $1 and estado = 'VIGENTE'`, [empresa]),
    ).toBe(1);
  });
});

describe('ativação idempotente por ticket (ponta a ponta)', () => {
  it('repetir a MESMA ativação devolve a mesma versão, sem segunda versão nem segundo evento', async () => {
    const empresa = await novaEmpresa();
    const { pedido, resposta } = await cadastrar(empresa);

    const repetida = await servico.ativar(pedido, 'corr-ativacao-02');
    const terceira = await servico.ativar(pedido, 'corr-ativacao-03');

    expect(repetida.certificado.id).toBe(resposta.certificado.id);
    expect(terceira.certificado.id).toBe(resposta.certificado.id);
    expect(
      await contar(`select count(*) as n from app.empresa_certificado where empresa_id = $1`, [empresa]),
    ).toBe(1);
    expect(
      await contar(
        `select count(*) as n from app.empresa_certificado_evento where empresa_id = $1 and acao = 'CADASTRO'`,
        [empresa],
      ),
    ).toBe(1);
  });

  it('mesmo ticket com OUTRA referência: 403, e a versão ativada não muda', async () => {
    const empresa = await novaEmpresa();
    const { pedido, resposta } = await cadastrar(empresa);

    expect(await codigoDe(() => servico.ativar({ ...pedido, referenciaDoSegredo: randomUUID() }, 'corr-ativacao-04'))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO,
    );
    expect(
      (await admin.query<{ id: string }>(`select id from app.empresa_certificado where empresa_id = $1`, [empresa]))
        .rows.map((linha) => linha.id),
    ).toEqual([resposta.certificado.id]);
  });

  it('ativação recusada pelo negócio não é repetível: o ticket não ativou nada', async () => {
    const empresa = await novaEmpresa();
    const ticket = await servico.emitirTicket(sessao, empresa, usuarioId, 'corr-emissao-02');
    const pedido = {
      ticket: ticket.ticket,
      referenciaDoSegredo: randomUUID(),
      metadados: metadadosDe('99888777000166'),
    };

    expect(await codigoDe(() => servico.ativar(pedido, 'corr-ativacao-05'))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_CNPJ_DIVERGENTE,
    );
    expect(await codigoDe(() => servico.ativar(pedido, 'corr-ativacao-06'))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO,
    );
    expect(
      await contar(`select count(*) as n from app.empresa_certificado where empresa_id = $1`, [empresa]),
    ).toBe(0);
  });
});
