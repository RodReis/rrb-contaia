/**
 * Apoio da prova E2E da SPEC-015 (XLSX e ODS no plano de contas e nos empregados). A mecânica de API,
 * banco, fila, armazenamento, provas visuais e axe é a das SPEC-013/014 (`./plano-contas`); aqui fica o
 * que é de planilha: envio e inspeção multipart, planilhas montadas na execução e as reais.
 *
 * - **Reais (LibreOffice):** `packages/planilhas/fixtures/{plano-contas,empregados}-libreoffice.{xlsx,ods}`.
 *   Um XLSX montado pelo construtor do pacote (título na linha 1, linha 2 em branco, cabeçalho na 3,
 *   linha 6 oculta, fórmula na B7 e numa coluna não mapeada, mescla B8:C8 e numa não mapeada) foi
 *   regravado pelo LibreOffice 24 com `soffice --headless --convert-to xlsx|ods`; os ODS têm três abas
 *   (uma antiga, a de dados na posição 2 e uma vazia). A CI só lê os bytes.
 * - **Montadas na execução** (nunca no repositório): equivalência CSV × XLSX × ODS, arquivos hostis,
 *   acima de 10 MB e de 10.000 linhas, com os construtores de `@contaia/planilhas/testes` (lidos do
 *   `dist`, que o `pnpm build` da CI gera antes do E2E).
 */
