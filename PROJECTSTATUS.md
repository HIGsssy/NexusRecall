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

## Phase 2 — S05 (Classification Upgrade)

**Status:** COMPLETE

**Completed:**

* [x] `MemoryType` extended with `'commitment'` type
* [x] `MemoryStatus` extended with `'superseded'` and `'corrected'` states
* [x] `GraduationStatus` type added: `'observation' | 'candidate' | 'confirmed'`
* [x] `IntentType` type added: `'task' | 'conversational' | 'emotional'`
* [x] `Memory` interface updated with `lineage_parent_id` and `inhibited` fields
* [x] Classification logic upgraded in `classify()` — role-based routing with length thresholds

**Files changed:**

* `src/memory/models/index.ts` — new types and interface fields
* `src/memory/ingestion/index.ts` — classification routing

## Phase 2 — S06 (Contradiction Detection + Lineage)

**Status:** COMPLETE

**Completed:**

* [x] `CONTRADICTION_ELIGIBLE_TYPES` constant: only `semantic` and `self` are eligible
* [x] `cosineSimilarity()` and `parseVector()` helpers for vector comparison
* [x] `findContradictionCandidates()` query — fetches active confirmed memories by type with embeddings
* [x] `markSuperseded()` query — sets `status = 'superseded'` on contradicted memories
* [x] `insertConfirmedMemory()` accepts optional `lineageParentId` for correction lineage tracking
* [x] Contradiction detection integrated into embed-and-promote flow

**Files changed:**

* `src/memory/ingestion/index.ts` — contradiction detection logic, eligible types, vector math
* `src/db/queries/memories.ts` — `findContradictionCandidates`, `markSuperseded`, lineage parameter

**Boundary compliance:**

* No changes to `memory/service`, `memory/cache`, `memory/embedding`, or `memory/retrieval`
* No schema migrations

## Phase 2 — S07 (Commitment Detection)

**Status:** COMPLETE — AUDITED PASS

**Completed:**

* [x] `COMMITMENT_PATTERNS` — 19 explicit acceptance phrases (e.g. "i will ", "i promise", "i commit to")
* [x] `COMMITMENT_EXCLUSION_PATTERNS` — 14 hedged/ambiguous phrases filtered out (e.g. "i'll try", "maybe")
* [x] `isCommitment()` helper — pattern matching with exclusion and question guard
* [x] Commitment branch in `classify()` — returns `memoryType: 'commitment'`, `importance: 0.8`, `confidence: 'explicit'`, `volatility: 'factual'`
* [x] Commitment check placed before self-referential check (commitment takes precedence)
* [x] Commitments excluded from contradiction detection (`CONTRADICTION_ELIGIBLE_TYPES`)
* [x] Retrieval Filter 6 upgraded — `intentType` parameter added to `hardFilter()`
* [x] Per-intent alignment rules: `task` passes all types; `conversational`/`emotional` exclude commitment
* [x] Type cap for commitment: max 1 per retrieval

**Files changed:**

* `src/memory/ingestion/index.ts` — commitment patterns, exclusion patterns, `isCommitment()`, classify branch
* `src/memory/retrieval/index.ts` — Filter 6 intent alignment with `intentType` parameter

**Boundary compliance:**

* `volatility` correctly set to `'factual'` (not unauthorized `'behavioral'`)
* `VolatilityLevel` type unchanged: `'factual' | 'subjective'`
* No schema migrations
* No new config variables (except `SIMILARITY_THRESHOLD_COMMITMENT` added via config)
