/**
 * Caso de uso do Signer (SPEC-012 §3.2–§3.9) sobre o PostgreSQL real (`contaia_app`, RLS valendo),
 * o dublê mTLS real e a PKI de teste. Só o Vault é substituído: um leitor falso que entrega o PFX
 * da empresa pedida e conta as leituras — é assim que se prova "sem leitura do certificado".
 */
import { randomUUID } from 'node:crypto';

import { criarPool, criarPoolDaAplicacao } from '@contaia/db';
import type { Finalidade } from '@contaia/domain';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarDuble, type Duble } from '../../../infra/docker/dubles/servidor-mtls.mjs';
import { criarPki, emitirPfx, raizConfiavelEmPem } from '../../../scripts/gerar-pki-de-teste.mjs';
import { criarPkiMtls, emitirServidorDoDuble } from '../../../scripts/gerar-pki-mtls-de-teste.mjs';
import { criarServicosDoSigner } from './caso-de-uso.js';
import { chamarDestino, type EntradaDoDestino, type ResultadoDoDestino } from './destino.js';
import { ErroDoSigner } from './erro.js';
import { chaveProtegida, hashDoConteudo, impressaoDigitalDoCertificado } from './idempotencia.js';
import { ErroDoVault, type LeitorDoVault, type SegredoLido } from './vault.js';
import { ADAPTADORES } from './xml/adaptadores.js';
import { abrirPkcs12ParaAssinar } from './xml/pkcs12.js';
import { verificarXmlAssinado } from './xml/verificar.js';

const SENHA_SENTINELA = 'SENHA-SENTINELA-NAO-PODE-VAZAR';
const PEPPER = 'pepper-de-teste-com-mais-de-32-bytes-0001';
const AGORA = new Date('2026-10-07T15:00:00.000Z');

const admin: Pool = criarPool();
const app: Pool = criarPoolDaAplicacao();

const sufixo = `${String(process.pid).padStart(6, '0').slice(-6)}${String(Date.now()).slice(-5)}`;
const pkiA1 = criarPki();
const pkiMtls = criarPkiMtls();
const servidorTls = emitirServidorDoDuble(pkiMtls, { dns: 'duble-dfe' });

const NFE = (id: string): string =>
  `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00" Id="${id}"><emit><CNPJ>00000000000191</CNPJ></emit></infNFe></NFe>`;

let duble: Duble;
let portaDuble = 0;
let tenantA = '';
let tenantB = '';
let usuarioA = '';
let usuarioB = '';
let contadorDeEmpresas = 0;

type Material = Readonly<{ cnpj: string; pfx: Buffer; certificadoPem: string; impressao: string }>;
type Semeada = Readonly<{ empresaId: string; certificadoId: string | null; referencia: string | null }>;

/** PFX de teste por empresa: o dublê só aceita o A1 cujo CNPJ é o declarado pela chamada. */
const materiais = new Map<string, Material>();

const vaultFalso = {
  ler: vi.fn<LeitorDoVault['ler']>(),
  pronto: vi.fn<LeitorDoVault['pronto']>(async () => true),
};
const destinoEspiado = vi.fn<(entrada: EntradaDoDestino) => Promise<ResultadoDoDestino>>();

/** Cópia nova a cada leitura: o Signer zera o buffer que recebe. */
const segredoDa = (empresaId: string): SegredoLido => {
  const material = materiais.get(empresaId);

  if (material === undefined) {
    throw new Error('empresa sem material de teste');
  }

  return { pkcs12: Buffer.from(material.pfx), senha: SENHA_SENTINELA, impressaoDigital: material.impressao };
};

const servicos = () =>
  criarServicosDoSigner({
    pool: app,
    vault: vaultFalso,
    chamarDestino: destinoEspiado,
    destinos: {
      DFE_TESTE: { host: '127.0.0.1', porta: portaDuble, servername: 'duble-dfe', caminho: '/v1/recepcao' },
      ESOCIAL_TESTE: { host: '127.0.0.1', porta: portaDuble, servername: 'duble-dfe', caminho: '/v1/recepcao' },
    },
    caDosDublesPem: pkiMtls.dubles.certificadoPem,
    pepper: PEPPER,
    agora: () => AGORA,
    tempoLimiteDoDestinoMs: 2_000,
  });

type OpcoesDoCertificado = null | {
  estado?: 'VIGENTE' | 'DESATIVADO';
  validoDe?: string;
  validoAte?: string;
  impressao?: string;
};

