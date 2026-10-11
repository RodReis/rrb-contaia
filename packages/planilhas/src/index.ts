/**
 * `@contaia/planilhas` — leitor seguro de XLSX/ODS (entrada não confiável) e escritor dos modelos
 * (SPEC-015). Só Node: a API e os workers usam; o `apps/web` nunca importa este pacote.
 *
 * Toda leitura de arquivo enviado passa por `lerPlanilhaIsolada` (processo filho com teto de memória,
 * tempo e saída). `inspecionarPlanilha` e `lerAba` são síncronos e existem para o filho e os testes.
 */
export {
  CODIGOS_DO_LEITOR,
  ErroDeInfraestrutura,
  ErroDePlanilha,
  type CodigoDoLeitor,
  type DetalheDoErro,
  type MotivoDaInfraestrutura,
} from './erros.ts';
export { inspecionarPlanilha, type Inspecao } from './inspecionar.ts';
export { lerPlanilhaIsolada, type OpcoesDoIsolamento } from './isolado.ts';
export { lerAba } from './ler-aba.ts';
export { LIMITES } from './limites.ts';
export { gerarModelo } from './modelos.ts';
export type { OperacaoDePlanilha } from './protocolo.ts';
export { detectarFormato } from './sniff.ts';
