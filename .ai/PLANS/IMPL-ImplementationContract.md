# Nexus Recall — Implementation Contract Document

**Version:** 1.1
**Date:** April 1, 2026
**Status:** Active — Implementation Control
**Supersedes:** None
**Governed by:** ARCH-SystemArchitecture.md

---

## 1. Document Purpose

This document is the authoritative implementation control surface for Phase 1 of Nexus Recall. It translates the approved architecture into a sequenced, gated build plan that builder agents must follow exactly.

**How builders must use this document:**

- Read this document before writing a single line of code
- Follow slice order without exception — do not jump ahead
- Treat every "must not" as an architectural hard constraint, not a suggestion
- Treat every validation gate as a blocking requirement — implementation does not advance until the gate passes
- When uncertain whether something is in scope, default to: not in scope unless explicitly listed here
- Do not consult ARCH-SystemArchitecture.md to expand scope — consult it only to clarify what this document describes

This document does not describe what the system eventually becomes. It describes what Phase 1 must prove, what must be built to prove it, and what must stay out until later phases authorize it.

All architectural decisions are final. This document does not invite revisitation of those decisions.

---

## 2. Phase 1 Goal

Phase 1 must prove a single, concrete thing:

**A scoped retrieval query — issued through the public service interface — returns a correctly filtered, scored, and typed memory result set from real persisted data, with all pipeline stages executing in sequence, within the latency target.**

This means:
- The public service interface exists and is the only call path
- The retrieval pipeline executes all eight stages in order
- The database schema is deployed and queryable
- Embeddings are generated via a real provider adapter, cached in Redis, and never generated redundantly
- Hard filters execute in the specified order and produce the correct output
- Scoring produces a composite score using the correct formula and normalized inputs
- Type-capped selection produces a result set containing at most 6 objects
- Redis cache, cooldown, and working memory operations function correctly
- Ingestion logs to the `exchanges` table synchronously and enqueues async work
- Basic async promotion from `observation` to `candidate` to `confirmed` is functional
- End-to-end latency (full pipeline, no cache hit) is measurable and within 1,500 ms p99
- Cache hit path returns in under 50 ms

Phase 1 does not need to prove commitment detection, contradiction resolution, decay, reinforcement, merging, governors, or any Phase 2–3 capability.

---

## 3. Phase 1 Scope

The following are explicitly in scope for Phase 1. Everything not on this list is out of scope.

**Modules:**
- `memory/models` — all shared types, enums, and validation schemas
- `memory/service` — public interface, all six methods (some stubbed per §10)
- `memory/cache` — full Redis implementation for all four cache purposes
- `memory/embedding` — full implementation with provider adapter pattern and embedding cache
- `memory/retrieval` — full eight-stage pipeline (with Phase 1 simplifications per architecture §7)
- `memory/ingestion` — synchronous `exchanges` write, job enqueueing, basic async worker

**Infrastructure:**
- PostgreSQL + pgvector database deployment
- `memories` table schema with all columns, constraints, and indexes
- `exchanges` table schema with all columns, constraints, and indexes
- Redis connectivity
- BullMQ single-queue setup (`memory-ingestion`)
- Single BullMQ worker process
- Typed `Config` singleton, startup validation of all required env vars

**Async jobs (Phase 1 extent):**
- `classify-turn`: classify exchange record (rule-based is acceptable in Phase 1 — LLM classifier deferred)
- `embed-and-promote`: generate embedding, write memory record, advance graduation status
- `bookkeeping`: post-retrieval access updates (async, non-blocking)

**Memory types active in Phase 1:**
- `semantic` only
- `episodic`, `self`, `commitment` types are defined in the schema but no records should be promoted to them in Phase 1. Hard filter and scoring code must handle all four types correctly even if only `semantic` records exist.

**Retrieval pipeline Phase 1 simplifications (from architecture §7):**
- Confidence gate: pass all records (system not yet active)
- Intent alignment: exclude `commitment` type only; pass all others
- `IntentAlignmentBias` = 0.0 (constant, not applied)

---

## 4. Phase 1 Exclusions

The following are explicitly **not permitted** in Phase 1 implementation, regardless of what the architecture document describes for later phases.

