/**
 * Dados e utilitários de prova para as telas do cofre (SPEC-011). Só os testes
 * importam este arquivo: ele não entra no bundle.
 *
 * Nenhum material criptográfico real ou de teste existe aqui. O "arquivo" do
 * certificado é um `File` com bytes sentinela, e a senha é um valor sentinela:
 * os testes provam que nenhum dos dois aparece em requisição, DOM ou log fora do
 * envio direto ao cofre.
 */
import type {
  CertificadoMetadados,
  DetalheDoCofre,
  EstadoNoCofre,
  ItemDoCofre,
  PaginaDoCofre,
  ResumoDoCofre,
} from '@contaia/shared';
import { vi } from 'vitest';

export { Envolvido, instalarFetch, json, problema } from '../carteira/carteira.fixtures';
export type { Roteador } from '../carteira/carteira.fixtures';

export const SENHA_SENTINELA = 'senha-sentinela-do-cofre-NAO-VAZAR';
export const COFRE_URL = 'http://127.0.0.1:15104';

export const arquivoDeCertificado = (nome = 'empresa.pfx', bytes = 2048): File =>
  new File([new Uint8Array(bytes)], nome, { type: 'application/x-pkcs12' });

export const certificado = (
  sobrescritas: Partial<CertificadoMetadados> = {},
): CertificadoMetadados => ({
  id: 'cert-1',
  versao: 1,
  estado: 'VIGENTE',
  titular: 'PADARIA AURORA LTDA:11222333000181',
  cnpjTitular: '11222333000181',
  autoridadeCertificadora: 'AC Raiz de Teste ContaIA',
  impressaoDigital: 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855',
  numeroSerie: '0A1B2C3D4E5F',
  validoDe: '2026-01-10',
  validoAte: '2027-01-10',
  responsavelId: 'ana',
  cadastradoEm: '2026-09-20T14:30:00.000Z',
  cadastradoPorId: 'ana',
  encerradoEm: null,
  encerradoPorId: null,
  motivoDoEncerramento: null,
  justificativa: null,
  substituidoPorId: null,
  ...sobrescritas,
});

export const item = (
  sobrescritas: Partial<ItemDoCofre> & Pick<ItemDoCofre, 'empresaId' | 'empresaNome'>,
): ItemDoCofre => ({
  cnpj: '11222333000181',
  regime: 'Lucro Presumido',
  estado: 'VALIDO',
  diasParaVencer: 120,
  semResponsavel: false,
  certificado: certificado(),
  responsavel: { id: 'ana', nome: 'Ana Lima', email: 'ana@escritorio.com', situacao: 'ATIVO' },
  acoes: ['SUBSTITUIR', 'TROCAR_RESPONSAVEL', 'DESATIVAR'],
  ...sobrescritas,
});

/** Um item por estado que a SPEC-011 §5.3 exige provar. */
export const PADARIA = item({ empresaId: 'e-valido', empresaNome: 'Padaria Aurora' });

export const ITEM_D30 = item({
  empresaId: 'e-d30',
  empresaNome: 'Mercado Trinta',
  cnpj: '22333444000172',
  estado: 'VENCE_D30',
  diasParaVencer: 28,
  certificado: certificado({ id: 'c-d30', validoAte: '2026-10-31' }),
});

export const ITEM_D15 = item({
  empresaId: 'e-d15',
  empresaNome: 'Oficina Quinze',
  estado: 'VENCE_D15',
  diasParaVencer: 14,
  certificado: certificado({ id: 'c-d15', validoAte: '2026-10-17' }),
});

export const ITEM_D7 = item({
  empresaId: 'e-d7',
  empresaNome: 'Farmácia Sete',
  estado: 'VENCE_D7',
  diasParaVencer: 1,
  certificado: certificado({ id: 'c-d7', validoAte: '2026-10-04' }),
});

export const ITEM_VENCIDO = item({
  empresaId: 'e-vencido',
  empresaNome: 'Solaris Bioenergia do Brasil',
  cnpj: '09112871000288',
  estado: 'VENCIDO',
  diasParaVencer: -3,
  certificado: certificado({ id: 'c-venc', validoAte: '2026-09-30' }),
});

export const ITEM_SEM_CERTIFICADO = item({
  empresaId: 'e-sem',
  empresaNome: 'Nexus Cloud Soluções',
  cnpj: '33784092000119',
  regime: 'Simples Nacional',
  estado: 'SEM_CERTIFICADO',
  diasParaVencer: null,
  certificado: null,
  responsavel: null,
  acoes: ['CADASTRAR'],
});

