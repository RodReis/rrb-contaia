/**
 * Repositório do cadastro do escritório. Recebe o cliente da transação aberta
 * pelo caso de uso — não abre transação própria nem decide regra.
 */
import type { PoolClient } from 'pg';

import type {
  CadastroDoEscritorio,
  EnderecoDoEscritorio,
  IdentificacaoDoEscritorio,
  ResponsavelTecnico,
  StatusDoTenant,
} from '@contaia/domain';

type LinhaDoTenant = {
  status: StatusDoTenant;
  cnpj: string | null;
  razao_social: string | null;
  logo_arquivo_id: string | null;
  responsavel_nome: string | null;
  responsavel_cpf: string | null;
  responsavel_crc: string | null;
  responsavel_email: string | null;
  responsavel_telefone: string | null;
  versao: number;
};

type LinhaDoEndereco = {
  id: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  municipio: string;
  uf: string;
  principal: boolean;
};

export type ArquivoDoEscritorio = Readonly<{
  id: string;
  tipo: 'LOGO' | 'DOCUMENTO';
  nomeOriginal: string;
  tipoConteudo: string;
  tamanhoBytes: number;
  chaveStorage: string;
}>;

export type EnderecoPersistido = EnderecoDoEscritorio &
  Readonly<{ id: string; principal: boolean }>;

const paraIdentificacao = (linha: LinhaDoTenant): IdentificacaoDoEscritorio | null =>
  linha.cnpj === null && linha.razao_social === null && linha.logo_arquivo_id === null
    ? null
    : {
        cnpj: linha.cnpj ?? '',
        razaoSocial: linha.razao_social ?? '',
        logoArquivoId: linha.logo_arquivo_id,
      };

const paraResponsavel = (linha: LinhaDoTenant): ResponsavelTecnico | null =>
  linha.responsavel_nome === null && linha.responsavel_cpf === null
    ? null
    : {
        nomeCompleto: linha.responsavel_nome ?? '',
        cpf: linha.responsavel_cpf ?? '',
        crc: linha.responsavel_crc ?? '',
        email: linha.responsavel_email ?? '',
        telefone: linha.responsavel_telefone ?? '',
      };

const paraEndereco = (linha: LinhaDoEndereco): EnderecoPersistido => ({
  id: linha.id,
  principal: linha.principal,
  cep: linha.cep,
  logradouro: linha.logradouro,
  numero: linha.numero,
  complemento: linha.complemento,
  bairro: linha.bairro,
  municipio: linha.municipio,
  uf: linha.uf,
});

export const listarEnderecos = async (
  cliente: PoolClient,
  tenantId: string,
): Promise<readonly EnderecoPersistido[]> => {
  const { rows } = await cliente.query<LinhaDoEndereco>(
    `select id, cep, logradouro, numero, complemento, bairro, municipio, uf, principal
       from app.escritorio_endereco
      where tenant_id = $1 and situacao = 'ativo'
      order by principal desc, criado_em`,
    [tenantId],
  );

  return rows.map(paraEndereco);
};

export const carregarCadastro = async (
  cliente: PoolClient,
  tenantId: string,
): Promise<CadastroDoEscritorio | null> => {
  const { rows } = await cliente.query<LinhaDoTenant>(
    `select status, cnpj, razao_social, logo_arquivo_id, responsavel_nome, responsavel_cpf,
            responsavel_crc, responsavel_email, responsavel_telefone, versao
       from app.tenant where id = $1`,
    [tenantId],
  );

  const linha = rows[0];

  if (linha === undefined) {
    return null;
  }

  const enderecos = await listarEnderecos(cliente, tenantId);
  const documentos = await cliente.query<{ id: string }>(
    `select id from app.escritorio_arquivo
      where tenant_id = $1 and tipo = 'DOCUMENTO' and situacao = 'ativo'
      order by criado_em`,
    [tenantId],
  );

  return {
    status: linha.status,
    identificacao: paraIdentificacao(linha),
    responsavel: paraResponsavel(linha),
    enderecoPrincipal: enderecos.find((endereco) => endereco.principal) ?? null,
    documentosArquivoIds: documentos.rows.map((documento) => documento.id),
    versao: linha.versao,
  };
};

export const salvarIdentificacao = async (
  cliente: PoolClient,
  tenantId: string,
  identificacao: IdentificacaoDoEscritorio,
): Promise<void> => {
  await cliente.query(
    `update app.tenant
        set cnpj = $2, razao_social = $3, logo_arquivo_id = coalesce($4, logo_arquivo_id),
            atualizado_em = now(), versao = versao + 1
      where id = $1`,
    [tenantId, identificacao.cnpj, identificacao.razaoSocial, identificacao.logoArquivoId],
  );
};

/**
 * Aponta o logo sem tocar nos demais campos da identificação.
 *
 * Reescrever a identificação inteira aqui gravaria CNPJ vazio quando o logo é
 * enviado antes de a etapa 1 ser salva, o que viola o CHECK da coluna.
 */
export const definirLogo = async (
  cliente: PoolClient,
  tenantId: string,
  arquivoId: string,
): Promise<void> => {
  await cliente.query(
    `update app.tenant
        set logo_arquivo_id = $2, atualizado_em = now(), versao = versao + 1
      where id = $1`,
    [tenantId, arquivoId],
  );
};

