import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PatientDetailPage from '@/pages/PatientDetailPage';
import { episodeApi } from '@/services/episodes';
import { patientApi } from '@/services/patients';
import type { ClinicalEpisode } from '@/types/episode';
import type { Patient } from '@/types/patient';

// Closing an episode "now" is the API's to stamp: a device whose clock runs
// behind the server's would otherwise send a closing time before the opening
// the server stamped, and the close would be refused.
vi.mock('@/services/patients', () => ({
  patientKeys: { all: ['patients'], detail: (id: string) => ['patients', id] },
  patientApi: { get: vi.fn() },
}));

vi.mock('@/services/episodes', () => ({
  episodeKeys: { list: (patientId: string) => ['patients', patientId, 'episodes'] },
  episodeApi: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
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
};

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
  vi.mocked(episodeApi.update).mockResolvedValue({ ...EPISODE, status: 'ABANDONED' });
});

describe('PatientDetailPage: closing an episode', () => {
  it('records an abandonment with its status only, leaving the time to the API', async () => {
    renderPage();

    await userEvent.click(await screen.findByTitle('Editar motivo del episodio'));
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar abandono' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar abandono' }));

    await waitFor(() => expect(episodeApi.update).toHaveBeenCalledTimes(1));
    expect(episodeApi.update).toHaveBeenCalledWith('p1', 'e1', { status: 'ABANDONED' });
  });
});
