/**
 * Casos de uso do cadastro da empresa cliente (SPEC-002).
 *
 * O caso de uso controla a transação e decide; o domínio valida; o repositório
 * persiste; o adaptador fala com a fonte externa. Nenhuma regra no controller.
 */
import { Injectable } from '@nestjs/common';

import {
  CODIGOS_DE_ERRO,
  ErroDeConflito,
  ErroDeDominio,
  ErroDeValidacao,
  ativarEmpresa,
  camposInvalidosDaEtapaDaEmpresa,
  etapasConcluidasDaEmpresa,
  exigeConfirmacaoDeSituacaoExterna,
  normalizarCep,
  normalizarCnpj,
  normalizarEmail,
  normalizarTelefone,
  podeAtivarEmpresa,
  primeiraEtapaIncompletaDaEmpresa,
} from '@contaia/domain';
import type {
  CadastroDaEmpresa,
  DadosFiscaisDaEmpresa,
  EnderecoDaEmpresa,
  EtapaDaEmpresa,
  IdentificacaoDaEmpresa,
  StatusDaEmpresa,
} from '@contaia/domain';
import {
  carregarEmpresa,
  comContextoDeTenant,
  criarEmpresa,
  empresaComCnpj,
  listarEmpresas,
  marcarEmpresaComoAtiva,
  salvarDadosFiscais,
  salvarEnderecoDaEmpresa,
  salvarIdentificacaoDaEmpresa,
} from '@contaia/db';
import type { EmpresaNaLista, FiltroDaLista } from '@contaia/db';
import type { DadosPublicosDoCnpj, MotivoDeFalhaDaConsulta } from '@contaia/shared';

import { PoolDoBanco } from '../banco/pool.provider';
import { ConsultaDeCnpjNaCnpja } from './cnpja.adapter';

export type VisaoDaEmpresa = Readonly<{
  id: string;
  cadastro: CadastroDaEmpresa;
  etapasConcluidas: readonly EtapaDaEmpresa[];
  proximaEtapa: EtapaDaEmpresa | null;
  podeAtivar: boolean;
  exigeConfirmacaoDeSituacaoExterna: boolean;
}>;

export type ListaDeEmpresas = Readonly<{
  empresas: readonly EmpresaNaLista[];
  total: number;
}>;

/**
 * Resultado da consulta por CNPJ antes de criar a empresa (§3.3 e §3.4).
 *
 * `existente` não é erro: é o caminho de abrir o cadastro que já está no
 * escritório. Por isso vem como resultado, e não como exceção.
 */
export type ResultadoDaConsultaDeCnpj =
  | Readonly<{ situacao: 'existente'; empresaId: string; status: StatusDaEmpresa }>
  | Readonly<{ situacao: 'consultado'; cnpj: string; dados: DadosPublicosDoCnpj }>
  | Readonly<{ situacao: 'sem_fonte'; cnpj: string; motivo: MotivoDeFalhaDaConsulta }>;

const empresaNaoEncontrada = (): never => {
  // Mesma resposta para "não existe" e "é de outro escritório": distinguir as
  // duas revelaria a existência de empresa alheia (§7, tenant divergente).
  throw new ErroDeDominio(
    CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,
    'Empresa não encontrada neste escritório.',
  );
};

@Injectable()
export class EmpresaService {
  constructor(
    private readonly pool: PoolDoBanco,
    private readonly cnpja: ConsultaDeCnpjNaCnpja,
  ) {}

  private paraVisao(id: string, cadastro: CadastroDaEmpresa): VisaoDaEmpresa {
    return {
      id,
      cadastro,
      etapasConcluidas: etapasConcluidasDaEmpresa(cadastro),
      proximaEtapa: primeiraEtapaIncompletaDaEmpresa(cadastro),
      podeAtivar: podeAtivarEmpresa(cadastro),
      exigeConfirmacaoDeSituacaoExterna: exigeConfirmacaoDeSituacaoExterna(cadastro),
    };
  }

