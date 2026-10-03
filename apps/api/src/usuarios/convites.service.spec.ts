/**
 * Aceite público do convite (SPEC-007 §3.2, categoria Regras). Mesmo dublê em
 * memória transacional do `usuarios.service.spec.ts`: o aceite que falha no
 * meio desfaz tudo, inclusive o consumo do convite.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@contaia/db', async () => {
  const real = await vi.importActual<typeof import('@contaia/db')>('@contaia/db');
  const { funcoesDoBanco } = await import('./banco-em-memoria.js');

  return { ...real, ...funcoesDoBanco };
});

import { estado, reiniciar } from './banco-em-memoria';
import { ConvitesService, mascararEmail } from './convites.service';
import { gerarTokenDeConvite, hashDoToken } from './token-de-convite';

const T1 = 'tenant-1';
const AGORA = new Date('2026-10-02T12:00:00Z');
const HORA = 3_600_000;
const SENHA = 'senha-bem-longa-123';

describe('mascararEmail', () => {
  it('mostra a primeira letra e o domínio', () => {
    expect(mascararEmail('ana.souza@escritorio.com')).toBe('a***@escritorio.com');
  });

  it('não quebra com formatos estranhos', () => {
    expect(mascararEmail('x@y.com')).toBe('x***@y.com');
    expect(mascararEmail('sem-arroba')).toBe('***');
    expect(mascararEmail('')).toBe('***');
  });
});

describe('ConvitesService', () => {
  let identidade: {
    definirSenhaEAtivar: ReturnType<typeof vi.fn>;
    habilitar: ReturnType<typeof vi.fn>;
  };
  let service: ConvitesService;

  const semear = (opcoes: {
    id?: string;
    estadoDoUsuario?: string;
    expiraEm?: Date;
    token: string;
    invalidado?: boolean;
    usado?: boolean;
  }): string => {
    const id = opcoes.id ?? 'convidado-1';

    if (!estado.usuarios.some((u) => u.id === id)) {
      estado.usuarios.push({
        id,
        tenantId: T1,
        subOidc: `sub-${id}`,
        email: 'ana.souza@escritorio.com',
        nome: 'Ana Souza',
        telefone: null,
        crc: null,
        estado: opcoes.estadoDoUsuario ?? 'CONVIDADO',
        papeis: ['contador'],
        versao: 0,
        criadoEm: AGORA,
      });
    }

    estado.convites.push({
      id: `convite-${estado.convites.length + 1}`,
      tenantId: T1,
      usuarioId: id,
      tokenHash: hashDoToken(opcoes.token),
      expiraEm: opcoes.expiraEm ?? new Date(AGORA.getTime() + 48 * HORA),
      usadoEm: opcoes.usado === true ? AGORA : null,
      invalidadoEm: opcoes.invalidado === true ? AGORA : null,
      envioFalhou: false,
    });

    return id;
  };

  const codigoDe = async (executar: () => Promise<unknown>): Promise<string | undefined> => {
    try {
      await executar();
    } catch (erro) {
      return erro instanceof ErroDeDominio ? erro.codigo : `OUTRO:${String(erro)}`;
    }

    return undefined;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
    // Zera só o histórico de chamadas dos mocks compartilhados; as implementações ficam.
    vi.clearAllMocks();
    reiniciar();
    identidade = {
      definirSenhaEAtivar: vi.fn(async () => undefined),
      habilitar: vi.fn(async () => undefined),
    };
    service = new ConvitesService({ instancia: {} } as never, identidade as never);
  });

  afterEach(() => vi.useRealTimers());

  describe('consultar', () => {
    it('devolve nome, e-mail mascarado e validade para o link vigente', async () => {
      const token = gerarTokenDeConvite();

      semear({ token });

      expect(await service.consultar(token)).toEqual({
        nome: 'Ana Souza',
        emailMascarado: 'a***@escritorio.com',
        expiraEm: new Date(AGORA.getTime() + 48 * HORA).toISOString(),
      });
    });

    it('token malformado, vazio ou gigante é CONVITE_INVALIDO sem consultar o banco', async () => {
      const { resolverConvite } = await import('@contaia/db');

      for (const ruim of ['', 'a', 'x'.repeat(10_000), `${'a'.repeat(42)}%00`, '../../etc/passwd']) {
        expect(await codigoDe(() => service.consultar(ruim))).toBe(CODIGOS_DE_ERRO.CONVITE_INVALIDO);
        expect(await codigoDe(() => service.aceitar(ruim, SENHA))).toBe(
          CODIGOS_DE_ERRO.CONVITE_INVALIDO,
        );
      }

      expect(resolverConvite).not.toHaveBeenCalled();
    });

    it('token inexistente, usado ou invalidado: o mesmo CONVITE_INVALIDO, sem dizer o motivo', async () => {
      const usado = gerarTokenDeConvite();
      const invalidado = gerarTokenDeConvite();

      semear({ token: usado, usado: true });
      semear({ token: invalidado, invalidado: true, id: 'convidado-2' });

      for (const token of [gerarTokenDeConvite(), usado, invalidado]) {
        expect(await codigoDe(() => service.consultar(token))).toBe(CODIGOS_DE_ERRO.CONVITE_INVALIDO);
      }
    });

    it('convite de usuário que não está CONVIDADO é inválido', async () => {
      const token = gerarTokenDeConvite();

      semear({ token, estadoDoUsuario: 'ARQUIVADO' });

      expect(await codigoDe(() => service.consultar(token))).toBe(CODIGOS_DE_ERRO.CONVITE_INVALIDO);
    });

    it('expirado é inválido e registra uma única vez o evento CONVITE_EXPIRADO', async () => {
      const token = gerarTokenDeConvite();

      semear({ token, expiraEm: new Date(AGORA.getTime() - 1000) });

      for (let i = 0; i < 3; i += 1) {
        expect(await codigoDe(() => service.consultar(token))).toBe(
          CODIGOS_DE_ERRO.CONVITE_INVALIDO,
        );
      }

      expect(estado.eventos.filter((e) => e.tipo === 'CONVITE_EXPIRADO')).toHaveLength(1);
    });
  });

  describe('aceitar', () => {
    it('define a senha, ativa o usuário, consome o convite e audita com o próprio usuário como autor', async () => {
      const token = gerarTokenDeConvite();

      semear({ token });

      await service.aceitar(token, SENHA);

      expect(identidade.definirSenhaEAtivar).toHaveBeenCalledWith('sub-convidado-1', SENHA);
      expect(estado.usuarios[0]?.estado).toBe('ATIVO');
      expect(estado.convites[0]?.usadoEm).not.toBeNull();
      expect(estado.eventos.at(-1)).toMatchObject({
        tipo: 'CONVITE_ACEITO',
        usuarioAfetadoId: 'convidado-1',
        autorId: 'convidado-1',
        antes: { estado: 'CONVIDADO' },
        depois: { estado: 'ATIVO' },
      });
    });

    it('uso único: a segunda tentativa com o mesmo link é recusada e nada muda', async () => {
      const token = gerarTokenDeConvite();

      semear({ token });
      await service.aceitar(token, SENHA);

      expect(await codigoDe(() => service.aceitar(token, 'outra-senha-longa-1'))).toBe(
        CODIGOS_DE_ERRO.CONVITE_INVALIDO,
      );
      expect(identidade.definirSenhaEAtivar).toHaveBeenCalledTimes(1);
    });

    it('link anterior depois de reenvio ou correção de e-mail é recusado sem alterar o usuário', async () => {
      const antigo = gerarTokenDeConvite();
      const atual = gerarTokenDeConvite();

      semear({ token: antigo, invalidado: true });
      semear({ token: atual });

      expect(await codigoDe(() => service.aceitar(antigo, SENHA))).toBe(
        CODIGOS_DE_ERRO.CONVITE_INVALIDO,
      );
      expect(estado.usuarios[0]?.estado).toBe('CONVIDADO');
      expect(identidade.definirSenhaEAtivar).not.toHaveBeenCalled();

      await service.aceitar(atual, SENHA);

      expect(estado.usuarios[0]?.estado).toBe('ATIVO');
    });

    it('vale até o último milissegundo das 48 horas e não vale a partir do prazo', async () => {
      const dentro = gerarTokenDeConvite();
      const noLimite = gerarTokenDeConvite();

      semear({ token: dentro, expiraEm: new Date(AGORA.getTime() + 1) });
      semear({ token: noLimite, expiraEm: AGORA, id: 'convidado-2' });

      await expect(service.aceitar(dentro, SENHA)).resolves.toBeUndefined();
      expect(await codigoDe(() => service.aceitar(noLimite, SENHA))).toBe(
        CODIGOS_DE_ERRO.CONVITE_INVALIDO,
      );
    });

    it('senha fraca: 422 SENHA_FRACA e o convite NÃO é consumido, para tentar de novo', async () => {
      const token = gerarTokenDeConvite();

      semear({ token });
      identidade.definirSenhaEAtivar.mockRejectedValueOnce(
        new ErroDeDominio(CODIGOS_DE_ERRO.SENHA_FRACA, 'Senha fraca.'),
      );

      expect(await codigoDe(() => service.aceitar(token, 'curta'))).toBe(CODIGOS_DE_ERRO.SENHA_FRACA);
      expect(estado.convites[0]?.usadoEm).toBeNull();
      expect(estado.usuarios[0]?.estado).toBe('CONVIDADO');

      await expect(service.aceitar(token, SENHA)).resolves.toBeUndefined();
    });

    it('Keycloak fora: nada muda e o convite continua utilizável', async () => {
      const token = gerarTokenDeConvite();

      semear({ token });
      identidade.definirSenhaEAtivar.mockRejectedValueOnce(
        new ErroDeDominio(CODIGOS_DE_ERRO.IDENTIDADE_INDISPONIVEL, 'fora'),
      );

      expect(await codigoDe(() => service.aceitar(token, SENHA))).toBe(
        CODIGOS_DE_ERRO.IDENTIDADE_INDISPONIVEL,
      );
      expect(estado.convites[0]?.usadoEm).toBeNull();
      expect(estado.usuarios[0]?.estado).toBe('CONVIDADO');
      expect(estado.eventos).toHaveLength(0);
    });

    it('falha de auditoria desfaz o aceite e desabilita a conta que acabou de ser habilitada', async () => {
      const token = gerarTokenDeConvite();

      semear({ token });
      estado.falharAoRegistrarEvento = true;

      await expect(service.aceitar(token, SENHA)).rejects.toThrow('falha na auditoria');

      expect(estado.convites[0]?.usadoEm).toBeNull();
      expect(estado.usuarios[0]?.estado).toBe('CONVIDADO');
      expect(identidade.habilitar).toHaveBeenCalledWith('sub-convidado-1', false);
    });

    it('expirado: recusa, registra a expiração e não toca na identidade', async () => {
      const token = gerarTokenDeConvite();

      semear({ token, expiraEm: new Date(AGORA.getTime() - 1) });

      expect(await codigoDe(() => service.aceitar(token, SENHA))).toBe(
        CODIGOS_DE_ERRO.CONVITE_INVALIDO,
      );
      expect(identidade.definirSenhaEAtivar).not.toHaveBeenCalled();
      expect(estado.eventos.map((e) => e.tipo)).toEqual(['CONVITE_EXPIRADO']);
    });
  });
});
