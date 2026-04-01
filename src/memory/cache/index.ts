// ============================================================
// memory/cache — Redis retrieval cache (basic get/set)
// Nexus Recall Phase 1 — S02
// ============================================================

import { createHash } from 'crypto';
import Redis from 'ioredis';
import { config } from '../../config';
import type {
  RetrievalResult,
  RetrievalCacheKey,
  ExchangeTurn,
  EmbeddingVector,
} from '../models';

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

// --- Retrieval Cache Invalidation ---

export async function invalidateRetrievalCache(
  userId: string,
  personaId: string
): Promise<void> {
  void userId;
  void personaId;
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      'rcache:*',
      'COUNT',
      100
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== '0');
}

// --- Cooldown ---

export async function setCooldown(
  memoryId: string,
  durationMs: number
): Promise<void> {
  const ttlSeconds = Math.ceil(durationMs / 1000);
  await redis.setex(`cooldown:${memoryId}`, ttlSeconds, '1');
}

export async function isOnCooldown(memoryId: string): Promise<boolean> {
  const result = await redis.exists(`cooldown:${memoryId}`);
  return result === 1;
}

// --- Working Memory ---

export async function pushWorkingMemoryTurn(
  userId: string,
  personaId: string,
  turn: ExchangeTurn
): Promise<void> {
  const key = `working:${userId}:${personaId}`;
  await redis.rpush(key, JSON.stringify(turn));
  await redis.ltrim(key, -config.workingMemoryMaxTurns, -1);
  await redis.expire(key, config.workingMemoryTtlSeconds);
}

export async function getWorkingMemory(
  userId: string,
  personaId: string
): Promise<ExchangeTurn[]> {
  const key = `working:${userId}:${personaId}`;
  const raw = await redis.lrange(key, 0, -1);
  return raw.map((s) => JSON.parse(s) as ExchangeTurn);
}

// --- Embedding Cache ---

export async function getEmbedding(
  textHash: string
): Promise<EmbeddingVector | null> {
  const cached = await redis.get(`emb:${textHash}`);
  if (cached === null) return null;
  return JSON.parse(cached) as EmbeddingVector;
}

export async function setEmbedding(
  textHash: string,
  vector: EmbeddingVector,
  ttlSeconds: number
): Promise<void> {
  await redis.setex(`emb:${textHash}`, ttlSeconds, JSON.stringify(vector));
}

// --- User Deletion Cleanup ---

export async function deleteUserRedisState(
  userId: string,
  personaIds: string[],
  memoryIds: string[]
): Promise<void> {
  for (const personaId of personaIds) {
    await redis.del(`working:${userId}:${personaId}`);
  }
  for (const memoryId of memoryIds) {
    await redis.del(`cooldown:${memoryId}`);
  }
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      'rcache:*',
      'COUNT',
      100
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== '0');
}
