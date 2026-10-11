/**
 * Repositório da importação de empregados (SPEC-014 §3.4–§3.10, §6.3, §6.4).
 *
 * O ciclo de vida da tentativa é o genérico de `importacao-ciclo.ts` com `DESCRITOR_EMPREGADOS`
 * (chamadores usam esse módulo direto para buscar, iniciar validação, confirmar, finalizar,
 * cancelar, falhar e registrar eventos). Aqui fica o que é de empregado: o formato do staging, a
 * aplicação pela chave natural empresa + CPF + matrícula, as notificações para N destinatários e
 * a lista dos administradores autorizados. Roda SEMPRE dentro da transação do chamador e filtra
 * pela `empresa_id` recebida, além da RLS. O "agora" entra por parâmetro.
 */
import type { LinhaDeStagingDeEmpregado } from '@contaia/domain';
import type { PoolClient } from 'pg';

import {
  DESCRITOR_EMPREGADOS as D,
  criarNotificacoes,
  criarTentativa,
  exigirNumerosDeLinhaUnicos,
  gravarResultadoDaValidacao,
  subirVersao,
  travarVersaoParaAplicar,
} from './importacao-ciclo.js';
import type {
  NovaTentativa,
  NovasNotificacoes,
  ResultadoDaValidacaoGravada,
  TentativaCriadaNoCiclo,
  TentativaDoCiclo,
} from './importacao-ciclo.js';

export type AplicacaoDeEmpregados = Readonly<{
  empresaId: string;
  tentativaId: string;
  agora: Date;
}>;

export type ResultadoDaAplicacaoDeEmpregados = Readonly<{
  incluidas: number;
  atualizadas: number;
  /** Linhas válidas cujo empregado está arquivado na hora de aplicar: não tocadas (§3.6). */
  ignoradas: number;
  /** Versão da base depois desta aplicação. */
  versaoDaBase: number;
}>;

/** Ver `importacao-ciclo.criarTentativa` (identidade idempotente e obsolescência do FIX #107). */
export const criarTentativaDeEmpregados = (cliente: PoolClient, nova: NovaTentativa): Promise<TentativaCriadaNoCiclo> =>
  criarTentativa(cliente, D, nova);

/** Insere o lote inteiro numa instrução (`unnest`); reentrega não duplica (DO NOTHING). */
const inserirStaging = async (
  cliente: PoolClient,
  tentativa: TentativaDoCiclo,
  linhas: readonly LinhaDeStagingDeEmpregado[],
): Promise<void> => {
  if (linhas.length === 0) {
    return;
  }

  exigirNumerosDeLinhaUnicos(linhas.map((linha) => linha.numeroDaLinha));
  const coluna = <T>(valor: (linha: LinhaDeStagingDeEmpregado) => T): T[] => linhas.map(valor);

  await cliente.query(
    `insert into app.importacao_empregados_linha
       (tenant_id, empresa_id, tentativa_id, numero_linha, cpf, cpf_normalizado, nome, matricula,
        data_nascimento, data_admissao, status, acao, codigo_de_erro, campo, mensagem)
     select $1, $2, $3, l.numero_linha, l.cpf, l.cpf_normalizado, l.nome, l.matricula,
            l.data_nascimento, l.data_admissao, l.status, l.acao, l.codigo_de_erro, l.campo, l.mensagem
       from unnest($4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[],
                   $11::text[], $12::text[], $13::text[], $14::text[], $15::text[])
         as l(numero_linha, cpf, cpf_normalizado, nome, matricula, data_nascimento, data_admissao,
              status, acao, codigo_de_erro, campo, mensagem)
     on conflict (tentativa_id, numero_linha) do nothing`,
    [
      tentativa.tenantId,
      tentativa.empresaId,
      tentativa.id,
      coluna((l) => l.numeroDaLinha),
      coluna((l) => l.cpf),
      coluna((l) => l.cpfNormalizado),
      coluna((l) => l.nome),
      coluna((l) => l.matricula),
      coluna((l) => l.dataNascimento),
      coluna((l) => l.dataAdmissao),
      coluna((l) => l.status),
      coluna((l) => l.acao),
      coluna((l) => l.codigoDeErro),
      coluna((l) => l.campo),
      coluna((l) => l.mensagem),
    ],
  );
};

/**
 * Grava o staging da validação e fecha a etapa (AGUARDANDO_CONFIRMACAO ou REJEITADA), fixando a
 * versão da base que ESTA entrega leu em `iniciarValidacao`. Idempotente na reentrega (devolve o
 * que existe com `transicionou = false`). Ver `importacao-ciclo.gravarResultadoDaValidacao`.
 */
