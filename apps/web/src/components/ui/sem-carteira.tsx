/**
 * Estado vazio de quem não tem empresas na carteira (SPEC-007 §3.1). Não é filtro nem
 * carteira vazia: é falta de alçada, e dizer "sem pendências" ou "sem notificações" a quem
 * não enxerga empresa nenhuma enganaria sobre a situação fiscal do escritório.
 */
import { Lock } from 'lucide-react';

import { EmptyState } from '@/components/ui/estados';

const DESCRICAO_PADRAO =
  'Quando houver empresas atribuídas à sua carteira, elas aparecem aqui. Enquanto isso, você acessa apenas as áreas que não dependem de uma empresa.';

export const SemCarteira = ({
  nivel = 2,
  descricao = DESCRICAO_PADRAO,
}: {
  nivel?: 2 | 3;
  descricao?: string;
}) => (
  <EmptyState
    nivel={nivel}
    icone={<Lock />}
    titulo="Você ainda não tem empresas na sua carteira"
    descricao={descricao}
  />
);
