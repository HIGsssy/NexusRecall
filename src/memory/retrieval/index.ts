// ============================================================
// memory/retrieval — Full 8-stage retrieval pipeline
// Nexus Recall Phase 1 — S03
// ============================================================

import { createHash } from 'crypto';
import { config } from '../../config';
import { embed } from '../embedding';
import { fetchCandidates } from '../../db/queries/memories';
import {
  getRetrievalCache,
  setRetrievalCache,
  isOnCooldown,
} from '../cache';
import { enqueueBookkeeping } from '../ingestion';
import type {
  RetrievalContext,
  RetrievalResult,
  RetrievalCacheKey,
  MemoryObject,
  MemoryType,
  ConfidenceLevel,
  VolatilityLevel,
  MemoryStatus,
  GraduationStatus,
  EmbeddingVector,
  IntentType,
} from '../models';

// --- Internal Types ---

interface CandidateRow {
  id: string;
  memory_type: MemoryType;
  content: string;
  embedding: string;
  importance: number;
  confidence: ConfidenceLevel;
  volatility: VolatilityLevel;
  status: MemoryStatus;
  graduation_status: GraduationStatus;
  strength: number;
  cooldown_until: string | null;
  inhibited: boolean;
  created_at: string;
  last_accessed_at: string | null;
}

interface FilteredCandidate {
  row: CandidateRow;
  similarity: number;
}

interface ScoredCandidate {
  row: CandidateRow;
  similarity: number;
  score: number;
}

// --- Helper Functions ---

