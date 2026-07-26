import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardStats } from '@ficha/shared';
import DashboardPage from '@/pages/DashboardPage';
import { dashboardApi } from '@/services/dashboard';
import { patientApi } from '@/services/patients';

// Se mockea solo la capa HTTP: react-query, el formateo de meses y el estado
// vacío del donut corren de verdad. Recharts no pinta en jsdom (el contenedor
// mide 0px), así que los asserts van sobre las cards y la leyenda, no el SVG.
vi.mock('@/services/dashboard', () => ({
  dashboardKeys: { stats: ['dashboard', 'stats'] },
  dashboardApi: { getStats: vi.fn() },
}));

vi.mock('@/services/patients', () => ({
  patientKeys: { all: ['patients'] },
  patientApi: { list: vi.fn() },
}));

const getStats = vi.mocked(dashboardApi.getStats);
const listPatients = vi.mocked(patientApi.list);

const STATS: DashboardStats = {
  activePatients: 7,
  totalSessions: 42,
  sessionsThisMonth: 5,
  pendingPayments: 3,
  pathologies: [
    { name: 'Lumbalgia', count: 4 },
    { name: 'Cervicalgia', count: 2 },
  ],
  sessionsByMonth: [
    { month: '2026-02', count: 0 },
    { month: '2026-03', count: 3 },
  ],
};

function renderPage() {
  // retry: false — sin esto el camino de error reintenta 3 veces con backoff.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listPatients.mockResolvedValue([]);
});

describe('DashboardPage', () => {
  it('muestra los valores de la API en las stat cards', async () => {
    getStats.mockResolvedValue(STATS);
    renderPage();

    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('lista las patologías con su conteo en la leyenda', async () => {
    getStats.mockResolvedValue(STATS);
    renderPage();

    expect(await screen.findByText('Lumbalgia (4)')).toBeInTheDocument();
    expect(screen.getByText('Cervicalgia (2)')).toBeInTheDocument();
  });

  it('explica el donut vacío en vez de dibujarlo sin datos', async () => {
    getStats.mockResolvedValue({ ...STATS, pathologies: [] });
    renderPage();

    expect(await screen.findByText(/Sin datos suficientes/)).toBeInTheDocument();
  });

  it('avisa cuando la API falla', async () => {
    getStats.mockRejectedValue(new Error('API caída'));
    renderPage();

    expect(
      await screen.findByText(/Error al cargar las estadísticas/)
    ).toBeInTheDocument();
  });
});
