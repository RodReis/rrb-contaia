import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio, validarHierarquia, type ClasseContabil, type PoliticaCentroCusto } from '@contaia/domain';
import { comContextoHumano } from '@contaia/db';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PoolDoBanco } from '../banco/pool.provider';

export type AtorCatalogo = Readonly<{ tenantId: string; usuarioId: string }>;
type TipoCatalogo = 'ANALYTICAL' | 'SYNTHETIC';
type Catalogo = 'CONTA' | 'CENTRO_CUSTO';
type CamposItem = Readonly<{ code: string; name: string; type: TipoCatalogo; parentCode: string | null }>;

const tipoPersistido = (tipo: TipoCatalogo): 'analitica' | 'sintetica' => tipo === 'ANALYTICAL' ? 'analitica' : 'sintetica';
const unicidade = (erro: unknown): boolean => typeof erro === 'object' && erro !== null && 'code' in erro && (erro as {code?:string}).code === '23505';
const gravarErroDeUnicidade = (erro: unknown): never => { if (unicidade(erro)) throw new ErroDeConflito(CODIGOS_DE_ERRO.ACCOUNTING_CATALOG_CODE_DUPLICATE, 'Código já usado neste catálogo.'); throw erro; };

@Injectable()
export class CatalogoContabilService {
  constructor(private readonly pool: PoolDoBanco) {}

  async registrarTentativaNegada(ator: AtorCatalogo, empresaId: string, catalogo: Catalogo, codigo: string, correlationId: string, codigoErro: string): Promise<void> {
    try {
      await this.contexto(ator, async (cliente) => {
        // A FK composta valida tenant/empresa mesmo quando RLS oculta a empresa por falta de carteira.
        await cliente.query(`insert into app.catalogo_contabil_evento(tenant_id,empresa_id,catalogo,codigo_item,acao,resultado,codigo_erro,usuario_id,correlation_id) values($1,$2,$3,$4,'TENTATIVA_NEGADA','RECUSADO',$5,$6,$7)`, [ator.tenantId,empresaId,catalogo,codigo,codigoErro,ator.usuarioId,correlationId]);
      });
    } catch { /* negação original mantém precedência; fora do escopo nem identifica empresa */ }
  }

