-- SPEC-017/F17: operação de distribuição DF-e pelo Signer.
-- O artefato da migration original 0014 também aceita o tipo em bancos novos.
ALTER TABLE app.signer_operacao
  DROP CONSTRAINT signer_operacao_tipo_check;
ALTER TABLE app.signer_operacao
  ADD CONSTRAINT signer_operacao_tipo_check
  CHECK (tipo IN ('ASSINATURA', 'MTLS', 'DIAGNOSTICO', 'DISTRIBUICAO_DFE'));
