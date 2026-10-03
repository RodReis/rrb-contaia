/**
 * Casos de uso de usuários (SPEC-007, categoria Regras).
 *
 * O banco entra por um dublê em memória que se comporta como o real onde isso
 * importa para a decisão: a transação desfaz tudo quando o caso de uso falha
 * (por isso "nada parcial" é provado, não presumido), e o e-mail é único entre
 * escritórios. Keycloak e e-mail entram por dublês com registro de chamadas.
 * SQL, RLS e concorrência real têm provas próprias em `packages/db`.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@contaia/db', async () => {
  const real = await vi.importActual<typeof import('@contaia/db')>('@contaia/db');
  const { funcoesDoBanco } = await import('./banco-em-memoria.js');

  return { ...real, ...funcoesDoBanco };
});

import { estado, funcoesDoBanco, reiniciar } from './banco-em-memoria';
import { UsuariosService } from './usuarios.service';

const T1 = 'tenant-1';
const T2 = 'tenant-2';
const AGORA = new Date('2026-10-02T12:00:00Z');

const semAnotacoes = (valor: unknown): string => JSON.stringify(valor);

describe('UsuariosService', () => {
  const ordem: string[] = [];
  let identidade: {
    criar: ReturnType<typeof vi.fn>;
    definirSenhaEAtivar: ReturnType<typeof vi.fn>;
    habilitar: ReturnType<typeof vi.fn>;
    encerrarSessoes: ReturnType<typeof vi.fn>;
    atualizarEmail: ReturnType<typeof vi.fn>;
    remover: ReturnType<typeof vi.fn>;
  };
  let mailer: { enviar: ReturnType<typeof vi.fn> };
  let service: UsuariosService;
  let subs = 0;

  const indisponivel = () =>
    new ErroDeDominio(CODIGOS_DE_ERRO.IDENTIDADE_INDISPONIVEL, 'Identidade indisponível.');

  const semear = (
    tenantId: string,
    id: string,
    email: string,
    papeis: string[],
    estadoInicial = 'ATIVO',
  ): void => {
    estado.usuarios.push({
      id,
      tenantId,
      subOidc: `sub-${id}`,
      email,
      nome: `Nome ${id}`,
      telefone: null,
      crc: null,
      estado: estadoInicial,
      papeis,
      versao: 0,
      criadoEm: AGORA,
    });
  };

  const codigoDe = async (executar: () => Promise<unknown>): Promise<string | undefined> => {
    try {
      await executar();
    } catch (erro) {
      return erro instanceof ErroDeDominio ? erro.codigo : `OUTRO:${String(erro)}`;
    }

    return undefined;
  };

  const AUTOR = { usuarioId: 'admin-1' };
  const DADOS = {
    nome: 'Ana Souza',
    email: 'ana@escritorio.com',
    telefone: null,
    crc: null,
    papeis: ['contador'],
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
    reiniciar();
    ordem.length = 0;
    subs = 0;
    process.env['WEB_PUBLIC_URL'] = 'http://web.local';

    identidade = {
      criar: vi.fn(async () => `kc-${++subs}`),
      definirSenhaEAtivar: vi.fn(),
      habilitar: vi.fn(async (_sub: string, ligado: boolean) => {
        ordem.push(`habilitar:${String(ligado)}`);
      }),
      encerrarSessoes: vi.fn(async () => {
        ordem.push('encerrarSessoes');
      }),
      atualizarEmail: vi.fn(),
      remover: vi.fn(),
    };
    mailer = { enviar: vi.fn(async () => undefined) };

    semear(T1, 'admin-1', 'admin1@escritorio.com', ['admin_escritorio']);
    semear(T1, 'admin-2', 'admin2@escritorio.com', ['admin_escritorio']);
    semear(T2, 'outro-1', 'outro@outro.com', ['admin_escritorio']);

    service = new UsuariosService(
      { instancia: {} } as never,
      identidade as never,
      mailer as never,
    );
  });

  afterEach(() => vi.useRealTimers());

  describe('convidar', () => {
    it('cria o usuário CONVIDADO com papéis, convite de 48 h e evento, e envia o link', async () => {
      const usuario = await service.convidar(T1, AUTOR, DADOS);

      const criado = estado.usuarios.find((u) => u.id === usuario.id);
      const convite = estado.convites[0];

      expect(criado).toMatchObject({ estado: 'CONVIDADO', papeis: ['contador'], tenantId: T1 });
      expect(identidade.criar).toHaveBeenCalledWith({ email: 'ana@escritorio.com', nome: 'Ana Souza' });
      expect(convite?.expiraEm.getTime()).toBe(AGORA.getTime() + 48 * 3_600_000);
      expect(estado.eventos.map((e) => e.tipo)).toEqual(['CONVITE_CRIADO']);
      expect(estado.eventos[0]).toMatchObject({ autorId: 'admin-1', usuarioAfetadoId: usuario.id });
      expect(usuario.situacao).toBe('CONVIDADO');
    });

    it('grava só o hash: o token vai no e-mail, nunca no banco, na auditoria ou na resposta', async () => {
      const usuario = await service.convidar(T1, AUTOR, DADOS);

      const enviado = mailer.enviar.mock.calls[0]?.[0] as { link: string; para: string };
      const token = enviado.link.replace('http://web.local/convite/', '');

      expect(enviado.para).toBe('ana@escritorio.com');
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(estado.convites[0]?.tokenHash).not.toBe(token);
      expect(estado.convites[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(semAnotacoes(estado.eventos)).not.toContain(token);
      expect(semAnotacoes(usuario)).not.toContain(token);
      expect(semAnotacoes(usuario)).not.toMatch(/token|link|hash/i);
    });

    it('sem papel: 422 PAPEL_OBRIGATORIO, nada gravado e Keycloak intocado', async () => {
      expect(await codigoDe(() => service.convidar(T1, AUTOR, { ...DADOS, papeis: [] }))).toBe(
        CODIGOS_DE_ERRO.PAPEL_OBRIGATORIO,
      );
      expect(identidade.criar).not.toHaveBeenCalled();
      expect(estado.usuarios.filter((u) => u.email === 'ana@escritorio.com')).toHaveLength(0);
    });

    it('papel fora do catálogo padrão: PAPEL_INVALIDO', async () => {
      expect(
        await codigoDe(() => service.convidar(T1, AUTOR, { ...DADOS, papeis: ['gestor_financeiro'] })),
      ).toBe(CODIGOS_DE_ERRO.PAPEL_INVALIDO);
    });

    it('e-mail repetido, ignorando caixa e espaços: 409 EMAIL_JA_UTILIZADO sem chamar o Keycloak', async () => {
      await service.convidar(T1, AUTOR, DADOS);
      identidade.criar.mockClear();

      expect(
        await codigoDe(() =>
          service.convidar(T1, AUTOR, { ...DADOS, email: '  ANA@Escritorio.COM ', nome: 'Outra Ana' }),
        ),
      ).toBe(CODIGOS_DE_ERRO.EMAIL_JA_UTILIZADO);
      expect(identidade.criar).not.toHaveBeenCalled();
    });

    it('e-mail de outro escritório: 409 sem revelar o tenant (vem da unicidade do banco)', async () => {
      identidade.criar.mockImplementation(async () => `kc-${++subs}`);

      const erro = await service
        .convidar(T1, AUTOR, { ...DADOS, email: 'outro@outro.com' })
        .catch((e: unknown) => e);

      expect(erro).toMatchObject({ code: '23505', constraint: 'usuario_email_unico' });
      // A compensação remove a identidade criada no Keycloak: nada fica órfão.
      expect(identidade.remover).toHaveBeenCalledTimes(1);
    });

    it('e-mail de usuário ARQUIVADO do mesmo escritório: orienta novo convite em vez de duplicar', async () => {
      semear(T1, 'arquivado-1', 'arquivado@escritorio.com', ['auxiliar'], 'ARQUIVADO');

      expect(
        await codigoDe(() => service.convidar(T1, AUTOR, { ...DADOS, email: 'arquivado@escritorio.com' })),
      ).toBe(CODIGOS_DE_ERRO.USUARIO_ARQUIVADO_USE_NOVO_CONVITE);
    });

    it('se nem a marcação de envio falho couber no banco, o convite continua 201 (cadastro já gravado)', async () => {
      const aviso = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      mailer.enviar.mockRejectedValueOnce(new Error('smtp fora'));
      funcoesDoBanco.marcarEnvioFalhou.mockRejectedValueOnce(new Error('banco caiu'));

      const usuario = await service.convidar(T1, AUTOR, DADOS);

      expect(estado.usuarios.some((u) => u.id === usuario.id)).toBe(true);
      expect(aviso).toHaveBeenCalled();
      aviso.mockRestore();
    });

    it('falha de envio não apaga o cadastro: responde 201 com envioFalhou e permite reenviar', async () => {
      mailer.enviar.mockRejectedValueOnce(new Error('smtp fora'));

      const usuario = await service.convidar(T1, AUTOR, DADOS);

      expect(usuario.envioFalhou).toBe(true);
      expect(estado.usuarios.some((u) => u.id === usuario.id)).toBe(true);
      expect(estado.convites[0]?.envioFalhou).toBe(true);
    });

    it('Keycloak fora: nada é gravado e o e-mail não sai', async () => {
      identidade.criar.mockRejectedValueOnce(indisponivel());

      expect(await codigoDe(() => service.convidar(T1, AUTOR, DADOS))).toBe(
        CODIGOS_DE_ERRO.IDENTIDADE_INDISPONIVEL,
      );
      expect(estado.usuarios.find((u) => u.email === 'ana@escritorio.com')).toBeUndefined();
      expect(estado.convites).toHaveLength(0);
      expect(estado.eventos).toHaveLength(0);
      expect(mailer.enviar).not.toHaveBeenCalled();
    });

    it('falha de auditoria desfaz a mutação e remove a identidade criada', async () => {
      estado.falharAoRegistrarEvento = true;

      await expect(service.convidar(T1, AUTOR, DADOS)).rejects.toThrow('falha na auditoria');

      expect(estado.usuarios.find((u) => u.email === 'ana@escritorio.com')).toBeUndefined();
      expect(estado.convites).toHaveLength(0);
      expect(identidade.remover).toHaveBeenCalledWith('kc-1');
    });

    it('se a compensação também falhar, o log diz qual identidade conferir no Keycloak', async () => {
      const erro = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      estado.falharAoRegistrarEvento = true;
      identidade.remover.mockRejectedValueOnce(new Error('keycloak caiu'));

      await expect(service.convidar(T1, AUTOR, DADOS)).rejects.toThrow('falha na auditoria');

      const mensagem = String(erro.mock.calls[0]?.[0]);

      expect(mensagem).toContain('sub kc-1');
      expect(mensagem).toContain('keycloak caiu');
      erro.mockRestore();
    });

    it('e-mail inválido: 422 com o campo, sem tocar no Keycloak', async () => {
      expect(await codigoDe(() => service.convidar(T1, AUTOR, { ...DADOS, email: 'sem-arroba' }))).toBe(
        CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
      );
      expect(identidade.criar).not.toHaveBeenCalled();
    });
  });

  describe('editar', () => {
    const ATIVO = 'ativo-1';

    beforeEach(() => semear(T1, ATIVO, 'ativo@escritorio.com', ['contador']));

    it('troca papéis e dados com evento antes/depois', async () => {
      const usuario = await service.editar(T1, AUTOR, ATIVO, {
        nome: 'Nome Novo',
        telefone: '11987654321',
        crc: 'SP-1',
        papeis: ['auxiliar', 'auditor_readonly'],
      });

      expect(usuario.papeis).toEqual(['auxiliar', 'auditor_readonly']);
      expect(usuario.nome).toBe('Nome Novo');

      const evento = estado.eventos.at(-1);

      expect(evento?.tipo).toBe('DADOS_E_PAPEIS_ALTERADOS');
      expect(evento?.antes).toMatchObject({ papeis: ['contador'], nome: 'Nome ativo-1' });
      expect(evento?.depois).toMatchObject({ papeis: ['auxiliar', 'auditor_readonly'], nome: 'Nome Novo' });
    });

    it('sem nenhuma mudança não grava evento', async () => {
      await service.editar(T1, AUTOR, ATIVO, {
        nome: 'Nome ativo-1',
        telefone: null,
        crc: null,
        papeis: ['contador'],
      });

      expect(estado.eventos).toHaveLength(0);
    });

    it('usuário ativo precisa manter ao menos um papel', async () => {
      expect(
        await codigoDe(() =>
          service.editar(T1, AUTOR, ATIVO, { nome: 'X', telefone: null, crc: null, papeis: [] }),
        ),
      ).toBe(CODIGOS_DE_ERRO.PAPEL_OBRIGATORIO);
      expect(estado.usuarios.find((u) => u.id === ATIVO)?.papeis).toEqual(['contador']);
    });

    it('um dos dois administradores pode perder o papel', async () => {
      await service.editar(T1, AUTOR, 'admin-2', {
        nome: 'Nome admin-2',
        telefone: null,
        crc: null,
        papeis: ['contador'],
      });

      expect(estado.usuarios.find((u) => u.id === 'admin-2')?.papeis).toEqual(['contador']);
    });

    it('o último administrador ativo não perde a administração: 409 e nada alterado', async () => {
      estado.usuarios.find((u) => u.id === 'admin-2')!.estado = 'SUSPENSO';

      expect(
        await codigoDe(() =>
          service.editar(T1, AUTOR, 'admin-1', {
            nome: 'Nome admin-1',
            telefone: null,
            crc: null,
            papeis: ['contador'],
          }),
        ),
      ).toBe(CODIGOS_DE_ERRO.ULTIMO_ADMIN);
      expect(estado.usuarios.find((u) => u.id === 'admin-1')?.papeis).toEqual(['admin_escritorio']);
      expect(estado.eventos).toHaveLength(0);
    });

    it('e-mail de usuário já ativo é imutável nesta fatia', async () => {
      expect(
        await codigoDe(() =>
          service.editar(T1, AUTOR, ATIVO, {
            nome: 'Nome ativo-1',
            telefone: null,
            crc: null,
            papeis: ['contador'],
            email: 'novo@escritorio.com',
          }),
        ),
      ).toBe(CODIGOS_DE_ERRO.EMAIL_IMUTAVEL);
      expect(identidade.atualizarEmail).not.toHaveBeenCalled();
    });

    it('reenviar o mesmo e-mail em usuário ativo não é troca e não falha', async () => {
      await expect(
        service.editar(T1, AUTOR, ATIVO, {
          nome: 'Nome ativo-1',
          telefone: null,
          crc: null,
          papeis: ['contador'],
          email: 'ATIVO@escritorio.com',
        }),
      ).resolves.toBeDefined();
    });

    it('corrigir o e-mail de CONVIDADO troca na identidade, invalida o link anterior e envia outro', async () => {
      const convidado = await service.convidar(T1, AUTOR, DADOS);
      const conviteAnterior = estado.convites[0];
      mailer.enviar.mockClear();

      await service.editar(T1, AUTOR, convidado.id, {
        nome: 'Ana Souza',
        telefone: null,
        crc: null,
        papeis: ['contador'],
        email: 'Ana.Corrigida@Escritorio.com',
      });

      expect(identidade.atualizarEmail).toHaveBeenCalledWith(
        `kc-1`,
        'ana.corrigida@escritorio.com',
      );
      expect(conviteAnterior?.invalidadoEm).not.toBeNull();
      expect(estado.convites.filter((c) => c.invalidadoEm === null)).toHaveLength(1);
      expect((mailer.enviar.mock.calls[0]?.[0] as { para: string }).para).toBe(
        'ana.corrigida@escritorio.com',
      );
      expect(estado.eventos.map((e) => e.tipo)).toContain('EMAIL_DE_CONVITE_CORRIGIDO');
    });

    it('usuário de outro escritório responde como inexistente', async () => {
      expect(
        await codigoDe(() =>
          service.editar(T1, AUTOR, 'outro-1', {
            nome: 'X',
            telefone: null,
            crc: null,
            papeis: ['auxiliar'],
          }),
        ),
      ).toBe(CODIGOS_DE_ERRO.USUARIO_NAO_ENCONTRADO);
    });

    it('usuário arquivado só volta por novo convite', async () => {
      semear(T1, 'arq-1', 'arq@escritorio.com', ['auxiliar'], 'ARQUIVADO');

      expect(
        await codigoDe(() =>
          service.editar(T1, AUTOR, 'arq-1', {
            nome: 'X',
            telefone: null,
            crc: null,
            papeis: ['auxiliar'],
          }),
        ),
      ).toBe(CODIGOS_DE_ERRO.USUARIO_ARQUIVADO_USE_NOVO_CONVITE);
    });
  });

  describe('reenviarConvite', () => {
    it('invalida o link anterior, cria outro e registra o reenvio', async () => {
      const convidado = await service.convidar(T1, AUTOR, DADOS);
      const anterior = estado.convites[0];
      mailer.enviar.mockClear();

      await service.reenviarConvite(T1, AUTOR, convidado.id);

      expect(anterior?.invalidadoEm).not.toBeNull();
      expect(estado.convites.filter((c) => c.invalidadoEm === null && c.usadoEm === null)).toHaveLength(1);
      expect(mailer.enviar).toHaveBeenCalledTimes(1);
      expect(estado.eventos.map((e) => e.tipo)).toEqual(['CONVITE_CRIADO', 'CONVITE_REENVIADO']);
    });

    it('convite expirado pode ser reenviado e o cadastro com os papéis é preservado', async () => {
      const convidado = await service.convidar(T1, AUTOR, DADOS);

      vi.setSystemTime(new Date(AGORA.getTime() + 49 * 3_600_000));

      const reenviado = await service.reenviarConvite(T1, AUTOR, convidado.id);

      expect(reenviado.papeis).toEqual(['contador']);
      expect(reenviado.situacao).toBe('CONVIDADO');
    });

    it('reenviar um convite vencido deixa o evento CONVITE_EXPIRADO antes do reenvio (§3.5)', async () => {
      const convidado = await service.convidar(T1, AUTOR, DADOS);

      vi.setSystemTime(new Date(AGORA.getTime() + 49 * 3_600_000));
      await service.reenviarConvite(T1, AUTOR, convidado.id);

      expect(estado.eventos.map((e) => e.tipo)).toEqual([
        'CONVITE_CRIADO',
        'CONVITE_EXPIRADO',
        'CONVITE_REENVIADO',
      ]);
    });

    it('só CONVIDADO recebe reenvio', async () => {
      expect(await codigoDe(() => service.reenviarConvite(T1, AUTOR, 'admin-2'))).toBe(
        CODIGOS_DE_ERRO.TRANSICAO_DE_USUARIO_INVALIDA,
      );
    });

    it('falha de envio no reenvio marca o convite novo para nova tentativa', async () => {
      const convidado = await service.convidar(T1, AUTOR, DADOS);
      mailer.enviar.mockRejectedValueOnce(new Error('smtp fora'));

      const reenviado = await service.reenviarConvite(T1, AUTOR, convidado.id);

      expect(reenviado.envioFalhou).toBe(true);
    });
  });

  describe('suspender, reativar e arquivar', () => {
    beforeEach(() => semear(T1, 'ativo-1', 'ativo@escritorio.com', ['contador']));

    it('suspender desabilita a identidade e encerra todas as sessões', async () => {
      const usuario = await service.suspender(T1, AUTOR, 'ativo-1');

      expect(usuario.estado).toBe('SUSPENSO');
      expect(ordem).toEqual(['habilitar:false', 'encerrarSessoes']);
      expect(estado.eventos.at(-1)).toMatchObject({
        tipo: 'SUSPENSO',
        antes: { estado: 'ATIVO' },
        depois: { estado: 'SUSPENSO' },
      });
    });

    it('reativar habilita de novo a identidade', async () => {
      await service.suspender(T1, AUTOR, 'ativo-1');
      ordem.length = 0;

      const usuario = await service.reativar(T1, AUTOR, 'ativo-1');

      expect(usuario.estado).toBe('ATIVO');
      expect(ordem).toEqual(['habilitar:true']);
      expect(estado.eventos.at(-1)?.tipo).toBe('REATIVADO');
    });

    it('arquivar ativo ou suspenso encerra sessões e preserva o cadastro', async () => {
      await service.suspender(T1, AUTOR, 'ativo-1');
      ordem.length = 0;

      const usuario = await service.arquivar(T1, AUTOR, 'ativo-1');

      expect(usuario.estado).toBe('ARQUIVADO');
      expect(ordem).toEqual(['habilitar:false', 'encerrarSessoes']);
      expect(estado.usuarios.some((u) => u.id === 'ativo-1')).toBe(true);
      expect(estado.eventos.at(-1)?.tipo).toBe('ARQUIVADO');
    });

    it('o último administrador não se suspende nem se arquiva: 409 sem tocar no Keycloak', async () => {
      estado.usuarios.find((u) => u.id === 'admin-2')!.estado = 'SUSPENSO';

      expect(await codigoDe(() => service.suspender(T1, { usuarioId: 'admin-1' }, 'admin-1'))).toBe(
        CODIGOS_DE_ERRO.ULTIMO_ADMIN,
      );
      expect(await codigoDe(() => service.arquivar(T1, { usuarioId: 'admin-1' }, 'admin-1'))).toBe(
        CODIGOS_DE_ERRO.ULTIMO_ADMIN,
      );
      expect(identidade.habilitar).not.toHaveBeenCalled();
      expect(identidade.encerrarSessoes).not.toHaveBeenCalled();
      expect(estado.usuarios.find((u) => u.id === 'admin-1')?.estado).toBe('ATIVO');
    });

    it('com dois administradores, um pode se suspender', async () => {
      const usuario = await service.suspender(T1, { usuarioId: 'admin-1' }, 'admin-1');

      expect(usuario.estado).toBe('SUSPENSO');
    });

    it('Keycloak fora ao suspender: estado e auditoria permanecem como antes', async () => {
      identidade.habilitar.mockRejectedValueOnce(indisponivel());

      expect(await codigoDe(() => service.suspender(T1, AUTOR, 'ativo-1'))).toBe(
        CODIGOS_DE_ERRO.IDENTIDADE_INDISPONIVEL,
      );
      expect(estado.usuarios.find((u) => u.id === 'ativo-1')?.estado).toBe('ATIVO');
      expect(estado.eventos).toHaveLength(0);
    });

    it('se o Keycloak esgota o tempo depois de aplicar, a compensação já estava registrada e reabilita', async () => {
      identidade.habilitar.mockImplementationOnce(async (_sub: string, ligado: boolean) => {
        ordem.push(`habilitar:${String(ligado)}`);
        throw indisponivel();
      });

      await codigoDe(() => service.suspender(T1, AUTOR, 'ativo-1'));

      expect(ordem).toEqual(['habilitar:false', 'habilitar:true']);
    });

    it('falha ao encerrar sessões também desfaz: não fica suspenso com sessão viva', async () => {
      identidade.encerrarSessoes.mockRejectedValueOnce(indisponivel());

      await codigoDe(() => service.suspender(T1, AUTOR, 'ativo-1'));

      expect(estado.usuarios.find((u) => u.id === 'ativo-1')?.estado).toBe('ATIVO');
      // A conta foi desabilitada antes de a revogação falhar: a compensação a reabilita.
      expect(identidade.habilitar).toHaveBeenLastCalledWith('sub-ativo-1', true);
    });

    it('falha de auditoria desfaz a suspensão e reabilita a identidade', async () => {
      estado.falharAoRegistrarEvento = true;

      await expect(service.suspender(T1, AUTOR, 'ativo-1')).rejects.toThrow('falha na auditoria');

      expect(estado.usuarios.find((u) => u.id === 'ativo-1')?.estado).toBe('ATIVO');
      expect(identidade.habilitar).toHaveBeenLastCalledWith('sub-ativo-1', true);
    });

    it('transições fora do ciclo são recusadas', async () => {
      expect(await codigoDe(() => service.reativar(T1, AUTOR, 'ativo-1'))).toBe(
        CODIGOS_DE_ERRO.TRANSICAO_DE_USUARIO_INVALIDA,
      );
      semear(T1, 'convidado-1', 'conv@escritorio.com', ['auxiliar'], 'CONVIDADO');
      expect(await codigoDe(() => service.suspender(T1, AUTOR, 'convidado-1'))).toBe(
        CODIGOS_DE_ERRO.TRANSICAO_DE_USUARIO_INVALIDA,
      );
    });

    it('usuário de outro escritório responde como inexistente', async () => {
      expect(await codigoDe(() => service.suspender(T1, AUTOR, 'outro-1'))).toBe(
        CODIGOS_DE_ERRO.USUARIO_NAO_ENCONTRADO,
      );
    });
  });

  describe('novoConvite (retorno de usuário arquivado)', () => {
    beforeEach(() => semear(T1, 'arq-1', 'arq@escritorio.com', ['auxiliar'], 'ARQUIVADO'));

    it('exige dados e papéis revisados e volta a CONVIDADO com novo convite', async () => {
      const usuario = await service.novoConvite(T1, AUTOR, 'arq-1', {
        nome: 'Arquivado Revisado',
        telefone: null,
        crc: null,
        papeis: ['contador'],
      });

      expect(usuario.estado).toBe('CONVIDADO');
      expect(usuario.papeis).toEqual(['contador']);
      expect(usuario.nome).toBe('Arquivado Revisado');
      expect(estado.convites.filter((c) => c.invalidadoEm === null && c.usadoEm === null)).toHaveLength(1);
      expect(mailer.enviar).toHaveBeenCalledTimes(1);
      expect(estado.eventos.at(-1)?.tipo).toBe('NOVO_CONVITE_INICIADO');
    });

    it('sem papel revisado não há novo convite', async () => {
      expect(
        await codigoDe(() =>
          service.novoConvite(T1, AUTOR, 'arq-1', {
            nome: 'X',
            telefone: null,
            crc: null,
            papeis: [],
          }),
        ),
      ).toBe(CODIGOS_DE_ERRO.PAPEL_OBRIGATORIO);
      expect(estado.usuarios.find((u) => u.id === 'arq-1')?.estado).toBe('ARQUIVADO');
    });

    it('só ARQUIVADO recebe novo convite', async () => {
      expect(
        await codigoDe(() =>
          service.novoConvite(T1, AUTOR, 'admin-2', {
            nome: 'X',
            telefone: null,
            crc: null,
            papeis: ['auxiliar'],
          }),
        ),
      ).toBe(CODIGOS_DE_ERRO.TRANSICAO_DE_USUARIO_INVALIDA);
    });
  });

  describe('listar e obter', () => {
    it('lista só o próprio escritório e apresenta CONVITE_EXPIRADO quando o prazo passa', async () => {
      const convidado = await service.convidar(T1, AUTOR, DADOS);

      vi.setSystemTime(new Date(AGORA.getTime() + 48 * 3_600_000));

      const pagina = await service.listar(T1, { limite: 25, deslocamento: 0 });
      const ana = pagina.usuarios.find((u) => u.id === convidado.id);

      expect(ana?.situacao).toBe('CONVITE_EXPIRADO');
      expect(pagina.usuarios.every((u) => u.id !== 'outro-1')).toBe(true);
      expect(pagina.total).toBe(3);
    });

    it('registra o evento CONVITE_EXPIRADO uma única vez, mesmo listando várias vezes', async () => {
      await service.convidar(T1, AUTOR, DADOS);

      vi.setSystemTime(new Date(AGORA.getTime() + 49 * 3_600_000));

      await service.listar(T1, { limite: 25, deslocamento: 0 });
      await service.listar(T1, { limite: 25, deslocamento: 0 });

      expect(estado.eventos.filter((e) => e.tipo === 'CONVITE_EXPIRADO')).toHaveLength(1);
    });

    it('obter usuário de outro escritório responde como inexistente', async () => {
      expect(await codigoDe(() => service.obter(T1, 'outro-1'))).toBe(
        CODIGOS_DE_ERRO.USUARIO_NAO_ENCONTRADO,
      );
    });

    it('a resposta nunca carrega token, link, hash ou sub da identidade', async () => {
      await service.convidar(T1, AUTOR, DADOS);

      const pagina = await service.listar(T1, { limite: 25, deslocamento: 0 });

      expect(semAnotacoes(pagina)).not.toMatch(/token|link|hash|subOidc|sub-/i);
    });
  });

  describe('consultarHistorico (aba "Usuários e acessos")', () => {
    const FILTRO = { limite: 25, deslocamento: 0 };

    beforeEach(() => semear(T1, 'ativo-1', 'ativo@escritorio.com', ['contador']));

    it('devolve os eventos do escritório, do mais recente ao mais antigo, com autor e afetado nomeados', async () => {
      await service.suspender(T1, AUTOR, 'ativo-1');
      await service.reativar(T1, AUTOR, 'ativo-1');

      const pagina = await service.consultarHistorico(T1, FILTRO);

      expect(pagina.total).toBe(2);
      expect(pagina.eventos.map((e) => e.tipo)).toEqual(['REATIVADO', 'SUSPENSO']);
      expect(pagina.eventos[0]).toMatchObject({
        usuarioAfetadoId: 'ativo-1',
        usuarioAfetadoNome: 'Nome ativo-1',
        autorId: 'admin-1',
        autorNome: 'Nome admin-1',
        antes: { estado: 'SUSPENSO' },
        depois: { estado: 'ATIVO' },
      });
      expect(typeof pagina.eventos[0]?.ocorridoEm).toBe('string');
    });

    it('eventos puramente técnicos do convite (reenvio, expiração) não expõem seus valores; o de criação mostra papéis', async () => {
      const convidado = await service.convidar(T1, AUTOR, DADOS);

      await service.reenviarConvite(T1, AUTOR, convidado.id);

      const pagina = await service.consultarHistorico(T1, FILTRO);
      const criado = pagina.eventos.find((e) => e.tipo === 'CONVITE_CRIADO');
      const reenviado = pagina.eventos.find((e) => e.tipo === 'CONVITE_REENVIADO');

      expect(criado?.depois).toMatchObject({ papeis: ['contador'], estado: 'CONVIDADO' });
      expect(reenviado).toBeDefined();
      expect(reenviado?.antes).toBeNull();
      expect(reenviado?.depois).toBeNull();
      expect(semAnotacoes(pagina)).not.toMatch(/token|link|hash|conviteId/i);
    });

    it('registra a expiração do convite uma única vez e mostra o autor como sistema', async () => {
      await service.convidar(T1, AUTOR, DADOS);

      vi.setSystemTime(new Date(AGORA.getTime() + 49 * 3_600_000));

      await service.consultarHistorico(T1, FILTRO);
      const pagina = await service.consultarHistorico(T1, FILTRO);
      const expirados = pagina.eventos.filter((e) => e.tipo === 'CONVITE_EXPIRADO');

      expect(expirados).toHaveLength(1);
      expect(expirados[0]?.autorId).toBeNull();
      expect(expirados[0]?.autorNome).toBeNull();
    });

    it('repassa os filtros e nunca mostra evento de outro escritório', async () => {
      await service.suspender(T1, AUTOR, 'ativo-1');
      estado.eventos.push({
        tenantId: T2,
        tipo: 'SUSPENSO',
        usuarioAfetadoId: 'outro-1',
        autorId: null,
        antes: null,
        depois: null,
      });

      const doAfetado = await service.consultarHistorico(T1, {
        ...FILTRO,
        usuarioAfetadoId: 'ativo-1',
      });
      const outroTenant = await service.consultarHistorico(T1, {
        ...FILTRO,
        usuarioAfetadoId: 'outro-1',
      });

      expect(doAfetado.eventos).toHaveLength(1);
      expect(outroTenant.eventos).toHaveLength(0);
    });
  });

  describe('papéis personalizados (SPEC-008 §3.4)', () => {
    const semearPapel = (
      id: string,
      nome: string,
      opcoes: { estado?: string; tenantId?: string } = {},
    ): void => {
      estado.papeis.push({
        id,
        tenantId: opcoes.tenantId ?? T1,
        nome,
        descricao: null,
        papelBase: 'auxiliar',
        estado: opcoes.estado ?? 'ATIVO',
        revisao: 1,
        permissoes: ['empresas.cadastro.consultar'],
        criadoEm: AGORA,
        atualizadoEm: AGORA,
      });
    };

    beforeEach(() => {
      semearPapel('papel-1', 'Revisor');
      semearPapel('papel-2', 'Conferente');
    });

    it('convida com papel padrão e personalizado juntos e audita os dois', async () => {
      const usuario = await service.convidar(T1, AUTOR, {
        ...DADOS,
        papeisPersonalizados: ['papel-1'],
      });

      expect(usuario.papeis).toEqual(['contador']);
      expect(usuario.papeisPersonalizados).toEqual([
        { id: 'papel-1', nome: 'Revisor', estado: 'ATIVO' },
      ]);
      expect(estado.eventos[0]).toMatchObject({
        tipo: 'CONVITE_CRIADO',
        depois: { papeis: ['contador'], papeisPersonalizados: [{ id: 'papel-1', nome: 'Revisor' }] },
      });
    });

    it('aceita usuário só com papel personalizado, mas não sem nenhum papel', async () => {
      const usuario = await service.convidar(T1, AUTOR, {
        ...DADOS,
        papeis: [],
        papeisPersonalizados: ['papel-1'],
      });

      expect(usuario.papeis).toEqual([]);
      expect(usuario.papeisPersonalizados).toHaveLength(1);

      expect(
        await codigoDe(() =>
          service.convidar(T1, AUTOR, {
            ...DADOS,
            email: 'outra@escritorio.com',
            papeis: [],
            papeisPersonalizados: [],
          }),
        ),
      ).toBe(CODIGOS_DE_ERRO.PAPEL_OBRIGATORIO);
    });

    it('papel inexistente ou de outro escritório responde como inexistente e desfaz o convite', async () => {
      semearPapel('papel-alheio', 'Alheio', { tenantId: T2 });

      for (const id of ['papel-que-nao-existe', 'papel-alheio']) {
        expect(
          await codigoDe(() => service.convidar(T1, AUTOR, { ...DADOS, papeisPersonalizados: [id] })),
        ).toBe(CODIGOS_DE_ERRO.PAPEL_NAO_ENCONTRADO);
      }

      expect(estado.usuarios.some((u) => u.email === 'ana@escritorio.com')).toBe(false);
      expect(estado.vinculos).toHaveLength(0);
      expect(identidade.remover).toHaveBeenCalled();
    });

    it('papel arquivado não pode ser atribuído', async () => {
      semearPapel('papel-arquivado', 'Antigo', { estado: 'ARQUIVADO' });

      expect(
        await codigoDe(() =>
          service.convidar(T1, AUTOR, { ...DADOS, papeisPersonalizados: ['papel-arquivado'] }),
        ),
      ).toBe(CODIGOS_DE_ERRO.PAPEL_ARQUIVADO);
      expect(estado.vinculos).toHaveLength(0);
    });

    it('editar troca os vínculos e registra o antes/depois com nomes', async () => {
      const usuario = await service.convidar(T1, AUTOR, {
        ...DADOS,
        papeisPersonalizados: ['papel-1'],
      });

      await service.editar(T1, AUTOR, usuario.id, {
        nome: DADOS.nome,
        telefone: null,
        crc: null,
        papeis: ['contador'],
        papeisPersonalizados: ['papel-2'],
      });

      const evento = estado.eventos.find((e) => e.tipo === 'DADOS_E_PAPEIS_ALTERADOS');

      expect(evento).toMatchObject({
        antes: { papeisPersonalizados: [{ id: 'papel-1', nome: 'Revisor' }] },
        depois: { papeisPersonalizados: [{ id: 'papel-2', nome: 'Conferente' }] },
      });
      expect(estado.vinculos.filter((v) => !v.removido).map((v) => v.papelId)).toEqual(['papel-2']);
      // O vínculo antigo não é apagado: fica marcado como removido.
      expect(estado.vinculos.find((v) => v.papelId === 'papel-1')?.removido).toBe(true);
    });

    it('editar sem mexer nos papéis não grava evento nem recria vínculo', async () => {
      const usuario = await service.convidar(T1, AUTOR, {
        ...DADOS,
        papeisPersonalizados: ['papel-1'],
      });
      const eventosAntes = estado.eventos.length;

      await service.editar(T1, AUTOR, usuario.id, {
        nome: DADOS.nome,
        telefone: null,
        crc: null,
        papeis: ['contador'],
        papeisPersonalizados: ['papel-1'],
      });

      expect(estado.eventos).toHaveLength(eventosAntes);
      expect(estado.vinculos).toHaveLength(1);
    });

    it('retirar o administrador padrão ainda respeita o último administrador, mesmo com papel personalizado', async () => {
      estado.usuarios.splice(
        estado.usuarios.findIndex((u) => u.id === 'admin-2'),
        1,
      );

      expect(
        await codigoDe(() =>
          service.editar(T1, AUTOR, 'admin-1', {
            nome: 'Nome admin-1',
            telefone: null,
            crc: null,
            papeis: [],
            papeisPersonalizados: ['papel-1'],
          }),
        ),
      ).toBe(CODIGOS_DE_ERRO.ULTIMO_ADMIN);
    });

    it('novo convite de usuário arquivado exige papéis revisados e não reaproveita vínculo antigo', async () => {
      const usuario = await service.convidar(T1, AUTOR, {
        ...DADOS,
        papeisPersonalizados: ['papel-1'],
      });

      const criado = estado.usuarios.find((u) => u.id === usuario.id);

      if (criado !== undefined) criado.estado = 'ATIVO';

      await service.arquivar(T1, AUTOR, usuario.id);
      await service.novoConvite(T1, AUTOR, usuario.id, {
        nome: DADOS.nome,
        telefone: null,
        crc: null,
        papeis: ['contador'],
        papeisPersonalizados: ['papel-2'],
      });

      expect(estado.vinculos.filter((v) => !v.removido).map((v) => v.papelId)).toEqual(['papel-2']);
      expect(estado.eventos.at(-1)).toMatchObject({
        tipo: 'NOVO_CONVITE_INICIADO',
        antes: { papeisPersonalizados: [{ id: 'papel-1', nome: 'Revisor' }] },
        depois: { papeisPersonalizados: [{ id: 'papel-2', nome: 'Conferente' }] },
      });
    });

    it('se a auditoria falha, nenhum vínculo permanece', async () => {
      estado.falharAoRegistrarEvento = true;

      await expect(
        service.convidar(T1, AUTOR, { ...DADOS, papeisPersonalizados: ['papel-1'] }),
      ).rejects.toThrow('falha na auditoria');

      expect(estado.vinculos).toHaveLength(0);
    });
  });
});
