import type { ChatMessage } from '../llm/types';
import type { IntentType, MemoryObject, RetrievalDebugInfo, IngestionDebugEvent } from '../nexus-types';

export interface TurnDiagnostics {
  turnIndex: number;
  retrievedMemories: MemoryObject[];
  assembledPrompt: ChatMessage[];
  fullResponse: string;
  durationMs: number;
  retrievalDebug?: RetrievalDebugInfo;
  ingestionDebug?: IngestionDebugEvent[];
  memorySectionSentToLLM?: string;
}

export interface SessionState {
  id: string;
  internalUserId: string;
  personaId: string;
  personaPrompt: string;
  intentType: IntentType;
  history: ChatMessage[];
  diagnostics: TurnDiagnostics[];
  createdAt: number;
}

const sessions = new Map<string, SessionState>();

export function createSession(init: {
  id: string;
  internalUserId: string;
  personaId: string;
  personaPrompt: string;
  intentType: IntentType;
}): SessionState {
  const session: SessionState = {
    ...init,
    history: [],
    diagnostics: [],
    createdAt: Date.now(),
  };
  sessions.set(init.id, session);
  return session;
}

export function getSession(id: string): SessionState | undefined {
  return sessions.get(id);
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}

export function listSessions(): SessionState[] {
  return Array.from(sessions.values());
}

export function updateSession(
  id: string,
  update: Partial<Pick<SessionState, 'personaPrompt' | 'intentType' | 'personaId'>>
): SessionState | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  Object.assign(session, update);
  return session;
}
