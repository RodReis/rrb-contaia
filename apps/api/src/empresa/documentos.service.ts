/**
 * Casos de uso dos documentos da empresa (SPEC-004).
 *
 * O caso de uso controla a transação e decide; o domínio valida; o repositório
 * persiste. Duas regras atravessam o arquivo inteiro:
 *
 * 1. **Ação documental e evento vivem na mesma transação** (§3.2). Se o evento
 *    não grava, a ação não vale.
 * 2. **Análise é sempre explícita** (§2.3). Nenhum caminho aqui aprova um
 *    upload, nem quando quem subiu foi o próprio administrador.
 */
import {
  CHECKLIST_PADRAO,
  CODIGOS_DE_ERRO,
  ErroDeConflito,
  ErroDeDominio,
  ErroDeValidacao,
  aprovarVersao,
  dispensarExigencia,
  estadoComVencimento,
  exigenciasDaAplicabilidade,
  registrarEnvio,
  rejeitarVersao,
  validarNomeDaExigencia,
  validarValidade,
} from '@contaia/domain';
import type { CodigoDoChecklist, EstadoDoDocumento } from '@contaia/domain';
import {
  arquivarVersaoVigente,
  carregarEmpresa,
  carregarExigencia,
  carregarVersao,
  carregarVersaoVigente,
  comContextoDeTenant,
  definirEstadoDaExigencia,
  inserirExigencia,
  inserirVersao,
  listarExigencias,
  listarHistoricoDocumental,
  listarVersoes,
  registrarEventosDocumentais,
} from '@contaia/db';
import type {
  AcaoDocumental,
  EventoDocumentalNaLista,
  ExigenciaPersistida,
  VersaoPersistida,
} from '@contaia/db';
import { mensagemDaFalha, validarArquivo } from '@contaia/shared';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { PoolDoBanco } from '../banco/pool.provider';
import { StorageService, type ArquivoRecebido } from '../comum/storage.service';

export type Autor = Readonly<{ usuarioId: string }>;

export type VersaoNaVisao = Readonly<{
  id: string;
  numero: number;
  nomeOriginal: string;
  tipoConteudo: string;
  tamanhoBytes: number;
  validade: string | null;
  vigente: boolean;
  criadoEm: string;
}>;

export type ExigenciaNaVisao = Readonly<{
  id: string;
  codigo: CodigoDoChecklist | null;
  nome: string;
  descricao: string | null;
  dataLimite: string | null;
  /** Estado já considerando o vencimento apurado na leitura (§2.4). */
  estado: EstadoDoDocumento;
  justificativa: string | null;
  aplicavel: boolean;
  versao: number;
  versoes: readonly VersaoNaVisao[];
}>;

export type VisaoDosDocumentos = Readonly<{
  empresaId: string;
  exigencias: readonly ExigenciaNaVisao[];
}>;

export type ArquivoParaEntrega = Readonly<{
  conteudo: Buffer;
  tipoConteudo: string;
  nomeOriginal: string;
}>;

const TIPO_DO_ARQUIVO = 'DOCUMENTO_DA_EMPRESA' as const;

const exigenciaNaoEncontrada = (): never => {
  throw new ErroDeDominio(
    CODIGOS_DE_ERRO.EXIGENCIA_NAO_ENCONTRADA,
    'Exigência documental não encontrada nesta empresa.',
  );
};

const conflitoDeVersao = (): never => {
  throw new ErroDeConflito(
    CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO,
    'Este documento foi analisado por outra operação. Recarregue e tente de novo.',
  );
};

const paraVersaoNaVisao = (versao: VersaoPersistida): VersaoNaVisao => ({
  id: versao.id,
  numero: versao.numero,
  nomeOriginal: versao.nomeOriginal,
  tipoConteudo: versao.tipoConteudo,
  tamanhoBytes: versao.tamanhoBytes,
  validade: versao.validade,
  vigente: versao.vigente,
  criadoEm: versao.criadoEm,
});

@Injectable()
export class DocumentosDaEmpresaService {
  constructor(
    private readonly pool: PoolDoBanco,
    private readonly storage: StorageService,
  ) {}

