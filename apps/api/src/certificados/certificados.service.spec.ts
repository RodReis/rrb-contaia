/**
 * Casos de uso do cofre de certificados (SPEC-011, categoria Regras).
 *
 * O banco entra por dublê: o que se prova aqui é a decisão do caso de uso — quem pode agir,
 * em que ordem as fases acontecem, o que é compensado, o que vira evento — e que nada
 * sensível (referência do segredo, arquivo, senha, token) sai nas respostas. SQL, RLS,
 * atomicidade e concorrência reais têm provas próprias em `packages/db`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@contaia/db', async () => {
  const real = await vi.importActual<typeof import('@contaia/db')>('@contaia/db');

  return {
    ...real,
    comContextoHumano: vi.fn(async (_pool, _entrada, executar) => executar({} as never)),
    ativacaoDoTicket: vi.fn(),
    ativarVersao: vi.fn(),
    vincularTicketAoCertificado: vi.fn(),
    carregarItemDoCofre: vi.fn(),
    carregarVigente: vi.fn(),
    consumirTicketDeIngestao: vi.fn(),
    desativarVigente: vi.fn(),
    emitirTicketDeIngestao: vi.fn(),
    identidadeDoUsuario: vi.fn(),
    listarCofre: vi.fn(),
    listarHistoricoDeCertificados: vi.fn(),
    listarResponsaveisElegiveis: vi.fn(),
    listarVersoesDoCertificado: vi.fn(),
    reconciliarCofre: vi.fn(),
    registrarEventoDeCertificado: vi.fn(),
    situacoesDeResponsaveis: vi.fn(),
    travarCofreDaEmpresa: vi.fn(),
    trocarResponsavel: vi.fn(),
  };
});

import {
  ativacaoDoTicket,
  ativarVersao,
  vincularTicketAoCertificado,
  travarCofreDaEmpresa,
  carregarItemDoCofre,
  carregarVigente,
  comContextoHumano,
  consumirTicketDeIngestao,
  desativarVigente,
  emitirTicketDeIngestao,
  identidadeDoUsuario,
  listarCofre,
  listarHistoricoDeCertificados,
  listarResponsaveisElegiveis,
  listarVersoesDoCertificado,
  reconciliarCofre,
  registrarEventoDeCertificado,
  situacoesDeResponsaveis,
  trocarResponsavel,
  type ItemDoCofreBruto,
  type VersaoDoCertificado,
} from '@contaia/db';
import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  permissoesDosPapeisPadrao,
  type PapelPadrao,
} from '@contaia/domain';

import { CertificadosService } from './certificados.service';
import type { CofreClient } from './cofre.client';
import { assinarTicket } from './ticket';
import type { SessaoDoCofre } from './visoes';

const SEGREDO_DO_TICKET = 'x'.repeat(40);
const ID = (n: number): string => `01927b5c-8e1a-7c3d-9a1b-${String(n).padStart(12, '0')}`;
const TENANT = ID(1);
const EMPRESA = ID(2);
const USUARIO = ID(3);
const RESPONSAVEL = ID(4);
const NOVA_REFERENCIA = ID(90);
/** Valores que NUNCA podem aparecer em resposta: a referência do Vault e um segredo de teste. */
const REFERENCIA_ATUAL = ID(91);
const SENTINELA = 'SENHA-SENTINELA-123';
const AGORA = new Date('2026-10-15T15:00:00Z');
const HOJE = '2026-10-15';

const sessao = (papeis: PapelPadrao[] = ['contador'], extra: Partial<SessaoDoCofre> = {}): SessaoDoCofre => ({
  tenantId: TENANT,
  usuarioId: USUARIO,
  papeis,
  permissoes: permissoesDosPapeisPadrao(papeis),
  ...extra,
});

const versao = (sobre: Partial<VersaoDoCertificado> = {}): VersaoDoCertificado => ({
  id: ID(10),
  empresaId: EMPRESA,
  versao: 1,
  estado: 'VIGENTE',
  titular: 'EMPRESA DE TESTE',
  cnpjTitular: '11222333000181',
  autoridadeCertificadora: 'AC de Teste',
  cadeia: ['EMPRESA DE TESTE', 'AC de Teste'],
  numeroSerie: '01',
  impressaoDigital: 'AB'.repeat(32),
  validoDe: '2026-01-01',
  validoAte: '2027-01-01',
  responsavelId: RESPONSAVEL,
  referenciaSegredo: REFERENCIA_ATUAL,
  cadastradoEm: '2026-01-02T12:00:00.000Z',
  cadastradoPorId: USUARIO,
  encerradoEm: null,
  encerradoPorId: null,
  motivoDoEncerramento: null,
  justificativa: null,
  substituidoPorId: null,
  ...sobre,
});

const item = (sobre: Partial<ItemDoCofreBruto> = {}): ItemDoCofreBruto => ({
  empresaId: EMPRESA,
  empresaNome: 'Empresa Teste',
  cnpj: '11222333000181',
  regime: 'SIMPLES_NACIONAL',
  empresaArquivada: false,
  empresaAtiva: true,
  estado: 'VALIDO',
  diasParaVencer: 200,
  semResponsavel: false,
  certificado: versao(),
  responsavel: { id: RESPONSAVEL, nome: 'Rita Responsável', email: 'rita@local' },
  ...sobre,
});

const SEM_CERTIFICADO = item({ estado: 'SEM_CERTIFICADO', certificado: null, responsavel: null, diasParaVencer: null });

