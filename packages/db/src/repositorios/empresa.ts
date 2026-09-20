/**
 * Repositório da empresa cliente (SPEC-002). Recebe o cliente da transação
 * aberta pelo caso de uso — não abre transação própria nem decide regra.
 *
 * Toda consulta filtra por `tenant_id` explicitamente, além da RLS: a política
 * é a rede de segurança, não a autorização. Se a RLS caísse por erro de
 * configuração, o filtro no SQL ainda impediria ler empresa de outro tenant.
 */
import type { PoolClient } from 'pg';

import type {
  CadastroDaEmpresa,
  DadosFiscaisDaEmpresa,
  EnderecoDaEmpresa,
  EnquadramentoSimples,
  IdentificacaoDaEmpresa,
  RegimeTributario,
  SituacaoDeInscricao,
  StatusDaEmpresa,
} from '@contaia/domain';

type LinhaDaEmpresa = {
  id: string;
  status: StatusDaEmpresa;
  cnpj: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  logo_arquivo_id: string | null;
  telefone: string | null;
  email: string | null;
  regime_tributario: RegimeTributario | null;
  enquadramento_simples: EnquadramentoSimples | null;
  cnae_principal: string | null;
  inscricao_estadual_situacao: SituacaoDeInscricao | null;
  inscricao_estadual_numero: string | null;
  inscricao_municipal_situacao: SituacaoDeInscricao | null;
  inscricao_municipal_numero: string | null;
  situacao_cadastral_externa: string | null;
  validado_por_fonte_externa: boolean;
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
};

/** Linha da listagem: só o que a tabela mostra, sem carregar o cadastro inteiro. */
export type EmpresaNaLista = Readonly<{
  id: string;
  cnpj: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  regimeTributario: RegimeTributario | null;
  status: StatusDaEmpresa;
}>;

export type EmpresaPersistida = Readonly<{
  id: string;
  cadastro: CadastroDaEmpresa;
}>;

export type FiltroDaLista = Readonly<{
  busca: string | null;
  status: StatusDaEmpresa | null;
  limite: number;
  deslocamento: number;
}>;

export type PaginaDeEmpresas = Readonly<{
  empresas: readonly EmpresaNaLista[];
  total: number;
}>;

const COLUNAS = `id, status, cnpj, razao_social, nome_fantasia, logo_arquivo_id, telefone, email,
       regime_tributario, enquadramento_simples, cnae_principal,
       inscricao_estadual_situacao, inscricao_estadual_numero,
       inscricao_municipal_situacao, inscricao_municipal_numero,
       situacao_cadastral_externa, validado_por_fonte_externa, versao`;

const paraIdentificacao = (linha: LinhaDaEmpresa): IdentificacaoDaEmpresa => ({
  cnpj: linha.cnpj,
  razaoSocial: linha.razao_social ?? '',
  nomeFantasia: linha.nome_fantasia ?? '',
  logoArquivoId: linha.logo_arquivo_id,
  telefone: linha.telefone,
  email: linha.email,
});

const paraDadosFiscais = (
  linha: LinhaDaEmpresa,
  cnaesSecundarios: readonly string[],
): DadosFiscaisDaEmpresa | null =>
  // A etapa fiscal nunca foi salva enquanto não há regime nem CNAE: devolver um
  // objeto vazio aqui faria a validação acusar campo inválido em vez de etapa
  // ainda não preenchida, e o wizard abriria na etapa errada.
  linha.regime_tributario === null && linha.cnae_principal === null
    ? null
    : {
        regimeTributario: linha.regime_tributario,
        enquadramentoSimples: linha.enquadramento_simples,
        cnaePrincipal: linha.cnae_principal ?? '',
        cnaesSecundarios,
        inscricaoEstadual: {
          situacao: linha.inscricao_estadual_situacao ?? 'NAO_SE_APLICA',
          numero: linha.inscricao_estadual_numero,
        },
        inscricaoMunicipal: {
          situacao: linha.inscricao_municipal_situacao ?? 'NAO_SE_APLICA',
          numero: linha.inscricao_municipal_numero,
        },
      };

const paraEndereco = (linha: LinhaDoEndereco): EnderecoDaEmpresa => ({
  cep: linha.cep,
  logradouro: linha.logradouro,
  numero: linha.numero,
  complemento: linha.complemento,
  bairro: linha.bairro,
  municipio: linha.municipio,
  uf: linha.uf,
});

/**
 * Responde se o CNPJ já existe neste tenant, devolvendo id e status para o
 * caso de uso decidir entre retomar o cadastro e abrir em consulta (§3.4).
 *
 * Diferente do escritório, aqui não é preciso `SECURITY DEFINER`: a duplicata
 * procurada é do próprio tenant, então a RLS já permite enxergá-la. CNPJ igual
 * em outro tenant permanece invisível — que é exatamente o exigido por §4.5.
 */
