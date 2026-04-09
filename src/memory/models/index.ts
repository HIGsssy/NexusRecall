// ============================================================
// memory/models — All shared types, enums, and interfaces
// Nexus Recall Phase 1 — S01 Foundation
// ============================================================

// --- Enums / Union Types ---

export type MemoryType = 'semantic' | 'episodic' | 'self' | 'commitment';

export type MemoryStatus = 'active' | 'superseded' | 'corrected';

export type GraduationStatus = 'observation' | 'candidate' | 'confirmed';

export type ConfidenceLevel = 'explicit' | 'inferred';

export type VolatilityLevel = 'factual' | 'subjective';

export type IntentType = 'task' | 'conversational' | 'emotional';

export type IngestionJobType =
  | 'classify-turn'
  | 'embed-and-promote'
  | 'prune-scope'
  | 'summarize-session'
  | 'bookkeeping';

// --- Embedding Vector ---

export type EmbeddingVector = number[];

// --- Full DB Record Shapes ---

export interface Memory {
  id: string;
  internal_user_id: string;
  persona_id: string;
  memory_type: MemoryType;
  content: string;
  embedding: EmbeddingVector;
  importance: number;
  confidence: ConfidenceLevel;
  volatility: VolatilityLevel;
  status: MemoryStatus;
  graduation_status: GraduationStatus;
  strength: number;
  cooldown_until: string | null;
  inhibited: boolean;
  lineage_parent_id: string | null;
  access_count: number;
  created_at: string;
  last_accessed_at: string | null;
  last_reinforced_at: string | null;
}

export interface Exchange {
  id: string;
  internal_user_id: string;
  persona_id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// --- Working Memory Subset ---

export interface ExchangeTurn {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// --- Service Input/Output Types ---

export interface StoreMemoryInput {
  internal_user_id: string;
  persona_id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: Record<string, unknown>;
}

export interface StoreMemoryResult {
  exchange_id: string;
  queued: boolean;
}

export interface RetrievalContext {
  internal_user_id: string;
  persona_id: string;
  query_text: string;
  intent_type?: IntentType;
  session_id?: string;
  debug?: boolean;
}

export interface RetrievalResult {
  memories: MemoryObject[];
  retrieved_at: string;
  cache_hit: boolean;
  debugInfo?: RetrievalDebugInfo;
}

// --- Debug Types ---

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
  classificationReason?: string;
  nearMiss?: { nearMatch: string; pattern: string; failedCondition: string };
  overrideApplied?: boolean;
  overrideReason?: string;
  overrideSimilarity?: number;
  inserted?: {
    memoryId: string;
    memoryType: string;
    status: string;
  };
}

export interface MemoryObject {
  id: string;
  memory_type: MemoryType;
  content: string;
  importance: number;
  confidence: ConfidenceLevel;
  volatility: VolatilityLevel;
  score: number;
  created_at: string;
  last_accessed_at: string | null;
}

export interface UpdateMemoryInput {
  memory_id: string;
  internal_user_id: string;
  persona_id: string;
  feedback?: 'positive' | 'negative';
  inhibit?: boolean;
}

export interface UpdateMemoryResult {
  memory_id: string;
  updated: boolean;
}

export interface PruneScope {
  internal_user_id: string;
  persona_id: string;
}

export interface IngestionInput {
  internal_user_id: string;
  persona_id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: Record<string, unknown>;
}

export interface IngestionAck {
  exchange_id: string;
  queued: boolean;
}

export interface RetrievalCacheKey {
  userId: string;
  personaId: string;
  embeddingHash: string;
  intentType: IntentType;
}
