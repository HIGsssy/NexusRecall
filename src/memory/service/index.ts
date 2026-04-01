// ============================================================
// memory/service — Public interface (orchestration only)
// Nexus Recall Phase 1 — S03
// ============================================================

import { execute } from '../retrieval';
import {
  ingest,
  enqueuePrune,
  enqueueSummarize,
  performUpdate,
  performDeleteUserData,
} from '../ingestion';
import type {
  StoreMemoryInput,
  StoreMemoryResult,
  RetrievalContext,
  RetrievalResult,
  UpdateMemoryInput,
  UpdateMemoryResult,
  PruneScope,
} from '../models';

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

  return execute(context);
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

  return performUpdate(input);
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

  await performDeleteUserData(userId);
}

export async function summarizeSession(sessionId: string): Promise<void> {
  if (!sessionId) throw new Error('Missing required field: sessionId');

  await enqueueSummarize(sessionId);
}
