// ============================================================
// memory/cache — Redis retrieval cache (basic get/set)
// Nexus Recall Phase 1 — S02
// ============================================================

import { createHash } from 'crypto';
import Redis from 'ioredis';
import { config } from '../../config';
import type { RetrievalResult, RetrievalCacheKey } from '../models';

// --- Redis Client ---

const redis = new Redis(config.redisUrl);

// --- Key Construction ---
// Key pattern: rcache:{sha256(userId + personaId + embeddingHash + intentType)}

function buildCacheKey(key: RetrievalCacheKey): string {
  const raw = key.userId + key.personaId + key.embeddingHash + key.intentType;
  const hash = createHash('sha256').update(raw).digest('hex');
  return `rcache:${hash}`;
}

// --- Public Interface ---

export async function getRetrievalCache(
  key: RetrievalCacheKey
): Promise<RetrievalResult | null> {
  const cacheKey = buildCacheKey(key);
  const cached = await redis.get(cacheKey);
  if (cached === null) {
    return null;
  }
  return JSON.parse(cached) as RetrievalResult;
}

export async function setRetrievalCache(
  key: RetrievalCacheKey,
  result: RetrievalResult,
  ttlSeconds: number
): Promise<void> {
  const cacheKey = buildCacheKey(key);
  await redis.setex(cacheKey, ttlSeconds, JSON.stringify(result));
}
