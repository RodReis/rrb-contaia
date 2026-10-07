/**
 * Uma fixture por tabela do schema `app`, para a matriz de RLS (SPEC-010 §9).
 *
 * `preparar` cria as dependências (pais) pelo papel administrativo; `inserir`
 * é UMA instrução sobre a tabela sob prova. A mesma `inserir` roda como semeador
 * (para ter a linha-alvo) e como papel da aplicação, em contexto errado: assim a
 * negação observada é a da RLS na própria tabela, e não de um pai ausente.
 *
 * Tabela nova precisa de fixture aqui — sem ela o teste de cobertura reprova.
 */
import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

export type Consultavel = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export type Escopo = Readonly<{
  tenantId: string;
  empresaId: string;
  /** Usuário do tenant, para colunas de autoria. */
  autorId: string;
  sufixo: string;
}>;

export type Referencias = Readonly<Record<string, string>>;

export type FixtureDeTabela = Readonly<{
  preparar?: (admin: Consultavel, escopo: Escopo) => Promise<Referencias>;
  inserir: (banco: Consultavel, escopo: Escopo, referencias: Referencias) => Promise<string>;
  /** Coluna do UPDATE sem efeito (`set c = c`). Padrão: `id`. */
  colunaDeAtualizacao?: string;
  /** UPDATE que a própria tabela aceita, quando `set c = c` não serve (ex.: só arquivar). */
  atualizacao?: string;
}>;

let contador = 0;
const proximo = (): number => {
  contador += 1;

  return contador;
};

const unico = async (banco: Consultavel, sql: string, parametros: unknown[]): Promise<string> => {
  const { rows } = await banco.query<{ id: string }>(sql, parametros);
  const linha = rows[0];

  if (linha === undefined) {
    throw new Error(`a fixture não devolveu id: ${sql}`);
  }

  return linha.id;
};

const exigencia = (admin: Consultavel, escopo: Escopo): Promise<string> =>
  unico(
    admin,
    `insert into app.empresa_exigencia_documental (tenant_id, empresa_id, nome)
     values ($1, $2, $3) returning id`,
    [escopo.tenantId, escopo.empresaId, `Exigência ${escopo.sufixo}-${proximo()}`],
  );

const papel = (admin: Consultavel, escopo: Escopo): Promise<string> =>
  unico(
    admin,
    `insert into app.papel_personalizado (tenant_id, nome, papel_base)
     values ($1, $2, 'auxiliar') returning id`,
    [escopo.tenantId, `Papel ${escopo.sufixo}-${proximo()}`],
  );

const usuarioLivre = (admin: Consultavel, escopo: Escopo): Promise<string> => {
  const n = proximo();

  return unico(
    admin,
    `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
     values ($1, $2, $3, $4, 'CONVIDADO') returning id`,
    [escopo.tenantId, `livre-${escopo.sufixo}-${n}`, `livre${n}.${escopo.sufixo}@matriz.local`, `Livre ${n}`],
  );
};


/** Versão DESATIVADA: várias coexistem por empresa, ao contrário do vigente (índice único parcial). */
const SQL_CERTIFICADO = `insert into app.empresa_certificado
   (tenant_id, empresa_id, versao, estado, titular, cnpj_titular, autoridade_certificadora, cadeia,
    numero_serie, impressao_digital, valido_de, valido_ate, responsavel_id, referencia_segredo,
    cadastrado_por, encerrado_em, encerrado_por, motivo_encerramento, justificativa)
 values ($1, $2, $3, 'DESATIVADO', 'Titular da Prova', '00000000000000', 'AC da Prova',
         array['AC da Prova'], $4, $5, '2026-01-01', '2027-01-01', $6, $7, $6,
         now(), $6, 'DESATIVACAO', 'prova da matriz')
 returning id`;

const hex64 = (): string => (randomUUID() + randomUUID()).replaceAll('-', '').slice(0, 64);

const parametrosDoCertificado = (e: Escopo, n: number): unknown[] => [
  e.tenantId,
  e.empresaId,
  1_000 + n,
  `serie-${e.sufixo}-${n}`,
  `impressao-${e.sufixo}-${n}`,
  e.autorId,
  randomUUID(),
];

const certificado = (banco: Consultavel, e: Escopo): Promise<string> =>
  unico(banco, SQL_CERTIFICADO, parametrosDoCertificado(e, proximo()));