const elegiveis = [
  { id: RESPONSAVEL, nome: 'Rita Responsável', email: 'rita@local', papel: 'contador' as const },
  { id: USUARIO, nome: 'Uli Usuário', email: 'uli@local', papel: 'contador' as const },
];

class ServicoDeTeste extends CertificadosService {
  protected override agora(): Date {
    return AGORA;
  }
}

const cofre = { inutilizar: vi.fn(), restaurar: vi.fn() };
const agendador = { agendarDiagnosticosPosCadastro: vi.fn().mockResolvedValue(undefined) };
const servico = (): ServicoDeTeste =>
  new ServicoDeTeste({ instancia: {} as never } as never, cofre as unknown as CofreClient, agendador as never);

const codigoDe = async (acao: () => Promise<unknown>): Promise<string> => {
  try {
    await acao();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : `OUTRO:${String(erro)}`;
  }

  return 'nao_lancou';
};

const ambiente = { ...process.env };

beforeEach(() => {
  // Reset (não só clear): implementações de um teste não podem vazar para o seguinte.
  vi.resetAllMocks();
  process.env['COFRE_TICKET_SECRET'] = SEGREDO_DO_TICKET;
  process.env['COFRE_PUBLIC_URL'] = 'http://127.0.0.1:15104';
  process.env['COFRE_SERVICE_TOKEN'] = 'y'.repeat(40);
  process.env['COFRE_URL'] = 'http://cofre.local';
  vi.mocked(comContextoHumano).mockImplementation(async (_pool, _entrada, executar) => executar({} as never));
  vi.mocked(reconciliarCofre).mockResolvedValue({
    pendenciasAbertas: 0,
    pendenciasResolvidas: 0,
    alertasEmitidos: 0,
    responsaveisPerdidos: 0,
  });
  vi.mocked(situacoesDeResponsaveis).mockResolvedValue(new Map());
  vi.mocked(listarResponsaveisElegiveis).mockResolvedValue(elegiveis);
  vi.mocked(listarVersoesDoCertificado).mockResolvedValue([versao()]);
  vi.mocked(carregarItemDoCofre).mockResolvedValue(item());
  vi.mocked(registrarEventoDeCertificado).mockResolvedValue(undefined);
  cofre.inutilizar.mockResolvedValue(undefined);
  cofre.restaurar.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const nome of ['COFRE_TICKET_SECRET', 'COFRE_PUBLIC_URL', 'COFRE_SERVICE_TOKEN', 'COFRE_URL']) {
    if (ambiente[nome] === undefined) {
      delete process.env[nome];
    } else {
      process.env[nome] = ambiente[nome];
    }
  }
});

describe('consulta do cofre', () => {
  it('reconcilia a carteira, lista no banco e devolve só metadados com as ações do papel', async () => {
    vi.mocked(listarCofre).mockResolvedValue({
      resumo: { total: 1, validos: 1, vencendo: 0, vencidos: 0, semCertificado: 0, desativados: 0, semResponsavel: 0 },
      itens: [item()],
      total: 1,
    });

    const pagina = await servico().consultar(
      sessao(['admin_escritorio']),
      { busca: null, estado: null, ordem: 'EMPRESA', pagina: 3, limite: 10 },
      'corr',
    );

    expect(reconciliarCofre).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT, usuarioId: USUARIO, hoje: HOJE, empresaIds: null }),
    );
    expect(listarCofre).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      expect.objectContaining({ carteiraDoUsuarioId: USUARIO, limite: 10, deslocamento: 20 }),
      HOJE,
    );
    expect(pagina).toMatchObject({ pagina: 3, limite: 10, total: 1 });
    expect(pagina.itens[0]?.acoes).toEqual(['SUBSTITUIR', 'TROCAR_RESPONSAVEL', 'DESATIVAR']);
    expect(pagina.itens[0]?.certificado?.impressaoDigital).toBe('AB'.repeat(32));
  });

  it('a referência do segredo nunca sai: nem como campo, nem em lugar nenhum do JSON', async () => {
    vi.mocked(listarCofre).mockResolvedValue({
      resumo: { total: 1, validos: 1, vencendo: 0, vencidos: 0, semCertificado: 0, desativados: 0, semResponsavel: 0 },
      itens: [item()],
      total: 1,
    });

    const lista = await servico().consultar(
      sessao(),
      { busca: null, estado: null, ordem: 'EMPRESA', pagina: 1, limite: 25 },
      'c',
    );
    const detalhe = await servico().consultarEmpresa(sessao(), EMPRESA, 'c');
    const serializado = JSON.stringify([lista, detalhe]);

    expect(serializado).not.toContain(REFERENCIA_ATUAL);
    expect(serializado).not.toMatch(/referenciaSegredo|referencia_segredo|senha|password|pkcs|token/iu);
  });

  it('auxiliar e auditor veem o cofre mas sem nenhuma ação de mutação', async () => {
    vi.mocked(listarCofre).mockResolvedValue({
      resumo: { total: 1, validos: 1, vencendo: 0, vencidos: 0, semCertificado: 0, desativados: 0, semResponsavel: 0 },
      itens: [item()],
      total: 1,
    });

    for (const papel of ['auxiliar', 'auditor_readonly'] as const) {
      const pagina = await servico().consultar(
        sessao([papel]),
        { busca: null, estado: null, ordem: 'EMPRESA', pagina: 1, limite: 25 },
        'c',
      );

      expect(pagina.itens[0]?.acoes).toEqual([]);
    }
  });

  it('papel personalizado com todas as chaves mas sem papel padrão que muta não recebe ação', async () => {
    vi.mocked(carregarItemDoCofre).mockResolvedValue(SEM_CERTIFICADO);

    const detalhe = await servico().consultarEmpresa(
      sessao(['auxiliar'], { permissoes: permissoesDosPapeisPadrao(['admin_escritorio']) }),
      EMPRESA,
      'c',
    );

    expect(detalhe.item.acoes).toEqual([]);
  });

  it('empresa arquivada e empresa fora do alcance (RLS devolve nulo)', async () => {
    vi.mocked(carregarItemDoCofre).mockResolvedValueOnce(item({ empresaArquivada: true }));

    expect((await servico().consultarEmpresa(sessao(['admin_escritorio']), EMPRESA, 'c')).item.acoes).toEqual([]);

    vi.mocked(carregarItemDoCofre).mockResolvedValueOnce(null);

    expect(await codigoDe(() => servico().consultarEmpresa(sessao(), EMPRESA, 'c'))).toBe(
      CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,
    );
  });

  it('responsável inconsistente traz a situação real (só buscada onde a pendência está aberta)', async () => {
    vi.mocked(carregarItemDoCofre).mockResolvedValue(item({ semResponsavel: true }));
    vi.mocked(situacoesDeResponsaveis).mockResolvedValue(new Map([[`${RESPONSAVEL}:${EMPRESA}`, 'FORA_DA_CARTEIRA']]));

    const detalhe = await servico().consultarEmpresa(sessao(), EMPRESA, 'c');

    expect(detalhe.item.responsavel?.situacao).toBe('FORA_DA_CARTEIRA');
    expect(detalhe.item.semResponsavel).toBe(true);
  });

  it('lista os responsáveis elegíveis da empresa', async () => {
    expect(await servico().listarResponsaveis(sessao(), EMPRESA, 'c')).toEqual(elegiveis);
  });

  it('o histórico é filtrado pela carteira de quem consulta', async () => {
    vi.mocked(listarHistoricoDeCertificados).mockResolvedValue({ eventos: [], total: 0 });

    await servico().consultarHistorico(
      sessao(),
      { empresaId: null, acao: 'RECUSA', resultado: null, limite: 25, deslocamento: 0 },
      'c',
    );

    expect(listarHistoricoDeCertificados).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      expect.objectContaining({ carteiraDoUsuarioId: USUARIO, acao: 'RECUSA' }),
    );
  });

  it('a reconciliação pedida por sino e Central nunca derruba a tela de quem pediu', async () => {
    vi.mocked(reconciliarCofre).mockRejectedValueOnce(new Error('banco caiu'));

    await expect(servico().reconciliarDaCarteira({ tenantId: TENANT, usuarioId: USUARIO }, 'c')).resolves.toBeUndefined();

    await servico().reconciliarDaCarteira({ tenantId: TENANT, usuarioId: USUARIO }, 'c');
    expect(reconciliarCofre).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ usuarioId: USUARIO, empresaIds: null, hoje: HOJE }),
    );
  });
});

