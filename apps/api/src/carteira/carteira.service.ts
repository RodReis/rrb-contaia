/**
 * Casos de uso da carteira (SPEC-009).
 *
 * A alteração é uma transação só: trava os colaboradores em ordem estável,
 * planeja o lote (domínio puro, tudo ou nada), aplica os vínculos, grava o
 * evento global append-only e cria uma notificação por colaborador afetado.
 * Falha em qualquer passo desfaz a operação inteira.
 */
import { Injectable } from '@nestjs/common';

import {
  acessoAEmpresa,
  aplicarEfeitos,
  carregarColaborador,
  carregarEmpresasDaOperacao,
  carregarUsuariosDaOperacao,
  comContextoDeTenant,
  criarNotificacoesDeCarteira,
  empresasDaCarteira,
  listarColaboradores,
  listarColaboradoresDaEmpresa,
  listarEmpresasDaCarteira,
  listarEmpresasParaAtribuicao,
  listarEventosDeCarteira,
  registrarEventoDeCarteira,
} from '@contaia/db';
import type {
  AfetadoDoEvento,
  ColaboradorDaEmpresa,
  ColaboradorNaCentral,
  EmpresaDaOperacao,
  EmpresaParaAtribuicao,
  FiltroDeColaboradores,
  FiltroDeEmpresasParaAtribuicao,
  FiltroDeEventosDeCarteira,
  PaginaDeColaboradores,
  PaginaDeEmpresasParaAtribuicao,
  PaginaDeEventosDeCarteira,
  UsuarioDaOperacao,
} from '@contaia/db';
import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  ErroDeValidacao,
  decidirAcessoEmpresarial,
  formatarCnpj,
  planejarAlteracao,
} from '@contaia/domain';
import type { PlanoDeCarteira } from '@contaia/domain';

import { PoolDoBanco } from '../banco/pool.provider';
import { IDENTIFICADOR } from '../usuarios/usuarios.dto';
import type { AlteracaoDeEntrada } from './carteira.dto';

export type ResultadoDaAlteracao = Readonly<{
  /** `false` quando nada mudaria: sem evento, sem notificação, sem nova revisão. */
  aplicado: boolean;
  afetados: readonly Readonly<{ usuarioId: string; revisaoNova: number }>[];
}>;

const unicos = (ids: readonly string[]): string[] => [...new Set(ids)];

/** Monta o item do evento com nome e CNPJ do momento — o histórico não muda se o cadastro mudar. */
const montarAfetados = (
  plano: PlanoDeCarteira,
  usuarios: readonly UsuarioDaOperacao[],
  empresas: readonly EmpresaDaOperacao[],
): AfetadoDoEvento[] => {
  const usuarioPorId = new Map(usuarios.map((u) => [u.id, u]));
  const resumo = new Map(empresas.map((e) => [e.id, { id: e.id, nome: e.nome, cnpj: e.cnpj }]));
  const empresasDe = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const empresa = resumo.get(id);
      return empresa === undefined ? [] : [empresa];
    });

  return plano.efeitos.map((efeito) => ({
    usuarioId: efeito.usuarioId,
    usuarioNome: usuarioPorId.get(efeito.usuarioId)?.nome ?? '',
    adicionadas: empresasDe(efeito.adicionadas),
    removidas: empresasDe(efeito.removidas),
    revisaoAnterior: efeito.revisaoNova - 1,
    revisaoNova: efeito.revisaoNova,
  }));
};

@Injectable()
export class CarteiraService {
  constructor(private readonly pool: PoolDoBanco) {}

  async alterar(
    tenantId: string,
    autorId: string,
    entrada: AlteracaoDeEntrada,
  ): Promise<ResultadoDaAlteracao> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      const idsDosUsuarios = unicos(entrada.usuarios.map((u) => u.id));
      const idsDasEmpresas = unicos([...entrada.adicionar, ...entrada.remover]);

      // Trava em ordem estável de id: operações simultâneas sobre os mesmos
      // colaboradores se enfileiram e a segunda planeja contra o que a primeira gravou.
      const usuarios = await carregarUsuariosDaOperacao(cliente, tenantId, idsDosUsuarios);
      const encontrados = new Set(usuarios.map((u) => u.id));
      const ausentes = idsDosUsuarios.filter((id) => !encontrados.has(id));

      if (ausentes.length > 0) {
        // Usuário de outro tenant é indistinguível de inexistente.
        throw new ErroDeValidacao(
          ausentes.map((id) => ({
            campo: `usuarios.${id}`,
            codigo: CODIGOS_DE_ERRO.USUARIO_NAO_ENCONTRADO,
          })),
        );
      }

      const empresas = await carregarEmpresasDaOperacao(cliente, tenantId, idsDasEmpresas);

