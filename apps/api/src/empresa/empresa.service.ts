/**
 * Casos de uso do cadastro da empresa cliente (SPEC-002).
 *
 * O caso de uso controla a transação e decide; o domínio valida; o repositório
 * persiste; o adaptador fala com a fonte externa. Nenhuma regra no controller.
 */
import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  CODIGOS_DE_ERRO,
  ErroDeConflito,
  ErroDeDominio,
  ErroDeValidacao,
  ativarEmpresa,
  camposInvalidosDaEtapaDaEmpresa,
  dataCivilEmSaoPaulo,
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
  SituacaoDeRegistro,
  StatusDaEmpresa,
} from '@contaia/domain';
import {
  carregarEmpresa,
  comContextoHumano,
  comEmpresaEmCriacao,
  comFinalidade,
  criarEmpresa,
  empresaComCnpj,
  listarEmpresas,
  marcarEmpresaComoAtiva,
  reconciliarCofre,
  salvarDadosFiscais,
  salvarEnderecoDaEmpresa,
  salvarIdentificacaoDaEmpresa,
} from '@contaia/db';
import type { EmpresaNaLista, FiltroDaLista } from '@contaia/db';
import type { DadosPublicosDoCnpj, MotivoDeFalhaDaConsulta } from '@contaia/shared';

import { PoolDoBanco } from '../banco/pool.provider';
import { autoatribuirCriador } from '../carteira/registro';
import { reconciliarPendenciaDoPlano } from '../plano-contas/pendencia-do-plano';
import { ConsultaDeCnpjNaCnpja } from './cnpja.adapter';

/** Quem cria a empresa; `autoatribuir` é verdade só para o `admin_escritorio` (SPEC-009 §3.1). */
export type CriadorDaEmpresa = Readonly<{ usuarioId: string; autoatribuir: boolean }>;

