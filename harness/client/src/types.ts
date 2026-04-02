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
  retrievalDebug?: RetrievalDebugInfo;
  ingestionDebug?: IngestionDebugEvent[];
  memorySectionSentToLLM?: string;
}

export interface RetrievalDebugCandidate {
  id: string;
  memory_type: string;
  content_summary: string;
  status: string;
  graduation_status: string;
  inhibited: boolean;
  similarity: number;
  cooldown_until: string | null;
}

export interface RetrievalDroppedCandidate {
  id: string;
  memory_type: string;
  content_summary: string;
  reason: string;
}

export interface RetrievalScoredCandidate {
  id: string;
  memory_type: string;
  content_summary: string;
  similarity: number;
  recency: number;
  importance: number;
  strength: number;
  final_score: number;
}

export interface RetrievalDebugInfo {
  candidates_from_db: number;
  candidates: RetrievalDebugCandidate[];
  dropped: RetrievalDroppedCandidate[];
  scored: RetrievalScoredCandidate[];
  selected_ids: string[];
}

export interface IngestionDebugEvent {
  timestamp: string;
  userId: string;
  personaId: string;
  exchangeId: string;
  role: 'user' | 'assistant';
  contentSummary: string;
  classification: {
    memoryType: string | null;
    importance: number;
    confidence: string;
    volatility: string;
  };
  discarded: boolean;
  discardReason?: string;
  inserted?: {
    memoryId: string;
    memoryType: string;
    status: string;
  };
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
