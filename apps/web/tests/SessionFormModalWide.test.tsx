import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SessionFormModalWide from '@/components/sessions/SessionFormModalWide';
import { episodeApi } from '@/services/episodes';
import { ApiError } from '@/lib/api';
import { sessionApi } from '@/services/sessions';
import type { ClinicalEpisode } from '@/types/episode';
import type { Session } from '@/types/session';
import { chooseReason } from './revisionReason';

// A visit can treat several problems (#238): the form lets the therapist tick
// every open episode, each with its own block, and sends the whole set.
vi.mock('@/services/sessions', () => ({
  sessionKeys: { list: (patientId: string) => ['patients', patientId, 'sessions'] },
  sessionApi: { create: vi.fn(), update: vi.fn(), annul: vi.fn(), get: vi.fn() },
}));

vi.mock('@/services/episodes', () => ({
  episodeKeys: { list: (patientId: string) => ['patients', patientId, 'episodes'] },
  episodeApi: { list: vi.fn() },
}));

vi.mock('@/services/payments', () => ({
  paymentKeys: { all: ['payments'], lastBasePrice: ['payments', 'last-base-price'] },
  packageKeys: { byPatient: (patientId: string) => ['packages', patientId] },
  paymentApi: { lastBasePrice: vi.fn().mockResolvedValue({ amountCents: null, isStale: true }) },
  packageApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const create = vi.mocked(sessionApi.create);
const update = vi.mocked(sessionApi.update);
const annul = vi.mocked(sessionApi.annul);

const episode = (id: string, mainComplaint: string, status: ClinicalEpisode['status'] = 'ACTIVE'): ClinicalEpisode => ({
  id,
  patientId: 'p1',
  status,
  mainComplaint,
  openedAt: '2026-02-01T00:00:00.000Z',
  closedAt: status === 'ACTIVE' ? null : '2026-03-01T00:00:00.000Z',
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
});

const BACK = episode('e-back', 'Lumbalgia');
const ANKLE = episode('e-ankle', 'Esguince de tobillo');
const SHOULDER = episode('e-shoulder', 'Tendinitis de hombro', 'DISCHARGED');

function renderForm(props: Partial<Parameters<typeof SessionFormModalWide>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SessionFormModalWide open onOpenChange={() => {}} patientId="p1" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(episodeApi.list).mockResolvedValue([BACK, ANKLE, SHOULDER]);
});

const session: Session = {
  id: 's1',
  version: 3,
  patientId: 'p1',
  sessionType: 'SESSION',
  sessionDate: '2026-02-24T13:00:00.000Z',
  observations: null,
  createdAt: '2026-02-24T13:00:00.000Z',
  updatedAt: '2026-02-24T13:00:00.000Z',
  annulledAt: null,
  episodes: [
    {
      episodeId: BACK.id,
      preSessionState: null,
      treatment: 'Rana en el suelo',
      painScaleBefore: 5,
      painScaleAfter: 2,
      patientExercises: 'Pared',
      reEvaluationNotes: null,
    },
    {
      episodeId: ANKLE.id,
      preSessionState: 'Llega rengueando',
      treatment: 'Drenaje',
      painScaleBefore: 6,
      painScaleAfter: 4,
      patientExercises: 'Hielo',
      reEvaluationNotes: null,
    },
  ],
};

describe('SessionFormModalWide: revisions', () => {
  const STALE = 'Otra persona editó este registro. Recargá para ver los cambios.';

  async function editAndSave() {
    renderForm({ session });
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByDisplayValue('Drenaje'), ' y movilidad');
    await chooseReason(undefined, dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar sesión' }));
    return dialog;
  }

  it('an edit sends the version it loaded, the chosen reason and the note', async () => {
    update.mockResolvedValue(session);
    renderForm({ session });
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('combobox', { name: 'Motivo del cambio' })).toHaveTextContent('Elegí un motivo');
    await userEvent.type(within(dialog).getByDisplayValue('Drenaje'), ' y movilidad');
    await chooseReason('Aclaración', dialog);
    await userEvent.type(within(dialog).getByLabelText('Nota del cambio (opcional)'), 'Dictado por la paciente');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar sesión' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][2]).toMatchObject({
      expectedVersion: 3,
      reason: 'CLARIFICATION',
      reasonNote: 'Dictado por la paciente',
    });
  });

  it('an untouched field still sends the loaded value', async () => {
    update.mockResolvedValue(session);
    await editAndSave();

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][2].sessionDate).toBe(session.sessionDate);
    expect(update.mock.calls[0][2].episodes?.[0]).toMatchObject({ treatment: 'Rana en el suelo', painScaleBefore: 5 });
  });

  it('a new session asks for no reason and sends neither', async () => {
    create.mockResolvedValue({} as Session);
    renderForm({ episodeId: BACK.id });
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).queryByText('Motivo del cambio')).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getAllByPlaceholderText('0.00')[0], '100');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar sesión' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][1]).not.toHaveProperty('expectedVersion');
    expect(create.mock.calls[0][1]).not.toHaveProperty('reason');
  });

  it('a 409 shows the message, keeps what was typed, and reloads on request', async () => {
    update.mockRejectedValue(new ApiError(STALE, 409, { error: STALE }));
    vi.mocked(sessionApi.get).mockResolvedValue({
      ...session,
      version: 4,
      episodes: [{ ...session.episodes[1], treatment: 'Lo que guardó la otra persona' }],
    });
    const dialog = await editAndSave();

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(STALE);
    expect(within(dialog).getByDisplayValue('Drenaje y movilidad')).toBeInTheDocument();

    await userEvent.click(within(alert).getByRole('button', { name: 'Recargar' }));

    expect(await within(dialog).findByDisplayValue('Lo que guardó la otra persona')).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();

    update.mockResolvedValue(session);
    await userEvent.type(within(dialog).getByDisplayValue('Lo que guardó la otra persona'), ' y más');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar sesión' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][2].expectedVersion).toBe(4);
  });
});

