// ============================================================
// memory/service — Public interface (orchestration only)
// Nexus Recall Phase 1 — S03
// ============================================================

import { createHash } from 'crypto';
import { config } from '../../config';
import {
  getRetrievalCache,
  setRetrievalCache,
  invalidateRetrievalCache,
  deleteUserRedisState,
} from '../cache';
import { execute } from '../retrieval';
import {
  ingest,
  enqueueBookkeeping,
  enqueuePrune,
  enqueueSummarize,
} from '../ingestion';
import {
  updateMemoryByScope,
  deleteAllUserDataFromDb,
} from '../../db/queries/memories';
import type {
  StoreMemoryInput,
  StoreMemoryResult,
  RetrievalContext,
  RetrievalResult,
  RetrievalCacheKey,
  UpdateMemoryInput,
  UpdateMemoryResult,
  PruneScope,
  IntentType,
} from '../models';

// --- Helpers ---

function getRetrievalCacheTtl(intentType: IntentType): number {
  switch (intentType) {
    case 'task':
      return config.retrievalCacheTtlTask;
    case 'conversational':
      return config.retrievalCacheTtlConv;
    case 'emotional':
      return config.retrievalCacheTtlEmotional;
  }
}

// --- Public Interface ---

export async function storeMemory(
  input: StoreMemoryInput
): Promise<StoreMemoryResult> {
  if (!input.internal_user_id)
    throw new Error('Missing required field: internal_user_id');
  if (!input.persona_id)
    throw new Error('Missing required field: persona_id');
  if (!input.session_id)
    throw new Error('Missing required field: session_id');
  if (!input.role) throw new Error('Missing required field: role');
  if (!input.content) throw new Error('Missing required field: content');

  const ack = await ingest({
    internal_user_id: input.internal_user_id,
    persona_id: input.persona_id,
    session_id: input.session_id,
    role: input.role,
    content: input.content,
    metadata: input.metadata,
  });

  return {
    exchange_id: ack.exchange_id,
    queued: ack.queued,
  };
}

export async function retrieveMemories(
  context: RetrievalContext
): Promise<RetrievalResult> {
  if (!context.internal_user_id)
    throw new Error('Missing required field: internal_user_id');
  if (!context.persona_id)
    throw new Error('Missing required field: persona_id');
  if (!context.query_text)
    throw new Error('Missing required field: query_text');

  const intentType: IntentType = context.intent_type ?? 'conversational';
  const queryHash = createHash('sha256')
    .update(context.query_text)
    .digest('hex');

  const cacheKey: RetrievalCacheKey = {
    userId: context.internal_user_id,
    personaId: context.persona_id,
    embeddingHash: queryHash,
    intentType,
  };

  // Stage 1: Cache check
  const cached = await getRetrievalCache(cacheKey);
  if (cached !== null) {
    return { ...cached, cache_hit: true };
  }

  // Delegate to retrieval pipeline
  const result = await execute(context);

  // Post-selection bookkeeping (non-blocking)
  if (result.memories.length > 0) {
    enqueueBookkeeping(
      result.memories.map((m) => m.id),
      context.internal_user_id,
      context.persona_id
    ).catch(() => {
      // Non-blocking: silently ignore enqueue failures for bookkeeping
    });
  }

  // Cache write
  const ttlSeconds = getRetrievalCacheTtl(intentType);
  await setRetrievalCache(cacheKey, result, ttlSeconds);

  return result;
}

export async function updateMemory(
  input: UpdateMemoryInput
): Promise<UpdateMemoryResult> {
  if (!input.memory_id)
    throw new Error('Missing required field: memory_id');
  if (!input.internal_user_id)
    throw new Error('Missing required field: internal_user_id');
  if (!input.persona_id)
    throw new Error('Missing required field: persona_id');

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

export async function pruneMemory(scope: PruneScope): Promise<void> {
  if (!scope.internal_user_id)
    throw new Error('Missing required field: internal_user_id');
  if (!scope.persona_id)
    throw new Error('Missing required field: persona_id');

  await enqueuePrune(scope);
}

export async function deleteUserMemory(userId: string): Promise<void> {
  if (!userId) throw new Error('Missing required field: userId');

  const { personaIds, memoryIds } = await deleteAllUserDataFromDb(userId);
  await deleteUserRedisState(userId, personaIds, memoryIds);
}

export async function summarizeSession(sessionId: string): Promise<void> {
  if (!sessionId) throw new Error('Missing required field: sessionId');

  await enqueueSummarize(sessionId);
}
