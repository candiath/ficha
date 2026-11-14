// Matchers de jest-dom (toBeInTheDocument, toBeDisabled, …) disponibles
// en todos los tests; el import registra los matchers y los tipos.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Tests never reach the network. A request no test mocked would otherwise go
// to the API_BASE default (localhost:3001): with a dev API running there it
// answers, and its X-Server-Time resets the clock offset a test set, so the
// same test passes or fails depending on what else runs on the machine. The
// real fetch is replaced for good (`vi.unstubAllGlobals` restores this one, not
// Node's): an unmocked call rejects, and the test that made it fails below,
// naming the URL, even when the page swallowed the rejection.
const unmockedRequests: string[] = [];
globalThis.fetch = (input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : String(input);
  unmockedRequests.push(url);
  return Promise.reject(new Error(`Unmocked fetch in a test: ${url}`));
};

// Desmonta los componentes después de cada test: sin esto los renders se
// acumulan en el mismo jsdom y los queries encuentran elementos duplicados.
afterEach(() => {
  cleanup();
  const escaped = unmockedRequests.splice(0);
  if (escaped.length > 0) {
    throw new Error(`The test made requests no mock answered: ${escaped.join(', ')}`);
  }
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

// jsdom tampoco implementa matchMedia, y next-themes lo consulta al montar
// para resolver el tema "system". El stub responde que ninguna media query
// matchea (o sea: sistema en claro) y no emite cambios.
window.matchMedia ??= (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
});
