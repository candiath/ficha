import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PatientDetailPage from '@/pages/PatientDetailPage';
import { episodeApi } from '@/services/episodes';
import { patientApi } from '@/services/patients';
import { revisionApi } from '@/services/revisions';
import { sessionApi } from '@/services/sessions';
import type { ClinicalEpisode } from '@/types/episode';
import type { Patient } from '@/types/patient';
import type { Session } from '@/types/session';

// The record lists an annulled session struck through (SPEC-clinical-revisions.md
// §8): it counts in nothing, and opens its history instead of the form.
vi.mock('@/services/patients', () => ({
  patientKeys: { all: ['patients'], detail: (id: string) => ['patients', id] },
  patientApi: { get: vi.fn() },
}));

vi.mock('@/services/episodes', () => ({
  episodeKeys: { list: (patientId: string) => ['patients', patientId, 'episodes'] },
  episodeApi: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

vi.mock('@/services/sessions', () => ({
  sessionKeys: {
    list: (patientId: string, episodeId?: string) =>
      episodeId ? ['patients', patientId, 'episodes', episodeId, 'sessions'] : ['patients', patientId, 'sessions'],
  },
  sessionApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), annul: vi.fn() },
}));

vi.mock('@/services/revisions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/revisions')>()),
  revisionApi: { list: vi.fn(), get: vi.fn() },
}));

vi.mock('@/services/payments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/payments')>()),
  paymentApi: { lastBasePrice: vi.fn().mockResolvedValue(null) },
  packageApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PATIENT: Patient = {
  id: 'p1',
  firstName: 'María',
  lastName: 'García',
  fullName: 'María García',
  birthDate: null,
  sex: null,
  phone: null,
  occupation: null,
  referringDoctor: null,
  insuranceName: null,
  insuranceNumber: null,
  insurancePlan: null,
  createdAt: '2026-10-01T13:00:00.000Z',
  updatedAt: '2026-10-01T13:00:00.000Z',
  version: 1,
};

const EPISODE: ClinicalEpisode = {
  id: 'e1',
  patientId: 'p1',
  status: 'ACTIVE',
  mainComplaint: 'Lumbalgia',
  openedAt: '2026-10-01T13:00:00.000Z',
  closedAt: null,
  createdAt: '2026-10-01T13:00:00.000Z',
  updatedAt: '2026-10-01T13:00:00.000Z',
  version: 1,
};

const session = (id: string, day: string, treatment: string, annulledAt: string | null = null): Session => ({
  id,
  version: annulledAt ? 2 : 1,
  patientId: 'p1',
  sessionType: 'SESSION',
  sessionDate: `2026-10-${day}T13:00:00.000Z`,
  observations: null,
  createdAt: `2026-10-${day}T13:00:00.000Z`,
  updatedAt: `2026-10-${day}T13:00:00.000Z`,
  annulledAt,
  episodes: [
    {
      episodeId: 'e1',
      preSessionState: null,
      treatment,
      painScaleBefore: 6,
      painScaleAfter: 3,
      patientExercises: null,
      reEvaluationNotes: null,
    },
  ],
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/patients/p1']}>
        <Routes>
          <Route path="/patients/:id" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(patientApi.get).mockResolvedValue(PATIENT);
  vi.mocked(episodeApi.list).mockResolvedValue([EPISODE]);
  vi.mocked(sessionApi.list).mockResolvedValue([
    session('s3', '20', 'Movilidad lumbar'),
    session('s2', '15', 'Cargada por error', '2026-10-16T10:00:00.000Z'),
    session('s1', '10', 'Evaluación'),
  ]);
});

describe('PatientDetailPage: annulled sessions', () => {
  it('lists an annulled session struck through, outside the count and the numbering', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: 'Sesiones' }));

    expect(await screen.findByText('2 sesiones · 1 anulada')).toBeInTheDocument();
    const annulled = screen.getByRole('button', { name: /Sesión anulada del .*: ver historial/ });
    expect(within(annulled).getByText('Anulada')).toBeInTheDocument();
    expect(within(annulled).getByText('Cargada por error').closest('.line-through')).not.toBeNull();
    expect(within(annulled).getByText('–')).toBeInTheDocument();
    // The current ones keep consecutive numbers.
    expect(screen.getByText('Movilidad lumbar').closest('button')).toHaveTextContent(/^2/);
    expect(screen.getByText('Evaluación').closest('button')).toHaveTextContent(/^1/);
  });

  it('opens its history, which shows the annulment, instead of the form', async () => {
    vi.mocked(revisionApi.list).mockResolvedValue([
      {
        version: 2,
        action: 'SESSION_ANNULLED',
        params: { sessionType: 'SESSION', reason: 'DATA_ENTRY_ERROR' },
        actorType: 'USER',
        author: { id: 'u1', name: 'Ana Pérez' },
        createdAt: '2026-10-16T10:00:00.000Z',
      },
      {
        version: 1,
        action: 'SESSION_RECORDED',
        params: {},
        actorType: 'USER',
        author: { id: 'u1', name: 'Ana Pérez' },
        createdAt: '2026-10-15T13:00:00.000Z',
      },
    ]);
    vi.mocked(revisionApi.get).mockImplementation(async (_base, version) => ({
      version,
      action: version === 2 ? 'SESSION_ANNULLED' : 'SESSION_RECORDED',
      params: {},
      actorType: 'USER',
      author: { id: 'u1', name: 'Ana Pérez' },
      createdAt: '2026-10-16T10:00:00.000Z',
      schemaVersion: 1,
      reasonNote: version === 2 ? 'Era de otra paciente' : null,
      snapshot: {
        userId: 'u1',
        sessionType: 'SESSION',
        sessionDate: '2026-10-15T13:00:00.000Z',
        observations: null,
        episodes: [session('s2', '15', 'Cargada por error').episodes[0]],
      },
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: 'Sesiones' }));

    await userEvent.click(await screen.findByRole('button', { name: /Sesión anulada del .*: ver historial/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Historial de la sesión anulada' });
    expect(await within(dialog).findByText('Versión 2 · Sesión anulada')).toBeInTheDocument();
    expect(sessionApi.get).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Guardar sesión' })).toBeNull();
  });
});