export type VisaoDaEmpresa = Readonly<{
  id: string;
  cadastro: CadastroDaEmpresa;
  /**
   * Situação do registro (SPEC-003 §3.5). A tela precisa dela para abrir a
   * empresa arquivada em modo de consulta em vez de oferecer edição que o
   * servidor vai recusar.
   */
  situacao: SituacaoDeRegistro;
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

  paraVisao(
    id: string,
    cadastro: CadastroDaEmpresa,
    situacao: SituacaoDeRegistro = 'ativo',
  ): VisaoDaEmpresa {
    return {
      id,
      cadastro,
      situacao,
      etapasConcluidas: etapasConcluidasDaEmpresa(cadastro),
      proximaEtapa: primeiraEtapaIncompletaDaEmpresa(cadastro),
      podeAtivar: podeAtivarEmpresa(cadastro),
      exigeConfirmacaoDeSituacaoExterna: exigeConfirmacaoDeSituacaoExterna(cadastro),
    };
  }

  async listar(
    tenantId: string,
    usuarioId: string,
    filtro: FiltroDaLista,
  ): Promise<ListaDeEmpresas> {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId }, async (cliente) =>
      listarEmpresas(cliente, tenantId, filtro),
    );
  }

  async obter(tenantId: string, usuarioId: string, empresaId: string): Promise<VisaoDaEmpresa> {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId }, async (cliente) => {
      const persistida = await carregarEmpresa(cliente, tenantId, empresaId);

      if (persistida === null) {
        return empresaNaoEncontrada();
      }

      return this.paraVisao(persistida.id, persistida.cadastro, persistida.situacao);
    });
  }

  /**
   * Consulta por CNPJ (§3.3): normaliza, valida, verifica duplicidade no tenant
   * e só então fala com a fonte externa. A ordem importa — consultar a CNPJá
   * antes de checar duplicidade gastaria requisição e vazaria intenção para
   * fora por um CNPJ que já está cadastrado aqui.
   */
  async consultarCnpj(
    tenantId: string,
    usuarioId: string,
    cnpjInformado: string,
  ): Promise<ResultadoDaConsultaDeCnpj> {
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

    // A duplicidade é do escritório, não da carteira: a leitura é só do cadastro básico.
    const existente = await comContextoHumano(
      this.pool.instancia,
      { tenantId, usuarioId, finalidade: 'LOCALIZACAO_BASICA_EMPRESA' },
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
   *
   * O pré-preenchimento (§3.3) parte de uma consulta feita aqui, no servidor, e
   * não de dados reenviados pelo cliente: o que o navegador manda de volta é
   * entrada externa e não pode ser gravada como se viesse da fonte oficial.
   * Falha da consulta não impede criar — só entra sem dado e sem validação.
   */
  async criar(
    tenantId: string,
    cnpjInformado: string,
    criador: CriadorDaEmpresa,
  ): Promise<VisaoDaEmpresa> {
    const cnpj = normalizarCnpj(cnpjInformado);
    const consulta = await this.cnpja.consultar(cnpj);

    return comContextoHumano(
      this.pool.instancia,
      { tenantId, usuarioId: criador.usuarioId },
      async (cliente) => {
        // A duplicidade é do escritório, não da carteira (SPEC-010 §3.3).
        const existente = await comFinalidade(cliente, 'LOCALIZACAO_BASICA_EMPRESA', () =>
          empresaComCnpj(cliente, tenantId, cnpj),
        );

        if (existente !== null) {
          throw new ErroDeConflito(
            CODIGOS_DE_ERRO.CNPJ_JA_CADASTRADO_NO_TENANT,
            'Esta empresa já está cadastrada neste escritório.',
          );
        }

        // Empresa nova ainda não tem vínculo: só a gestão de acesso a cria.
        const empresaId = await comFinalidade(cliente, 'ADMIN_ACESSO', () =>
          criarEmpresa(cliente, tenantId, cnpj),
        );

        // Daqui até o fim, o criador escreve só nesta empresa, mesmo sem vínculo
        // (papéis que não são autoatribuídos): a RLS reconhece a empresa em criação.
        return comEmpresaEmCriacao(cliente, empresaId, async () => {
          if (consulta.ok) {
            await this.preencherComFonteExterna(cliente, tenantId, empresaId, consulta.dados);
          }

          // O `admin_escritorio` criador entra na própria carteira já na criação, e não
          // só na ativação: as etapas do wizard rodam antes dela e passam pela alçada
          // (SPEC-009 §3.1). Os demais papéis não são autoatribuídos.
          if (criador.autoatribuir) {
            await comFinalidade(cliente, 'ADMIN_ACESSO', () =>
              autoatribuirCriador(cliente, tenantId, criador.usuarioId, empresaId),
            );
          }

          const criada = await carregarEmpresa(cliente, tenantId, empresaId);

          if (criada === null) {
            return empresaNaoEncontrada();
          }

          return this.paraVisao(criada.id, criada.cadastro, criada.situacao);
        });
      },
    );
  }

  /**
   * Grava os campos previstos pela SPEC §3.3 — e somente eles. Os valores
   * seguem editáveis: o que chega aqui é sugestão da fonte, não verdade final.
   *
   * O regime tributário fica de fora de propósito: a fonte diz se a empresa
   * optou pelo Simples, mas não dizer nada não significa Presumido nem Real —
   * essa escolha é humana (§12, "Nunca fazer"). Só o enquadramento no Simples
   * é derivável, e apenas quando a fonte afirma a opção.
   */
  private async preencherComFonteExterna(
    cliente: Parameters<typeof carregarEmpresa>[0],
    tenantId: string,
    empresaId: string,
    dados: DadosPublicosDoCnpj,
  ): Promise<void> {
    await salvarIdentificacaoDaEmpresa(
      cliente,
      tenantId,
      empresaId,
      {
        cnpj: dados.cnpj,
        razaoSocial: dados.razaoSocial ?? '',
        nomeFantasia: dados.nomeFantasia ?? dados.razaoSocial ?? '',
        logoArquivoId: null,
        telefone: dados.telefone,
        email: dados.email,
      },
      { situacaoCadastralExterna: dados.situacaoCadastral, validado: true },
    );

    if (dados.cnaePrincipal !== null) {
      await salvarDadosFiscais(cliente, tenantId, empresaId, {
        // `null` mantém a etapa fiscal pendente até a escolha humana do regime.
        regimeTributario: dados.optanteSimples === true ? 'SIMPLES_NACIONAL' : null,
        enquadramentoSimples:
          dados.optanteSimples === true && dados.mei !== null
            ? dados.mei
              ? 'MEI'
              : 'NAO_MEI'
            : null,
        cnaePrincipal: dados.cnaePrincipal,
        cnaesSecundarios: dados.cnaesSecundarios,
        inscricaoEstadual: { situacao: 'NAO_SE_APLICA', numero: null },
        inscricaoMunicipal: { situacao: 'NAO_SE_APLICA', numero: null },
      });
    }

    const { endereco } = dados;

    // Endereço só entra completo: meio endereço gravado faria a etapa parecer
    // preenchida e esconderia o que falta.
    if (
      endereco.cep !== null &&
      endereco.logradouro !== null &&
      endereco.numero !== null &&
      endereco.bairro !== null &&
      endereco.municipio !== null &&
      endereco.uf !== null
    ) {
      await salvarEnderecoDaEmpresa(cliente, tenantId, empresaId, {
        cep: endereco.cep,
        logradouro: endereco.logradouro,
        numero: endereco.numero,
        complemento: endereco.complemento,
        bairro: endereco.bairro,
        municipio: endereco.municipio,
        uf: endereco.uf,
      });
    }
  }

  async salvarIdentificacao(
    tenantId: string,
    usuarioId: string,
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
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId }, async (cliente) => {
      const atual = await carregarEmpresa(cliente, tenantId, empresaId);

      if (atual === null) {
        return empresaNaoEncontrada();
      }

      // Empresa arquivada é só consulta: o administrador a alcança sem vínculo para reativá-la
      // (SPEC-009), e isso não pode virar porta de edição pelas rotas do cadastro.
      if (atual.situacao === 'arquivado') {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA,
          'Empresa arquivada fica somente para consulta; reative-a antes de editar.',
        );
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
    usuarioId: string,
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

    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId }, async (cliente) => {
      const atual = await carregarEmpresa(cliente, tenantId, empresaId);

      if (atual === null) {
        return empresaNaoEncontrada();
      }

      // Empresa arquivada é só consulta: o administrador a alcança sem vínculo para reativá-la
      // (SPEC-009), e isso não pode virar porta de edição pelas rotas do cadastro.
      if (atual.situacao === 'arquivado') {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA,
          'Empresa arquivada fica somente para consulta; reative-a antes de editar.',
        );
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
    usuarioId: string,
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

    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId }, async (cliente) => {
      const atual = await carregarEmpresa(cliente, tenantId, empresaId);

      if (atual === null) {
        return empresaNaoEncontrada();
      }

      // Empresa arquivada é só consulta: o administrador a alcança sem vínculo para reativá-la
      // (SPEC-009), e isso não pode virar porta de edição pelas rotas do cadastro.
      if (atual.situacao === 'arquivado') {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA,
          'Empresa arquivada fica somente para consulta; reative-a antes de editar.',
        );
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
    usuarioId: string,
    empresaId: string,
    situacaoExternaConfirmada: boolean,
  ): Promise<VisaoDaEmpresa> {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId }, async (cliente) => {
      const atual = await carregarEmpresa(cliente, tenantId, empresaId);

      if (atual === null) {
        return empresaNaoEncontrada();
      }

      // Empresa arquivada é só consulta: o administrador a alcança sem vínculo para reativá-la
      // (SPEC-009), e isso não pode virar porta de edição pelas rotas do cadastro.
      if (atual.situacao === 'arquivado') {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA,
          'Empresa arquivada fica somente para consulta; reative-a antes de editar.',
        );
      }

      // Lança quando há etapa pendente ou quando falta a confirmação da
      // situação externa irregular; a transação desfaz e a empresa continua
      // `CADASTRO_INCOMPLETO`, sem estado parcial (§7).
      const ativado = ativarEmpresa(atual.cadastro, situacaoExternaConfirmada);

      if (ativado.status === 'ATIVA' && atual.cadastro.status !== 'ATIVA') {
        await marcarEmpresaComoAtiva(cliente, tenantId, empresaId);
        // Empresa ativa nasce sem certificado: abre a pendência de certificado ausente (SPEC-011 §3.4).
        await reconciliarCofre(cliente, {
          tenantId,
          usuarioId,
          correlationId: randomUUID(),
          hoje: dataCivilEmSaoPaulo(new Date()),
          empresaIds: [empresaId],
        });
        // Empresa ativa sem conta válida abre a pendência do plano de contas (SPEC-013 §3.10):
        // sem isso, quem é ativada depois da migration 0015 nunca a receberia.
        await reconciliarPendenciaDoPlano(cliente, { tenantId, empresaId, usuarioId, agora: new Date() });
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

    return this.paraVisao(atualizada.id, atualizada.cadastro, atualizada.situacao);
  }
}
