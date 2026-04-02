import type { MemoryObject, TurnDiagnostics, SessionState, IntentType } from './types';

/* ── SSE chat stream ─────────────────────────────────────── */

export interface SSECallbacks {
  onRetrieval: (data: { memories: MemoryObject[]; cache_hit: boolean }) => void;
  onDelta: (data: { content: string }) => void;
  onDone: (data: {
    fullResponse: string;
    diagnostics: TurnDiagnostics;
    ingestion: unknown;
  }) => void;
  onError: (data: { message: string }) => void;
}

export async function sendChat(
  sessionId: string,
  message: string,
  callbacks: SSECallbacks
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    callbacks.onError({ message: err.error || `HTTP ${res.status}` });
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop()!;

    for (const part of parts) {
      if (!part.trim()) continue;
      const lines = part.split('\n');
      let eventType = 'message';
      let data = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7);
        if (line.startsWith('data: ')) data = line.slice(6);
      }
      if (!data) continue;

      try {
        const parsed = JSON.parse(data);
        switch (eventType) {
          case 'retrieval':
            callbacks.onRetrieval(parsed);
            break;
          case 'delta':
            callbacks.onDelta(parsed);
            break;
          case 'done':
            callbacks.onDone(parsed);
            break;
          case 'error':
            callbacks.onError(parsed);
            break;
        }
      } catch {
        // skip malformed events
      }
    }
  }
}

/* ── REST helpers ────────────────────────────────────────── */

export async function createSession(init: {
  internalUserId: string;
  personaId: string;
  personaPrompt: string;
  intentType: IntentType;
}): Promise<SessionState> {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(init),
  });
  if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
  return res.json();
}

export async function patchSession(
  id: string,
  update: Partial<Pick<SessionState, 'personaPrompt' | 'intentType' | 'personaId'>>
): Promise<SessionState> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error(`Failed to update session: ${res.status}`);
  return res.json();
}

export async function deleteSession(id: string): Promise<void> {
  await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