describe('emissão do ticket', () => {
  beforeEach(() => {
    vi.mocked(emitirTicketDeIngestao).mockResolvedValue({ id: ID(50), expiraEm: '2026-10-15T15:05:00.000Z' });
  });

  it('sem vigente é cadastro (chave criar); o ticket assinado leva operação, CNPJ e responsável', async () => {
    vi.mocked(carregarItemDoCofre).mockResolvedValue(SEM_CERTIFICADO);

    const resposta = await servico().emitirTicket(sessao(), EMPRESA, RESPONSAVEL, 'corr-9');

    expect(resposta).toMatchObject({
      operacao: 'CADASTRO',
      cofreUrl: 'http://127.0.0.1:15104',
      expiraEm: '2026-10-15T15:05:00.000Z',
    });
    expect(emitirTicketDeIngestao).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operacao: 'CADASTRO', usuarioId: USUARIO, responsavelId: RESPONSAVEL }),
    );

    const [parteUm] = resposta.ticket.split('.');
    expect(JSON.parse(Buffer.from(parteUm ?? '', 'base64url').toString('utf8'))).toEqual({
      jti: ID(50),
      tenantId: TENANT,
      empresaId: EMPRESA,
      usuarioId: USUARIO,
      cnpjDaEmpresa: '11222333000181',
      responsavelId: RESPONSAVEL,
      operacao: 'CADASTRO',
      correlationId: 'corr-9',
      exp: Math.floor(new Date('2026-10-15T15:05:00.000Z').getTime() / 1000),
    });
    expect(resposta.ticket).toBe(
      assinarTicket(JSON.parse(Buffer.from(parteUm ?? '', 'base64url').toString('utf8')), SEGREDO_DO_TICKET),
    );
  });

  it('com vigente é substituição e exige a chave substituir, não só criar', async () => {
    expect((await servico().emitirTicket(sessao(), EMPRESA, RESPONSAVEL, 'c')).operacao).toBe('SUBSTITUICAO');

    const soCriar = sessao(['contador'], { permissoes: ['certificados.cofre.consultar', 'certificados.cofre.criar'] });

    expect(await codigoDe(() => servico().emitirTicket(soCriar, EMPRESA, RESPONSAVEL, 'c'))).toBe(
      CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
    );
  });

  it('sem vigente, só a chave substituir não basta para cadastrar', async () => {
    vi.mocked(carregarItemDoCofre).mockResolvedValue(SEM_CERTIFICADO);
    const soSubstituir = sessao(['contador'], { permissoes: ['certificados.cofre.consultar', 'certificados.cofre.substituir'] });

    expect(await codigoDe(() => servico().emitirTicket(soSubstituir, EMPRESA, RESPONSAVEL, 'c'))).toBe(
      CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
    );
    expect(emitirTicketDeIngestao).not.toHaveBeenCalled();
  });

  it.each(['auxiliar', 'auditor_readonly'] as const)('%s não emite ticket', async (papel) => {
    expect(await codigoDe(() => servico().emitirTicket(sessao([papel]), EMPRESA, RESPONSAVEL, 'c'))).toBe(
      CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
    );
    expect(emitirTicketDeIngestao).not.toHaveBeenCalled();
  });

  it('responsável inválido bloqueia o cadastro e a tentativa recusada entra no histórico', async () => {
    vi.mocked(listarResponsaveisElegiveis).mockResolvedValue([elegiveis[1] ?? elegiveis[0]!]);

    expect(await codigoDe(() => servico().emitirTicket(sessao(), EMPRESA, RESPONSAVEL, 'corr-r'))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_RESPONSAVEL_INVALIDO,
    );
    expect(emitirTicketDeIngestao).not.toHaveBeenCalled();
    expect(registrarEventoDeCertificado).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        acao: 'RECUSA',
        codigo: 'CERTIFICADO_RESPONSAVEL_INVALIDO',
        certificadoId: null,
        usuarioId: USUARIO,
        correlationId: 'corr-r',
      }),
    );
  });

  it('empresa arquivada ou em cadastro não recebe certificado', async () => {
    vi.mocked(carregarItemDoCofre).mockResolvedValueOnce(item({ empresaArquivada: true }));

    expect(await codigoDe(() => servico().emitirTicket(sessao(['admin_escritorio']), EMPRESA, RESPONSAVEL, 'c'))).toBe(
      CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA,
    );

    vi.mocked(carregarItemDoCofre).mockResolvedValueOnce(item({ empresaAtiva: false }));

    expect(await codigoDe(() => servico().emitirTicket(sessao(), EMPRESA, RESPONSAVEL, 'c'))).toBe(
      CODIGOS_DE_ERRO.EMPRESA_NAO_ATIVA,
    );
  });

  it('cofre sem segredo de ticket ou sem URL pública: indisponível, sem fallback', async () => {
    delete process.env['COFRE_TICKET_SECRET'];

    expect(await codigoDe(() => servico().emitirTicket(sessao(), EMPRESA, RESPONSAVEL, 'c'))).toBe(
      CODIGOS_DE_ERRO.COFRE_INDISPONIVEL,
    );

    process.env['COFRE_TICKET_SECRET'] = SEGREDO_DO_TICKET;
    delete process.env['COFRE_PUBLIC_URL'];

    expect(await codigoDe(() => servico().emitirTicket(sessao(), EMPRESA, RESPONSAVEL, 'c'))).toBe(
      CODIGOS_DE_ERRO.COFRE_INDISPONIVEL,
    );
    expect(emitirTicketDeIngestao).not.toHaveBeenCalled();
  });
});

