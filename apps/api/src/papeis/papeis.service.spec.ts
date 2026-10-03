/**
 * Casos de uso de papéis personalizados (SPEC-008, categoria Regras).
 *
 * O banco entra por um dublê em memória que se comporta como o real onde isso
 * importa para a decisão: a transação desfaz tudo quando o caso de uso falha
 * (papel, revisão e auditoria confirmam ou desfazem juntos), o nome é único no
 * escritório e arquivados não contam como vinculados. SQL, RLS, revisão
 * imutável e concorrência real têm provas próprias em `packages/db`.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@contaia/db', async () => {
  const real = await vi.importActual<typeof import('@contaia/db')>('@contaia/db');
  const { funcoesDoBanco } = await import('../usuarios/banco-em-memoria.js');

  return { ...real, ...funcoesDoBanco };
});

import { estado, reiniciar } from '../usuarios/banco-em-memoria';
import { PapeisService } from './papeis.service';

const T1 = 'tenant-1';
const T2 = 'tenant-2';
const AUTOR = { usuarioId: 'admin-1' };
const CONSULTAR_EMPRESAS = 'empresas.cadastro.consultar';
const CRIAR_EMPRESAS = 'empresas.cadastro.criar';

describe('PapeisService', () => {
  let service: PapeisService;

  const codigoDe = async (executar: () => Promise<unknown>): Promise<string | undefined> => {
    try {
      await executar();
    } catch (erro) {
      return erro instanceof ErroDeDominio ? erro.codigo : `OUTRO:${String(erro)}`;
    }

    return undefined;
  };

  const semearUsuario = (
    tenantId: string,
    id: string,
    estadoInicial = 'ATIVO',
  ): void => {
    estado.usuarios.push({
      id,
      tenantId,
      subOidc: `sub-${id}`,
      email: `${id}@escritorio.com`,
      nome: `Nome ${id}`,
      telefone: null,
      crc: null,
      estado: estadoInicial,
      papeis: ['auxiliar'],
      versao: 0,
      criadoEm: new Date(),
    });
  };

  const criar = (nome: string, permissoes: readonly unknown[] = [CONSULTAR_EMPRESAS], tenantId = T1) =>
    service.criar(tenantId, AUTOR, { nome, papelBase: 'auxiliar', permissoes: [...permissoes] });

  const vincular = (usuarioId: string, papelId: string, tenantId = T1): void => {
    estado.vinculos.push({ tenantId, usuarioId, papelId, removido: false });
  };

  const eventos = () => estado.eventos.filter((evento) => evento.tipo.startsWith('PAPEL_'));

  beforeEach(() => {
    reiniciar();
    service = new PapeisService({ instancia: {} } as never);
    semearUsuario(T1, 'admin-1');
  });

  describe('criar', () => {
    it('nasce ATIVO na revisão 1, com a matriz normalizada e o evento de criação', async () => {
      const papel = await service.criar(T1, AUTOR, {
        nome: '  Revisor   Fiscal ',
        descricao: ' confere ',
        papelBase: 'contador',
        permissoes: ['documentos.arquivos.baixar', CONSULTAR_EMPRESAS],
      });

      expect(papel).toMatchObject({
        nome: 'Revisor Fiscal',
        descricao: 'confere',
        papelBase: 'contador',
        estado: 'ATIVO',
        revisao: 1,
        incompatibilidades: [],
        usuariosVinculados: 0,
        usuarios: [],
      });
      // Baixar implica Consultar da funcionalidade: o servidor concede e ordena pelo catálogo.
      expect(papel.permissoes).toEqual([
        CONSULTAR_EMPRESAS,
        'documentos.arquivos.consultar',
        'documentos.arquivos.baixar',
      ]);
      expect(eventos()).toEqual([
        expect.objectContaining({
          tipo: 'PAPEL_CRIADO',
          papelId: papel.id,
          revisao: 1,
          usuarioAfetadoId: null,
          autorId: 'admin-1',
          antes: null,
          depois: expect.objectContaining({ nome: 'Revisor Fiscal', origem: 'contador' }),
        }),
      ]);
    });

    it('o papel é independente do padrão: guarda a própria matriz e a origem só como memória', async () => {
      const papel = await criar('Cópia', ['historico.global.consultar']);

      expect(papel.papelBase).toBe('auxiliar');
      expect(papel.permissoes).toEqual(['historico.global.consultar']);
    });

    it('nome duplicado no escritório é recusado sem diferenciar caixa, e nada é gravado', async () => {
      await criar('Revisor');

      expect(await codigoDe(() => criar('  REVISOR '))).toBe(CODIGOS_DE_ERRO.PAPEL_NOME_DUPLICADO);
      expect(estado.papeis).toHaveLength(1);
      expect(eventos()).toHaveLength(1);
    });

    it('o mesmo nome pode existir em outro escritório', async () => {
      await criar('Revisor');
      semearUsuario(T2, 'admin-2');

      await expect(criar('Revisor', [CONSULTAR_EMPRESAS], T2)).resolves.toMatchObject({
        nome: 'Revisor',
      });
    });

    it('matriz vazia, chave livre e área exclusiva não criam papel', async () => {
      expect(await codigoDe(() => criar('A', []))).toBe(CODIGOS_DE_ERRO.MATRIZ_INVALIDA);
      expect(await codigoDe(() => criar('B', ['empresas.cadastro.excluir']))).toBe(
        CODIGOS_DE_ERRO.PERMISSAO_INEXISTENTE,
      );
      expect(await codigoDe(() => criar('C', ['usuarios.usuarios_e_papeis.administrar']))).toBe(
        CODIGOS_DE_ERRO.PERMISSAO_EXCLUSIVA,
      );
      expect(estado.papeis).toHaveLength(0);
      expect(eventos()).toHaveLength(0);
    });

    it('nome obrigatório e base precisa ser papel padrão', async () => {
      expect(await codigoDe(() => criar('   '))).toBe(CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO);
      expect(
        await codigoDe(() =>
          service.criar(T1, AUTOR, { nome: 'X', papelBase: 'gestor_financeiro', permissoes: [CONSULTAR_EMPRESAS] }),
        ),
      ).toBe(CODIGOS_DE_ERRO.PAPEL_INVALIDO);
    });

    it('se a auditoria falha, o papel e a revisão desfazem juntos', async () => {
      estado.falharAoRegistrarEvento = true;

      await expect(criar('Atômico')).rejects.toThrow('falha na auditoria');

      expect(estado.papeis).toHaveLength(0);
      expect(estado.revisoes).toHaveLength(0);
    });
  });

  describe('editar', () => {
    it('altera dados e matriz numa só revisão, com um evento para cada coisa', async () => {
      const original = await criar('Revisor', [CONSULTAR_EMPRESAS, CRIAR_EMPRESAS]);

      const editado = await service.editar(T1, AUTOR, original.id, {
        nome: 'Revisor Sênior',
        descricao: 'novo texto',
        permissoes: [CONSULTAR_EMPRESAS, 'historico.global.consultar'],
        revisaoEsperada: 1,
        confirmaReducao: false,
      });

      expect(editado).toMatchObject({ nome: 'Revisor Sênior', revisao: 2 });
      expect(editado.permissoes).toEqual([CONSULTAR_EMPRESAS, 'historico.global.consultar']);

      const [, dados, matriz] = eventos();

      expect(dados).toMatchObject({
        tipo: 'PAPEL_DADOS_ALTERADOS',
        revisao: 2,
        antes: { nome: 'Revisor', descricao: null },
        depois: { nome: 'Revisor Sênior', descricao: 'novo texto' },
      });
      expect(matriz).toMatchObject({
        tipo: 'PAPEL_MATRIZ_ALTERADA',
        revisao: 2,
        antes: { permissoes: [CONSULTAR_EMPRESAS, CRIAR_EMPRESAS] },
        depois: { adicionadas: ['historico.global.consultar'], retiradas: [CRIAR_EMPRESAS] },
      });
    });

    it('só renomear gera só o evento de dados', async () => {
      const original = await criar('Revisor');

      await service.editar(T1, AUTOR, original.id, {
        nome: 'Outro nome',
        permissoes: [CONSULTAR_EMPRESAS],
        revisaoEsperada: 1,
        confirmaReducao: false,
      });

      expect(eventos().map((e) => e.tipo)).toEqual(['PAPEL_CRIADO', 'PAPEL_DADOS_ALTERADOS']);
    });

    it('sem nenhuma mudança não abre revisão nem grava evento', async () => {
      const original = await criar('Revisor');

      const igual = await service.editar(T1, AUTOR, original.id, {
        nome: 'Revisor',
        permissoes: [CONSULTAR_EMPRESAS],
        revisaoEsperada: 1,
        confirmaReducao: false,
      });

      expect(igual.revisao).toBe(1);
      expect(eventos()).toHaveLength(1);
      expect(estado.revisoes).toHaveLength(1);
    });

    it('redução em papel atribuído exige confirmação e informa quantos usuários', async () => {
      const original = await criar('Revisor', [CONSULTAR_EMPRESAS, CRIAR_EMPRESAS]);

      semearUsuario(T1, 'u1');
      semearUsuario(T1, 'u2');
      vincular('u1', original.id);
      vincular('u2', original.id);

      const reduzir = (confirmaReducao: boolean) =>
        service.editar(T1, AUTOR, original.id, {
          nome: 'Revisor',
          permissoes: [CONSULTAR_EMPRESAS],
          revisaoEsperada: 1,
          confirmaReducao,
        });

      const erro = await reduzir(false).catch((e: unknown) => e);

      expect(erro).toMatchObject({ codigo: CODIGOS_DE_ERRO.REDUCAO_NAO_CONFIRMADA });
      expect((erro as Error).message).toContain('2 usuários');
      expect(estado.papeis[0]?.revisao).toBe(1);

      await expect(reduzir(true)).resolves.toMatchObject({ revisao: 2, usuariosVinculados: 2 });
    });

    it('redução em papel sem usuários vinculados não exige confirmação', async () => {
      const original = await criar('Revisor', [CONSULTAR_EMPRESAS, CRIAR_EMPRESAS]);

      await expect(
        service.editar(T1, AUTOR, original.id, {
          nome: 'Revisor',
          permissoes: [CONSULTAR_EMPRESAS],
          revisaoEsperada: 1,
          confirmaReducao: false,
        }),
      ).resolves.toMatchObject({ revisao: 2 });
    });

    it('ampliar permissões em papel atribuído não pede confirmação', async () => {
      const original = await criar('Revisor');

      semearUsuario(T1, 'u1');
      vincular('u1', original.id);

      await expect(
        service.editar(T1, AUTOR, original.id, {
          nome: 'Revisor',
          permissoes: [CONSULTAR_EMPRESAS, CRIAR_EMPRESAS],
          revisaoEsperada: 1,
          confirmaReducao: false,
        }),
      ).resolves.toMatchObject({ revisao: 2 });
    });

    it('revisão desatualizada é conflito e nada muda', async () => {
      const original = await criar('Revisor');

      await service.editar(T1, AUTOR, original.id, {
        nome: 'Primeira edição',
        permissoes: [CONSULTAR_EMPRESAS],
        revisaoEsperada: 1,
        confirmaReducao: false,
      });

      expect(
        await codigoDe(() =>
          service.editar(T1, AUTOR, original.id, {
            nome: 'Segunda, de tela velha',
            permissoes: [CONSULTAR_EMPRESAS],
            revisaoEsperada: 1,
            confirmaReducao: false,
          }),
        ),
      ).toBe(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO);
      expect(estado.papeis[0]?.nome).toBe('Primeira edição');
    });

    it('renomear para o nome de outro papel é recusado; mudar só a caixa do próprio nome pode', async () => {
      await criar('Ocupado');
      const outro = await criar('Livre');

      const editar = (nome: string) =>
        service.editar(T1, AUTOR, outro.id, {
          nome,
          permissoes: [CONSULTAR_EMPRESAS],
          revisaoEsperada: estado.papeis.find((p) => p.id === outro.id)?.revisao ?? 1,
          confirmaReducao: false,
        });

      expect(await codigoDe(() => editar('OCUPADO'))).toBe(CODIGOS_DE_ERRO.PAPEL_NOME_DUPLICADO);
      await expect(editar('LIVRE')).resolves.toMatchObject({ nome: 'LIVRE' });
    });

    it('papel arquivado não é editado; chave livre e área exclusiva também não passam', async () => {
      const original = await criar('Revisor');

      await service.arquivar(T1, AUTOR, original.id, { revisaoEsperada: 1 });

      expect(
        await codigoDe(() =>
          service.editar(T1, AUTOR, original.id, {
            nome: 'Revisor',
            permissoes: [CONSULTAR_EMPRESAS],
            revisaoEsperada: 2,
            confirmaReducao: false,
          }),
        ),
      ).toBe(CODIGOS_DE_ERRO.PAPEL_ARQUIVADO);

      const ativo = await criar('Outro');

      expect(
        await codigoDe(() =>
          service.editar(T1, AUTOR, ativo.id, {
            nome: 'Outro',
            permissoes: ['usuarios.usuarios_e_papeis.consultar'],
            revisaoEsperada: 1,
            confirmaReducao: false,
          }),
        ),
      ).toBe(CODIGOS_DE_ERRO.PERMISSAO_EXCLUSIVA);
      expect(
        await codigoDe(() =>
          service.editar(T1, AUTOR, ativo.id, {
            nome: 'Outro',
            permissoes: ['financeiro.x.consultar'],
            revisaoEsperada: 1,
            confirmaReducao: false,
          }),
        ),
      ).toBe(CODIGOS_DE_ERRO.PERMISSAO_INEXISTENTE);
    });

    it('papel de outro escritório responde como inexistente', async () => {
      const original = await criar('Revisor');

      expect(
        await codigoDe(() =>
          service.editar(T2, AUTOR, original.id, {
            nome: 'Invasor',
            permissoes: [CONSULTAR_EMPRESAS],
            revisaoEsperada: 1,
            confirmaReducao: false,
          }),
        ),
      ).toBe(CODIGOS_DE_ERRO.PAPEL_NAO_ENCONTRADO);
      expect(estado.papeis[0]?.nome).toBe('Revisor');
    });

    it('se a auditoria falha, a nova revisão desfaz', async () => {
      const original = await criar('Revisor');

      estado.falharAoRegistrarEvento = true;

      await expect(
        service.editar(T1, AUTOR, original.id, {
          nome: 'Novo',
          permissoes: [CONSULTAR_EMPRESAS],
          revisaoEsperada: 1,
          confirmaReducao: false,
        }),
      ).rejects.toThrow('falha na auditoria');

      expect(estado.papeis[0]).toMatchObject({ nome: 'Revisor', revisao: 1 });
      expect(estado.revisoes).toHaveLength(1);
    });
  });

  describe('arquivar', () => {
    it('arquiva papel sem usuários, preserva definição e matriz e abre nova revisão', async () => {
      const original = await criar('Revisor', [CONSULTAR_EMPRESAS, CRIAR_EMPRESAS]);

      const arquivado = await service.arquivar(T1, AUTOR, original.id, { revisaoEsperada: 1 });

      expect(arquivado).toMatchObject({ estado: 'ARQUIVADO', revisao: 2, nome: 'Revisor' });
      expect(arquivado.permissoes).toEqual([CONSULTAR_EMPRESAS, CRIAR_EMPRESAS]);
      expect(eventos().at(-1)).toMatchObject({
        tipo: 'PAPEL_ARQUIVADO',
        revisao: 2,
        antes: { estado: 'ATIVO' },
        depois: { estado: 'ARQUIVADO' },
      });
    });

    it('papel atribuído não é arquivado e a mensagem diz quantos usuários', async () => {
      const original = await criar('Revisor');

      semearUsuario(T1, 'u1');
      vincular('u1', original.id);

      const erro = await service
        .arquivar(T1, AUTOR, original.id, { revisaoEsperada: 1 })
        .catch((e: unknown) => e);

      expect(erro).toMatchObject({ codigo: CODIGOS_DE_ERRO.PAPEL_EM_USO });
      expect((erro as Error).message).toContain('1 usuário');
      expect(estado.papeis[0]).toMatchObject({ estado: 'ATIVO', revisao: 1 });
    });

    it('usuário arquivado não segura o arquivamento do papel', async () => {
      const original = await criar('Revisor');

      semearUsuario(T1, 'u1', 'ARQUIVADO');
      vincular('u1', original.id);

      await expect(
        service.arquivar(T1, AUTOR, original.id, { revisaoEsperada: 1 }),
      ).resolves.toMatchObject({ estado: 'ARQUIVADO' });
    });

    it('usuário suspenso ou convidado ainda segura o papel', async () => {
      const original = await criar('Revisor');

      semearUsuario(T1, 'u1', 'SUSPENSO');
      vincular('u1', original.id);

      expect(await codigoDe(() => service.arquivar(T1, AUTOR, original.id, { revisaoEsperada: 1 }))).toBe(
        CODIGOS_DE_ERRO.PAPEL_EM_USO,
      );
    });

    it('arquivar de novo, revisão velha e papel alheio são recusados', async () => {
      const original = await criar('Revisor');

      expect(await codigoDe(() => service.arquivar(T1, AUTOR, original.id, { revisaoEsperada: 9 }))).toBe(
        CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO,
      );
      expect(await codigoDe(() => service.arquivar(T2, AUTOR, original.id, { revisaoEsperada: 1 }))).toBe(
        CODIGOS_DE_ERRO.PAPEL_NAO_ENCONTRADO,
      );

      await service.arquivar(T1, AUTOR, original.id, { revisaoEsperada: 1 });

      expect(await codigoDe(() => service.arquivar(T1, AUTOR, original.id, { revisaoEsperada: 2 }))).toBe(
        CODIGOS_DE_ERRO.TRANSICAO_DE_PAPEL_INVALIDA,
      );
    });
  });

  describe('reativar', () => {
    const arquivado = async (permissoes: readonly unknown[] = [CONSULTAR_EMPRESAS, CRIAR_EMPRESAS]) => {
      const papel = await criar('Revisor', permissoes);

      await service.arquivar(T1, AUTOR, papel.id, { revisaoEsperada: 1 });

      return papel;
    };

    it('exige a matriz revisada, volta ATIVO e não restaura vínculos antigos', async () => {
      const papel = await arquivado();

      const reativado = await service.reativar(T1, AUTOR, papel.id, {
        revisaoEsperada: 2,
        permissoes: [CONSULTAR_EMPRESAS, CRIAR_EMPRESAS],
        confirmaIncompatibilidades: false,
      });

      expect(reativado).toMatchObject({ estado: 'ATIVO', revisao: 3, usuariosVinculados: 0 });
      expect(eventos().at(-1)).toMatchObject({
        tipo: 'PAPEL_REATIVADO',
        revisao: 3,
        depois: { estado: 'ATIVO', incompatibilidadesRemovidas: [] },
      });
    });

    it('a revisão pode mudar a matriz, e a mudança também é auditada', async () => {
      const papel = await arquivado();

      await service.reativar(T1, AUTOR, papel.id, {
        revisaoEsperada: 2,
        permissoes: [CONSULTAR_EMPRESAS],
        confirmaIncompatibilidades: false,
      });

      expect(eventos().slice(-2).map((e) => e.tipo)).toEqual([
        'PAPEL_REATIVADO',
        'PAPEL_MATRIZ_ALTERADA',
      ]);
      expect(eventos().at(-1)).toMatchObject({
        depois: { retiradas: [CRIAR_EMPRESAS], adicionadas: [] },
      });
    });

    it('permissão obsoleta no catálogo exige confirmação e nunca é restaurada', async () => {
      const papel = await arquivado();

      // Simula catálogo que encolheu depois do arquivamento: a matriz preservada traz chave que já não existe.
      const preservado = estado.papeis.find((p) => p.id === papel.id);

      preservado?.permissoes.push('empresas.cadastro.excluir');

      const detalhe = await service.obter(T1, papel.id);

      expect(detalhe.incompatibilidades).toEqual(['empresas.cadastro.excluir']);
      expect(detalhe.permissoes).not.toContain('empresas.cadastro.excluir');

      const reativar = (confirmaIncompatibilidades: boolean) =>
        service.reativar(T1, AUTOR, papel.id, {
          revisaoEsperada: 2,
          permissoes: [CONSULTAR_EMPRESAS, CRIAR_EMPRESAS],
          confirmaIncompatibilidades,
        });

      expect(await codigoDe(() => reativar(false))).toBe(CODIGOS_DE_ERRO.REVISAO_NAO_CONFIRMADA);
      expect(estado.papeis.find((p) => p.id === papel.id)?.estado).toBe('ARQUIVADO');

      const reativado = await reativar(true);

      expect(reativado.permissoes).not.toContain('empresas.cadastro.excluir');
      expect(reativado.incompatibilidades).toEqual([]);
      expect(eventos().find((e) => e.tipo === 'PAPEL_REATIVADO')).toMatchObject({
        depois: { incompatibilidadesRemovidas: ['empresas.cadastro.excluir'] },
      });
    });

    it('a matriz enviada na reativação passa pelas mesmas regras do catálogo', async () => {
      const papel = await arquivado();

      const tentar = (permissoes: readonly unknown[]) =>
        codigoDe(() =>
          service.reativar(T1, AUTOR, papel.id, {
            revisaoEsperada: 2,
            permissoes: [...permissoes],
            confirmaIncompatibilidades: true,
          }),
        );

      expect(await tentar([])).toBe(CODIGOS_DE_ERRO.MATRIZ_INVALIDA);
      expect(await tentar(['empresas.cadastro.excluir'])).toBe(CODIGOS_DE_ERRO.PERMISSAO_INEXISTENTE);
      expect(await tentar(['usuarios.usuarios_e_papeis.consultar'])).toBe(
        CODIGOS_DE_ERRO.PERMISSAO_EXCLUSIVA,
      );
    });

    it('papel ativo não reativa; revisão velha é conflito', async () => {
      const ativo = await criar('Ativo');

      expect(
        await codigoDe(() =>
          service.reativar(T1, AUTOR, ativo.id, {
            revisaoEsperada: 1,
            permissoes: [CONSULTAR_EMPRESAS],
            confirmaIncompatibilidades: false,
          }),
        ),
      ).toBe(CODIGOS_DE_ERRO.TRANSICAO_DE_PAPEL_INVALIDA);

      const papel = await arquivado();

      expect(
        await codigoDe(() =>
          service.reativar(T1, AUTOR, papel.id, {
            revisaoEsperada: 1,
            permissoes: [CONSULTAR_EMPRESAS],
            confirmaIncompatibilidades: false,
          }),
        ),
      ).toBe(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO);
    });
  });

  describe('consulta', () => {
    it('lista só os papéis do escritório da sessão, com busca, estado e contagem de vinculados', async () => {
      const a = await criar('Alfa');
      const b = await criar('Beta');

      await service.arquivar(T1, AUTOR, b.id, { revisaoEsperada: 1 });
      semearUsuario(T2, 'admin-2');
      await criar('Alfa de outro escritório', [CONSULTAR_EMPRESAS], T2);
      semearUsuario(T1, 'u1');
      vincular('u1', a.id);

      const todos = await service.listar(T1, { limite: 25, deslocamento: 0 });

      expect(todos.total).toBe(2);
      expect(todos.papeis.map((p) => p.nome)).toEqual(['Alfa', 'Beta']);
      expect(todos.papeis[0]?.usuariosVinculados).toBe(1);

      const ativos = await service.listar(T1, { estado: 'ATIVO', limite: 25, deslocamento: 0 });

      expect(ativos.papeis.map((p) => p.nome)).toEqual(['Alfa']);

      const busca = await service.listar(T1, { busca: 'bet', limite: 25, deslocamento: 0 });

      expect(busca.papeis.map((p) => p.nome)).toEqual(['Beta']);
    });

    it('o detalhe lista os usuários vinculados e papel alheio não existe', async () => {
      const papel = await criar('Revisor');

      semearUsuario(T1, 'u1');
      vincular('u1', papel.id);

      const detalhe = await service.obter(T1, papel.id);

      expect(detalhe.usuarios).toEqual([{ id: 'u1', nome: 'Nome u1' }]);
      expect(await codigoDe(() => service.obter(T2, papel.id))).toBe(CODIGOS_DE_ERRO.PAPEL_NAO_ENCONTRADO);
    });
  });
});