export const ITEM_DESATIVADO = item({
  empresaId: 'e-desativado',
  empresaNome: 'Mineração Serra Alta',
  cnpj: '54912304000170',
  estado: 'DESATIVADO',
  diasParaVencer: null,
  certificado: certificado({
    id: 'c-desat',
    estado: 'DESATIVADO',
    encerradoEm: '2026-09-25T12:00:00.000Z',
    motivoDoEncerramento: 'DESATIVACAO',
    justificativa: 'Titular trocou de certificadora.',
  }),
  responsavel: null,
  acoes: ['CADASTRAR'],
});

export const ITEM_SEM_RESPONSAVEL = item({
  empresaId: 'e-sem-resp',
  empresaNome: 'Transportes Boa Viagem',
  cnpj: '44555666000133',
  semResponsavel: true,
  certificado: certificado({ id: 'c-semresp', responsavelId: 'bruno' }),
  responsavel: { id: 'bruno', nome: 'Bruno Prado', email: 'bruno@escritorio.com', situacao: 'INATIVO' },
});

export const ITEM_SO_CONSULTA = item({
  empresaId: 'e-consulta',
  empresaNome: 'Clínica Somente Leitura',
  acoes: [],
});

export const RESUMO: ResumoDoCofre = {
  total: 488,
  validos: 400,
  vencendo: 4,
  vencidos: 3,
  semCertificado: 70,
  desativados: 11,
  semResponsavel: 2,
};

export const pagina = (
  itens: readonly ItemDoCofre[],
  sobrescritas: Partial<PaginaDoCofre> = {},
): PaginaDoCofre => ({
  resumo: RESUMO,
  itens,
  total: itens.length,
  pagina: 1,
  limite: 25,
  ...sobrescritas,
});

export const detalhe = (
  base: ItemDoCofre,
  versoes: readonly CertificadoMetadados[] = base.certificado === null ? [] : [base.certificado],
): DetalheDoCofre => ({ item: base, versoes });

export const SESSAO_DO_COFRE = {
  papeis: ['contador'],
  permissoes: [
    'empresas.cadastro.consultar',
    'certificados.cofre.consultar',
    'certificados.cofre.criar',
    'certificados.cofre.substituir',
    'certificados.cofre.editar',
    'certificados.cofre.desativar',
    'certificados.historico.consultar',
  ],
  escopoDeEmpresas: 'CARTEIRA',
} as const;

export const SESSAO_SO_CONSULTA = {
  papeis: ['auxiliar'],
  permissoes: ['certificados.cofre.consultar'],
  escopoDeEmpresas: 'CARTEIRA',
} as const;

export const ESTADOS_DA_SPEC: readonly EstadoNoCofre[] = [
  'SEM_CERTIFICADO',
  'VALIDO',
  'VENCE_D30',
  'VENCE_D15',
  'VENCE_D7',
  'VENCIDO',
  'DESATIVADO',
];

// -- XMLHttpRequest dublado --------------------------------------------------

export type EnvioRegistrado = {
  metodo: string;
  url: string;
  withCredentials: boolean;
  cabecalhos: Record<string, string>;
  campos: Record<string, FormDataEntryValue>;
  ordemDosCampos: string[];
};

/**
 * Dublê do `XMLHttpRequest` que o envio direto ao cofre usa. Registra o que foi
 * enviado e deixa o teste decidir o desfecho (progresso, resposta, erro de rede).
 */
export class XhrDublado {
  static ultimo: XhrDublado | null = null;
  static envios: EnvioRegistrado[] = [];

  status = 0;
  responseText = '';
  withCredentials = false;
  timeout = 0;
  upload: { onprogress: ((evento: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  registro: EnvioRegistrado = {
    metodo: '',
    url: '',
    withCredentials: false,
    cabecalhos: {},
    campos: {},
    ordemDosCampos: [],
  };

  constructor() {
    XhrDublado.ultimo = this;
  }

  open(metodo: string, url: string): void {
    this.registro.metodo = metodo;
    this.registro.url = url;
  }

  setRequestHeader(nome: string, valor: string): void {
    this.registro.cabecalhos[nome.toLowerCase()] = valor;
  }

  getResponseHeader(): string | null {
    return null;
  }

  send(corpo: FormData): void {
    this.registro.withCredentials = this.withCredentials;
    corpo.forEach((valor, chave) => {
      this.registro.campos[chave] = valor;
      this.registro.ordemDosCampos.push(chave);
    });
    XhrDublado.envios.push(this.registro);
  }

  progresso(carregado: number, total: number): void {
    this.upload.onprogress?.({ lengthComputable: true, loaded: carregado, total } as ProgressEvent);
  }

  responder(status: number, corpo: unknown): void {
    this.status = status;
    this.responseText = JSON.stringify(corpo);
    this.onload?.();
  }

  falharNaRede(): void {
    this.onerror?.();
  }
}

export const instalarXhr = (): void => {
  XhrDublado.ultimo = null;
  XhrDublado.envios = [];
  vi.stubGlobal('XMLHttpRequest', XhrDublado);
};
