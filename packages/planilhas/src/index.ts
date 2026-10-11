/**
 * `@contaia/planilhas` — leitor seguro de XLSX/ODS (entrada não confiável) e escritor dos modelos
 * (SPEC-015). Só Node: a API e os workers usam; o `apps/web` nunca importa este pacote.
 *
 * Leitura síncrona (`inspecionarPlanilha`, `lerAba`) e detecção do formato pelo conteúdo.
 */
export { CODIGOS_DO_LEITOR, ErroDeInfraestrutura, ErroDePlanilha, type CodigoDoLeitor, type DetalheDoErro } from './erros.ts';
export { inspecionarPlanilha, type Inspecao } from './inspecionar.ts';
export { lerAba } from './ler-aba.ts';
export { LIMITES } from './limites.ts';
export { detectarFormato } from './sniff.ts';
