/**
 * Porta de consulta pública de CNPJ (SPEC-002 §5).
 *
 * O domínio e os casos de uso dependem deste contrato, não do formato da CNPJá:
 * trocar de provedor é escrever outro adaptador, sem tocar em regra.
 *
 * Duas decisões que valem explicitar:
 *
 * 1. **A falha é valor, não exceção.** Indisponibilidade, limite e CNPJ não
 *    encontrado são caminhos previstos que liberam o preenchimento manual
 *    (§3.3). Uma porta que lança obrigaria todo chamador a um `try/catch` e
 *    convidaria a tratar "não encontrado" como erro de sistema.
 * 2. **O regime nunca é inferido.** A fonte pode dizer que a empresa é do
 *    Simples; não dizer nada não significa Presumido nem Real — essa escolha é
 *    humana (§12, "Nunca fazer"). Por isso `simples` é tri-estado e não boolean.
 */

export const MOTIVOS_DE_FALHA_DA_CONSULTA = [
  'nao_encontrado',
  'limite_excedido',
  'indisponivel',
  'resposta_invalida',
] as const;

export type MotivoDeFalhaDaConsulta = (typeof MOTIVOS_DE_FALHA_DA_CONSULTA)[number];

/** Endereço devolvido pela fonte, já nos nomes do produto. */
export type EnderecoConsultado = Readonly<{
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
}>;

/**
 * Somente os campos que esta fatia usa. Tudo o que a fonte devolver além
 * disto — quadro societário incluído — é descartado no adaptador (§3.3).
 */
export type DadosPublicosDoCnpj = Readonly<{
  cnpj: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  situacaoCadastral: string | null;
  cnaePrincipal: string | null;
  cnaesSecundarios: readonly string[];
  telefone: string | null;
  email: string | null;
  endereco: EnderecoConsultado;
  /** `true`/`false` quando a fonte informa; `null` quando não informa. */
  optanteSimples: boolean | null;
  /** `true`/`false` quando a fonte informa; `null` quando não informa. */
  mei: boolean | null;
}>;

export type ConsultaBemSucedida = Readonly<{ ok: true; dados: DadosPublicosDoCnpj }>;

export type ConsultaFalhada = Readonly<{ ok: false; motivo: MotivoDeFalhaDaConsulta }>;

export type ResultadoDaConsulta = ConsultaBemSucedida | ConsultaFalhada;

/** A porta. O adaptador concreto vive na API; o dublê de teste implementa o mesmo tipo. */
export type ConsultaDeCnpj = (cnpj: string) => Promise<ResultadoDaConsulta>;

/**
 * Mensagem exibida quando a consulta falha. Em todos os casos o cadastro segue
 * manualmente e o usuário fica sabendo que o dado não foi validado na fonte.
 */
export const mensagemDaFalhaDaConsulta = (motivo: MotivoDeFalhaDaConsulta): string => {
  switch (motivo) {
    case 'nao_encontrado':
      return 'CNPJ não encontrado na base pública. Confira o número ou preencha os dados manualmente.';
    case 'limite_excedido':
      return 'O limite de consultas à base pública foi atingido. Preencha os dados manualmente por agora.';
    case 'indisponivel':
      return 'A base pública de CNPJ está indisponível. Preencha os dados manualmente.';
    case 'resposta_invalida':
      return 'A base pública devolveu dados em formato inesperado. Preencha os dados manualmente.';
  }
};
