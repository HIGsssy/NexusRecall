// ============================================================
// memory/ingestion — Ingest exchanges, enqueue async work
// Nexus Recall Phase 1 — S03
// ============================================================

import type { Job } from 'bullmq';
import { config } from '../../config';
import { ingestionQueue } from '../../queue/client';
import { insertExchange, getExchangeById } from '../../db/queries/exchanges';
import {
  insertConfirmedSemanticMemory,
  updateBookkeeping,
  updateMemoryByScope,
  deleteAllUserDataFromDb,
} from '../../db/queries/memories';
import { invalidateRetrievalCache, setCooldown, deleteUserRedisState } from '../cache';
import { embed } from '../embedding';
import type {
  IngestionInput,
  IngestionAck,
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
}

interface BookkeepingData {
  memoryIds: string[];
  userId: string;
  personaId: string;
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

  // Rule-based classification: non-empty assistant turns are promotable
  if (exchange.role === 'assistant' && exchange.content.trim().length > 0) {
    await ingestionQueue.add('embed-and-promote', {
      exchangeId: exchange.id,
      userId: data.userId,
      personaId: data.personaId,
      content: exchange.content,
    } satisfies EmbedAndPromoteData);
  }
}

async function handleEmbedAndPromote(data: EmbedAndPromoteData): Promise<void> {
  const embedding = await embed(data.content);

  await insertConfirmedSemanticMemory(
    data.userId,
    data.personaId,
    data.content,
    embedding,
    0.5,
    'inferred',
    'subjective'
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