describe('troca de responsável', () => {
  it('troca por elegível, grava o evento e reconcilia (a pendência de responsável se resolve)', async () => {
    vi.mocked(trocarResponsavel).mockResolvedValue({
      versao: versao({ responsavelId: USUARIO }),
      mudou: true,
      responsavelAnteriorId: RESPONSAVEL,
    });

    await servico().trocarResponsavel(sessao(), EMPRESA, USUARIO, 'corr');

    expect(trocarResponsavel).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ novoResponsavelId: USUARIO, novoElegivel: true }),
    );
    expect(registrarEventoDeCertificado).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        acao: 'RESPONSAVEL_ALTERADO',
        usuarioId: USUARIO,
        motivo: 'Rita Responsável → Uli Usuário',
      }),
    );
    expect(reconciliarCofre).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ empresaIds: [EMPRESA] }));
  });

  it('escolher o mesmo responsável não gera evento', async () => {
    vi.mocked(trocarResponsavel).mockResolvedValue({
      versao: versao(),
      mudou: false,
      responsavelAnteriorId: RESPONSAVEL,
    });

    await servico().trocarResponsavel(sessao(), EMPRESA, RESPONSAVEL, 'c');

    expect(registrarEventoDeCertificado).not.toHaveBeenCalled();
  });

  it('candidato fora da lista de elegíveis é repassado como inelegível ao domínio', async () => {
    vi.mocked(trocarResponsavel).mockRejectedValue(
      new ErroDeDominio(CODIGOS_DE_ERRO.CERTIFICADO_RESPONSAVEL_INVALIDO, 'inválido'),
    );

    expect(await codigoDe(() => servico().trocarResponsavel(sessao(), EMPRESA, ID(77), 'c'))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_RESPONSAVEL_INVALIDO,
    );
    expect(trocarResponsavel).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ novoResponsavelId: ID(77), novoElegivel: false }),
    );
  });

  it.each(['auxiliar', 'auditor_readonly'] as const)('%s não troca responsável', async (papel) => {
    expect(await codigoDe(() => servico().trocarResponsavel(sessao([papel]), EMPRESA, USUARIO, 'c'))).toBe(
      CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
    );
  });
});