const semearEmpresa = async (
  tenantId: string,
  usuarioId: string,
  certificado: OpcoesDoCertificado,
): Promise<Semeada> => {
  contadorDeEmpresas += 1;
  // 14 dígitos únicos nesta execução: o CNPJ da empresa é o do A1 que o dublê vai conferir.
  const cnpj = `${sufixo}${String(contadorDeEmpresas).padStart(3, '0')}`;
  const { rows } = await admin.query<{ id: string }>(
    `insert into app.empresa (tenant_id, cnpj, razao_social, status, situacao)
     values ($1, $2, 'Empresa do Signer', 'ATIVA', 'ativo') returning id`,
    [tenantId, cnpj],
  );
  const empresaId = rows[0]!.id;
  const a1 = emitirPfx(pkiA1, { cnpj, senha: SENHA_SENTINELA });
  const certificadoPem = abrirPkcs12ParaAssinar(a1.pfx, SENHA_SENTINELA).certificadoPem;

  materiais.set(empresaId, { cnpj, pfx: a1.pfx, certificadoPem, impressao: impressaoDigitalDoCertificado(certificadoPem) });

  if (certificado === null) {
    return { empresaId, certificadoId: null, referencia: null };
  }

  const referencia = randomUUID();
  const desativado = certificado.estado === 'DESATIVADO';
  const { rows: cert } = await admin.query<{ id: string }>(
    `insert into app.empresa_certificado
       (tenant_id, empresa_id, versao, estado, titular, cnpj_titular, autoridade_certificadora, cadeia,
        numero_serie, impressao_digital, valido_de, valido_ate, responsavel_id, referencia_segredo, cadastrado_por,
        encerrado_em, encerrado_por, motivo_encerramento, justificativa)
     values ($1, $2, 1, $3, 'Titular', $4, 'AC', array['AC'], $5, $6, $7, $8, $9, $10, $9,
             ${desativado ? 'now()' : 'null'}, ${desativado ? '$9' : 'null'},
             ${desativado ? "'DESATIVACAO'" : 'null'}, ${desativado ? "'prova'" : 'null'})
     returning id`,
    [
      tenantId,
      empresaId,
      certificado.estado ?? 'VIGENTE',
      cnpj,
      `serie-${referencia}`,
      // A F11 grava a impressão digital em HEXADECIMAL MAIÚSCULO (apps/cofre/src/pkcs12.ts): a
      // fixture segue o formato real, senão o teste só provaria o formato que o Signer já espera.
      (certificado.impressao ?? materiais.get(empresaId)!.impressao).toUpperCase(),
      certificado.validoDe ?? '2026-01-01',
      certificado.validoAte ?? '2027-12-31',
      usuarioId,
      referencia,
    ],
  );

  return { empresaId, certificadoId: cert[0]!.id, referencia };
};

const contexto = (
  semeada: Semeada,
  parcial: Partial<{ tenantId: string; finalidade: Finalidade; chaveIdempotente: string; correlationId: string }> = {},
) => ({
  tenantId: tenantA,
  empresaId: semeada.empresaId,
  finalidade: 'DFE_TESTE' as Finalidade,
  chaveIdempotente: `chave-${randomUUID()}`,
  correlationId: 'corr-0001-abcd',
  ...parcial,
});

const erroDe = async (acao: Promise<unknown>): Promise<ErroDoSigner> => {
  try {
    await acao;
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroDoSigner);
    return erro as ErroDoSigner;
  }
  throw new Error('a operação deveria ter sido recusada');
};

const operacaoPor = async (chave: string) =>
  (await admin.query(`select * from app.signer_operacao where chave_hmac = $1`, [chaveProtegida(chave, PEPPER)])).rows[0] as
    | { id: string; estado: string; resultado_codigo: string | null; tentativas: number }
    | undefined;

const eventosDe = async (empresaId: string) =>
  (
    await admin.query<{ resultado: string; codigo: string | null; reutilizado: boolean; origem_diagnostico: string | null }>(
      `select resultado, codigo, reutilizado, origem_diagnostico from app.signer_evento where empresa_id = $1 order by sequencia`,
      [empresaId],
    )
  ).rows;

beforeAll(async () => {
  duble = criarDuble({
    nome: 'duble-dfe',
    certificadoPem: servidorTls.certificadoPem,
    chavePem: servidorTls.chavePem,
    caDosClientesPem: raizConfiavelEmPem(pkiA1),
  });
  portaDuble = await duble.ouvir(0, '127.0.0.1');

  const novoTenant = async (rotulo: string): Promise<string> =>
    (
      await admin.query<{ id: string }>(`insert into app.tenant (razao_social, cnpj) values ($1, $2) returning id`, [
        `Signer ${rotulo} ${sufixo}`,
        `S${rotulo}${sufixo}`.slice(0, 14).padEnd(14, '0'),
      ])
    ).rows[0]!.id;
  tenantA = await novoTenant('A');
  tenantB = await novoTenant('B');

  const novoUsuario = async (tenantId: string, rotulo: string): Promise<string> =>
    (
      await admin.query<{ id: string }>(
        `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado) values ($1, $2, $3, $4, 'ATIVO') returning id`,
        [tenantId, `sub-${rotulo}-${sufixo}`, `${rotulo}.${sufixo}@signer.local`, `Usuário ${rotulo}`],
      )
    ).rows[0]!.id;
  usuarioA = await novoUsuario(tenantA, 'a');
  usuarioB = await novoUsuario(tenantB, 'b');
}, 60_000);

afterAll(async () => {
  await duble.fechar();
  const cliente = await admin.connect();

  try {
    await cliente.query('set session_replication_role = replica');
    for (const { tabela } of (
      await cliente.query<{ tabela: string }>(
        `select table_name as tabela from information_schema.columns where table_schema = 'app' and column_name = 'tenant_id'`,
      )
    ).rows) {
      await cliente.query(`delete from app.${tabela} where tenant_id = any($1)`, [[tenantA, tenantB]]);
    }
    await cliente.query('delete from app.tenant where id = any($1)', [[tenantA, tenantB]]);
  } finally {
    await cliente.query('reset session_replication_role');
    cliente.release();
  }
  await Promise.all([admin.end(), app.end()]);
});

