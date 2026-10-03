/**
 * Casos de uso do cadastro do escritório (SPEC-001).
 *
 * O caso de uso controla a transação e decide; o domínio valida; o repositório
 * persiste. Nenhuma regra mora no controller.
 */
import { Injectable } from '@nestjs/common';

import {
  CODIGOS_DE_ERRO,
  ErroDeConflito,
  ErroDeDominio,
  ErroDeValidacao,
  ativarCadastro,
  camposInvalidosDaEtapa,
  etapasConcluidas,
  normalizarCep,
  normalizarCnpj,
  normalizarCpf,
  normalizarEmail,
  normalizarTelefone,
  primeiraEtapaIncompleta,
} from '@contaia/domain';
import type {
  CadastroDoEscritorio,
  EnderecoDoEscritorio,
  EtapaDoCadastro,
  IdentificacaoDoEscritorio,
  ResponsavelTecnico,
} from '@contaia/domain';
import {
  arquivarArquivo,
  carregarCadastro,
  cnpjEmUsoPorOutroTenant,
  comContextoHumano,
  definirLogo,
  listarArquivos,
  listarEnderecos,
  marcarComoAtivo,
  registrarArquivo,
  salvarEnderecoPrincipal,
  salvarIdentificacao,
  salvarResponsavel,
} from '@contaia/db';
import type { ArquivoDoEscritorio, EnderecoPersistido } from '@contaia/db';
import { mensagemDaFalha, validarArquivo } from '@contaia/shared';
import type { TipoDeArquivoDoEscritorio } from '@contaia/shared';

import { PoolDoBanco } from '../banco/pool.provider';
import { StorageService, type ArquivoRecebido } from '../comum/storage.service';

export type VisaoDoCadastro = Readonly<{
  tenantId: string;
  cadastro: CadastroDoEscritorio;
  etapasConcluidas: readonly EtapaDoCadastro[];
  proximaEtapa: EtapaDoCadastro | null;
  enderecos: readonly EnderecoPersistido[];
  arquivos: readonly ArquivoDoEscritorio[];
}>;

const semTenant = (): never => {
  throw new ErroDeDominio(
    CODIGOS_DE_ERRO.TENANT_NAO_ENCONTRADO,
    'Escritório não encontrado para a sessão atual.',
  );
};

/** Cadastro do escritório é tabela de tenant: basta contexto humano válido (finalidade comum). */
const comum = (tenantId: string, usuarioId: string) =>
  ({ tenantId, usuarioId, finalidade: 'COMUM' }) as const;

@Injectable()
export class EscritorioService {
  constructor(
    private readonly pool: PoolDoBanco,
    private readonly storage: StorageService,
  ) {}

  async obterVisao(tenantId: string, usuarioId: string): Promise<VisaoDoCadastro> {
    return comContextoHumano(this.pool.instancia, comum(tenantId, usuarioId), async (cliente) => {
      const cadastro = await carregarCadastro(cliente, tenantId);

      if (cadastro === null) {
        return semTenant();
      }

      return {
        tenantId,
        cadastro,
        etapasConcluidas: etapasConcluidas(cadastro),
        proximaEtapa: primeiraEtapaIncompleta(cadastro),
        enderecos: await listarEnderecos(cliente, tenantId),
        arquivos: await listarArquivos(cliente, tenantId),
      };
    });
  }