describe('desativação (cofre inutilizado sob o lock da empresa)', () => {
  beforeEach(() => {
    vi.mocked(carregarVigente).mockResolvedValue(versao());
    vi.mocked(desativarVigente).mockResolvedValue(
      versao({ estado: 'DESATIVADO', justificativa: 'Troca de titularidade', encerradoEm: '2026-10-15T15:00:00.000Z' }),
    );
  });

  it('inutiliza no cofre ANTES de desativar, depois registra o evento com o motivo', async () => {
    const ordem: string[] = [];
    cofre.inutilizar.mockImplementation(async () => void ordem.push('inutilizar'));
    vi.mocked(desativarVigente).mockImplementation(async () => {
      ordem.push('desativar');

      return versao({ estado: 'DESATIVADO', justificativa: 'Troca de titularidade' });
    });

    await servico().desativar(sessao(), EMPRESA, 'Troca de titularidade', 'corr');

    expect(ordem).toEqual(['inutilizar', 'desativar']);
    expect(cofre.inutilizar).toHaveBeenCalledWith(REFERENCIA_ATUAL, { tenantId: TENANT, empresaId: EMPRESA }, 'corr');
    expect(registrarEventoDeCertificado).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ acao: 'DESATIVACAO', motivo: 'Troca de titularidade', usuarioId: USUARIO }),
    );
    expect(cofre.restaurar).not.toHaveBeenCalled();
    expect(reconciliarCofre).toHaveBeenCalled();
  });

  it('motivo vazio é bloqueado no domínio antes de tocar no cofre', async () => {
    expect(await codigoDe(() => servico().desativar(sessao(), EMPRESA, '   ', 'c'))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_MOTIVO_OBRIGATORIO,
    );
    expect(cofre.inutilizar).not.toHaveBeenCalled();
    expect(desativarVigente).not.toHaveBeenCalled();
  });

  it('o lock do cofre da empresa vem ANTES de ler o vigente e de falar com o cofre', async () => {
    const ordem: string[] = [];
    vi.mocked(travarCofreDaEmpresa).mockImplementation(async () => void ordem.push('lock'));
    vi.mocked(carregarVigente).mockImplementation(async () => {
      ordem.push('vigente');

      return versao();
    });
    cofre.inutilizar.mockImplementation(async () => void ordem.push('inutilizar'));

    await servico().desativar(sessao(), EMPRESA, 'motivo', 'c');

    expect(ordem.slice(0, 3)).toEqual(['lock', 'vigente', 'inutilizar']);
  });

  it('inutilizar com erro ambíguo (timeout): tenta restaurar, responde o erro e não toca no banco', async () => {
    cofre.inutilizar.mockRejectedValue(new ErroDeDominio(CODIGOS_DE_ERRO.COFRE_INDISPONIVEL, 'fora'));

    expect(await codigoDe(() => servico().desativar(sessao(), EMPRESA, 'motivo', 'corr'))).toBe(
      CODIGOS_DE_ERRO.COFRE_INDISPONIVEL,
    );
    // O Vault pode ter aplicado antes de o cliente desistir: devolver é idempotente e seguro,
    // porque sob o lock a versão continua vigente. Sem isso sobraria vigente com segredo deletado.
    expect(cofre.restaurar).toHaveBeenCalledWith(REFERENCIA_ATUAL, { tenantId: TENANT, empresaId: EMPRESA }, 'corr');
    expect(desativarVigente).not.toHaveBeenCalled();
  });

  it('falha na transação devolve o segredo ao cofre (compensação) e propaga o erro', async () => {
    vi.mocked(desativarVigente).mockRejectedValue(new Error('banco caiu'));

    expect(await codigoDe(() => servico().desativar(sessao(), EMPRESA, 'motivo', 'corr'))).toMatch(/^OUTRO/u);
    expect(cofre.restaurar).toHaveBeenCalledTimes(1);
  });

  it('o segredo é devolvido uma única vez, mesmo que a falha venha depois (commit)', async () => {
    vi.mocked(desativarVigente).mockRejectedValue(new Error('banco caiu'));

    await codigoDe(() => servico().desativar(sessao(), EMPRESA, 'motivo', 'c'));

    expect(cofre.restaurar).toHaveBeenCalledTimes(1);
    expect(carregarVigente).toHaveBeenCalledTimes(1);
  });

  it('falha SÓ no commit com a versão ainda vigente: devolve o segredo', async () => {
    let chamadas = 0;
    vi.mocked(comContextoHumano).mockImplementation(async (_pool, _entrada, executar) => {
      chamadas += 1;
      const resultado = await executar({} as never);

      if (chamadas === 1) {
        throw new Error('conexão perdida no commit');
      }

      return resultado;
    });

    expect(await codigoDe(() => servico().desativar(sessao(), EMPRESA, 'motivo', 'corr'))).toMatch(/^OUTRO/u);
    expect(cofre.restaurar).toHaveBeenCalledTimes(1);
  });

  it('falha SÓ no commit mas a versão já foi desativada (commit chegou): NUNCA devolve o segredo', async () => {
    let chamadas = 0;
    vi.mocked(comContextoHumano).mockImplementation(async (_pool, _entrada, executar) => {
      chamadas += 1;

      if (chamadas === 1) {
        await executar({} as never);
        vi.mocked(carregarVigente).mockResolvedValue(null);
        throw new Error('conexão perdida no commit');
      }

      return executar({} as never);
    });

    expect(await codigoDe(() => servico().desativar(sessao(), EMPRESA, 'motivo', 'c'))).toMatch(/^OUTRO/u);
    expect(cofre.restaurar).not.toHaveBeenCalled();
  });

  it('segunda desativação da mesma versão (vigente já desativado sob o lock): 409, sem inutilizar nem restaurar', async () => {
    vi.mocked(carregarVigente).mockResolvedValue(null);

    expect(await codigoDe(() => servico().desativar(sessao(), EMPRESA, 'motivo', 'c'))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_VIGENTE_INEXISTENTE,
    );
    expect(cofre.inutilizar).not.toHaveBeenCalled();
    expect(cofre.restaurar).not.toHaveBeenCalled();
  });

  it('falha ao restaurar não mascara o erro original', async () => {
    vi.mocked(desativarVigente).mockRejectedValue(new ErroDeDominio(CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO, 'x'));
    cofre.restaurar.mockRejectedValue(new ErroDeDominio(CODIGOS_DE_ERRO.COFRE_INDISPONIVEL, 'fora'));

    expect(await codigoDe(() => servico().desativar(sessao(), EMPRESA, 'motivo', 'c'))).toBe(
      CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
    );
  });

  it.each(['auxiliar', 'auditor_readonly'] as const)('%s não desativa', async (papel) => {
    expect(await codigoDe(() => servico().desativar(sessao([papel]), EMPRESA, 'motivo', 'c'))).toBe(
      CODIGOS_DE_ERRO.SEM_AUTORIZACAO,
    );
    expect(cofre.inutilizar).not.toHaveBeenCalled();
  });
});