  /**
   * Carrega a empresa e recusa escrita quando ela está arquivada (SPEC-003
   * §3.5 continua valendo: empresa arquivada fica somente para consulta).
   */
  private async exigirEmpresaEditavel(
    cliente: PoolClient,
    tenantId: string,
    empresaId: string,
  ): Promise<void> {
    const empresa = await carregarEmpresa(cliente, tenantId, empresaId);

    if (empresa === null) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,
        'Empresa não encontrada neste escritório.',
      );
    }

    if (empresa.situacao === 'arquivado') {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA,
        'Empresa arquivada fica somente para consulta; reative-a antes de mexer nos documentos.',
      );
    }
  }

  private async exigirExigencia(
    cliente: PoolClient,
    tenantId: string,
    empresaId: string,
    exigenciaId: string,
  ): Promise<ExigenciaPersistida> {
    const exigencia = await carregarExigencia(cliente, tenantId, empresaId, exigenciaId);

    return exigencia ?? exigenciaNaoEncontrada();
  }

  /**
   * Semeia o checklist padrão na primeira abertura da aba (§2.1).
   *
   * Idempotente por construção: só cria o que falta, comparando por `codigo`.
   * O índice único no par (empresa, código) é a rede de segurança para duas
   * aberturas simultâneas.
   */
  private async semearChecklist(
    cliente: PoolClient,
    tenantId: string,
    empresaId: string,
    autor: Autor,
  ): Promise<void> {
    const empresa = await carregarEmpresa(cliente, tenantId, empresaId);

    if (empresa === null) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,
        'Empresa não encontrada neste escritório.',
      );
    }

    const existentes = await listarExigencias(cliente, tenantId, empresaId);
    const jaCriadas = new Set(
      existentes.map((exigencia) => exigencia.codigo).filter((codigo) => codigo !== null),
    );

    const calculadas = exigenciasDaAplicabilidade({
      inscricaoEstadual:
        empresa.cadastro.dadosFiscais?.inscricaoEstadual.situacao ?? 'NAO_SE_APLICA',
      inscricaoMunicipal:
        empresa.cadastro.dadosFiscais?.inscricaoMunicipal.situacao ?? 'NAO_SE_APLICA',
    });

    for (const calculada of calculadas) {
      if (jaCriadas.has(calculada.codigo)) {
        continue;
      }

      const exigenciaId = await inserirExigencia(cliente, tenantId, empresaId, {
        codigo: calculada.codigo,
        nome: calculada.nome,
        descricao: null,
        dataLimite: null,
        aplicavel: calculada.aplicavel,
      });

      await registrarEventosDocumentais(cliente, tenantId, [
        {
          empresaId,
          exigenciaId,
          versaoId: null,
          acao: 'EXIGENCIA_CRIADA',
          estadoAnterior: null,
          estadoNovo: 'PENDENTE',
          justificativa: null,
          usuarioId: autor.usuarioId,
        },
      ]);
    }
  }

  /**
   * Monta a visão da aba. O vencimento é apurado na leitura, não por rotina:
   * enquanto não existe worker (fora desta fatia), calcular aqui é o que faz o
   * estado `VENCIDO` aparecer no momento certo sem inventar infraestrutura.
   */
  private async montarVisao(
    cliente: PoolClient,
    tenantId: string,
    empresaId: string,
    agora: Date,
  ): Promise<VisaoDosDocumentos> {
    const exigencias = await listarExigencias(cliente, tenantId, empresaId);

    // Sequencial, e não `Promise.all`: o `PoolClient` é uma conexão só e
    // executa uma consulta por vez. Disparar em paralelo faz o `pg` enfileirar
    // com aviso de depreciação — e o comportamento sai no pg@9.
    const comVersoes: ExigenciaNaVisao[] = [];

    for (const exigencia of exigencias) {
      const versoes = await listarVersoes(cliente, tenantId, exigencia.id);
      const vigente = versoes.find((versao) => versao.vigente) ?? null;

      comVersoes.push({
        id: exigencia.id,
        codigo: exigencia.codigo,
        nome: exigencia.nome,
        descricao: exigencia.descricao,
        dataLimite: exigencia.dataLimite,
        estado: estadoComVencimento(exigencia.estado, vigente?.validade ?? null, agora),
        justificativa: exigencia.justificativa,
        aplicavel: exigencia.aplicavel,
        versao: exigencia.versao,
        versoes: versoes.map(paraVersaoNaVisao),
      });
    }

    return { empresaId, exigencias: comVersoes };
  }

  async consultar(
    tenantId: string,
    empresaId: string,
    autor: Autor,
    agora: Date = new Date(),
  ): Promise<VisaoDosDocumentos> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      await this.semearChecklist(cliente, tenantId, empresaId, autor);

      return this.montarVisao(cliente, tenantId, empresaId, agora);
    });
  }

  /** Exigência específica do escritório (§2.1). */
  async criarExigencia(
    tenantId: string,
    empresaId: string,
    autor: Autor,
    entrada: Readonly<{ nome: string; descricao: string | null; dataLimite: string | null }>,
    agora: Date = new Date(),
  ): Promise<VisaoDosDocumentos> {
    const campos = validarNomeDaExigencia(entrada.nome);

    if (campos.length > 0) {
      throw new ErroDeValidacao(campos);
    }

    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      await this.exigirEmpresaEditavel(cliente, tenantId, empresaId);

      const exigenciaId = await inserirExigencia(cliente, tenantId, empresaId, {
        codigo: null,
        nome: entrada.nome.trim(),
        descricao: entrada.descricao,
        dataLimite: entrada.dataLimite,
        aplicavel: true,
      });

      await registrarEventosDocumentais(cliente, tenantId, [
        {
          empresaId,
          exigenciaId,
          versaoId: null,
          acao: 'EXIGENCIA_CRIADA',
          estadoAnterior: null,
          estadoNovo: 'PENDENTE',
          justificativa: null,
          usuarioId: autor.usuarioId,
        },
      ]);

      return this.montarVisao(cliente, tenantId, empresaId, agora);
    });
  }

  /**
   * Envio e substituição (§2.3).
   *
   * O upload ao storage acontece **antes** da transação: falha ali não pode
   * deixar linha órfã no banco, e objeto sem linha é lixo inerte, não estado
   * errado. O inverso — gravar a linha e falhar no upload — deixaria a aba
   * mostrando um documento que não existe.
   */
  async enviarArquivo(
    tenantId: string,
    empresaId: string,
    exigenciaId: string,
    autor: Autor,
    arquivo: ArquivoRecebido,
    validade: string | null,
    agora: Date = new Date(),
  ): Promise<VisaoDosDocumentos> {
    const falha = validarArquivo(TIPO_DO_ARQUIVO, {
      tipoConteudo: arquivo.tipoConteudo,
      tamanhoBytes: arquivo.conteudo.byteLength,
    });

    if (falha !== null) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,
        mensagemDaFalha(TIPO_DO_ARQUIVO, falha),
        [{ campo: 'arquivo', codigo: CODIGOS_DE_ERRO.ARQUIVO_INVALIDO }],
      );
    }

    const camposDaValidade = validarValidade(validade);

    if (camposDaValidade.length > 0) {
      throw new ErroDeValidacao(camposDaValidade);
    }

    // Estado e aplicabilidade são conferidos antes de gastar o upload.
    const anterior = await comContextoDeTenant(
      this.pool.instancia,
      tenantId,
      async (cliente) => {
        await this.exigirEmpresaEditavel(cliente, tenantId, empresaId);
        const exigencia = await this.exigirExigencia(cliente, tenantId, empresaId, exigenciaId);

        if (!exigencia.aplicavel) {
          throw new ErroDeConflito(
            CODIGOS_DE_ERRO.EXIGENCIA_NAO_APLICAVEL,
            'Esta exigência não se aplica à empresa no cadastro atual.',
          );
        }

        // Valida a transição sem persistir: o domínio recusa envio em
        // exigência dispensada antes de qualquer byte subir.
        registrarEnvio(exigencia.estado);

        return exigencia;
      },
    );

    const chave = await this.storage.enviar(tenantId, TIPO_DO_ARQUIVO, arquivo);

    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      const exigencia = await this.exigirExigencia(cliente, tenantId, empresaId, exigenciaId);

      if (exigencia.versao !== anterior.versao) {
        return conflitoDeVersao();
      }

      const vigenteAnterior = await carregarVersaoVigente(cliente, tenantId, exigenciaId);
      const estadoNovo = registrarEnvio(exigencia.estado);

      // Substituição: a anterior sai de vigente e fica preservada, somente
      // leitura (§2.3).
      await arquivarVersaoVigente(cliente, tenantId, exigenciaId);

      const versao = await inserirVersao(cliente, tenantId, empresaId, {
        exigenciaId,
        chaveStorage: chave,
        nomeOriginal: arquivo.nomeOriginal,
        tipoConteudo: arquivo.tipoConteudo,
        tamanhoBytes: arquivo.conteudo.byteLength,
        validade,
        enviadoPor: autor.usuarioId,
      });

      const aplicado = await definirEstadoDaExigencia(cliente, tenantId, exigenciaId, {
        estado: estadoNovo,
        // A justificativa da rejeição anterior sai de cena quando chega
        // versão nova: ela já está preservada no histórico.
        justificativa: null,
        versaoEsperada: exigencia.versao,
      });

      if (!aplicado) {
        return conflitoDeVersao();
      }

      await registrarEventosDocumentais(cliente, tenantId, [
        {
          empresaId,
          exigenciaId,
          versaoId: versao.id,
          acao: vigenteAnterior === null ? 'ENVIO' : 'SUBSTITUICAO',
          estadoAnterior: exigencia.estado,
          estadoNovo,
          justificativa: null,
          usuarioId: autor.usuarioId,
        },
      ]);

      return this.montarVisao(cliente, tenantId, empresaId, agora);
    });
  }

  /** Aprovação, rejeição e dispensa (§2.4): a análise explícita da spec. */
  private async analisar(
    tenantId: string,
    empresaId: string,
    exigenciaId: string,
    autor: Autor,
    decidir: (estadoAtual: EstadoDoDocumento) => EstadoDoDocumento,
    acao: AcaoDocumental,
    justificativa: string | null,
    versaoEsperada: number,
    agora: Date,
  ): Promise<VisaoDosDocumentos> {
    return comContextoDeTenant(this.pool.instancia, tenantId, async (cliente) => {
      await this.exigirEmpresaEditavel(cliente, tenantId, empresaId);
      const exigencia = await this.exigirExigencia(cliente, tenantId, empresaId, exigenciaId);

      const vigente = await carregarVersaoVigente(cliente, tenantId, exigenciaId);

      // O estado analisado é o observado, com vencimento aplicado: aprovar um
      // documento já vencido seria aprovar o que a tela mostra como inválido.
      const estadoAtual = estadoComVencimento(
        exigencia.estado,
        vigente?.validade ?? null,
        agora,
      );

      if (acao !== 'DISPENSA' && vigente === null) {
        throw new ErroDeConflito(
          CODIGOS_DE_ERRO.DOCUMENTO_SEM_ARQUIVO,
          'Não há arquivo enviado para analisar nesta exigência.',
        );
      }

      const estadoNovo = decidir(estadoAtual);

      const aplicado = await definirEstadoDaExigencia(cliente, tenantId, exigenciaId, {
        estado: estadoNovo,
        justificativa,
        versaoEsperada,
      });

      if (!aplicado) {
        return conflitoDeVersao();
      }

      await registrarEventosDocumentais(cliente, tenantId, [
        {
          empresaId,
          exigenciaId,
          versaoId: vigente?.id ?? null,
          acao,
          estadoAnterior: estadoAtual,
          estadoNovo,
          justificativa,
          usuarioId: autor.usuarioId,
        },
      ]);

      return this.montarVisao(cliente, tenantId, empresaId, agora);
    });
  }

  async aprovar(
    tenantId: string,
    empresaId: string,
    exigenciaId: string,
    autor: Autor,
    versaoEsperada: number,
    agora: Date = new Date(),
  ): Promise<VisaoDosDocumentos> {
    return this.analisar(
      tenantId,
      empresaId,
      exigenciaId,
      autor,
      aprovarVersao,
      'APROVACAO',
      null,
      versaoEsperada,
      agora,
    );
  }

  async rejeitar(
    tenantId: string,
    empresaId: string,
    exigenciaId: string,
    autor: Autor,
    justificativa: string,
    versaoEsperada: number,
    agora: Date = new Date(),
  ): Promise<VisaoDosDocumentos> {
    return this.analisar(
      tenantId,
      empresaId,
      exigenciaId,
      autor,
      (estadoAtual) => rejeitarVersao(estadoAtual, justificativa),
      'REJEICAO',
      justificativa,
      versaoEsperada,
      agora,
    );
  }

  async dispensar(
    tenantId: string,
    empresaId: string,
    exigenciaId: string,
    autor: Autor,
    justificativa: string,
    versaoEsperada: number,
    agora: Date = new Date(),
  ): Promise<VisaoDosDocumentos> {
    return this.analisar(
      tenantId,
      empresaId,
      exigenciaId,
      autor,
      (estadoAtual) => dispensarExigencia(estadoAtual, justificativa),
      'DISPENSA',
      justificativa,
      versaoEsperada,
      agora,
    );
  }

  /**
   * Entrega o arquivo para visualização ou download (§2.3 e §3.2).
   *
   * O conteúdo passa pela aplicação depois de autorizar tenant e empresa, e o
   * acesso só é registrado **depois** de o storage devolver o arquivo: falha
   * de leitura não pode virar evento de acesso concluído (§4).
   */
  async obterArquivo(
    tenantId: string,
    empresaId: string,
    exigenciaId: string,
    versaoId: string,
    autor: Autor,
    acao: Extract<AcaoDocumental, 'VISUALIZACAO' | 'DOWNLOAD'>,
  ): Promise<ArquivoParaEntrega> {
    const versao = await comContextoDeTenant(
      this.pool.instancia,
      tenantId,
      async (cliente) => {
        await this.exigirExigencia(cliente, tenantId, empresaId, exigenciaId);
        const versao = await carregarVersao(cliente, tenantId, empresaId, versaoId);

        if (versao === null || versao.exigenciaId !== exigenciaId) {
          throw new ErroDeDominio(
            CODIGOS_DE_ERRO.VERSAO_NAO_ENCONTRADA,
            'Versão do documento não encontrada nesta exigência.',
          );
        }

        return versao;
      },
    );

    const arquivo = await this.storage.obter(versao.chaveStorage);

    await comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
      registrarEventosDocumentais(cliente, tenantId, [
        {
          empresaId,
          exigenciaId,
          versaoId,
          acao,
          estadoAnterior: null,
          estadoNovo: null,
          justificativa: null,
          usuarioId: autor.usuarioId,
        },
      ]),
    );

    return {
      conteudo: arquivo.conteudo,
      // O tipo gravado no banco é a fonte: o storage pode devolver
      // `application/octet-stream` e o navegador baixaria em vez de exibir.
      tipoConteudo: versao.tipoConteudo,
      nomeOriginal: versao.nomeOriginal,
    };
  }

  async consultarHistorico(
    tenantId: string,
    empresaId: string,
    paginacao: Readonly<{ limite: number; deslocamento: number }>,
  ): Promise<Readonly<{ eventos: readonly EventoDocumentalNaLista[]; total: number }>> {
    return comContextoDeTenant(this.pool.instancia, tenantId, (cliente) =>
      listarHistoricoDocumental(cliente, tenantId, empresaId, paginacao),
    );
  }
}

export const CODIGOS_DO_CHECKLIST_PADRAO: readonly CodigoDoChecklist[] = CHECKLIST_PADRAO.map(
  (item) => item.codigo,
);
