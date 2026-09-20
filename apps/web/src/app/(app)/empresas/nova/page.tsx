import { ConsultaDeCnpj } from '@/features/empresa/consulta-de-cnpj';

export const metadata = {
  title: 'Cadastrar empresa — ContaIA',
  description: 'Consulta do CNPJ e início do cadastro da empresa cliente.',
};

export default function PaginaDeNovaEmpresa() {
  return <ConsultaDeCnpj />;
}
