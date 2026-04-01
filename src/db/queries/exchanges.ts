// ============================================================
// db/queries/exchanges — SQL for exchanges table
// Nexus Recall Phase 1 — S03
// ============================================================

import { pool } from '../client';
import type { Exchange } from '../../memory/models';

function transformRow(row: Record<string, unknown>): Exchange {
  return {
    id: row['id'] as string,
    internal_user_id: row['internal_user_id'] as string,
    persona_id: row['persona_id'] as string,
    session_id: row['session_id'] as string,
    role: row['role'] as 'user' | 'assistant',
    content: row['content'] as string,
    metadata: row['metadata'] as Record<string, unknown> | null,
    created_at:
      row['created_at'] instanceof Date
        ? row['created_at'].toISOString()
        : String(row['created_at']),
  };
}

export async function insertExchange(
  internalUserId: string,
  personaId: string,
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata?: Record<string, unknown>
): Promise<Exchange> {
  const result = await pool.query(
    `INSERT INTO exchanges (internal_user_id, persona_id, session_id, role, content, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      internalUserId,
      personaId,
      sessionId,
      role,
      content,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
  return transformRow(result.rows[0] as Record<string, unknown>);
}

export async function getExchangeById(id: string): Promise<Exchange | null> {
  const result = await pool.query(
    `SELECT * FROM exchanges WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  return transformRow(result.rows[0] as Record<string, unknown>);
}

export async function deleteExchangesByUserId(userId: string): Promise<void> {
  await pool.query(
    `DELETE FROM exchanges WHERE internal_user_id = $1`,
    [userId]
  );
}