import type { Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// O projeto raiz não depende dos pacotes do workspace: os construtores vêm do build do pacote.
import {
  abaXml,
  cfb,
  entradaBomba,
  planilhaOds,
  planilhaXlsx,
  xlsx,
  xlsxCru,
  type AbaDeTeste,
} from '../../../packages/planilhas/dist/testes/index.js';
import { type Recurso, type Resposta } from './plano-contas';

export const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const TIPO_ODS = 'application/vnd.oasis.opendocument.spreadsheet';

export type Arquivo = Readonly<{ nome: string; conteudo: Buffer; tipo?: string }>;
export type Configuracao = Readonly<{ aba?: number; linhaCabecalho?: number }>;

const PASTA_DAS_PLANILHAS = resolve('packages/planilhas/fixtures');

export type PlanilhaReal =
  | 'plano-contas-libreoffice.xlsx'
  | 'plano-contas-libreoffice.ods'
  | 'empregados-libreoffice.xlsx'
  | 'empregados-libreoffice.ods'
  | 'libreoffice.xls';

export const caminhoDaPlanilha = (nome: PlanilhaReal): string => resolve(PASTA_DAS_PLANILHAS, nome);
export const planilhaReal = (nome: PlanilhaReal): Arquivo => ({ nome, conteudo: readFileSync(caminhoDaPlanilha(nome)) });

const tipoDoNome = (nome: string): string =>
  nome.endsWith('.ods') ? TIPO_ODS : nome.endsWith('.xlsx') ? TIPO_XLSX : 'application/octet-stream';

/** Mapeamento por letra (planilha): os cinco campos nas colunas A..E, na ordem do modelo. */
export const mapeamentoPorLetra = (campos: readonly string[]): Record<string, string> =>
  Object.fromEntries(campos.map((campo, indice) => [campo, String.fromCharCode(65 + indice)]));

export const CAMPOS_DO_PLANO = ['codigo', 'nome', 'tipo', 'natureza', 'conta_pai'] as const;
export const CAMPOS_DOS_EMPREGADOS = ['cpf', 'nome', 'matricula', 'data_nascimento', 'data_admissao'] as const;

const lerResposta = async (resposta: Awaited<ReturnType<Page['request']['post']>>): Promise<Resposta> => {
  const texto = await resposta.text();
  let corpo: unknown = null;

  try {
    corpo = JSON.parse(texto) as unknown;
  } catch {
    corpo = null;
  }

  return { status: resposta.status(), corpo, texto };
};

const campos = (configuracao: Configuracao): Record<string, string> => ({
  ...(configuracao.aba === undefined ? {} : { aba: String(configuracao.aba) }),
  ...(configuracao.linhaCabecalho === undefined ? {} : { linhaCabecalho: String(configuracao.linhaCabecalho) }),
});

/** `POST …/planilhas/inspecao` pelo proxy da Web: o mesmo multipart que a tela monta. */
export const inspecionarPelaApi = async (
  page: Page,
  empresaId: string,
  recurso: Recurso,
  arquivo: Arquivo,
  configuracao: Configuracao = {},
  correlationId: string = randomUUID(),
): Promise<Resposta> =>
  lerResposta(
    await page.request.post(`/api/proxy/empresas/${empresaId}/${recurso}/planilhas/inspecao`, {
      headers: { 'x-correlation-id': correlationId },
      multipart: {
        arquivo: { name: arquivo.nome, mimeType: arquivo.tipo ?? tipoDoNome(arquivo.nome), buffer: arquivo.conteudo },
        ...campos(configuracao),
      },
      timeout: 120_000,
    }),
  );

/** `POST …/importacoes` com a configuração da planilha (aba e linha do cabeçalho) e o mapeamento por letra. */
export const enviarPlanilhaPelaApi = async (
  page: Page,
  empresaId: string,
  recurso: Recurso,
  arquivo: Arquivo,
  mapeamento: Readonly<Record<string, string>>,
  configuracao: Configuracao,
  correlationId: string = randomUUID(),
): Promise<Resposta> =>
  lerResposta(
    await page.request.post(`/api/proxy/empresas/${empresaId}/${recurso}/importacoes`, {
      headers: { 'x-correlation-id': correlationId },
      multipart: {
        arquivo: { name: arquivo.nome, mimeType: arquivo.tipo ?? tipoDoNome(arquivo.nome), buffer: arquivo.conteudo },
        mapeamento: JSON.stringify(mapeamento),
        ...campos(configuracao),
      },
      timeout: 120_000,
    }),
  );

// -- Planilhas montadas na execução --------------------------------------------------------------

/** Célula de XLSX: texto, número com estilo do construtor (1 data, 2 máscara de CPF, 3 `00000`) ou data nativa. */
export type Celula = string | Readonly<{ numero: number; estilo?: 1 | 2 | 3 }> | Readonly<{ data: string }>;

const serialDaData = (iso: string): number => {
  const [ano, mes, dia] = iso.split('-').map(Number);

  return (Date.UTC(ano ?? 0, (mes ?? 1) - 1, dia ?? 1) - Date.UTC(1899, 11, 30)) / 86_400_000;
};

const escapar = (texto: string): string => texto.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

const celulaXml = (referencia: string, celula: Celula): string => {
  if (typeof celula === 'string') {
    return celula === '' ? '' : `<c r="${referencia}" t="inlineStr"><is><t>${escapar(celula)}</t></is></c>`;
  }
  if ('data' in celula) {
    return `<c r="${referencia}" s="1"><v>${serialDaData(celula.data)}</v></c>`;
  }

  return `<c r="${referencia}"${celula.estilo === undefined ? '' : ` s="${celula.estilo}"`}><v>${celula.numero}</v></c>`;
};

/** XLSX de uma aba com células tipadas (data nativa, número com máscara), cabeçalho na linha 1. */
export const xlsxComCelulas = (nomeDaAba: string, linhas: readonly (readonly Celula[])[], ocultas: readonly number[] = []): Buffer =>
  Buffer.from(
    xlsx({
      abas: [
        {
          nome: nomeDaAba,
          xml: abaXml(
            linhas
              .map(
                (celulas, indice) =>
                  `<row r="${indice + 1}"${ocultas.includes(indice + 1) ? ' hidden="1"' : ''}>${celulas
                    .map((celula, coluna) => celulaXml(`${String.fromCharCode(65 + coluna)}${indice + 1}`, celula))
                    .join('')}</row>`,
              )
              .join(''),
          ),
        },
      ],
    }),
  );

/** Mesma tabela (cabeçalho na linha 1) como aba de teste do montador, com linhas ocultas. */
export const abaDeTexto = (nome: string, linhas: readonly (readonly string[])[], ocultas: readonly number[] = []): AbaDeTeste => ({
  nome,
  linhas: linhas.map((valores, indice) => ({ numero: indice + 1, valores, oculta: ocultas.includes(indice + 1) })),
});

export const csvDe = (linhas: readonly (readonly string[])[]): Buffer =>
  Buffer.from(`${linhas.map((linha) => linha.join(';')).join('\r\n')}\r\n`, 'utf8');

/** Lê um CSV de fixture (`;`, CRLF, UTF-8 com BOM ou Latin-1) como linhas de texto. */
export const linhasDoCsv = (bytes: Buffer, codificacao: 'utf8' | 'latin1' = 'utf8'): string[][] =>
  bytes
    .toString(codificacao)
    .replace(/^﻿/u, '')
    .split(/\r?\n/u)
    .filter((linha) => linha !== '')
    .map((linha) => linha.split(';'));

export const xlsxDeTexto = (aba: AbaDeTeste): Buffer => planilhaXlsx(aba);
export const odsDeTexto = (...abas: AbaDeTeste[]): Buffer => planilhaOds(...abas);

export type ArquivosHostis = Readonly<{
  /** Envelope CFB de OOXML criptografado com extensão `.xlsx`. */
  criptografado: Arquivo;
  /** XLSX válido cortado ao meio: ZIP sem diretório central. */
  corrompido: Arquivo;
  /** Texto CSV com extensão `.xlsx`. */
  extensaoTrocada: Arquivo;
  /** XLSX com macro (`vbaProject.bin`), com a extensão `.xlsm` e renomeado para `.xlsx`. */
  comMacro: Arquivo;
  comMacroRenomeado: Arquivo;
  /** `.xls` real do LibreOffice (BIFF8), com o nome dele e renomeado para `.xlsx`. */
  xls: Arquivo;
  xlsRenomeado: Arquivo;
  /** Bomba de ZIP: os sharedStrings declaram 4 KB e expandem para 200 MiB. */
  bomba: Arquivo;
  /** Acima de 10 MB (uma entrada sem compressão de bytes aleatórios). */
  acimaDoTamanho: Arquivo;
  /** 10.001 linhas de dados na aba: a recusa é pela quantidade. */
  acimaDasLinhas: Arquivo;
  /** Cabeçalho com A1:B1 mesclado; a linha 2 serve de cabeçalho alternativo. */
  cabecalhoMesclado: Arquivo;
}>;

/** Arquivos hostis e de limite, montados na execução para um domínio (o cabeçalho é o do modelo). */
export const arquivosHostis = (cabecalho: readonly string[], linhaDeDados: readonly string[]): ArquivosHostis => {
  const bom = xlsxDeTexto(abaDeTexto('Dados', [cabecalho, linhaDeDados]));
  const xlsReal = readFileSync(caminhoDaPlanilha('libreoffice.xls'));
  const comMacro = Buffer.from(
    xlsx({ macro: true, abas: [{ nome: 'Dados', xml: abaXml('<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row>') }] }),
  );
  const linhasDemais = [cabecalho, ...Array.from({ length: 10_001 }, () => linhaDeDados)];

  return {
    criptografado: { nome: 'protegida.xlsx', conteudo: Buffer.from(cfb('EncryptionInfo', 'EncryptedPackage')) },
    corrompido: { nome: 'corrompida.xlsx', conteudo: bom.subarray(0, Math.floor(bom.length / 2)) },
    extensaoTrocada: { nome: 'na-verdade-csv.xlsx', conteudo: csvDe([cabecalho, linhaDeDados]) },
    comMacro: { nome: 'com-macro.xlsm', conteudo: comMacro, tipo: 'application/vnd.ms-excel.sheet.macroEnabled.12' },
    comMacroRenomeado: { nome: 'com-macro.xlsx', conteudo: comMacro },
    xls: { nome: 'antiga.xls', conteudo: xlsReal, tipo: 'application/vnd.ms-excel' },
    xlsRenomeado: { nome: 'antiga.xlsx', conteudo: xlsReal },
    bomba: { nome: 'bomba.xlsx', conteudo: Buffer.from(xlsxCru([entradaBomba('xl/sharedStrings.xml', 200, 4_096)])) },
    acimaDoTamanho: {
      nome: 'acima-de-10mb.xlsx',
      conteudo: Buffer.from(
        xlsx({
          abas: [{ nome: 'Dados', xml: abaXml('<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c></row>') }],
          extras: [{ nome: 'xl/media/anexo.bin', dados: new Uint8Array(randomBytes(10 * 1024 * 1024 + 64 * 1024)), metodo: 0 }],
        }),
      ),
    },
    acimaDasLinhas: { nome: 'acima-de-10000-linhas.xlsx', conteudo: xlsxDeTexto(abaDeTexto('Dados', linhasDemais)) },
    cabecalhoMesclado: {
      nome: 'cabecalho-mesclado.xlsx',
      conteudo: planilhaXlsx({
        nome: 'Dados',
        linhas: [
          { numero: 1, valores: [cabecalho[0] ?? '', '', ...cabecalho.slice(2)] },
          { numero: 2, valores: cabecalho },
          { numero: 3, valores: linhaDeDados },
        ],
        mesclas: ['A1:B1'],
      }),
    },
  };
};