export const FIXTURES: Readonly<Record<string, FixtureDeTabela>> = {
  'app.tenant': {
    inserir: (banco, escopo) =>
      unico(banco, `insert into app.tenant (razao_social, cnpj) values ($1, $2) returning id`, [
        `Fixture tenant ${escopo.sufixo}-${proximo()}`,
        `X${String(proximo()).padStart(13, '0')}`,
      ]),
  },
  'app.empresa': {
    inserir: (banco, escopo) =>
      unico(
        banco,
        `insert into app.empresa (tenant_id, cnpj, razao_social, status)
         values ($1, $2, $3, 'ATIVA') returning id`,
        [escopo.tenantId, `F${String(proximo()).padStart(5, '0')}${escopo.sufixo}`.slice(0, 14), `Fixture empresa ${proximo()}`],
      ),
  },
  'app.empresa_cnae_secundario': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_cnae_secundario (tenant_id, empresa_id, codigo)
         values ($1, $2, $3) returning id`,
        [e.tenantId, e.empresaId, String(2_000_000 + proximo())],
      ),
  },
  'app.empresa_endereco': {
    // Uma finalidade ativa por empresa: a semente e a tentativa usam finalidades diferentes.
    preparar: async () => ({
      finalidade: ['COBRANCA', 'CORRESPONDENCIA', 'OUTRO'][proximo() % 3] ?? 'OUTRO',
    }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.empresa_endereco
           (tenant_id, empresa_id, principal, finalidade, descricao, cep, logradouro, numero,
            bairro, municipio, uf)
         values ($1, $2, false, $3, $4, '74000000', 'Rua da Prova', '1', 'Centro', 'Goiânia', 'GO')
         returning id`,
        [e.tenantId, e.empresaId, r['finalidade'], r['finalidade'] === 'OUTRO' ? 'Prova' : null],
      ),
  },
  'app.empresa_evento_de_historico': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_evento_de_historico
           (tenant_id, empresa_id, aba, acao, campo, usuario_id)
         values ($1, $2, 'DADOS_CADASTRAIS', 'ALTERACAO', 'razao_social', $3) returning id`,
        [e.tenantId, e.empresaId, e.autorId],
      ),
  },
  'app.empresa_exigencia_documental': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_exigencia_documental (tenant_id, empresa_id, nome)
         values ($1, $2, $3) returning id`,
        [e.tenantId, e.empresaId, `Exigência ${proximo()}`],
      ),
  },
  'app.empresa_documento_versao': {
    preparar: async (admin, e) => ({ exigenciaId: await exigencia(admin, e) }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.empresa_documento_versao
           (tenant_id, empresa_id, exigencia_id, numero, chave_storage, nome_original,
            tipo_conteudo, tamanho_bytes, vigente, enviado_por)
         values ($1, $2, $3, $4, $5, 'prova.pdf', 'application/pdf', 10, true, $6) returning id`,
        [e.tenantId, e.empresaId, r['exigenciaId'], proximo(), `chave/${e.sufixo}/${proximo()}`, e.autorId],
      ),
    // A versão é somente leitura: o único UPDATE aceito é arquivá-la (vigente true -> false).
    atualizacao: 'vigente = false',
  },
  'app.empresa_evento_documental': {
    preparar: async (admin, e) => ({ exigenciaId: await exigencia(admin, e) }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.empresa_evento_documental
           (tenant_id, empresa_id, exigencia_id, acao, usuario_id)
         values ($1, $2, $3, 'VISUALIZACAO', $4) returning id`,
        [e.tenantId, e.empresaId, r['exigenciaId'], e.autorId],
      ),
  },
  'app.empresa_pendencia': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_pendencia (tenant_id, empresa_id, origem, tipo, chave)
         values ($1, $2, 'CADASTRAL', 'CAMPO_AUSENTE', $3) returning id`,
        [e.tenantId, e.empresaId, `campo-${e.sufixo}-${proximo()}`],
      ),
  },
  'app.empresa_evento_de_pendencia': {
    preparar: async (admin, e) => ({
      pendenciaId: await unico(
        admin,
        `insert into app.empresa_pendencia (tenant_id, empresa_id, origem, tipo, chave)
         values ($1, $2, 'CADASTRAL', 'CAMPO_AUSENTE', $3) returning id`,
        [e.tenantId, e.empresaId, `base-${e.sufixo}-${proximo()}`],
      ),
    }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.empresa_evento_de_pendencia (tenant_id, empresa_id, pendencia_id, acao)
         values ($1, $2, $3, 'CRIACAO') returning id`,
        [e.tenantId, e.empresaId, r['pendenciaId']],
      ),
  },
  'app.empresa_notificacao': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_notificacao (tenant_id, empresa_id, tipo, chave)
         values ($1, $2, 'NOVA_PENDENCIA', $3) returning id`,
        [e.tenantId, e.empresaId, `chave-${e.sufixo}-${proximo()}`],
      ),
    colunaDeAtualizacao: 'lida',
  },
  'app.empresa_evento_de_notificacao': {
    preparar: async (admin, e) => ({
      notificacaoId: await unico(
        admin,
        `insert into app.empresa_notificacao (tenant_id, empresa_id, tipo, chave)
         values ($1, $2, 'NOVA_PENDENCIA', $3) returning id`,
        [e.tenantId, e.empresaId, `base-${e.sufixo}-${proximo()}`],
      ),
    }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.empresa_evento_de_notificacao (tenant_id, empresa_id, notificacao_id, acao)
         values ($1, $2, $3, 'CRIACAO') returning id`,
        [e.tenantId, e.empresaId, r['notificacaoId']],
      ),
  },
  'app.empresa_certificado': {
    inserir: (banco, e) => certificado(banco, e),
    // Colunas atualizáveis são só as de encerramento e o responsável; a versão desativada não muda.
    colunaDeAtualizacao: 'responsavel_id',
  },
  'app.empresa_certificado_evento': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_certificado_evento
           (tenant_id, empresa_id, acao, resultado, codigo, usuario_id, identidade_tecnica, correlation_id)
         values ($1, $2, 'RECUSA', 'RECUSADO', 'CERTIFICADO_SENHA_INCORRETA', $3, 'matriz-rls', 'matriz-rls')
         returning id`,
        [e.tenantId, e.empresaId, e.autorId],
      ),
  },
  'app.empresa_certificado_ingestao': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.empresa_certificado_ingestao
           (tenant_id, empresa_id, usuario_id, operacao, responsavel_id, correlation_id, expira_em)
         values ($1, $2, $3, 'CADASTRO', $3, 'matriz-rls', now() + interval '5 minutes')
         returning id`,
        [e.tenantId, e.empresaId, e.autorId],
      ),
    colunaDeAtualizacao: 'estado',
  },
  'app.empresa_certificado_notificacao': {
    // O certificado-pai nasce na mesma instrução, na empresa da própria tentativa: a FK composta
    // (certificado, empresa, tenant) recusaria um pai de outra empresa, e a matriz repete a
    // tentativa em empresas diferentes (arquivada, outro tenant) com as mesmas referências.
    inserir: (banco, e) => {
      const n = proximo();

      return unico(
        banco,
        `with certificado as (${SQL_CERTIFICADO})
         insert into app.empresa_certificado_notificacao
           (tenant_id, empresa_id, certificado_id, usuario_id, marco)
         select $1, $2, certificado.id, $6, 'D30' from certificado
         returning id`,
        parametrosDoCertificado(e, n),
      );
    },
    colunaDeAtualizacao: 'lida',
  },
  'app.signer_operacao': {
    // O certificado-pai nasce na mesma instrução e na empresa da própria tentativa: a FK composta
    // (certificado, empresa, tenant) recusaria um pai de outra empresa, e a matriz repete a
    // tentativa em empresas diferentes com as mesmas referências.
    inserir: (banco, e) => {
      const n = proximo();

      return unico(
        banco,
        `with certificado as (${SQL_CERTIFICADO})
         insert into app.signer_operacao
           (tenant_id, empresa_id, finalidade, tipo, chave_hmac, hash_conteudo, certificado_id,
            referencia_segredo, identidade_tecnica, correlation_id)
         select $1, $2, 'DFE_TESTE', 'MTLS', $8, $9, certificado.id, $7::uuid, 'matriz-rls', 'matriz-rls'
           from certificado
         returning id`,
        [...parametrosDoCertificado(e, n), hex64(), hex64()],
      );
    },
    colunaDeAtualizacao: 'tentativas',
  },
  'app.signer_evento': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.signer_evento
           (tenant_id, empresa_id, finalidade, identidade_tecnica, iniciado_em, finalizado_em, latencia_ms,
            resultado, codigo, correlation_id)
         values ($1, $2, 'DFE_TESTE', 'matriz-rls', now(), now(), 5, 'FALHA', 'SIGNER_DESTINO_INDISPONIVEL',
                 'matriz-rls')
         returning id`,
        [e.tenantId, e.empresaId],
      ),
  },
  'app.signer_notificacao': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.signer_notificacao (tenant_id, usuario_id, incidente_id, tipo)
         values ($1, $2, gen_random_uuid(), 'INDISPONIBILIDADE') returning id`,
        [e.tenantId, e.autorId],
      ),
    colunaDeAtualizacao: 'lida',
  },
  'app.carteira_vinculo': {
    preparar: async (admin, e) => ({ usuarioId: await usuarioLivre(admin, e) }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id)
         values ($1, $2, $3) returning id`,
        [e.tenantId, r['usuarioId'], e.empresaId],
      ),
  },
  'app.usuario': {
    inserir: (banco, e) => {
      const n = proximo();

      return unico(
        banco,
        `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
         values ($1, $2, $3, $4, 'CONVIDADO') returning id`,
        [e.tenantId, `ins-${e.sufixo}-${n}`, `ins${n}.${e.sufixo}@matriz.local`, `Inserido ${n}`],
      );
    },
  },
  'app.usuario_papel': {
    preparar: async (admin, e) => ({ usuarioId: await usuarioLivre(admin, e) }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.usuario_papel (tenant_id, usuario_id, papel)
         values ($1, $2, 'auxiliar') returning id`,
        [e.tenantId, r['usuarioId']],
      ),
  },
  'app.usuario_convite': {
    preparar: async (admin, e) => ({ usuarioId: await usuarioLivre(admin, e) }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.usuario_convite (tenant_id, usuario_id, token_hash, expira_em)
         values ($1, $2, $3, now() + interval '1 day') returning id`,
        [e.tenantId, r['usuarioId'], `hash-${e.sufixo}-${proximo()}`],
      ),
  },
  'app.usuario_evento': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.usuario_evento (tenant_id, tipo, usuario_afetado_id, autor_id)
         values ($1, 'REATIVADO', $2, $2) returning id`,
        [e.tenantId, e.autorId],
      ),
  },
  'app.papel_personalizado': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.papel_personalizado (tenant_id, nome, papel_base)
         values ($1, $2, 'auxiliar') returning id`,
        [e.tenantId, `Papel ${e.sufixo}-${proximo()}`],
      ),
  },
  'app.papel_personalizado_revisao': {
    preparar: async (admin, e) => ({ papelId: await papel(admin, e) }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.papel_personalizado_revisao (tenant_id, papel_id, revisao, permissoes)
         values ($1, $2, $3, array['empresas.consultar']::text[]) returning id`,
        [e.tenantId, r['papelId'], 100 + proximo()],
      ),
  },
  'app.usuario_papel_personalizado': {
    preparar: async (admin, e) => ({
      papelId: await papel(admin, e),
      usuarioId: await usuarioLivre(admin, e),
    }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.usuario_papel_personalizado (tenant_id, usuario_id, papel_id)
         values ($1, $2, $3) returning id`,
        [e.tenantId, r['usuarioId'], r['papelId']],
      ),
  },
  'app.escritorio_endereco': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.escritorio_endereco
           (tenant_id, cep, logradouro, numero, bairro, municipio, uf)
         values ($1, '74000000', 'Rua da Prova', '1', 'Centro', 'Goiânia', 'GO') returning id`,
        [e.tenantId],
      ),
  },
  'app.escritorio_arquivo': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.escritorio_arquivo
           (tenant_id, tipo, chave_storage, nome_original, tipo_conteudo, tamanho_bytes)
         values ($1, 'DOCUMENTO', $2, 'prova.pdf', 'application/pdf', 10) returning id`,
        [e.tenantId, `escritorio/${e.sufixo}/${proximo()}`],
      ),
  },
  'app.carteira_evento': {
    inserir: (banco, e) =>
      unico(
        banco,
        `insert into app.carteira_evento (tenant_id, origem, afetados, usuarios_afetados, empresas_afetadas)
         values ($1, 'INDIVIDUAL', '[{}]'::jsonb, array[$2]::uuid[], array[$3]::uuid[]) returning id`,
        [e.tenantId, e.autorId, e.empresaId],
      ),
  },
  'app.carteira_notificacao': {
    preparar: async (admin, e) => ({
      eventoId: await unico(
        admin,
        `insert into app.carteira_evento (tenant_id, origem, afetados, usuarios_afetados, empresas_afetadas)
         values ($1, 'INDIVIDUAL', '[{}]'::jsonb, array[$2]::uuid[], array[$3]::uuid[]) returning id`,
        [e.tenantId, e.autorId, e.empresaId],
      ),
    }),
    inserir: (banco, e, r) =>
      unico(
        banco,
        `insert into app.carteira_notificacao (tenant_id, usuario_id, evento_id, adicionadas)
         values ($1, $2, $3, '[{}]'::jsonb) returning id`,
        [e.tenantId, e.autorId, r['eventoId']],
      ),
    colunaDeAtualizacao: 'lida',
  },
};
