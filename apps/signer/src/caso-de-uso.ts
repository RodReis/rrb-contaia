/**
 * Caso de uso do Signer (SPEC-012 §3.2–§3.11). Controla as transações; o servidor HTTP só valida o
 * contrato e delega. Três fases, e o segredo só existe na segunda:
 *
 *   1. (transação) contexto → condição do certificado → conteúdo do XML → idempotência;
 *   2. (fora de transação) Vault → assinatura → verificação → UMA saída mTLS (`execucao.ts`);
 *   3. (transação) estado final da operação + evento de auditoria.
 *
 * Recusas da fase 1 gravam o evento e SÓ DEPOIS viram erro: lançar dentro da transação desfaria a
 * própria trilha.
 */
import {
  buscarCertificadoParaUso,
  buscarOperacaoPorChave,
  comContexto,
  criarOperacao,
  empresaVisivel,
  finalizarOperacao,
  historicoDoSigner,
  reabrirOperacao,
  registrarEventoDoSigner,
  ultimosEventosDasFinalidades,
  type CertificadoParaUso,
  type EventoDoSigner,
  type OperacaoDoSigner,
  type TipoDeOperacao,
} from '@contaia/db';
import {
  certificadoUtilizavel,
  contextoTecnico,
  dataCivilEmSaoPaulo,
  decidirIdempotencia,
  estadoDaFinalidade,
  FINALIDADES,
  piorEstado,
  type Finalidade,
} from '@contaia/domain';
import {
  ITENS_POR_PAGINA_DO_HISTORICO,
  type ComandoAssinar,
  type ComandoDiagnosticar,
  type ComandoExecutarMtls,
  type ConsultaEstados,
  type ConsultaHistorico,
  type EstadoDaEmpresaNoSigner,
  type EstadoPorFinalidade,
  type RespostaDeAssinatura,
  type RespostaDeEstados,
  type RespostaDeExecucaoMtls,
  type RespostaDeHistorico,
} from '@contaia/shared';
import type { Pool, PoolClient } from 'pg';

import type { IdentidadeDeServico } from './alcada.js';
import { xmlDeDiagnostico } from './diagnostico.js';
import { ErroDoSigner, type CodigoDoSigner } from './erro.js';
import { executarComSegredo, type DependenciasDaExecucao, type Desfecho } from './execucao.js';
import { chaveProtegida, hashDoConteudo } from './idempotencia.js';
import { criarServicosDeSaude, type ServicosDoSigner } from './servicos.js';
import { ADAPTADORES } from './xml/adaptadores.js';
import { prepararParaAssinar } from './xml/seguranca.js';

export type DependenciasDoCasoDeUso = DependenciasDaExecucao &
  Readonly<{
    pool: Pool;
    pepper: string;
    agora: () => Date;
  }>;

type Pedido = Readonly<{
  tipo: TipoDeOperacao;
  identidade: IdentidadeDeServico;
  tenantId: string;
  empresaId: string;
  finalidade: Finalidade;
  correlationId: string;
  usuarioOriginadorId: string | null;
  chaveIdempotente: string;
  /** O diagnóstico monta o XML só depois de conhecer o CNPJ da empresa. */
  xml: string | ((cnpj: string) => string);
  origemDiagnostico: 'AUTOMATICO' | 'MANUAL' | null;
}>;

type Resultado = Readonly<{ operacaoId: string; reutilizado: boolean; xmlAssinado: string | null }>;

/** O que varia entre os eventos; o resto sai do pedido. */
type ExtraDoEvento = Readonly<{
  inicio: Date;
  resultado: EventoDoSigner['resultado'];
  codigo: string | null;
  reutilizado: boolean;
}> &
  Partial<Pick<EventoDoSigner, 'operacaoId' | 'referenciaSegredo' | 'hashConteudo' | 'chaveHmac'>>;

type ContextoDoEvento = Partial<Pick<EventoDoSigner, 'referenciaSegredo' | 'hashConteudo' | 'chaveHmac'>>;

type Fase1 =
  | Readonly<{ tipo: 'RECUSADA'; erro: ErroDoSigner }>
  | Readonly<{ tipo: 'REUTILIZADA'; operacao: OperacaoDoSigner }>
  | Readonly<{
      tipo: 'EXECUTAR';
      operacaoId: string;
      certificado: CertificadoParaUso;
      xml: string;
      hash: string;
      inicio: Date;
    }>;

