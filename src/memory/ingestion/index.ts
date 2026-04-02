// ============================================================
// memory/ingestion — Ingest exchanges, enqueue async work
// Nexus Recall Phase 1 — S03
// ============================================================

import type { Job } from 'bullmq';
import { config } from '../../config';
import { ingestionQueue } from '../../queue/client';
import { insertExchange, getExchangeById } from '../../db/queries/exchanges';
import {
  insertConfirmedMemory,
  updateBookkeeping,
  updateMemoryByScope,
  deleteAllUserDataFromDb,
  findContradictionCandidates,
  markSuperseded,
} from '../../db/queries/memories';
import { invalidateRetrievalCache, setCooldown, deleteUserRedisState } from '../cache';
import { embed } from '../embedding';
import type {
  IngestionInput,
  IngestionAck,
  MemoryType,
  ConfidenceLevel,
  VolatilityLevel,
  PruneScope,
  UpdateMemoryInput,
  UpdateMemoryResult,
} from '../models';

// --- Job Data Shapes ---

interface ClassifyTurnData {
  exchangeId: string;
  userId: string;
  personaId: string;
}

interface EmbedAndPromoteData {
  exchangeId: string;
  userId: string;
  personaId: string;
  content: string;
  memoryType: MemoryType;
  importance: number;
  confidence: ConfidenceLevel;
  volatility: VolatilityLevel;
}

interface BookkeepingData {
  memoryIds: string[];
  userId: string;
  personaId: string;
}

// --- Classification ---

interface ClassificationResult {
  memoryType: MemoryType | null;
  importance: number;
  confidence: ConfidenceLevel;
  volatility: VolatilityLevel;
}

const SELF_REFERENTIAL_PATTERNS: readonly string[] = [
  'i am a ', 'i am an ', 'i\'m a ', 'i\'m an ',
  'i am designed', 'i am built', 'i am programmed', 'i am configured',
  'i\'m designed', 'i\'m built', 'i\'m programmed', 'i\'m configured',
  'i was designed', 'i was created', 'i was built', 'i was programmed',
  'i have been designed', 'i have been programmed', 'i have been built',
  'i prefer ', 'i can ', 'i cannot ', 'i can\'t ',
  'my purpose', 'my role is', 'my goal is', 'my function is',
  'as an ai', 'as a language model', 'as an assistant',
];

const GREETING_PATTERNS: readonly string[] = [
  'hello', 'hi', 'hey', 'good morning', 'good afternoon',
  'good evening', 'goodnight', 'good night', 'greetings',
];

const META_CONVERSATIONAL_PATTERNS: readonly string[] = [
  'ok', 'okay', 'sure', 'thanks', 'thank you', 'you\'re welcome',
  'no problem', 'got it', 'understood', 'i see', 'alright',
  'sounds good', 'noted', 'absolutely', 'of course', 'certainly',
];

const HEDGING_PATTERNS: readonly string[] = [
  'i think', 'i believe', 'probably', 'maybe', 'might',
  'could be', 'in my opinion', 'seems', 'perhaps', 'likely',
  'i feel', 'i guess', 'it seems', 'it appears', 'not sure',
  'i suppose',
];

const INSTRUCTIONAL_PATTERNS: readonly string[] = [
  'you should', 'you need to', 'you can', 'you must', 'make sure',
  'here\'s how', 'here is how', 'follow these', 'try to',
  'remember to', 'be sure to', 'don\'t forget', 'important to',
];

function isSelfReferential(contentLower: string): boolean {
  return SELF_REFERENTIAL_PATTERNS.some(p => contentLower.includes(p));
}

function isQuestion(content: string): boolean {
  return content.trimEnd().endsWith('?');
}

function isShortGreeting(contentLower: string): boolean {
  const wordCount = contentLower.split(/\s+/).length;
  if (wordCount > 5) return false;
  return GREETING_PATTERNS.some(p => contentLower.includes(p));
}