beforeEach(() => {
  vaultFalso.ler.mockReset();
  vaultFalso.ler.mockImplementation(async (escopo) => segredoDa(escopo.empresaId));
  destinoEspiado.mockReset();
  destinoEspiado.mockImplementation((entrada) => chamarDestino(entrada));
});

describe('execução mTLS: caminho feliz', () => {
  it('assina, valida, chama o dublê com o A1 e registra operação concluída e evento de sucesso', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const base = contexto(empresa);
    const antes = duble.efeitos();

    const resposta = await servicos().executarMtls('worker', { ...base, xml: NFE('NFe0001') });

    expect(resposta).toMatchObject({ reutilizado: false, resultado: 'SUCESSO', codigo: null });
    expect(duble.efeitos()).toBe(antes + 1);
    expect(vaultFalso.ler).toHaveBeenCalledTimes(1);
    expect(await operacaoPor(base.chaveIdempotente)).toMatchObject({ estado: 'CONCLUIDA', tentativas: 1 });
    expect(await eventosDe(empresa.empresaId)).toEqual([
      { resultado: 'SUCESSO', codigo: null, reutilizado: false, origem_diagnostico: null },
    ]);
  });

  it('o Signer só chama o destino configurado, com a operação como Idempotency-Key e o CNPJ da empresa', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const base = contexto(empresa);

    await servicos().executarMtls('worker', { ...base, xml: NFE('NFe0002') });

    const entrada = destinoEspiado.mock.calls[0]![0];
    const operacao = await operacaoPor(base.chaveIdempotente);

    expect(entrada.destino).toMatchObject({ host: '127.0.0.1', servername: 'duble-dfe', caminho: '/v1/recepcao' });
    expect(entrada.idempotencyKey).toBe(operacao!.id);
    expect(entrada.cnpj).toBe(materiais.get(empresa.empresaId)!.cnpj);
    expect(entrada.xml).toContain('<Signature');
  });
});

describe('idempotência (I-9, SPEC-012 §3.8)', () => {
  it('repetição idêntica com resultado terminal reutiliza: não lê o Vault, não reassina, não chama o dublê', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const pedido = { ...contexto(empresa), xml: NFE('NFe0003') };
    await servicos().executarMtls('worker', pedido);
    const efeitos = duble.efeitos();

    const repetida = await servicos().executarMtls('worker', pedido);

    expect(repetida).toMatchObject({ reutilizado: true, resultado: 'SUCESSO' });
    expect(vaultFalso.ler).toHaveBeenCalledTimes(1);
    expect(destinoEspiado).toHaveBeenCalledTimes(1);
    expect(duble.efeitos()).toBe(efeitos);
    expect((await eventosDe(empresa.empresaId)).map((e) => [e.resultado, e.reutilizado])).toEqual([
      ['SUCESSO', false],
      ['SUCESSO', true],
    ]);
  });

  it('mesma chave com conteúdo diferente é conflito: nada é lido nem enviado', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const base = contexto(empresa);
    await servicos().executarMtls('worker', { ...base, xml: NFE('NFe0004') });

    const erro = await erroDe(servicos().executarMtls('worker', { ...base, xml: NFE('NFe0005') }));

    expect(erro.codigo).toBe('SIGNER_IDEMPOTENCIA_CONFLITO');
    expect(erro.status).toBe(409);
    expect(vaultFalso.ler).toHaveBeenCalledTimes(1);
    expect(destinoEspiado).toHaveBeenCalledTimes(1);
  });

  it('mesma chave com finalidade diferente é conflito', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const base = contexto(empresa);
    const xml = `<eSocial xmlns="http://www.esocial.gov.br/x"><evtX Id="ID0001"/></eSocial>`;
    await servicos().executarMtls('worker', { ...base, xml: NFE('NFe0006') });

    const erro = await erroDe(servicos().executarMtls('worker', { ...base, finalidade: 'ESOCIAL_TESTE', xml }));

    expect(erro.codigo).toBe('SIGNER_IDEMPOTENCIA_CONFLITO');
  });

  it('a mesma chave em OUTRO tenant é conflito (409), sem revelar nada da operação alheia', async () => {
    const empresaA = await semearEmpresa(tenantA, usuarioA, {});
    const chave = `chave-${randomUUID()}`;
    await servicos().executarMtls('worker', { ...contexto(empresaA, { chaveIdempotente: chave }), xml: NFE('NFe0007') });
    const empresaDeB = await semearEmpresa(tenantB, usuarioB, {});

    const erro = await erroDe(
      servicos().executarMtls('worker', {
        ...contexto(empresaDeB, { tenantId: tenantB, chaveIdempotente: chave }),
        xml: NFE('NFe0007'),
      }),
    );

    expect(erro.codigo).toBe('SIGNER_IDEMPOTENCIA_CONFLITO');
    expect(erro.message).not.toContain(empresaA.empresaId);
  });

  it('operação em andamento informa o estado não terminal e não inicia concorrente', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const base = contexto(empresa);
    const xml = NFE('NFe0008');
    // Operação já aberta (outro processo ainda trabalhando nela).
    await admin.query(
      `insert into app.signer_operacao (tenant_id, empresa_id, finalidade, tipo, chave_hmac, hash_conteudo, certificado_id,
         referencia_segredo, identidade_tecnica, correlation_id)
       values ($1, $2, 'DFE_TESTE', 'MTLS', $3, $4, $5, $6, 'worker', 'corr-0001-abcd')`,
      [tenantA, empresa.empresaId, chaveProtegida(base.chaveIdempotente, PEPPER), hashDoConteudo(xml), empresa.certificadoId, empresa.referencia],
    );

    const erro = await erroDe(servicos().executarMtls('worker', { ...base, xml }));

    expect(erro.codigo).toBe('SIGNER_OPERACAO_EM_ANDAMENTO');
    expect(vaultFalso.ler).not.toHaveBeenCalled();
    expect(destinoEspiado).not.toHaveBeenCalled();
  });

  it('corrida determinística: a inserção concorrente espera o commit da outra, e a MESMA operação não vira conflito', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const base = contexto(empresa);
    const xml = NFE('NFe0090');
    const outro = await admin.connect();

    try {
      // Outro processo abriu a operação e ainda não confirmou: o Signer não a enxerga.
      await outro.query('begin');
      await outro.query(
        `insert into app.signer_operacao (tenant_id, empresa_id, finalidade, tipo, chave_hmac, hash_conteudo, certificado_id,
           referencia_segredo, identidade_tecnica, correlation_id)
         values ($1, $2, 'DFE_TESTE', 'MTLS', $3, $4, $5, $6, 'worker', 'corr-0001-abcd')`,
        [tenantA, empresa.empresaId, chaveProtegida(base.chaveIdempotente, PEPPER), hashDoConteudo(xml), empresa.certificadoId, empresa.referencia],
      );

      const concorrente = servicos().executarMtls('worker', { ...base, xml });
      concorrente.catch(() => undefined);
      await new Promise((resolver) => setTimeout(resolver, 300));
      await outro.query('commit');

      // A colisão acordou, a linha ficou visível e a decisão se refez: ainda em andamento, não conflito.
      const erro = await erroDe(concorrente);

      expect(erro.codigo).toBe('SIGNER_OPERACAO_EM_ANDAMENTO');
      expect(vaultFalso.ler).not.toHaveBeenCalled();
      expect(destinoEspiado).not.toHaveBeenCalled();
    } finally {
      await outro.query('rollback').catch(() => undefined);
      outro.release();
    }
  });

  it('duas chamadas simultâneas com a mesma chave: uma só executa e a outra nunca vira conflito', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const pedido = { ...contexto(empresa), xml: NFE('NFe0009') };
    const efeitos = duble.efeitos();

    const resultados = await Promise.allSettled([
      servicos().executarMtls('worker', pedido),
      servicos().executarMtls('worker', pedido),
    ]);

    expect(duble.efeitos()).toBe(efeitos + 1);
    expect(destinoEspiado).toHaveBeenCalledTimes(1);
    expect(resultados.filter((r) => r.status === 'fulfilled')).not.toHaveLength(0);
    for (const resultado of resultados) {
      if (resultado.status === 'rejected') {
        expect((resultado.reason as ErroDoSigner).codigo).not.toBe('SIGNER_IDEMPOTENCIA_CONFLITO');
      }
    }
  });
});

