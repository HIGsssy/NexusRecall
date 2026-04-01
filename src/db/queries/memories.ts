// ============================================================
// db/queries/memories — SQL for memories table
// Nexus Recall Phase 1 — S03
// ============================================================

import { pool } from '../client';
import { deleteExchangesByUserIdTx, getDistinctExchangePersonaIdsTx } from './exchanges';
import type { EmbeddingVector } from '../../memory/models';

export async function insertConfirmedSemanticMemory(
  internalUserId: string,
  personaId: string,
  content: string,
  embedding: EmbeddingVector,
  importance: number,
  confidence: 'explicit' | 'inferred',
  volatility: 'factual' | 'subjective'
): Promise<string> {
  const vectorStr = `[${embedding.join(',')}]`;
  const result = await pool.query(
    `INSERT INTO memories (
       internal_user_id, persona_id, memory_type, content, embedding,
       importance, confidence, volatility, status, graduation_status, strength
     ) VALUES ($1, $2, 'semantic', $3, $4::vector, $5, $6, $7, 'active', 'confirmed', 1.0)
     RETURNING id`,
    [internalUserId, personaId, content, vectorStr, importance, confidence, volatility]
  );
  return result.rows[0].id as string;
}

export async function insertConfirmedEpisodicMemory(
  internalUserId: string,
  personaId: string,
  content: string,
  embedding: EmbeddingVector,
  importance: number,
  confidence: 'explicit' | 'inferred',
  volatility: 'factual' | 'subjective'
): Promise<string> {
  const vectorStr = `[${embedding.join(',')}]`;
  const result = await pool.query(
    `INSERT INTO memories (
       internal_user_id, persona_id, memory_type, content, embedding,
       importance, confidence, volatility, status, graduation_status, strength
     ) VALUES ($1, $2, 'episodic', $3, $4::vector, $5, $6, $7, 'active', 'confirmed', 1.0)
     RETURNING id`,
    [internalUserId, personaId, content, vectorStr, importance, confidence, volatility]
  );
  return result.rows[0].id as string;
}

export async function updateMemoryByScope(
  memoryId: string,
  internalUserId: string,
  personaId: string,
  feedback?: 'positive' | 'negative',
  inhibit?: boolean
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [memoryId, internalUserId, personaId];
  let paramIdx = 4;

  if (feedback !== undefined) {
    if (feedback === 'positive') {
      sets.push(`importance = LEAST(1.0, importance + 0.1)`);
    } else {
      sets.push(`importance = GREATEST(0.0, importance - 0.1)`);
    }
  }

  if (inhibit !== undefined) {
    sets.push(`inhibited = $${paramIdx}`);
    params.push(inhibit);
    paramIdx++;
  }

  if (sets.length === 0) {
    return false;
  }

  const result = await pool.query(
    `UPDATE memories SET ${sets.join(', ')}
     WHERE id = $1 AND internal_user_id = $2 AND persona_id = $3
     RETURNING id`,
    params
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function updateBookkeeping(
  memoryId: string,
  cooldownUntil: Date
): Promise<void> {
  await pool.query(
    `UPDATE memories
     SET last_accessed_at = NOW(),
         access_count = access_count + 1,
         cooldown_until = $2
     WHERE id = $1`,
    [memoryId, cooldownUntil.toISOString()]
  );
}

export async function fetchCandidates(
  userId: string,
  personaId: string,
  queryEmbedding: EmbeddingVector,
  limit: number
): Promise<Record<string, unknown>[]> {
  const vectorStr = `[${queryEmbedding.join(',')}]`;
  const result = await pool.query(
    `SELECT id, memory_type, content, embedding, importance, confidence,
            volatility, status, graduation_status, strength, cooldown_until,
            inhibited, created_at, last_accessed_at
     FROM memories
     WHERE internal_user_id = $1
       AND persona_id = $2
     ORDER BY embedding <-> $3::vector
     LIMIT $4`,
    [userId, personaId, vectorStr, limit]
  );
  return result.rows as Record<string, unknown>[];
}

export async function deleteAllUserDataFromDb(
  userId: string
): Promise<{ personaIds: string[]; memoryIds: string[] }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const memoryPersonaResult = await client.query(
      'SELECT DISTINCT persona_id FROM memories WHERE internal_user_id = $1',
      [userId]
    );
    const memoryPersonaIds = memoryPersonaResult.rows.map(
      (r: { persona_id: string }) => r.persona_id
    );
    const exchangePersonaIds = await getDistinctExchangePersonaIdsTx(client, userId);
    const personaIds = [...new Set([...memoryPersonaIds, ...exchangePersonaIds])];

    const memoryResult = await client.query(
      'SELECT id FROM memories WHERE internal_user_id = $1',
      [userId]
    );
    const memoryIds = memoryResult.rows.map(
      (r: { id: string }) => r.id
    );

    await client.query(
      'DELETE FROM memories WHERE internal_user_id = $1',
      [userId]
    );
    await deleteExchangesByUserIdTx(client, userId);

    await client.query('COMMIT');
    return { personaIds, memoryIds };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
