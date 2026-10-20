type OrientacaoFiscal = Readonly<{ campo: string; origem: string; proximoPasso: string }>;

const ORIENTACOES_DOS_DADOS: Readonly<Record<string, OrientacaoFiscal>> = {
  REGIME_HISTORICO: {
    campo: 'Regime tributário na data da NF-e', origem: 'Histórico fiscal cadastral da empresa',
    proximoPasso: 'Confira o regime e a data de vigência no cadastro fiscal da empresa; depois, gere uma nova revisão.',
  },
  FINALIDADE_AQUISICAO: {
    campo: 'Finalidade de aquisição', origem: 'Declaração do operador por item',
    proximoPasso: 'Marque o item como adquirido para revenda na lista da NF-e e gere uma nova revisão.',
  },
  DATA_FATO_GERADOR: {
    campo: 'Data do fato gerador', origem: 'Data de emissão da NF-e original',
    proximoPasso: 'Confira o XML original e reprocese o documento se a data estiver ausente na captura.',
  },
  UF_ORIGEM: {
    campo: 'UF de origem', origem: 'Endereço do emitente no XML da NF-e',
    proximoPasso: 'Confira os dados do emitente no XML original e reprocese o documento se necessário.',
  },
  UF_DESTINO: {
    campo: 'UF de destino', origem: 'Endereço do destinatário no XML da NF-e',
    proximoPasso: 'Confira os dados do destinatário no XML original e reprocese o documento se necessário.',
  },
  CFOP: {
    campo: 'CFOP do item', origem: 'Grupo de produto no XML da NF-e',
    proximoPasso: 'Confira o CFOP no XML original; corrija o documento de origem e reprocese se estiver incorreto.',
  },
  NCM: {
    campo: 'NCM do item', origem: 'Grupo de produto no XML da NF-e',
    proximoPasso: 'Confira o NCM no XML original; corrija o documento de origem e reprocese se estiver incorreto.',
  },
  CEST: {
    campo: 'CEST do item', origem: 'Grupo de produto no XML da NF-e',
    proximoPasso: 'Confira o CEST no XML original; CEST isolado não comprova enquadramento nem corrige o NCM.',
  },
  CST_CSOSN: {
    campo: 'CST ou CSOSN do item', origem: 'Grupo ICMS no XML da NF-e',
    proximoPasso: 'Confira o código no XML original; corrija o documento de origem e reprocese se estiver incorreto.',
  },
  ST_STATUS: {
    campo: 'Situação de substituição tributária', origem: 'Tributos e grupo ICMS do item na NF-e',
    proximoPasso: 'Confira o XML original. Sem confirmação desta condição, o sistema mantém o item indeterminado.',
  },
  IMPORT_STATUS: {
    campo: 'Indicador de importação', origem: 'CFOP, UF de origem e dados do item na NF-e',
    proximoPasso: 'Confira o XML original. Sem confirmação desta condição, o sistema mantém o item indeterminado.',
  },
  MONOPHASE_STATUS: {
    campo: 'Indicador de tributação monofásica', origem: 'Classificação tributária do item na NF-e',
    proximoPasso: 'Confira os códigos fiscais do item no XML original. Sem confirmação, o sistema mantém o item indeterminado.',
  },
  BENEFIT_STATUS: {
    campo: 'Indicador de benefício fiscal', origem: 'CST e código de benefício do item na NF-e',
    proximoPasso: 'Confira os dados fiscais do item no XML original. Sem confirmação, o sistema mantém o item indeterminado.',
  },
  RETURN_TRANSFER_STATUS: {
    campo: 'Indicador de devolução ou transferência', origem: 'CFOP do item no XML da NF-e',
    proximoPasso: 'Confira o CFOP no XML original. Sem confirmação, o sistema mantém o item indeterminado.',
  },
};

const ORIENTACOES_DOS_MOTIVOS: Readonly<Record<string, OrientacaoFiscal>> = {
  PACKAGE_UNAVAILABLE: {
    campo: 'Pacote normativo aplicável', origem: 'Catálogo de pacotes oficiais curados',
    proximoPasso: 'Aguarde a publicação de pacote compatível com esta data e jurisdição.',
  },
  PACKAGE_REGIME_NOT_COVERED: {
    campo: 'Cobertura do regime', origem: 'Pacote normativo publicado',
    proximoPasso: 'Aguarde um pacote oficial que cubra o regime da empresa.',
  },
  PACKAGE_NOT_VALID_ON_FACT_DATE: {
    campo: 'Vigência do pacote', origem: 'Vigência registrada no pacote normativo',
    proximoPasso: 'Aguarde um pacote oficial vigente na data da NF-e.',
  },
  NO_APPLICABLE_RULE: {
    campo: 'Regra para esta combinação fiscal', origem: 'Regras e cobertura do pacote publicado',
    proximoPasso: 'Nenhuma regra curada cobre os dados deste item; mantenha-o indeterminado até revisão do pacote.',
  },
  SUBSTITUTION_TAX_OUTSIDE_COVERAGE: {
    campo: 'Substituição tributária', origem: 'Dados fiscais do item na NF-e',
    proximoPasso: 'Esta situação está fora da cobertura F26; o item permanece indeterminado.',
  },
  IMPORT_OUTSIDE_COVERAGE: {
    campo: 'Importação', origem: 'Dados fiscais do item na NF-e',
    proximoPasso: 'Esta situação está fora da cobertura F26; o item permanece indeterminado.',
  },
  MONOPHASE_OUTSIDE_COVERAGE: {
    campo: 'Tributação monofásica', origem: 'Classificação fiscal do item na NF-e',
    proximoPasso: 'Esta situação está fora da cobertura F26; o item permanece indeterminado.',
  },
  UNMODELED_BENEFIT: {
    campo: 'Benefício fiscal não modelado', origem: 'CST e código de benefício do item na NF-e',
    proximoPasso: 'Esta situação está fora da cobertura F26; o item permanece indeterminado.',
  },
  RETURN_OR_TRANSFER_OUTSIDE_COVERAGE: {
    campo: 'Devolução ou transferência', origem: 'CFOP do item na NF-e',
    proximoPasso: 'Esta situação está fora da cobertura F26; o item permanece indeterminado.',
  },
  AMBIGUOUS_RULES: {
    campo: 'Integridade das regras', origem: 'Pacote normativo publicado',
    proximoPasso: 'A revisão foi bloqueada. O responsável pelo catálogo precisa corrigir a colisão e publicar nova versão.',
  },
};

const ORIENTACAO_GENERICA: OrientacaoFiscal = {
  campo: 'Condição fiscal sem confirmação', origem: 'Dados normalizados da NF-e e pacote normativo',
  proximoPasso: 'Confira a NF-e original e a cobertura do pacote; o sistema não presumiu uma regra.',
};

export const orientarDadoResolucaoTributaria = (codigo: string): OrientacaoFiscal =>
  ORIENTACOES_DOS_DADOS[codigo] ?? ORIENTACAO_GENERICA;

export const orientarMotivoResolucaoTributaria = (codigo: string): OrientacaoFiscal | null =>
  ORIENTACOES_DOS_MOTIVOS[codigo] ?? null;