/** Recusas por erro do chamador ou do estado do certificado não alteram a saúde do serviço. */
const CODIGOS_DE_RECUSA = new Set<CodigoDoSigner>([
  'SIGNER_CERTIFICADO_AUSENTE',
  'SIGNER_CERTIFICADO_DESATIVADO',
  'SIGNER_CERTIFICADO_VENCIDO',
  'SIGNER_CERTIFICADO_AINDA_NAO_VIGENTE',
  'SIGNER_XML_INVALIDO',
  'SIGNER_IDEMPOTENCIA_CONFLITO',
  'SIGNER_CONTEXTO_INVALIDO',
  'SIGNER_FINALIDADE_INVALIDA',
]);

const UNIQUE_VIOLATION = '23505';

const resultadoDoEvento = (estado: 'CONCLUIDA' | 'RECUSADA' | 'FALHA_TRANSITORIA', codigo: string | null): EventoDoSigner['resultado'] => {
  if (estado === 'CONCLUIDA') {
    return 'SUCESSO';
  }

  return CODIGOS_DE_RECUSA.has(codigo as CodigoDoSigner) ? 'RECUSA' : 'FALHA';
};

export const criarServicosDoSigner = (deps: DependenciasDoCasoDeUso): ServicosDoSigner => {
  const saude = criarServicosDeSaude({ vault: deps.vault, agora: deps.agora });
  const comoSigner = <T>(pedido: Pedido, executar: (cliente: PoolClient) => Promise<T>): Promise<T> =>
    comContexto(
      deps.pool,
      contextoTecnico({
        identidadeTecnica: 'signer',
        finalidade: 'PROCESSAMENTO_DE_EMPRESA',
        tenantId: pedido.tenantId,
        empresaId: pedido.empresaId,
        correlationId: pedido.correlationId,
      }),
      executar,
    );

  const evento = (pedido: Pedido, extra: ExtraDoEvento): EventoDoSigner => {
    const fim = deps.agora();
    const { inicio, ...resto } = extra;

    return {
      tenantId: pedido.tenantId,
      empresaId: pedido.empresaId,
      operacaoId: null,
      finalidade: pedido.finalidade,
      referenciaSegredo: null,
      identidadeTecnica: pedido.identidade,
      usuarioOriginadorId: pedido.usuarioOriginadorId,
      hashConteudo: null,
      chaveHmac: null,
      iniciadoEm: inicio,
      finalizadoEm: fim,
      latenciaMs: Math.max(0, fim.getTime() - inicio.getTime()),
      correlationId: pedido.correlationId,
      origemDiagnostico: pedido.origemDiagnostico,
      ...resto,
    };
  };

  /** Registra a recusa na própria transação e DEVOLVE o erro: ele só é lançado depois do commit. */
  const recusar = async (
    cliente: PoolClient,
    pedido: Pedido,
    codigo: CodigoDoSigner,
    inicio: Date,
    contexto: ContextoDoEvento = {},
  ): Promise<Fase1> => {
    await registrarEventoDoSigner(
      cliente,
      evento(pedido, { resultado: 'RECUSA', codigo, reutilizado: false, inicio, ...contexto }),
    );

    return { tipo: 'RECUSADA', erro: new ErroDoSigner(codigo) };
  };

  const iniciar = (pedido: Pedido, chaveHmac: string): Promise<Fase1> =>
    comoSigner(pedido, async (cliente) => {
      const inicio = deps.agora();

      if (!(await empresaVisivel(cliente, pedido.empresaId))) {
        // Tenant e empresa não casam (ou a empresa não existe): nada a registrar nem a revelar.
        throw new ErroDoSigner('SIGNER_CONTEXTO_INVALIDO', 403);
      }

      const certificado = await buscarCertificadoParaUso(cliente, pedido.empresaId);
      const condicao =
        certificado === null
          ? ({ ok: false, codigo: 'SIGNER_CERTIFICADO_AUSENTE' } as const)
          : certificadoUtilizavel(certificado, dataCivilEmSaoPaulo(inicio));

      if (certificado === null || !condicao.ok) {
        return recusar(cliente, pedido, condicao.ok ? 'SIGNER_CERTIFICADO_AUSENTE' : condicao.codigo, inicio);
      }

      const xml = typeof pedido.xml === 'function' ? pedido.xml(certificado.cnpjDaEmpresa) : pedido.xml;
      const hash = hashDoConteudo(xml);
      const contexto = { hashConteudo: hash, chaveHmac, referenciaSegredo: certificado.referenciaSegredo };

      try {
        prepararParaAssinar(xml, ADAPTADORES[pedido.finalidade]);
      } catch (erro) {
        if (erro instanceof ErroDoSigner) {
          return recusar(cliente, pedido, erro.codigo, inicio, contexto);
        }
        throw erro;
      }

      return decidir(cliente, pedido, { chaveHmac, hash, certificado, xml, inicio, contexto }, 2);
    });

  type Contexto = Readonly<{
    chaveHmac: string;
    hash: string;
    certificado: CertificadoParaUso;
    xml: string;
    inicio: Date;
    contexto: ContextoDoEvento;
  }>;

  const decidir = async (cliente: PoolClient, pedido: Pedido, c: Contexto, tentativasRestantes: number): Promise<Fase1> => {
    const existente = await buscarOperacaoPorChave(cliente, c.chaveHmac);
    // Chave de uma operação de outro tipo (assinar × mTLS) não é "a mesma operação".
    const decisao =
      existente !== null && existente.tipo !== pedido.tipo
        ? ({ tipo: 'CONFLITO' } as const)
        : decidirIdempotencia(existente, {
            tenantId: pedido.tenantId,
            empresaId: pedido.empresaId,
            finalidade: pedido.finalidade,
            hashConteudo: c.hash,
          });

    switch (decisao.tipo) {
      case 'CONFLITO':
        return recusar(cliente, pedido, 'SIGNER_IDEMPOTENCIA_CONFLITO', c.inicio, c.contexto);
      case 'EM_ANDAMENTO':
        return { tipo: 'RECUSADA', erro: new ErroDoSigner('SIGNER_OPERACAO_EM_ANDAMENTO') };
      case 'REUTILIZAR': {
        const operacao = existente as OperacaoDoSigner;
        await registrarEventoDoSigner(
          cliente,
          evento(pedido, {
            resultado: resultadoDoEvento(operacao.estado === 'RECUSADA' ? 'RECUSADA' : 'CONCLUIDA', operacao.resultadoCodigo),
            codigo: operacao.resultadoCodigo,
            reutilizado: true,
            inicio: c.inicio,
            operacaoId: operacao.id,
            ...c.contexto,
          }),
        );

        return { tipo: 'REUTILIZADA', operacao };
      }
      case 'RETENTAR': {
        // A operação registra a versão EXATA do certificado da primeira tentativa (SPEC-012 §3.5).
        // Depois de uma rotação a mesma chave não retoma com outro certificado: é outra operação.
        if ((existente as OperacaoDoSigner).referenciaSegredo !== c.certificado.referenciaSegredo) {
          return recusar(cliente, pedido, 'SIGNER_IDEMPOTENCIA_CONFLITO', c.inicio, c.contexto);
        }
        // Duas retomadas ao mesmo tempo: a que perde a corrida não executa, espera como "em andamento".
        if (!(await reabrirOperacao(cliente, decisao.operacaoId))) {
          return { tipo: 'RECUSADA', erro: new ErroDoSigner('SIGNER_OPERACAO_EM_ANDAMENTO') };
        }

        return { tipo: 'EXECUTAR', operacaoId: decisao.operacaoId, certificado: c.certificado, xml: c.xml, hash: c.hash, inicio: c.inicio };
      }
      case 'NOVA':
        return criarEExecutar(cliente, pedido, c, tentativasRestantes);
    }
  };

  const criarEExecutar = async (cliente: PoolClient, pedido: Pedido, c: Contexto, tentativasRestantes: number): Promise<Fase1> => {
    await cliente.query('savepoint nova_operacao');

    try {
      const operacaoId = await criarOperacao(cliente, {
        tenantId: pedido.tenantId,
        empresaId: pedido.empresaId,
        finalidade: pedido.finalidade,
        tipo: pedido.tipo,
        chaveHmac: c.chaveHmac,
        hashConteudo: c.hash,
        certificadoId: c.certificado.certificadoId,
        referenciaSegredo: c.certificado.referenciaSegredo,
        identidadeTecnica: pedido.identidade,
        usuarioOriginadorId: pedido.usuarioOriginadorId,
        correlationId: pedido.correlationId,
      });

      return { tipo: 'EXECUTAR', operacaoId, certificado: c.certificado, xml: c.xml, hash: c.hash, inicio: c.inicio };
    } catch (erro) {
      if ((erro as { code?: string }).code !== UNIQUE_VIOLATION) {
        throw erro;
      }

      await cliente.query('rollback to savepoint nova_operacao');

      // A colisão espera o outro commit. Se a linha agora é visível, é a MESMA operação (duplicata
      // concorrente) e a decisão se refaz; se continua invisível, a chave é de OUTRO escopo.
      if (tentativasRestantes > 1 && (await buscarOperacaoPorChave(cliente, c.chaveHmac)) !== null) {
        return decidir(cliente, pedido, c, tentativasRestantes - 1);
      }

      return recusar(cliente, pedido, 'SIGNER_IDEMPOTENCIA_CONFLITO', c.inicio, c.contexto);
    }
  };

  const concluir = (
    pedido: Pedido,
    fase: Extract<Fase1, { tipo: 'EXECUTAR' }>,
    chaveHmac: string,
    desfecho: Desfecho,
  ): Promise<void> =>
    comoSigner(pedido, async (cliente) => {
      const codigo = desfecho.estado === 'CONCLUIDA' ? null : desfecho.codigo;

      // Outra execução da mesma operação já a finalizou (retomada por prazo): a trilha dela vale.
      if (!(await finalizarOperacao(cliente, fase.operacaoId, { estado: desfecho.estado, codigo }))) {
        return;
      }

      await registrarEventoDoSigner(
        cliente,
        evento(pedido, {
          resultado: resultadoDoEvento(desfecho.estado, codigo),
          codigo,
          reutilizado: false,
          inicio: fase.inicio,
          operacaoId: fase.operacaoId,
          referenciaSegredo: fase.certificado.referenciaSegredo,
          hashConteudo: fase.hash,
          chaveHmac,
        }),
      );
    });

  /** Orquestra as três fases e traduz o desfecho em resposta ou erro estável. */
  const executar = async (pedido: Pedido): Promise<Resultado> => {
    const chaveHmac = chaveProtegida(pedido.chaveIdempotente, deps.pepper);
    const fase = await iniciar(pedido, chaveHmac);

    if (fase.tipo === 'RECUSADA') {
      throw fase.erro;
    }
    if (fase.tipo === 'REUTILIZADA') {
      if (fase.operacao.estado === 'RECUSADA') {
        throw new ErroDoSigner((fase.operacao.resultadoCodigo ?? 'SIGNER_INDISPONIVEL') as CodigoDoSigner);
      }

      return { operacaoId: fase.operacao.id, reutilizado: true, xmlAssinado: null };
    }

    const desfecho = await executarComSegredo(deps, {
      tipo: pedido.tipo,
      tenantId: pedido.tenantId,
      empresaId: pedido.empresaId,
      finalidade: pedido.finalidade,
      operacaoId: fase.operacaoId,
      certificado: fase.certificado,
      xml: fase.xml,
    });

    await concluir(pedido, fase, chaveHmac, desfecho);

    if (desfecho.estado !== 'CONCLUIDA') {
      throw new ErroDoSigner(desfecho.codigo);
    }

    return { operacaoId: fase.operacaoId, reutilizado: false, xmlAssinado: desfecho.xmlAssinado };
  };

  /** Contexto técnico da empresa para uma consulta: tenant e empresa que não casam são recusados. */
  const comoSignerDaEmpresa = <T>(
    tenantId: string,
    empresaId: string,
    correlationId: string,
    executar: (cliente: PoolClient) => Promise<T>,
  ): Promise<T> =>
    comContexto(
      deps.pool,
      contextoTecnico({
        identidadeTecnica: 'signer',
        finalidade: 'PROCESSAMENTO_DE_EMPRESA',
        tenantId,
        empresaId,
        correlationId,
      }),
      async (cliente) => {
        if (!(await empresaVisivel(cliente, empresaId))) {
          throw new ErroDoSigner('SIGNER_CONTEXTO_INVALIDO', 403);
        }

        return executar(cliente);
      },
    );

  const estadoDaEmpresa = (consulta: ConsultaEstados, empresaId: string): Promise<EstadoDaEmpresaNoSigner> =>
    comoSignerDaEmpresa(consulta.tenantId, empresaId, consulta.correlationId, async (cliente) => {
      const certificado = await buscarCertificadoParaUso(cliente, empresaId);
      const utilizavel = certificado !== null && certificadoUtilizavel(certificado, dataCivilEmSaoPaulo(deps.agora())).ok;
      const ultimos = await ultimosEventosDasFinalidades(cliente, empresaId);

      const finalidades = FINALIDADES.map((finalidade): EstadoPorFinalidade => {
        const ultimo = ultimos.find((evento) => evento.finalidade === finalidade);

        return {
          finalidade,
          estado: estadoDaFinalidade({ certificadoUtilizavel: utilizavel, ultimoResultado: ultimo?.resultado ?? null }),
          ultimoTesteEm: ultimo?.iniciadoEm.toISOString() ?? null,
          latenciaMs: ultimo?.latenciaMs ?? null,
          codigo: ultimo?.codigo ?? null,
        };
      });

      return { empresaId, finalidades, resumo: piorEstado(finalidades.map((f) => f.estado)) };
    });

  /** Uma transação por empresa (o contexto RLS é de uma só); a ordem do lote é preservada. */
  const estadosEmLote = async (consulta: ConsultaEstados): Promise<RespostaDeEstados> => {
    const empresas: EstadoDaEmpresaNoSigner[] = [];

    for (const empresaId of consulta.empresaIds) {
      empresas.push(await estadoDaEmpresa(consulta, empresaId));
    }

    return { empresas };
  };

  const historicoDaEmpresa = (consulta: ConsultaHistorico): Promise<RespostaDeHistorico> =>
    comoSignerDaEmpresa(consulta.tenantId, consulta.empresaId, consulta.correlationId, async (cliente) => {
      const pagina = await historicoDoSigner(cliente, {
        empresaId: consulta.empresaId,
        pagina: consulta.pagina,
        ...(consulta.finalidade === undefined ? {} : { finalidade: consulta.finalidade }),
        ...(consulta.resultado === undefined ? {} : { resultado: consulta.resultado }),
      });

      return {
        pagina: pagina.pagina,
        itensPorPagina: ITENS_POR_PAGINA_DO_HISTORICO,
        total: pagina.total,
        itens: pagina.itens.map((item) => ({ ...item, iniciadoEm: item.iniciadoEm.toISOString() })),
      };
    });

  const comandoOperacional = (
    tipo: TipoDeOperacao,
    identidade: IdentidadeDeServico,
    comando: ComandoAssinar | ComandoExecutarMtls,
  ): Pedido => ({
    tipo,
    identidade,
    tenantId: comando.tenantId,
    empresaId: comando.empresaId,
    finalidade: comando.finalidade,
    correlationId: comando.correlationId,
    usuarioOriginadorId: comando.usuarioOriginadorId ?? null,
    chaveIdempotente: comando.chaveIdempotente,
    xml: comando.xml,
    origemDiagnostico: null,
  });

  const emSucesso = (resultado: Resultado): RespostaDeExecucaoMtls => ({
    operacaoId: resultado.operacaoId,
    reutilizado: resultado.reutilizado,
    resultado: 'SUCESSO',
    codigo: null,
  });

  return {
    saude: () => saude.saude(),
    async assinar(identidade, comando): Promise<RespostaDeAssinatura> {
      const resultado = await executar(comandoOperacional('ASSINATURA', identidade, comando));

      return { operacaoId: resultado.operacaoId, reutilizado: resultado.reutilizado, xmlAssinado: resultado.xmlAssinado };
    },
    async executarMtls(identidade, comando) {
      return emSucesso(await executar(comandoOperacional('MTLS', identidade, comando)));
    },
    async diagnosticar(identidade, comando: ComandoDiagnosticar) {
      return emSucesso(
        await executar({
          tipo: 'DIAGNOSTICO',
          identidade,
          tenantId: comando.tenantId,
          empresaId: comando.empresaId,
          finalidade: comando.finalidade,
          correlationId: comando.correlationId,
          usuarioOriginadorId: comando.usuarioOriginadorId ?? null,
          // Cada execução do diagnóstico tem a sua correlação: a repetição do MESMO job reutiliza.
          chaveIdempotente: `diag:${comando.correlationId}:${comando.finalidade}`,
          xml: (cnpj) => xmlDeDiagnostico(comando.finalidade, cnpj, comando.correlationId),
          origemDiagnostico: comando.origem,
        }),
      );
    },
    estados: (_identidade, consulta) => estadosEmLote(consulta),
    historico: (_identidade, consulta) => historicoDaEmpresa(consulta),
  };
};
