# Nexus Recall — Technical Architecture Document

**Version:** 1.0
**Date:** April 1, 2026
**Status:** Architecture Draft
**Runtime:** TypeScript / Node.js

---

## 1. System Overview

### What the System Is

Nexus Recall is a standalone AI memory service. It accepts memory ingestion requests, stores structured memory records scoped to `(internal_user_id, persona_id)`, and returns scored, filtered memory objects in response to retrieval queries. It is infrastructure — not a bot, not a chat engine, not a product that interacts with users.

### Service Responsibilities

- Accept and validate memory ingestion from authorized clients
- Store memories as vector-indexed, structured records
- Execute the full retrieval pipeline: embed, query, filter, score, select
- Maintain working memory state in Redis for active sessions
- Manage the memory lifecycle: promotion, decay, lineage, pruning
- Expose a narrow, stable public interface

### Explicit Out-of-Scope

- Prompt construction or formatting
- LLM invocation of any kind
- Intent classification (intent is an inbound parameter)
- Generating or streaming responses
- Discord logic, HTTP web UI, user-facing session management
- Token counting
- Re-scoring or re-filtering of memories after return
- Any adapter-specific protocol handling

---

## 2. High-Level Architecture

### Layer Structure

```
┌──────────────────────────────────────────────────────┐
│                   External Clients                    │
│        (Discord bot, web app, future adapters)        │
│             ↓ calls via public interface              │
├──────────────────────────────────────────────────────┤
│                memory/service (API Layer)             │
│         Public interface. Orchestration only.         │
│     ↓ routes to internal modules — never bypassed    │
├───────────────┬──────────────────────────────────────┤
│ memory/retrieval│          memory/ingestion           │
│  Full pipeline │   Ingest, log, queue async work      │
├───────────────┴──────────────────────────────────────┤
│  memory/embedding   │   memory/cache   │ memory/models│
│  Vector generation  │  Redis interface │ Type defs    │
├─────────────────────┴──────────────────┴─────────────┤
│              PostgreSQL + pgvector   │   Redis        │
│              Persistent store        │   Ephemeral    │
└──────────────────────────────────────────────────────┘
```

### Data Flow — Retrieval Path

```
Client
  → memory/service.retrieveMemories(context)
  → memory/retrieval
      ├─→ memory/cache: check retrieval cache
      ├─→ memory/embedding: embed query (cache-first)
      ├─→ PostgreSQL: scoped pgvector query (TOP_N candidates)
      ├─→ hard filter pipeline (sequential, in-module)
      ├─→ scoring (in-module)
      ├─→ type-capped selection (in-module)
      ├─→ memory/cache: write cooldown, write retrieval cache
      └─→ memory/service: return structured memory objects
  → Client receives ordered, typed memory object array
```

### Data Flow — Ingestion Path

```
Client
  → memory/service.storeMemory(input)
  → memory/ingestion
      ├─→ validate input
      ├─→ PostgreSQL: write exchange record (sync)
      ├─→ enqueue async classification job
      └─→ return acknowledgment to client (sync done)

Async worker:
  → classify turn
  → memory/embedding: embed extracted content
  → deduplication/contradiction check (PostgreSQL)
  → write/promote memory record (PostgreSQL)
```

---

## 3. Module Breakdown

### 3.1 — `memory/service`

**Responsibility:** Thin routing and orchestration layer only. The sole surface external consumers may call. Each public method delegates directly to a single owning internal module and returns that module's result. Does not contain business logic of any kind.

**Routing contract:** Each method maps 1:1 to a single owning internal module. `memory/service` calls that module and returns the result. It does not coordinate across multiple modules, does not branch on memory state, and does not perform multi-step workflow orchestration. Validation is limited to basic input shape checks (required fields, type guards) — no domain validation is performed here.

