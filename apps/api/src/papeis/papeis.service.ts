/**
 * Casos de uso de papéis personalizados (SPEC-008).
 *
 * Toda mutação roda numa transação que escreve o papel, a revisão da matriz e o
 * evento de auditoria juntos: se a auditoria falha, a mutação desfaz. O papel é
 * carregado com `for update` antes de decidir qualquer coisa, então duas
 * alterações, ou uma alteração e uma atribuição, se enfileiram e a segunda valida
 * contra o que a primeira gravou. Papel nunca é excluído; a revisão cresce a
 * cada mudança e o cliente confirma a que leu (`revisaoEsperada`).
 */
import { Injectable } from '@nestjs/common';

import {
  carregarPapel,
  comContextoHumano,
  contarVinculosDoPapel,
  criarPapel,
  gravarNovaRevisao,
  listarPapeis,
  listarUsuariosVinculados,
  papelComNome,
  registrarEventoDeUsuario,
} from '@contaia/db';
import type {
  FiltroDePapeis,
  PapelNaLista,
  PapelPersistido,
  UsuarioVinculadoAoPapel,
} from '@contaia/db';
import {
  CODIGOS_DE_ERRO,
  ErroDeConflito,
  ErroDeDominio,
  diferencaDeMatriz,
  ehPapelPadrao,
  ehReducao,
  garantirPapelSemVinculos,
  matrizParaRevisao,
  normalizarMatriz,
  transicionarPapel,
  validarDadosDoPapel,
} from '@contaia/domain';
import type { ChaveDoCatalogo, EstadoDoPapel, PapelPadrao } from '@contaia/domain';

import { PoolDoBanco } from '../banco/pool.provider';
import type {
  ArquivamentoDePapel,
  CriacaoDePapel,
  EdicaoDePapel,
  ReativacaoDePapel,
} from './papeis.dto';

export type Autor = Readonly<{ usuarioId: string }>;

export type VisaoDePapel = Readonly<{
  id: string;
  nome: string;
  descricao: string | null;
  papelBase: PapelPadrao;
  estado: EstadoDoPapel;
  revisao: number;
  /** Matriz da revisão vigente, só com o que o catálogo vigente ainda aceita. */
  permissoes: readonly ChaveDoCatalogo[];
  /** Permissões salvas que deixaram de existir no catálogo: nunca são restauradas (§3.5). */
  incompatibilidades: readonly string[];
  usuariosVinculados: number;
  criadoEm: string;
  atualizadoEm: string;
}>;

export type DetalheDePapel = VisaoDePapel &
  Readonly<{ usuarios: readonly UsuarioVinculadoAoPapel[] }>;

export type PaginaDePapeisVisao = Readonly<{ papeis: readonly VisaoDePapel[]; total: number }>;

/** Papéis e permissões são gestão de acesso (F8, SPEC-010 §3.3): só essa finalidade os escreve. */
const comoAdmin = (tenantId: string, autor: Autor) =>
  ({ tenantId, usuarioId: autor.usuarioId, finalidade: 'ADMIN_ACESSO' }) as const;

type Cliente = Parameters<Parameters<typeof comContextoHumano>[2]>[0];

const papelNaoEncontrado = (): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.PAPEL_NAO_ENCONTRADO, 'Papel não encontrado.');

const revisaoDesatualizada = (): ErroDeConflito =>
  new ErroDeConflito(
    CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO,
    'O papel foi alterado por outra operação. Recarregue e tente de novo.',
  );

const paraVisao = (papel: PapelPersistido, usuariosVinculados: number): VisaoDePapel => {
  const matriz = matrizParaRevisao(papel.permissoes);

  return {
    id: papel.id,
    nome: papel.nome,
    descricao: papel.descricao,
    papelBase: papel.papelBase,
    estado: papel.estado,
    revisao: papel.revisao,
    permissoes: matriz.vigentes,
    incompatibilidades: matriz.incompativeis,
    usuariosVinculados,
    criadoEm: papel.criadoEm.toISOString(),
    atualizadoEm: papel.atualizadoEm.toISOString(),
  };
};

const paraVisaoDaLista = (papel: PapelNaLista): VisaoDePapel =>
  paraVisao(papel, papel.usuariosVinculados);

@Injectable()
export class PapeisService {
  constructor(private readonly pool: PoolDoBanco) {}

  // -- Consulta ---------------------------------------------------------------

  async listar(
    tenantId: string,
    autor: Autor,
    filtro: FiltroDePapeis,
  ): Promise<PaginaDePapeisVisao> {
    return comContextoHumano(this.pool.instancia, comoAdmin(tenantId, autor), async (cliente) => {
      const pagina = await listarPapeis(cliente, tenantId, filtro);

      return { total: pagina.total, papeis: pagina.papeis.map(paraVisaoDaLista) };
    });
  }

  async obter(tenantId: string, autor: Autor, papelId: string): Promise<DetalheDePapel> {
    return comContextoHumano(this.pool.instancia, comoAdmin(tenantId, autor), (cliente) =>
      this.detalhe(cliente, tenantId, papelId),
    );
  }

