import { Router } from 'express';
import { storeMemory } from '../../memory/service';
import { getIngestionDebugLog } from '../../memory/ingestion';
import { getClassificationMetrics, resetClassificationMetrics } from '../../memory/ingestion/metrics';

const router = Router();

router.get('/ingest/metrics', (req, res) => {
  const reset = req.query.reset === 'true';
  if (reset) {
    res.json(resetClassificationMetrics());
  } else {
    res.json(getClassificationMetrics());
  }
});

router.get('/ingest/debug', (_req, res) => {
  const userId = _req.query.user_id as string | undefined;
  const personaId = _req.query.persona_id as string | undefined;
  res.json(getIngestionDebugLog(userId, personaId));
});

router.post('/ingest', async (req, res) => {
  try {
    const { internal_user_id, persona_id, session_id, role, content, metadata } = req.body;

    if (!internal_user_id || !persona_id || !session_id || !role || !content) {
      res.status(400).json({
        error: 'Missing required fields: internal_user_id, persona_id, session_id, role, content',
      });
      return;
    }

    const result = await storeMemory({
      internal_user_id,
      persona_id,
      session_id,
      role,
      content,
      metadata,
    });

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
