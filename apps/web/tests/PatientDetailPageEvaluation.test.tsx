import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import PatientDetailPage from '@/pages/PatientDetailPage';
import { evaluationApi } from '@/services/evaluation';
import { episodeApi } from '@/services/episodes';
import { patientApi } from '@/services/patients';
import type { ClinicalEpisode } from '@/types/episode';
import type { InitialEvaluation } from '@/types/evaluation';
import type { Patient } from '@/types/patient';
import { chooseReason } from './revisionReason';

// The initial evaluation over its version (SPEC-clinical-revisions.md §4, §5).
// It also saves the patient's occupation, which is a correction of the patient:
// that request carries her version and the same reason.
vi.mock('@/services/patients', () => ({
  patientKeys: { all: ['patients'], detail: (id: string) => ['patients', id] },
  patientApi: { get: vi.fn(), update: vi.fn() },
}));

vi.mock('@/services/episodes', () => ({
  episodeKeys: { list: (patientId: string) => ['patients', patientId, 'episodes'] },
  episodeApi: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

vi.mock('@/services/evaluation', () => ({
  evaluationKeys: {
    detail: (patientId: string, episodeId: string) => ['patients', patientId, 'episodes', episodeId, 'evaluation'],
  },
  evaluationApi: { get: vi.fn(), upsert: vi.fn() },
}));

vi.mock('@/services/patientEvents', () => ({
  patientEventKeys: { list: (patientId: string) => ['patients', patientId, 'events'] },
  patientEventApi: { list: vi.fn().mockResolvedValue([]) },
}));

// The page mounts the discharge form, which asks for the last price, the
// packages and the clinic's settings: answered, so no request leaves the test.
vi.mock('@/services/payments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/payments')>()),
  paymentApi: { lastBasePrice: vi.fn().mockResolvedValue(null) },
  packageApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/services/tenant', () => ({
  tenantKeys: { config: ['tenant'] },
  tenantApi: { get: vi.fn().mockResolvedValue({ timezone: 'America/Argentina/Buenos_Aires' }) },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const STALE = 'Otra persona editó este registro. Recargá para ver los cambios.';

const PATIENT: Patient = {
  id: 'p1',
  firstName: 'María',
  lastName: 'García',
  fullName: 'María García',
  birthDate: null,
  sex: null,
  phone: null,
  occupation: 'Docente',
  referringDoctor: null,
  insuranceName: null,
  insuranceNumber: null,
  insurancePlan: null,
  createdAt: '2026-10-01T13:00:00.000Z',
  updatedAt: '2026-10-01T13:00:00.000Z',
  version: 3,
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

const EVALUATION: InitialEvaluation = {
  id: 'ev1',
  patientId: 'p1',
  patientNarrative: null,
  otherHistory: null,
  notes: 'Primera',
  retractionMap: null,
  physicalActivity: null,
  painFrequency: null,
  evaScale: null,
  evaluatedAt: '2026-10-01T13:00:00.000Z',
  updatedAt: '2026-10-01T13:00:00.000Z',
  version: 2,
};

const upsert = vi.mocked(evaluationApi.upsert);
const updatePatient = vi.mocked(patientApi.update);

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

async function openEvaluation() {
  renderPage();
  await userEvent.click(await screen.findByRole('tab', { name: 'Evaluación inicial' }));
  return (await screen.findByPlaceholderText('Cualquier otra observación relevante...')) as HTMLTextAreaElement;
}

const save = () => userEvent.click(screen.getByRole('button', { name: 'Guardar evaluación' }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(patientApi.get).mockResolvedValue(PATIENT);
  vi.mocked(episodeApi.list).mockResolvedValue([EPISODE]);
  vi.mocked(evaluationApi.get).mockResolvedValue(EVALUATION);
  upsert.mockResolvedValue({ ...EVALUATION, version: 3 });
  updatePatient.mockResolvedValue({ ...PATIENT, version: 4 });
});

describe('PatientDetailPage: the initial evaluation over its version', () => {
  it("does not carry one episode's evaluation into another that has none", async () => {
    // B (active, the default) has no evaluation; A (closed) has one.
    const B = { ...EPISODE, id: 'eB', mainComplaint: 'Cervicalgia' };
    const A = { ...EPISODE, id: 'eA', status: 'DISCHARGED' as const, mainComplaint: 'Lumbalgia', closedAt: EPISODE.openedAt };
    vi.mocked(episodeApi.list).mockResolvedValue([B, A]);
    vi.mocked(evaluationApi.get).mockImplementation((_p, episodeId) =>
      Promise.resolve(episodeId === 'eA' ? EVALUATION : null),
    );
    const blank = await openEvaluation();
    expect(blank.value).toBe('');

    await userEvent.click(screen.getByRole('button', { name: /Cervicalgia/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Lumbalgia/ }));
    await waitFor(() =>
      expect((screen.getByPlaceholderText('Cualquier otra observación relevante...') as HTMLTextAreaElement).value).toBe('Primera'),
    );

    await userEvent.click(screen.getByRole('button', { name: /Lumbalgia/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Cervicalgia/ }));
    await waitFor(() =>
      expect((screen.getByPlaceholderText('Cualquier otra observación relevante...') as HTMLTextAreaElement).value).toBe(''),
    );
  });

  it('asks before switching episodes with unsaved evaluation text', async () => {
    const B = { ...EPISODE, id: 'eB', mainComplaint: 'Cervicalgia' };
    const A = { ...EPISODE, id: 'eA', status: 'DISCHARGED' as const, mainComplaint: 'Lumbalgia', closedAt: EPISODE.openedAt };
    vi.mocked(episodeApi.list).mockResolvedValue([B, A]);
    vi.mocked(evaluationApi.get).mockResolvedValue(null);
    const notes = await openEvaluation();
    await userEvent.type(notes, 'Sin guardar');

    await userEvent.click(screen.getByRole('button', { name: /Cervicalgia/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Lumbalgia/ }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(notes.value).toBe('Sin guardar');
  });

  it('corrects with the version it loaded and the chosen reason', async () => {
    const notes = await openEvaluation();
    await userEvent.type(notes, ' y segunda');
    await chooseReason('Aclaración');

    await save();

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0][2]).toMatchObject({
      notes: 'Primera y segunda',
      expectedVersion: 2,
      reason: 'CLARIFICATION',
      reasonNote: '',
    });
    expect(updatePatient).not.toHaveBeenCalled();
  });

  it('sends a first evaluation as version 0, with no reason', async () => {
    vi.mocked(evaluationApi.get).mockResolvedValue(null);
    const notes = await openEvaluation();
    expect(screen.queryByText('Motivo del cambio')).toBeNull();
    await userEvent.type(notes, 'Primera');

    await save();

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0][2]).toMatchObject({ notes: 'Primera', expectedVersion: 0 });
    expect(upsert.mock.calls[0][2]).not.toHaveProperty('reason');
  });

  it("corrects the patient's occupation over her version, with the same reason", async () => {
    vi.mocked(evaluationApi.get).mockResolvedValue(null);
    await openEvaluation();
    const occupation = screen.getByPlaceholderText('Ej: Docente, oficinista, deportista...');
    await userEvent.clear(occupation);
    await userEvent.type(occupation, 'Abogada');
    // Changing the occupation corrects the patient, so the reason shows.
    await chooseReason();
    await userEvent.type(screen.getByLabelText('Nota del cambio (opcional)'), 'Cambió de trabajo');

    await save();

    await waitFor(() => expect(updatePatient).toHaveBeenCalledTimes(1));
    expect(updatePatient).toHaveBeenCalledWith('p1', {
      occupation: 'Abogada',
      expectedVersion: 3,
      reason: 'DATA_ENTRY_ERROR',
      reasonNote: 'Cambió de trabajo',
    });
  });

  it('on a 409 shows the message, keeps what was typed, and reloads on request', async () => {
    upsert.mockRejectedValueOnce(new ApiError(STALE, 409, { error: STALE }));
    const notes = await openEvaluation();
    await userEvent.type(notes, ' mía');
    await chooseReason();
    await save();

    expect((await screen.findByRole('alert')).textContent).toContain(STALE);
    expect(notes.value).toBe('Primera mía');

    vi.mocked(evaluationApi.get).mockResolvedValue({ ...EVALUATION, notes: 'De otra persona', version: 3 });
    await userEvent.click(screen.getByRole('button', { name: 'Recargar' }));

    await waitFor(() => expect(notes.value).toBe('De otra persona'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
