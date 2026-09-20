'use client';

import * as Tabs from '@radix-ui/react-tabs';

import { formatarCep } from '@contaia/domain';

import { cn } from '@/lib/cn';
import { FormularioEndereco } from './formulario-endereco';
import { FormularioIdentificacao } from './formulario-identificacao';
import { FormularioResponsavel } from './formulario-responsavel';
import { UploadDeArquivo } from './upload-de-arquivo';
import type { VisaoDoCadastro } from './api';

const ABAS = [
  { id: 'identificacao', rotulo: 'Identificação' },
  { id: 'responsavel', rotulo: 'Responsável' },
  { id: 'enderecos', rotulo: 'Endereços' },
  { id: 'arquivos', rotulo: 'Arquivos' },
] as const;

// Ativo e inativo têm a mesma métrica de fonte: no protótipo a troca de peso
// mudava a largura e deslocava o layout (COMPONENTS.md §2.5).
const CLASSES_DA_ABA = [
  'flex-1 rounded-md px-md py-sm text-title-sm transition-colors duration-fast ease-out',
  'text-muted-foreground hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  'data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-[var(--elevation-1)]',
];

export const AbasDeEdicao = ({ visao }: { visao: VisaoDoCadastro }) => {
  const logo = visao.arquivos.find((arquivo) => arquivo.tipo === 'LOGO');
  const documentos = visao.arquivos.filter((arquivo) => arquivo.tipo === 'DOCUMENTO');

  return (
    <Tabs.Root defaultValue="identificacao" className="flex flex-col gap-lg">
      <Tabs.List
        aria-label="Seções do cadastro do escritório"
        className="flex gap-xs rounded-md bg-secondary p-xs"
      >
        {ABAS.map((aba) => (
          <Tabs.Trigger key={aba.id} value={aba.id} className={cn(CLASSES_DA_ABA)}>
            {aba.rotulo}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      <Tabs.Content value="identificacao" className="focus-visible:outline-none">
        <FormularioIdentificacao visao={visao} rotuloDeEnvio="Salvar alterações" />
      </Tabs.Content>

      <Tabs.Content value="responsavel" className="focus-visible:outline-none">
        <FormularioResponsavel visao={visao} rotuloDeEnvio="Salvar alterações" />
      </Tabs.Content>

      <Tabs.Content value="enderecos" className="flex flex-col gap-lg focus-visible:outline-none">
        <div className="flex flex-col gap-sm">
          <h3 className="text-headline-sm text-foreground">Endereço principal</h3>
          <p className="text-body-sm text-muted-foreground">
            O escritório mantém exatamente um endereço principal ativo.
          </p>
        </div>

        <FormularioEndereco visao={visao} rotuloDeEnvio="Salvar alterações" />

        {visao.enderecos.length > 1 ? (
          <ul className="flex flex-col gap-xs">
            {visao.enderecos
              .filter((endereco) => !endereco.principal)
              .map((endereco) => (
                <li
                  key={endereco.id}
                  className="flex flex-col gap-xs rounded-md border border-border bg-card px-md py-sm"
                >
                  <span className="font-mono text-code-sm tabular-nums text-muted-foreground">
                    {formatarCep(endereco.cep)}
                  </span>
                  <span className="text-body-sm text-foreground">
                    {endereco.logradouro}, {endereco.numero} — {endereco.municipio}/{endereco.uf}
                  </span>
                </li>
              ))}
          </ul>
        ) : null}
      </Tabs.Content>

      <Tabs.Content value="arquivos" className="flex flex-col gap-lg focus-visible:outline-none">
        <UploadDeArquivo
          tipo="LOGO"
          rotulo="Logo do escritório"
          descricao="Enviar um novo logo substitui o atual. PNG, JPG, SVG ou WEBP, até 2 MB."
          obrigatorio
          arquivos={logo === undefined ? [] : [logo]}
        />

        <UploadDeArquivo
          tipo="DOCUMENTO"
          rotulo="Documentos do escritório"
          descricao="PDF, PNG, JPG ou DOCX, até 10 MB por arquivo."
          obrigatorio
          arquivos={documentos}
          permiteRemover
        />
      </Tabs.Content>
    </Tabs.Root>
  );
};
