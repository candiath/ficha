import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PatientFormDialog from '@/components/patients/PatientFormDialog';
import { ApiError } from '@/lib/api';
import { patientApi } from '@/services/patients';
import type { Patient } from '@/types/patient';
import { chooseReason } from './revisionReason';

// Editing a patient (SPEC-clinical-revisions.md §4, §5): the form reads the
// record itself, with its version, and says why it corrects it.
vi.mock('@/services/patients', () => ({
  patientKeys: { all: ['patients'], detail: (id: string) => ['patients', id] },
  patientApi: { get: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const STALE = 'Otra persona editó este registro. Recargá para ver los cambios.';

const LISTED: Patient = {
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
};
const RECORD: Patient = { ...LISTED, occupation: 'Abogada', version: 4 };

const get = vi.mocked(patientApi.get);
const update = vi.mocked(patientApi.update);
const create = vi.mocked(patientApi.create);

function renderDialog(patient?: Patient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PatientFormDialog open onClose={vi.fn()} patient={patient} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue(RECORD);
  update.mockResolvedValue(RECORD);
});

describe('PatientFormDialog', () => {
  it('renders an edit from the record, not from the list item it was opened with', async () => {
    renderDialog(LISTED);

    const occupation = (await screen.findByPlaceholderText('Docente')) as HTMLInputElement;
    expect(occupation.value).toBe('Abogada');
    expect(get).toHaveBeenCalledWith('p1');
  });

  it('sends nothing until a reason is chosen, and says so on the field', async () => {
    renderDialog(LISTED);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByPlaceholderText('Docente');
    const reason = within(dialog).getByRole('combobox', { name: 'Motivo del cambio' });
    expect(reason).toHaveTextContent('Elegí un motivo');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await within(dialog).findByText('Elegí el motivo del cambio')).toBeInTheDocument();
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(reason).toHaveFocus();
    expect(update).not.toHaveBeenCalled();

    await chooseReason('Información recibida después', dialog);
    expect(within(dialog).queryByText('Elegí el motivo del cambio')).toBeNull();
  });

  it('sends the version it read, the chosen reason and the note', async () => {
    renderDialog(LISTED);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByPlaceholderText('Docente');

    await chooseReason('Información recibida después', dialog);
    await userEvent.type(within(dialog).getByLabelText('Nota del cambio (opcional)'), 'Cambió de trabajo');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toMatchObject({
      occupation: 'Abogada',
      expectedVersion: 4,
      reason: 'LATE_INFORMATION',
      reasonNote: 'Cambió de trabajo',
    });
  });

  it('asks for no reason when creating, and sends none', async () => {
    create.mockResolvedValue(RECORD);
    renderDialog();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Motivo del cambio')).toBeNull();

    await userEvent.type(within(dialog).getByPlaceholderText('María José'), 'Ana');
    await userEvent.type(within(dialog).getByPlaceholderText('García López'), 'Pérez');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).not.toHaveProperty('reason');
    expect(get).not.toHaveBeenCalled();
  });

  it('on a 409 shows the message, keeps what was typed, and reloads on request', async () => {
    update.mockRejectedValueOnce(new ApiError(STALE, 409, { error: STALE }));
    renderDialog(LISTED);
    const dialog = await screen.findByRole('dialog');
    const occupation = (await within(dialog).findByPlaceholderText('Docente')) as HTMLInputElement;
    await userEvent.clear(occupation);
    await userEvent.type(occupation, 'Mía');
    await chooseReason(undefined, dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain(STALE);
    expect(occupation.value).toBe('Mía');

    get.mockResolvedValue({ ...RECORD, occupation: 'De otra persona', version: 5 });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Recargar' }));

    await waitFor(() =>
      expect((within(dialog).getByPlaceholderText('Docente') as HTMLInputElement).value).toBe('De otra persona'),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][1].expectedVersion).toBe(5);
  });
});