  private async travarEmpresa(cliente: PoolClient, empresaId: string): Promise<void> {
    const { rows } = await cliente.query(`select id from app.empresa where id=$1 for update`,[empresaId]);
    if (rows[0] === undefined) throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,'Empresa não encontrada.');
  }

  private contexto<T>(ator: AtorCatalogo, executar: (cliente: PoolClient) => Promise<T>): Promise<T> {
    return comContextoHumano(this.pool.instancia, ator, executar);
  }

  listarContas(ator: AtorCatalogo, empresaId: string, cursor: string | undefined, busca: string | undefined) {
    return this.contexto(ator, async (cliente) => {
      const { rows } = await cliente.query(`select c.id as "accountId", c.tenant_id as "tenantId", c.empresa_id as "companyId", c.codigo as code, c.nome as name,
        case c.tipo when 'analitica' then 'ANALYTICAL' else 'SYNTHETIC' end as type, c.classe_contabil as "accountClass",
        case c.natureza when 'devedora' then 'DEBIT' else 'CREDIT' end as "normalBalance", p.id as "parentAccountId",
        c.conta_pai as "parentCode", case when c.tipo='sintetica' then 'FORBIDDEN' else c.politica_centro_custo end as "costCenterPolicy",
        case when c.arquivada then 'ARCHIVED' when c.classe_contabil is null then 'INCOMPLETE' else 'ACTIVE' end as status,
        c.versao as version from app.conta_contabil c left join app.conta_contabil p on p.empresa_id=c.empresa_id and p.codigo=c.conta_pai
        where c.empresa_id=$1 and ($2::text is null or c.codigo>$2) and ($3::text is null or c.codigo ilike '%'||$3||'%' or c.nome ilike '%'||$3||'%') order by c.codigo limit 201`, [empresaId,cursor ?? null,busca ?? null]);
      const items = rows.slice(0,200);
      const { rows: contagem } = await cliente.query<{ total: string }>(`select count(*)::text as total from app.conta_contabil where empresa_id=$1 and not arquivada and classe_contabil is null`,[empresaId]);
      return { items, nextCursor: rows.length>200 ? items.at(-1)?.code ?? null : null, incompleteCount: Number(contagem[0]?.total ?? 0) };
    });
  }

  listarCentros(ator: AtorCatalogo, empresaId: string, cursor: string | undefined, busca: string | undefined) {
    return this.contexto(ator, async (cliente) => {
      const { rows } = await cliente.query(`select c.id as "costCenterId",c.tenant_id as "tenantId",c.empresa_id as "companyId",c.codigo as code,c.nome as name,
        case c.tipo when 'analitica' then 'ANALYTICAL' else 'SYNTHETIC' end as type,c.centro_pai as "parentCode",p.id as "parentCostCenterId",
        case when c.arquivada then 'ARCHIVED' else 'ACTIVE' end as status,c.versao as version
        from app.centro_custo c left join app.centro_custo p on p.empresa_id=c.empresa_id and p.codigo=c.centro_pai
        where c.empresa_id=$1 and ($2::text is null or c.codigo>$2) and ($3::text is null or c.codigo ilike '%'||$3||'%' or c.nome ilike '%'||$3||'%') order by c.codigo limit 201`, [empresaId,cursor ?? null,busca ?? null]);
      const items = rows.slice(0,200);
      return { items, nextCursor: rows.length>200 ? items.at(-1)?.code ?? null : null };
    });
  }

  async salvarConta(ator: AtorCatalogo, empresaId: string, codigo: string, campos: CamposItem & Readonly<{ accountClass: ClasseContabil | null; normalBalance: 'DEBIT' | 'CREDIT'; costCenterPolicy: PoliticaCentroCusto; version?: number | undefined; archived?: boolean | undefined }>, correlationId: string) {
    return this.contexto(ator, async (cliente) => {
      await this.travarEmpresa(cliente,empresaId);
      const { rows: hierarquia } = await cliente.query<{ code: string; parentCode: string | null; type: TipoCatalogo; archived: boolean; accountClass: ClasseContabil | null }>(
        `select codigo as code,conta_pai as "parentCode",case tipo when 'analitica' then 'ANALYTICAL' else 'SYNTHETIC' end as type,arquivada as archived,classe_contabil as "accountClass" from app.conta_contabil where empresa_id=$1`, [empresaId]);
      const codigoExistente = hierarquia.find((item) => item.code === codigo);
      if (codigoExistente === undefined && campos.accountClass === null) throw new ErroDeDominio(CODIGOS_DE_ERRO.ACCOUNTING_ACCOUNT_CLASS_REQUIRED, 'Classifique a conta antes de criá-la.');
      const erro = validarHierarquia({ code: codigo, parentCode: campos.parentCode, type: campos.type, archived: false, accountClass: campos.accountClass }, hierarquia, campos.type === 'SYNTHETIC' ? 'FORBIDDEN' : campos.costCenterPolicy);
      if (erro !== null) throw new ErroDeDominio(erro, 'Hierarquia ou política incompatível com o catálogo.');
      if (codigoExistente === undefined) {
        try {
          const { rows } = await cliente.query(`insert into app.conta_contabil(tenant_id,empresa_id,codigo,nome,tipo,natureza,conta_pai,classe_contabil,politica_centro_custo)
            values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id,versao`, [ator.tenantId,empresaId,codigo,campos.name,tipoPersistido(campos.type),campos.normalBalance==='DEBIT'?'devedora':'credora',campos.parentCode,campos.accountClass,campos.type==='SYNTHETIC'?'FORBIDDEN':campos.costCenterPolicy]);
          await this.evento(cliente, ator, empresaId, 'CONTA', rows[0]?.id ?? null, codigo, 'CRIACAO', correlationId, null, Number(rows[0]?.versao ?? 1));
          return { accountId: rows[0]?.id, version: rows[0]?.versao };
        } catch (erro) { gravarErroDeUnicidade(erro); }
      }
      if (campos.version === undefined) throw new ErroDeConflito(CODIGOS_DE_ERRO.ACCOUNTING_CATALOG_VERSION_CONFLICT, 'Versão da conta ausente.');
      if (campos.archived === true) {
        const { rows: descendentes } = await cliente.query(`with recursive arvore as (
          select codigo,conta_pai,arquivada from app.conta_contabil where empresa_id=$1 and conta_pai=$2
          union all select filha.codigo,filha.conta_pai,filha.arquivada from app.conta_contabil filha join arvore pai on filha.conta_pai=pai.codigo where filha.empresa_id=$1
        ) select 1 from arvore where not arquivada limit 1`, [empresaId,codigo]);
        if (descendentes.length > 0) throw new ErroDeDominio(CODIGOS_DE_ERRO.ACCOUNTING_CATALOG_ACTIVE_DESCENDANTS, 'Arquive descendentes ativos antes do item pai.');
      }
      const politica = campos.type === 'SYNTHETIC' ? 'FORBIDDEN' : campos.costCenterPolicy;
      const { rows } = await cliente.query(`update app.conta_contabil set nome=$1,tipo=$2,natureza=$3,conta_pai=$4,classe_contabil=$5,politica_centro_custo=$6,atualizado_em=now()
        where empresa_id=$7 and codigo=$8 and versao=$9 and not arquivada returning id,versao`, [campos.name,tipoPersistido(campos.type),campos.normalBalance==='DEBIT'?'devedora':'credora',campos.parentCode,campos.accountClass,politica,empresaId,codigo,campos.version]);
      if (rows[0] === undefined) throw new ErroDeConflito(CODIGOS_DE_ERRO.ACCOUNTING_CATALOG_VERSION_CONFLICT, 'A conta mudou. Atualize os dados e tente novamente.');
      await this.evento(cliente, ator, empresaId, 'CONTA', rows[0].id, codigo, campos.archived ? 'ARQUIVAMENTO' : 'EDICAO', correlationId, campos.version, Number(rows[0].versao));
      return { accountId: rows[0].id, version: rows[0].versao };
    });
  }

  async salvarCentro(ator: AtorCatalogo, empresaId: string, codigo: string, campos: CamposItem & Readonly<{ version?: number | undefined; archived?: boolean | undefined }>, correlationId: string) {
    return this.contexto(ator, async (cliente) => {
      await this.travarEmpresa(cliente,empresaId);
      const { rows: itens } = await cliente.query<{ code: string; parentCode: string | null; type: TipoCatalogo; archived: boolean }>(`select codigo as code,centro_pai as "parentCode",case tipo when 'analitica' then 'ANALYTICAL' else 'SYNTHETIC' end as type,arquivada as archived from app.centro_custo where empresa_id=$1`, [empresaId]);
      const existente = itens.find((item) => item.code === codigo);
      const erro = validarHierarquia({ code: codigo, parentCode: campos.parentCode, type: campos.type, archived: false }, itens);
      if (erro !== null) throw new ErroDeDominio(erro, 'Hierarquia incompatível com o catálogo.');
      if (existente === undefined) {
        try {
          const { rows } = await cliente.query(`insert into app.centro_custo(tenant_id,empresa_id,codigo,nome,tipo,centro_pai) values($1,$2,$3,$4,$5,$6) returning id,versao`, [ator.tenantId,empresaId,codigo,campos.name,tipoPersistido(campos.type),campos.parentCode]);
          await this.evento(cliente,ator,empresaId,'CENTRO_CUSTO',rows[0]?.id ?? null,codigo,'CRIACAO',correlationId,null,Number(rows[0]?.versao ?? 1));
          return { costCenterId: rows[0]?.id, version: rows[0]?.versao };
        } catch (erro) { gravarErroDeUnicidade(erro); }
      }
      if (campos.version === undefined) throw new ErroDeConflito(CODIGOS_DE_ERRO.ACCOUNTING_CATALOG_VERSION_CONFLICT, 'Versão do centro ausente.');
      if (campos.archived === true) {
        const { rows: descendentes } = await cliente.query(`with recursive arvore as (
          select codigo,centro_pai,arquivada from app.centro_custo where empresa_id=$1 and centro_pai=$2
          union all select filha.codigo,filha.centro_pai,filha.arquivada from app.centro_custo filha join arvore pai on filha.centro_pai=pai.codigo where filha.empresa_id=$1
        ) select 1 from arvore where not arquivada limit 1`, [empresaId,codigo]);
        if (descendentes.length > 0) throw new ErroDeDominio(CODIGOS_DE_ERRO.ACCOUNTING_CATALOG_ACTIVE_DESCENDANTS, 'Arquive descendentes ativos antes do centro pai.');
      }
      const { rows } = await cliente.query(`update app.centro_custo set nome=$1,tipo=$2,centro_pai=$3,atualizado_em=now() where empresa_id=$4 and codigo=$5 and versao=$6 and not arquivada returning id,versao`, [campos.name,tipoPersistido(campos.type),campos.parentCode,empresaId,codigo,campos.version]);
      if (rows[0] === undefined) throw new ErroDeConflito(CODIGOS_DE_ERRO.ACCOUNTING_CATALOG_VERSION_CONFLICT, 'O centro mudou. Atualize os dados e tente novamente.');
      await this.evento(cliente,ator,empresaId,'CENTRO_CUSTO',rows[0].id,codigo,campos.archived?'ARQUIVAMENTO':'EDICAO',correlationId,campos.version,Number(rows[0].versao));
      return { costCenterId: rows[0].id, version: rows[0].versao };
    });
  }

  historico(ator: AtorCatalogo, empresaId: string, catalogo: Catalogo, codigo: string) {
    return this.contexto(ator, async (cliente) => {
      const { rows } = await cliente.query(`select id,catalogo,acao,resultado,codigo_erro as "errorCode",versao_anterior as "previousVersion",versao_nova as "newVersion",usuario_id as "userId",correlation_id as "correlationId",ocorrido_em as "occurredAt" from app.catalogo_contabil_evento where empresa_id=$1 and catalogo=$2 and codigo_item=$3 order by ocorrido_em desc,sequencia desc limit 100`, [empresaId,catalogo,codigo]);
      return { items: rows };
    });
  }

  async alterarEstado(ator: AtorCatalogo, empresaId: string, catalogo: Catalogo, codigo: string, version: number, arquivada: boolean, correlationId: string) {
    return this.contexto(ator, async (cliente) => {
      await this.travarEmpresa(cliente,empresaId);
      const tabela = catalogo === 'CONTA' ? 'conta_contabil' : 'centro_custo';
      const colunaPai = catalogo === 'CONTA' ? 'conta_pai' : 'centro_pai';
      const { rows: itens } = await cliente.query<{ id: string; version: string; archived: boolean; parentCode: string | null; type: TipoCatalogo; accountClass: ClasseContabil | null; policy: PoliticaCentroCusto | null }>(`select id,versao as version,arquivada as archived,${colunaPai} as "parentCode",case tipo when 'analitica' then 'ANALYTICAL' else 'SYNTHETIC' end as type,${catalogo==='CONTA'?'classe_contabil':'null::text'} as "accountClass",${catalogo==='CONTA'?'politica_centro_custo':'null::text'} as policy from app.${tabela} where empresa_id=$1 and codigo=$2`, [empresaId,codigo]);
      const atual = itens[0];
      if (atual === undefined || Number(atual.version) !== version || atual.archived === arquivada) throw new ErroDeConflito(CODIGOS_DE_ERRO.ACCOUNTING_CATALOG_VERSION_CONFLICT, 'Estado do item mudou. Atualize o catálogo.');
      if (arquivada) {
        const { rows: ativos } = await cliente.query(`with recursive arvore as(select codigo,${colunaPai} as pai,arquivada from app.${tabela} where empresa_id=$1 and ${colunaPai}=$2 union all select f.codigo,f.${colunaPai},f.arquivada from app.${tabela} f join arvore a on f.${colunaPai}=a.codigo where f.empresa_id=$1) select 1 from arvore where not arquivada limit 1`, [empresaId,codigo]);
        if (ativos.length) throw new ErroDeDominio(CODIGOS_DE_ERRO.ACCOUNTING_CATALOG_ACTIVE_DESCENDANTS, 'Arquive descendentes ativos antes do item pai.');
      } else {
        if (catalogo==='CONTA' && atual.accountClass===null) throw new ErroDeDominio(CODIGOS_DE_ERRO.ACCOUNTING_ACCOUNT_CLASS_REQUIRED,'Classifique a conta antes de reativá-la.');
        const { rows: hierarquia } = await cliente.query<{ code: string; parentCode: string | null; type: TipoCatalogo; archived: boolean; accountClass?: ClasseContabil | null }>(`select codigo as code,${colunaPai} as "parentCode",case tipo when 'analitica' then 'ANALYTICAL' else 'SYNTHETIC' end as type,arquivada as archived${catalogo === 'CONTA' ? ',classe_contabil as "accountClass"' : ''} from app.${tabela} where empresa_id=$1`,[empresaId]);
        const erro=validarHierarquia({code:codigo,parentCode:atual.parentCode,type:atual.type,archived:false,accountClass:atual.accountClass},hierarquia,catalogo==='CONTA'&&atual.type==='ANALYTICAL'?(atual.policy??'FORBIDDEN'):'FORBIDDEN');
        if(erro!==null)throw new ErroDeDominio(erro,'Hierarquia incompatível para reativação.');
      }
      await cliente.query(`select set_config('app.catalogo_contabil_transicao','true',true)`);
      const { rows } = await cliente.query(`update app.${tabela} set arquivada=$1,arquivada_em=case when $1 then now() else null end,atualizado_em=now() where empresa_id=$2 and codigo=$3 and versao=$4 returning versao`, [arquivada,empresaId,codigo,version]);
      const proxima = rows[0]?.versao;
      if (proxima === undefined) throw new ErroDeConflito(CODIGOS_DE_ERRO.ACCOUNTING_CATALOG_VERSION_CONFLICT, 'Estado do item mudou. Atualize o catálogo.');
      await this.evento(cliente,ator,empresaId,catalogo,atual.id,codigo,arquivada?'ARQUIVAMENTO':'REATIVACAO',correlationId,version,Number(proxima));
      return { id: atual.id, version: proxima };
    });
  }

  private async evento(cliente: PoolClient, ator: AtorCatalogo, empresaId: string, catalogo: Catalogo, itemId: string | null, codigo: string, acao: string, correlationId: string, versaoAnterior: number | null, versaoNova: number) {
    await cliente.query(`insert into app.catalogo_contabil_evento(tenant_id,empresa_id,catalogo,item_id,codigo_item,acao,resultado,usuario_id,correlation_id,versao_anterior,versao_nova) values($1,$2,$3,$4,$5,$6,'SUCESSO',$7,$8,$9,$10)`, [ator.tenantId,empresaId,catalogo,itemId,codigo,acao,ator.usuarioId,correlationId,versaoAnterior,versaoNova]);
  }
}
