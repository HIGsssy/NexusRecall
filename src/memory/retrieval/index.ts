// ============================================================
// memory/retrieval — Full retrieval pipeline (7 explicit stages)
// Nexus Recall Phase 1 — S02
// ============================================================

import { Pool } from 'pg';
import { config } from '../../config';
import { embed } from '../embedding';
import type {
  RetrievalContext,
  RetrievalResult,
  MemoryObject,
  MemoryType,
  ConfidenceLevel,
  VolatilityLevel,
  MemoryStatus,
  GraduationStatus,
  EmbeddingVector,
} from '../models';

// --- Database Pool ---

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolSize,
});

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
  access_count: number;
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

function vectorToSql(v: number[]): string {
  return `[${v.join(',')}]`;
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
    access_count: Number(raw['access_count']),
    created_at: toISOString(raw['created_at']),
    last_accessed_at: toISOStringOrNull(raw['last_accessed_at']),
  };
}

// ============================================================
// Pipeline Stages
// ============================================================

// --- Stage 1: Embed Query ---

async function stage1EmbedQuery(queryText: string): Promise<EmbeddingVector> {
  return embed(queryText);
}

// --- Stage 2: Database Query ---
// Uses pgvector <-> (L2 distance) operator for candidate retrieval.
// Cosine similarity is computed in application code for scoring/thresholds.

async function stage2DatabaseQuery(
  userId: string,
  personaId: string,
  queryEmbedding: EmbeddingVector
): Promise<CandidateRow[]> {
  const sql = `
    SELECT *
    FROM memories
    WHERE internal_user_id = $1
      AND persona_id = $2
      AND status = 'active'
    ORDER BY embedding <-> $3::vector
    LIMIT $4
  `;

  const result = await pool.query(sql, [
    userId,
    personaId,
    vectorToSql(queryEmbedding),
    config.retrievalTopN,
  ]);

  return result.rows.map((row: Record<string, unknown>) => transformRow(row));
}

// --- Stage 3: Filtering ---
// Hard filters applied sequentially per architecture §7 Stage 4.
// Each filter runs on the output of the previous. No reordering.
//
// Filter 1: Graduation gate — exclude graduation_status != 'confirmed'
// Filter 2: Inhibition gate — exclude inhibited = true
// Filter 3: Similarity threshold — per-type cosine similarity threshold
// Filter 4: Cooldown gate — exclude records with active cooldown
// Filter 5: Confidence gate — pass all (Phase 1)
// Filter 6: Intent alignment — exclude commitment type (Phase 1)

function stage3Filter(
  candidates: CandidateRow[],
  queryEmbedding: EmbeddingVector
): FilteredCandidate[] {
  // Filter 1: Graduation gate
  let filtered = candidates.filter(
    (c) => c.graduation_status === 'confirmed'
  );

  // Filter 2: Inhibition gate
  filtered = filtered.filter((c) => !c.inhibited);

  // Filter 3: Similarity threshold
  // Compute cosine similarity in application code, exclude below per-type threshold
  const withSimilarity: FilteredCandidate[] = filtered.map((row) => ({
    row,
    similarity: cosineSimilarity(queryEmbedding, parseVector(row.embedding)),
  }));

  let afterThreshold = withSimilarity.filter(
    (item) => item.similarity >= getSimilarityThreshold(item.row.memory_type)
  );

  // Filter 4: Cooldown gate
  const now = Date.now();
  afterThreshold = afterThreshold.filter((item) => {
    if (!item.row.cooldown_until) return true;
    return new Date(item.row.cooldown_until).getTime() <= now;
  });

  // Filter 5: Confidence gate — pass all records (Phase 1)
  const afterConfidence = afterThreshold;

  // Filter 6: Intent alignment — exclude commitment type (Phase 1)
  const afterAlignment = afterConfidence.filter(
    (item) => item.row.memory_type !== 'commitment'
  );

  return afterAlignment;
}

// --- Stage 4: Scoring ---
// Score = (Similarity × 0.6) + (Recency × 0.2) + (Importance × 0.1) + (Strength × 0.1)
// IntentAlignmentBias = 0.0 in Phase 1
// All inputs normalized to [0, 1] before weights are applied.

function stage4Score(candidates: FilteredCandidate[]): ScoredCandidate[] {
  const now = Date.now();

  return candidates.map(({ row, similarity }) => {
    // Similarity: cosine similarity, clamped to [0, 1]
    const normalizedSimilarity = Math.max(0, Math.min(1, similarity));

    // Recency: 1 / (1 + days_since_last_access)
    // Falls back to created_at if last_accessed_at is null
    const lastAccess = row.last_accessed_at
      ? new Date(row.last_accessed_at).getTime()
      : new Date(row.created_at).getTime();
    const daysSinceAccess = Math.max(
      0,
      (now - lastAccess) / (1000 * 60 * 60 * 24)
    );
    const recency = 1 / (1 + daysSinceAccess);

    // Importance: stored field, already in [0, 1] per DB constraint
    const importance = row.importance;

    // Strength: stored field, clamped to [0, 1]
    const strength = Math.max(0, Math.min(1, row.strength));

    // Composite score
    const score =
      normalizedSimilarity * 0.6 +
      recency * 0.2 +
      importance * 0.1 +
      strength * 0.1;

    return { row, similarity, score };
  });
}

// --- Stage 5: Sorting ---
// Sort by composite score descending.

function stage5Sort(candidates: ScoredCandidate[]): ScoredCandidate[] {
  return [...candidates].sort((a, b) => b.score - a.score);
}

// --- Stage 6: Type-Capped Selection ---
// Greedy selection by descending score within per-type caps.
// semantic: 2, episodic: 2, commitment: 1, self: 1
// Maximum output: 6 memory objects.

function stage6TypeCappedSelection(
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

// --- Stage 7: Mapping ---
// Map internal rows to public MemoryObject interface.
// No internal metadata (graduation_status, strength, cooldown_until, inhibited, lineage_parent_id) exposed.

function stage7Map(candidates: ScoredCandidate[]): MemoryObject[] {
  return candidates.map(({ row, score }) => ({
    id: row.id,
    memory_type: row.memory_type,
    content: row.content,
    importance: row.importance,
    confidence: row.confidence,
    volatility: row.volatility,
    score,
    created_at: row.created_at,
    last_accessed_at: row.last_accessed_at,
  }));
}

// ============================================================
// Main Pipeline Execution
// ============================================================

export async function execute(
  context: RetrievalContext
): Promise<RetrievalResult> {
  // Stage 1: Embed Query
  const queryEmbedding = await stage1EmbedQuery(context.query_text);

  // Stage 2: Database Query
  const candidates = await stage2DatabaseQuery(
    context.internal_user_id,
    context.persona_id,
    queryEmbedding
  );

  // Stage 3: Filtering
  const filtered = stage3Filter(candidates, queryEmbedding);

  // Stage 4: Scoring
  const scored = stage4Score(filtered);

  // Stage 5: Sorting
  const sorted = stage5Sort(scored);

  // Stage 6: Type-Capped Selection
  const selected = stage6TypeCappedSelection(sorted);

  // Stage 7: Mapping
  const memories = stage7Map(selected);

  return {
    memories,
    retrieved_at: new Date().toISOString(),
    cache_hit: false,
  };
}
