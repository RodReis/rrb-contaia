import type { Pool } from 'pg';

type Dependencias = Readonly<{ schedulerPool: Pool; intervaloMs?: number }>;
type Fechavel = Readonly<{ fechar: () => Promise<void> }>;

export const iniciarAgendadorDeAlertasDeProcuracao = (
  deps: Dependencias,
): Fechavel => {
  let rodando = false;
  const executar = async (): Promise<void> => {
    if (rodando) return;
    rodando = true;
    try {
      await deps.schedulerPool.query(
        'select app.rfb_procuracao_emitir_alertas()',
      );
    } catch (erro) {
      console.error(
        JSON.stringify({
          event: 'rfb-procuracao-alert-scheduler-error',
          name: erro instanceof Error ? erro.name : 'UnknownError',
        }),
      );
    } finally {
      rodando = false;
    }
  };

  const timer = setInterval(() => void executar(), deps.intervaloMs ?? 60_000);
  void executar();
  return {
    fechar: async () => {
      clearInterval(timer);
      while (rodando) await new Promise((resolve) => setTimeout(resolve, 10));
    },
  };
};