function isMetaConversational(contentLower: string): boolean {
  const wordCount = contentLower.split(/\s+/).length;
  if (wordCount > 8) return false;
  return META_CONVERSATIONAL_PATTERNS.some(p => contentLower.includes(p));
}

function containsHedging(contentLower: string): boolean {
  return HEDGING_PATTERNS.some(p => contentLower.includes(p));
}

function appearsInstructional(contentLower: string): boolean {
  return INSTRUCTIONAL_PATTERNS.some(p => contentLower.includes(p));
}

function classify(role: 'user' | 'assistant', content: string): ClassificationResult {
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();

  if (role === 'assistant') {
    if (trimmed.length < config.classifierMinSemanticLength) {
      return { memoryType: null, importance: 0, confidence: 'inferred', volatility: 'subjective' };
    }

    if (isSelfReferential(lower)) {
      return { memoryType: 'self', importance: 0.6, confidence: 'inferred', volatility: 'subjective' };
    }

    if (isQuestion(trimmed) || isShortGreeting(lower) || isMetaConversational(lower)) {
      return { memoryType: null, importance: 0, confidence: 'inferred', volatility: 'subjective' };
    }

    const volatility: VolatilityLevel = containsHedging(lower) ? 'subjective' : 'factual';
    const importance = appearsInstructional(lower) ? 0.7 : 0.5;

    return { memoryType: 'semantic', importance, confidence: 'inferred', volatility };
  }

  if (role === 'user') {
    if (trimmed.length < config.classifierMinEpisodicLength) {
      return { memoryType: null, importance: 0, confidence: 'inferred', volatility: 'subjective' };
    }

    if (isQuestion(trimmed)) {
      return { memoryType: null, importance: 0, confidence: 'inferred', volatility: 'subjective' };
    }

    return { memoryType: 'episodic', importance: 0.4, confidence: 'inferred', volatility: 'subjective' };
  }

  return { memoryType: null, importance: 0, confidence: 'inferred', volatility: 'subjective' };
}

// --- Contradiction Helper ---

const CONTRADICTION_ELIGIBLE_TYPES = new Set<MemoryType>(['semantic', 'self']);

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

// --- Public Interface ---

export async function ingest(input: IngestionInput): Promise<IngestionAck> {
  if (!input.internal_user_id) throw new Error('Missing required field: internal_user_id');
  if (!input.persona_id) throw new Error('Missing required field: persona_id');
  if (!input.session_id) throw new Error('Missing required field: session_id');
  if (!input.role) throw new Error('Missing required field: role');
  if (!input.content) throw new Error('Missing required field: content');

  const exchange = await insertExchange(
    input.internal_user_id,
    input.persona_id,
    input.session_id,
    input.role,
    input.content,
    input.metadata
  );

  let queued = false;
  try {
    await ingestionQueue.add('classify-turn', {
      exchangeId: exchange.id,
      userId: input.internal_user_id,
      personaId: input.persona_id,
    } satisfies ClassifyTurnData);
    queued = true;
  } catch {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'enqueue_failed',
        jobType: 'classify-turn',
        exchangeId: exchange.id,
        timestamp: new Date().toISOString(),
      })
    );
  }

  return {
    exchange_id: exchange.id,
    queued,
  };
}

