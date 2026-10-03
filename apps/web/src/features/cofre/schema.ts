/**
 * Formulários do cofre (SPEC-011 §3.1, §3.4 e §5.2). Empresa, arquivo, senha e
 * responsável são obrigatórios; o motivo da desativação também.
 *
 * A senha vive só no estado do formulário, em memória, e é limpa depois do envio.
 * Este schema não a normaliza, não a corta e não a registra.
 */
import { z } from 'zod';

import { validarArquivoDoCertificado } from './envio';
import type { CampoDoEnvio } from './apresentacao';

export const ERRO_DE_EMPRESA = 'Escolha a empresa do certificado.';
export const ERRO_DE_ARQUIVO = 'Escolha o arquivo do certificado (.pfx ou .p12).';
export const ERRO_DE_SENHA = 'Informe a senha do certificado.';
export const ERRO_DE_RESPONSAVEL = 'Escolha o responsável pelo certificado.';
export const ERRO_DE_MOTIVO = 'Informe o motivo da desativação.';

export const LIMITE_DO_MOTIVO = 500;

export const envioSchema = z.object({
  empresaId: z.string().min(1, ERRO_DE_EMPRESA),
  // `File` não se serializa: a regra do arquivo é a mesma do cofre, aplicada antes da rede.
  arquivo: z.custom<File | null>().superRefine((arquivo, contexto) => {
    if (!(arquivo instanceof File)) {
      contexto.addIssue({ code: 'custom', message: ERRO_DE_ARQUIVO });

      return;
    }

    const falha = validarArquivoDoCertificado(arquivo);

    if (falha !== null) {
      contexto.addIssue({ code: 'custom', message: falha });
    }
  }),
  // Sem `.trim()`: espaço pode fazer parte da senha do contêiner.
  senha: z.string().min(1, ERRO_DE_SENHA),
  responsavelId: z.string().min(1, ERRO_DE_RESPONSAVEL),
});

export type ValoresDoEnvio = z.infer<typeof envioSchema>;

export const VALORES_VAZIOS: ValoresDoEnvio = {
  empresaId: '',
  arquivo: null,
  senha: '',
  responsavelId: '',
};

/** Campo do formulário que corresponde a cada campo de recusa. */
export const CAMPO_DO_FORMULARIO: Readonly<Record<CampoDoEnvio, keyof ValoresDoEnvio>> = {
  empresa: 'empresaId',
  arquivo: 'arquivo',
  senha: 'senha',
  responsavel: 'responsavelId',
};

/** Ordem visual dos campos: o foco vai para o primeiro inválido nessa ordem. */
export const ORDEM_DOS_CAMPOS: readonly CampoDoEnvio[] = [
  'empresa',
  'arquivo',
  'senha',
  'responsavel',
];

export const motivoSchema = z.string().trim().min(1, ERRO_DE_MOTIVO).max(LIMITE_DO_MOTIVO);
