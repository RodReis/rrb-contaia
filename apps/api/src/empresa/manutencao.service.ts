/**
 * Casos de uso da manutenção da empresa já ativada (SPEC-003).
 *
 * O caso de uso controla a transação e decide; o domínio valida; o repositório
 * persiste. A regra que atravessa este arquivo inteiro: **alteração e evento
 * histórico vivem na mesma transação** (§4.2). Se o evento não grava, a
 * alteração não vale.
 */
import {
  CODIGOS_DE_ERRO,
  ErroDeConflito,
  ErroDeDominio,
  ErroDeValidacao,
  abaDoCampo,
  arquivarEmpresa,
  camposAlteradosNaIdentificacao,
  camposAlteradosNosDadosFiscais,
  camposInvalidosDaEtapaDaEmpresa,
  diferencasDaFonteExterna,
  normalizarCep,
  normalizarEmail,
  normalizarTelefone,
  planejarTrocaDeFinalidadeFiscal,
  reativarEmpresa,
  validarEnderecoComFinalidade,
  validarJustificativa,
  validarVigencia,
} from '@contaia/domain';
import type {
  AbaDoHistorico,
  CampoAlterado,
  DadosFiscaisDaEmpresa,
  DiferencaExterna,
  EnderecoComFinalidade,
  FinalidadeDeEndereco,
  IdentificacaoDaEmpresa,
} from '@contaia/domain';
import {
  aplicarTrocaDeFinalidade,
  arquivarEndereco,
  definirAplicabilidade,
  atualizarEndereco,
  camposComHistorico,
  carregarEmpresa,
  carregarEndereco,
  comContextoDeTenant,
  definirSituacaoDaEmpresa,
  inserirEndereco,
  listarEnderecosDaEmpresa,
  listarHistorico,
  registrarEventos,
  salvarDadosFiscais,
  salvarIdentificacaoDaEmpresa,
} from '@contaia/db';
import type {
  EnderecoDaEmpresaPersistido,
  EventoParaRegistrar,
  FiltroDoHistorico,
  PaginaDoHistorico,
} from '@contaia/db';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { PoolDoBanco } from '../banco/pool.provider';
import { ConsultaDeCnpjNaCnpja } from './cnpja.adapter';
import { EmpresaService, type VisaoDaEmpresa } from './empresa.service';

export type Autor = Readonly<{ usuarioId: string }>;

export type ComparacaoComAFonte = Readonly<{
  situacao: 'comparado' | 'sem_fonte' | 'sem_diferencas';
  diferencas: readonly DiferencaExterna[];
  /** Situação cadastral externa: alerta, nunca bloqueio (§3.3). */
  situacaoCadastralExterna: string | null;
  alertaDeSituacaoExterna: boolean;
  motivo: string | null;
}>;

/**
 * Conflito de edição concorrente (SPEC-003 §5 e §7): a linha mudou entre a
 * leitura e a gravação. A alternativa — gravar assim mesmo — é a sobrescrita
 * silenciosa que a spec proíbe, e ainda registraria no histórico um
 * `valorAnterior` que já não era verdade.
 */
const conflitoDeVersao = (): never => {
  throw new ErroDeConflito(
    CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO,
    'Estes dados foram alterados por outra operação. Recarregue e tente de novo.',
  );
};

const empresaNaoEncontrada = (): never => {
  throw new ErroDeDominio(
    CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,
    'Empresa não encontrada neste escritório.',
  );
};

@Injectable()
export class ManutencaoDaEmpresaService {
  constructor(
    private readonly pool: PoolDoBanco,
    private readonly cnpja: ConsultaDeCnpjNaCnpja,
    private readonly empresas: EmpresaService,
  ) {}

  /**
   * Carrega a empresa e recusa a edição quando ela está arquivada (§3.5).
   * Toda rota de escrita desta fatia passa por aqui.
   */
  private async exigirEmpresaEditavel(
    cliente: PoolClient,
    tenantId: string,
    empresaId: string,
  ) {
    const persistida = await carregarEmpresa(cliente, tenantId, empresaId);

    if (persistida === null) {
      return empresaNaoEncontrada();
    }

    if (persistida.situacao === 'arquivado') {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA,
        'Empresa arquivada fica somente para consulta; reative-a antes de editar.',
      );
    }

