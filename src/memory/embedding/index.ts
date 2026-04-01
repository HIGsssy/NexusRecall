// ============================================================
// memory/embedding — Vector embedding generation via provider adapter
// Nexus Recall Phase 1 — S02
// ============================================================

import { config } from '../../config';
import type { EmbeddingVector } from '../models';

// --- Typed Error ---

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

// --- Provider Adapter Interface ---

interface EmbeddingProviderAdapter {
  generate(text: string): Promise<EmbeddingVector>;
  readonly modelDimensions: number;
  readonly providerId: string;
}

// --- Provider API Response Shape ---

interface EmbeddingApiResponse {
  data: Array<{ embedding: number[] }>;
}

// --- OpenRouter Adapter ---

class OpenRouterEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly modelDimensions = 1536;
  readonly providerId = 'openrouter';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(text: string): Promise<EmbeddingVector> {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new EmbeddingError(
        `OpenRouter embedding request failed (${response.status}): ${body}`
      );
    }

    const result = (await response.json()) as EmbeddingApiResponse;

    if (!result.data?.[0]?.embedding) {
      throw new EmbeddingError('OpenRouter returned unexpected response shape');
    }

    const vector = result.data[0].embedding;

    if (vector.length !== this.modelDimensions) {
      throw new EmbeddingError(
        `OpenRouter returned vector of dimension ${vector.length}, expected ${this.modelDimensions}`
      );
    }

    return vector;
  }
}

// --- NanoGPT Adapter ---

class NanoGPTEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly modelDimensions = 1536;
  readonly providerId = 'nanogpt';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(text: string): Promise<EmbeddingVector> {
    const response = await fetch('https://nano-gpt.com/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new EmbeddingError(
        `NanoGPT embedding request failed (${response.status}): ${body}`
      );
    }

    const result = (await response.json()) as EmbeddingApiResponse;

    if (!result.data?.[0]?.embedding) {
      throw new EmbeddingError('NanoGPT returned unexpected response shape');
    }

    const vector = result.data[0].embedding;

    if (vector.length !== this.modelDimensions) {
      throw new EmbeddingError(
        `NanoGPT returned vector of dimension ${vector.length}, expected ${this.modelDimensions}`
      );
    }

    return vector;
  }
}

// --- Provider Selection ---

function createAdapter(): EmbeddingProviderAdapter {
  if (config.embeddingProvider === 'openrouter') {
    return new OpenRouterEmbeddingAdapter(config.openrouterApiKey, config.embeddingModel);
  }
  return new NanoGPTEmbeddingAdapter(config.nanogptApiKey, config.embeddingModel);
}

const adapter: EmbeddingProviderAdapter = createAdapter();

// --- Public Interface ---

export async function embed(text: string, _sessionId?: string): Promise<EmbeddingVector> {
  if (!text || text.trim().length === 0) {
    throw new EmbeddingError('Cannot embed empty text');
  }

  const vector = await adapter.generate(text);
  return vector;
}