export const salvarResponsavel = async (
  cliente: PoolClient,
  tenantId: string,
  responsavel: ResponsavelTecnico,
): Promise<void> => {
  await cliente.query(
    `update app.tenant
        set responsavel_nome = $2, responsavel_cpf = $3, responsavel_crc = $4,
            responsavel_email = $5, responsavel_telefone = $6,
            atualizado_em = now(), versao = versao + 1
      where id = $1`,
    [
      tenantId,
      responsavel.nomeCompleto,
      responsavel.cpf,
      responsavel.crc,
      responsavel.email,
      responsavel.telefone,
    ],
  );
};

/** Grava o endereço principal, substituindo o anterior — há exatamente um. */
export const salvarEnderecoPrincipal = async (
  cliente: PoolClient,
  tenantId: string,
  endereco: EnderecoDoEscritorio,
): Promise<string> => {
  const { rows } = await cliente.query<{ id: string }>(
    `select id from app.escritorio_endereco
      where tenant_id = $1 and principal and situacao = 'ativo'`,
    [tenantId],
  );

  const existente = rows[0];

  if (existente !== undefined) {
    await cliente.query(
      `update app.escritorio_endereco
          set cep = $2, logradouro = $3, numero = $4, complemento = $5, bairro = $6,
              municipio = $7, uf = $8, atualizado_em = now(), versao = versao + 1
        where id = $1`,
      [
        existente.id,
        endereco.cep,
        endereco.logradouro,
        endereco.numero,
        endereco.complemento,
        endereco.bairro,
        endereco.municipio,
        endereco.uf,
      ],
    );

    return existente.id;
  }

  const inserido = await cliente.query<{ id: string }>(
    `insert into app.escritorio_endereco
       (tenant_id, principal, cep, logradouro, numero, complemento, bairro, municipio, uf)
     values ($1, true, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      tenantId,
      endereco.cep,
      endereco.logradouro,
      endereco.numero,
      endereco.complemento,
      endereco.bairro,
      endereco.municipio,
      endereco.uf,
    ],
  );

  return inserido.rows[0]?.id ?? '';
};

export const registrarArquivo = async (
  cliente: PoolClient,
  tenantId: string,
  arquivo: Omit<ArquivoDoEscritorio, 'id'>,
): Promise<string> => {
  const { rows } = await cliente.query<{ id: string }>(
    `insert into app.escritorio_arquivo
       (tenant_id, tipo, chave_storage, nome_original, tipo_conteudo, tamanho_bytes)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      tenantId,
      arquivo.tipo,
      arquivo.chaveStorage,
      arquivo.nomeOriginal,
      arquivo.tipoConteudo,
      arquivo.tamanhoBytes,
    ],
  );

  return rows[0]?.id ?? '';
};

export const listarArquivos = async (
  cliente: PoolClient,
  tenantId: string,
): Promise<readonly ArquivoDoEscritorio[]> => {
  const { rows } = await cliente.query<{
    id: string;
    tipo: 'LOGO' | 'DOCUMENTO';
    nome_original: string;
    tipo_conteudo: string;
    tamanho_bytes: string;
    chave_storage: string;
  }>(
    `select id, tipo, nome_original, tipo_conteudo, tamanho_bytes, chave_storage
       from app.escritorio_arquivo
      where tenant_id = $1 and situacao = 'ativo'
      order by criado_em`,
    [tenantId],
  );

  return rows.map((linha) => ({
    id: linha.id,
    tipo: linha.tipo,
    nomeOriginal: linha.nome_original,
    tipoConteudo: linha.tipo_conteudo,
    tamanhoBytes: Number(linha.tamanho_bytes),
    chaveStorage: linha.chave_storage,
  }));
};

/** Arquiva em vez de apagar (I-7). */
export const arquivarArquivo = async (
  cliente: PoolClient,
  tenantId: string,
  arquivoId: string,
): Promise<void> => {
  await cliente.query(
    `update app.escritorio_arquivo
        set situacao = 'arquivado', atualizado_em = now(), versao = versao + 1
      where id = $1 and tenant_id = $2`,
    [arquivoId, tenantId],
  );
};

/**
 * Ativa o tenant. A condição `status = 'CADASTRO_INCOMPLETO'` é o que torna a
 * conclusão idempotente no banco: a segunda chamada não altera linha alguma.
 */
export const marcarComoAtivo = async (cliente: PoolClient, tenantId: string): Promise<void> => {
  await cliente.query(
    `update app.tenant
        set status = 'ATIVO', atualizado_em = now(), versao = versao + 1
      where id = $1 and status = 'CADASTRO_INCOMPLETO'`,
    [tenantId],
  );
};

/**
 * Unicidade global do CNPJ (SPEC-001 §4.2). A RLS esconde o tenant alheio, de
 * modo que a checagem precisa rodar por uma função dedicada — que devolve
 * apenas um booleano, sem revelar de quem é o CNPJ.
 */
export const cnpjEmUsoPorOutroTenant = async (
  cliente: PoolClient,
  cnpj: string,
  tenantId: string,
): Promise<boolean> => {
  const { rows } = await cliente.query<{ existe: boolean }>(
    'select app.cnpj_de_escritorio_em_uso($1, $2) as existe',
    [cnpj, tenantId],
  );

  return rows[0]?.existe ?? false;
};