    return persistida;
  }

  private async registrar(
    cliente: PoolClient,
    tenantId: string,
    empresaId: string,
    autor: Autor,
    alterados: readonly CampoAlterado[],
    complemento: Readonly<{ vigencia?: string | null; aba?: AbaDoHistorico }> = {},
  ): Promise<void> {
    const eventos: readonly EventoParaRegistrar[] = alterados.map((alterado) => ({
      empresaId,
      aba: complemento.aba ?? abaDoCampo(alterado.campo),
      acao: 'ALTERACAO',
      campo: alterado.campo,
      valorAnterior: alterado.valorAnterior,
      valorNovo: alterado.valorNovo,
      vigencia: complemento.vigencia ?? null,
      justificativa: null,
      usuarioId: autor.usuarioId,
    }));

    await registrarEventos(cliente, tenantId, eventos);
  }

  // -- Identificação ---------------------------------------------------------

  async salvarIdentificacao(
    tenantId: string,
    empresaId: string,
    autor: Autor,
    entrada: Readonly<{
      cnpj?: string | undefined;
      razaoSocial: string;
      nomeFantasia: string;
      telefone: string | null;
      email: string | null;
    }>,
  ): Promise<VisaoDaEmpresa> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      const atual = await this.exigirEmpresaEditavel(cliente, tenantId, empresaId);
      const anterior = atual.cadastro.identificacao;

      if (anterior === null) {
        return empresaNaoEncontrada();
      }

      // O CNPJ é imutável depois da ativação: tentativa explícita de trocá-lo é
      // rejeitada com código próprio, em vez de ignorada em silêncio (§3.2).
      if (entrada.cnpj !== undefined && entrada.cnpj !== anterior.cnpj) {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.CNPJ_IMUTAVEL,
          'O CNPJ não pode ser alterado depois da ativação da empresa.',
          [{ campo: 'cnpj', codigo: CODIGOS_DE_ERRO.CNPJ_IMUTAVEL }],
        );
      }

      const identificacao: IdentificacaoDaEmpresa = {
        cnpj: anterior.cnpj,
        razaoSocial: entrada.razaoSocial.trim(),
        nomeFantasia: entrada.nomeFantasia.trim(),
        logoArquivoId: anterior.logoArquivoId,
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

      // Escrita direta no repositório, e não pelo EmpresaService: aquele método
      // abre a própria transação, e o dado cairia numa transação diferente da
      // do evento — exatamente o que §4.2 proíbe.
      const gravou = await salvarIdentificacaoDaEmpresa(
        cliente,
        tenantId,
        empresaId,
        identificacao,
        { situacaoCadastralExterna: null, validado: false },
        atual.cadastro.versao,
      );

      if (!gravou) {
        return conflitoDeVersao();
      }

      await this.registrar(
        cliente,
        tenantId,
        empresaId,
        autor,
        camposAlteradosNaIdentificacao(anterior, identificacao),
      );

      return this.recarregar(cliente, tenantId, empresaId);
    });
  }

  /** Recarrega dentro da transação corrente, sem abrir outra. */
  private async recarregar(
    cliente: PoolClient,
    tenantId: string,
    empresaId: string,
  ): Promise<VisaoDaEmpresa> {
    const persistida = await carregarEmpresa(cliente, tenantId, empresaId);

    if (persistida === null) {
      return empresaNaoEncontrada();
    }

    return this.empresas.paraVisao(persistida.id, persistida.cadastro, persistida.situacao);
  }

  // -- Dados fiscais ---------------------------------------------------------

  async salvarFiscal(
    tenantId: string,
    empresaId: string,
    autor: Autor,
    entrada: DadosFiscaisDaEmpresa,
    vigencia: string,
    agora: Date,
  ): Promise<VisaoDaEmpresa> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      const atual = await this.exigirEmpresaEditavel(cliente, tenantId, empresaId);
      const anterior = atual.cadastro.dadosFiscais;

      const mudouRegimeOuCnae =
        anterior === null ||
        anterior.regimeTributario !== entrada.regimeTributario ||
        anterior.cnaePrincipal !== entrada.cnaePrincipal ||
        anterior.cnaesSecundarios.join(',') !== entrada.cnaesSecundarios.join(',');

      // Vigência só é exigida quando regime ou CNAE mudam: editar uma inscrição
      // estadual não é um fato com data de efeito (§3.2).
      if (mudouRegimeOuCnae) {
        const invalidos = validarVigencia(vigencia, agora);
        const primeiro = invalidos[0];

        // Erro de domínio com o código específico, e não `ErroDeValidacao`: a
        // interface precisa distinguir "vigência futura" de "vigência ausente"
        // para dar a mensagem certa, e `ErroDeValidacao` achata os dois em
        // `CAMPO_OBRIGATORIO` no topo do problem+json (§7).
        if (primeiro !== undefined) {
          throw new ErroDeDominio(
            primeiro.codigo,
            'A vigência informada não é aceita: use uma data passada ou a data de hoje.',
            invalidos,
          );
        }
      }

      const gravou = await salvarDadosFiscais(
        cliente,
        tenantId,
        empresaId,
        entrada,
        atual.cadastro.versao,
      );

      if (!gravou) {
        return conflitoDeVersao();
      }

      const alterados = [
        ...camposAlteradosNosDadosFiscais(
          {
            regimeTributario: anterior?.regimeTributario ?? null,
            enquadramentoSimples: anterior?.enquadramentoSimples ?? null,
            cnaePrincipal: anterior?.cnaePrincipal ?? null,
          },
          {
            regimeTributario: entrada.regimeTributario,
            enquadramentoSimples: entrada.enquadramentoSimples,
            cnaePrincipal: entrada.cnaePrincipal,
          },
        ),
        ...this.alteracaoDosSecundarios(anterior?.cnaesSecundarios ?? [], entrada.cnaesSecundarios),
      ];

      await this.registrar(cliente, tenantId, empresaId, autor, alterados, {
        vigencia: mudouRegimeOuCnae ? vigencia : null,
        aba: 'DADOS_FISCAIS',
      });

      // Reconciliação da aplicabilidade documental (SPEC-004 §2.2): mudar a
      // situação da inscrição aqui muda o que a aba Documentos cobra. Na mesma
      // transação do salvamento — se o fiscal grava e a reconciliação não, a
      // aba passa a cobrar documento que o cadastro já não justifica.
      //
      // Marca como inaplicável em vez de apagar: a exigência e as versões já
      // enviadas continuam, fora do checklist ativo.
      await definirAplicabilidade(
        cliente,
        tenantId,
        empresaId,
        'INSCRICAO_ESTADUAL',
        entrada.inscricaoEstadual.situacao !== 'NAO_SE_APLICA',
      );
      await definirAplicabilidade(
        cliente,
        tenantId,
        empresaId,
        'INSCRICAO_MUNICIPAL',
        entrada.inscricaoMunicipal.situacao !== 'NAO_SE_APLICA',
      );

      return this.recarregar(cliente, tenantId, empresaId);
    });
  }

  private alteracaoDosSecundarios(
    anterior: readonly string[],
    novo: readonly string[],
  ): readonly CampoAlterado[] {
    const antes = [...anterior].sort().join(', ');
    const depois = [...novo].sort().join(', ');

    return antes === depois
      ? []
      : [
          {
            campo: 'cnaesSecundarios',
            valorAnterior: antes === '' ? null : antes,
            valorNovo: depois === '' ? null : depois,
          },
        ];
  }

  // -- Endereços -------------------------------------------------------------

  async listarEnderecos(
    tenantId: string,
    empresaId: string,
  ): Promise<readonly EnderecoDaEmpresaPersistido[]> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      const persistida = await carregarEmpresa(cliente, tenantId, empresaId);

      if (persistida === null) {
        return empresaNaoEncontrada();
      }

      return listarEnderecosDaEmpresa(cliente, tenantId, empresaId);
    });
  }

  async criarEndereco(
    tenantId: string,
    empresaId: string,
    autor: Autor,
    entrada: EnderecoComFinalidade,
  ): Promise<readonly EnderecoDaEmpresaPersistido[]> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      await this.exigirEmpresaEditavel(cliente, tenantId, empresaId);

      const endereco = this.normalizarEndereco(entrada);
      const invalidos = validarEnderecoComFinalidade(endereco);

      if (invalidos.length > 0) {
        throw new ErroDeValidacao(invalidos);
      }

      const ativos = await listarEnderecosDaEmpresa(cliente, tenantId, empresaId);

      if (ativos.some((item) => item.finalidade === endereco.finalidade)) {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.FINALIDADE_DUPLICADA,
          'Já existe um endereço ativo com essa finalidade.',
          [{ campo: 'finalidade', codigo: CODIGOS_DE_ERRO.FINALIDADE_DUPLICADA }],
        );
      }

      await inserirEndereco(cliente, tenantId, empresaId, endereco);

      await registrarEventos(cliente, tenantId, [
        {
          empresaId,
          aba: 'ENDERECOS',
          acao: 'INCLUSAO',
          campo: `enderecos.${endereco.finalidade}`,
          valorAnterior: null,
          valorNovo: this.descreverEndereco(endereco),
          vigencia: null,
          justificativa: null,
          usuarioId: autor.usuarioId,
        },
      ]);

      return listarEnderecosDaEmpresa(cliente, tenantId, empresaId);
    });
  }

  async atualizarEndereco(
    tenantId: string,
    empresaId: string,
    enderecoId: string,
    autor: Autor,
    entrada: EnderecoComFinalidade,
    versaoEsperada: number,
  ): Promise<readonly EnderecoDaEmpresaPersistido[]> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      await this.exigirEmpresaEditavel(cliente, tenantId, empresaId);

      const anterior = await carregarEndereco(cliente, tenantId, empresaId, enderecoId);

      if (anterior === null) {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.ENDERECO_NAO_ENCONTRADO,
          'Endereço não encontrado nesta empresa.',
        );
      }

      const endereco = this.normalizarEndereco(entrada);
      const invalidos = validarEnderecoComFinalidade(endereco);

      if (invalidos.length > 0) {
        throw new ErroDeValidacao(invalidos);
      }

      // A finalidade não muda por esta rota: trocar o Fiscal é uma operação
      // própria, porque exige destino para o endereço que perde a finalidade.
      if (endereco.finalidade !== anterior.finalidade) {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.FINALIDADE_INVALIDA,
          'Use a troca de finalidade Fiscal para mudar a finalidade de um endereço.',
          [{ campo: 'finalidade', codigo: CODIGOS_DE_ERRO.FINALIDADE_INVALIDA }],
        );
      }

      // A versão vem do endereço que a tela carregou; divergir dela significa
      // que outra pessoa salvou no intervalo.
      const gravou = await atualizarEndereco(
        cliente,
        tenantId,
        empresaId,
        enderecoId,
        endereco,
        versaoEsperada,
      );

      if (!gravou) {
        return conflitoDeVersao();
      }

      const antes = this.descreverEndereco(anterior);
      const depois = this.descreverEndereco(endereco);

      if (antes !== depois) {
        await registrarEventos(cliente, tenantId, [
          {
            empresaId,
            aba: 'ENDERECOS',
            acao: 'ALTERACAO',
            campo: `enderecos.${endereco.finalidade}`,
            valorAnterior: antes,
            valorNovo: depois,
            vigencia: null,
            justificativa: null,
            usuarioId: autor.usuarioId,
          },
        ]);
      }

      return listarEnderecosDaEmpresa(cliente, tenantId, empresaId);
    });
  }

  /**
   * Transfere a finalidade Fiscal (§3.4). O endereço Fiscal anterior precisa
   * receber uma finalidade disponível na mesma operação — as duas pontas são
   * salvas juntas, nunca metade.
   */
  async trocarEnderecoFiscal(
    tenantId: string,
    empresaId: string,
    autor: Autor,
    entrada: Readonly<{ novoFiscalId: string; finalidadeDoAnterior: FinalidadeDeEndereco }>,
  ): Promise<readonly EnderecoDaEmpresaPersistido[]> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      await this.exigirEmpresaEditavel(cliente, tenantId, empresaId);

      const ativos = await listarEnderecosDaEmpresa(cliente, tenantId, empresaId);

      const atribuicoes = planejarTrocaDeFinalidadeFiscal({
        enderecosAtivos: ativos.map((item) => ({
          id: item.id,
          finalidade: item.finalidade,
        })),
        novoFiscalId: entrada.novoFiscalId,
        finalidadeDoAnterior: entrada.finalidadeDoAnterior,
      });

      if (atribuicoes.length === 0) {
        return ativos;
      }

      await aplicarTrocaDeFinalidade(cliente, tenantId, empresaId, atribuicoes);

      await registrarEventos(
        cliente,
        tenantId,
        atribuicoes.map((atribuicao) => {
          const anterior = ativos.find((item) => item.id === atribuicao.id);

          return {
            empresaId,
            aba: 'ENDERECOS' as const,
            acao: 'ALTERACAO' as const,
            campo: `enderecos.finalidade`,
            valorAnterior: anterior?.finalidade ?? null,
            valorNovo: atribuicao.finalidade,
            vigencia: null,
            justificativa: null,
            usuarioId: autor.usuarioId,
          };
        }),
      );

      return listarEnderecosDaEmpresa(cliente, tenantId, empresaId);
    });
  }

  async arquivarEndereco(
    tenantId: string,
    empresaId: string,
    enderecoId: string,
    autor: Autor,
  ): Promise<readonly EnderecoDaEmpresaPersistido[]> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      await this.exigirEmpresaEditavel(cliente, tenantId, empresaId);

      const alvo = await carregarEndereco(cliente, tenantId, empresaId, enderecoId);

      if (alvo === null) {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.ENDERECO_NAO_ENCONTRADO,
          'Endereço não encontrado nesta empresa.',
        );
      }

      // O Fiscal é o endereço padrão da empresa ativa: arquivá-lo sem eleger um
      // substituto deixaria a empresa sem padrão (§3.4).
      if (alvo.finalidade === 'FISCAL') {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.ENDERECO_FISCAL_OBRIGATORIO,
          'Transfira a finalidade Fiscal para outro endereço antes de arquivar este.',
        );
      }

      await arquivarEndereco(cliente, tenantId, empresaId, enderecoId);

      await registrarEventos(cliente, tenantId, [
        {
          empresaId,
          aba: 'ENDERECOS',
          acao: 'ARQUIVAMENTO',
          campo: `enderecos.${alvo.finalidade}`,
          valorAnterior: this.descreverEndereco(alvo),
          valorNovo: null,
          vigencia: null,
          justificativa: null,
          usuarioId: autor.usuarioId,
        },
      ]);

      return listarEnderecosDaEmpresa(cliente, tenantId, empresaId);
    });
  }

  private normalizarEndereco(entrada: EnderecoComFinalidade): EnderecoComFinalidade {
    const descricao = entrada.descricao === null ? null : entrada.descricao.trim();

    return {
      ...entrada,
      cep: normalizarCep(entrada.cep),
      logradouro: entrada.logradouro.trim(),
      numero: entrada.numero.trim(),
      complemento: entrada.complemento === null ? null : entrada.complemento.trim(),
      bairro: entrada.bairro.trim(),
      municipio: entrada.municipio.trim(),
      uf: entrada.uf.trim().toUpperCase(),
      // Descrição só existe em `OUTRO`; nas demais o banco exige `null`.
      descricao:
        entrada.finalidade === 'OUTRO' ? descricao : null,
    };
  }

  /** Texto estável do endereço, para o valor anterior/novo do histórico. */
  private descreverEndereco(
    endereco: EnderecoComFinalidade | EnderecoDaEmpresaPersistido,
  ): string {
    const complemento = endereco.complemento === null ? '' : `, ${endereco.complemento}`;

    return `${endereco.logradouro}, ${endereco.numero}${complemento} — ${endereco.bairro}, ${endereco.municipio}/${endereco.uf}, CEP ${endereco.cep}`;
  }

  // -- Arquivamento da empresa -----------------------------------------------

  async arquivar(
    tenantId: string,
    empresaId: string,
    autor: Autor,
    justificativa: string,
  ): Promise<VisaoDaEmpresa> {
    return this.mudarSituacao(tenantId, empresaId, autor, justificativa, 'ARQUIVAMENTO');
  }

  async reativar(
    tenantId: string,
    empresaId: string,
    autor: Autor,
    justificativa: string,
  ): Promise<VisaoDaEmpresa> {
    return this.mudarSituacao(tenantId, empresaId, autor, justificativa, 'REATIVACAO');
  }

  private async mudarSituacao(
    tenantId: string,
    empresaId: string,
    autor: Autor,
    justificativa: string,
    acao: 'ARQUIVAMENTO' | 'REATIVACAO',
  ): Promise<VisaoDaEmpresa> {
    await comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      const persistida = await carregarEmpresa(cliente, tenantId, empresaId);

      if (persistida === null) {
        return empresaNaoEncontrada();
      }

      const invalidos = validarJustificativa(justificativa);

      // Código próprio em vez de `ErroDeValidacao`: o diálogo de arquivamento
      // tem um campo só, e `CAMPO_OBRIGATORIO` no topo não diz qual regra
      // falhou. O domínio também recusa — esta é a recusa antecipada, para a
      // mensagem chegar certa à interface.
      if (invalidos.length > 0) {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.JUSTIFICATIVA_OBRIGATORIA,
          'Arquivamento e reativação exigem justificativa.',
          invalidos,
        );
      }

      const nova =
        acao === 'ARQUIVAMENTO'
          ? arquivarEmpresa(persistida.situacao, justificativa)
          : reativarEmpresa(persistida.situacao, justificativa);

      await definirSituacaoDaEmpresa(cliente, tenantId, empresaId, nova);

      await registrarEventos(cliente, tenantId, [
        {
          empresaId,
          aba: 'STATUS_DA_EMPRESA',
          acao,
          campo: 'situacao',
          valorAnterior: persistida.situacao,
          valorNovo: nova,
          vigencia: null,
          justificativa: justificativa.trim(),
          usuarioId: autor.usuarioId,
        },
      ]);

      return nova;
    });

    return this.empresas.obter(tenantId, empresaId);
  }

  // -- Atualização pela CNPJá ------------------------------------------------

  /**
   * Consulta a fonte externa e devolve as diferenças **sem aplicar nenhuma**
   * (§3.3). A aplicação é outra rota, e é campo a campo.
   */
  async compararComAFonte(tenantId: string, empresaId: string): Promise<ComparacaoComAFonte> {
    const persistida = await comContextoDeTenant(
      this.pool.instancia,
      tenantId,
      async (cliente) => carregarEmpresa(cliente, tenantId, empresaId),
    );

    if (persistida === null) {
      return empresaNaoEncontrada();
    }

    const identificacao = persistida.cadastro.identificacao;

    if (identificacao === null) {
      return empresaNaoEncontrada();
    }

    const resultado = await this.cnpja.consultar(identificacao.cnpj);

    // Falha externa não apaga dado nem bloqueia a edição manual (§3.3).
    if (!resultado.ok) {
      return {
        situacao: 'sem_fonte',
        diferencas: [],
        situacaoCadastralExterna: persistida.cadastro.situacaoCadastralExterna,
        alertaDeSituacaoExterna: false,
        motivo: resultado.motivo,
      };
    }

    const { dados } = resultado;

    const diferencas = diferencasDaFonteExterna(
      {
        razaoSocial: identificacao.razaoSocial,
        nomeFantasia: identificacao.nomeFantasia,
        telefone: identificacao.telefone,
        email: identificacao.email,
        cnaePrincipal: persistida.cadastro.dadosFiscais?.cnaePrincipal ?? null,
      },
      {
        razaoSocial: dados.razaoSocial,
        nomeFantasia: dados.nomeFantasia,
        telefone: dados.telefone,
        email: dados.email,
        cnaePrincipal: dados.cnaePrincipal,
      },
    );

    const situacaoExterna = dados.situacaoCadastral;

    return {
      situacao: diferencas.length === 0 ? 'sem_diferencas' : 'comparado',
      diferencas,
      situacaoCadastralExterna: situacaoExterna,
      // Situação diferente de Ativa só alerta: nunca arquiva nem bloqueia (§3.3).
      alertaDeSituacaoExterna:
        situacaoExterna !== null && situacaoExterna.trim().toLowerCase() !== 'ativa',
      motivo: null,
    };
  }

  /**
   * Aplica as diferenças que o usuário escolheu, uma a uma (§3.3). Campo fora
   * da lista comparável é ignorado: a seleção vem do navegador e é dado
   * externo como qualquer outro.
   */
  async aplicarDaFonte(
    tenantId: string,
    empresaId: string,
    autor: Autor,
    campos: readonly string[],
  ): Promise<VisaoDaEmpresa> {
    const comparacao = await this.compararComAFonte(tenantId, empresaId);
    const escolhidas = comparacao.diferencas.filter((diferenca) =>
      campos.includes(diferenca.campo),
    );

    if (escolhidas.length === 0) {
      return this.empresas.obter(tenantId, empresaId);
    }

    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      const atual = await this.exigirEmpresaEditavel(cliente, tenantId, empresaId);
      const identificacao = atual.cadastro.identificacao;

      if (identificacao === null) {
        return empresaNaoEncontrada();
      }

      const valorDe = (campo: string): string | null =>
        escolhidas.find((diferenca) => diferenca.campo === campo)?.valorExterno ?? null;

      const tocaIdentificacao = escolhidas.some((diferenca) =>
        ['razaoSocial', 'nomeFantasia', 'telefone', 'email'].includes(diferenca.campo),
      );

      if (tocaIdentificacao) {
        const nova: IdentificacaoDaEmpresa = {
          ...identificacao,
          razaoSocial: valorDe('razaoSocial') ?? identificacao.razaoSocial,
          nomeFantasia: valorDe('nomeFantasia') ?? identificacao.nomeFantasia,
          telefone: valorDe('telefone') ?? identificacao.telefone,
          email: valorDe('email') ?? identificacao.email,
        };

        await salvarIdentificacaoDaEmpresa(cliente, tenantId, empresaId, nova, {
          situacaoCadastralExterna: comparacao.situacaoCadastralExterna,
          validado: true,
        });
      }

      const cnaeNovo = valorDe('cnaePrincipal');
      const fiscaisAtuais = atual.cadastro.dadosFiscais;

      if (cnaeNovo !== null && fiscaisAtuais !== null) {
        await salvarDadosFiscais(cliente, tenantId, empresaId, {
          ...fiscaisAtuais,
          cnaePrincipal: cnaeNovo,
        });
      }

      await registrarEventos(
        cliente,
        tenantId,
        escolhidas.map((diferenca) => ({
          empresaId,
          aba: abaDoCampo(diferenca.campo),
          acao: 'ALTERACAO' as const,
          campo: diferenca.campo,
          valorAnterior: diferenca.valorAtual,
          valorNovo: diferenca.valorExterno,
          vigencia: null,
          justificativa: null,
          usuarioId: autor.usuarioId,
        })),
      );

      return this.recarregar(cliente, tenantId, empresaId);
    });
  }

  // -- Histórico -------------------------------------------------------------

  async consultarHistorico(
    tenantId: string,
    filtro: FiltroDoHistorico,
  ): Promise<PaginaDoHistorico> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) =>
      listarHistorico(cliente, tenantId, filtro),
    );
  }

  async camposDoHistorico(
    tenantId: string,
    aba: AbaDoHistorico | null,
  ): Promise<readonly string[]> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) =>
      camposComHistorico(cliente, tenantId, aba),
    );
  }
}
