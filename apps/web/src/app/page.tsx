import { redirect } from 'next/navigation';

/** A raiz leva ao acesso; o shell decide para onde a sessão segue. */
export default function Raiz() {
  redirect('/acesso');
}
