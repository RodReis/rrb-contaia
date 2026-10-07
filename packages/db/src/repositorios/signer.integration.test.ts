/**
 * Repositório do Signer (SPEC-012 §3.8, §3.11) sobre o PostgreSQL real, como `contaia_app` e
 * contexto técnico da empresa — exatamente como o Signer o usa.
 */
import { randomUUID } from 'node:crypto';

import { contextoTecnico } from '@contaia/domain';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool, criarPoolDaAplicacao } from '../client.js';
import { comContexto } from '../contexto.js';
import { limparCenario, montarCenario, type Cenario } from '../testes/cenario-rls.js';
import {
  buscarCertificadoParaUso,
  buscarOperacaoPorChave,
  criarOperacao,
  empresaVisivel,
  finalizarOperacao,
  reabrirOperacao,
  registrarEventoDoSigner,
} from './signer.js';
import { historicoDoSigner, ultimosEventosDasFinalidades } from './signer-consultas.js';

const admin = criarPool();
const app = criarPoolDaAplicacao();

let c: Cenario;
let certA1: { id: string; referencia: string };

const hex64 = (): string => (randomUUID() + randomUUID()).replaceAll('-', '').slice(0, 64);

const comoSigner = <T>(
  tenantId: string,
  empresaId: string,
  executar: (cliente: PoolClient) => Promise<T>,
): Promise<T> =>
  comContexto(
    app,
    contextoTecnico({
      identidadeTecnica: 'signer',
      finalidade: 'PROCESSAMENTO_DE_EMPRESA',
      tenantId,
      empresaId,
      correlationId: 'teste-repositorio-signer',
    }),
    executar,
  );

const semearCertificado = async (
  empresaId: string,
  tenantId: string,
  versao: number,
  estado: 'VIGENTE' | 'DESATIVADO',
  validoAte = '2027-01-01',
  responsavelId = c.usuarios.admin,
): Promise<{ id: string; referencia: string }> => {
  const referencia = randomUUID();
  const encerrado =
    estado === 'DESATIVADO'
      ? { em: 'now()', por: responsavelId, motivo: "'DESATIVACAO'", justificativa: "'prova'" }
      : { em: 'null', por: null, motivo: 'null', justificativa: 'null' };
  const { rows } = await admin.query<{ id: string }>(
    `insert into app.empresa_certificado
       (tenant_id, empresa_id, versao, estado, titular, cnpj_titular, autoridade_certificadora, cadeia,
        numero_serie, impressao_digital, valido_de, valido_ate, responsavel_id, referencia_segredo, cadastrado_por,
        encerrado_em, encerrado_por, motivo_encerramento, justificativa)
     values ($1, $2, $3, $4, 'Titular', '00000000000000', 'AC', array['AC'], $5, $6, '2026-01-01', $7, $8, $9, $8,
             ${encerrado.em}, $10, ${encerrado.motivo}, ${encerrado.justificativa})
     returning id`,
    [tenantId, empresaId, versao, estado, `serie-${versao}-${referencia}`, `imp-${referencia}`, validoAte, responsavelId, referencia, encerrado.por],
  );

  return { id: rows[0]!.id, referencia };
};

beforeAll(async () => {
  c = await montarCenario(admin);
  certA1 = await semearCertificado(c.empresaA1, c.tenantA, 1, 'VIGENTE', '2027-03-15');
}, 60_000);

afterAll(async () => {
  await limparCenario(admin, c);
  await Promise.all([admin.end(), app.end()]);
});

