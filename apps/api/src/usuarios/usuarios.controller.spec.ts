import { describe, expect, it, vi } from 'vitest';

import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  permissoesDosPapeisPadrao,
  type ChaveDePermissao,
  type PapelPadrao,
} from '@contaia/domain';

import type { RequisicaoAutenticada } from '../auth/sessao.guard';
import { UsuariosController } from './usuarios.controller';
import type { VisaoDeUsuario } from './usuarios.service';

const ID = '01927b5c-8e1a-7c3d-9a1b-0123456789ab';

const requisicao = (
  papeis: readonly PapelPadrao[],
  permissoesExtras: readonly ChaveDePermissao[] = [],
): RequisicaoAutenticada =>
  ({
    sessao: {
      papeis,
      permissoes: [...permissoesDosPapeisPadrao(papeis), ...permissoesExtras],
      tenantId: 'tenant-1',
      usuarioId: 'autor-1',
      sub: 'sub-x',
      email: 'a@x.com',
    },
  }) as unknown as RequisicaoAutenticada;

const ADMIN = requisicao(['admin_escritorio']);
const AUDITOR = requisicao(['auditor_readonly']);

const VISAO: VisaoDeUsuario = {
  id: ID,
  nome: 'Ana',
  email: 'ana@x.com',
  telefone: null,
  crc: null,
  papeis: ['contador'],
  papeisPersonalizados: [],
  estado: 'CONVIDADO',
  situacao: 'CONVIDADO',
  conviteExpiraEm: '2026-10-04T12:00:00.000Z',
  envioFalhou: true,
  versao: 0,
};

const servicoDeTeste = () => ({
  listar: vi.fn(async () => ({ usuarios: [VISAO], total: 1 })),
  obter: vi.fn(async () => VISAO),
  convidar: vi.fn(async () => VISAO),
  editar: vi.fn(async () => VISAO),
  reenviarConvite: vi.fn(async () => VISAO),
  suspender: vi.fn(async () => VISAO),
  reativar: vi.fn(async () => VISAO),
  arquivar: vi.fn(async () => VISAO),
  novoConvite: vi.fn(async () => VISAO),
});

/** `possuiCarteira` é o único ponto em que o controller de usuários toca a carteira. */
const carteiraDeTeste = (possui = false) => ({ possuiCarteira: vi.fn(async () => possui) });

const codigoDe = async (executar: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await executar();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : 'OUTRO';
  }

  return undefined;
};

