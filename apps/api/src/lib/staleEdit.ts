import { z } from 'zod';

// An edit of a clinical record names the version it was made over
// (SPEC-clinical-revisions.md §5). Optional: a client that sends none
// overwrites, as before revisions; the forms always send it.
export const ExpectedVersionSchema = z.number().int().min(0).optional();

// The 409 of an edit made over a version that is no longer the latest.
export const STALE_EDIT = { error: 'Otra persona editó este registro. Recargá para ver los cambios.' } as const;