describe('falha transitória e definitiva', () => {
  it('destino fora do ar: uma tentativa, falha transitória; a mesma chave retoma a MESMA operação depois', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const pedido = { ...contexto(empresa), xml: NFE('NFe0010') };
    destinoEspiado.mockResolvedValueOnce({ tipo: 'INDISPONIVEL' });

    const erro = await erroDe(servicos().executarMtls('worker', pedido));
    const aposFalha = await operacaoPor(pedido.chaveIdempotente);

    expect(erro).toMatchObject({ codigo: 'SIGNER_DESTINO_INDISPONIVEL', status: 504 });
    expect(destinoEspiado).toHaveBeenCalledTimes(1);
    expect(aposFalha).toMatchObject({ estado: 'FALHA_TRANSITORIA', resultado_codigo: 'SIGNER_DESTINO_INDISPONIVEL' });

    const retomada = await servicos().executarMtls('worker', pedido);
    const aposRetentar = await operacaoPor(pedido.chaveIdempotente);

    expect(retomada).toMatchObject({ reutilizado: false, resultado: 'SUCESSO' });
    expect(aposRetentar).toMatchObject({ id: aposFalha!.id, estado: 'CONCLUIDA', tentativas: 2 });
    expect(destinoEspiado.mock.calls[0]![0].idempotencyKey).toBe(destinoEspiado.mock.calls[1]![0].idempotencyKey);
    expect((await eventosDe(empresa.empresaId)).map((e) => e.resultado)).toEqual(['FALHA', 'SUCESSO']);
  });

  it('o dublê que já aceitou o efeito não o duplica na nova tentativa (mesma Idempotency-Key)', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const pedido = { ...contexto(empresa), xml: NFE('NFe0011') };
    // O dublê aceita, mas a resposta "se perde": o Signer vê falha transitória.
    destinoEspiado.mockImplementationOnce(async (entrada) => {
      await chamarDestino(entrada);
      return { tipo: 'INDISPONIVEL' };
    });
    const antes = duble.efeitos();

    await erroDe(servicos().executarMtls('worker', pedido));
    await servicos().executarMtls('worker', pedido);

    expect(duble.efeitos()).toBe(antes + 1);
  });

  it('falha de TLS no handshake é transitória e leva o código de mTLS recusado', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const pedido = { ...contexto(empresa), xml: NFE('NFe0012') };
    destinoEspiado.mockResolvedValueOnce({ tipo: 'FALHA_DE_TLS' });

    const erro = await erroDe(servicos().executarMtls('worker', pedido));

    expect(erro).toMatchObject({ codigo: 'SIGNER_MTLS_RECUSADO', status: 502 });
    expect(await operacaoPor(pedido.chaveIdempotente)).toMatchObject({ estado: 'FALHA_TRANSITORIA' });
  });

  it('recusa de aplicação do destino é definitiva: a repetição reutiliza a recusa, sem nova chamada', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const pedido = { ...contexto(empresa), xml: NFE('NFe0013') };
    destinoEspiado.mockResolvedValueOnce({ tipo: 'RECUSADO', statusHttp: 403 });

    const primeira = await erroDe(servicos().executarMtls('worker', pedido));
    const repetida = await erroDe(servicos().executarMtls('worker', pedido));

    expect(primeira.codigo).toBe('SIGNER_MTLS_RECUSADO');
    expect(repetida.codigo).toBe('SIGNER_MTLS_RECUSADO');
    expect(destinoEspiado).toHaveBeenCalledTimes(1);
    expect(vaultFalso.ler).toHaveBeenCalledTimes(1);
    expect(await operacaoPor(pedido.chaveIdempotente)).toMatchObject({ estado: 'RECUSADA' });
  });

  it('Vault indisponível: falha transitória, sem fallback inseguro e sem chamar o destino', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const pedido = { ...contexto(empresa), xml: NFE('NFe0014') };
    vaultFalso.ler.mockRejectedValueOnce(new ErroDoVault('INDISPONIVEL', null));

    const erro = await erroDe(servicos().executarMtls('worker', pedido));

    expect(erro).toMatchObject({ codigo: 'SIGNER_VAULT_INDISPONIVEL', status: 503 });
    expect(destinoEspiado).not.toHaveBeenCalled();
    expect(await operacaoPor(pedido.chaveIdempotente)).toMatchObject({ estado: 'FALHA_TRANSITORIA' });
  });

  it('versão apagada no Vault (soft delete da F11) vira certificado desativado, definitivo', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const pedido = { ...contexto(empresa), xml: NFE('NFe0015') };
    vaultFalso.ler.mockRejectedValueOnce(new ErroDoVault('NAO_ENCONTRADO', 404));

    const erro = await erroDe(servicos().executarMtls('worker', pedido));

    expect(erro.codigo).toBe('SIGNER_CERTIFICADO_DESATIVADO');
    expect(await operacaoPor(pedido.chaveIdempotente)).toMatchObject({ estado: 'RECUSADA' });
  });

  it('o Vault entregar um certificado diferente do cadastrado falha, sem chamar o destino', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, { impressao: 'f'.repeat(64) });
    const pedido = { ...contexto(empresa), xml: NFE('NFe0016') };

    const erro = await erroDe(servicos().executarMtls('worker', pedido));

    expect(erro.codigo).toBe('SIGNER_VAULT_INDISPONIVEL');
    expect(destinoEspiado).not.toHaveBeenCalled();
  });
});