**Functional exclusions:**
- Commitment detection or commitment memory type promotion
- Contradiction detection or lineage resolution
- Memory decay (time-based strength reduction)
- Memory reinforcement (usage-based strength increase)
- Memory merging (near-duplicate consolidation)
- Memory pruning (Phase 2 — `pruneMemory()` may enqueue but the worker must be a stub)
- Session summarization beyond enqueueing (worker must be a stub)
- Confidence gating logic (gate exists but passes all records in Phase 1)
- Intent alignment beyond rejecting `commitment` type
- Governor logic of any kind
- Negative feedback loop
- Recall mode selection
- Soft-delete or tombstone patterns
- Multi-provider embedding routing
- Dynamic threshold tuning
- Any LLM invocation
- Prompt construction of any kind
- Token counting
- HTTP API gateway
- Horizontal worker scaling
- ML ranking, neural re-ranking, or any learned scoring in the retrieval pipeline
- Personalization or adaptive retrieval parameter adjustment
- Heuristic candidate set expansion beyond Stage 3 output
- Custom hand-rolled retry or backoff logic (BullMQ's built-in retry configuration is the only permitted retry mechanism)
- Inline job processing on any synchronous call path — service returns after enqueue; the worker runs asynchronously

**Structural exclusions:**
- `memory/lifecycle` module — must not exist in Phase 1
- `memory/governors` module — must not exist in Phase 1
- Any module not listed in §3
- Any interface not defined in §7
- Any table not defined in §8

**Import exclusions:**
- No module may import from a module that does not exist yet
- No placeholder imports

---

## 5. Build Slice Plan

Slices are strictly ordered. A slice may not begin until the preceding slice's validation gate has passed in full. Partial completion of a gate does not unlock the next slice.

---

### S01 — Foundation: Types, Config, and Database Schema

**Objective:** Establish the shared type system, validated configuration layer, and deployed database schema. No behavior. No service logic. No Redis. No embeddings. This slice makes everything else buildable.

**Modules/files involved:**
- `src/memory/models/` — all type definitions and enums
- `src/config/` — `Config` type, startup validation, singleton
- `db/migrations/` — initial migration: `memories` table, `exchanges` table, all indexes

**Must be implemented for real:**
- All types and enums in `memory/models` as defined in architecture §3.6 and §4
- All interface shapes for Phase 1 inputs and outputs (`StoreMemoryInput`, `StoreMemoryResult`, `RetrievalContext`, `RetrievalResult`, `MemoryObject`, `UpdateMemoryInput`, `UpdateMemoryResult`, `PruneScope`, `IngestionInput`, `IngestionAck`, `ExchangeTurn`, `EmbeddingVector`, `RetrievalCacheKey`)
- `Config` singleton with typed fields for all env vars listed in architecture §9
- Startup validation: all required vars must be present and correctly typed; process exits with a descriptive error on failure
- `memories` table schema — all columns, constraints, check constraints, and three indexes
- `exchanges` table schema — all columns, constraints, and three indexes
- pgvector extension must be enabled before the migration runs

**May remain stubbed:**
- Nothing is stubbed in S01 — it is all definitions and schema

**Explicitly forbidden in this slice:**
- Any business logic
- Any database query logic
- Any Redis interaction
- Any embedding call
- Any HTTP or transport layer
- Any Redis connection or attempt to connect to Redis
- Any external network call of any kind
- Any import of modules that do not yet exist

**Validation gate — S01 complete when:**
- [ ] `memory/models` exports all required types without TypeScript errors
- [ ] `Config` singleton loads from environment, exposes all fields with correct types
- [ ] Process fails fast with a named error for each missing required env var
- [ ] `process.env` is not read anywhere except inside `src/config/`
- [ ] Migration runs cleanly against a real PostgreSQL + pgvector instance
- [ ] `memories` table is queryable with a vector column of dimension 1536
- [ ] `exchanges` table is queryable
- [ ] All three indexes on `memories` exist; all three indexes on `exchanges` exist
- [ ] No module other than `memory/models` and `src/config/` exists yet
- [ ] No Redis connection is attempted anywhere in S01 deliverables
- [ ] No external network call is made anywhere in S01 deliverables

---

### S02 — Cache and Embedding Modules

**Objective:** Establish the Redis interface and the embedding generation path. No retrieval. No ingestion. No service interface. This slice proves that cache operations work and that real embeddings can be generated and cached.

**Modules/files involved:**
- `src/memory/cache/` — full `CacheModule` implementation
- `src/memory/embedding/` — full `EmbeddingModule` implementation with provider adapters

**Must be implemented for real:**
- All eight `CacheModule` methods against a real Redis instance
- Redis key schemas exactly as specified in architecture §3.5:
  - `working:{userId}:{personaId}` (list, TTL 30 min inactivity)
  - `cooldown:{memoryId}` (TTL = cooldown duration)
  - `rcache:{sha256(userId+personaId+embeddingHash+intentType)}`
  - `emb:{sha256(normalizedText)}`
- `EmbeddingModule.embed()` with full cache-check-then-generate flow
- `OpenRouterEmbeddingAdapter` — real implementation, calls real provider
- `NanoGPTEmbeddingAdapter` — real implementation, calls real provider
- Provider selection from `EMBEDDING_PROVIDER` config at startup
- Text normalization (trim, lowercase) for hash computation only; original text passed to provider
- Embedding cache write after generation with TTL from config

**May remain stubbed:**
- Nothing in this slice should be stubbed — both modules must be fully operational

**Explicitly forbidden in this slice:**
- Any retrieval logic inside `memory/embedding` or `memory/cache`
- Any ingestion logic inside `memory/embedding` or `memory/cache`
- Any database query inside `memory/cache`
- Any business logic inside `memory/cache`
- Hardcoded provider credentials — credentials must come from `Config`
- Any module reading `OPENROUTER_API_KEY` or `NANOGPT_API_KEY` other than `memory/embedding`
- Any direct Redis access outside `memory/cache`
- Runtime provider switching
- Any module other than `memory/embedding` constructing, referencing, or importing provider-specific request or response types
- Any module other than `memory/embedding` referencing provider API endpoints or model identifiers in any string literal or import

**Validation gate — S02 complete when:**
- [ ] `CacheModule` passes isolated tests for all eight methods against a real Redis instance
- [ ] Working memory push/get operates on a capped list respecting `WORKING_MEMORY_MAX_TURNS`
- [ ] Working memory TTL resets on push as expected
- [ ] Cooldown set/check works correctly for an arbitrary TTL
- [ ] Retrieval cache set/get/invalidate works correctly; `invalidateRetrievalCache` deletes all keys matching `(userId, personaId)` pattern
- [ ] Embedding cache set/get works with the correct key schema
- [ ] `EmbeddingModule.embed()` returns a cached vector on second call with identical text (no provider call made)
- [ ] `EmbeddingModule.embed()` calls the provider on a cache miss and writes result to cache
- [ ] Embedding vector dimension matches `EmbeddingProviderAdapter.modelDimensions`
- [ ] No test or implementation reads `process.env` directly
- [ ] No module outside `memory/embedding` references provider credential config keys
- [ ] Redis connection failure at startup produces a descriptive error and halts initialization — it does not proceed with a degraded state
- [ ] Provider API failure on `embed()` surfaces as a thrown, typed error — it does not return a partial or zero-length vector
- [ ] No SQL strings present anywhere in S02 deliverables
- [ ] No provider-specific types or API shapes referenced outside `src/memory/embedding/adapters/`

---

### S03 — Service Shell, Ingestion, and Retrieval Pipeline

**Objective:** Complete the working end-to-end path. The public service interface is established. Ingestion writes to `exchanges` synchronously and enqueues async work. The retrieval pipeline executes all eight stages and returns real results from real data. The system can be exercised end to end.

**Modules/files involved:**
- `src/memory/service/` — public service interface, all six methods
- `src/memory/ingestion/` — `ingest()`, `processJob()`, BullMQ worker
- `src/memory/retrieval/` — full eight-stage pipeline
- `src/queue/` — BullMQ queue setup and worker bootstrap
- `src/db/` — PostgreSQL client, query helpers (no raw SQL in module files)

**Must be implemented for real:**
- `MemoryService` interface with all six method signatures
- `storeMemory()` — validates input shape, delegates to `memory/ingestion`, returns `StoreMemoryResult`
- `retrieveMemories()` — validates input shape, delegates to `memory/retrieval`, returns `RetrievalResult`
- `updateMemory()` — validates input shape, writes to `memories` table, invalidates retrieval cache, returns `UpdateMemoryResult`
- `memory/ingestion.ingest()` — validates input, writes `exchanges` record, enqueues `classify-turn` job, returns `IngestionAck`
- `memory/ingestion.processJob()` — handles `classify-turn` and `embed-and-promote`; rule-based classification is acceptable; must write memory records with `graduation_status = 'confirmed'` for promotable content
- BullMQ worker: single process, single `memory-ingestion` queue, retry policy (3 attempts, exponential backoff: 1 s / 5 s / 15 s), dead-letter structured log on exhaustion
- `memory/retrieval` all eight pipeline stages as specified in architecture §7
- Stage 3 SQL query exactly as specified — must include scope predicate, must use `LIMIT` = `RETRIEVAL_TOP_N`
- Hard filters exactly in the order specified in architecture §7 Stage 4
- Scoring formula exactly as specified with normalized inputs
- Type-capped selection with exactly the caps specified (semantic: 2, episodic: 2, commitment: 1, self: 1)
- Post-selection bookkeeping enqueued as `bookkeeping` job (non-blocking)
- `bookkeeping` job handler: updates `last_accessed_at`, sets cooldown in Redis and `cooldown_until` in DB, increments `access_count`
- Per-intent retrieval cache TTL (task: 30 s, conversational: 60 s, emotional: 120 s)
- `deleteUserMemory()` — deletes all `memories` and `exchanges` records for the user, invalidates all Redis state for all known `(userId, personaId)` pairs; must be transactional where possible
- Each pipeline stage must emit a structured log entry with elapsed time in milliseconds

**May remain stubbed:**
- `pruneMemory()` — may enqueue a `prune-scope` job but the worker handler may be a no-op stub that logs and completes
- `summarizeSession()` — may enqueue a `summarize-session` job but the worker handler may be a no-op stub that logs and completes
- Rule-based classifier in `classify-turn` worker — does not need to be an LLM call; a deterministic rule that promotes non-empty assistant turns is acceptable for Phase 1

**Explicitly forbidden in this slice:**
- Any logic in `memory/service` beyond input shape validation, delegation, and return
- Multi-step orchestration or branching inside `memory/service`
- Domain validation in `memory/service` (that belongs in the owning module)
- Any direct database call from `memory/service`
- Any direct Redis call from `memory/service`
- Any direct embedding call from `memory/service`
- `exchanges` table access anywhere in the retrieval pipeline
- Working memory access anywhere in the retrieval pipeline
- Scoring applied before all hard filters have run
- Any filter skipped under any condition
- Filter order changed for any reason
- Scoring inputs used without normalization to [0, 1]
- Returning raw database row objects from any module
- Relaxing thresholds to produce a minimum result count
- `memory/lifecycle` or `memory/governors` modules created or referenced
- Commitment type memory promotion in the async worker
- ML ranking, neural re-ranking, or any learned scoring in the retrieval pipeline
- Personalization adjustments to scores or retrieval parameters
- Heuristic candidate set expansion — the candidate set is strictly the output of Stage 3; it must not be widened by any means
- Scoring formula extended with additional components or weights beyond the four defined in architecture §7 Stage 5
- Inline job processing in `memory/service` or `memory/ingestion.ingest()` — the queue is enqueue-only on the synchronous call path; workers run in a separate asynchronous process context
- Cross-module queue access — only `memory/ingestion` enqueues and processes `classify-turn` and `embed-and-promote` jobs; no other module may enqueue to or consume from the `memory-ingestion` queue directly
- Custom hand-rolled retry or backoff logic — BullMQ's built-in retry configuration is the only permitted retry mechanism

**Validation gate — S03 complete when:**
- [ ] `storeMemory()` called through `memory/service` writes a real record to `exchanges`, returns `exchange_id` and `queued: true`
- [ ] `storeMemory()` called when Redis/BullMQ is unavailable returns `queued: false` — the exchange record is still written
- [ ] `classify-turn` and `embed-and-promote` jobs execute end-to-end; a `confirmed` memory record with a real embedding vector appears in `memories`
- [ ] `retrieveMemories()` called through `memory/service` returns a `RetrievalResult` with correct shape
- [ ] Retrieval pipeline with no matching confirmed memories returns `{ memories: [], retrieved_at, cache_hit: false }` — no error
- [ ] Retrieval pipeline with at least one matching confirmed `semantic` memory returns it with a non-zero composite score
- [ ] Second call with identical context returns `cache_hit: true` within 50 ms
- [ ] Each pipeline stage emits a structured log entry with elapsed time
- [ ] Hard filter order is verified: a record that should be excluded by filter N is not present in filters N+1..6
- [ ] Type caps are enforced: no result set contains more than 2 semantic, 2 episodic, 1 commitment, or 1 self memories
- [ ] `updateMemory()` writes to `memories`, invalidates retrieval cache, returns `{ updated: true }`
- [ ] `deleteUserMemory()` removes all records for the user from both tables and all Redis keys
- [ ] No module other than `memory/cache` calls Redis directly
- [ ] No module other than `memory/embedding` calls an embedding provider
- [ ] No module other than `src/db/` executes raw SQL
- [ ] No module other than `src/config/` reads `process.env`
- [ ] `pruneMemory()` and `summarizeSession()` complete without error (stubs)
- [ ] Full pipeline latency is measurable end-to-end
- [ ] No inline job processing in the synchronous call path — service returns before any worker executes
- [ ] No custom retry logic present — BullMQ retry configuration is the only retry mechanism in use
- [ ] No ML scoring, heuristic expansion, or learned re-ranking present in any pipeline stage
- [ ] All Redis keys in the codebase are constructed exclusively inside `memory/cache` — no key string patterns appear elsewhere
- [ ] Every code path that writes to the `memories` table calls `invalidateRetrievalCache` before resolving

---

## 6. Required Module/Folder Structure

The following is the approved structure for Phase 1. Do not create folders or files outside this structure without an explicit scope change.

```
src/
├── config/
│   └── index.ts                  # Config type, env validation, singleton
│
├── db/
│   ├── client.ts                 # PostgreSQL client, pool setup
│   └── queries/
│       ├── memories.ts           # All SQL for memories table
│       └── exchanges.ts          # All SQL for exchanges table
│
├── queue/
│   ├── client.ts                 # BullMQ queue instance
│   └── worker.ts                 # Worker bootstrap, job router
│
└── memory/
    ├── models/
    │   └── index.ts              # All types, enums, interfaces
    │
    ├── service/
    │   └── index.ts              # MemoryService implementation
    │
    ├── retrieval/
    │   └── index.ts              # RetrievalModule, full pipeline
    │
    ├── ingestion/
    │   └── index.ts              # IngestionModule, ingest(), processJob()
    │
    ├── embedding/
    │   ├── index.ts              # EmbeddingModule, embed()
    │   └── adapters/
    │       ├── openrouter.ts     # OpenRouterEmbeddingAdapter
    │       └── nanogpt.ts        # NanoGPTEmbeddingAdapter
    │
    └── cache/
        └── index.ts              # CacheModule, all Redis operations

db/
└── migrations/
    └── 001_initial_schema.sql    # memories + exchanges tables, indexes, pgvector

```

**Rules:**
- No file may be created outside this structure in Phase 1
- `memory/lifecycle/` must not exist
- `memory/governors/` must not exist
- `src/memory/models/` must not import from any other module in `src/`
- Query logic must live in `src/db/queries/` — SQL must not appear in module files
- The worker job router must live in `src/queue/worker.ts` — job handler implementations may call into `memory/ingestion`

---

## 7. Interface Contract Requirements

The following interfaces must exist and be stable before builders implement deeper logic. These are the contracts that modules are built against. They must not change shape after S01 is complete unless a formal scope change has been approved.

---

### `memory/models` — All required types

Must export all of the following before any other module is built:

```
MemoryType             'semantic' | 'episodic' | 'self' | 'commitment'
MemoryStatus           'active' | 'superseded' | 'corrected'
GraduationStatus       'observation' | 'candidate' | 'confirmed'
ConfidenceLevel        'explicit' | 'inferred'
VolatilityLevel        'factual' | 'subjective'
IntentType             'task' | 'conversational' | 'emotional'

Memory                 Full DB record shape (mirrors memories table columns)
Exchange               Full DB record shape (mirrors exchanges table columns)
ExchangeTurn           Subset for working memory: { role, content, created_at }
EmbeddingVector        number[] — length must match provider modelDimensions

StoreMemoryInput       { internal_user_id, persona_id, session_id, role, content, metadata? }
StoreMemoryResult      { exchange_id: string, queued: boolean }

RetrievalContext       { internal_user_id, persona_id, query_text, intent_type?, session_id? }
RetrievalResult        { memories: MemoryObject[], retrieved_at: string, cache_hit: boolean }
MemoryObject           { id, memory_type, content, importance, confidence, volatility, score, created_at, last_accessed_at }

UpdateMemoryInput      { memory_id, internal_user_id, persona_id, feedback?, inhibit? }
UpdateMemoryResult     { memory_id: string, updated: boolean }

PruneScope             { internal_user_id: string, persona_id: string }

IngestionInput         { internal_user_id, persona_id, session_id, role, content, metadata? }
IngestionAck           { exchange_id: string, queued: boolean }

RetrievalCacheKey      { userId: string, personaId: string, embeddingHash: string, intentType: IntentType }

IngestionJobType       'classify-turn' | 'embed-and-promote' | 'prune-scope' | 'summarize-session' | 'bookkeeping'
```

No internal database metadata (`graduation_status`, `strength`, `cooldown_until`, `inhibited`, `lineage_parent_id`) may appear in `MemoryObject`. These fields exist on the `Memory` type for internal module use only.

---

### `memory/service` — Public interface

```
storeMemory(input: StoreMemoryInput): Promise<StoreMemoryResult>
retrieveMemories(context: RetrievalContext): Promise<RetrievalResult>
updateMemory(input: UpdateMemoryInput): Promise<UpdateMemoryResult>
pruneMemory(scope: PruneScope): Promise<void>
deleteUserMemory(userId: string): Promise<void>
summarizeSession(sessionId: string): Promise<void>
```

**`memory/service` is orchestration only.** It routes calls from external consumers to their owning internal modules. It does not implement feature logic, execute queries, access infrastructure, or transform results.

**Permitted within this interface:**
- Input shape validation (required fields, type guards only — no domain validation)
- Delegation to exactly one owning internal module per method
- Return of that module's result, unchanged

**Strictly not permitted:**
- Any SQL query or database interaction
- Any Redis interaction
- Any call to an embedding provider, directly or indirectly
- Any retrieval logic of any kind
- Any ingestion logic of any kind
- Any scoring, filtering, or ranking
- Business logic of any kind
- Conditional branching that spans multiple internal modules
- Transforming, augmenting, or reshaping results before returning them to the caller
- Helper methods that execute logic on behalf of multiple service methods

If a builder finds themselves adding logic to `memory/service` that is not on the permitted list, that logic belongs in the owning module — not here.

---

### `memory/retrieval` — Internal interface

```
execute(context: RetrievalContext): Promise<RetrievalResult>
```

Callers: `memory/service` only. Must execute all eight stages in order. Must not be called from any other module.

---

### `memory/ingestion` — Internal interface

```
ingest(input: IngestionInput): Promise<IngestionAck>
processJob(job: IngestionJob): Promise<void>
```

`ingest()` callers: `memory/service` only.
`processJob()` callers: BullMQ worker only.

---

### `memory/embedding` — Internal interface

```
embed(text: string, sessionId?: string): Promise<EmbeddingVector>
```

Callers: `memory/retrieval` and `memory/ingestion` only. Must not be called from any other module.

**All embedding generation in the system must go through this module.** There is no legitimate path by which any other module generates, requests, or constructs an embedding vector except by calling `embed()`. No module may reference provider API shapes, construct provider request objects, or read embedding model identifiers outside of `memory/embedding`. This rule has no exceptions.

Provider adapter interface (internal to `memory/embedding`):
```
generate(text: string): Promise<EmbeddingVector>
modelDimensions: number   (readonly)
providerId: string        (readonly)
```

---

### `memory/cache` — Internal interface

```
pushWorkingMemoryTurn(userId, personaId, turn): Promise<void>
getWorkingMemory(userId, personaId): Promise<ExchangeTurn[]>

setCooldown(memoryId, durationMs): Promise<void>
isOnCooldown(memoryId): Promise<boolean>

getRetrievalCache(key: RetrievalCacheKey): Promise<RetrievalResult | null>
setRetrievalCache(key, result, ttlMs): Promise<void>
invalidateRetrievalCache(userId, personaId): Promise<void>

getEmbedding(textHash: string): Promise<EmbeddingVector | null>
setEmbedding(textHash, vector, ttlMs): Promise<void>
```

Callers: `memory/retrieval` (cache, cooldown, embedding), `memory/ingestion` (embedding, retrieval cache invalidation), `memory/service` (via `updateMemory` and `deleteUserMemory`). `pushWorkingMemoryTurn` and `getWorkingMemory` are never called from the retrieval pipeline.

---

## 8. Data Layer Contract

### PostgreSQL Schema

Both tables must be deployed exactly as specified in architecture §4 before any code that queries them is written. No schema deviation is permitted.

**Critical constraints builders must enforce:**
- `vector(1536)` column dimension must match `EmbeddingProviderAdapter.modelDimensions` at deployment time
- If the embedding model changes, a migration is required — no runtime dimension mismatch is permitted
- The HNSW index must be created with `m = 16, ef_construction = 64`
- The scope index must include `(internal_user_id, persona_id, status, graduation_status)` — no reordering
- The cooldown partial index must use `WHERE cooldown_until IS NOT NULL`
- No column may be added to `memories` or `exchanges` in Phase 1 that is not listed in the schema

**Query constraint (enforced by code review):**
Every query against `memories` in the retrieval pipeline must include `WHERE internal_user_id = $1 AND persona_id = $2`. Any query without this predicate is a boundary violation.

### pgvector Requirements

- Extension must be enabled before the migration runs: `CREATE EXTENSION IF NOT EXISTS vector;`
- Vector distance operator in Stage 3 query: `<->` (L2 distance) — do not substitute cosine operators in the candidate fetch; cosine similarity is computed separately for the scoring and threshold steps
- HNSW index is used only for approximate nearest-neighbor candidate selection (Stage 3); exact similarity computation happens in application code for subsequent stages

### Redis Key Patterns

All keys must match the exact patterns specified in architecture §3.5. No variation.

| Purpose | Key Pattern | TTL |
|---|---|---|
| Working memory | `working:{userId}:{personaId}` | 1800 s (reset on push) |
| Cooldown | `cooldown:{memoryId}` | Configurable (`COOLDOWN_DURATION_SECONDS`) |
| Retrieval cache | `rcache:{sha256(userId+personaId+embeddingHash+intentType)}` | Per-intent type |
| Embedding cache | `emb:{sha256(normalizedText)}` | `EMBEDDING_CACHE_TTL_SECONDS` |

`invalidateRetrievalCache(userId, personaId)` must delete all keys matching `rcache:*` for that scope. Pattern scan must not be unbounded — implement with Redis `SCAN` + `DEL`, not `KEYS`.

**No ad hoc key naming is permitted.** Redis keys must be assembled exclusively inside `memory/cache` using the exact patterns defined above. No other module may construct, compose, or reference a Redis key string. Call sites pass typed parameters; `memory/cache` builds the key internally. The string patterns `working:`, `cooldown:`, `rcache:`, and `emb:` must not appear in any file outside `memory/cache`.

**Cache invalidation is mandatory on every write.** Any operation that creates, updates, or deletes a `memories` record for a given `(userId, personaId)` scope must call `invalidateRetrievalCache(userId, personaId)` before the operation resolves. This applies to: memory creation, memory update (feedback, inhibition), memory deletion, and async promotion in the ingestion pipeline. Deferring or omitting invalidation for performance reasons is not permitted — it is an architectural violation.

### Migration Expectations

- Exactly one migration file for Phase 1: `001_initial_schema.sql`
- Migration must be idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)
- Migration must run as part of application startup or as a separate deployment step — both are acceptable, but the approach must be consistent and documented in `src/db/`
- No ORM-generated migrations — SQL is written by hand, reviewed against the schema spec

