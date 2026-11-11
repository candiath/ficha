import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PatientsPage from '@/pages/PatientsPage';
import { patientApi } from '@/services/patients';
import type { Patient } from '@/types/patient';

// Deleting a patient can be undone from "Eliminados" (CLAUDE.md, "Borrado de
// pacientes"). The toast's "Deshacer" calls the same restore.
vi.mock('@/services/patients', () => ({
  patientKeys: { all: ['patients'], detail: (id: string) => ['patients', id], deleted: ['patients', 'deleted'] },
  patientApi: {
    list: vi.fn(),
    remove: vi.fn(),
    listDeleted: vi.fn(),
    restore: vi.fn(),
  },
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PatientsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(patientApi.list).mockResolvedValue([PATIENT]);
  vi.mocked(patientApi.remove).mockResolvedValue(undefined);
  vi.mocked(patientApi.restore).mockResolvedValue(undefined);
  vi.mocked(patientApi.listDeleted).mockResolvedValue([
    { id: 'p2', fullName: 'Juan Pérez', deletedAt: '2026-11-10T13:00:00.000Z' },
  ]);
});

describe('PatientsPage: undoing a deletion', () => {
  it('restores a patient from the deleted list', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Eliminados/ }));
    expect(await screen.findByText('Juan Pérez')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Restaurar' }));

    await waitFor(() => expect(patientApi.restore).toHaveBeenCalledWith('p2'));
    expect(toast.success).toHaveBeenCalledWith('Paciente restaurado');
  });
});
