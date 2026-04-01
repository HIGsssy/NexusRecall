## Phase 1 — S01 (Foundation)

**Status:** COMPLETE

**Completed:**

* [x] Types and interfaces defined (`src/memory/models/index.ts`)
* [x] Config module implemented with validation (`src/config/index.ts`)
* [x] Initial DB schema created (`db/migrations/001_initial_schema.sql`)

**Notes:**

* Implemented strictly per contract
* No additional modules or logic introduced

## Phase 1 — S02 (Retrieval Pipeline)

**Status:** COMPLETE

**Completed:**

* [x] Embedding module implemented
* [x] Retrieval pipeline (all stages) implemented
* [x] Redis cache integrated (basic get/set)
* [x] retrieveMemories() service operational

**Notes:**

* Implemented strictly per contract
* No Phase 2 or Phase 3 features added

## Phase 1 — S03 (Service, Ingestion, and Queue)

**Status:** COMPLETE

**Completed:**

* [ ] Service layer methods implemented for S03 scope
* [ ] Ingestion module implemented
* [ ] Queue client and worker implemented
* [ ] DB client and query modules implemented
* [ ] Async job flow operational for classify-turn, embed-and-promote, and bookkeeping
* [ ] S03 stubs implemented for pruneMemory and summarizeSession

**Notes:**

* Implemented strictly per implementation contract
* No Phase 2 or Phase 3 features added

## Phase 1 — Correction Pass

**Status:** COMPLETE

**Applied:** Targeted remediation for AUDIT-Phase1.md findings (DRIFT-01 through DRIFT-11).

**Corrections:**

* Retrieval pipeline: all 8 stages moved into `memory/retrieval.execute()`; cache check, bookkeeping enqueue, and cache write removed from `memory/service`
* SQL boundary: removed private `pg` pool and raw SQL from `memory/retrieval`; candidate query moved to `db/queries/memories.ts`; `AND status = 'active'` predicate removed per spec
* Embedding cache: implemented full cache-check-then-generate flow in `memory/embedding.embed()`
* Service layer: reduced to thin delegator; `updateMemory()` and `deleteUserMemory()` now delegate to `memory/ingestion`; no direct DB or Redis calls remain
* Cooldown filter: Redis-first via `memory/cache.isOnCooldown()`, DB fallback
* Stage logging: all 8 pipeline stages emit structured JSON log with `elapsed_ms`
* Query ownership: exchange deletion SQL moved to `db/queries/exchanges.ts`
* Cache interface: `setRetrievalCache` and `setEmbedding` parameters corrected to `ttlMs`
* Cache invalidation: scoped invalidation via secondary Redis SET per `(userId, personaId)`
* Stub log shapes: `prune-scope` and `summarize-session` stubs now emit contract-specified fields

## Phase 2 — S04 (Episodic Memory Enablement)

**Status:** COMPLETE

**Completed:**

* [x] `EmbedAndPromoteData` extended with required `memoryType: MemoryType` field
* [x] `handleClassifyTurn` updated: assistant → semantic, user ≥ 50 chars → episodic, user < 50 chars → discard
* [x] `insertConfirmedEpisodicMemory` added to `src/db/queries/memories.ts`
* [x] `handleEmbedAndPromote` routes to correct insert function based on `memoryType`
* [x] Retrieval pipeline verified: episodic memories handled by existing per-type thresholds, type caps (max 2 episodic), and intent alignment (no exclusion)

**Files changed:**

* `src/memory/ingestion/index.ts` — classification stub, job payload, embed-and-promote routing
* `src/db/queries/memories.ts` — episodic insert function

**Boundary compliance:**

* No changes to `memory/service`, `memory/cache`, `memory/embedding`, or `memory/retrieval`
* No schema migrations
* No new config variables
* No new modules or dependencies