describe('UsuariosController', () => {
  describe('leitura', () => {
    it('GET /usuarios/eu devolve papéis, permissão efetiva e escopo da própria sessão', async () => {
      const controller = new UsuariosController(servicoDeTeste() as never, carteiraDeTeste() as never);

      const eu = await controller.eu(requisicao(['contador', 'auxiliar']));

      expect(eu.papeis).toEqual(['contador', 'auxiliar']);
      expect(eu.permissoes).toContain('empresas.cadastro.arquivar');
      expect(eu.permissoes).not.toContain('usuarios.usuarios_e_papeis.consultar');
      // Carteira vazia: o escopo não depende do papel — vale para o administrador também.
      expect(eu.escopoDeEmpresas).toBe('NENHUMA');
      expect((await controller.eu(ADMIN)).escopoDeEmpresas).toBe('NENHUMA');
    });

    it('com empresas na carteira, o escopo é CARTEIRA para qualquer papel', async () => {
      const controller = new UsuariosController(
        servicoDeTeste() as never,
        carteiraDeTeste(true) as never,
      );

      expect((await controller.eu(requisicao(['auxiliar']))).escopoDeEmpresas).toBe('CARTEIRA');
      expect((await controller.eu(ADMIN)).escopoDeEmpresas).toBe('CARTEIRA');
    });

    it('a permissão efetiva inclui o que veio de papel personalizado', async () => {
      const controller = new UsuariosController(servicoDeTeste() as never, carteiraDeTeste() as never);

      const eu = await controller.eu(requisicao(['auxiliar'], ['historico.global.consultar']));

      expect(eu.permissoes).toContain('historico.global.consultar');
      expect(eu.escopoDeEmpresas).toBe('NENHUMA');
    });

    it('administrador vê o estado técnico do convite; auditor não', async () => {
      const controller = new UsuariosController(servicoDeTeste() as never, carteiraDeTeste() as never);

      const visaoDoAdmin = await controller.obter(ADMIN, ID);
      const visaoDoAuditor = await controller.obter(AUDITOR, ID);

      expect(visaoDoAdmin.conviteExpiraEm).toBe('2026-10-04T12:00:00.000Z');
      expect(visaoDoAdmin.envioFalhou).toBe(true);
      expect(visaoDoAuditor.conviteExpiraEm).toBeNull();
      expect(visaoDoAuditor.envioFalhou).toBe(false);
      expect(visaoDoAuditor.situacao).toBe('CONVIDADO');
    });

    it('a listagem aplica a mesma ocultação ao auditor e repassa o filtro validado', async () => {
      const servico = servicoDeTeste();
      const controller = new UsuariosController(servico as never, carteiraDeTeste() as never);

      const pagina = await controller.listar(AUDITOR, { busca: 'ana', estado: 'ATIVO' });

      expect(pagina.total).toBe(1);
      expect(pagina.usuarios[0]?.conviteExpiraEm).toBeNull();
      expect(servico.listar).toHaveBeenCalledWith('tenant-1', { usuarioId: 'autor-1' }, {
        busca: 'ana',
        estado: 'ATIVO',
        limite: 25,
        deslocamento: 0,
      });
    });

    it('filtro inválido é 422 e o serviço não é chamado', async () => {
      const servico = servicoDeTeste();

      expect(
        await codigoDe(() => new UsuariosController(servico as never, carteiraDeTeste() as never).listar(ADMIN, { estado: 'X' })),
      ).toBe(CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO);
      expect(servico.listar).not.toHaveBeenCalled();
    });
  });

  describe('mutações', () => {
    it('convidar usa tenant e autor da sessão, nunca do corpo', async () => {
      const servico = servicoDeTeste();

      await new UsuariosController(servico as never, carteiraDeTeste() as never).convidar(ADMIN, {
        nome: 'Ana',
        email: 'ana@x.com',
        papeis: ['contador'],
        tenantId: 'tenant-malicioso',
        usuarioId: 'autor-malicioso',
      });

      expect(servico.convidar).toHaveBeenCalledWith(
        'tenant-1',
        { usuarioId: 'autor-1' },
        {
          nome: 'Ana',
          email: 'ana@x.com',
          telefone: null,
          crc: null,
          papeis: ['contador'],
          papeisPersonalizados: [],
        },
      );
    });

    it.each([
      ['suspender', 'suspender'],
      ['reativar', 'reativar'],
      ['arquivar', 'arquivar'],
      ['reenviarConvite', 'reenviarConvite'],
    ] as const)('%s delega ao caso de uso com o autor da sessão', async (metodo, chamada) => {
      const servico = servicoDeTeste();
      const controller = new UsuariosController(servico as never, carteiraDeTeste() as never);

      await controller[metodo](ADMIN, ID);

      expect(servico[chamada]).toHaveBeenCalledWith('tenant-1', { usuarioId: 'autor-1' }, ID);
    });

    it('editar e novo convite validam o corpo e delegam', async () => {
      const servico = servicoDeTeste();
      const controller = new UsuariosController(servico as never, carteiraDeTeste() as never);

      await controller.editar(ADMIN, ID, { nome: 'Ana', papeis: ['auxiliar'], email: 'n@x.com' });
      await controller.novoConvite(ADMIN, ID, { nome: 'Ana', papeis: ['auxiliar'] });

      expect(servico.editar).toHaveBeenCalledWith(
        'tenant-1',
        { usuarioId: 'autor-1' },
        ID,
        {
          nome: 'Ana',
          papeis: ['auxiliar'],
          papeisPersonalizados: [],
          telefone: null,
          crc: null,
          email: 'n@x.com',
        },
      );
      expect(servico.novoConvite).toHaveBeenCalledWith('tenant-1', { usuarioId: 'autor-1' }, ID, {
        nome: 'Ana',
        papeis: ['auxiliar'],
        papeisPersonalizados: [],
        telefone: null,
        crc: null,
      });
    });

    it('corpo inválido é 422 e o serviço não é chamado', async () => {
      const servico = servicoDeTeste();

      expect(
        await codigoDe(() => new UsuariosController(servico as never, carteiraDeTeste() as never).convidar(ADMIN, { nome: '' })),
      ).toBe(CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO);
      expect(servico.convidar).not.toHaveBeenCalled();
    });
  });

  describe('identificador malformado', () => {
    it('responde como usuário inexistente sem tocar no serviço (o banco daria erro de cast)', async () => {
      const servico = servicoDeTeste();
      const controller = new UsuariosController(servico as never, carteiraDeTeste() as never);

      for (const ruim of ['nao-e-uuid', '', "1'; drop table app.usuario;--", 'x'.repeat(500)]) {
        expect(await codigoDe(() => controller.obter(ADMIN, ruim))).toBe(
          CODIGOS_DE_ERRO.USUARIO_NAO_ENCONTRADO,
        );
        expect(await codigoDe(() => controller.suspender(ADMIN, ruim))).toBe(
          CODIGOS_DE_ERRO.USUARIO_NAO_ENCONTRADO,
        );
      }

      expect(servico.obter).not.toHaveBeenCalled();
      expect(servico.suspender).not.toHaveBeenCalled();
    });
  });
});