export const gravarResultadoDaValidacaoDeEmpregados = (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
  linhas: readonly LinhaDeStagingDeEmpregado[],
  versaoNaValidacao: number,
  agora: Date,
): Promise<ResultadoDaValidacaoGravada> =>
  gravarResultadoDaValidacao(cliente, D, empresaId, tentativaId, versaoNaValidacao, agora, (tentativa) =>
    inserirStaging(cliente, tentativa, linhas),
  );

/**
 * Aplica as linhas válidas do staging à base, numa instrução, dentro da transação do chamador
 * (depois de `confirmar`). Antes, trava a versão da base e a compara com a da validação:
 * divergência → `CONFLITO_DE_VERSAO` (409) sem tocar empregado algum. Chave nova inclui empregado
 * ATIVO; chave ativa existente atualiza nome, nascimento e admissão; arquivado nunca é tocado
 * (`WHERE NOT arquivado`) e conta em `ignoradas`. Valor igual ao vigente conta como atualizado sem
 * mudar instante nem versão do empregado. Ausentes do CSV ficam como estão. Sobe a versão da base.
 */
export const aplicarLinhasDeEmpregados = async (
  cliente: PoolClient,
  aplicacao: AplicacaoDeEmpregados,
): Promise<ResultadoDaAplicacaoDeEmpregados> => {
  const { empresaId, tentativaId, agora } = aplicacao;
  const tentativa = await travarVersaoParaAplicar(cliente, D, empresaId, tentativaId);

  const { rows } = await cliente.query<{ incluidas: number; atualizadas: number; ignoradas: number }>(
    `with validas as (
       select cpf_normalizado as cpf, nome, matricula,
              data_nascimento::date as data_nascimento, data_admissao::date as data_admissao
         from app.importacao_empregados_linha
        where tentativa_id = $1 and empresa_id = $2 and status = 'VALIDA'
     ), aplicadas as (
       insert into app.empregado as e
         (tenant_id, empresa_id, cpf, nome, matricula, data_nascimento, data_admissao, criado_em, atualizado_em)
       select $3, $2, cpf, nome, matricula, data_nascimento, data_admissao, $4, $4 from validas
       on conflict (empresa_id, cpf, matricula) do update
         set nome = excluded.nome,
             data_nascimento = excluded.data_nascimento,
             data_admissao = excluded.data_admissao,
             atualizado_em = case
               when (e.nome, e.data_nascimento, e.data_admissao)
                    is distinct from (excluded.nome, excluded.data_nascimento, excluded.data_admissao)
               then excluded.atualizado_em
               else e.atualizado_em
             end
         where e.arquivado = false
       returning (e.xmax = 0) as incluida
     )
     select (select count(*) from aplicadas where incluida)::int as incluidas,
            (select count(*) from aplicadas where not incluida)::int as atualizadas,
            ((select count(*) from validas) - (select count(*) from aplicadas))::int as ignoradas`,
    [tentativaId, empresaId, tentativa.tenantId, agora],
  );

  const versaoDaBase = await subirVersao(cliente, D, tentativa.tenantId, empresaId);

  return { ...rows[0]!, versaoDaBase };
};

/**
 * Avisos de conclusão (sino da F6), um por destinatário — o caso de uso passa o iniciador e os
 * administradores autorizados (`listarAdminsAutorizadosDaEmpresa`). Idempotente: repetir não cria
 * outro (UNIQUE tentativa + usuário); devolve quantos nasceram agora. Tentativa ausente nesta
 * empresa → `TENTATIVA_NAO_ENCONTRADA`.
 */
export const criarNotificacoesDeImportacaoDeEmpregados = (
  cliente: PoolClient,
  novas: NovasNotificacoes,
): Promise<number> => criarNotificacoes(cliente, D, novas);

/**
 * `admin_escritorio` ATIVOS com papel vigente e a empresa na carteira (SPEC-014 §3.10), em ordem de
 * id. Funciona para humano e para o worker da empresa (função SECURITY DEFINER da 0017); empresa
 * fora do alcance da sessão → lista vazia.
 */
export const listarAdminsAutorizadosDaEmpresa = async (
  cliente: PoolClient,
  empresaId: string,
): Promise<readonly string[]> => {
  const { rows } = await cliente.query<{ id: string }>(
    `select id from app.admins_autorizados_da_empresa($1) as admins(id) order by id`,
    [empresaId],
  );

  return rows.map((linha) => linha.id);
};