**Key Interface:**
```typescript
interface MemoryService {
  storeMemory(input: StoreMemoryInput): Promise<StoreMemoryResult>
  retrieveMemories(context: RetrievalContext): Promise<RetrievalResult>
  updateMemory(input: UpdateMemoryInput): Promise<UpdateMemoryResult>
  pruneMemory(scope: PruneScope): Promise<void>
  deleteUserMemory(userId: string): Promise<void>
  summarizeSession(sessionId: string): Promise<void>
}
```

**Must NOT:**
- Contain business logic of any kind
- Coordinate multi-step workflows across modules
- Branch logic across multiple internal modules
- Perform validation beyond basic input shape checks
- Contain embedding logic
- Execute database queries
- Apply scoring or filtering
- Access Redis directly
- Expose any internal module to clients

---

### 3.2 — `memory/retrieval`

**Responsibility:** Execute the full retrieval pipeline. Accepts a retrieval context, returns an ordered set of typed memory objects.

**Key Interface:**
```typescript
interface RetrievalModule {
  execute(context: RetrievalContext): Promise<RetrievalResult>
}
```

**Pipeline stages (sequential, all required):**
1. Cache check → early return if hit
2. Embed query via `memory/embedding`
3. Scoped pgvector candidate fetch (PostgreSQL)
4. Hard filter sequence (in-order, no skip)
5. Scoring
6. Type-capped selection
7. Post-selection bookkeeping (async, non-blocking)
8. Cache write + return

**Must NOT:**
- Classify intent
- Format prompt text
- Return raw database records
- Skip any pipeline stage
- Access Redis directly (delegates to `memory/cache`)

---

### 3.3 — `memory/ingestion`

**Responsibility:** Accept raw turns, write exchange records synchronously, queue async classification and promotion work.

**Key Interface:**
```typescript
interface IngestionModule {
  ingest(input: IngestionInput): Promise<IngestionAck>
  processJob(job: IngestionJob): Promise<void>   // called by async worker
}
```

**Synchronous path (blocking):**
- Input validation
- Write to `exchanges` table
- Assign `graduation_status = observation`
- Enqueue classification job
- Return `IngestionAck`

**Asynchronous path (worker-executed):**
- Turn classification
- Embedding generation
- Deduplication / merge check
- Contradiction detection → lineage update
- Promotion to candidate or confirmed
- Invalidate retrieval cache for `(internal_user_id, persona_id)` on any memory record write

**Must NOT:**
- Block `storeMemory()` on classification or embedding
- Access the retrieval pipeline
- Manage Redis working memory (that belongs to `memory/cache`)

---

### 3.4 — `memory/embedding`

**Responsibility:** Generate vector embeddings for text input via a configured provider adapter. Check embedding cache before generating.

**Key Interface:**
```typescript
interface EmbeddingModule {
  embed(text: string, sessionId?: string): Promise<EmbeddingVector>
}

interface EmbeddingProviderAdapter {
  generate(text: string): Promise<EmbeddingVector>
  readonly modelDimensions: number
}
```

**Provider adapter implementations:**
- `OpenRouterEmbeddingAdapter`
- `NanoGPTEmbeddingAdapter`

Active adapter is selected at startup based on `EMBEDDING_PROVIDER` config. No runtime switching. No multi-provider routing.

**Cache check order:**
1. Check `memory/cache` embedding cache (key: normalized text hash, TTL: 5–10 min)
2. On miss: call active provider adapter
3. Write result to embedding cache
4. Return vector

