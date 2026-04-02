import { Router } from 'express';
import { retrieveMemories } from '../../memory/service';

const router = Router();

router.post('/retrieve', async (req, res) => {
  try {
    const { internal_user_id, persona_id, query_text, intent_type } = req.body;

    if (!internal_user_id || !persona_id || !query_text) {
      res.status(400).json({
        error: 'Missing required fields: internal_user_id, persona_id, query_text',
      });
      return;
    }

    const result = await retrieveMemories({
      internal_user_id,
      persona_id,
      query_text,
      intent_type,
    });

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