describe('ativação pelo cofre (rota interna)', () => {
  const carga = (sobre: object = {}) => ({
    jti: ID(50),
    tenantId: TENANT,
    empresaId: EMPRESA,
    usuarioId: USUARIO,
    cnpjDaEmpresa: '11222333000181',
    responsavelId: RESPONSAVEL,
    operacao: 'CADASTRO' as const,
    correlationId: 'corr-ticket',
    exp: Math.floor(AGORA.getTime() / 1000) + 300,
    ...sobre,
  });
  const pedido = (cargaDoTicket: object = carga(), metadados: object = {}) => ({
    ticket: assinarTicket(cargaDoTicket as never, SEGREDO_DO_TICKET),
    referenciaDoSegredo: NOVA_REFERENCIA,
    metadados: {
      titular: 'EMPRESA DE TESTE',
      cnpjTitular: '11222333000181',
      autoridadeCertificadora: 'AC de Teste',
      cadeia: ['EMPRESA DE TESTE', 'AC de Teste'],
      numeroSerie: '0A',
      impressaoDigital: 'CD'.repeat(32),
      naoAntes: '2026-01-01T03:00:00.000Z',
      naoDepois: '2027-01-01T02:59:59.000Z',
      ...metadados,
    },
  });
  const nova = versao({ id: ID(60), referenciaSegredo: NOVA_REFERENCIA });

  beforeEach(() => {
    vi.mocked(carregarItemDoCofre).mockResolvedValue(SEM_CERTIFICADO);
    vi.mocked(consumirTicketDeIngestao).mockResolvedValue(true);
    vi.mocked(identidadeDoUsuario).mockResolvedValue({
      usuarioId: USUARIO,
      tenantId: TENANT,
      papeis: ['contador'],
      permissoesPersonalizadas: [],
      statusDoTenant: 'ATIVO',
    });
    vi.mocked(ativarVersao).mockResolvedValue({ nova, anteriorId: null, acao: 'CADASTRO' });
  });

  it('consome o ticket, ativa como o usuário do ticket e registra o evento do cofre', async () => {
    const resposta = await servico().ativar(pedido(), 'corr-cofre');

    expect(consumirTicketDeIngestao).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: ID(50), usuarioId: USUARIO, operacao: 'CADASTRO' }),
      'CONSUMIDO',
    );
    expect(comContextoHumano).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT, usuarioId: USUARIO }),
      expect.any(Function),
    );
    expect(ativarVersao).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operacao: 'CADASTRO',
        responsavelId: RESPONSAVEL,
        autorId: USUARIO,
        dados: expect.objectContaining({
          validoDe: '2026-01-01',
          validoAte: '2026-12-31',
          referenciaSegredo: NOVA_REFERENCIA,
        }),
      }),
    );
    expect(registrarEventoDeCertificado).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        acao: 'CADASTRO',
        certificadoId: ID(60),
        usuarioId: USUARIO,
        identidadeTecnica: 'cofre',
        correlationId: 'corr-cofre',
      }),
    );
    expect(reconciliarCofre).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ empresaIds: [EMPRESA] }));
    expect(resposta.certificado.id).toBe(ID(60));
  });

  it('a resposta traz só metadados: nem referência, nem senha, nem token', async () => {
    const resposta = await servico().ativar(pedido(), 'c');
    const serializado = JSON.stringify(resposta);

    expect(serializado).not.toContain(NOVA_REFERENCIA);
    expect(serializado).not.toContain(SENTINELA);
    expect(Object.keys(resposta)).toEqual(['certificado']);
    expect(Object.keys(resposta.certificado)).not.toContain('referenciaSegredo');
  });

  it('substituição registra SUBSTITUICAO', async () => {
    vi.mocked(carregarItemDoCofre).mockResolvedValue(item());
    vi.mocked(ativarVersao).mockResolvedValue({ nova, anteriorId: ID(10), acao: 'SUBSTITUICAO' });

    await servico().ativar(pedido(carga({ operacao: 'SUBSTITUICAO' })), 'c');

    expect(registrarEventoDeCertificado).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ acao: 'SUBSTITUICAO' }),
    );
  });

  it('ticket forjado ou de outro segredo: recusado antes de qualquer acesso ao banco', async () => {
    const forjado = { ...pedido(), ticket: assinarTicket(carga(), 'z'.repeat(40)) };

    expect(await codigoDe(() => servico().ativar(forjado, 'c'))).toBe(CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO);
    expect(comContextoHumano).not.toHaveBeenCalled();
    expect(ativarVersao).not.toHaveBeenCalled();
  });

  it('ticket vencido: não consome nem ativa; só a repetição de uma ativação já feita responde', async () => {
    const vencido = pedido(carga({ exp: Math.floor(AGORA.getTime() / 1000) - 1 }));
    vi.mocked(ativacaoDoTicket).mockResolvedValue(null);

    expect(await codigoDe(() => servico().ativar(vencido, 'c'))).toBe(CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO);
    expect(consumirTicketDeIngestao).not.toHaveBeenCalled();
    expect(ativarVersao).not.toHaveBeenCalled();
  });

  it('vincula o ticket à versão ativada na MESMA transação, antes do evento', async () => {
    const ordem: string[] = [];
    vi.mocked(vincularTicketAoCertificado).mockImplementation(async () => void ordem.push('vincular'));
    vi.mocked(registrarEventoDeCertificado).mockImplementation(async () => void ordem.push('evento'));

    await servico().ativar(pedido(), 'c');

    expect(vincularTicketAoCertificado).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      ticketId: ID(50),
      certificadoId: ID(60),
    });
    expect(ordem).toEqual(['vincular', 'evento']);
  });

  describe('idempotência por ticket (o cofre repete depois de um timeout em que a API comitou)', () => {
    beforeEach(() => {
      vi.mocked(consumirTicketDeIngestao).mockResolvedValue(false);
    });

    it('ticket consumido com a MESMA referência: 200 com a mesma versão, sem troca nem evento novo', async () => {
      vi.mocked(ativacaoDoTicket).mockResolvedValue(nova);

      const resposta = await servico().ativar(pedido(), 'c');

      expect(resposta.certificado.id).toBe(ID(60));
      expect(ativacaoDoTicket).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: ID(50), usuarioId: USUARIO, empresaId: EMPRESA }),
      );
      expect(ativarVersao).not.toHaveBeenCalled();
      expect(vincularTicketAoCertificado).not.toHaveBeenCalled();
      expect(registrarEventoDeCertificado).not.toHaveBeenCalled();
      expect(JSON.stringify(resposta)).not.toContain(NOVA_REFERENCIA);
    });

    it('a repetição também vale com o ticket já vencido (o prazo era da primeira tentativa)', async () => {
      vi.mocked(ativacaoDoTicket).mockResolvedValue(nova);

      const vencido = pedido(carga({ exp: Math.floor(AGORA.getTime() / 1000) - 60 }));

      expect((await servico().ativar(vencido, 'c')).certificado.id).toBe(ID(60));
    });

    it('ticket consumido com OUTRA referência: 403 CERTIFICADO_TICKET_INVALIDO (nada é devolvido)', async () => {
      vi.mocked(ativacaoDoTicket).mockResolvedValue(nova);

      const outra = { ...pedido(), referenciaDoSegredo: ID(99) };

      expect(await codigoDe(() => servico().ativar(outra, 'c'))).toBe(CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO);
      expect(ativarVersao).not.toHaveBeenCalled();
    });

    it('ticket consumido que não ativou nada (primeira tentativa recusada): 403', async () => {
      vi.mocked(ativacaoDoTicket).mockResolvedValue(null);

      expect(await codigoDe(() => servico().ativar(pedido(), 'c'))).toBe(
        CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO,
      );
    });
  });

  it('certificado com vários CNPJs: o que casa com a empresa é o gravado', async () => {
    const lista = ['99888777000166', '11.222.333/0001-81'];

    await servico().ativar(pedido(carga(), { cnpjTitular: lista[0], cnpjsDoTitular: lista }), 'c');

    expect(ativarVersao).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dados: expect.objectContaining({ cnpjTitular: '11.222.333/0001-81' }) }),
    );
  });

  it('nenhum dos CNPJs é o da empresa: divergente', async () => {
    expect(
      await codigoDe(() =>
        servico().ativar(
          pedido(carga(), { cnpjTitular: '99888777000166', cnpjsDoTitular: ['99888777000166', '55666777000122'] }),
          'c',
        ),
      ),
    ).toBe(CODIGOS_DE_ERRO.CERTIFICADO_CNPJ_DIVERGENTE);
  });

  it('ticket já consumido (uso único): recusado e nada é ativado', async () => {
    vi.mocked(consumirTicketDeIngestao).mockResolvedValue(false);
    vi.mocked(ativacaoDoTicket).mockResolvedValue(null);

    expect(await codigoDe(() => servico().ativar(pedido(), 'c'))).toBe(CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO);
    expect(ativarVersao).not.toHaveBeenCalled();
  });

  it('usuário do ticket suspenso ou sem identidade: SEM_AUTORIZACAO, recusa registrada', async () => {
    vi.mocked(identidadeDoUsuario).mockResolvedValue(null);

    expect(await codigoDe(() => servico().ativar(pedido(), 'corr-x'))).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
    expect(ativarVersao).not.toHaveBeenCalled();
    expect(registrarEventoDeCertificado).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ acao: 'RECUSA', codigo: CODIGOS_DE_ERRO.SEM_AUTORIZACAO, certificadoId: null }),
    );
  });

  it('permissão reduzida depois da emissão vale: papel que perdeu o poder de mutar é recusado', async () => {
    vi.mocked(identidadeDoUsuario).mockResolvedValue({
      usuarioId: USUARIO,
      tenantId: TENANT,
      papeis: ['auxiliar'],
      permissoesPersonalizadas: ['certificados.cofre.criar'],
      statusDoTenant: 'ATIVO',
    });

    expect(await codigoDe(() => servico().ativar(pedido(), 'c'))).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
    expect(ativarVersao).not.toHaveBeenCalled();
  });

  it('responsável que deixou de ser elegível entre a emissão e o envio: recusado', async () => {
    vi.mocked(listarResponsaveisElegiveis).mockResolvedValue([elegiveis[1] ?? elegiveis[0]!]);

    expect(await codigoDe(() => servico().ativar(pedido(), 'c'))).toBe(
      CODIGOS_DE_ERRO.CERTIFICADO_RESPONSAVEL_INVALIDO,
    );
    expect(ativarVersao).not.toHaveBeenCalled();
  });

  it('CNPJ do certificado diferente do da empresa: recusado e registrado, sem ativar', async () => {
    const codigo = await codigoDe(() =>
      servico().ativar(pedido(carga(), { cnpjTitular: '99888777000166' }), 'corr-cnpj'),
    );

    expect(codigo).toBe(CODIGOS_DE_ERRO.CERTIFICADO_CNPJ_DIVERGENTE);
    expect(ativarVersao).not.toHaveBeenCalled();
    expect(registrarEventoDeCertificado).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ acao: 'RECUSA', codigo: 'CERTIFICADO_CNPJ_DIVERGENTE', identidadeTecnica: 'cofre' }),
    );
  });

  it('certificado expirado ou ainda não vigente: recusado (data civil de São Paulo)', async () => {
    expect(
      await codigoDe(() => servico().ativar(pedido(carga(), { naoDepois: '2026-10-15T02:59:59.000Z' }), 'c')),
    ).toBe(CODIGOS_DE_ERRO.CERTIFICADO_EXPIRADO);
    expect(
      await codigoDe(() => servico().ativar(pedido(carga(), { naoAntes: '2026-10-16T03:00:00.000Z' }), 'c')),
    ).toBe(CODIGOS_DE_ERRO.CERTIFICADO_AINDA_NAO_VIGENTE);
    expect(ativarVersao).not.toHaveBeenCalled();
  });

  it('empresa que mudou de CNPJ desde a emissão: ticket inválido', async () => {
    vi.mocked(carregarItemDoCofre).mockResolvedValue(item({ cnpj: '55666777000122', certificado: null }));

    expect(await codigoDe(() => servico().ativar(pedido(), 'c'))).toBe(CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO);
  });

  it('estado que mudou depois do ticket (vigente apareceu): o domínio recusa, nada é convertido', async () => {
    vi.mocked(ativarVersao).mockRejectedValue(
      new ErroDeDominio(CODIGOS_DE_ERRO.CERTIFICADO_JA_VIGENTE, 'já tem vigente'),
    );

    expect(await codigoDe(() => servico().ativar(pedido(), 'c'))).toBe(CODIGOS_DE_ERRO.CERTIFICADO_JA_VIGENTE);
    expect(registrarEventoDeCertificado).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ acao: 'RECUSA', codigo: CODIGOS_DE_ERRO.CERTIFICADO_JA_VIGENTE }),
    );
  });

  it('falha de infraestrutura propaga (o cofre compensa) e não vira recusa de negócio', async () => {
    vi.mocked(ativarVersao).mockRejectedValue(new Error('banco caiu'));

    expect(await codigoDe(() => servico().ativar(pedido(), 'c'))).toMatch(/^OUTRO/u);
    expect(registrarEventoDeCertificado).not.toHaveBeenCalled();
  });

  it('falha ao registrar a recusa não esconde o erro de negócio', async () => {
    vi.mocked(identidadeDoUsuario).mockResolvedValue(null);
    vi.mocked(registrarEventoDeCertificado).mockRejectedValue(new Error('histórico fora'));

    expect(await codigoDe(() => servico().ativar(pedido(), 'c'))).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
  });
});

