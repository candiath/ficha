import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RevisionHistoryDialog from '@/components/patients/RevisionHistoryDialog';
import { renderSessionSnapshot } from '@/lib/revisionRows';
import { revisionApi } from '@/services/revisions';
import type { Revision, RevisionSummary } from '@/types/revision';

// The history of a session (SPEC-clinical-revisions.md §7): the versions, and
// the selected one read-only from its snapshot, with what it changed marked.
vi.mock('@/services/revisions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/revisions')>()),
  revisionApi: { list: vi.fn(), get: vi.fn() },
}));

const BASE = '/api/patients/p1/sessions/s1/revisions';
const AUTHOR = { id: 'u1', name: 'Laura Revisora' };

const block = (episodeId: string, treatment: string) => ({
  episodeId,
  preSessionState: null,
  treatment,
  painScaleBefore: 6,
  painScaleAfter: 3,
  patientExercises: null,
  reEvaluationNotes: null,
});

const snapshot = (episodes: ReturnType<typeof block>[]) => ({
  userId: 'u1',
  sessionType: 'SESSION',
  sessionDate: '2026-11-02T13:00:00.000Z',
  observations: null,
  episodes,
});

const V1: Revision = {
  version: 1,
  action: 'SESSION_RECORDED',
  params: { sessionType: 'SESSION' },
  actorType: 'USER',
  author: AUTHOR,
  createdAt: '2026-11-02T13:05:00.000Z',
  schemaVersion: 1,
  reasonNote: null,
  snapshot: snapshot([block('e1', 'Lumbar'), block('e2', 'Tobillo')]),
};

// The ankle's block was removed, and the back's treatment corrected.
const V2: Revision = {
  version: 2,
  action: 'SESSION_UPDATED',
  params: { sessionType: 'SESSION', changedFields: ['episodeIds', 'treatment'], reason: 'LATE_INFORMATION' },
  actorType: 'USER',
  author: AUTHOR,
  createdAt: '2026-11-03T10:00:00.000Z',
  schemaVersion: 1,
  reasonNote: 'El tobillo era de otra visita',
  snapshot: snapshot([block('e1', 'Lumbar, con elongación')]),
};

const summary = ({ schemaVersion: _s, reasonNote: _r, snapshot: _n, ...r }: Revision): RevisionSummary => r;
const EPISODES: Record<string, string> = { e1: 'Lumbalgia', e2: 'Esguince de tobillo' };

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RevisionHistoryDialog
        open
        onOpenChange={() => {}}
        patientId="p1"
        base={BASE}
        title="Historial de la sesión"
        render={renderSessionSnapshot}
        renderContext={{ episodeName: (id) => EPISODES[id] }}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(revisionApi.list).mockResolvedValue([summary(V2), summary(V1)]);
  vi.mocked(revisionApi.get).mockImplementation(async (_base, version) => {
    const revision = { 1: V1, 2: V2 }[version];
    if (!revision) throw new Error(`no version ${version}`);
    return revision;
  });
});

describe('RevisionHistoryDialog', () => {
  it('lists every version, newest first, with action, reason and author', async () => {
    renderDialog();

    const list = await screen.findByRole('list', { name: 'Versiones' });
    const items = within(list).getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^Versión 2 · .*Información recibida después · Laura Revisora · /),
      expect.stringMatching(/^Versión 1 · .*Laura Revisora · /),
    ]);
    expect(items[0]).toHaveAttribute('aria-pressed', 'true');
    expect(revisionApi.list).toHaveBeenCalledWith(BASE);
  });

  it('shows the newest version with its note, and marks what it changed', async () => {
    renderDialog();

    const detail = await screen.findByRole('region', { name: 'Versión 2' });
    expect(await within(detail).findByText('Lumbar, con elongación')).toBeInTheDocument();
    expect(within(detail).getByText('El tobillo era de otra visita')).toBeInTheDocument();
    // Compared with version 1: the treatment changed, the pain did not.
    const treatment = within(detail).getByText('Lumbar, con elongación').closest('[data-changed]');
    expect(treatment).not.toBeNull();
    expect(within(detail).getAllByText('Modificado')).toHaveLength(1);
    expect(within(detail).getByText('Se quitó en esta versión:')).toBeInTheDocument();
    expect(within(detail).getByRole('listitem')).toHaveTextContent('Motivo: Esguince de tobillo');
    expect(within(detail).queryByText('Tobillo')).not.toBeInTheDocument();
  });

  it('shows the removed block in the old version, with nothing marked', async () => {
    renderDialog();

    const list = await screen.findByRole('list', { name: 'Versiones' });
    await userEvent.click(within(list).getAllByRole('button')[1]);

    const detail = await screen.findByRole('region', { name: 'Versión 1' });
    expect(await within(detail).findByText('Tobillo')).toBeInTheDocument();
    expect(within(detail).getByRole('heading', { name: 'Motivo: Esguince de tobillo' })).toBeInTheDocument();
    expect(within(detail).getByText('Lumbar')).toBeInTheDocument();
    expect(within(detail).queryByText('Modificado')).not.toBeInTheDocument();
    expect(revisionApi.get).toHaveBeenCalledWith(BASE, 1);
  });

  it('says so when the record has no versions yet', async () => {
    vi.mocked(revisionApi.list).mockResolvedValue([]);
    renderDialog();

    expect(await screen.findByText(/todavía no tiene versiones guardadas/)).toBeInTheDocument();
  });

  it('does not guess at a snapshot it cannot read', async () => {
    vi.mocked(revisionApi.list).mockResolvedValue([summary(V1)]);
    vi.mocked(revisionApi.get).mockResolvedValue({ ...V1, schemaVersion: 2 });
    renderDialog();

    expect(await screen.findByText(/formato que esta pantalla no sabe mostrar/)).toBeInTheDocument();
  });
});