describe('SessionFormModalWide: annulling', () => {
  async function openAnnul() {
    renderForm({ session });
    const form = await screen.findByRole('dialog');
    expect(within(form).queryByRole('button', { name: 'Eliminar' })).toBeNull();
    await userEvent.click(within(form).getByRole('button', { name: 'Anular' }));
    return screen.findByRole('dialog', { name: '¿Anular esta sesión?' });
  }

  it('asks for a reason, with none preselected, and sends it with the note', async () => {
    annul.mockResolvedValue(undefined);
    const dialog = await openAnnul();
    expect(within(dialog).getByRole('combobox', { name: 'Motivo de la anulación' })).toHaveTextContent('Elegí un motivo');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Anular' }));
    expect(within(dialog).getByText('Elegí el motivo de la anulación')).toBeInTheDocument();
    expect(annul).not.toHaveBeenCalled();

    await chooseReason('Error de confección', dialog, 'Motivo de la anulación');
    await userEvent.type(within(dialog).getByLabelText('Nota (opcional)'), 'Cargada en la paciente equivocada');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anular' }));

    await waitFor(() => expect(annul).toHaveBeenCalledTimes(1));
    expect(annul).toHaveBeenCalledWith('p1', 's1', { reason: 'DATA_ENTRY_ERROR', reasonNote: 'Cargada en la paciente equivocada' });
  });

  it("shows the API's message when the session is paid", async () => {
    const { toast } = await import('sonner');
    const PAID = 'La sesión tiene un cobro ya pagado. Revertí el cobro antes de anularla.';
    annul.mockRejectedValue(new ApiError(PAID, 409, { error: PAID }));
    const dialog = await openAnnul();
    await chooseReason(undefined, dialog, 'Motivo de la anulación');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anular' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(PAID));
  });
});

describe('SessionFormModalWide: several motives', () => {
  it('offers every open episode, not the closed ones, and sends one block per ticked motive', async () => {
    create.mockResolvedValue({} as Session);
    renderForm({ episodeId: BACK.id });
    const dialog = await screen.findByRole('dialog');

    // The episode it was opened from comes ticked; the closed one is not offered.
    expect(await within(dialog).findByRole('button', { name: 'Lumbalgia', pressed: true })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Tendinitis de hombro' })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/episodios cerrados no aparecen/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Esguince de tobillo', pressed: false }));
    await userEvent.type(within(dialog).getAllByPlaceholderText('0.00')[0], '100');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar sesión' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][1].episodes.map((b) => b.episodeId)).toEqual([BACK.id, ANKLE.id]);
  });

  it('refuses a session without a motive', async () => {
    renderForm({ episodeId: BACK.id });
    const dialog = await screen.findByRole('dialog');

    await userEvent.click(await within(dialog).findByRole('button', { name: 'Lumbalgia', pressed: true }));
    await userEvent.type(within(dialog).getAllByPlaceholderText('0.00')[0], '100');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar sesión' }));

    expect(await within(dialog).findByText('Elegí al menos un motivo')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('an edit keeps the other block as it was loaded', async () => {
    update.mockResolvedValue(session);
    renderForm({ session });
    const dialog = await screen.findByRole('dialog');

    await userEvent.type(within(dialog).getByDisplayValue('Drenaje'), ' y movilidad');
    await chooseReason(undefined, dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar sesión' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    // Each motive keeps its own treatment: editing the ankle's leaves the back's.
    expect(update.mock.calls[0][2].episodes).toEqual([
      {
        episodeId: BACK.id,
        preSessionState: '',
        treatment: 'Rana en el suelo',
        painScaleBefore: 5,
        painScaleAfter: 2,
        patientExercises: 'Pared',
        reEvaluationNotes: '',
      },
      {
        episodeId: ANKLE.id,
        preSessionState: 'Llega rengueando',
        treatment: 'Drenaje y movilidad',
        painScaleBefore: 6,
        painScaleAfter: 4,
        patientExercises: 'Hielo',
        reEvaluationNotes: '',
      },
    ]);
  });
});