  // -- Mutações ---------------------------------------------------------------

  async criar(tenantId: string, autor: Autor, entrada: CriacaoDePapel): Promise<DetalheDePapel> {
    const dados = validarDadosDoPapel(entrada);

    if (!ehPapelPadrao(entrada.papelBase)) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.PAPEL_INVALIDO,
        'Escolha um papel padrão como base do papel personalizado.',
      );
    }

    const papelBase = entrada.papelBase;
    const matriz = normalizarMatriz(entrada.permissoes);

    return comContextoHumano(this.pool.instancia, comoAdmin(tenantId, autor), async (cliente) => {
      await this.exigirNomeLivre(cliente, tenantId, dados.nome, null);

      const papelId = await criarPapel(cliente, tenantId, {
        nome: dados.nome,
        descricao: dados.descricao,
        papelBase,
        permissoes: matriz,
        autorId: autor.usuarioId,
      });

      await registrarEventoDeUsuario(cliente, tenantId, {
        tipo: 'PAPEL_CRIADO',
        usuarioAfetadoId: null,
        papelId,
        revisao: 1,
        autorId: autor.usuarioId,
        antes: null,
        depois: {
          nome: dados.nome,
          descricao: dados.descricao,
          origem: papelBase,
          permissoes: matriz,
        },
      });

      return this.detalhe(cliente, tenantId, papelId);
    });
  }

  async editar(
    tenantId: string,
    autor: Autor,
    papelId: string,
    entrada: EdicaoDePapel,
  ): Promise<DetalheDePapel> {
    const dados = validarDadosDoPapel(entrada);
    const matriz = normalizarMatriz(entrada.permissoes);

    return comContextoHumano(this.pool.instancia, comoAdmin(tenantId, autor), async (cliente) => {
      const papel = await this.carregarParaAlterar(cliente, tenantId, papelId, entrada.revisaoEsperada);

      if (papel.estado === 'ARQUIVADO') {
        throw new ErroDeConflito(
          CODIGOS_DE_ERRO.PAPEL_ARQUIVADO,
          'Papel arquivado não pode ser editado. Reative-o para revisar a matriz.',
        );
      }

      const anterior = matrizParaRevisao(papel.permissoes).vigentes;
      const diferenca = diferencaDeMatriz(anterior, matriz);
      const mudouDados = dados.nome !== papel.nome || dados.descricao !== papel.descricao;
      const mudouMatriz = diferenca.adicionadas.length > 0 || diferenca.retiradas.length > 0;

      if (!mudouDados && !mudouMatriz) {
        return this.detalhe(cliente, tenantId, papelId);
      }

      if (mudouDados) {
        await this.exigirNomeLivre(cliente, tenantId, dados.nome, papelId);
      }

      const vinculados = await contarVinculosDoPapel(cliente, tenantId, papelId);

      if (ehReducao(diferenca) && vinculados > 0 && !entrada.confirmaReducao) {
        throw new ErroDeConflito(
          CODIGOS_DE_ERRO.REDUCAO_NAO_CONFIRMADA,
          `Esta alteração reduz permissões de um papel atribuído a ${vinculados} ` +
            `${vinculados === 1 ? 'usuário' : 'usuários'}. Confirme a redução para aplicar.`,
        );
      }

      const revisao = await gravarNovaRevisao(cliente, tenantId, papelId, {
        nome: dados.nome,
        descricao: dados.descricao,
        estado: papel.estado,
        permissoes: matriz,
        autorId: autor.usuarioId,
      });

      if (mudouDados) {
        await registrarEventoDeUsuario(cliente, tenantId, {
          tipo: 'PAPEL_DADOS_ALTERADOS',
          usuarioAfetadoId: null,
          papelId,
          revisao,
          autorId: autor.usuarioId,
          antes: {
            ...(dados.nome !== papel.nome ? { nome: papel.nome } : {}),
            ...(dados.descricao !== papel.descricao ? { descricao: papel.descricao } : {}),
          },
          depois: {
            ...(dados.nome !== papel.nome ? { nome: dados.nome } : {}),
            ...(dados.descricao !== papel.descricao ? { descricao: dados.descricao } : {}),
          },
        });
      }

      if (mudouMatriz) {
        await this.registrarMudancaDeMatriz(cliente, tenantId, autor, papelId, revisao, anterior, matriz);
      }

      return this.detalhe(cliente, tenantId, papelId);
    });
  }

  async arquivar(
    tenantId: string,
    autor: Autor,
    papelId: string,
    entrada: ArquivamentoDePapel,
  ): Promise<DetalheDePapel> {
    return comContextoHumano(this.pool.instancia, comoAdmin(tenantId, autor), async (cliente) => {
      const papel = await this.carregarParaAlterar(cliente, tenantId, papelId, entrada.revisaoEsperada);
      const novoEstado = transicionarPapel(papel.estado, 'ARQUIVAR');

      garantirPapelSemVinculos(await contarVinculosDoPapel(cliente, tenantId, papelId));

      const revisao = await gravarNovaRevisao(cliente, tenantId, papelId, {
        nome: papel.nome,
        descricao: papel.descricao,
        estado: novoEstado,
        permissoes: papel.permissoes,
        autorId: autor.usuarioId,
      });

      await registrarEventoDeUsuario(cliente, tenantId, {
        tipo: 'PAPEL_ARQUIVADO',
        usuarioAfetadoId: null,
        papelId,
        revisao,
        autorId: autor.usuarioId,
        antes: { estado: papel.estado },
        depois: { estado: novoEstado },
      });

      return this.detalhe(cliente, tenantId, papelId);
    });
  }

  async reativar(
    tenantId: string,
    autor: Autor,
    papelId: string,
    entrada: ReativacaoDePapel,
  ): Promise<DetalheDePapel> {
    const matriz = normalizarMatriz(entrada.permissoes);

    return comContextoHumano(this.pool.instancia, comoAdmin(tenantId, autor), async (cliente) => {
      const papel = await this.carregarParaAlterar(cliente, tenantId, papelId, entrada.revisaoEsperada);
      const novoEstado = transicionarPapel(papel.estado, 'REATIVAR');
      const preservada = matrizParaRevisao(papel.permissoes);

      // A matriz preservada é revisada contra o catálogo vigente: o que deixou de
      // existir não volta, e o administrador confirma a matriz que sobra (§3.5).
      if (preservada.incompativeis.length > 0 && !entrada.confirmaIncompatibilidades) {
        throw new ErroDeConflito(
          CODIGOS_DE_ERRO.REVISAO_NAO_CONFIRMADA,
          'A matriz preservada tem permissões que não existem mais no catálogo. Confirme a matriz revisada.',
        );
      }

      const revisao = await gravarNovaRevisao(cliente, tenantId, papelId, {
        nome: papel.nome,
        descricao: papel.descricao,
        estado: novoEstado,
        permissoes: matriz,
        autorId: autor.usuarioId,
      });

      await registrarEventoDeUsuario(cliente, tenantId, {
        tipo: 'PAPEL_REATIVADO',
        usuarioAfetadoId: null,
        papelId,
        revisao,
        autorId: autor.usuarioId,
        antes: { estado: papel.estado },
        depois: {
          estado: novoEstado,
          incompatibilidadesRemovidas: preservada.incompativeis,
        },
      });

      const diferenca = diferencaDeMatriz(preservada.vigentes, matriz);

      if (diferenca.adicionadas.length > 0 || diferenca.retiradas.length > 0) {
        await this.registrarMudancaDeMatriz(
          cliente,
          tenantId,
          autor,
          papelId,
          revisao,
          preservada.vigentes,
          matriz,
        );
      }

      return this.detalhe(cliente, tenantId, papelId);
    });
  }

  // -- Internos ---------------------------------------------------------------

  private async detalhe(
    cliente: Cliente,
    tenantId: string,
    papelId: string,
  ): Promise<DetalheDePapel> {
    const papel = await carregarPapel(cliente, tenantId, papelId);

    if (papel === null) {
      throw papelNaoEncontrado();
    }

    const usuarios = await listarUsuariosVinculados(cliente, tenantId, papelId);

    return { ...paraVisao(papel, usuarios.length), usuarios };
  }

  /** Trava o papel, confere que existe e que o cliente leu a revisão vigente. */
  private async carregarParaAlterar(
    cliente: Cliente,
    tenantId: string,
    papelId: string,
    revisaoEsperada: number,
  ): Promise<PapelPersistido> {
    const papel = await carregarPapel(cliente, tenantId, papelId, { travar: true });

    if (papel === null) {
      throw papelNaoEncontrado();
    }

    if (papel.revisao !== revisaoEsperada) {
      throw revisaoDesatualizada();
    }

    return papel;
  }

  /** Nome único no tenant sem diferenciar caixa; `papelId` é o próprio papel numa renomeação. */
  private async exigirNomeLivre(
    cliente: Cliente,
    tenantId: string,
    nome: string,
    papelId: string | null,
  ): Promise<void> {
    const existente = await papelComNome(cliente, tenantId, nome);

    if (existente !== null && existente !== papelId) {
      throw new ErroDeConflito(
        CODIGOS_DE_ERRO.PAPEL_NOME_DUPLICADO,
        'Já existe um papel com este nome neste escritório.',
      );
    }
  }

  private async registrarMudancaDeMatriz(
    cliente: Cliente,
    tenantId: string,
    autor: Autor,
    papelId: string,
    revisao: number,
    anterior: readonly ChaveDoCatalogo[],
    nova: readonly ChaveDoCatalogo[],
  ): Promise<void> {
    const diferenca = diferencaDeMatriz(anterior, nova);

    await registrarEventoDeUsuario(cliente, tenantId, {
      tipo: 'PAPEL_MATRIZ_ALTERADA',
      usuarioAfetadoId: null,
      papelId,
      revisao,
      autorId: autor.usuarioId,
      antes: { permissoes: anterior },
      depois: {
        permissoes: nova,
        adicionadas: diferenca.adicionadas,
        retiradas: diferenca.retiradas,
      },
    });
  }
}
