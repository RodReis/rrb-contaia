/**
 * Fase com segredo de uma operação (SPEC-012 §3.4, §3.6–§3.7): lê o PKCS#12 do Vault, assina,
 * valida a assinatura produzida e — se for o caso — faz a UMA tentativa de saída mTLS. Roda FORA
 * de transação de banco: o segredo existe só aqui, em memória, e o buffer é zerado ao terminar.
 *
 * Só chega aqui depois que identidade, alçada, contexto, condição do certificado, conteúdo do XML
 * e idempotência já passaram — nada disso é decidido neste arquivo.
 */
import type { Finalidade } from '@contaia/domain';
import type { CertificadoParaUso, TipoDeOperacao } from '@contaia/db';

import type { Destino, EntradaDoDestino, ResultadoDoDestino } from './destino.js';
import { ErroDoSigner, type CodigoDoSigner } from './erro.js';
import { impressaoDigitalDoCertificado } from './idempotencia.js';
import { ErroDoVault, type LeitorDoVault, type SegredoLido } from './vault.js';
import { ADAPTADORES } from './xml/adaptadores.js';
import { assinarXml } from './xml/assinar.js';
import { abrirPkcs12ParaAssinar } from './xml/pkcs12.js';
import { verificarXmlAssinado } from './xml/verificar.js';

export type Desfecho =
  | Readonly<{ estado: 'CONCLUIDA'; xmlAssinado: string }>
  | Readonly<{ estado: 'RECUSADA' | 'FALHA_TRANSITORIA'; codigo: CodigoDoSigner }>;

export type DependenciasDaExecucao = Readonly<{
  vault: LeitorDoVault;
  chamarDestino: (entrada: EntradaDoDestino) => Promise<ResultadoDoDestino>;
  destinos: Readonly<Record<Finalidade, Destino>>;
  caDosDublesPem: string;
  tempoLimiteDoDestinoMs: number;
}>;

export type EntradaDaExecucao = Readonly<{
  tipo: TipoDeOperacao;
  tenantId: string;
  empresaId: string;
  finalidade: Finalidade;
  operacaoId: string;
  certificado: CertificadoParaUso;
  xml: string;
}>;

const recusada = (codigo: CodigoDoSigner): Desfecho => ({ estado: 'RECUSADA', codigo });
const transitoria = (codigo: CodigoDoSigner): Desfecho => ({ estado: 'FALHA_TRANSITORIA', codigo });

const desfechoDoDestino = (resultado: ResultadoDoDestino, xmlAssinado: string): Desfecho => {
  switch (resultado.tipo) {
    case 'ACEITO':
      return { estado: 'CONCLUIDA', xmlAssinado };
    case 'RECUSADO':
      return recusada('SIGNER_MTLS_RECUSADO');
    case 'FALHA_DE_TLS':
      // O operador corrige a confiança ou a rotação; a mesma chave precisa poder voltar.
      return transitoria('SIGNER_MTLS_RECUSADO');
    case 'INDISPONIVEL':
      return transitoria('SIGNER_DESTINO_INDISPONIVEL');
  }
};

/** Qualquer exceção vira desfecho com código estável: a causa nunca sai (pode citar o segredo). */
const desfechoDoErro = (erro: unknown): Desfecho => {
  if (erro instanceof ErroDoVault) {
    // A F11 desativa por soft delete: a versão apagada devolve 404.
    return erro.tipo === 'NAO_ENCONTRADO' ? recusada('SIGNER_CERTIFICADO_DESATIVADO') : transitoria('SIGNER_VAULT_INDISPONIVEL');
  }
  if (erro instanceof ErroDoSigner && erro.codigo === 'SIGNER_ASSINATURA_INVALIDA') {
    return recusada('SIGNER_ASSINATURA_INVALIDA');
  }

  console.error(JSON.stringify({ evento: 'erro-na-execucao', classe: (erro as Error)?.name ?? 'desconhecida' }));

  return transitoria('SIGNER_INDISPONIVEL');
};

export const executarComSegredo = async (
  deps: DependenciasDaExecucao,
  entrada: EntradaDaExecucao,
): Promise<Desfecho> => {
  const { certificado, finalidade } = entrada;
  let segredo: SegredoLido | null = null;

  try {
    segredo = await deps.vault.ler({
      tenantId: entrada.tenantId,
      empresaId: entrada.empresaId,
      referencia: certificado.referenciaSegredo,
    });

    const { chavePem, certificadoPem } = abrirPkcs12ParaAssinar(segredo.pkcs12, segredo.senha);

    // O que o Vault entregou precisa ser o certificado cadastrado: nunca assina com outro.
    if (impressaoDigitalDoCertificado(certificadoPem) !== certificado.impressaoDigital) {
      return transitoria('SIGNER_VAULT_INDISPONIVEL');
    }

    const adaptador = ADAPTADORES[finalidade];
    const xmlAssinado = assinarXml({ xml: entrada.xml, adaptador, chavePem, certificadoPem });

    // A assinatura produzida é verificada ANTES de qualquer saída de rede.
    if (!verificarXmlAssinado({ xmlAssinado, certificadoPem, adaptador })) {
      return recusada('SIGNER_ASSINATURA_INVALIDA');
    }
    if (entrada.tipo === 'ASSINATURA') {
      return { estado: 'CONCLUIDA', xmlAssinado };
    }

    const resultado = await deps.chamarDestino({
      destino: deps.destinos[finalidade],
      pfx: segredo.pkcs12,
      senha: segredo.senha,
      caPem: deps.caDosDublesPem,
      // Estável entre tentativas da mesma operação: o destino deduplica o efeito por ela.
      idempotencyKey: entrada.operacaoId,
      cnpj: certificado.cnpjDaEmpresa,
      xml: xmlAssinado,
      tempoLimiteMs: deps.tempoLimiteDoDestinoMs,
    });

    return desfechoDoDestino(resultado, xmlAssinado);
  } catch (erro) {
    return desfechoDoErro(erro);
  } finally {
    segredo?.pkcs12.fill(0);
  }
};
