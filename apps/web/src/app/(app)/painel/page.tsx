import { redirect } from 'next/navigation';

/**
 * O painel era o lugar provisório da carteira de empresas na SPEC-001 §3.3,
 * com estado vazio e sem CTA funcional. A SPEC-002 entrega a listagem real em
 * `/empresas`; esta rota continua existindo porque é o destino do fim do
 * cadastro do escritório e pode estar em favorito de quem usou a F1.
 */
export default function PaginaDoPainel() {
  redirect('/empresas');
}
