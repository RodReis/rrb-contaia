/**
 * Simulador (SPEC-016 §5.2 item 5): abas `Preenchimento manual` e `NF-e de teste`, a aba na URL. As
 * duas ficam montadas, e a inativa só escondida: trocar de aba não descarta o que foi preenchido
 * nem o arquivo analisado. As duas entradas convergem para o mesmo cálculo no servidor.
 */
'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { Abas, ConteudoDeAba, GatilhoDeAba, ListaDeAbas } from '@/components/ui/abas';
import { FormularioManual } from './formulario-manual';
import { FormularioNfe } from './formulario-nfe';
import { CAMINHO_DO_MOTOR } from './use-filtro-do-catalogo';

type NomeDaAba = 'manual' | 'nfe';

const ESCONDER_INATIVA = 'data-[state=inactive]:hidden';

export const Simulador = () => {
  const navegador = useRouter();
  const parametros = useSearchParams();
  const aba: NomeDaAba = parametros.get('simulador') === 'nfe' ? 'nfe' : 'manual';

  const trocar = (valor: string): void => {
    const proximos = new URLSearchParams(parametros.toString());

    if (valor === 'nfe') {
      proximos.set('simulador', 'nfe');
    } else {
      proximos.delete('simulador');
    }

    const texto = proximos.toString();

    navegador.replace(texto === '' ? CAMINHO_DO_MOTOR : `${CAMINHO_DO_MOTOR}?${texto}`, { scroll: false });
  };

  return (
    <Abas value={aba} onValueChange={trocar} className="flex flex-col gap-md">
      <ListaDeAbas aria-label="Forma de entrada da simulação">
        <GatilhoDeAba value="manual">Preenchimento manual</GatilhoDeAba>
        <GatilhoDeAba value="nfe">NF-e de teste</GatilhoDeAba>
      </ListaDeAbas>
      <ConteudoDeAba value="manual" forceMount className={ESCONDER_INATIVA}>
        <FormularioManual />
      </ConteudoDeAba>
      <ConteudoDeAba value="nfe" forceMount className={ESCONDER_INATIVA}>
        <FormularioNfe />
      </ConteudoDeAba>
    </Abas>
  );
};
