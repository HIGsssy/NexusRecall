// Harness-local types mirroring Nexus Recall API response shapes.
// These are NOT imported from src/ — they match the JSON contract only.

export type IntentType = 'task' | 'conversational' | 'emotional';

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

export interface RetrievalResult {
  memories: MemoryObject[];
  retrieved_at: string;
  cache_hit: boolean;
}

export interface RetrievalRequest {
  internal_user_id: string;
  persona_id: string;
  query_text: string;
  intent_type?: IntentType;
}

export interface StoreMemoryResult {
  exchange_id: string;
  queued: boolean;
}

export interface IngestRequest {
  internal_user_id: string;
  persona_id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: Record<string, unknown>;
}

export class NexusClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly stage: string
  ) {
    super(message);
    this.name = 'NexusClientError';
  }
}