function toISOStringOrNull(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function toISOString(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function parseVector(vectorStr: string): number[] {
  return vectorStr
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map(Number);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
}

function getSimilarityThreshold(memoryType: MemoryType): number {
  switch (memoryType) {
    case 'semantic':
      return config.similarityThresholdSemantic;
    case 'episodic':
      return config.similarityThresholdEpisodic;
    case 'self':
      return config.similarityThresholdSelf;
    case 'commitment':
      return config.similarityThresholdCommitment;
  }
}

function transformRow(raw: Record<string, unknown>): CandidateRow {
  return {
    id: raw['id'] as string,
    memory_type: raw['memory_type'] as MemoryType,
    content: raw['content'] as string,
    embedding: raw['embedding'] as string,
    importance: Number(raw['importance']),
    confidence: raw['confidence'] as ConfidenceLevel,
    volatility: raw['volatility'] as VolatilityLevel,
    status: raw['status'] as MemoryStatus,
    graduation_status: raw['graduation_status'] as GraduationStatus,
    strength: Number(raw['strength']),
    cooldown_until: toISOStringOrNull(raw['cooldown_until']),
    inhibited: Boolean(raw['inhibited']),
    created_at: toISOString(raw['created_at']),
    last_accessed_at: toISOStringOrNull(raw['last_accessed_at']),
  };
}

function logStage(stage: string, elapsedMs: number): void {
  console.log(
    JSON.stringify({
      pipeline: 'retrieval',
      stage,
      elapsed_ms: elapsedMs,
      timestamp: new Date().toISOString(),
    })
  );
}

function getRetrievalCacheTtlMs(intentType: IntentType): number {
  switch (intentType) {
    case 'task':
      return config.retrievalCacheTtlTask * 1000;
    case 'conversational':
      return config.retrievalCacheTtlConv * 1000;
    case 'emotional':
      return config.retrievalCacheTtlEmotional * 1000;
  }
}

// ============================================================
// Pipeline Stage Implementations
// ============================================================

// --- Stage 4: Hard Filtering ---
// Applied sequentially per architecture §7 Stage 4.
// Filter 1: Graduation gate — exclude graduation_status != 'confirmed'
// Filter 2: Inhibition gate — exclude inhibited = true
// Filter 3: Similarity threshold — per-type cosine similarity threshold
// Filter 4: Cooldown gate — Redis-first, DB fallback
// Filter 5: Confidence gate — pass all (Phase 1)
// Filter 6: Intent alignment — exclude commitment type (Phase 1)

async function hardFilter(
  candidates: CandidateRow[],
  queryEmbedding: EmbeddingVector
): Promise<FilteredCandidate[]> {
  // Filter 1: Graduation gate + status check
  let filtered = candidates.filter(
    (c) => c.graduation_status === 'confirmed' && c.status === 'active'
  );

  // Filter 2: Inhibition gate
  filtered = filtered.filter((c) => !c.inhibited);

  // Filter 3: Similarity threshold
  const withSimilarity: FilteredCandidate[] = filtered.map((row) => ({
    row,
    similarity: cosineSimilarity(queryEmbedding, parseVector(row.embedding)),
  }));

  const afterThreshold = withSimilarity.filter(
    (item) => item.similarity >= getSimilarityThreshold(item.row.memory_type)
  );

  // Filter 4: Cooldown gate (Redis-first, DB fallback)
  const now = Date.now();
  const afterCooldown: FilteredCandidate[] = [];
  for (const item of afterThreshold) {
    const redisOnCooldown = await isOnCooldown(item.row.id);
    if (redisOnCooldown) continue;
    if (item.row.cooldown_until && new Date(item.row.cooldown_until).getTime() > now) continue;
    afterCooldown.push(item);
  }

  // Filter 5: Confidence gate — pass all records (Phase 1)
  const afterConfidence = afterCooldown;

  // Filter 6: Intent alignment — exclude commitment type (Phase 1)
  const afterAlignment = afterConfidence.filter(
    (item) => item.row.memory_type !== 'commitment'
  );

  return afterAlignment;
}

// --- Stage 5: Scoring ---
// Score = (Similarity × 0.6) + (Recency × 0.2) + (Importance × 0.1) + (Strength × 0.1)
// IntentAlignmentBias = 0.0 in Phase 1
// All inputs normalized to [0, 1] before weights are applied.

function score(candidates: FilteredCandidate[]): ScoredCandidate[] {
  const now = Date.now();

  return candidates.map(({ row, similarity }) => {
    const normalizedSimilarity = Math.max(0, Math.min(1, similarity));

    const lastAccess = row.last_accessed_at
      ? new Date(row.last_accessed_at).getTime()
      : new Date(row.created_at).getTime();
    const daysSinceAccess = Math.max(
      0,
      (now - lastAccess) / (1000 * 60 * 60 * 24)
    );
    const recency = 1 / (1 + daysSinceAccess);

    const importance = row.importance;
    const strength = Math.max(0, Math.min(1, row.strength));

    const compositeScore =
      normalizedSimilarity * 0.6 +
      recency * 0.2 +
      importance * 0.1 +
      strength * 0.1;

    return { row, similarity, score: compositeScore };
  });
}

// --- Stage 6: Type-Capped Selection ---
// semantic: 2, episodic: 2, commitment: 1, self: 1
// Maximum output: 6 memory objects.

function typeCappedSelection(
  candidates: ScoredCandidate[]
): ScoredCandidate[] {
  const caps: Record<MemoryType, number> = {
    semantic: 2,
    episodic: 2,
    commitment: 1,
    self: 1,
  };

  const counts: Record<MemoryType, number> = {
    semantic: 0,
    episodic: 0,
    commitment: 0,
    self: 0,
  };

  const selected: ScoredCandidate[] = [];

  for (const candidate of candidates) {
    const type = candidate.row.memory_type;
    if (counts[type] < caps[type]) {
      selected.push(candidate);
      counts[type]++;
    }
  }

  return selected;
}

// --- Mapping ---
// Map internal rows to public MemoryObject interface.

function mapToMemoryObjects(candidates: ScoredCandidate[]): MemoryObject[] {
  return candidates.map(({ row, score: s }) => ({
    id: row.id,
    memory_type: row.memory_type,
    content: row.content,
    importance: row.importance,
    confidence: row.confidence,
    volatility: row.volatility,
    score: s,
    created_at: row.created_at,
    last_accessed_at: row.last_accessed_at,
  }));
}

// ============================================================
// Main Pipeline Execution — All 8 Stages
// ============================================================

export async function execute(
  context: RetrievalContext
): Promise<RetrievalResult> {
  const intentType: IntentType = context.intent_type ?? 'conversational';

  // Stage 1: Cache Check
  let start = Date.now();
  const queryHash = createHash('sha256')
    .update(context.query_text)
    .digest('hex');
  const cacheKey: RetrievalCacheKey = {
    userId: context.internal_user_id,
    personaId: context.persona_id,
    embeddingHash: queryHash,
    intentType,
  };
  const cached = await getRetrievalCache(cacheKey);
  logStage('stage_1_cache_check', Date.now() - start);
  if (cached !== null) {
    return { ...cached, cache_hit: true };
  }

  // Stage 2: Embed Query
  start = Date.now();
  const queryEmbedding = await embed(context.query_text);
  logStage('stage_2_embed_query', Date.now() - start);

  // Stage 3: Candidate Retrieval
  start = Date.now();
  const rawRows = await fetchCandidates(
    context.internal_user_id,
    context.persona_id,
    queryEmbedding,
    config.retrievalTopN
  );
  const candidates = rawRows.map(transformRow);
  logStage('stage_3_candidate_retrieval', Date.now() - start);

  // Stage 4: Hard Filtering
  start = Date.now();
  const filtered = await hardFilter(candidates, queryEmbedding);
  logStage('stage_4_hard_filter', Date.now() - start);

  // Stage 5: Scoring
  start = Date.now();
  const scored = score(filtered);
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  logStage('stage_5_scoring', Date.now() - start);

  // Stage 6: Type-Capped Selection
  start = Date.now();
  const selected = typeCappedSelection(sorted);
  const memories = mapToMemoryObjects(selected);
  logStage('stage_6_type_capped_selection', Date.now() - start);

  const result: RetrievalResult = {
    memories,
    retrieved_at: new Date().toISOString(),
    cache_hit: false,
  };

  // Stage 7: Post-Selection Bookkeeping (non-blocking)
  start = Date.now();
  if (memories.length > 0) {
    enqueueBookkeeping(
      memories.map((m) => m.id),
      context.internal_user_id,
      context.persona_id
    ).catch(() => {
      // Non-blocking: silently ignore enqueue failures for bookkeeping
    });
  }
  logStage('stage_7_bookkeeping_enqueue', Date.now() - start);

  // Stage 8: Cache Write + Return
  start = Date.now();
  const ttlMs = getRetrievalCacheTtlMs(intentType);
  await setRetrievalCache(cacheKey, result, ttlMs);
  logStage('stage_8_cache_write', Date.now() - start);

  return result;
}
