/** Chamadas ao backend do cadastro do escritório. */
import type {
  CadastroDoEscritorio,
  EnderecoDoEscritorio,
  EtapaDoCadastro,
} from '@contaia/domain';
import type { TipoDeArquivo } from '@contaia/shared';

import { requisitar } from '@/lib/http';
import type { EnderecoForm, IdentificacaoForm, ResponsavelForm } from './schema';

export type ArquivoDaVisao = Readonly<{
  id: string;
  tipo: TipoDeArquivo;
  nomeOriginal: string;
  tipoConteudo: string;
  tamanhoBytes: number;
}>;

export type VisaoDoCadastro = Readonly<{
  tenantId: string;
  cadastro: CadastroDoEscritorio;
  etapasConcluidas: readonly EtapaDoCadastro[];
  proximaEtapa: EtapaDoCadastro | null;
  enderecos: readonly (EnderecoDoEscritorio & { id: string; principal: boolean })[];
  arquivos: readonly ArquivoDaVisao[];
}>;

const comJson = (corpo: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(corpo),
});

export const obterCadastro = (): Promise<VisaoDoCadastro> => requisitar('/escritorio');

export const salvarIdentificacao = (dados: IdentificacaoForm): Promise<VisaoDoCadastro> =>
  requisitar('/escritorio/identificacao', comJson(dados));

export const salvarResponsavel = (dados: ResponsavelForm): Promise<VisaoDoCadastro> =>
  requisitar('/escritorio/responsavel', comJson(dados));

export const salvarEndereco = (dados: EnderecoForm): Promise<VisaoDoCadastro> =>
  requisitar('/escritorio/endereco', comJson({ ...dados, complemento: dados.complemento ?? null }));

export const enviarArquivo = (
  tipo: TipoDeArquivo,
  arquivo: File,
): Promise<VisaoDoCadastro> => {
  const formulario = new FormData();

  formulario.append('arquivo', arquivo);

  return requisitar(tipo === 'LOGO' ? '/escritorio/logo' : '/escritorio/documentos', {
    method: 'POST',
    body: formulario,
  });
};

export const arquivarDocumento = (id: string): Promise<VisaoDoCadastro> =>
  requisitar(`/escritorio/documentos/${id}`, { method: 'DELETE' });

export const concluirCadastro = (): Promise<VisaoDoCadastro> =>
  requisitar('/escritorio/conclusao', { method: 'POST' });
