import { Building2 } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/estados';

export const metadata = {
  title: 'Painel — ContaIA',
  description: 'Visão inicial do escritório contábil.',
};

/**
 * Visão inicial do tenant ativo (SPEC-001 §3.3). O CTA funcional de cadastrar
 * empresa chega na fatia própria; aqui a ação existente é a que já funciona:
 * revisar o cadastro do escritório.
 */
export default function PaginaDoPainel() {
  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-col gap-xs">
        <h1 className="font-display text-headline-lg text-foreground">Empresas</h1>
        <p className="max-w-prose text-body-md text-muted-foreground">
          Carteira de empresas clientes atendidas por este escritório.
        </p>
      </header>

      <EmptyState
        icone={<Building2 />}
        titulo="Nenhuma empresa cadastrada"
        descricao="Quando houver empresas na carteira, elas aparecerão aqui com o semáforo fiscal e as obrigações do período."
        acao={
          <Button asChild variante="contorno" tamanho="compacto">
            <Link href="/escritorio">Revisar cadastro do escritório</Link>
          </Button>
        }
      />
    </div>
  );
}
