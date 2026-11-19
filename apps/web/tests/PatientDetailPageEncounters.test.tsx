import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PatientDetailPage from '@/pages/PatientDetailPage';
import { episodeApi } from '@/services/episodes';
import { patientApi } from '@/services/patients';
import { revisionApi } from '@/services/revisions';
import { encounterApi } from '@/services/encounters';
import type { ClinicalEpisode } from '@/types/episode';
import type { Patient } from '@/types/patient';
import type { Encounter } from '@/types/encounter';

// The record lists an annulled encounter struck through (SPEC-clinical-revisions.md
// §8): it counts in nothing, and opens its history instead of the form.
vi.mock('@/services/patients', () => ({
  patientKeys: { all: ['patients'], detail: (id: string) => ['patients', id] },
  patientApi: { get: vi.fn() },
}));

vi.mock('@/services/episodes', () => ({
  episodeKeys: { list: (patientId: string) => ['patients', patientId, 'episodes'] },
  episodeApi: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

vi.mock('@/services/encounters', () => ({
  encounterKeys: {
    list: (patientId: string, episodeId?: string) =>
      episodeId ? ['patients', patientId, 'episodes', episodeId, 'encounters'] : ['patients', patientId, 'encounters'],
  },
  encounterApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), annul: vi.fn() },
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

const encounter = (
  id: string,
  day: string,
  treatment: string,
  annulledAt: string | null = null,
  pain: [number, number] = [6, 3],
  encounterType: Encounter['encounterType'] = 'SESSION',
): Encounter => ({
  id,
  version: annulledAt ? 2 : 1,
  patientId: 'p1',
  encounterType,
  encounterDate: `2026-10-${day}T13:00:00.000Z`,
  observations: null,
  createdAt: `2026-10-${day}T13:00:00.000Z`,
  updatedAt: `2026-10-${day}T13:00:00.000Z`,
  annulledAt,
  episodes: [
    {
      episodeId: 'e1',
      preEncounterState: null,
      treatment,
      painScaleBefore: pain[0],
      painScaleAfter: pain[1],
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
  vi.mocked(encounterApi.list).mockResolvedValue([
    encounter('s3', '20', 'Movilidad lumbar'),
    // Its pain would move the average from 3.0 to 5.0.
    encounter('s2', '15', 'Cargada por error', '2026-10-16T10:00:00.000Z', [9, 0]),
    encounter('s1', '10', 'Evaluación'),
  ]);
});

describe('PatientDetailPage: annulled encounters', () => {
  it('lists an annulled encounter struck through, outside the count and the numbering', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: 'Sesiones' }));

    expect(await screen.findByText('2 sesiones · 1 anulada')).toBeInTheDocument();
    // The pain chart leaves it out.
    expect(screen.getByText('3.0 pts')).toBeInTheDocument();
    const annulled = screen.getByRole('button', { name: /Sesión anulada del .*: ver historial/ });
    expect(within(annulled).getByText('Anulada')).toBeInTheDocument();
    // No clinical content in the list: not the treatment, not the pain.
    expect(screen.queryByText('Cargada por error')).toBeNull();
    expect(within(annulled).queryByText(/9/)).toBeNull();
    expect(within(annulled).getByText(/jue/).closest('.line-through')).not.toBeNull();
    expect(within(annulled).getByText('–')).toBeInTheDocument();
    // The current ones keep consecutive numbers.
    expect(screen.getByText('Movilidad lumbar').closest('button')).toHaveTextContent(/^2/);
    expect(screen.getByText('Evaluación').closest('button')).toHaveTextContent(/^1/);
  });

  it('opens its history, which shows the annulment, instead of the form', async () => {
    vi.mocked(revisionApi.list).mockResolvedValue([
      {
        version: 2,
        action: 'ENCOUNTER_ANNULLED',
        params: { encounterType: 'SESSION', reason: 'DATA_ENTRY_ERROR' },
        actorType: 'USER',
        author: { id: 'u1', name: 'Ana Pérez' },
        createdAt: '2026-10-16T10:00:00.000Z',
      },
      {
        version: 1,
        action: 'ENCOUNTER_RECORDED',
        params: {},
        actorType: 'USER',
        author: { id: 'u1', name: 'Ana Pérez' },
        createdAt: '2026-10-15T13:00:00.000Z',
      },
    ]);
    vi.mocked(revisionApi.get).mockImplementation(async (_base, version) => ({
      version,
      action: version === 2 ? 'ENCOUNTER_ANNULLED' : 'ENCOUNTER_RECORDED',
      params: {},
      actorType: 'USER',
      author: { id: 'u1', name: 'Ana Pérez' },
      createdAt: '2026-10-16T10:00:00.000Z',
      schemaVersion: 1,
      reasonNote: version === 2 ? 'Era de otra paciente' : null,
      snapshot: {
        userId: 'u1',
        encounterType: 'SESSION',
        encounterDate: '2026-10-15T13:00:00.000Z',
        observations: null,
        episodes: [encounter('s2', '15', 'Cargada por error').episodes[0]],
      },
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: 'Sesiones' }));

    await userEvent.click(await screen.findByRole('button', { name: /Sesión anulada del .*: ver historial/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Historial de la sesión anulada' });
    expect(await within(dialog).findByText('Versión 2 · Sesión anulada')).toBeInTheDocument();
    expect(encounterApi.get).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Guardar sesión' })).toBeNull();
  });

  it("does not take an annulled discharge as the episode's discharge", async () => {
    vi.mocked(episodeApi.list).mockResolvedValue([{ ...EPISODE, status: 'DISCHARGED', closedAt: '2026-10-21T13:00:00.000Z' }]);
    vi.mocked(encounterApi.list).mockResolvedValue([
      encounter('s4', '21', 'Alta cargada por error', '2026-10-22T10:00:00.000Z', [3, 1], 'DISCHARGE'),
      encounter('s1', '10', 'Evaluación'),
    ]);
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: 'Sesiones' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Nueva sesión' }));

    const warning = await screen.findByRole('dialog', { name: 'Episodio cerrado' });
    expect(within(warning).getByText('Este episodio está cerrado.')).toBeInTheDocument();
    expect(within(warning).queryByRole('button', { name: 'Ver nota de alta' })).toBeNull();
  });
});

