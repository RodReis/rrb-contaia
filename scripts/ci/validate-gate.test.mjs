import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATEGORIAS_OBRIGATORIAS, validarResumos } from './validate-gate.mjs';

const resumo = (categoria, sobrescreve = {}) => ({
  categoria,
  total: 1,
  passou: 1,
  falhou: 0,
  pulado: 0,
  not_run: 0,
  motivo: null,
  duracao_ms: 10,
  ...sobrescreve,
});

const todas = () => CATEGORIAS_OBRIGATORIAS.map((categoria) => resumo(categoria));

test('reprova quando uma categoria obrigatória não reporta', () => {
  const problemas = validarResumos(todas().filter((r) => r.categoria !== 'banco'));

  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /banco/);
});

test('aprova quando todas as categorias reportam sem falha', () => {
  assert.deepEqual(validarResumos(todas()), []);
});

test('reprova quando uma categoria tem teste falhando', () => {
  const resumos = todas().map((r) => (r.categoria === 'tela' ? { ...r, falhou: 2 } : r));

  assert.match(validarResumos(resumos)[0], /tela/);
});

test('reprova not_run sem motivo declarado', () => {
  const resumos = todas().map((r) =>
    r.categoria === 'e2e' ? { ...r, total: 0, passou: 0, not_run: 3, motivo: null } : r,
  );

  assert.match(validarResumos(resumos)[0], /not_run sem motivo/);
});

test('aceita not_run com motivo declarado', () => {
  const resumos = todas().map((r) =>
    r.categoria === 'e2e'
      ? { ...r, total: 0, passou: 0, not_run: 3, motivo: 'ambiente externo indisponível' }
      : r,
  );

  assert.deepEqual(validarResumos(resumos), []);
});

test('reprova categoria que reporta zero teste e zero not_run', () => {
  const resumos = todas().map((r) =>
    r.categoria === 'regras' ? { ...r, total: 0, passou: 0 } : r,
  );

  assert.match(validarResumos(resumos)[0], /zero teste/);
});
