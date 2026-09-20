/**
 * Adaptador da API pública da CNPJá (SPEC-002 §5).
 *
 * O acesso ao provedor acontece só aqui, no servidor: o navegador nunca fala
 * com a CNPJá (§12, "Nunca fazer"). A resposta entra como `unknown`, passa por
 * schema e sai mapeada apenas para os campos que o produto usa — o excedente,
 * quadro societário incluído, é descartado e nunca persistido.
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { normalizarCnpj } from '@contaia/domain';
import type { DadosPublicosDoCnpj, ResultadoDaConsulta } from '@contaia/shared';

const URL_PADRAO = 'https://open.cnpja.com/office';

/**
 * Sem teto de tempo a requisição herda o do runtime e prende a resposta da
 * nossa API junto: o wizard precisa poder desistir e liberar o preenchimento
 * manual (§3.3).
 */
const TIMEOUT_PADRAO_MS = 8_000;

/**
 * Só o que esta fatia consome. `passthrough` não é usado de propósito: campo
 * novo do provedor não deve entrar em objeto nosso por acidente.
 *
 * Tudo é opcional porque a base pública é irregular — CNPJ sem e-mail, sem
 * telefone ou sem inscrição existe, e isso não é resposta inválida.
 */
const enderecoSchema = z
  .object({
    zip: z.string().nullish(),
    street: z.string().nullish(),
    number: z.string().nullish(),
    details: z.string().nullish(),
    district: z.string().nullish(),
    city: z.string().nullish(),
    state: z.string().nullish(),
  })
  .optional();

const atividadeSchema = z.object({ id: z.union([z.string(), z.number()]).nullish() });

const respostaSchema = z.object({
  taxId: z.string().nullish(),
  company: z
    .object({
      name: z.string().nullish(),
      simples: z.object({ optant: z.boolean().nullish() }).nullish(),
      simei: z.object({ optant: z.boolean().nullish() }).nullish(),
    })
    .nullish(),
  alias: z.string().nullish(),
  status: z.object({ text: z.string().nullish() }).nullish(),
  mainActivity: atividadeSchema.nullish(),
  sideActivities: z.array(atividadeSchema).nullish(),
  phones: z
    .array(z.object({ area: z.string().nullish(), number: z.string().nullish() }))
    .nullish(),
  emails: z.array(z.object({ address: z.string().nullish() })).nullish(),
  address: enderecoSchema,
});

const textoOuNulo = (valor: string | null | undefined): string | null => {
  const limpo = valor?.trim() ?? '';

  return limpo.length > 0 ? limpo : null;
};

const codigoDaAtividade = (
  atividade: { id?: string | number | null } | null | undefined,
): string | null => {
  if (atividade?.id === null || atividade?.id === undefined) {
    return null;
  }

  // A fonte devolve o CNAE como número em alguns registros e string em outros.
  return String(atividade.id).replace(/\D/gu, '') || null;
};

const mapear = (bruto: z.infer<typeof respostaSchema>, cnpj: string): DadosPublicosDoCnpj => {
  const telefone = bruto.phones?.[0];
  const numeroDeTelefone =
    telefone === undefined
      ? null
      : textoOuNulo(`${telefone.area ?? ''}${telefone.number ?? ''}`.replace(/\D/gu, ''));

  return {
    cnpj,
    razaoSocial: textoOuNulo(bruto.company?.name),
    nomeFantasia: textoOuNulo(bruto.alias),
    situacaoCadastral: textoOuNulo(bruto.status?.text),
    cnaePrincipal: codigoDaAtividade(bruto.mainActivity),
    cnaesSecundarios: (bruto.sideActivities ?? [])
      .map(codigoDaAtividade)
      .filter((codigo): codigo is string => codigo !== null),
    telefone: numeroDeTelefone,
    email: textoOuNulo(bruto.emails?.[0]?.address)?.toLowerCase() ?? null,
    endereco: {
      cep: textoOuNulo(bruto.address?.zip)?.replace(/\D/gu, '') ?? null,
      logradouro: textoOuNulo(bruto.address?.street),
      numero: textoOuNulo(bruto.address?.number),
      complemento: textoOuNulo(bruto.address?.details),
      bairro: textoOuNulo(bruto.address?.district),
      municipio: textoOuNulo(bruto.address?.city),
      uf: textoOuNulo(bruto.address?.state)?.toUpperCase() ?? null,
    },
    // Tri-estado de propósito: ausência de informação não é "não optante".
    // Quem decide Presumido ou Real é o usuário (§3.3 e §12).
    optanteSimples: bruto.company?.simples?.optant ?? null,
    mei: bruto.company?.simei?.optant ?? null,
  };
};

@Injectable()
export class ConsultaDeCnpjNaCnpja {
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor() {
    this.url = process.env['CNPJA_URL'] ?? URL_PADRAO;
    const configurado = Number(process.env['CNPJA_TIMEOUT_MS']);
    this.timeoutMs = Number.isFinite(configurado) && configurado > 0
      ? configurado
      : TIMEOUT_PADRAO_MS;
  }

  async consultar(cnpjInformado: string): Promise<ResultadoDaConsulta> {
    const cnpj = normalizarCnpj(cnpjInformado);
    // `AbortSignal.timeout` aborta a requisição pendurada; sem ele o `fetch`
    // espera o servidor decidir e o usuário espera junto.
    const controlador = AbortSignal.timeout(this.timeoutMs);

    let resposta: Response;

    try {
      resposta = await fetch(`${this.url}/${cnpj}`, {
        headers: { accept: 'application/json' },
        signal: controlador,
      });
    } catch {
      // Timeout, DNS, TLS, rede: do ponto de vista do produto é o mesmo caso —
      // a fonte não respondeu e o preenchimento manual continua disponível.
      return { ok: false, motivo: 'indisponivel' };
    }

    if (resposta.status === 404) {
      return { ok: false, motivo: 'nao_encontrado' };
    }

    if (resposta.status === 429) {
      return { ok: false, motivo: 'limite_excedido' };
    }

    if (!resposta.ok) {
      return { ok: false, motivo: 'indisponivel' };
    }

    let corpo: unknown;

    try {
      corpo = await resposta.json();
    } catch {
      return { ok: false, motivo: 'resposta_invalida' };
    }

    const analisado = respostaSchema.safeParse(corpo);

    if (!analisado.success) {
      return { ok: false, motivo: 'resposta_invalida' };
    }

    return { ok: true, dados: mapear(analisado.data, cnpj) };
  }
}
