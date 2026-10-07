import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio, type ChaveDePermissao, type PapelPadrao } from '@contaia/domain';
import { ErroDoClienteDoSigner } from '@contaia/signer-client';
import { describe, expect, it, vi } from 'vitest';

import type { SessaoDoCofre } from '../certificados/visoes';
import { SignerService } from './signer.service';

const TENANT = '0198f3c2-0000-7000-8000-000000000001';
const EMPRESA = '0198f3c2-0000-7000-8000-000000000002';
const OUTRA_EMPRESA = '0198f3c2-0000-7000-8000-000000000003';
const USUARIO = '0198f3c2-0000-7000-8000-000000000004';

const sessao = (papeis: PapelPadrao[], permissoes: ChaveDePermissao[] = ['certificados.signer.testar']): SessaoDoCofre => ({
  tenantId: TENANT,
  usuarioId: USUARIO,
  papeis,
  permissoes,
});

const sucesso = { operacaoId: 'op-1', reutilizado: false, resultado: 'SUCESSO', codigo: null } as const;

const montar = () => {
  const cliente = { diagnosticar: vi.fn(), estados: vi.fn(), historico: vi.fn() };
  const fila = { add: vi.fn().mockResolvedValue({}) };
  const servico = new SignerService({ instancia: {} } as never, cliente as never, fila as never);

  return { cliente, fila, servico };
};

describe('teste manual (SPEC-012 §3.9)', () => {
  it('diagnostica DF-e e eSocial com origem MANUAL e o usuário que pediu', async () => {
    const { cliente, servico } = montar();
    cliente.diagnosticar.mockResolvedValue(sucesso);

    const resultados = await servico.testarManual(sessao(['admin_escritorio']), EMPRESA, undefined, 'corr-manual-0001');

    expect(cliente.diagnosticar).toHaveBeenCalledTimes(2);
    expect(cliente.diagnosticar).toHaveBeenCalledWith({
      tenantId: TENANT,
      empresaId: EMPRESA,
      finalidade: 'DFE_TESTE',
      correlationId: 'corr-manual-0001',
      origem: 'MANUAL',
      usuarioOriginadorId: USUARIO,
    });
    expect(resultados).toEqual([
      { finalidade: 'DFE_TESTE', resultado: 'SUCESSO', codigo: null, correlationId: 'corr-manual-0001' },
      { finalidade: 'ESOCIAL_TESTE', resultado: 'SUCESSO', codigo: null, correlationId: 'corr-manual-0001' },
    ]);
  });

  it('o contador também testa; testa só a finalidade pedida', async () => {
    const { cliente, servico } = montar();
    cliente.diagnosticar.mockResolvedValue(sucesso);

    const resultados = await servico.testarManual(sessao(['contador']), EMPRESA, 'ESOCIAL_TESTE', 'corr-manual-0002');

    expect(cliente.diagnosticar).toHaveBeenCalledTimes(1);
    expect(resultados.map((r) => r.finalidade)).toEqual(['ESOCIAL_TESTE']);
  });

  it('uma finalidade falha e a outra não: ambas são relatadas, com código acionável', async () => {
    const { cliente, servico } = montar();
    cliente.diagnosticar
      .mockResolvedValueOnce(sucesso)
      .mockRejectedValueOnce(new ErroDoClienteDoSigner('SIGNER_DESTINO_INDISPONIVEL', 504, 'x', true));

    const resultados = await servico.testarManual(sessao(['admin_escritorio']), EMPRESA, undefined, 'corr-manual-0003');

    expect(resultados.map((r) => [r.finalidade, r.resultado, r.codigo])).toEqual([
      ['DFE_TESTE', 'SUCESSO', null],
      ['ESOCIAL_TESTE', 'FALHA', 'SIGNER_DESTINO_INDISPONIVEL'],
    ]);
  });

  it('erro inesperado vira falha genérica, sem a mensagem da exceção', async () => {
    const { cliente, servico } = montar();
    cliente.diagnosticar.mockRejectedValue(new Error('SENHA-SENTINELA-NAO-PODE-VAZAR'));

    const resultados = await servico.testarManual(sessao(['admin_escritorio']), EMPRESA, 'DFE_TESTE', 'corr-manual-0004');

    expect(resultados[0]).toMatchObject({ resultado: 'FALHA', codigo: 'SIGNER_INDISPONIVEL' });
    expect(JSON.stringify(resultados)).not.toContain('SENTINELA');
  });

  it.each([['auxiliar'], ['auditor_readonly']] as const)('papel %s não testa, mesmo com a chave: a SPEC fixa admin e contador', async (papel) => {
    const { cliente, servico } = montar();

    await expect(servico.testarManual(sessao([papel]), EMPRESA, undefined, 'corr-manual-0005')).rejects.toMatchObject({
      codigo: CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
    });
    expect(cliente.diagnosticar).not.toHaveBeenCalled();
  });

  it('admin sem a chave `testar` (papel personalizado limitado) também não testa', async () => {
    const { cliente, servico } = montar();

    await expect(
      servico.testarManual(sessao(['admin_escritorio'], ['certificados.signer.consultar']), EMPRESA, undefined, 'corr-manual-0006'),
    ).rejects.toBeInstanceOf(ErroDeDominio);
    expect(cliente.diagnosticar).not.toHaveBeenCalled();
  });

  it('um segundo teste da MESMA empresa enquanto o primeiro roda é recusado; outra empresa não', async () => {
    const { cliente, servico } = montar();
    let liberar: () => void = () => {};
    cliente.diagnosticar.mockImplementation(
      () => new Promise((resolver) => { liberar = () => resolver(sucesso); }),
    );

    const primeiro = servico.testarManual(sessao(['admin_escritorio']), EMPRESA, 'DFE_TESTE', 'corr-manual-0007');
    await Promise.resolve();
    const duplicado = await servico
      .testarManual(sessao(['admin_escritorio']), EMPRESA, 'DFE_TESTE', 'corr-manual-0008')
      .catch((erro: unknown) => erro);

    expect(duplicado).toBeInstanceOf(ErroDeConflito);
    expect(duplicado).toMatchObject({ codigo: CODIGOS_DE_ERRO.SIGNER_TESTE_EM_ANDAMENTO });

    cliente.diagnosticar.mockResolvedValueOnce(sucesso);
    await expect(
      servico.testarManual(sessao(['admin_escritorio']), OUTRA_EMPRESA, 'DFE_TESTE', 'corr-manual-0009'),
    ).resolves.toHaveLength(1);

    liberar();
    await primeiro;
    cliente.diagnosticar.mockResolvedValue(sucesso);
    await expect(
      servico.testarManual(sessao(['admin_escritorio']), EMPRESA, 'DFE_TESTE', 'corr-manual-0010'),
    ).resolves.toHaveLength(1);
  });

  it('o bloqueio é liberado mesmo quando o teste falha', async () => {
    const { cliente, servico } = montar();
    cliente.diagnosticar.mockRejectedValueOnce(new Error('x')).mockResolvedValue(sucesso);

    await servico.testarManual(sessao(['admin_escritorio']), EMPRESA, 'DFE_TESTE', 'corr-manual-0011');

    await expect(
      servico.testarManual(sessao(['admin_escritorio']), EMPRESA, 'DFE_TESTE', 'corr-manual-0012'),
    ).resolves.toHaveLength(1);
  });
});