  async salvarEtapaIdentificacao(
    tenantId: string,
    usuarioId: string,
    entrada: Readonly<{ cnpj: string; razaoSocial: string }>,
  ): Promise<VisaoDoCadastro> {
    const cnpj = normalizarCnpj(entrada.cnpj);

    return comContextoHumano(this.pool.instancia, comum(tenantId, usuarioId), async (cliente) => {
      const atual = await carregarCadastro(cliente, tenantId);

      if (atual === null) {
        return semTenant();
      }

      const identificacao: IdentificacaoDoEscritorio = {
        cnpj,
        razaoSocial: entrada.razaoSocial.trim(),
        logoArquivoId: atual.identificacao?.logoArquivoId ?? null,
      };

      // O logo é etapa da mesma tela, mas é enviado por rota própria: a falta
      // dele não impede salvar os campos digitados, só impede concluir a etapa.
      const invalidos = camposInvalidosDaEtapa(
        { ...atual, identificacao },
        'identificacao',
      ).filter((campo) => campo.codigo !== CODIGOS_DE_ERRO.LOGO_OBRIGATORIO);

      if (invalidos.length > 0) {
        throw new ErroDeValidacao(invalidos);
      }

      if (await cnpjEmUsoPorOutroTenant(cliente, cnpj, tenantId)) {
        throw new ErroDeConflito(
          CODIGOS_DE_ERRO.CNPJ_JA_UTILIZADO,
          'Este CNPJ já está em uso por outro escritório.',
        );
      }

      await salvarIdentificacao(cliente, tenantId, identificacao);

      return this.recarregar(cliente, tenantId);
    });
  }

  async salvarEtapaResponsavel(
    tenantId: string,
    usuarioId: string,
    entrada: ResponsavelTecnico,
  ): Promise<VisaoDoCadastro> {
    const responsavel: ResponsavelTecnico = {
      nomeCompleto: entrada.nomeCompleto.trim(),
      cpf: normalizarCpf(entrada.cpf),
      crc: entrada.crc.trim(),
      email: normalizarEmail(entrada.email),
      telefone: normalizarTelefone(entrada.telefone),
    };

    return comContextoHumano(this.pool.instancia, comum(tenantId, usuarioId), async (cliente) => {
      const atual = await carregarCadastro(cliente, tenantId);

      if (atual === null) {
        return semTenant();
      }

      const invalidos = camposInvalidosDaEtapa({ ...atual, responsavel }, 'responsavel');

      if (invalidos.length > 0) {
        throw new ErroDeValidacao(invalidos);
      }

      await salvarResponsavel(cliente, tenantId, responsavel);

      return this.recarregar(cliente, tenantId);
    });
  }

  async salvarEtapaEndereco(
    tenantId: string,
    usuarioId: string,
    entrada: EnderecoDoEscritorio,
  ): Promise<VisaoDoCadastro> {
    const endereco: EnderecoDoEscritorio = {
      cep: normalizarCep(entrada.cep),
      logradouro: entrada.logradouro.trim(),
      numero: entrada.numero.trim(),
      complemento: entrada.complemento?.trim() ?? null,
      bairro: entrada.bairro.trim(),
      municipio: entrada.municipio.trim(),
      uf: entrada.uf.trim().toUpperCase(),
    };

    return comContextoHumano(this.pool.instancia, comum(tenantId, usuarioId), async (cliente) => {
      const atual = await carregarCadastro(cliente, tenantId);

      if (atual === null) {
        return semTenant();
      }

      const invalidos = camposInvalidosDaEtapa(
        { ...atual, enderecoPrincipal: endereco },
        'endereco',
      );

      if (invalidos.length > 0) {
        throw new ErroDeValidacao(invalidos);
      }

      await salvarEnderecoPrincipal(cliente, tenantId, endereco);

      return this.recarregar(cliente, tenantId);
    });
  }