describe('buscarCertificadoParaUso: o que o Signer precisa para decidir, sem o segredo', () => {
  it('devolve a versão vigente com datas civis, referência opaca e o CNPJ da empresa', async () => {
    const versao = await comoSigner(c.tenantA, c.empresaA1, (cli) => buscarCertificadoParaUso(cli, c.empresaA1));

    expect(versao).toMatchObject({
      certificadoId: certA1.id,
      estado: 'VIGENTE',
      validoDe: '2026-01-01',
      validoAte: '2027-03-15',
      referenciaSegredo: certA1.referencia,
    });
    expect(versao?.cnpjDaEmpresa).toMatch(/^[A-Za-z0-9]{14}$/u);
    expect(JSON.stringify(versao)).not.toMatch(/senha|pkcs12|chave/iu);
  });

  it('empresa sem certificado devolve null', async () => {
    const versao = await comoSigner(c.tenantA, c.empresaA2, (cli) => buscarCertificadoParaUso(cli, c.empresaA2));

    expect(versao).toBeNull();
  });

  it('contexto cruzado (empresa de outro tenant) devolve null: a RLS esconde, nada vaza', async () => {
    const cruzado = await comoSigner(c.tenantB, c.empresaB1, (cli) => buscarCertificadoParaUso(cli, c.empresaA1));
    const cruzado2 = await comoSigner(c.tenantA, c.empresaA2, (cli) => buscarCertificadoParaUso(cli, c.empresaA1));

    expect(cruzado).toBeNull();
    expect(cruzado2).toBeNull();
  });

  it('a última versão é a que vale: desativada aparece como DESATIVADO, não como ausente', async () => {
    const desativada = await semearCertificado(c.empresaA3Arquivada, c.tenantA, 1, 'DESATIVADO');
    const versao = await comoSigner(c.tenantA, c.empresaA3Arquivada, (cli) =>
      buscarCertificadoParaUso(cli, c.empresaA3Arquivada),
    );

    expect(versao).toMatchObject({ certificadoId: desativada.id, estado: 'DESATIVADO' });
  });
});

describe('empresaVisivel: contexto cruzado é diferente de empresa sem certificado', () => {
  it('a empresa do próprio contexto é visível, mesmo sem certificado', async () => {
    await expect(comoSigner(c.tenantA, c.empresaA2, (cli) => empresaVisivel(cli, c.empresaA2))).resolves.toBe(true);
  });

  it('empresa de outro tenant ou fora do contexto é invisível', async () => {
    await expect(comoSigner(c.tenantA, c.empresaA1, (cli) => empresaVisivel(cli, c.empresaB1))).resolves.toBe(false);
    await expect(comoSigner(c.tenantA, c.empresaB1, (cli) => empresaVisivel(cli, c.empresaB1))).resolves.toBe(false);
    await expect(comoSigner(c.tenantA, c.empresaA2, (cli) => empresaVisivel(cli, c.empresaA1))).resolves.toBe(false);
  });
});

