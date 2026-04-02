import { Router, Request, Response } from 'express';
import { getSession } from '../session/store';
import { retrieveMemories, ingestExchange } from '../nexus-client';
import { assemblePrompt } from '../prompt/assembler';
import { createLLMProvider } from '../llm/factory';
import { harnessConfig } from '../config';
import type { TurnDiagnostics } from '../session/store';

const router = Router();
const llm = createLLMProvider(harnessConfig);

function sendEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

router.post('/chat', async (req: Request, res: Response) => {
  const { sessionId, message } = req.body;

  if (!sessionId || !message) {
    res.status(400).json({ error: 'Missing required fields: sessionId, message' });
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const startTime = Date.now();

  try {
    // 1. Retrieve memories
    const retrieval = await retrieveMemories({
      internal_user_id: session.internalUserId,
      persona_id: session.personaId,
      query_text: message,
      intent_type: session.intentType,
    });

    sendEvent(res, 'retrieval', {
      memories: retrieval.memories,
      cache_hit: retrieval.cache_hit,
    });

    // 2. Assemble prompt
    const assembled = assemblePrompt({
      personaPrompt: session.personaPrompt,
      memories: retrieval.memories,
      history: session.history,
      userMessage: message,
    });

    // 3. Stream LLM response
    let fullResponse = '';
    for await (const chunk of llm.streamComplete(assembled)) {
      fullResponse += chunk;
      sendEvent(res, 'delta', { content: chunk });
    }

    // 4. Update session history
    session.history.push({ role: 'user', content: message });
    session.history.push({ role: 'assistant', content: fullResponse });

    // 5. Ingest both turns
    const harnessSessionId = `harness-${session.id}`;
    const [userIngest, assistantIngest] = await Promise.all([
      ingestExchange({
        internal_user_id: session.internalUserId,
        persona_id: session.personaId,
        session_id: harnessSessionId,
        role: 'user',
        content: message,
      }).catch((err) => ({ error: String(err) })),
      ingestExchange({
        internal_user_id: session.internalUserId,
        persona_id: session.personaId,
        session_id: harnessSessionId,
        role: 'assistant',
        content: fullResponse,
      }).catch((err) => ({ error: String(err) })),
    ]);

    // 6. Record diagnostics
    const diag: TurnDiagnostics = {
      turnIndex: session.diagnostics.length,
      retrievedMemories: retrieval.memories,
      assembledPrompt: assembled,
      fullResponse,
      durationMs: Date.now() - startTime,
    };
    session.diagnostics.push(diag);

    sendEvent(res, 'done', {
      fullResponse,
      diagnostics: diag,
      ingestion: { user: userIngest, assistant: assistantIngest },
    });
  } catch (err) {
    sendEvent(res, 'error', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  res.end();
});

export default router;
