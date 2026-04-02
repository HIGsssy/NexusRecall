import { Router } from 'express';
import { storeMemory } from '../../memory/service';

const router = Router();

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
