import { Router } from 'express';
import { revisionRepo } from '../repositories';
import type { RevisionTarget } from '../repositories/revisionRepository';
import { versionParam } from '../middlewares/idParam';

// The history of a clinical record (SPEC-clinical-revisions.md §7): mounted by
// the router of each versioned aggregate at `…/revisions`, with mergeParams, so
// it reads the patient and the aggregate from its parent's path:
//
//   GET …/revisions            the versions, newest first, with action, reason
//                              and author (no content)
//   GET …/revisions/:version   one version's snapshot and note
//
// Inside the record: every user of the clinic may read it, as the record itself
// (spec §7). No global route returns a snapshot or a reason note.
const VERSION_NOT_FOUND = 'Versión no encontrada';

export function revisionRoutes(
  target: (params: Record<string, string>) => RevisionTarget,
  notFoundMessage: string,
): Router {
  const router = Router({ mergeParams: true });
  router.param('version', versionParam(VERSION_NOT_FOUND));

  // The patient's router names her `:id`; the others `:patientId`.
  type Params = Record<string, string>;
  const patientId = (params: Params) => params.patientId ?? params.id;

  router.get<Params>('/', async (req, res) => {
    const data = await revisionRepo.list(req.context, patientId(req.params), target(req.params));
    if (!data) {
      res.status(404).json({ error: notFoundMessage });
      return;
    }
    res.json({ data });
  });

  router.get<Params>('/:version', async (req, res) => {
    const result = await revisionRepo.get(
      req.context,
      patientId(req.params),
      target(req.params),
      Number(req.params.version),
    );
    if (!result.ok) {
      res.status(404).json({ error: result.reason === 'not_found' ? notFoundMessage : VERSION_NOT_FOUND });
      return;
    }
    res.json({ data: result.revision });
  });

  return router;
}
