import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { recordServerTime } from '@/lib/serverClock';
import PatientDetailPage from '@/pages/PatientDetailPage';
import { episodeApi } from '@/services/episodes';
import { patientApi } from '@/services/patients';
import type { ClinicalEpisode } from '@/types/episode';
import type { Patient } from '@/types/patient';
import { chooseReason } from './revisionReason';

// Closing an episode shows its time before sending it, by the API's clock, and
// what is sent is what was shown. When the API refuses it, the user sees why
// and decides: nothing is corrected or resent behind their back.
vi.mock('@/services/patients', () => ({
  patientKeys: { all: ['patients'], detail: (id: string) => ['patients', id] },
  patientApi: { get: vi.fn() },
}));

vi.mock('@/services/episodes', () => ({
  episodeKeys: { list: (patientId: string) => ['patients', patientId, 'episodes'] },
  episodeApi: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

// The page mounts the session form, which asks for the last price and the
// patient's packages. Answered here, or the requests would reach a dev API.
vi.mock('@/services/payments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/payments')>()),
  paymentApi: { lastBasePrice: vi.fn().mockResolvedValue(null) },
  packageApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const MINUTE_MS = 60_000;

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
  version: 2,
};

function setClockOffset(offsetMs: number) {
  const now = Date.now();
  act(() => recordServerTime(new Date(now + offsetMs).toISOString(), now, now));
}

let queryClient: QueryClient;

function renderPage() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

async function openAbandonConfirm() {
  await userEvent.click(await screen.findByTitle('Editar motivo del episodio'));
  await userEvent.click(await screen.findByRole('button', { name: 'Registrar abandono' }));
  await screen.findByRole('button', { name: 'Confirmar abandono' });
}

const confirm = () => userEvent.click(screen.getByRole('button', { name: 'Confirmar abandono' }));

const sentClosedAt = (call: number) =>
  (vi.mocked(episodeApi.update).mock.calls[call][2] as { closedAt: string }).closedAt;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(patientApi.get).mockResolvedValue(PATIENT);
  vi.mocked(episodeApi.list).mockResolvedValue([EPISODE]);
  vi.mocked(episodeApi.update).mockResolvedValue({ ...EPISODE, status: 'ABANDONED' });
});

afterEach(() => setClockOffset(0));

