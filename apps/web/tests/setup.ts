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

// jsdom no implementa ResizeObserver y el ResponsiveContainer de recharts lo
// instancia al montar: sin este stub, cualquier test que renderice un gráfico
// explota. El stub no observa nada — en jsdom los elementos miden 0px, así que
// los gráficos no se dibujan y los tests asertan sobre el DOM de alrededor.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
