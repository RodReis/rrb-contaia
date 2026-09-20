'use client';

import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { CHAVE_TEMA } from './script-de-tema';

type Tema = 'light' | 'dark';

const assinantes = new Set<() => void>();

const assinar = (aoMudar: () => void): (() => void) => {
  assinantes.add(aoMudar);

  return () => {
    assinantes.delete(aoMudar);
  };
};

const lerTema = (): Tema =>
  document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';

/**
 * Alterna o tema no `<html>` e persiste a escolha.
 *
 * O tema real é resolvido antes da hidratação pelo script bloqueante, então o
 * servidor não pode saber qual é: `useSyncExternalStore` devolve o padrão claro
 * no HTML e o valor real assim que o cliente assume, sem sincronizar por efeito.
 */
export const AlternarTema = () => {
  const tema = useSyncExternalStore<Tema>(assinar, lerTema, () => 'light');

  const alternar = (): void => {
    const proximo: Tema = tema === 'dark' ? 'light' : 'dark';

    document.documentElement.dataset['theme'] = proximo;

    try {
      localStorage.setItem(CHAVE_TEMA, proximo);
    } catch {
      // Janela privada pode recusar a escrita; o tema da sessão continua valendo.
    }

    for (const aoMudar of assinantes) {
      aoMudar();
    }
  };

  return (
    <Button
      variante="fantasma"
      tamanho="icone"
      onClick={alternar}
      aria-label={tema === 'dark' ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'}
    >
      {tema === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
};
