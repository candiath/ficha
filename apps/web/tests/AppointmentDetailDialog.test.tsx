import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentListItem } from '@ficha/shared';
import AppointmentDetailDialog from '@/components/agenda/AppointmentDetailDialog';
import { appointmentApi } from '@/services/appointments';
import { episodeApi } from '@/services/episodes';

// The agenda's range carries no complaint and no notes (#186,
// SPEC-list-minimization.md §2). The dialog reads the appointment's notes
// from its own route, and the episode's complaint only when asked: people open
// it to confirm, cancel or mark a no-show, and each look into the record is a
// clinical read.
vi.mock('@/services/appointments', () => ({
  appointmentKeys: {
    all: ['appointments'],
    detail: (id: string) => ['appointments', 'detail', id],
  },
  appointmentApi: { get: vi.fn(), update: vi.fn(), cancelSeries: vi.fn() },
}));

vi.mock('@/services/episodes', () => ({
  episodeKeys: { list: (patientId: string) => ['patients', patientId, 'episodes'] },
  episodeApi: { list: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const get = vi.mocked(appointmentApi.get);
const listEpisodes = vi.mocked(episodeApi.list);

const ITEM: AppointmentListItem = {
  id: 'a1',
  patientId: 'p1',
  patientName: 'María García',
  userId: 'u1',
  episodeId: 'e1',
  sessionId: null,
  seriesId: null,
  startsAt: '2026-10-12T12:00:00.000Z',
  endsAt: '2026-10-12T13:00:00.000Z',
  date: '2026-10-12',
  startTime: '09:00',
  endTime: '10:00',
  status: 'SCHEDULED',
  cancelledAt: null,
};

function renderDialog(appointment: AppointmentListItem = ITEM) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AppointmentDetailDialog appointment={appointment} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ ...ITEM, notes: 'Viene con estudios' });
});

describe('AppointmentDetailDialog', () => {
  it("shows the notes read from the appointment's own route", async () => {
    renderDialog();

    expect(await screen.findByText('Viene con estudios')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('a1');
  });

  it('reads no complaint until "Ver motivo"', async () => {
    listEpisodes.mockResolvedValue([
      { id: 'e1', mainComplaint: 'Lumbalgia' },
      { id: 'e2', mainComplaint: 'Cervicalgia' },
    ] as Awaited<ReturnType<typeof episodeApi.list>>);
    renderDialog();
    await screen.findByText('Viene con estudios');

    expect(listEpisodes).not.toHaveBeenCalled();
    expect(screen.queryByText('Lumbalgia')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ver motivo' }));

    expect(await screen.findByText('Lumbalgia')).toBeInTheDocument();
    expect(listEpisodes).toHaveBeenCalledWith('p1');
    expect(screen.queryByText('Cervicalgia')).not.toBeInTheDocument();
  });

  it('offers no complaint for an appointment without an episode', async () => {
    renderDialog({ ...ITEM, episodeId: null });
    await screen.findByText('Viene con estudios');

    expect(screen.queryByRole('button', { name: 'Ver motivo' })).not.toBeInTheDocument();
  });

  it('says so when the record cannot be read', async () => {
    listEpisodes.mockRejectedValue(new Error('Paciente no encontrado'));
    renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: 'Ver motivo' }));

    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText(/No se pudo leer el motivo/)).toBeInTheDocument();
  });
});