export async function processJob(job: Job): Promise<void> {
  switch (job.name) {
    case 'classify-turn':
      await handleClassifyTurn(job.data as ClassifyTurnData);
      break;
    case 'embed-and-promote':
      await handleEmbedAndPromote(job.data as EmbedAndPromoteData);
      break;
    case 'bookkeeping':
      await handleBookkeeping(job.data as BookkeepingData);
      break;
    case 'prune-scope':
      console.log(
        JSON.stringify({
          jobType: 'prune-scope',
          status: 'stub',
          scope: job.data,
        })
      );
      break;
    case 'summarize-session':
      console.log(
        JSON.stringify({
          jobType: 'summarize-session',
          status: 'stub',
          sessionId: (job.data as { sessionId: string }).sessionId,
        })
      );
      break;
    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
}

// --- Enqueue Helpers ---

export async function enqueueBookkeeping(
  memoryIds: string[],
  userId: string,
  personaId: string
): Promise<void> {
  await ingestionQueue.add('bookkeeping', {
    memoryIds,
    userId,
    personaId,
  } satisfies BookkeepingData);
}

export async function enqueuePrune(scope: PruneScope): Promise<void> {
  await ingestionQueue.add('prune-scope', {
    internal_user_id: scope.internal_user_id,
    persona_id: scope.persona_id,
  });
}

export async function enqueueSummarize(sessionId: string): Promise<void> {
  await ingestionQueue.add('summarize-session', {
    sessionId,
  });
}

// --- Job Handlers ---

async function handleClassifyTurn(data: ClassifyTurnData): Promise<void> {
  const exchange = await getExchangeById(data.exchangeId);
  if (!exchange) {
    throw new Error(`Exchange not found: ${data.exchangeId}`);
  }

  const result = classify(exchange.role, exchange.content);

  if (result.memoryType === null) {
    return;
  }

  await ingestionQueue.add('embed-and-promote', {
    exchangeId: exchange.id,
    userId: data.userId,
    personaId: data.personaId,
    content: exchange.content,
    memoryType: result.memoryType,
    importance: result.importance,
    confidence: result.confidence,
    volatility: result.volatility,
  } satisfies EmbedAndPromoteData);
}

async function handleEmbedAndPromote(data: EmbedAndPromoteData): Promise<void> {
  const embedding = await embed(data.content);

  let lineageParentId: string | null = null;

  // Contradiction check: only for semantic and self types
  if (CONTRADICTION_ELIGIBLE_TYPES.has(data.memoryType)) {
    const candidates = await findContradictionCandidates(
      data.userId,
      data.personaId,
      data.memoryType as 'semantic' | 'self'
    );

    let bestId: string | null = null;
    let bestSimilarity = -1;

    for (const candidate of candidates) {
      const candidateEmbedding = parseVector(candidate.embedding);
      const similarity = cosineSimilarity(embedding, candidateEmbedding);
      if (similarity > config.contradictionSimilarityThreshold && similarity > bestSimilarity) {
        bestId = candidate.id;
        bestSimilarity = similarity;
      }
    }

    if (bestId !== null) {
      await markSuperseded(bestId, data.userId, data.personaId);
      lineageParentId = bestId;
    }
  }

  await insertConfirmedMemory(
    data.userId,
    data.personaId,
    data.memoryType,
    data.content,
    embedding,
    data.importance,
    data.confidence,
    data.volatility,
    lineageParentId
  );

  await invalidateRetrievalCache(data.userId, data.personaId);
}

async function handleBookkeeping(data: BookkeepingData): Promise<void> {
  const cooldownMs = config.cooldownDurationSeconds * 1000;
  const cooldownUntil = new Date(Date.now() + cooldownMs);

  for (const memoryId of data.memoryIds) {
    await updateBookkeeping(memoryId, cooldownUntil);
    await setCooldown(memoryId, cooldownMs);
  }

  await invalidateRetrievalCache(data.userId, data.personaId);
}

// --- Service Delegation Functions ---

export async function performUpdate(
  input: UpdateMemoryInput
): Promise<UpdateMemoryResult> {
  const updated = await updateMemoryByScope(
    input.memory_id,
    input.internal_user_id,
    input.persona_id,
    input.feedback,
    input.inhibit
  );

  if (updated) {
    await invalidateRetrievalCache(input.internal_user_id, input.persona_id);
  }

  return { memory_id: input.memory_id, updated };
}

export async function performDeleteUserData(userId: string): Promise<void> {
  const { personaIds, memoryIds } = await deleteAllUserDataFromDb(userId);
  await deleteUserRedisState(userId, personaIds, memoryIds);
}
