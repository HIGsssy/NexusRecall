import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  createSession,
  getSession,
  deleteSession,
  listSessions,
  updateSession,
} from '../session/store';
import type { IntentType } from '../nexus-types';

const router = Router();

router.post('/sessions', (req, res) => {
  const { internalUserId, personaId, personaPrompt, intentType } = req.body;

  if (!internalUserId || !personaId || !personaPrompt) {
    res.status(400).json({
      error: 'Missing required fields: internalUserId, personaId, personaPrompt',
    });
    return;
  }

  const session = createSession({
    id: uuidv4(),
    internalUserId,
    personaId,
    personaPrompt,
    intentType: (intentType as IntentType) || 'conversational',
  });

  res.json(session);
});

router.get('/sessions', (_req, res) => {
  res.json(listSessions());
});

router.get('/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session);
});

router.patch('/sessions/:id', (req, res) => {
  const session = updateSession(req.params.id, req.body);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session);
});

router.delete('/sessions/:id', (req, res) => {
  const ok = deleteSession(req.params.id);
  res.json({ deleted: ok });
});

export default router;
