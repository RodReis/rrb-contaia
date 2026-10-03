/**
 * Leitura granular no servidor (SPEC-008 §3.2, pré-requisito da F9).
 *
 * Até a carteira, só o administrador alcançava empresas, e a posse da chave de
 * consulta bastava. Com a carteira, um papel personalizado alcança empresas mas
 * pode não ter `documentos.arquivos.consultar`, `documentos.analise.consultar` ou
 * `pendencias.pendencias.abrir_origem`. A resposta da API é que esconde o dado —
 * a tela só acompanha o que o servidor entrega.
 */
import type { ChaveDePermissao } from '@contaia/domain';

import type { EventoDocumentalNaLista } from '@contaia/db';

import type { ExigenciaNaVisao, VisaoDosDocumentos } from '../empresa/documentos.service';

/** Estados que só existem depois da análise: sem `analise.consultar` aparecem como "enviado". */
const VEREDITOS: readonly string[] = ['APROVADO', 'REJEITADO', 'VENCIDO'];

const tem = (permissoes: readonly ChaveDePermissao[], chave: ChaveDePermissao): boolean =>
  permissoes.includes(chave);

/**
 * Aprovado e rejeitado são o veredito da análise: sem a consulta de análise o
 * documento aparece como enviado — o arquivo chegou, o resultado não é revelado.
 * O motivo da rejeição sai junto; o da dispensa pertence à exigência e permanece.
 */
const semAnalise = (exigencia: ExigenciaNaVisao): ExigenciaNaVisao => {
  // VENCIDO só nasce de um documento APROVADO: mostrá-lo revelaria a aprovação.
  const veredito = VEREDITOS.includes(exigencia.estado);

  return {
    ...exigencia,
    estado: veredito ? 'ENVIADO' : exigencia.estado,
    justificativa: exigencia.estado === 'REJEITADO' ? null : exigencia.justificativa,
  };
};

export const restringirDocumentos = (
  permissoes: readonly ChaveDePermissao[],
  visao: VisaoDosDocumentos,
): VisaoDosDocumentos => {
  const comArquivos = tem(permissoes, 'documentos.arquivos.consultar');
  const comAnalise = tem(permissoes, 'documentos.analise.consultar');

  if (comArquivos && comAnalise) {
    return visao;
  }

  return {
    ...visao,
    exigencias: visao.exigencias.map((exigencia) => {
      const visivel = comAnalise ? exigencia : semAnalise(exigencia);

      return comArquivos ? visivel : { ...visivel, versoes: [] };
    }),
  };
};

/** Tipos que dizem o resultado da análise do documento: sem `analise.consultar` viram "nova pendência". */
const TIPOS_DE_VEREDITO: readonly string[] = ['DOCUMENTO_REJEITADO', 'DOCUMENTO_VENCIDO'];

/**
 * Pendência e notificação de pendência: `chave` aponta para a origem (campo ou exigência) e só
 * sai com `abrir_origem`; o `tipo` que revela o veredito da análise só sai com `analise.consultar`.
 * O aviso consolidado de carteira não tem origem nem análise e passa intacto.
 */
export const restringirPendencia = <T extends Readonly<{ chave: string; tipo?: string }>>(
  permissoes: readonly ChaveDePermissao[],
  pendencia: T,
): T => {
  if (pendencia.tipo === 'CARTEIRA_ALTERADA') {
    return pendencia;
  }

  const podeAbrirOrigem = tem(permissoes, 'pendencias.pendencias.abrir_origem');
  const podeVerVeredito =
    tem(permissoes, 'documentos.analise.consultar') ||
    pendencia.tipo === undefined ||
    !TIPOS_DE_VEREDITO.includes(pendencia.tipo);

  if (podeAbrirOrigem && podeVerVeredito) {
    return pendencia;
  }

  return {
    ...pendencia,
    ...(podeAbrirOrigem ? {} : { chave: '' }),
    ...(podeVerVeredito ? {} : { tipo: 'NOVA_PENDENCIA' }),
  };
};

const ACOES_DE_ANALISE: readonly string[] = ['APROVACAO', 'REJEICAO', 'VENCIMENTO'];
const ACOES_DE_ARQUIVO: readonly string[] = ['VISUALIZACAO', 'DOWNLOAD'];

/**
 * Histórico documental com a mesma regra das exigências: sem `analise.consultar` somem os eventos
 * de aprovação, rejeição e vencimento, e o estado vira "enviado" onde aparecia o veredito; sem
 * `arquivos.consultar` somem os acessos a arquivo e o número da versão.
 */
export const restringirHistoricoDocumental = (
  permissoes: readonly ChaveDePermissao[],
  pagina: Readonly<{ eventos: readonly EventoDocumentalNaLista[]; total: number }>,
): Readonly<{ eventos: readonly EventoDocumentalNaLista[]; total: number }> => {
  const comAnalise = tem(permissoes, 'documentos.analise.consultar');
  const comArquivos = tem(permissoes, 'documentos.arquivos.consultar');

  if (comAnalise && comArquivos) {
    return pagina;
  }

  const visiveis = pagina.eventos.filter(
    (evento) =>
      (comAnalise || !ACOES_DE_ANALISE.includes(evento.acao)) &&
      (comArquivos || !ACOES_DE_ARQUIVO.includes(evento.acao)),
  );
  const estado = (valor: EventoDocumentalNaLista['estadoNovo']) =>
    valor !== null && VEREDITOS.includes(valor) ? 'ENVIADO' : valor;

  return {
    total: Math.max(0, pagina.total - (pagina.eventos.length - visiveis.length)),
    eventos: visiveis.map((evento) => ({
      ...evento,
      ...(comAnalise
        ? {}
        : {
            estadoAnterior: estado(evento.estadoAnterior),
            estadoNovo: estado(evento.estadoNovo),
            justificativa: evento.acao === 'DISPENSA' ? evento.justificativa : null,
          }),
      ...(comArquivos ? {} : { versaoNumero: null }),
    })),
  };
};