export const empresaComCnpj = async (
  cliente: PoolClient,
  tenantId: string,
  cnpj: string,
): Promise<Readonly<{ id: string; status: StatusDaEmpresa }> | null> => {
  const { rows } = await cliente.query<{ id: string; status: StatusDaEmpresa }>(
    `select id, status from app.empresa
      where tenant_id = $1 and cnpj = $2 and situacao = 'ativo'`,
    [tenantId, cnpj],
  );

  return rows[0] ?? null;
};

export const listarEmpresas = async (
  cliente: PoolClient,
  tenantId: string,
  filtro: FiltroDaLista,
): Promise<PaginaDeEmpresas> => {
  // `busca` entra como parâmetro e nunca por concatenação; `%` e `_` do usuário
  // são escapados para não virar curinga e retornar a base inteira.
  const termo =
    filtro.busca === null
      ? null
      : `%${filtro.busca.trim().replace(/[\\%_]/gu, (achado) => `\\${achado}`)}%`;

  const condicoes = `tenant_id = $1 and situacao = 'ativo'
      and ($2::text is null or (
        razao_social ilike $2 or nome_fantasia ilike $2 or cnpj like upper($2)
      ))
      and ($3::text is null or status = $3)`;

  const { rows } = await cliente.query<LinhaDaEmpresa>(
    `select ${COLUNAS} from app.empresa
      where ${condicoes}
      order by coalesce(nome_fantasia, razao_social, cnpj)
      limit $4 offset $5`,
    [tenantId, termo, filtro.status, filtro.limite, filtro.deslocamento],
  );

  const contagem = await cliente.query<{ total: string }>(
    `select count(*)::text as total from app.empresa where ${condicoes}`,
    [tenantId, termo, filtro.status],
  );

  return {
    empresas: rows.map((linha) => ({
      id: linha.id,
      cnpj: linha.cnpj,
      razaoSocial: linha.razao_social,
      nomeFantasia: linha.nome_fantasia,
      regimeTributario: linha.regime_tributario,
      status: linha.status,
    })),
    total: Number(contagem.rows[0]?.total ?? '0'),
  };
};

export const criarEmpresa = async (
  cliente: PoolClient,
  tenantId: string,
  cnpj: string,
): Promise<string> => {
  const { rows } = await cliente.query<{ id: string }>(
    `insert into app.empresa (tenant_id, cnpj) values ($1, $2) returning id`,
    [tenantId, cnpj],
  );

  const id = rows[0]?.id;

  if (id === undefined) {
    throw new Error('insert de empresa não devolveu id');
  }

  return id;
};

export const carregarEmpresa = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
): Promise<EmpresaPersistida | null> => {
  const { rows } = await cliente.query<LinhaDaEmpresa>(
    `select ${COLUNAS} from app.empresa
      where tenant_id = $1 and id = $2 and situacao = 'ativo'`,
    [tenantId, empresaId],
  );

  const linha = rows[0];

  if (linha === undefined) {
    return null;
  }

  const secundarios = await cliente.query<{ codigo: string }>(
    `select codigo from app.empresa_cnae_secundario
      where tenant_id = $1 and empresa_id = $2 and situacao = 'ativo'
      order by codigo`,
    [tenantId, empresaId],
  );

  const enderecos = await cliente.query<LinhaDoEndereco>(
    `select id, cep, logradouro, numero, complemento, bairro, municipio, uf
       from app.empresa_endereco
      where tenant_id = $1 and empresa_id = $2 and principal and situacao = 'ativo'`,
    [tenantId, empresaId],
  );

  const enderecoPrincipal = enderecos.rows[0];

  return {
    id: linha.id,
    cadastro: {
      status: linha.status,
      identificacao: paraIdentificacao(linha),
      dadosFiscais: paraDadosFiscais(
        linha,
        secundarios.rows.map((secundario) => secundario.codigo),
      ),
      enderecoPrincipal:
        enderecoPrincipal === undefined ? null : paraEndereco(enderecoPrincipal),
      situacaoCadastralExterna: linha.situacao_cadastral_externa,
      validadoPorFonteExterna: linha.validado_por_fonte_externa,
      versao: linha.versao,
    },
  };
};