**Must NOT:**
- Store embeddings to the database (that is ingestion's responsibility)
- Contain retrieval logic
- Be called directly by any module other than `memory/retrieval` and `memory/ingestion`
- Expose provider credentials outside this module

---

### 3.5 — `memory/cache`

**Responsibility:** All Redis interactions. Provides typed interfaces for working memory, cooldown, retrieval cache, and embedding cache.

**Key Interface:**
```typescript
interface CacheModule {
  // Working memory
  pushWorkingMemoryTurn(userId: string, personaId: string, turn: ExchangeTurn): Promise<void>
  getWorkingMemory(userId: string, personaId: string): Promise<ExchangeTurn[]>

  // Cooldown
  setCooldown(memoryId: string, durationMs: number): Promise<void>
  isOnCooldown(memoryId: string): Promise<boolean>

  // Retrieval cache
  getRetrievalCache(key: RetrievalCacheKey): Promise<RetrievalResult | null>
  setRetrievalCache(key: RetrievalCacheKey, result: RetrievalResult, ttlMs: number): Promise<void>
  invalidateRetrievalCache(userId: string, personaId: string): Promise<void>

  // Embedding cache
  getEmbedding(textHash: string): Promise<EmbeddingVector | null>
  setEmbedding(textHash: string, vector: EmbeddingVector, ttlMs: number): Promise<void>
}
```

**Redis key schemas:**

| Purpose | Key Pattern | TTL |
|---|---|---|
| Working memory | `working:{userId}:{personaId}` | 30 min inactivity |
| Cooldown | `cooldown:{memoryId}` | Cooldown duration |
| Retrieval cache | `rcache:{sha256(userId+personaId+embeddingHash+intentType)}` | 30–120 s (per intent type) |
| Embedding cache | `emb:{sha256(normalizedText)}` | 5–10 min |

**Must NOT:**
- Contain memory business logic
- Execute PostgreSQL queries
- Apply scoring or filtering

**Working memory constraint:** `pushWorkingMemoryTurn` and `getWorkingMemory` are never called from the synchronous retrieval pipeline. Working memory is not part of retrieval in Phase 1. It exists solely as a short-term buffer for client-side use and future enhancements. These operations must not influence retrieval scoring, filtering, or selection.

**Cache invalidation rule:** `invalidateRetrievalCache(userId, personaId)` must be called by any module that performs a write operation affecting `memories` records for a given scope. This includes: memory creation, update (feedback, inhibition), deletion, pruning, and promotion from the ingestion pipeline.

---

### 3.6 — `memory/models`

**Responsibility:** Define all shared data types, enums, and validation schemas. Has no runtime dependencies on any other module.

**Key types:**
```typescript
type MemoryType = 'semantic' | 'episodic' | 'self' | 'commitment'
type MemoryStatus = 'active' | 'superseded' | 'corrected'
type GraduationStatus = 'observation' | 'candidate' | 'confirmed'
type ConfidenceLevel = 'explicit' | 'inferred'
type VolatilityLevel = 'factual' | 'subjective'
type IntentType = 'task' | 'conversational' | 'emotional'

interface Memory { /* see §4 */ }
interface Exchange { /* see §4 */ }
interface RetrievalContext { /* see §5 */ }
interface RetrievalResult { /* see §5 */ }
interface StoreMemoryInput { /* see §5 */ }
```

**Must NOT:**
- Contain business logic
- Perform database operations
- Import from any other internal module

---

### 3.7 — `memory/lifecycle` (Async Background Only)

**Responsibility:** Scheduled background maintenance jobs. Decay, reinforcement, pruning, merging.

**Jobs:**
- `DecayJob` — time-based strength reduction (scheduled)
- `ReinforcementJob` — usage-based strength increase (triggered post-retrieval)
- `PruneJob` — archive or remove low-strength superseded records
- `MergeJob` — consolidate near-duplicate confirmed records

**Must NOT:**
- Execute on the synchronous retrieval path
- Own Redis state beyond what decay/pruning requires
- Modify the service interface

**Implementation priority:** Phase 2 for pruning/merging. Phase 3 for decay/reinforcement.

---

### 3.8 — `memory/governors` (Phase 3)

**Responsibility:** Behavioral constraint systems. Confidence gating, recall modes, negative feedback loop, do-nothing protocol.

**Must NOT:**
- Own scoring formulas
- Control hard filter ordering (that belongs to `memory/retrieval`)
- Access Redis directly (delegates to `memory/cache`)

**Implementation priority:** Phase 3.

---

## 4. Data Model

### 4.1 — `memories` Table (PostgreSQL + pgvector)

```sql
CREATE TABLE memories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_user_id    TEXT NOT NULL,
  persona_id          TEXT NOT NULL,
  memory_type         TEXT NOT NULL CHECK (memory_type IN ('semantic','episodic','self','commitment')),
  content             TEXT NOT NULL,
  embedding           VECTOR(1536) NOT NULL,
  importance          FLOAT NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
  confidence          TEXT NOT NULL CHECK (confidence IN ('explicit','inferred')),
  volatility          TEXT NOT NULL CHECK (volatility IN ('factual','subjective')),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','corrected')),
  graduation_status   TEXT NOT NULL DEFAULT 'observation' CHECK (graduation_status IN ('observation','candidate','confirmed')),
  strength            FLOAT NOT NULL DEFAULT 1.0,
  cooldown_until      TIMESTAMPTZ,
  inhibited           BOOLEAN NOT NULL DEFAULT FALSE,
  lineage_parent_id   UUID REFERENCES memories(id),
  access_count        INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at    TIMESTAMPTZ,
  last_reinforced_at  TIMESTAMPTZ
);
```

**Constraints:**
- `lineage_parent_id` must reference a record with the same `internal_user_id` and `persona_id`
- No cross-persona lineage permitted
- No soft delete — records are hard-deleted or marked `superseded`

**Indexes:**
```sql
-- Scoped vector search (HNSW)
CREATE INDEX memories_embedding_hnsw_idx
  ON memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Scoped retrieval queries
CREATE INDEX memories_scope_idx
  ON memories (internal_user_id, persona_id, status, graduation_status);

-- Cooldown fast lookup
CREATE INDEX memories_cooldown_idx
  ON memories (id, cooldown_until)
  WHERE cooldown_until IS NOT NULL;
```

**Query constraint:** Every retrieval query must include `WHERE internal_user_id = $1 AND persona_id = $2`. Global queries are never permitted on the retrieval path.

---

### 4.2 — `exchanges` Table (PostgreSQL)

```sql
CREATE TABLE exchanges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_user_id  TEXT NOT NULL,
  persona_id        TEXT NOT NULL,
  session_id        TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content           TEXT NOT NULL,
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Retention policy:**
- Default retention: 90 days (configurable via `EXCHANGE_RETENTION_DAYS`)
- Purge job: scheduled background job, hard-deletes records where `created_at < NOW() - INTERVAL '<retention_days> days'`
- No soft delete. No bypass. Applies uniformly.

**Indexes:**
```sql
CREATE INDEX exchanges_scope_idx
  ON exchanges (internal_user_id, persona_id, created_at DESC);

CREATE INDEX exchanges_session_idx
  ON exchanges (session_id, created_at DESC);

CREATE INDEX exchanges_purge_idx
  ON exchanges (created_at);
```

**Access rule:** The `exchanges` table must never be accessed in the synchronous retrieval pipeline. It must not be used as fallback context, for augmentation, for scoring, or for filtering at any stage. It is strictly: ingestion input, audit/debug reference, and async processing source. The only data source for the retrieval pipeline is the `memories` table.

---

### 4.3 — Entity Relationships

```
exchanges (1)──────────────── ingestion pipeline
    └─ internal_user_id, persona_id (scope)

memories (N)───────────────── retrieval pipeline
    └─ internal_user_id, persona_id (scope, mandatory)
    └─ lineage_parent_id → memories.id (same scope only)
```

No foreign key from `memories` to `exchanges`. Lineage is modeled entirely within `memories` via `lineage_parent_id`.

---

## 5. API Design (v1)

All methods are exposed exclusively through `memory/service`. No caller may bypass this surface.

---

### `storeMemory(input)`

**Input:**
```typescript
interface StoreMemoryInput {
  internal_user_id: string   // required
  persona_id: string         // required
  session_id: string         // required
  role: 'user' | 'assistant' // required
  content: string            // required; max 8000 chars
  metadata?: Record<string, unknown>
}
```

**Output:**
```typescript
interface StoreMemoryResult {
  exchange_id: string
  queued: boolean
}
```

**Constraints:**
- Returns after synchronous write to `exchanges` only
- Does not wait for embedding, classification, or promotion
- `queued: true` means the async pipeline has been enqueued — not processed

---

### `retrieveMemories(context)`

**Input:**
```typescript
interface RetrievalContext {
  internal_user_id: string   // required
  persona_id: string         // required
  query_text: string         // required; the current input to search against
  intent_type?: IntentType   // optional; defaults to 'conversational'
  session_id?: string        // optional; used for working memory lookup
}
```

**Output:**
```typescript
interface RetrievalResult {
  memories: MemoryObject[]
  retrieved_at: string       // ISO timestamp
  cache_hit: boolean
}

interface MemoryObject {
  id: string
  memory_type: MemoryType
  content: string
  importance: number
  confidence: ConfidenceLevel
  volatility: VolatilityLevel
  score: number              // composite retrieval score
  created_at: string
  last_accessed_at: string | null
}
```

**Constraints:**
- Response is always a typed, ordered array — never prompt text, never raw rows
- Empty array is a valid, correct response
- The system does not guarantee a minimum number of returned memories. Partially filled or empty results are valid and expected outcomes, not errors.
- `score` is for client-side ordering reference only; the array is already ordered by score descending
- No internal metadata (graduation status, strength, cooldown, lineage) is exposed

**Response stability:** This response shape is forward-compatible. New fields may be added without constituting a breaking change. Existing fields must not change meaning or structure without an explicit versioning decision. Consumers must not depend on field absence; they must handle unknown fields gracefully.

---

### `updateMemory(input)`

**Input:**
```typescript
interface UpdateMemoryInput {
  memory_id: string
  internal_user_id: string   // scope verification
  persona_id: string         // scope verification
  feedback?: 'positive' | 'negative'
  inhibit?: boolean
}
```

**Output:**
```typescript
interface UpdateMemoryResult {
  memory_id: string
  updated: boolean
}
```

**Constraints:**
- Scope must match or the call is rejected
- Any write to `memories` must invalidate the retrieval cache for the affected scope

---

### `pruneMemory(scope)`

**Input:**
```typescript
interface PruneScope {
  internal_user_id: string
  persona_id: string
}
```

**Output:** `void`

**Constraints:**
- Triggers async pruning job for the given scope
- Does not block
- Pruning logic is scoped strictly — no cross-scope effects

---

### `deleteUserMemory(userId)`

**Input:**
```typescript
// userId: internal_user_id
deleteUserMemory(userId: string): Promise<void>
```

**Output:** `void`

**Constraints:**
- Deletes ALL data for the user across ALL personas:
  - All `memories` records
  - All `exchanges` records
  - All Redis state (working memory, cooldowns, retrieval caches, embedding caches) for all known `(userId, personaId)` pairs
- Retrieval cache must be explicitly invalidated for all `(userId, personaId)` pairs belonging to the user before the operation resolves
- Deletion is permanent and non-reversible
- Must complete fully before resolving — partial deletion is not acceptable
- Implemented as a database transaction where applicable

---

### `summarizeSession(sessionId)`

**Input:**
```typescript
summarizeSession(sessionId: string): Promise<void>
```

**Output:** `void`

**Constraints:**
- Enqueues async summarization job
- Does not block
- Phase 1: stub implementation that enqueues and returns

---

## 6. Embedding Strategy

### Provider Adapter Pattern

The `memory/embedding` module exposes a single internal interface:

```typescript
interface EmbeddingModule {
  embed(text: string, sessionId?: string): Promise<EmbeddingVector>
}
```

All provider specifics — API shape, authentication, request format, response parsing, model identifiers — are fully encapsulated in the adapter:

```typescript
interface EmbeddingProviderAdapter {
  generate(text: string): Promise<EmbeddingVector>
  readonly modelDimensions: number
  readonly providerId: string
}

class OpenRouterEmbeddingAdapter implements EmbeddingProviderAdapter { ... }
class NanoGPTEmbeddingAdapter implements EmbeddingProviderAdapter { ... }
```

### Active Provider Selection

At application startup, `memory/embedding` reads `EMBEDDING_PROVIDER` from config and instantiates exactly one adapter. No runtime switching. No routing logic. The adapter is injected into the embedding module and used for the process lifetime.

### Execution Flow

```
embed(text, sessionId?)
  1. Normalize text (trim, lowercase for hash only)
  2. Compute textHash = sha256(normalizedText)
  3. Check memory/cache.getEmbedding(textHash)
     → cache hit: return cached vector
  4. Call activeAdapter.generate(text)   ← original text, not normalized
  5. memory/cache.setEmbedding(textHash, vector, TTL)
  6. Return vector
```

### Credential Isolation

Credentials (`OPENROUTER_API_KEY`, `NANOGPT_API_KEY`) and model identifiers (`EMBEDDING_MODEL`) are read exclusively inside `memory/embedding`. No other module reads or references these values.

### Where Embedding Occurs

| Trigger | Module | Caching |
|---|---|---|
| Retrieval query | `memory/retrieval` → `memory/embedding` | Embedding cache (session TTL) |
| Ingestion (async) | `memory/ingestion` job → `memory/embedding` | Embedding cache (session TTL) |

Embeddings are never generated synchronously on `storeMemory()`. They are generated in the async worker.

---

## 7. Retrieval Pipeline

### Input

```typescript
RetrievalContext {
  internal_user_id: string
  persona_id:       string
  query_text:       string
  intent_type:      IntentType   // default: 'conversational'
  session_id?:      string
}
```

### Pipeline Boundaries

The following data sources are explicitly excluded from all retrieval pipeline stages:

- **Working memory (Redis):** The retrieval pipeline does not read from working memory at any stage. Working memory must not influence scoring, filtering, or selection. It is not part of retrieval in Phase 1.
- **`exchanges` table:** The retrieval pipeline never reads from `exchanges`. It must not be used as fallback context, augmentation source, scoring input, or filtering input at any stage. The only queried data source is the `memories` table.

### Stage 1 — Cache Check

```
key = sha256(internal_user_id + persona_id + sha256(query_text) + intent_type)
result = cache.getRetrievalCache(key)
if result exists and not expired → return result immediately
```

This is the only acceptable early exit from the pipeline.

---

### Stage 2 — Embed Query

```
vector = embedding.embed(query_text, session_id)
```

Checks embedding cache first. Falls through to provider only on miss.

---

### Stage 3 — Candidate Retrieval

```sql
SELECT id, memory_type, content, embedding, importance, confidence,
       volatility, status, graduation_status, strength, cooldown_until,
       inhibited, created_at, last_accessed_at
FROM memories
WHERE internal_user_id = $1
  AND persona_id = $2
ORDER BY embedding <-> $3
LIMIT 20
```

Top-N = 20 (Phase 1). Filtering never widens this set.

---

### Stage 4 — Hard Filtering (Strictly Sequential)

Each filter runs on the output of the previous. No reordering.

| Order | Filter | Rule |
|---|---|---|
| 1 | Graduation gate | Exclude `graduation_status != 'confirmed'` |
| 2 | Inhibition gate | Exclude `inhibited = true` |
| 3 | Similarity threshold | Exclude records below per-type cosine threshold |
| 4 | Cooldown gate | Exclude records with active cooldown (Redis first, fallback to `cooldown_until`) |
| 5 | Confidence gate | Exclude records below minimum confidence for the given intent type |
| 6 | Intent alignment | Exclude memory types misaligned with the caller-supplied intent value |

**Phase 1 simplifications:**
- Confidence gate: pass all records (confidence system not yet active)
- Intent alignment: pass all records except `commitment` type (no commitments in Phase 1)
- IntentAlignmentBias = 0.0 (constant, no additive offset applied yet)

---

### Stage 5 — Scoring

Applied to all records surviving Stage 4.

**Normalization requirement:** All scoring inputs (Similarity, Recency, Importance, Strength) must be normalized to the range [0, 1] before weights are applied. Unnormalized inputs must not be passed to the scoring formula.

```
Score = (Similarity × 0.6)
      + (Recency × 0.2)
      + (Importance × 0.1)
      + (Strength × 0.1)
      + IntentAlignmentBias     // 0.0 in Phase 1
```

**Component definitions:**
- `Similarity`: cosine similarity from vector query (0–1)
- `Recency`: `1 / (1 + days_since_last_access)`, normalized to 0–1
- `Importance`: stored `importance` field (0–1)
- `Strength`: stored `strength` field (normalized to 0–1 range)

---

### Stage 6 — Type-Capped Selection

Select greedily by descending score within per-type caps:

| Memory Type | Cap |
|---|---|
| `semantic` | 2 |
| `episodic` | 2 |
| `commitment` | 1 |
| `self` | 1 |

No type is required. An empty result set is valid. Do not relax thresholds to meet a minimum count.

Total maximum output: 6 memory objects.

---

### Stage 7 — Post-Selection Bookkeeping (Non-Blocking)

For each selected memory, enqueue async work:
- Update `last_accessed_at` (PostgreSQL)
- Set cooldown in Redis (`cooldown:{memoryId}`, TTL = cooldown duration)
- Write `cooldown_until` to `memories` table
- Increment `access_count` (for reinforcement signal, Phase 3)

These writes must not block the return to the caller.

---

### Stage 8 — Cache Write and Return

```
cache.setRetrievalCache(key, result, TTL_for_intent_type)
return RetrievalResult { memories, retrieved_at, cache_hit: false }
```

**Retrieval cache TTL by intent type:**

| Intent Type | TTL |
|---|---|
| `task` | 30 s |
| `conversational` | 60 s |
| `emotional` | 120 s |

---

### No-Memory Outcome

The system does not guarantee a minimum number of returned memories. If Stage 6 selects zero memories across all types: return `RetrievalResult { memories: [], retrieved_at, cache_hit: false }`. Partially filled results (fewer memories than the type caps allow) are equally valid. Do not retry with relaxed thresholds. Do not relax filters. Do not inject weak memories. An empty or partial result is a correct outcome, not a failure condition.

---

### Latency Target

| Stage | Target |
|---|---|
| Cache hit return | < 50 ms |
| Full pipeline | < 1500 ms (p99) |

Each stage must be instrumented independently with elapsed time.

---

## 8. Async Processing

### Queue Infrastructure

Phase 1–2: **BullMQ** (Redis-backed job queue). Single worker process. No distributed workers. No external queue services.

All job types share a single BullMQ queue named `memory-ingestion`.

### Job Types

```typescript
type IngestionJobType =
  | 'classify-turn'
  | 'embed-and-promote'
  | 'prune-scope'
  | 'summarize-session'
  | 'bookkeeping'        // post-retrieval access updates
```

### Job Processing Flow

```
storeMemory() synchronous path:
  → log to exchanges
  → queue.add('classify-turn', { exchangeId, userId, personaId })
  → return IngestionAck

Worker: 'classify-turn' handler:
  → fetch exchange record
  → run classifier (LLM call or rule-based)
  → if no memory content: discard, done
  → if memory content: queue.add('embed-and-promote', { candidates })

Worker: 'embed-and-promote' handler:
  → for each candidate:
      → embed content
      → deduplication check (DB)
      → contradiction check (DB)
      → write or update memory record
```

### Failure Handling

- Failed jobs are retried up to 3 times with exponential backoff (1 s, 5 s, 15 s)
- After max retries: job moves to BullMQ dead-letter queue
- Dead-letter entries emit a structured error log: `{ jobType, jobId, error, timestamp }`
- Async pipeline failure must never propagate to `storeMemory()` response
- `storeMemory()` resolves after the synchronous write; the queue enqueue is fire-and-forget from the caller's perspective

### Graceful Degradation

- If BullMQ/Redis is unavailable at job enqueue time: log the failure, return `StoreMemoryResult { queued: false }`
- The exchange record is still written synchronously — the turn is not lost
- Retrieval path is never blocked by async queue state

---

## 9. Configuration Model

### Environment Variables

All configuration is read from environment variables at startup. No configuration is read at request time.

```
# Database
DATABASE_URL                   # PostgreSQL connection string (required)
DATABASE_POOL_SIZE             # Default: 10

# Redis
REDIS_URL                      # Redis connection string (required)

# Embedding provider
EMBEDDING_PROVIDER             # 'openrouter' | 'nanogpt' (required)
EMBEDDING_MODEL                # Provider-specific model ID (required)
OPENROUTER_API_KEY             # Required if EMBEDDING_PROVIDER=openrouter
NANOGPT_API_KEY                # Required if EMBEDDING_PROVIDER=nanogpt

# Embedding cache
EMBEDDING_CACHE_TTL_SECONDS    # Default: 300 (5 min)

# Retrieval
RETRIEVAL_TOP_N                # Candidate fetch limit. Default: 20
SIMILARITY_THRESHOLD_SEMANTIC  # Default: 0.75
SIMILARITY_THRESHOLD_EPISODIC  # Default: 0.70
SIMILARITY_THRESHOLD_SELF      # Default: 0.72
SIMILARITY_THRESHOLD_COMMITMENT# Default: 0.60
RETRIEVAL_CACHE_TTL_TASK       # Seconds. Default: 30
RETRIEVAL_CACHE_TTL_CONV       # Seconds. Default: 60
RETRIEVAL_CACHE_TTL_EMOTIONAL  # Seconds. Default: 120

# Cooldown
COOLDOWN_DURATION_SECONDS      # Default: 300 (5 min). Applies to all types in Phase 1.

# Working memory
WORKING_MEMORY_MAX_TURNS       # Default: 10
WORKING_MEMORY_TTL_SECONDS     # Default: 1800 (30 min)

# Ingestion / lifecycle
EXCHANGE_RETENTION_DAYS        # Default: 90
PURGE_JOB_CRON                 # Default: '0 3 * * *' (3am daily)

# Observability
LOG_LEVEL                      # 'debug' | 'info' | 'warn' | 'error'. Default: 'info'
```

### Startup Validation

At process start, the application validates all required environment variables and fails fast with a descriptive error if any are missing or invalid. No defaults are applied for required values.

### Configuration Access Pattern

All configuration is read once at startup into a typed `Config` object. No module reads `process.env` directly — all modules receive configuration via constructor injection or a shared `Config` singleton.

---

## 10. Non-Goals / Explicit Exclusions

The following items are not part of this system at any phase, unless an explicit scope change is approved:

### Functional Exclusions

- Prompt construction, formatting, or LLM context assembly
- LLM invocation, model calls, streaming responses
- Intent classification — intent is always an inbound parameter
- Session management beyond the Redis working memory buffer
- User authentication, authorization, or API key issuance
- Rate limiting at the service layer
- Multi-tenant routing logic
- Cross-persona memory sharing or aggregation
- Global memory queries (no user scope)

### Architectural Exclusions

- Distributed queue systems (Kafka, RabbitMQ, SQS)
- Event bus or pub/sub infrastructure
- Multi-provider embedding routing or cost optimization
- HTTP API gateway (Phase 4+ concern)
- Horizontal scaling or multi-process worker coordination
- GraphQL API surface
- Dynamic threshold tuning or adaptive retrieval logic

### Client Exclusions

- Discord adapter logic
- Web application UI or HTTP routes
- Chat engine logic of any kind
- Any consumer-side prompt assembly

### Data Exclusions

- Soft deletion (no tombstones, no deferred deletion)
- Retention bypass for any record type
- Recovery or undo paths for any deletion operation
- Cross-user data sharing or aggregation

---

*End of architecture document. Ready for interface contract formalization and schema migration authoring.*