      const plano = planejarAlteracao({
        usuarios,
        empresas,
        adicionar: entrada.adicionar,
        remover: entrada.remover,
        revisoesEsperadas: Object.fromEntries(entrada.usuarios.map((u) => [u.id, u.revisao])),
      });

      if (plano.semEfeito) {
        return { aplicado: false, afetados: [] };
      }

      const afetados = montarAfetados(plano, usuarios, empresas);

      await aplicarEfeitos(cliente, tenantId, autorId, plano.efeitos);
      const eventoId = await registrarEventoDeCarteira(cliente, tenantId, {
        origem: entrada.origem,
        autorId,
        afetados,
      });
      await criarNotificacoesDeCarteira(cliente, tenantId, eventoId, afetados);

      return {
        aplicado: true,
        afetados: plano.efeitos.map((e) => ({ usuarioId: e.usuarioId, revisaoNova: e.revisaoNova })),
      };
    });
  }

  listarColaboradores(
    tenantId: string,
    filtro: FiltroDeColaboradores,
  ): Promise<PaginaDeColaboradores> {
    return comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
      listarColaboradores(cliente, tenantId, filtro),
    );
  }

  async obterColaborador(tenantId: string, usuarioId: string): Promise<ColaboradorNaCentral> {
    const colaborador = await comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
      carregarColaborador(cliente, tenantId, usuarioId),
    );

    if (colaborador === null) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.USUARIO_NAO_ENCONTRADO, 'Colaborador não encontrado.');
    }

    return colaborador;
  }

  empresasParaAtribuicao(
    tenantId: string,
    usuarioId: string,
    filtro: FiltroDeEmpresasParaAtribuicao,
  ): Promise<PaginaDeEmpresasParaAtribuicao> {
    return comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
      listarEmpresasParaAtribuicao(cliente, tenantId, usuarioId, filtro),
    );
  }

  colaboradoresDaEmpresa(tenantId: string, empresaId: string): Promise<ColaboradorDaEmpresa[]> {
    return comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
      listarColaboradoresDaEmpresa(cliente, tenantId, empresaId),
    );
  }

  /** A carteira do próprio usuário, em qualquer situação da empresa. */
  minhaCarteira(tenantId: string, usuarioId: string): Promise<EmpresaParaAtribuicao[]> {
    return comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
      listarEmpresasDaCarteira(cliente, tenantId, usuarioId),
    );
  }

  eventos(tenantId: string, filtro: FiltroDeEventosDeCarteira): Promise<PaginaDeEventosDeCarteira> {
    return comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
      listarEventosDeCarteira(cliente, tenantId, filtro),
    );
  }

  /** `true` quando há ao menos uma empresa na carteira: define a orientação de ausência de alçada. */
  async possuiCarteira(tenantId: string, usuarioId: string): Promise<boolean> {
    const empresas = await comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
      empresasDaCarteira(cliente, tenantId, usuarioId),
    );

    return empresas.length > 0;
  }

  /**
   * Decisão de acesso empresarial por requisição (SPEC-009 §3.5). A permissão do
   * papel já foi conferida pelo `GuardDeAcao`; aqui valem tenant, usuário ativo
   * (a sessão só resolve usuário `ATIVO`) e o vínculo de carteira. A empresa do
   * mesmo tenant fora da carteira responde 403 com nome e CNPJ, e nada além.
   * Exceção decidida pelo PI: o administrador alcança empresa ARQUIVADA sem vínculo
   * (o arquivamento encerra todos os vínculos; sem isso ninguém reativaria a empresa).
   */
  async exigirAcessoAEmpresa(
    tenantId: string,
    usuarioId: string,
    empresaId: string,
    administrador: boolean,
  ): Promise<void> {
    // Id que nem tem forma de identificador não existe — e não chega ao banco.
    if (!IDENTIFICADOR.test(empresaId)) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada.');
    }

    const acesso = await comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
      acessoAEmpresa(cliente, tenantId, usuarioId, empresaId),
    );

    const decisao = decidirAcessoEmpresarial({
      empresaDoTenant: acesso !== null,
      usuarioAtivo: true,
      vinculoAtivo: acesso?.vinculado ?? false,
      permissaoConcedida: true,
      empresaArquivada: acesso?.arquivada ?? false,
      administrador,
    });

    if (decisao === 'PERMITIDO') {
      return;
    }

    if (acesso === null) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada.');
    }

    const cnpj = formatarCnpj(acesso.cnpj);
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.EMPRESA_FORA_DA_CARTEIRA,
      `Você não tem acesso a ${acesso.nome} (CNPJ ${cnpj}): ela não está na sua carteira.`,
      [],
      { empresa: { nome: acesso.nome, cnpj } },
    );
  }
}
