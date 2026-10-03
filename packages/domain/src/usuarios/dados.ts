/**
 * Dados do usuário convidado (SPEC-007 §3.2): nome e e-mail obrigatórios;
 * telefone e CRC opcionais; sem CPF. Função pura: devolve os valores já
 * normalizados ou lança `ErroDeValidacao` com todos os campos inválidos.
 */
import { CODIGOS_DE_ERRO, ErroDeValidacao, type CampoInvalido } from '../erros.js';
import {
  ehEmailValido,
  ehTelefoneValido,
  normalizarEmail,
  normalizarTelefone,
} from '../validadores/contato.js';

export type DadosDoUsuarioDeEntrada = Readonly<{
  nome: string;
  email: string;
  telefone?: string | null | undefined;
  crc?: string | null | undefined;
}>;

export type DadosDoUsuario = Readonly<{
  nome: string;
  email: string;
  telefone: string | null;
  crc: string | null;
}>;

const opcional = (valor: string | null | undefined): string | null => {
  const aparado = valor?.trim() ?? '';

  return aparado === '' ? null : aparado;
};

export const validarDadosDoUsuario = (entrada: DadosDoUsuarioDeEntrada): DadosDoUsuario => {
  const nome = entrada.nome.trim().replace(/\s+/g, ' ');
  const email = normalizarEmail(entrada.email);
  const telefoneInformado = opcional(entrada.telefone);
  const campos: CampoInvalido[] = [];

  if (nome === '') {
    campos.push({ campo: 'nome', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO });
  }

  if (!ehEmailValido(email)) {
    campos.push({ campo: 'email', codigo: CODIGOS_DE_ERRO.EMAIL_INVALIDO });
  }

  if (telefoneInformado !== null && !ehTelefoneValido(telefoneInformado)) {
    campos.push({ campo: 'telefone', codigo: CODIGOS_DE_ERRO.TELEFONE_INVALIDO });
  }

  if (campos.length > 0) {
    throw new ErroDeValidacao(campos);
  }

  return {
    nome,
    email,
    telefone: telefoneInformado === null ? null : normalizarTelefone(telefoneInformado),
    crc: opcional(entrada.crc),
  };
};
