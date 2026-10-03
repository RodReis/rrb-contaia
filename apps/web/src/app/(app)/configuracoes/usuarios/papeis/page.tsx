import { redirect } from 'next/navigation';

/**
 * `/configuracoes/usuarios/papeis` sozinho cairia em `[usuarioId]` ("papeis" como
 * id de usuário). A lista de papéis é a aba `Papéis e permissões` da área.
 */
export default function PaginaDePapeis() {
  redirect('/configuracoes/usuarios?aba=papeis');
}