---

## 9. Configuration Contract

### Required Environment Variables — Phase 1

The following variables are required. Process must exit with a descriptive error if any are absent or invalid. No defaults are applied for required values.

| Variable | Required | Validation |
|---|---|---|
| `DATABASE_URL` | Yes | Non-empty string, must begin with `postgres://` or `postgresql://` |
| `REDIS_URL` | Yes | Non-empty string, must begin with `redis://` or `rediss://` |
| `EMBEDDING_PROVIDER` | Yes | Must be exactly `openrouter` or `nanogpt` |
| `EMBEDDING_MODEL` | Yes | Non-empty string |
| `OPENROUTER_API_KEY` | Yes if `EMBEDDING_PROVIDER=openrouter` | Non-empty string |
| `NANOGPT_API_KEY` | Yes if `EMBEDDING_PROVIDER=nanogpt` | Non-empty string |

### Optional Variables with Defaults — Phase 1

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_POOL_SIZE` | `10` | Must be a positive integer |
| `EMBEDDING_CACHE_TTL_SECONDS` | `300` | Must be a positive integer |
| `RETRIEVAL_TOP_N` | `20` | Must be a positive integer |
| `SIMILARITY_THRESHOLD_SEMANTIC` | `0.75` | Must be a float in (0, 1) |
| `SIMILARITY_THRESHOLD_EPISODIC` | `0.70` | Must be a float in (0, 1) |
| `SIMILARITY_THRESHOLD_SELF` | `0.72` | Must be a float in (0, 1) |
| `SIMILARITY_THRESHOLD_COMMITMENT` | `0.60` | Must be a float in (0, 1) |
| `RETRIEVAL_CACHE_TTL_TASK` | `30` | Must be a positive integer |
| `RETRIEVAL_CACHE_TTL_CONV` | `60` | Must be a positive integer |
| `RETRIEVAL_CACHE_TTL_EMOTIONAL` | `120` | Must be a positive integer |
| `COOLDOWN_DURATION_SECONDS` | `300` | Must be a positive integer |
| `WORKING_MEMORY_MAX_TURNS` | `10` | Must be a positive integer |
| `WORKING_MEMORY_TTL_SECONDS` | `1800` | Must be a positive integer |
| `EXCHANGE_RETENTION_DAYS` | `90` | Must be a positive integer |
| `LOG_LEVEL` | `info` | Must be one of: `debug`, `info`, `warn`, `error` |

### Configuration Access Rules

- `Config` is a typed singleton created once at startup
- No module reads `process.env` — all modules receive config via constructor injection or by importing the `Config` singleton
- The `Config` object is the only place where environment variable names appear as string literals
- Provider credential keys (`OPENROUTER_API_KEY`, `NANOGPT_API_KEY`) are only ever read within `memory/embedding` — they must not appear anywhere else in the codebase as string references

---

## 10. Stubbing Rules

When a capability is not yet implemented in Phase 1, it must be stubbed in a way that:
1. Respects the interface contract (correct return type)
2. Does not throw or error
3. Emits a structured log entry indicating the stub was invoked
4. Does not silently do nothing — the log is required

**Approved Phase 1 stubs:**

| Method / Handler | Stub Behavior |
|---|---|
| `pruneMemory()` | Enqueues `prune-scope` job; returns void |
| `summarizeSession()` | Enqueues `summarize-session` job; returns void |
| `prune-scope` job handler | Logs `{ jobType: 'prune-scope', status: 'stub', scope }` and completes |
| `summarize-session` job handler | Logs `{ jobType: 'summarize-session', status: 'stub', sessionId }` and completes |
| Confidence gate (filter 5) | Passes all records; logs filter was applied with 0 exclusions |
| Intent alignment (filter 6) | Excludes `commitment` type only; passes all others |
| `IntentAlignmentBias` | Constant 0.0 — not added to score formula |

**Rules for stubbing:**
- A stub must satisfy the TypeScript interface exactly; it must not use `any` to bypass the type contract
- A stub must not be written in a way that would interfere with the real implementation replacing it — no persistent state, no side effects beyond the required log entry
- A stub must not silently return incorrect data — an empty array is a correct stub response; a fabricated or partially-constructed result is not
- A stub must not create an alternate code path that diverges from the approved architecture. When the real implementation replaces the stub body, no surrounding call structure, import, or routing logic should need to change
- A stub must not import from modules or systems that the real implementation would not use
- A stub must not bypass or short-circuit any architectural boundary. A stub that calls Redis directly, reads from the database, or calls a provider is not a stub — it is a boundary violation regardless of intent
- Stubs are not placeholders for later design decisions; every decision is already made. A stub is a deferred *implementation* only, not a deferred *decision*

---

## 11. Boundary Enforcement Rules

These rules are non-negotiable. Violation of any of these rules constitutes an architectural drift event. The implementation must be corrected before proceeding.

**Module boundary rules:**

1. No external caller may bypass `memory/service`. There is no legitimate reason to call `memory/retrieval`, `memory/ingestion`, `memory/embedding`, or `memory/cache` directly from outside the `src/memory/` tree.

2. `memory/service` must not contain business logic. If logic appears in `memory/service` that is not input shape validation or delegation, it belongs in the owning module.

3. `memory/models` must not import from any other module in `src/`. If it does, the dependency is inverted.

4. `memory/cache` must not execute any SQL. It must never import from `src/db/`.

5. `memory/embedding` must not write embeddings to the database. Embedding vectors are generated here and returned — persistence is the caller's responsibility.

6. `memory/retrieval` must not read from `exchanges`. Any reference to the `exchanges` table in retrieval code is a boundary violation.

7. `memory/retrieval` must not read working memory from Redis. Any call to `pushWorkingMemoryTurn` or `getWorkingMemory` from within the retrieval pipeline is a boundary violation.

8. **All embedding generation in the system must go through `memory/embedding`.** No module may call an embedding provider adapter directly, reference provider API shapes, read provider credential config keys, or construct provider request objects. The `EmbeddingProviderAdapter` implementations are fully private to `memory/embedding` and must not be imported, referenced, or instantiated by any other module under any circumstances. If a module needs an embedding vector, it calls `embed()`. There is no other path.

9. No module other than `src/db/queries/` may contain SQL strings.

10. No module other than `src/config/` may contain `process.env` references.

**Forbidden shortcuts:**

- Do not use `(db as any)` or type assertions to bypass module boundaries
- Do not pass a database client into a module that is not `src/db/`
- Do not pass a Redis client into a module that is not `memory/cache`
- Do not return database row objects directly from any module — map to the defined types
- Do not hardcode any threshold, TTL, or dimension value — all must come from `Config`
- Do not add a helper function to `memory/service` to "share logic" across methods — each method delegates to its owner
- Do not add `memory/lifecycle` or `memory/governors` stubs "for future use" — these modules must not exist until their phase

**Forbidden imports (Phase 1):**

- `memory/retrieval` must not import from `memory/ingestion`
- `memory/ingestion` must not import from `memory/retrieval`
- `memory/cache` must not import from `memory/retrieval`, `memory/ingestion`, or `memory/embedding`
- `memory/embedding` must not import from `memory/retrieval`, `memory/ingestion`, or `memory/cache` (embedding module calls cache module via its injected interface, but does not depend on cache module's internals)
- `src/db/` must not import from any `memory/` module

**The exclusive call path rule:** Every inter-module interaction must go through the defined public interface of the receiving module. Reaching into a module's internal implementation — by importing a private class, adapter, helper function, or internal type not exported by the module's public interface — is a boundary violation regardless of whether TypeScript permits the import. The fact that an import compiles does not make it architecturally valid.

---

## 12. Validation Gates

Each slice must pass its gate in full before the next slice begins. Gates are listed here as a consolidated reference.

### S01 Gate — Foundation

- [ ] All types from `memory/models` compile without errors, no `any` escapes
- [ ] `Config` singleton loads and exposes all variables with correct TypeScript types
- [ ] Startup fails with a descriptive, named error for each missing required variable
- [ ] `process.env` references exist only in `src/config/`
- [ ] Migration runs against a real PostgreSQL + pgvector instance without errors
- [ ] `memories` table exists with all columns, check constraints, and three indexes
- [ ] `exchanges` table exists with all columns, constraints, and three indexes
- [ ] `vector(1536)` column is present and queryable
- [ ] No modules outside `src/memory/models/` and `src/config/` exist
- [ ] No Redis connection is attempted anywhere in S01 deliverables
- [ ] No external network call is made anywhere in S01 deliverables

### S02 Gate — Cache and Embedding

- [ ] All eight `CacheModule` methods tested against real Redis — correct behavior for all paths including TTL expiry and cache miss
- [ ] Redis key patterns match the schema exactly — no deviation
- [ ] `invalidateRetrievalCache` uses `SCAN` + `DEL`, not `KEYS *`
- [ ] `EmbeddingModule.embed()` returns cached vector on second call — provider is not called
- [ ] `EmbeddingModule.embed()` calls provider and writes to cache on miss
- [ ] Embedding dimension matches `modelDimensions` from the active adapter
- [ ] Active adapter is selected from `EMBEDDING_PROVIDER` config only — no hardcoding
- [ ] No `process.env` read outside `src/config/`
- [ ] No credential keys referenced outside `memory/embedding`
- [ ] Only `memory/cache` calls Redis
- [ ] Redis connection failure at startup produces a descriptive error and halts initialization — it does not proceed with a degraded state
- [ ] Provider API failure on `embed()` surfaces as a thrown, typed error — it does not return a partial or zero-length vector
- [ ] No SQL strings present anywhere in S02 deliverables
- [ ] No provider-specific types or API shapes referenced outside `src/memory/embedding/adapters/`

### S03 Gate — Full Path

- [ ] `storeMemory()` through `memory/service` writes to `exchanges`, returns correct shape
- [ ] `queued: false` returned when Redis/BullMQ unavailable, exchange record still written
- [ ] Async worker runs `classify-turn` → `embed-and-promote`; confirmed memory record with real embedding appears in `memories`
- [ ] `retrieveMemories()` through `memory/service` returns `RetrievalResult` with correct shape
- [ ] Zero matching memories returns `{ memories: [], cache_hit: false }` — no error
- [ ] At least one confirmed semantic memory is correctly returned with a non-zero composite score
- [ ] Second retrieval call with identical context returns `cache_hit: true`, latency < 50 ms
- [ ] Each pipeline stage emits a structured log with elapsed time
- [ ] Hard filter sequence verified — records excluded by filter N are absent from stages N+1 onward
- [ ] Type caps enforced — no overcount in any type
- [ ] Scoring uses normalized inputs only — unnormalized values do not enter the formula
- [ ] `updateMemory()` writes to DB, invalidates cache, returns correct shape
- [ ] `deleteUserMemory()` removes all records from both tables and all Redis keys for the user
- [ ] `pruneMemory()` and `summarizeSession()` complete without error; worker logs stub invocation
- [ ] No SQL outside `src/db/queries/`
- [ ] No Redis calls outside `memory/cache`
- [ ] No embedding provider calls outside `memory/embedding`
- [ ] No `memory/lifecycle` or `memory/governors` module exists
- [ ] No `exchanges` table access in any retrieval code path
- [ ] No working memory calls in any retrieval code path
- [ ] No inline job processing in the synchronous call path — service returns before any worker executes
- [ ] No custom retry logic present — BullMQ retry configuration is the only retry mechanism in use
- [ ] No ML scoring, heuristic expansion, or learned re-ranking present in any pipeline stage
- [ ] All Redis keys in the codebase are constructed exclusively inside `memory/cache` — no key string patterns appear elsewhere
- [ ] Every code path that writes to the `memories` table calls `invalidateRetrievalCache` before resolving

---

## 13. Builder Warnings / Common Failure Modes

These are the most likely ways this implementation will go wrong. Address them before they happen.

---

**1. Logic leaking into `memory/service`.**
The most common failure. A builder will write `if (!input.internal_user_id) throw new Error(...)` in `memory/service` and call it "validation." Then they will add a small lookup. Then a default. Then a conditional delegation. By S03 the service has become a miniature god object. Validation in `memory/service` means checking that required fields are present and are the correct primitive type. Nothing else. Domain validation belongs in the module that owns the domain.

**2. Skipping pipeline stages "because they pass all records in Phase 1."**
The confidence gate and intent alignment filter pass all records (or nearly all) in Phase 1 by design. Builders will omit these stages entirely. Do not do this. All eight stages must execute. Passing all records is a legitimate output of a real stage. A missing stage is an architectural gap that will require rework in Phase 2.

**3. Applying scoring before all filters have run.**
A builder will see the scoring formula and begin applying it to records during or after Stage 3 for efficiency. Scoring must not run until all six hard filters have completed. The filter sequence exists to reduce the candidate set; scoring an unfiltered candidate set wastes compute and may produce incorrect type-cap selection.

**4. Using unnormalized inputs in the scoring formula.**
Recency is computed as `1 / (1 + days_since_last_access)`. Without bounding, a record with `last_accessed_at = NULL` (never accessed) will crash or produce `NaN`. All four scoring inputs must be normalized to [0, 1] before the formula is applied. Null `last_accessed_at` must be handled explicitly.

**5. Reading `exchanges` data in the retrieval path.**
A builder will be tempted to use recent exchange history to augment retrieval context. This is explicitly prohibited. The `exchanges` table is not in scope for retrieval at any phase. The only data source for the retrieval pipeline is the `memories` table.

**6. Using `KEYS *` to implement cache invalidation.**
`KEYS *` blocks Redis and is unsafe in production. `invalidateRetrievalCache` must use `SCAN` with a cursor loop. Builder will use `KEYS` because it is simpler. It must not.

**7. Letting the embedding dimension be a magic number.**
If `vector(1536)` is hardcoded in the migration SQL without a reference to the adapter's `modelDimensions`, and the provider model is later changed, the dimension mismatch will produce silent or corrupt embeddings. The dimension in the migration must be documented as tied to `modelDimensions`. If the model changes, a migration is required.

**8. Blocking `storeMemory()` on async work.**
The async worker produces embeddings; `storeMemory()` must return after the `exchanges` write. If a builder awaits the embedding generation or classification inside `ingest()`, they have broken the ingestion contract. `ingest()` enqueues and returns. The worker runs separately.

**9. Returning raw database rows.**
A builder will return the result of a database query directly from a module method. This introduces database column names, types, and null patterns into the module interface. Every module must map database results to the defined types before returning.

**10. Creating `memory/lifecycle` or `memory/governors` stubs "for later."**
These modules do not exist in Phase 1. Creating them as empty stubs with placeholder exports establishes a file that builders will start adding things to before their phase begins. If the module should not exist, the directory must not exist.

**11. Hardcoding thresholds, TTLs, or dimensions.**
Every numeric constant in the retrieval pipeline must come from `Config`. A builder will hardcode `0.75` as the similarity threshold because "it matches the default." When config changes, the hardcoded value diverges silently. Use `config.similarityThresholds[memoryType]`.

**12. Writing SQL inside module files.**
SQL belongs in `src/db/queries/`. A builder will write a quick inline query inside `memory/retrieval` to "keep things together." This is a boundary violation. Module files may not contain SQL strings.

---

## 14. Recommended Next Prompt

The next builder prompt should be targeted at **S01 only**. It must not reference S02, S03, or any behavior beyond what S01 requires.

The prompt should instruct the builder to:

1. Implement `src/memory/models/index.ts` with all types, enums, and interfaces as defined in §7 of this document
2. Implement `src/config/index.ts` as a typed singleton with startup validation of all variables in §9 of this document
3. Author `db/migrations/001_initial_schema.sql` for the `memories` and `exchanges` tables with all columns, constraints, and indexes as specified in architecture §4
4. Verify the S01 validation gate in §12 of this document, item by item
5. Stop at the S01 gate — do not begin S02 work

The prompt must explicitly reference this document (`IMPL-ImplementationContract.md`) and architecture (`ARCH-SystemArchitecture.md`) as the only authoritative sources. It must direct the builder not to invent types, not to add fields, and not to expand scope.

---

*End of Implementation Contract Document. No implementation begins until this document has been reviewed and accepted.*