describe('operação idempotente', () => {
  const nova = (chave: string) => ({
    tenantId: c.tenantA,
    empresaId: c.empresaA1,
    finalidade: 'DFE_TESTE' as const,
    tipo: 'MTLS' as const,
    chaveHmac: chave,
    hashConteudo: hex64(),
    certificadoId: certA1.id,
    referenciaSegredo: certA1.referencia,
    identidadeTecnica: 'worker',
    usuarioOriginadorId: null,
    correlationId: 'corr-0001-abcd',
  });

  it('cria, busca por chave e fecha como terminal; o resultado fica registrado', async () => {
    const chave = hex64();
    const id = await comoSigner(c.tenantA, c.empresaA1, (cli) => criarOperacao(cli, nova(chave)));

    const antes = await comoSigner(c.tenantA, c.empresaA1, (cli) => buscarOperacaoPorChave(cli, chave));
    expect(antes).toMatchObject({ id, estado: 'EM_ANDAMENTO', tentativas: 1, finalidade: 'DFE_TESTE' });

    await comoSigner(c.tenantA, c.empresaA1, (cli) => finalizarOperacao(cli, id, { estado: 'CONCLUIDA', codigo: null }));
    const depois = await comoSigner(c.tenantA, c.empresaA1, (cli) => buscarOperacaoPorChave(cli, chave));

    expect(depois).toMatchObject({ estado: 'CONCLUIDA', resultadoCodigo: null });
  });

  it('falha transitória reabre a MESMA operação com a tentativa seguinte', async () => {
    const chave = hex64();
    const id = await comoSigner(c.tenantA, c.empresaA1, (cli) => criarOperacao(cli, nova(chave)));
    await comoSigner(c.tenantA, c.empresaA1, (cli) =>
      finalizarOperacao(cli, id, { estado: 'FALHA_TRANSITORIA', codigo: 'SIGNER_DESTINO_INDISPONIVEL' }),
    );

    await comoSigner(c.tenantA, c.empresaA1, (cli) => reabrirOperacao(cli, id));
    const reaberta = await comoSigner(c.tenantA, c.empresaA1, (cli) => buscarOperacaoPorChave(cli, chave));

    expect(reaberta).toMatchObject({ id, estado: 'EM_ANDAMENTO', tentativas: 2, resultadoCodigo: null });
  });

  it('a chave de outra empresa é invisível na busca, mas a unicidade ainda barra (conflito)', async () => {
    const chave = hex64();
    await comoSigner(c.tenantA, c.empresaA1, (cli) => criarOperacao(cli, nova(chave)));

    const alheia = await comoSigner(c.tenantA, c.empresaA2, (cli) => buscarOperacaoPorChave(cli, chave));
    expect(alheia).toBeNull();

    const certB = await semearCertificado(c.empresaB1, c.tenantB, 1, 'VIGENTE', '2027-01-01', c.usuarios.deB);
    await expect(
      comoSigner(c.tenantB, c.empresaB1, (cli) =>
        criarOperacao(cli, { ...nova(chave), tenantId: c.tenantB, empresaId: c.empresaB1, certificadoId: certB.id, referenciaSegredo: certB.referencia }),
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('consultas de estado e histórico', () => {
  const semearEvento = (
    tenantId: string,
    empresaId: string,
    finalidade: 'DFE_TESTE' | 'ESOCIAL_TESTE',
    resultado: 'SUCESSO' | 'FALHA' | 'RECUSA',
    minutosAtras: number,
    extra: { reutilizado?: boolean; origem?: 'AUTOMATICO' | 'MANUAL' } = {},
  ): Promise<unknown> =>
    admin.query(
      `insert into app.signer_evento
         (tenant_id, empresa_id, finalidade, identidade_tecnica, iniciado_em, finalizado_em, latencia_ms,
          resultado, codigo, correlation_id, reutilizado, origem_diagnostico)
       values ($1, $2, $3, 'worker', now() - ($4 || ' minutes')::interval, now() - ($4 || ' minutes')::interval,
               7, $5, $6, 'corr-hist', $7, $8)`,
      [
        tenantId,
        empresaId,
        finalidade,
        String(minutosAtras),
        resultado,
        resultado === 'SUCESSO' ? null : 'SIGNER_DESTINO_INDISPONIVEL',
        extra.reutilizado ?? false,
        extra.origem ?? null,
      ],
    );

  it('último SUCESSO/FALHA por finalidade; RECUSA não conta e uma finalidade não contamina a outra', async () => {
    await semearEvento(c.tenantA, c.empresaA2, 'DFE_TESTE', 'FALHA', 30);
    await semearEvento(c.tenantA, c.empresaA2, 'DFE_TESTE', 'SUCESSO', 20);
    await semearEvento(c.tenantA, c.empresaA2, 'DFE_TESTE', 'RECUSA', 5);
    await semearEvento(c.tenantA, c.empresaA2, 'ESOCIAL_TESTE', 'SUCESSO', 25);
    await semearEvento(c.tenantA, c.empresaA2, 'ESOCIAL_TESTE', 'FALHA', 10);

    const ultimos = await comoSigner(c.tenantA, c.empresaA2, (cli) => ultimosEventosDasFinalidades(cli, c.empresaA2));

    expect(ultimos.map((u) => [u.finalidade, u.resultado])).toEqual([
      ['DFE_TESTE', 'SUCESSO'],
      ['ESOCIAL_TESTE', 'FALHA'],
    ]);
    expect(ultimos[0]).toMatchObject({ latenciaMs: 7 });
    expect(ultimos[0]?.iniciadoEm).toBeInstanceOf(Date);
  });

  it('empresa sem evento não tem nenhum último evento', async () => {
    const ultimos = await comoSigner(c.tenantA, c.empresaA3Arquivada, (cli) =>
      ultimosEventosDasFinalidades(cli, c.empresaA3Arquivada),
    );

    expect(ultimos).toEqual([]);
  });

  it('histórico paginado: 15 por página, do mais recente ao mais antigo, com o total', async () => {
    // i minutos atrás: quanto MAIOR o i, mais antigo. O mais recente é i = 1.
    for (let i = 1; i <= 17; i += 1) {
      await semearEvento(c.tenantB, c.empresaB1, 'DFE_TESTE', i % 2 === 0 ? 'SUCESSO' : 'FALHA', i);
    }

    const primeira = await comoSigner(c.tenantB, c.empresaB1, (cli) =>
      historicoDoSigner(cli, { empresaId: c.empresaB1, pagina: 1 }),
    );
    const segunda = await comoSigner(c.tenantB, c.empresaB1, (cli) =>
      historicoDoSigner(cli, { empresaId: c.empresaB1, pagina: 2 }),
    );
    const alem = await comoSigner(c.tenantB, c.empresaB1, (cli) =>
      historicoDoSigner(cli, { empresaId: c.empresaB1, pagina: 3 }),
    );

    expect(primeira).toMatchObject({ total: 17, pagina: 1 });
    expect(primeira.itens).toHaveLength(15);
    expect(segunda.itens).toHaveLength(2);
    expect(alem.itens).toHaveLength(0);
    // Ordem decrescente: cada item é mais antigo que o anterior, atravessando a fronteira das páginas.
    const instantes = [...primeira.itens, ...segunda.itens].map((item) => item.iniciadoEm.getTime());
    expect([...instantes].sort((a, b) => b - a)).toEqual(instantes);
  });

  it('o histórico de outra empresa nunca aparece (RLS)', async () => {
    const alheio = await comoSigner(c.tenantA, c.empresaA1, (cli) => historicoDoSigner(cli, { empresaId: c.empresaB1, pagina: 1 }));

    expect(alheio).toMatchObject({ total: 0, itens: [] });
  });

  it('o histórico respeita os filtros de finalidade e de resultado', async () => {
    await semearEvento(c.tenantA, c.empresaA1, 'ESOCIAL_TESTE', 'FALHA', 3, { origem: 'MANUAL' });
    await semearEvento(c.tenantA, c.empresaA1, 'DFE_TESTE', 'SUCESSO', 2, { reutilizado: true });

    const pagina = await comoSigner(c.tenantA, c.empresaA1, (cli) =>
      historicoDoSigner(cli, { empresaId: c.empresaA1, pagina: 1, finalidade: 'ESOCIAL_TESTE', resultado: 'FALHA' }),
    );

    expect(pagina.total).toBeGreaterThanOrEqual(1);
    expect(pagina.itens.every((i) => i.finalidade === 'ESOCIAL_TESTE' && i.resultado === 'FALHA')).toBe(true);
    expect(pagina.itens[0]).toMatchObject({ origemDiagnostico: 'MANUAL', identidadeTecnica: 'worker' });
  });
});

describe('evento (trilha append-only)', () => {
  it('grava sucesso, falha e recusa sem XML nem resposta do destino', async () => {
    const base = {
      tenantId: c.tenantA,
      empresaId: c.empresaA1,
      operacaoId: null,
      finalidade: 'DFE_TESTE' as const,
      referenciaSegredo: certA1.referencia,
      identidadeTecnica: 'worker',
      usuarioOriginadorId: null,
      hashConteudo: hex64(),
      chaveHmac: hex64(),
      iniciadoEm: new Date('2026-10-07T12:00:00.000Z'),
      finalizadoEm: new Date('2026-10-07T12:00:00.250Z'),
      latenciaMs: 250,
      correlationId: 'corr-trilha-isolada',
      reutilizado: false,
      origemDiagnostico: null,
    };

    await comoSigner(c.tenantA, c.empresaA1, async (cli) => {
      await registrarEventoDoSigner(cli, { ...base, resultado: 'SUCESSO', codigo: null });
      await registrarEventoDoSigner(cli, { ...base, resultado: 'FALHA', codigo: 'SIGNER_DESTINO_INDISPONIVEL' });
      await registrarEventoDoSigner(cli, { ...base, resultado: 'RECUSA', codigo: 'SIGNER_XML_INVALIDO', reutilizado: false });
    });

    const { rows } = await admin.query<{ resultado: string; codigo: string | null; latencia_ms: number }>(
      `select resultado, codigo, latencia_ms from app.signer_evento
        where empresa_id = $1 and correlation_id = 'corr-trilha-isolada' order by sequencia`,
      [c.empresaA1],
    );

    expect(rows.map((linha) => linha.resultado)).toEqual(['SUCESSO', 'FALHA', 'RECUSA']);
    expect(rows[0]).toMatchObject({ codigo: null, latencia_ms: 250 });
  });
});