describe('PatientDetailPage: closing an episode', () => {
  it('sends the time by the API clock, not the one of a device running behind, and says so', async () => {
    setClockOffset(10 * MINUTE_MS);
    renderPage();
    await openAbandonConfirm();

    expect(screen.getByText(/Fecha de cierre:/)).toBeTruthy();
    expect(screen.getByText(/la de este dispositivo está atrasada 10 min/)).toBeTruthy();

    await confirm();

    await waitFor(() => expect(episodeApi.update).toHaveBeenCalledTimes(1));
    expect(new Date(sentClosedAt(0)).getTime() - Date.now()).toBeGreaterThan(9 * MINUTE_MS);
  });

  it('on a refusal from a clock problem, shows why and the real time, and sends it only once confirmed', async () => {
    const serverTime = new Date(Date.now() + 10 * MINUTE_MS).toISOString();
    vi.mocked(episodeApi.update).mockRejectedValueOnce(
      new ApiError('La fecha de cierre no puede ser anterior a la apertura del episodio', 400, {
        code: 'closed_before_opened',
        openedAt: EPISODE.openedAt,
        serverTime,
      }),
    );
    renderPage();
    await openAbandonConfirm();

    await confirm();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('la hora de este dispositivo no coincide con la del servidor');
    expect(episodeApi.update).toHaveBeenCalledTimes(1);

    await confirm();

    await waitFor(() => expect(episodeApi.update).toHaveBeenCalledTimes(2));
    expect(sentClosedAt(1)).toBe(serverTime);
  });

  it('on a refusal because the episode opens later, says so and offers no way to send it', async () => {
    const openedAt = new Date(Date.now() + 24 * 60 * MINUTE_MS).toISOString();
    vi.mocked(episodeApi.update).mockRejectedValueOnce(
      new ApiError('La fecha de cierre no puede ser anterior a la apertura del episodio', 400, {
        code: 'closed_before_opened',
        openedAt,
        serverTime: new Date().toISOString(),
      }),
    );
    renderPage();
    await openAbandonConfirm();

    await confirm();

    expect((await screen.findByRole('alert')).textContent).toContain('no se puede cerrar antes de esa fecha');
    expect((screen.getByRole('button', { name: 'Confirmar abandono' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows any other refusal as the API words it', async () => {
    vi.mocked(episodeApi.update).mockRejectedValueOnce(new ApiError('Episodio no encontrado', 404, {}));
    renderPage();
    await openAbandonConfirm();

    await confirm();

    expect((await screen.findByRole('alert')).textContent).toBe('Episodio no encontrado');
  });
});

// Versions (SPEC-clinical-revisions.md §4, §5): closing is a fact and takes no
// reason; correcting the complaint is a correction and says why.
describe('PatientDetailPage: the episode over its version', () => {
  const STALE = 'Otra persona editó este registro. Recargá para ver los cambios.';

  it('abandons over the version on screen, with no reason', async () => {
    renderPage();
    await openAbandonConfirm();

    await confirm();

    await waitFor(() => expect(episodeApi.update).toHaveBeenCalledTimes(1));
    const body = vi.mocked(episodeApi.update).mock.calls[0][2];
    expect(body).toMatchObject({ status: 'ABANDONED', expectedVersion: 2 });
    expect(body).not.toHaveProperty('reason');
  });

  it('corrects the complaint with the chosen reason, its note and the version', async () => {
    renderPage();
    await userEvent.click(await screen.findByTitle('Editar motivo del episodio'));
    const complaint = await screen.findByPlaceholderText('Ej: Dolor lumbar, cervicalgia...');
    await userEvent.clear(complaint);
    await userEvent.type(complaint, 'Lumbociatalgia');
    await chooseReason('Información recibida después');
    await userEvent.type(screen.getByLabelText('Nota del cambio (opcional)'), 'Irradia');

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(episodeApi.update).toHaveBeenCalledTimes(1));
    expect(vi.mocked(episodeApi.update).mock.calls[0][2]).toEqual({
      mainComplaint: 'Lumbociatalgia',
      reason: 'LATE_INFORMATION',
      reasonNote: 'Irradia',
      expectedVersion: 2,
    });
  });

  it('on a 409 shows the message, keeps what was typed, and reloads on request', async () => {
    vi.mocked(episodeApi.update).mockRejectedValueOnce(new ApiError(STALE, 409, { error: STALE }));
    renderPage();
    await userEvent.click(await screen.findByTitle('Editar motivo del episodio'));
    const complaint = await screen.findByPlaceholderText('Ej: Dolor lumbar, cervicalgia...');
    await userEvent.clear(complaint);
    await userEvent.type(complaint, 'Mío');
    await chooseReason();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect((await screen.findByRole('alert')).textContent).toContain(STALE);
    expect((complaint as HTMLInputElement).value).toBe('Mío');

    vi.mocked(episodeApi.list).mockResolvedValue([{ ...EPISODE, mainComplaint: 'De otra persona', version: 3 }]);
    await userEvent.click(screen.getByRole('button', { name: 'Recargar' }));

    await waitFor(() => expect((complaint as HTMLInputElement).value).toBe('De otra persona'));
    expect(screen.queryByRole('alert')).toBeNull();

    // What is saved now goes over the version just reloaded.
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(episodeApi.update).toHaveBeenCalledTimes(2));
    expect(vi.mocked(episodeApi.update).mock.calls[1][2]).toMatchObject({ expectedVersion: 3 });
  });

  it('saves over the version the text was read from, even after the list refetches', async () => {
    renderPage();
    await userEvent.click(await screen.findByTitle('Editar motivo del episodio'));
    const complaint = await screen.findByPlaceholderText('Ej: Dolor lumbar, cervicalgia...');
    await userEvent.clear(complaint);
    await userEvent.type(complaint, 'Mío');

    // Another person corrects it while the dialog is open, and the list refetches
    // (on window focus, say): the dialog still shows the text of version 2.
    vi.mocked(episodeApi.list).mockResolvedValue([{ ...EPISODE, mainComplaint: 'De otra persona', version: 3 }]);
    await act(() => queryClient.invalidateQueries({ queryKey: ['patients', 'p1', 'episodes'] }));
    await waitFor(() =>
      expect(queryClient.getQueryData<ClinicalEpisode[]>(['patients', 'p1', 'episodes'])?.[0].version).toBe(3),
    );
    expect((complaint as HTMLInputElement).value).toBe('Mío');

    await chooseReason();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(episodeApi.update).toHaveBeenCalledTimes(1));
    expect(vi.mocked(episodeApi.update).mock.calls[0][2]).toMatchObject({ mainComplaint: 'Mío', expectedVersion: 2 });
  });
});
