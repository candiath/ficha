import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SessionsPage from '@/pages/SessionsPage';
import { globalSessionApi } from '@/services/globalSessions';
import { sessionApi } from '@/services/sessions';
import type { SessionIndexItem } from '@/types/globalSession';
import type { Session } from '@/types/session';

// Sesiones lists every session of the clinic as an index, with no clinical
// text (#186, SPEC-list-minimization.md §1). The session itself is read from
// the patient's route, and the edit form renders only from that full record:
// a partial object in an edit form is saved as erased fields.
vi.mock('@/services/globalSessions', () => ({
  globalSessionKeys: { all: ['sessions'] },
  globalSessionApi: { list: vi.fn() },
}));

vi.mock('@/services/sessions', () => ({
  sessionKeys: {
    list: (patientId: string) => ['patients', patientId, 'sessions'],
    detail: (patientId: string, sessionId: string) => ['patients', patientId, 'sessions', sessionId],
  },
  sessionApi: { get: vi.fn(), update: vi.fn(), remove: vi.fn(), list: vi.fn(), create: vi.fn() },
}));

vi.mock('@/services/episodes', () => ({
  episodeKeys: { list: (patientId: string) => ['patients', patientId, 'episodes'] },
  episodeApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/services/payments', () => ({
  paymentKeys: { all: ['payments'], lastBasePrice: ['payments', 'last-base-price'] },
  packageKeys: { byPatient: (patientId: string) => ['packages', patientId] },
  paymentApi: { lastBasePrice: vi.fn() },
  packageApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const list = vi.mocked(globalSessionApi.list);
const get = vi.mocked(sessionApi.get);
const update = vi.mocked(sessionApi.update);

const ITEM: SessionIndexItem = {
  id: 's1',
  sessionType: 'SESSION',
  sessionDate: '2026-10-01T13:00:00.000Z',
  createdAt: '2026-10-01T13:00:00.000Z',
  updatedAt: '2026-10-01T13:00:00.000Z',
  patient: { id: 'p1', fullName: 'María García' },
};

const SESSION: Session = {
  id: 's1',
  patientId: 'p1',
  episodeIds: [],
  sessionType: 'SESSION',
  sessionDate: '2026-10-01T13:00:00.000Z',
  preSesionState: 'Llegó con dolor lumbar',
  reEvaluationNotes: null,
  patientExercises: 'Rana en el suelo 10 minutos',
  painScaleBefore: 7,
  painScaleAfter: 3,
  observations: 'Trabajo de cadena posterior',
  createdAt: '2026-10-01T13:00:00.000Z',
  updatedAt: '2026-10-01T13:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SessionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue([ITEM]);
});

describe('SessionsPage', () => {
  it('shows who and when, with no clinical column', async () => {
    renderPage();

    expect(await screen.findByRole('link', { name: 'María García' })).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toContain('Fecha');
    expect(headers).toContain('Tipo');
    expect(headers.join(' ')).not.toMatch(/Dolor|Observaciones|Episodio/);
  });

  it('opens a session only with the full record, loaded from the patient\'s route', async () => {
    let resolve: (s: Session) => void = () => {};
    get.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Ver detalles' }));

    expect(get).toHaveBeenCalledWith('p1', 's1');
    // Nothing yet: never an empty form, never the create form.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    resolve(SESSION);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('Trabajo de cadena posterior')).toBeInTheDocument();
  });

  it('saving one edited field sends the others as they were loaded', async () => {
    get.mockResolvedValue(SESSION);
    update.mockResolvedValue({ ...SESSION, observations: 'Trabajo de cadena posterior y diafragma' });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Ver detalles' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByDisplayValue('Trabajo de cadena posterior'), ' y diafragma');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar sesión' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0]).toBe('p1');
    expect(update.mock.calls[0][1]).toBe('s1');
    expect(update.mock.calls[0][2]).toMatchObject({
      observations: 'Trabajo de cadena posterior y diafragma',
      preSesionState: 'Llegó con dolor lumbar',
      patientExercises: 'Rana en el suelo 10 minutos',
      painScaleBefore: 7,
      painScaleAfter: 3,
    });
  });

  it('says so when the record is no longer available', async () => {
    get.mockRejectedValue(new Error('Paciente no encontrado'));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Ver detalles' }));

    expect(await screen.findByText(/ficha de este paciente ya no está disponible/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar sesión' })).not.toBeInTheDocument();
  });
});