  /** Persiste o arquivo primeiro; só conta como enviado depois disso. */
  async enviarArquivo(
    tenantId: string,
    usuarioId: string,
    tipo: TipoDeArquivoDoEscritorio,
    arquivo: ArquivoRecebido,
  ): Promise<VisaoDoCadastro> {
    const falha = validarArquivo(tipo, {
      tipoConteudo: arquivo.tipoConteudo,
      tamanhoBytes: arquivo.conteudo.byteLength,
    });

    if (falha !== null) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, mensagemDaFalha(tipo, falha), [
        { campo: tipo === 'LOGO' ? 'logo' : 'documentos', codigo: CODIGOS_DE_ERRO.ARQUIVO_INVALIDO },
      ]);
    }

    // O envio ao storage acontece fora da transação: falha ali não pode deixar
    // linha órfã no banco, e objeto sem linha é lixo inerte, não estado errado.
    const chave = await this.storage.enviar(tenantId, tipo, arquivo);

    return comContextoHumano(this.pool.instancia, comum(tenantId, usuarioId), async (cliente) => {
      const atual = await carregarCadastro(cliente, tenantId);

      if (atual === null) {
        return semTenant();
      }

      const arquivoId = await registrarArquivo(cliente, tenantId, {
        tipo,
        chaveStorage: chave,
        nomeOriginal: arquivo.nomeOriginal,
        tipoConteudo: arquivo.tipoConteudo,
        tamanhoBytes: arquivo.conteudo.byteLength,
      });

      if (tipo === 'LOGO') {
        const anterior = atual.identificacao?.logoArquivoId ?? null;

        await definirLogo(cliente, tenantId, arquivoId);

        // O escritório nunca fica sem logo: o anterior só é arquivado depois
        // que o novo já está apontado (SPEC-001 §3.3).
        if (anterior !== null) {
          await arquivarArquivo(cliente, tenantId, anterior);
        }
      }

      return this.recarregar(cliente, tenantId);
    });
  }

  async arquivarDocumento(
    tenantId: string,
    usuarioId: string,
    arquivoId: string,
  ): Promise<VisaoDoCadastro> {
    return comContextoHumano(this.pool.instancia, comum(tenantId, usuarioId), async (cliente) => {
      const atual = await carregarCadastro(cliente, tenantId);

      if (atual === null) {
        return semTenant();
      }

      const arquivos = await listarArquivos(cliente, tenantId);
      const alvo = arquivos.find((arquivo) => arquivo.id === arquivoId);

      if (alvo === undefined) {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,
          'Arquivo não encontrado neste escritório.',
        );
      }

      if (alvo.tipo === 'LOGO') {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.LOGO_OBRIGATORIO,
          'O logo não pode ser removido; envie outro para substituí-lo.',
        );
      }

      // Escritório ativo nunca fica sem documento (SPEC-001 §3.3).
      const documentosRestantes = arquivos.filter(
        (arquivo) => arquivo.tipo === 'DOCUMENTO' && arquivo.id !== arquivoId,
      );

      if (atual.status === 'ATIVO' && documentosRestantes.length === 0) {
        throw new ErroDeDominio(
          CODIGOS_DE_ERRO.DOCUMENTO_OBRIGATORIO,
          'O escritório precisa de ao menos um documento; envie outro antes de remover este.',
        );
      }

      await arquivarArquivo(cliente, tenantId, arquivoId);

      return this.recarregar(cliente, tenantId);
    });
  }

  /**
   * Conclui o cadastro. Transacional e idempotente: concluir de novo devolve o
   * mesmo estado, sem duplicar dado nem arquivo (SPEC-001 §6).
   */
  async concluir(tenantId: string, usuarioId: string): Promise<VisaoDoCadastro> {
    return comContextoHumano(this.pool.instancia, comum(tenantId, usuarioId), async (cliente) => {
      const atual = await carregarCadastro(cliente, tenantId);

      if (atual === null) {
        return semTenant();
      }

      // `ativarCadastro` lança quando há etapa incompleta e devolve o próprio
      // cadastro quando já está ativo — a segunda chamada não escreve nada.
      const ativado = ativarCadastro(atual);

      if (atual.status !== ativado.status) {
        await marcarComoAtivo(cliente, tenantId);
      }

      return this.recarregar(cliente, tenantId);
    });
  }

  private async recarregar(
    cliente: Parameters<typeof carregarCadastro>[0],
    tenantId: string,
  ): Promise<VisaoDoCadastro> {
    const cadastro = await carregarCadastro(cliente, tenantId);

    if (cadastro === null) {
      return semTenant();
    }

    return {
      tenantId,
      cadastro,
      etapasConcluidas: etapasConcluidas(cadastro),
      proximaEtapa: primeiraEtapaIncompleta(cadastro),
      enderecos: await listarEnderecos(cliente, tenantId),
      arquivos: await listarArquivos(cliente, tenantId),
    };
  }
}