describe('diagnóstico pós-cadastro/substituição (SPEC-012 §3.9)', () => {
  it('enfileira DF-e e eSocial separados, como sistema (sem usuário originador)', async () => {
    const { fila, servico } = montar();

    await servico.agendarDiagnosticosPosCadastro(TENANT, EMPRESA, 'corr-ativ-0001');

    expect(fila.add).toHaveBeenCalledTimes(2);
    const chamadas = fila.add.mock.calls.map(([, dados, opcoes]) => ({ dados, jobId: (opcoes as { jobId: string }).jobId }));
    expect(chamadas.map((c) => c.dados)).toEqual([
      { tenantId: TENANT, empresaId: EMPRESA, finalidade: 'DFE_TESTE', correlationId: 'corr-ativ-0001', origem: 'AUTOMATICO' },
      { tenantId: TENANT, empresaId: EMPRESA, finalidade: 'ESOCIAL_TESTE', correlationId: 'corr-ativ-0001', origem: 'AUTOMATICO' },
    ]);
    expect(chamadas[0]!.jobId).not.toBe(chamadas[1]!.jobId);
  });

  it('falha ao enfileirar nunca desfaz nem derruba a ativação do certificado', async () => {
    const { fila, servico } = montar();
    fila.add.mockRejectedValue(new Error('redis fora do ar'));

    await expect(servico.agendarDiagnosticosPosCadastro(TENANT, EMPRESA, 'corr-ativ-0002')).resolves.toBeUndefined();
  });
});

describe('histórico para o navegador', () => {
  const item = {
    id: 'ev-1',
    finalidade: 'DFE_TESTE',
    resultado: 'FALHA',
    codigo: 'SIGNER_DESTINO_INDISPONIVEL',
    iniciadoEm: '2026-10-07T12:00:00.000Z',
    latenciaMs: 12,
    reutilizado: false,
    origemDiagnostico: 'MANUAL',
    identidadeTecnica: 'worker',
    correlationId: 'corr-0001-abcd',
    referenciaSegredo: '0198f3c2-0000-7000-8000-0000000000ff',
  } as const;

  it('repassa os filtros ao Signer e NUNCA entrega a referência do segredo ao navegador', async () => {
    const { cliente, servico } = montar();
    cliente.historico.mockResolvedValue({ pagina: 2, itensPorPagina: 15, total: 16, itens: [item] });

    const pagina = await servico.historico(
      sessao(['admin_escritorio']),
      EMPRESA,
      { pagina: 2, finalidade: 'DFE_TESTE', resultado: 'FALHA' },
      'corr-hist-0001',
    );

    expect(cliente.historico).toHaveBeenCalledWith({
      tenantId: TENANT,
      empresaId: EMPRESA,
      correlationId: 'corr-hist-0001',
      pagina: 2,
      finalidade: 'DFE_TESTE',
      resultado: 'FALHA',
    });
    expect(pagina).toMatchObject({ pagina: 2, itensPorPagina: 15, total: 16 });
    expect(pagina.itens[0]).not.toHaveProperty('referenciaSegredo');
    expect(JSON.stringify(pagina)).not.toContain('0198f3c2-0000-7000-8000-0000000000ff');
  });

  it('Signer fora do ar vira 503 acionável com o código estável (a tela mantém o último estado)', async () => {
    const { cliente, servico } = montar();
    cliente.historico.mockRejectedValue(new ErroDoClienteDoSigner('SIGNER_INDISPONIVEL', null, null, true));

    const erro = await servico
      .historico(sessao(['admin_escritorio']), EMPRESA, { pagina: 1 }, 'corr-hist-0002')
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeDominio);
    expect(erro).toMatchObject({ codigo: CODIGOS_DE_ERRO.SIGNER_INDISPONIVEL });
  });
});