export const salvarIdentificacaoDaEmpresa = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  identificacao: IdentificacaoDaEmpresa,
  procedencia: Readonly<{ situacaoCadastralExterna: string | null; validado: boolean }>,
): Promise<void> => {
  await cliente.query(
    `update app.empresa
        set razao_social = $3, nome_fantasia = $4, telefone = $5, email = $6,
            logo_arquivo_id = coalesce($7, logo_arquivo_id),
            situacao_cadastral_externa = coalesce($8, situacao_cadastral_externa),
            validado_por_fonte_externa = validado_por_fonte_externa or $9,
            atualizado_em = now(), versao = versao + 1
      where tenant_id = $1 and id = $2`,
    [
      tenantId,
      empresaId,
      identificacao.razaoSocial,
      identificacao.nomeFantasia,
      identificacao.telefone,
      identificacao.email,
      identificacao.logoArquivoId,
      procedencia.situacaoCadastralExterna,
      procedencia.validado,
    ],
  );
};

export const salvarDadosFiscais = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  dados: DadosFiscaisDaEmpresa,
): Promise<void> => {
  await cliente.query(
    `update app.empresa
        set regime_tributario = $3, enquadramento_simples = $4, cnae_principal = $5,
            inscricao_estadual_situacao = $6, inscricao_estadual_numero = $7,
            inscricao_municipal_situacao = $8, inscricao_municipal_numero = $9,
            atualizado_em = now(), versao = versao + 1
      where tenant_id = $1 and id = $2`,
    [
      tenantId,
      empresaId,
      dados.regimeTributario,
      // O CHECK do banco só aceita enquadramento dentro do Simples; fora dele o
      // valor tem de ir nulo, ainda que o formulário tenha mandado algo.
      dados.regimeTributario === 'SIMPLES_NACIONAL' ? dados.enquadramentoSimples : null,
      dados.cnaePrincipal,
      dados.inscricaoEstadual.situacao,
      dados.inscricaoEstadual.situacao === 'POSSUI' ? dados.inscricaoEstadual.numero : null,
      dados.inscricaoMunicipal.situacao,
      dados.inscricaoMunicipal.situacao === 'POSSUI' ? dados.inscricaoMunicipal.numero : null,
    ],
  );

  // CNAEs secundários são substituídos em bloco: arquiva os atuais e insere os
  // informados. Sem DELETE por I-7, o arquivamento é o caminho.
  await cliente.query(
    `update app.empresa_cnae_secundario
        set situacao = 'arquivado', atualizado_em = now(), versao = versao + 1
      where tenant_id = $1 and empresa_id = $2 and situacao = 'ativo'`,
    [tenantId, empresaId],
  );

  for (const codigo of dados.cnaesSecundarios) {
    await cliente.query(
      `insert into app.empresa_cnae_secundario (tenant_id, empresa_id, codigo)
       values ($1, $2, $3)
       on conflict (empresa_id, codigo) where situacao = 'ativo' do nothing`,
      [tenantId, empresaId, codigo],
    );
  }
};

/** Grava o endereço principal, substituindo o anterior — há exatamente um (§4.4). */
export const salvarEnderecoDaEmpresa = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  endereco: EnderecoDaEmpresa,
): Promise<void> => {
  const { rows } = await cliente.query<{ id: string }>(
    `select id from app.empresa_endereco
      where tenant_id = $1 and empresa_id = $2 and principal and situacao = 'ativo'`,
    [tenantId, empresaId],
  );

  const existente = rows[0];

  if (existente === undefined) {
    await cliente.query(
      `insert into app.empresa_endereco
         (tenant_id, empresa_id, principal, cep, logradouro, numero, complemento,
          bairro, municipio, uf)
       values ($1, $2, true, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenantId,
        empresaId,
        endereco.cep,
        endereco.logradouro,
        endereco.numero,
        endereco.complemento,
        endereco.bairro,
        endereco.municipio,
        endereco.uf,
      ],
    );

    return;
  }

  await cliente.query(
    `update app.empresa_endereco
        set cep = $3, logradouro = $4, numero = $5, complemento = $6, bairro = $7,
            municipio = $8, uf = $9, atualizado_em = now(), versao = versao + 1
      where tenant_id = $1 and id = $2`,
    [
      tenantId,
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
};

/**
 * Marca a empresa como ativa.
 *
 * O `where status = 'CADASTRO_INCOMPLETO'` faz a idempotência no próprio banco:
 * ativação repetida não incrementa versão nem reescreve `atualizado_em`, então
 * duas requisições simultâneas não produzem dois efeitos (§7).
 */
export const marcarEmpresaComoAtiva = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
): Promise<void> => {
  await cliente.query(
    `update app.empresa
        set status = 'ATIVA', atualizado_em = now(), versao = versao + 1
      where tenant_id = $1 and id = $2 and status = 'CADASTRO_INCOMPLETO'`,
    [tenantId, empresaId],
  );
};