  async listar(tenantId: string, filtro: FiltroDaLista): Promise<ListaDeEmpresas> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) =>
      listarEmpresas(cliente, tenantId, filtro),
    );
  }

  async obter(tenantId: string, empresaId: string): Promise<VisaoDaEmpresa> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      const persistida = await carregarEmpresa(cliente, tenantId, empresaId);

      if (persistida === null) {
        return empresaNaoEncontrada();
      }

      return this.paraVisao(persistida.id, persistida.cadastro);
    });
  }

  /**
   * Consulta por CNPJ (§3.3): normaliza, valida, verifica duplicidade no tenant
   * e só então fala com a fonte externa. A ordem importa — consultar a CNPJá
   * antes de checar duplicidade gastaria requisição e vazaria intenção para
   * fora por um CNPJ que já está cadastrado aqui.
   */
  async consultarCnpj(tenantId: string, cnpjInformado: string): Promise<ResultadoDaConsultaDeCnpj> {
    const cnpj = normalizarCnpj(cnpjInformado);

    const invalidos = camposInvalidosDaEtapaDaEmpresa(
      {
        status: 'CADASTRO_INCOMPLETO',
        identificacao: {
          cnpj,
          // Razão social e nome fantasia ainda não existem nesta etapa: o que
          // se valida aqui é só o CNPJ, então os demais entram preenchidos
          // para não poluir a resposta com campos que o usuário não digitou.
          razaoSocial: 'x',
          nomeFantasia: 'x',
          logoArquivoId: null,
          telefone: null,
          email: null,
        },
        dadosFiscais: null,
        enderecoPrincipal: null,
        situacaoCadastralExterna: null,
        validadoPorFonteExterna: false,
        versao: 0,
      },
      'identificacao',
    );

    if (invalidos.length > 0) {
      throw new ErroDeValidacao(invalidos);
    }

    const existente = await comContextoDeTenant(
      this.pool.instancia,
      tenantId,
      async (cliente) => empresaComCnpj(cliente, tenantId, cnpj),
    );

    if (existente !== null) {
      return { situacao: 'existente', empresaId: existente.id, status: existente.status };
    }

    const consulta = await this.cnpja.consultar(cnpj);

    return consulta.ok
      ? { situacao: 'consultado', cnpj, dados: consulta.dados }
      : { situacao: 'sem_fonte', cnpj, motivo: consulta.motivo };
  }

  /**
   * Cria a empresa como `CADASTRO_INCOMPLETO`. Duplicidade no tenant não cria
   * segunda empresa: devolve a que existe para o front abrir a retomada ou a
   * consulta (§3.4).
   */
  async criar(tenantId: string, cnpjInformado: string): Promise<VisaoDaEmpresa> {
    const cnpj = normalizarCnpj(cnpjInformado);

    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      const existente = await empresaComCnpj(cliente, tenantId, cnpj);

      if (existente !== null) {
        throw new ErroDeConflito(
          CODIGOS_DE_ERRO.CNPJ_JA_CADASTRADO_NO_TENANT,
          'Esta empresa já está cadastrada neste escritório.',
        );
      }

      const empresaId = await criarEmpresa(cliente, tenantId, cnpj);
      const criada = await carregarEmpresa(cliente, tenantId, empresaId);

      if (criada === null) {
        return empresaNaoEncontrada();
      }

      return this.paraVisao(criada.id, criada.cadastro);
    });
  }

  async salvarIdentificacao(
    tenantId: string,
    empresaId: string,
    entrada: Readonly<{
      razaoSocial: string;
      nomeFantasia: string;
      telefone: string | null;
      email: string | null;
    }>,
    procedencia: Readonly<{ situacaoCadastralExterna: string | null; validado: boolean }> = {
      situacaoCadastralExterna: null,
      validado: false,
    },
  ): Promise<VisaoDaEmpresa> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      const atual = await carregarEmpresa(cliente, tenantId, empresaId);

      if (atual === null) {
        return empresaNaoEncontrada();
      }

      const identificacao: IdentificacaoDaEmpresa = {
        // O CNPJ não é reeditável por esta rota: ele define a identidade da
        // empresa e a unicidade no tenant. Trocá-lo é criar outra empresa.
        cnpj: atual.cadastro.identificacao?.cnpj ?? '',
        razaoSocial: entrada.razaoSocial.trim(),
        nomeFantasia: entrada.nomeFantasia.trim(),
        logoArquivoId: atual.cadastro.identificacao?.logoArquivoId ?? null,
        telefone: entrada.telefone === null ? null : normalizarTelefone(entrada.telefone),
        email: entrada.email === null ? null : normalizarEmail(entrada.email),
      };

      const invalidos = camposInvalidosDaEtapaDaEmpresa(
        { ...atual.cadastro, identificacao },
        'identificacao',
      );

      if (invalidos.length > 0) {
        throw new ErroDeValidacao(invalidos);
      }

      await salvarIdentificacaoDaEmpresa(
        cliente,
        tenantId,
        empresaId,
        identificacao,
        procedencia,
      );

      return this.recarregar(cliente, tenantId, empresaId);
    });
  }

  async salvarFiscal(
    tenantId: string,
    empresaId: string,
    entrada: DadosFiscaisDaEmpresa,
  ): Promise<VisaoDaEmpresa> {
    const dadosFiscais: DadosFiscaisDaEmpresa = {
      regimeTributario: entrada.regimeTributario,
      // Enquadramento só existe dentro do Simples: fora dele é descartado aqui,
      // antes de chegar ao banco, para o CHECK não ser a única defesa.
      enquadramentoSimples:
        entrada.regimeTributario === 'SIMPLES_NACIONAL' ? entrada.enquadramentoSimples : null,
      cnaePrincipal: entrada.cnaePrincipal.trim(),
      cnaesSecundarios: [
        ...new Set(entrada.cnaesSecundarios.map((codigo) => codigo.trim()).filter(Boolean)),
      ],
      inscricaoEstadual: {
        situacao: entrada.inscricaoEstadual.situacao,
        numero:
          entrada.inscricaoEstadual.situacao === 'POSSUI'
            ? (entrada.inscricaoEstadual.numero?.trim() ?? null)
            : null,
      },
      inscricaoMunicipal: {
        situacao: entrada.inscricaoMunicipal.situacao,
        numero:
          entrada.inscricaoMunicipal.situacao === 'POSSUI'
            ? (entrada.inscricaoMunicipal.numero?.trim() ?? null)
            : null,
      },
    };

    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      const atual = await carregarEmpresa(cliente, tenantId, empresaId);

      if (atual === null) {
        return empresaNaoEncontrada();
      }

      const invalidos = camposInvalidosDaEtapaDaEmpresa(
        { ...atual.cadastro, dadosFiscais },
        'fiscal',
      );

      if (invalidos.length > 0) {
        throw new ErroDeValidacao(invalidos);
      }

      await salvarDadosFiscais(cliente, tenantId, empresaId, dadosFiscais);

      return this.recarregar(cliente, tenantId, empresaId);
    });
  }

  async salvarEndereco(
    tenantId: string,
    empresaId: string,
    entrada: EnderecoDaEmpresa,
  ): Promise<VisaoDaEmpresa> {
    const endereco: EnderecoDaEmpresa = {
      cep: normalizarCep(entrada.cep),
      logradouro: entrada.logradouro.trim(),
      numero: entrada.numero.trim(),
      complemento: entrada.complemento?.trim() ?? null,
      bairro: entrada.bairro.trim(),
      municipio: entrada.municipio.trim(),
      uf: entrada.uf.trim().toUpperCase(),
    };

    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      const atual = await carregarEmpresa(cliente, tenantId, empresaId);

      if (atual === null) {
        return empresaNaoEncontrada();
      }

      const invalidos = camposInvalidosDaEtapaDaEmpresa(
        { ...atual.cadastro, enderecoPrincipal: endereco },
        'endereco',
      );

      if (invalidos.length > 0) {
        throw new ErroDeValidacao(invalidos);
      }

      await salvarEnderecoDaEmpresa(cliente, tenantId, empresaId, endereco);

      return this.recarregar(cliente, tenantId, empresaId);
    });
  }

  /**
   * Ativa a empresa. Transacional e idempotente (§3.2): tudo acontece numa
   * transação só, e repetir a chamada não produz segundo efeito — o domínio
   * devolve o cadastro inalterado e o UPDATE tem guarda de status.
   */
  async ativar(
    tenantId: string,
    empresaId: string,
    situacaoExternaConfirmada: boolean,
  ): Promise<VisaoDaEmpresa> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      const atual = await carregarEmpresa(cliente, tenantId, empresaId);

      if (atual === null) {
        return empresaNaoEncontrada();
      }

      // Lança quando há etapa pendente ou quando falta a confirmação da
      // situação externa irregular; a transação desfaz e a empresa continua
      // `CADASTRO_INCOMPLETO`, sem estado parcial (§7).
      const ativado = ativarEmpresa(atual.cadastro, situacaoExternaConfirmada);

      if (ativado.status === 'ATIVA' && atual.cadastro.status !== 'ATIVA') {
        await marcarEmpresaComoAtiva(cliente, tenantId, empresaId);
      }

      return this.recarregar(cliente, tenantId, empresaId);
    });
  }

  private async recarregar(
    cliente: Parameters<typeof carregarEmpresa>[0],
    tenantId: string,
    empresaId: string,
  ): Promise<VisaoDaEmpresa> {
    const atualizada = await carregarEmpresa(cliente, tenantId, empresaId);

    if (atualizada === null) {
      return empresaNaoEncontrada();
    }

    return this.paraVisao(atualizada.id, atualizada.cadastro);
  }
}