describe('recusa informada pelo cofre', () => {
  const carga = {
    jti: ID(50),
    tenantId: TENANT,
    empresaId: EMPRESA,
    usuarioId: USUARIO,
    cnpjDaEmpresa: '11222333000181',
    responsavelId: RESPONSAVEL,
    operacao: 'CADASTRO' as const,
    correlationId: 'corr-ticket',
    exp: 1,
  };

  it('consome o ticket como recusado e registra a tentativa com o código estável, mesmo com ticket vencido', async () => {
    vi.mocked(consumirTicketDeIngestao).mockResolvedValue(true);

    await servico().recusar(
      { ticket: assinarTicket(carga, SEGREDO_DO_TICKET), codigo: 'CERTIFICADO_SENHA_INCORRETA' },
      'corr-cofre',
    );

    expect(consumirTicketDeIngestao).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'RECUSADO');
    expect(registrarEventoDeCertificado).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        acao: 'RECUSA',
        codigo: 'CERTIFICADO_SENHA_INCORRETA',
        certificadoId: null,
        usuarioId: USUARIO,
        identidadeTecnica: 'cofre',
        correlationId: 'corr-cofre',
      }),
    );
  });

  it('ticket já consumido não gera evento duplicado', async () => {
    vi.mocked(consumirTicketDeIngestao).mockResolvedValue(false);

    expect(
      await codigoDe(() =>
        servico().recusar({ ticket: assinarTicket(carga, SEGREDO_DO_TICKET), codigo: 'CERTIFICADO_ARQUIVO_VAZIO' }, 'c'),
      ),
    ).toBe(CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO);
    expect(registrarEventoDeCertificado).not.toHaveBeenCalled();
  });

  it('ticket sem assinatura válida não registra nada', async () => {
    expect(
      await codigoDe(() =>
        servico().recusar({ ticket: assinarTicket(carga, 'w'.repeat(40)), codigo: 'CERTIFICADO_ARQUIVO_VAZIO' }, 'c'),
      ),
    ).toBe(CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO);
    expect(comContextoHumano).not.toHaveBeenCalled();
  });
});
