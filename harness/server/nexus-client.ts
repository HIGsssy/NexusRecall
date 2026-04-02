import { harnessConfig } from './config';
import type {
  RetrievalRequest,
  RetrievalResult,
  IngestRequest,
  StoreMemoryResult,
  IngestionDebugEvent,
} from './nexus-types';
import { NexusClientError } from './nexus-types';

const baseUrl = harnessConfig.nexusRecallUrl;

async function post<T>(path: string, body: unknown, stage: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new NexusClientError(
      `Failed to connect to Nexus Recall at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      0,
      stage
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new NexusClientError(
      `Nexus Recall ${path} returned ${res.status}: ${text}`,
      res.status,
      stage
    );
  }

  return res.json() as Promise<T>;
}

export async function retrieveMemories(context: RetrievalRequest): Promise<RetrievalResult> {
  return post<RetrievalResult>('/api/retrieve', context, 'retrieval');
}

export async function ingestExchange(input: IngestRequest): Promise<StoreMemoryResult> {
  return post<StoreMemoryResult>('/api/ingest', input, 'ingestion');
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchIngestionDebugLog(
  userId?: string,
  personaId?: string
): Promise<IngestionDebugEvent[]> {
  const params = new URLSearchParams();
  if (userId) params.set('user_id', userId);
  if (personaId) params.set('persona_id', personaId);
  const qs = params.toString();
  try {
    const res = await fetch(`${baseUrl}/api/ingest/debug${qs ? `?${qs}` : ''}`);
    if (!res.ok) return [];
    return res.json() as Promise<IngestionDebugEvent[]>;
  } catch {
    return [];
  }
}
