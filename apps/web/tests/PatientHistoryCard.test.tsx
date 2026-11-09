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
  patientEventApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), annul: vi.fn() },
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
const annul = vi.mocked(patientEventApi.annul);
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
  annulledAt: null,
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

  it('annuls with the chosen reason and note, never with one it did not choose', async () => {
    annul.mockResolvedValue(undefined);
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Anular antecedente' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('¿Anular este antecedente?')).toBeInTheDocument();

    // No reason is preselected: confirming marks the field and sends nothing.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anular' }));
    expect(within(dialog).getByText('Elegí el motivo de la anulación')).toBeInTheDocument();
    expect(annul).not.toHaveBeenCalled();

    await chooseReason('Otro motivo', dialog, 'Motivo de la anulación');
    await userEvent.type(within(dialog).getByLabelText('Nota (opcional)'), 'Era de otra paciente');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anular' }));

    await waitFor(() => expect(annul).toHaveBeenCalledTimes(1));
    expect(annul).toHaveBeenCalledWith('p1', 'ev1', { reason: 'OTHER', reasonNote: 'Era de otra paciente' });
  });

  it('shows an annulled event struck through, with its history and nothing to edit', async () => {
    list.mockResolvedValue([{ ...FRACTURE, annulledAt: '2026-10-10T12:00:00.000Z' }]);
    renderCard();

    const description = await screen.findByText('Fractura de muñeca izquierda');
    expect(description).toHaveClass('line-through');
    expect(screen.getByText('Anulado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver historial del antecedente' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar antecedente' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Anular antecedente' })).toBeNull();
  });

  it('opens the next annulment with nothing chosen, after one that succeeded', async () => {
    annul.mockResolvedValue(undefined);
    const SURGERY: PatientEvent = { ...FRACTURE, id: 'ev2', kind: 'SURGERY', description: 'Apendicectomía' };
    list.mockResolvedValue([FRACTURE, SURGERY]);
    renderCard();

    const [first] = await screen.findAllByRole('button', { name: 'Anular antecedente' });
    await userEvent.click(first);
    let dialog = await screen.findByRole('dialog');
    await chooseReason('Otro motivo', dialog, 'Motivo de la anulación');
    await userEvent.type(within(dialog).getByLabelText('Nota (opcional)'), 'Era de otra paciente');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anular' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getAllByRole('button', { name: 'Anular antecedente' })[1]);
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Motivo de la anulación' })).toHaveTextContent('Elegí un motivo');
    expect(within(dialog).getByLabelText('Nota (opcional)')).toHaveValue('');
  });

  it('closes the annulment and reloads the list when the event was already annulled elsewhere', async () => {
    const GONE = 'Antecedente no encontrado';
    annul.mockRejectedValue(new ApiError(GONE, 404, { error: GONE }));
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Anular antecedente' }));
    const dialog = await screen.findByRole('dialog');
    await chooseReason(undefined, dialog, 'Motivo de la anulación');
    list.mockResolvedValue([{ ...FRACTURE, annulledAt: '2026-10-10T12:00:00.000Z' }]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anular' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Anulado')).toBeInTheDocument();
  });
});

