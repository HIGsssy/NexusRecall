export type IntentType = 'task' | 'conversational' | 'emotional';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface MemoryObject {
  id: string;
  memory_type: string;
  content: string;
  importance: number;
  confidence: string;
  volatility: string;
  score: number;
  created_at: string;
  last_accessed_at: string | null;
}

export interface TurnDiagnostics {
  turnIndex: number;
  retrievedMemories: MemoryObject[];
  assembledPrompt: ChatMessage[];
  fullResponse: string;
  durationMs: number;
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
