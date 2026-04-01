// ============================================================
// memory/service — Thin orchestrator for retrieval
// Nexus Recall Phase 1 — S02
// ============================================================

import { createHash } from 'crypto';
import { config } from '../../config';
import { getRetrievalCache, setRetrievalCache } from '../cache';
import { execute } from '../retrieval';
import type {
  RetrievalContext,
  RetrievalResult,
  RetrievalCacheKey,
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

export async function retrieveMemories(
  context: RetrievalContext
): Promise<RetrievalResult> {
  // Step 1: Validate input (basic shape only)
  if (!context.internal_user_id) {
    throw new Error('Missing required field: internal_user_id');
  }
  if (!context.persona_id) {
    throw new Error('Missing required field: persona_id');
  }
  if (!context.query_text) {
    throw new Error('Missing required field: query_text');
  }

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

  // Step 2: Check cache
  const cached = await getRetrievalCache(cacheKey);
  if (cached !== null) {
    return { ...cached, cache_hit: true };
  }

  // Step 3: Execute retrieval pipeline on miss
  const result = await execute(context);

  // Step 4: Write to cache
  const ttlSeconds = getRetrievalCacheTtl(intentType);
  await setRetrievalCache(cacheKey, result, ttlSeconds);

  // Step 5: Return result
  return result;
}