describe('condição do certificado e contexto: nada é lido antes (SPEC-012 §3.2, §3.5)', () => {
  it.each([
    ['ausente', null, 'SIGNER_CERTIFICADO_AUSENTE'],
    ['vencido', { validoAte: '2026-10-06' }, 'SIGNER_CERTIFICADO_VENCIDO'],
    ['ainda não vigente', { validoDe: '2026-10-08' }, 'SIGNER_CERTIFICADO_AINDA_NAO_VIGENTE'],
    ['desativado', { estado: 'DESATIVADO' as const }, 'SIGNER_CERTIFICADO_DESATIVADO'],
  ] as const)('certificado %s bloqueia sem ler o Vault nem chamar o destino, e registra a recusa', async (_nome, cert, codigo) => {
    const empresa = await semearEmpresa(tenantA, usuarioA, cert as OpcoesDoCertificado);

    const erro = await erroDe(servicos().executarMtls('worker', { ...contexto(empresa), xml: NFE('NFe0017') }));

    expect(erro.codigo).toBe(codigo);
    expect(vaultFalso.ler).not.toHaveBeenCalled();
    expect(destinoEspiado).not.toHaveBeenCalled();
    expect(await eventosDe(empresa.empresaId)).toMatchObject([{ resultado: 'RECUSA', codigo }]);
  });

  it('o último dia de validade ainda vale inteiro (data civil, I-11)', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, { validoAte: '2026-10-07' });

    const resposta = await servicos().executarMtls('worker', { ...contexto(empresa), xml: NFE('NFe0018') });

    expect(resposta.resultado).toBe('SUCESSO');
  });

  it('contexto cruzado (empresa de outro tenant) é recusado sem tocar o Vault e sem vazar a empresa', async () => {
    const empresaDeB = await semearEmpresa(tenantB, usuarioB, {});

    const erro = await erroDe(
      servicos().executarMtls('worker', { ...contexto(empresaDeB), xml: NFE('NFe0019') }),
    );

    expect(erro).toMatchObject({ codigo: 'SIGNER_CONTEXTO_INVALIDO', status: 403 });
    expect(vaultFalso.ler).not.toHaveBeenCalled();
    expect(destinoEspiado).not.toHaveBeenCalled();
  });

  it('empresa inexistente também é contexto inválido', async () => {
    const erro = await erroDe(
      servicos().executarMtls('worker', {
        ...contexto({ empresaId: randomUUID(), certificadoId: null, referencia: null }),
        xml: NFE('NFe0020'),
      }),
    );

    expect(erro.codigo).toBe('SIGNER_CONTEXTO_INVALIDO');
    expect(vaultFalso.ler).not.toHaveBeenCalled();
  });

  it('XML inválido é recusado antes de ler o Vault, com recusa registrada e sem operação', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const pedido = { ...contexto(empresa), xml: '<NFe><infNFe Id="A1"></NFe>' };

    const erro = await erroDe(servicos().executarMtls('worker', pedido));

    expect(erro.codigo).toBe('SIGNER_XML_INVALIDO');
    expect(vaultFalso.ler).not.toHaveBeenCalled();
    expect(await operacaoPor(pedido.chaveIdempotente)).toBeUndefined();
    expect(await eventosDe(empresa.empresaId)).toMatchObject([{ resultado: 'RECUSA', codigo: 'SIGNER_XML_INVALIDO' }]);
  });
});

