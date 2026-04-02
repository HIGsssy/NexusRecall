import { Router } from 'express';
import { getSession } from '../session/store';

const router = Router();

router.get('/sessions/:id/diagnostics', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session.diagnostics);
});

router.get('/sessions/:id/diagnostics/latest', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const latest = session.diagnostics[session.diagnostics.length - 1];
  if (!latest) {
    res.status(404).json({ error: 'No diagnostics recorded yet' });
    return;
  }
  res.json(latest);
});

export default router;
