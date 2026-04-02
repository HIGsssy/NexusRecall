# Nexus Recall

A standalone AI memory service that provides persistent, contextual memory for conversational AI systems. Nexus Recall ingests conversation exchanges, classifies and embeds them, detects contradictions, and retrieves relevant memories using an 8-stage scoring pipeline.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│  API Client  │────▶│ memory/service│────▶│ memory/ingestion  │
└─────────────┘     │ (delegator)   │     │ classify → embed  │
                    └──────┬───────┘     │ → contradict →    │
                           │             │   promote         │
                           ▼             └──────────────────┘
                    ┌──────────────┐
                    │memory/retrieval│
                    │ 8-stage pipeline│
                    └──────────────┘
```

### Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| **Service** | `src/memory/service/` | Thin delegator — routes calls to ingestion and retrieval |
| **Ingestion** | `src/memory/ingestion/` | Classification, embedding, contradiction detection, memory promotion |
| **Retrieval** | `src/memory/retrieval/` | 8-stage pipeline: candidate fetch → similarity → dedup → recency → confidence → intent alignment → scoring → type-capped selection |
| **Embedding** | `src/memory/embedding/` | Provider adapter (OpenRouter / NanoGPT) with Redis-backed cache |
| **Cache** | `src/memory/cache/` | Redis interface for embeddings, retrieval results, cooldowns, working memory |
| **Models** | `src/memory/models/` | Shared types and interfaces |
| **Config** | `src/config/` | Typed config singleton with startup validation |
| **DB** | `src/db/` | PostgreSQL client + query modules for memories and exchanges |
| **Queue** | `src/queue/` | BullMQ client and worker for async job processing |

## Tech Stack

- **Runtime:** TypeScript / Node.js (ES2022 target, CommonJS)
- **Database:** PostgreSQL + pgvector (vector(1536), HNSW index)
- **Cache / Queue:** Redis via ioredis 5.x, BullMQ 5.x
- **Embedding Providers:** OpenRouter or NanoGPT (configurable)

## Memory Types

| Type | Description |
|------|-------------|
| `semantic` | Factual knowledge extracted from assistant responses |
| `episodic` | Experiential memories from user messages (≥50 chars) |
| `self` | Self-referential statements from the user |
| `commitment` | Explicit promises/agreements (detected via pattern matching) |

## Retrieval Pipeline

The retrieval pipeline applies 8 sequential stages:

1. **Candidate Fetch** — pgvector similarity search
2. **Similarity Threshold** — per-type minimum thresholds
3. **Deduplication** — cosine similarity dedup
4. **Recency Decay** — time-based scoring adjustment
5. **Confidence Filter** — minimum confidence threshold
6. **Intent Alignment** — per-intent type rules (commitments only for `task` intent)
7. **Composite Scoring** — weighted: similarity 0.6, recency 0.2, importance 0.1, strength 0.1
8. **Type-Capped Selection** — max per type (semantic: 2, episodic: 2, commitment: 1, self: 1)

## Key Features

- **Commitment Detection** — 19 acceptance patterns with 14 exclusion patterns for hedged language
- **Contradiction Detection** — cosine similarity comparison against existing memories; contradicted memories marked `superseded` with lineage tracking
- **Intent-Aware Retrieval** — `task`, `conversational`, and `emotional` intents receive different memory subsets
- **Cooldown System** — Redis-first with DB fallback to prevent memory re-retrieval spam
- **Working Memory** — TTL-based short-term turn buffer

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (`postgres://` or `postgresql://`) |
| `REDIS_URL` | Redis connection string (`redis://` or `rediss://`) |
| `EMBEDDING_PROVIDER` | `openrouter` or `nanogpt` |
| `EMBEDDING_MODEL` | Model identifier for the embedding provider |
| `OPENROUTER_API_KEY` | Required when `EMBEDDING_PROVIDER=openrouter` |
| `NANOGPT_API_KEY` | Required when `EMBEDDING_PROVIDER=nanogpt` |

### Optional (with defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_POOL_SIZE` | 10 | Max DB connections |
| `EMBEDDING_CACHE_TTL_SECONDS` | 300 | Embedding cache TTL |
| `RETRIEVAL_TOP_N` | 20 | Max candidates per retrieval |
| `SIMILARITY_THRESHOLD_SEMANTIC` | 0.75 | Min similarity for semantic memories |
| `SIMILARITY_THRESHOLD_EPISODIC` | 0.70 | Min similarity for episodic memories |
| `SIMILARITY_THRESHOLD_SELF` | 0.72 | Min similarity for self memories |
| `SIMILARITY_THRESHOLD_COMMITMENT` | 0.60 | Min similarity for commitment memories |
| `RETRIEVAL_CACHE_TTL_TASK` | 30 | Cache TTL for task intent (seconds) |
| `RETRIEVAL_CACHE_TTL_CONV` | 60 | Cache TTL for conversational intent |
| `RETRIEVAL_CACHE_TTL_EMOTIONAL` | 120 | Cache TTL for emotional intent |
| `COOLDOWN_DURATION_SECONDS` | 300 | Memory retrieval cooldown |
| `WORKING_MEMORY_MAX_TURNS` | 10 | Max turns in working memory |
| `WORKING_MEMORY_TTL_SECONDS` | 1800 | Working memory TTL |
| `CLASSIFIER_MIN_SEMANTIC_LENGTH` | 20 | Min char length for semantic classification |
| `CLASSIFIER_MIN_EPISODIC_LENGTH` | 50 | Min char length for episodic classification |
| `CONTRADICTION_SIMILARITY_THRESHOLD` | 0.92 | Cosine threshold for contradiction detection |
| `EXCHANGE_RETENTION_DAYS` | 90 | Days to retain raw exchanges |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |

## Database

Schema is managed via sequential SQL migrations in `db/migrations/`.

Current migration: `001_initial_schema.sql` — creates the `memories` and `exchanges` tables with pgvector support and HNSW indexing.

## Project Structure

```
src/
├── config/           # Typed config with env validation
├── db/
│   ├── client.ts     # PostgreSQL pool
│   └── queries/
│       ├── exchanges.ts
│       └── memories.ts
├── memory/
│   ├── cache/        # Redis cache interface
│   ├── embedding/    # Embedding provider adapter
│   ├── ingestion/    # Classification + promotion pipeline
│   ├── models/       # Shared types and interfaces
│   ├── retrieval/    # 8-stage retrieval pipeline
│   └── service/      # Thin service delegator
└── queue/
    ├── client.ts     # BullMQ queue
    └── worker.ts     # Job processor
```

## Status

**Phase 1 (S01–S03 + Correction Pass):** Complete
**Phase 2 (S04–S07):** Complete — all slices audited and passing

See [PROJECTSTATUS.md](PROJECTSTATUS.md) for detailed per-slice status.