describe('somente assinatura (sem saída de rede)', () => {
  it('devolve o XML assinado, verificável com o certificado público, e nunca chama o destino', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});

    const resposta = await servicos().assinar('worker', { ...contexto(empresa), xml: NFE('NFe0021') });

    expect(destinoEspiado).not.toHaveBeenCalled();
    expect(resposta.xmlAssinado).toContain('<Signature');
    expect(
      verificarXmlAssinado({
        xmlAssinado: resposta.xmlAssinado!,
        certificadoPem: materiais.get(empresa.empresaId)!.certificadoPem,
        adaptador: ADAPTADORES['DFE_TESTE'],
      }),
    ).toBe(true);
  });

  it('a repetição reutiliza o resultado e não devolve o XML, que nunca é persistido', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const pedido = { ...contexto(empresa), xml: NFE('NFe0022') };
    await servicos().assinar('worker', pedido);

    const repetida = await servicos().assinar('worker', pedido);

    expect(repetida).toMatchObject({ reutilizado: true, xmlAssinado: null });
    expect(vaultFalso.ler).toHaveBeenCalledTimes(1);
  });
});

describe('diagnóstico (SPEC-012 §3.9)', () => {
  const comandoDe = (empresaId: string, finalidade: Finalidade, correlationId: string) => ({
    tenantId: tenantA,
    empresaId,
    finalidade,
    correlationId,
    origem: 'AUTOMATICO' as const,
  });

  it('usa o XML do próprio Signer, chama o dublê e registra a origem', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const antes = duble.efeitos();

    const resposta = await servicos().diagnosticar('api', {
      ...comandoDe(empresa.empresaId, 'DFE_TESTE', 'diag-0001-abcd'),
      origem: 'MANUAL',
      usuarioOriginadorId: usuarioA,
    });

    expect(resposta).toMatchObject({ resultado: 'SUCESSO', reutilizado: false });
    expect(duble.efeitos()).toBe(antes + 1);
    expect(await eventosDe(empresa.empresaId)).toMatchObject([{ resultado: 'SUCESSO', origem_diagnostico: 'MANUAL' }]);
  });

  it('DF-e e eSocial são diagnosticados separadamente, cada um com o seu evento', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});

    await servicos().diagnosticar('worker', comandoDe(empresa.empresaId, 'DFE_TESTE', 'diag-0002-abcd'));
    await servicos().diagnosticar('worker', comandoDe(empresa.empresaId, 'ESOCIAL_TESTE', 'diag-0002-abcd'));

    const { rows } = await admin.query<{ finalidade: string }>(
      `select finalidade from app.signer_evento where empresa_id = $1 order by sequencia`,
      [empresa.empresaId],
    );
    expect(rows.map((r) => r.finalidade)).toEqual(['DFE_TESTE', 'ESOCIAL_TESTE']);
  });

  it('o mesmo diagnóstico (mesma correlação) repetido reutiliza; uma nova execução chama de novo', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});

    await servicos().diagnosticar('worker', comandoDe(empresa.empresaId, 'DFE_TESTE', 'diag-0003-abcd'));
    const repetido = await servicos().diagnosticar('worker', comandoDe(empresa.empresaId, 'DFE_TESTE', 'diag-0003-abcd'));
    await servicos().diagnosticar('worker', comandoDe(empresa.empresaId, 'DFE_TESTE', 'diag-0004-abcd'));

    expect(repetido.reutilizado).toBe(true);
    expect(destinoEspiado).toHaveBeenCalledTimes(2);
  });

  it('falha do diagnóstico não desfaz nem desativa o certificado: a vigência continua', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    destinoEspiado.mockResolvedValueOnce({ tipo: 'INDISPONIVEL' });

    await erroDe(servicos().diagnosticar('worker', comandoDe(empresa.empresaId, 'DFE_TESTE', 'diag-0005-abcd')));
    const { rows } = await admin.query<{ estado: string }>(`select estado from app.empresa_certificado where id = $1`, [
      empresa.certificadoId,
    ]);

    expect(rows[0]!.estado).toBe('VIGENTE');
  });
});

