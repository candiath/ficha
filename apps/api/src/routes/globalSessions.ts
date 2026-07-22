import { Router } from 'express';

const router = Router();

// GET /api/sessions — todas las sesiones del tenant, con nombre del paciente.
// Una sesión puede abordar varios episodios (motivos), por eso se devuelven como
// arreglo `episodes` y se aplana también a `episodeIds`.
router.get('/', async (req, res) => {
  const sessions = await req.db.session.findMany({
    orderBy: { sessionDate: 'desc' },
    select: {
      id: true,
      patientId: true,
      sessionType: true,
      sessionDate: true,
      painScaleBefore: true,
      painScaleAfter: true,
      preSesionState: true,
      reEvaluationNotes: true,
      patientResponse: true,
      observations: true,
      createdAt: true,
      updatedAt: true,
      patient: {
        select: { id: true, fullName: true },
      },
      episodes: {
        select: { episode: { select: { id: true, mainComplaint: true } } },
      },
    },
  });

  const data = sessions.map(({ episodes, ...rest }) => {
    const linked = episodes.map((e) => e.episode);
    return { ...rest, episodes: linked, episodeIds: linked.map((e) => e.id) };
  });

  res.json({ data });
});

export default router;
