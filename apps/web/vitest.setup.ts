import '@testing-library/jest-dom/vitest';
import { toHaveNoViolations } from 'jest-axe';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

expect.extend(toHaveNoViolations);

// Hermético: a origem do cofre fixada no build (.env, CI do e2e) não pode mudar o que os testes de tela
// provam. Os testes que precisam dela a definem com `vi.stubEnv`.
delete process.env['NEXT_PUBLIC_COFRE_URL'];

afterEach(() => {
  cleanup();
});