describe('estados e histórico (SPEC-012 §3.3, §5.2–§5.3)', () => {
  const diag = (empresaId: string, finalidade: Finalidade, correlationId: string) =>
    servicos().diagnosticar('worker', {
      tenantId: tenantA,
      empresaId,
      finalidade,
      correlationId,
      origem: 'AUTOMATICO' as const,
    });
  const consultaDeEstados = (empresaIds: string[], tenantId = tenantA) => ({
    tenantId,
    empresaIds,
    correlationId: 'corr-estados-0001',
  });

  it('DF-e e eSocial têm estado independente e o resumo é o pior dos dois', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    await diag(empresa.empresaId, 'DFE_TESTE', 'est-0001-abcd');
    destinoEspiado.mockResolvedValueOnce({ tipo: 'INDISPONIVEL' });
    await erroDe(diag(empresa.empresaId, 'ESOCIAL_TESTE', 'est-0002-abcd'));

    const { empresas } = (await servicos().estados('api', consultaDeEstados([empresa.empresaId]))) as {
      empresas: { empresaId: string; resumo: string; finalidades: { finalidade: string; estado: string; codigo: string | null; ultimoTesteEm: string | null }[] }[];
    };

    expect(empresas).toHaveLength(1);
    expect(empresas[0]!.finalidades.map((f) => [f.finalidade, f.estado])).toEqual([
      ['DFE_TESTE', 'OPERACIONAL'],
      ['ESOCIAL_TESTE', 'FALHA'],
    ]);
    expect(empresas[0]!.finalidades[1]!.codigo).toBe('SIGNER_DESTINO_INDISPONIVEL');
    expect(empresas[0]!.finalidades[0]!.ultimoTesteEm).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/u);
    expect(empresas[0]!.resumo).toBe('FALHA');
  });

  it('empresa nunca testada fica NAO_TESTADA; sem certificado utilizável, SEM_CERTIFICADO', async () => {
    const nunca = await semearEmpresa(tenantA, usuarioA, {});
    const semCert = await semearEmpresa(tenantA, usuarioA, null);

    const { empresas } = (await servicos().estados('api', consultaDeEstados([nunca.empresaId, semCert.empresaId]))) as {
      empresas: { empresaId: string; resumo: string }[];
    };

    expect(empresas.map((e) => [e.empresaId, e.resumo])).toEqual([
      [nunca.empresaId, 'NAO_TESTADO'],
      [semCert.empresaId, 'SEM_CERTIFICADO'],
    ]);
  });

  it('recusa por erro do chamador não derruba o estado de uma finalidade operacional', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    await diag(empresa.empresaId, 'DFE_TESTE', 'est-0003-abcd');
    await erroDe(servicos().executarMtls('worker', { ...contexto(empresa), xml: '<NFe><infNFe Id="A1"></NFe>' }));

    const { empresas } = (await servicos().estados('api', consultaDeEstados([empresa.empresaId]))) as {
      empresas: { finalidades: { finalidade: string; estado: string }[] }[];
    };

    expect(empresas[0]!.finalidades.find((f) => f.finalidade === 'DFE_TESTE')!.estado).toBe('OPERACIONAL');
  });

  it('empresa de outro tenant no lote recusa o lote inteiro, sem revelar nada', async () => {
    const minha = await semearEmpresa(tenantA, usuarioA, {});
    const alheia = await semearEmpresa(tenantB, usuarioB, {});

    const erro = await erroDe(servicos().estados('api', consultaDeEstados([minha.empresaId, alheia.empresaId])));

    expect(erro).toMatchObject({ codigo: 'SIGNER_CONTEXTO_INVALIDO', status: 403 });
  });

  it('histórico: página, total e itens sem XML nem segredo, do mais recente ao mais antigo', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    await diag(empresa.empresaId, 'DFE_TESTE', 'hist-0001-abc');
    await diag(empresa.empresaId, 'ESOCIAL_TESTE', 'hist-0002-abc');

    const pagina = (await servicos().historico('api', {
      tenantId: tenantA,
      empresaId: empresa.empresaId,
      correlationId: 'corr-hist-0001',
      pagina: 1,
    })) as { pagina: number; itensPorPagina: number; total: number; itens: Record<string, unknown>[] };

    expect(pagina).toMatchObject({ pagina: 1, itensPorPagina: 15, total: 2 });
    expect(pagina.itens.map((i) => i['finalidade'])).toEqual(['ESOCIAL_TESTE', 'DFE_TESTE']);
    expect(Object.keys(pagina.itens[0]!).sort()).toEqual(
      ['codigo', 'correlationId', 'finalidade', 'id', 'identidadeTecnica', 'iniciadoEm', 'latenciaMs', 'origemDiagnostico', 'referenciaSegredo', 'resultado', 'reutilizado'].sort(),
    );
    expect(JSON.stringify(pagina)).not.toMatch(/<Signature|pkcs12|SENHA-SENTINELA/u);
  });

  it('histórico de empresa de outro tenant é contexto inválido', async () => {
    const alheia = await semearEmpresa(tenantB, usuarioB, {});

    const erro = await erroDe(
      servicos().historico('api', { tenantId: tenantA, empresaId: alheia.empresaId, correlationId: 'corr-hist-0002', pagina: 1 }),
    );

    expect(erro.codigo).toBe('SIGNER_CONTEXTO_INVALIDO');
  });
});

