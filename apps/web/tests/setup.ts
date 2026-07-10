// Matchers de jest-dom (toBeInTheDocument, toBeDisabled, …) disponibles
// en todos los tests; el import registra los matchers y los tipos.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Desmonta los componentes después de cada test: sin esto los renders se
// acumulan en el mismo jsdom y los queries encuentran elementos duplicados.
afterEach(() => {
  cleanup();
});
