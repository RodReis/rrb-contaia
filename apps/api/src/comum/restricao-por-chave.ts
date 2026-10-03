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

import type { ExigenciaNaVisao, VisaoDosDocumentos } from '../empresa/documentos.service';

const tem = (permissoes: readonly ChaveDePermissao[], chave: ChaveDePermissao): boolean =>
  permissoes.includes(chave);

/**
 * Aprovado e rejeitado são o veredito da análise: sem a consulta de análise o
 * documento aparece como enviado — o arquivo chegou, o resultado não é revelado.
 * O motivo da rejeição sai junto; o da dispensa pertence à exigência e permanece.
 */
const semAnalise = (exigencia: ExigenciaNaVisao): ExigenciaNaVisao => {
  const veredito = exigencia.estado === 'APROVADO' || exigencia.estado === 'REJEITADO';

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

/** `chave` aponta para a origem da pendência (campo ou exigência): só sai com `abrir_origem`. */
export const restringirPendencia = <T extends Readonly<{ chave: string }>>(
  permissoes: readonly ChaveDePermissao[],
  pendencia: T,
): T =>
  tem(permissoes, 'pendencias.pendencias.abrir_origem') ? pendencia : { ...pendencia, chave: '' };