describe('o segredo nunca fica fora da fronteira (I-10)', () => {
  it('a senha sentinela não aparece em nenhuma linha persistida nem em erro algum', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const ok = { ...contexto(empresa), xml: NFE('NFe0023') };
    const ruim = { ...contexto(empresa), xml: NFE('NFe0024') };
    await servicos().executarMtls('worker', ok);
    destinoEspiado.mockResolvedValueOnce({ tipo: 'INDISPONIVEL' });
    const erro = await erroDe(servicos().executarMtls('worker', ruim));

    const operacoes = (await admin.query(`select * from app.signer_operacao where empresa_id = $1`, [empresa.empresaId])).rows;
    const eventos = (await admin.query(`select * from app.signer_evento where empresa_id = $1`, [empresa.empresaId])).rows;

    expect(JSON.stringify([operacoes, eventos, erro.message, erro.codigo])).not.toContain(SENHA_SENTINELA);
    expect(JSON.stringify([operacoes, eventos])).not.toContain('<Signature');
  });

  it('o buffer do PKCS#12 é zerado ao terminar a operação', async () => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const entregue = segredoDa(empresa.empresaId);
    vaultFalso.ler.mockResolvedValueOnce(entregue);

    await servicos().executarMtls('worker', { ...contexto(empresa), xml: NFE('NFe0025') });

    expect(entregue.pkcs12.every((byte) => byte === 0)).toBe(true);
  });
});

describe('retomada concorrente, operação presa e rotação (revisão final)', () => {
  const comFalhaTransitoria = async (xml: string) => {
    const empresa = await semearEmpresa(tenantA, usuarioA, {});
    const pedido = { ...contexto(empresa), xml };

    destinoEspiado.mockResolvedValueOnce({ tipo: 'INDISPONIVEL' });
    await erroDe(servicos().executarMtls('worker', pedido));
    vaultFalso.ler.mockClear();

    return { empresa, pedido };
  };

  it('duas retomadas simultâneas depois de falha transitória: um só uso do segredo e nenhuma sem trilha', async () => {
    const { empresa, pedido } = await comFalhaTransitoria(NFE('NFe0031'));

    const resultados = await Promise.allSettled([
      servicos().executarMtls('worker', pedido),
      servicos().executarMtls('worker', pedido),
    ]);

    expect(vaultFalso.ler).toHaveBeenCalledTimes(1);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const resultado of resultados) {
      if (resultado.status === 'rejected') {
        expect((resultado.reason as ErroDoSigner).codigo).toBe('SIGNER_OPERACAO_EM_ANDAMENTO');
      }
    }
    expect((await operacaoPor(pedido.chaveIdempotente))?.estado).toBe('CONCLUIDA');
    // FALHA (1ª tentativa) + SUCESSO (retomada): nenhuma execução fica sem evento.
    expect((await eventosDe(empresa.empresaId)).map((e) => e.resultado)).toEqual(['FALHA', 'SUCESSO']);
  });

  it('operação presa em andamento passado o prazo é retomada (a mesma); dentro do prazo segue em andamento', async () => {
    const { pedido } = await comFalhaTransitoria(NFE('NFe0032'));
    const marcar = (intervalo: string) =>
      admin.query(
        `update app.signer_operacao
            set estado = 'EM_ANDAMENTO', resultado_codigo = null, finalizado_em = null,
                em_andamento_desde = now() - $2::interval
          where chave_hmac = $1`,
        [chaveProtegida(pedido.chaveIdempotente, PEPPER), intervalo],
      );

    await marcar('10 seconds');
    expect((await erroDe(servicos().executarMtls('worker', pedido))).codigo).toBe('SIGNER_OPERACAO_EM_ANDAMENTO');
    expect(vaultFalso.ler).not.toHaveBeenCalled();

    await marcar('10 minutes');
    const retomada = await servicos().executarMtls('worker', pedido);

    expect(retomada).toMatchObject({ reutilizado: false, resultado: 'SUCESSO' });
    expect(await operacaoPor(pedido.chaveIdempotente)).toMatchObject({ estado: 'CONCLUIDA', tentativas: 2 });
  });

  it('depois da rotação do certificado a mesma chave NÃO retoma com o novo: conflito, sem tocar o Vault', async () => {
    const { empresa, pedido } = await comFalhaTransitoria(NFE('NFe0033'));
    const cliente = await admin.connect();

    try {
      await cliente.query("set session_replication_role = 'replica'");
      await cliente.query(`update app.empresa_certificado set referencia_segredo = gen_random_uuid() where id = $1`, [
        empresa.certificadoId,
      ]);
    } finally {
      await cliente.query('reset session_replication_role');
      cliente.release();
    }

    expect((await erroDe(servicos().executarMtls('worker', pedido))).codigo).toBe('SIGNER_IDEMPOTENCIA_CONFLITO');
    expect(vaultFalso.ler).not.toHaveBeenCalled();
    expect(destinoEspiado).toHaveBeenCalledTimes(1);
  });
});
