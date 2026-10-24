import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SessionFormModalWide from '@/components/sessions/SessionFormModalWide';
import { episodeApi } from '@/services/episodes';
import { sessionApi } from '@/services/sessions';
import type { ClinicalEpisode } from '@/types/episode';
import type { Session } from '@/types/session';

// A visit can treat several problems (#238): the form lets the therapist tick
// every open episode, each with its own block, and sends the whole set.
vi.mock('@/services/sessions', () => ({
  sessionKeys: { list: (patientId: string) => ['patients', patientId, 'sessions'] },
  sessionApi: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
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
    const session: Session = {
      id: 's1',
      patientId: 'p1',
      sessionType: 'SESSION',
      sessionDate: '2026-02-24T13:00:00.000Z',
      observations: null,
      createdAt: '2026-02-24T13:00:00.000Z',
      updatedAt: '2026-02-24T13:00:00.000Z',
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
    update.mockResolvedValue(session);
    renderForm({ session });
    const dialog = await screen.findByRole('dialog');

    await userEvent.type(within(dialog).getByDisplayValue('Drenaje'), ' y movilidad');
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
