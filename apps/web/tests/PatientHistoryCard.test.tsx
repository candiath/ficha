import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientHistoryCard } from '@/components/patients/PatientHistoryCard';
import { patientEventApi } from '@/services/patientEvents';
import type { PatientEvent } from '@/types/patientEvent';
import { ApiError } from '@/lib/api';
import { chooseReason } from './revisionReason';

// The patient's history (#238): "hace dos meses" is stored as the month it
// meant, computed with the clinic's today.
vi.mock('@/services/patientEvents', () => ({
  patientEventKeys: { list: (patientId: string) => ['patients', patientId, 'events'] },
  patientEventApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

vi.mock('@/services/tenant', () => ({
  tenantKeys: { config: ['tenant'] },
  tenantApi: { get: vi.fn().mockResolvedValue({ timezone: 'America/Argentina/Buenos_Aires' }) },
}));

vi.mock('@/lib/agendaDates', () => ({ todayInClinic: () => '2026-10-14' }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const list = vi.mocked(patientEventApi.list);
const create = vi.mocked(patientEventApi.create);
const update = vi.mocked(patientEventApi.update);
const STALE = 'Otra persona editó este registro. Recargá para ver los cambios.';

const FRACTURE: PatientEvent = {
  id: 'ev1',
  patientId: 'p1',
  kind: 'FRACTURE',
  description: 'Fractura de muñeca izquierda',
  occurred: { date: '2019-01-01', precision: 'YEAR', approximate: false },
  createdAt: '2026-10-01T13:00:00.000Z',
  updatedAt: '2026-10-01T13:00:00.000Z',
  version: 2,
};

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PatientHistoryCard patientId="p1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue([FRACTURE]);
});

describe('PatientHistoryCard', () => {
  it('shows each event with its date and how long ago, from today', async () => {
    renderCard();

    expect(await screen.findByText('Fractura de muñeca izquierda')).toBeInTheDocument();
    expect(screen.getByText('2019 · hace 7 años')).toBeInTheDocument();
  });

  it('stores "hace 2 meses" as the month it meant, approximate', async () => {
    create.mockResolvedValue(FRACTURE);
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar' }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Tipo' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Inicio del dolor' }));
    await userEvent.type(within(dialog).getByLabelText('Descripción'), 'Dolor lumbar');
    await userEvent.type(within(dialog).getByLabelText('Cantidad'), '2');

    expect(within(dialog).getByText('Queda registrado como: ~agosto de 2026')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith('p1', {
      kind: 'PAIN_ONSET',
      description: 'Dolor lumbar',
      occurred: { date: '2026-08-01', precision: 'MONTH', approximate: true },
    });
  });

  it('an edit sends the version it loaded, the chosen reason and the note', async () => {
    update.mockResolvedValue({ ...FRACTURE, version: 3 });
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar antecedente' }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.type(within(dialog).getByLabelText('Descripción'), ', con yeso');
    await chooseReason('Información recibida después', dialog);
    await userEvent.type(within(dialog).getByLabelText('Nota del cambio (opcional)'), 'Lo recordó');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('p1', 'ev1', {
      kind: 'FRACTURE',
      description: 'Fractura de muñeca izquierda, con yeso',
      occurred: FRACTURE.occurred,
      expectedVersion: 2,
      reason: 'LATE_INFORMATION',
      reasonNote: 'Lo recordó',
    });
  });

  it('a new event asks for no reason', async () => {
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Motivo del cambio')).toBeNull();
  });

  it('a 409 shows the message, keeps what was typed, and reloads on request', async () => {
    update.mockRejectedValueOnce(new ApiError(STALE, 409, { error: STALE }));
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar antecedente' }));
    const dialog = await screen.findByRole('dialog');
    const description = within(dialog).getByLabelText('Descripción') as HTMLInputElement;
    await userEvent.type(description, ' (mía)');
    await chooseReason(undefined, dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain(STALE);
    expect(description.value).toBe('Fractura de muñeca izquierda (mía)');

    list.mockResolvedValue([{ ...FRACTURE, description: 'De otra persona', version: 3 }]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Recargar' }));

    const reloaded = await screen.findByRole('dialog');
    await waitFor(() => expect((within(reloaded).getByLabelText('Descripción') as HTMLInputElement).value).toBe('De otra persona'));
    expect(within(reloaded).queryByRole('alert')).toBeNull();
  });
});
