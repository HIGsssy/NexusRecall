# Nexus Recall Memory Platform — Implementation Planning Document

**Version:** 1.1
**Date:** April 1, 2026
**Status:** Pre-Architecture Draft
**Runtime:** TypeScript / Node.js

---

## 1. Planning Summary

### What Is Being Built

Nexus Recall is a standalone memory platform. Its purpose is to store, retrieve, and maintain structured memories scoped to `(internal_user_id, persona_id)` pairs, and to expose those capabilities through a disciplined public service interface. It is not a bot, not a chat engine, and not a product that converses with users. It is infrastructure.

### First Implementation Target

The first target is a working retrieval-and-storage path: semantic memory only, scoped query execution, Redis working memory buffer, and a verified public service interface. The goal is to prove service isolation, end-to-end latency, and correct scoped query behavior *before* adding memory types, ingestion complexity, or behavioral governors.

### What This Plan Is Trying to Protect

Three things:

1. **Service boundary integrity.** The memory platform must not have its logic externalized into clients. The plan explicitly defines what belongs inside, what belongs outside, and where leakage is most likely to occur.
2. **Retrieval discipline.** The platform's value is not in how much it recalls — it is in how correctly it recalls. The scoring and filtering pipeline must be implemented as a formal stage sequence, not as ad hoc logic grafted into retrieval.
3. **Ordered construction.** Many of the platform's capabilities are interdependent in non-obvious ways. Building them out of sequence — particularly ingestion before retrieval is proven, or governors before memory types are stable — creates expensive rework. The build sequence is a first-class concern.

---

## 2. Product Boundary and System Role

### What the Memory Platform Is

A service that:

- Accepts memory ingestion requests from authorized clients
- Stores memories as structured, vector-indexed records scoped to `(internal_user_id, persona_id)`
- Retrieves a scored, filtered, ranked subset of memories in response to a retrieval context
- Maintains working memory state in Redis for active sessions
- Manages the lifecycle of memories over time (promotion, decay, lineage, pruning) via background processes
- Exposes a stable, narrow public interface that external systems must use exclusively

### What the Memory Platform Is Not

- It is not a chat engine. It does not generate responses.
- It is not a Discord bot or web app. Those are consumers.
- It is not responsible for prompt construction. `retrieveMemories()` returns structured, typed memory objects only. The chat engine is solely responsible for formatting those objects into prompt text.
- It is not responsible for deciding whether to respond to a user. That is client logic.
- It is not responsible for model invocation, token counting, or streaming.
- It is not responsible for intent classification. Intent type is determined by the caller (chat engine) and passed as an input parameter.

### Who Its Clients Are

At v1: a Discord bot (via chat engine) and a web application (via chat engine). Future clients are possible. All clients have identical standing — they are external consumers of the service interface. No client gets privileged access to internal components.

### Responsibilities: Inside vs. Outside the Memory Platform

**Inside the memory platform:**
- Vector embedding of user input and memory content
- Scoped candidate retrieval from PostgreSQL
- Hard filtering (similarity threshold, inhibition, cooldown, intent alignment, confidence gating)
- Memory scoring
- Memory selection (type-capped result set)
- Cooldown tracking (Redis)
- Retrieval cache (Redis, in-scope TTL management)
- Ingestion pipeline (observation → candidate → confirmed)
- Commitment detection
- Contradiction resolution and lineage management
- Memory decay, merging, pruning (async)
- Confidence and governor logic

**Outside the memory platform (belongs to chat engine or adapter):**
- Deciding when to call `retrieveMemories()`
- Classifying intent type (task / conversational / emotional) and passing it as a parameter to `retrieveMemories()`
- Formatting the final prompt sent to the language model
- Handling model responses
- User-facing conversation flow
- Session management (beyond the working memory buffer the platform maintains)
- Any re-scoring or re-filtering of memories after they have been returned

**The hard rule:** If a client finds itself needing to add filtering logic, scoring logic, or embedding logic to the memories it receives, then the memory platform is not doing its job. The output of `retrieveMemories()` must be structured, ordered memory objects suitable for client-side prompt assembly — never prompt text, never raw database rows.

---

## 3. High-Level Implementation Strategy

### Sequencing Principle

Build the critical retrieval path first, prove it works correctly, then add memory types, then add behavioral complexity. Never build downstream complexity before upstream foundations are validated.

The failure mode to avoid: building ingestion logic, commitment detection, or governor systems before the retrieval pipeline is stable. Those systems are only valuable once retrieval is known to behave correctly. Premature construction of governors or classifiers creates technical debt with no return on investment until the foundation works.

### Keeping the System Usable While Incomplete

The public service interface should be defined and stable from Phase 1. Subsequent phases add capabilities *behind the same interface*, not by changing it. A client that can call `storeMemory()` and `retrieveMemories()` in Phase 1 should not need to change its call pattern in Phase 3.

Use graceful empty returns: if a capability is not yet implemented (e.g., episodic memory), `retrieveMemories()` should return an empty set for that type rather than throwing. The "do-nothing protocol" from the scope validates this approach — zero memory is a valid and expected outcome.

### Avoiding Wrong Abstractions Early

Do not build a generalized memory type registry, a plugin system for governors, or a configurable pipeline engine in early phases. Those abstractions are expensive to design correctly and will only be informed by actual implementation experience.

Build the semantic memory path concretely. When episodic memory is added in Phase 2, the patterns for handling additional types will be clear from lived implementation. Extract abstractions only after two concrete instances exist.

### Cost Awareness Discipline

Embedding generation is expensive. The plan must require that embeddings are never generated redundantly. Cache embeddings per session (Redis, short TTL). Do not embed content that is already embedded. Do not call the embedding model during async background work if the embedding already exists in the record.

---

## 4. Module Planning

### 4.1 — `memory/service`

**Purpose:** Public entry point to the memory platform. The only surface that external consumers may call.

**Responsibilities:**
- Accept and validate `storeMemory()`, `retrieveMemories()`, `updateMemory()`, `pruneMemory()`, `deleteUserMemory()`, `summarizeSession()` calls
- Route to internal modules
- Return typed, structured responses

**Must NOT own:**
- Embedding logic
- Database query logic
- Scoring logic
- Redis access

**Dependencies:** All internal modules. This module is an orchestration facade.

**Implementation priority:** Phase 1 (must be first, even if backed by stubs)

---

### 4.2 — `memory/retrieval`

**Purpose:** Execute the full retrieval pipeline from candidate fetch through scored selection.

**Responsibilities:**
- Embed query context (via embedding module)
- Execute scoped pgvector query
- Apply hard filters in sequence
- Score candidates
- Apply type-cap selection rules
- Return structured, ordered memory objects (or empty set)

**Must NOT own:**
- Embedding model calls (delegates to embedding module)
- Direct Redis operations (delegates to cache module)
- Prompt formatting
- Intent classification (intent is supplied as an input parameter by the caller)
- Decision on *whether* to retrieve (that is the client's job; this module executes when called)

**Dependencies:** embedding module, cache module, database module

**Implementation priority:** Phase 1

---

### 4.3 — `memory/ingestion`

**Purpose:** Accept raw conversation turns and promote them through the graduation pipeline.

**Responsibilities:**
- Log raw exchanges
- Classify turn significance (async)
- Promote observations to candidates, candidates to confirmed memories
- Detect commitment intent (Phase 2)
- Handle contradiction and lineage (Phase 2)

**Must NOT own:**
- Retrieval logic
- Scoring logic
- Redis working memory management (that belongs to cache module)

**Dependencies:** embedding module, database module, classification module

**Implementation priority:** Phase 1 for raw logging and basic promotion. Phase 2 for commitment detection and lineage.

---

### 4.4 — `memory/models`

**Purpose:** Define and enforce data shapes for memories, exchanges, scores, retrieval context, and service inputs/outputs.

**Responsibilities:**
- Type definitions for all memory entities
- Validation schemas at service boundaries
- Metadata shape enforcement (volatility, confidence, status, lineage)

**Must NOT own:**
- Business logic
- Persistence

**Dependencies:** None

**Implementation priority:** Phase 1 (blocking for everything else)

---

### 4.5 — `memory/cache`

**Purpose:** Manage all Redis interactions.

**Responsibilities:**
- Working memory buffer (last 5–10 turns per session)
- Cooldown tracking (memory_id → expiry)
- Retrieval cache (TTL-scoped, invalidated on memory update or lineage change)
- Embedding cache (session-scoped, short TTL)

**Must NOT own:**
- Memory business logic
- Scoring
- Database queries

**Dependencies:** Redis client

**Implementation priority:** Phase 1

---

### 4.6 — `memory/embedding`

**Purpose:** Generate and manage vector embeddings.

**Responsibilities:**
- Generate embeddings for text input
- Check embedding cache before generating
- Return cached embeddings when available

**Must NOT own:**
- Storage of embeddings (that's the ingestion/database module's job)
- Retrieval logic

**Dependencies:** cache module, embedding provider adapter (OpenRouter or Nano-GPT, selected via config)

**Provider adapter rule:** The embedding module must implement a provider-adapter pattern. Provider specifics (API shape, authentication, model identifiers, request formats, and response structures) are fully encapsulated inside the adapter. No other part of the system may depend on provider-specific request formats, provider-specific response structures, or model-specific quirks. Switching providers requires only a configuration change — no code changes elsewhere in the system. No other module may call an embedding provider directly.

**Configuration:** Active provider is selected via `EMBEDDING_PROVIDER` (values: `openrouter` | `nanogpt`). Model identifier is set via `EMBEDDING_MODEL` (provider-specific format). Provider credentials and all provider-specific config must be isolated inside `memory/embedding` — they must not be referenced anywhere outside this module.

**v1 constraints:** No multi-provider routing logic in v1. No cost/latency optimization layer in v1. Exactly one provider is active at a time, determined by configuration.

**Implementation priority:** Phase 1

---

### 4.7 — `memory/lifecycle` (Async Only)

**Purpose:** Manage background memory maintenance.

**Responsibilities:**
- Decay calculation (time-based strength reduction)
- Merging similar memories
- Pruning low-value confirmed memories
- Reinforcement (usage-based strength increase)
- Correction (lineage application)
- Summarization triggers

**Must NOT own:**
- Synchronous retrieval path
- Service interface
- Redis state management beyond what decay/pruning requires

**Dependencies:** database module, ingestion module

**Implementation priority:** Phase 2 (pruning/merging). Phase 3 (decay, reinforcement).

---

### 4.8 — `memory/governors`

**Purpose:** Implement behavioral constraint systems.

**Responsibilities:**
- Confidence gating (filter retrieval by confidence threshold)
- Recall mode selection (implicit / soft explicit / hard explicit)
- Cooldown enforcement (coordinated with cache module)
- Negative feedback loop (reduce strength/confidence, apply inhibition)
- Do-nothing protocol (short-circuit to empty result when appropriate)

**Must NOT own:**
- Scoring formulas
- Hard filter order (that belongs to retrieval module)
- Redis management (delegates to cache module)

**Dependencies:** cache module, retrieval module

**Implementation priority:** Phase 3

---

### 4.9 — `chat/engine`

**Purpose:** Client-side orchestration layer. Provides the only path through which adapters interact with the memory service.

**Responsibilities:**
- Classify intent type (task / conversational / emotional) and include it in the `retrieveMemories()` call
- Call `retrieveMemories()` at the appropriate point in the conversation flow
- Call `storeMemory()` / `summarizeSession()` at the appropriate points
- Assemble final prompt from the structured memory objects returned by the memory platform
- Pass assembled context to the language model
- Handle model response
- Forward feedback signals to memory service

**Must NOT own:**
- Any memory logic
- Embedding
- Scoring
- Filtering

**Dependencies:** memory service interface only

**Implementation priority:** Phase 1 (thin stub to prove the call path; full implementation scoped to client build)

---

### 4.10 — `adapters/discord`, `adapters/web`

**Purpose:** Thin transport adapters. Translate protocol-specific events into calls to the chat engine.

**Responsibilities:**
- Receive input events (Discord message, HTTP request)
- Call chat engine
- Deliver response

**Must NOT own:**
- Memory platform logic of any kind
- Chat engine logic

**Dependencies:** chat engine only

**Implementation priority:** Outside scope of memory platform v1. Validated only as consumers of the service interface.

---

## 5. Public Interface Planning

### The Surface

The following six methods are the complete public interface for v1:

| Method | Consumer Use |
|---|---|
| `storeMemory(input)` | Submit a turn or extracted fact for ingestion |
| `retrieveMemories(context)` | Retrieve structured, ordered memory objects suitable for client-side prompt assembly |
| `updateMemory(id)` | Update an existing memory (used by feedback loops) |
| `pruneMemory(scope)` | Trigger scoped cleanup |
| `deleteUserMemory(userId)` | GDPR / right-to-forget compliance |
| `summarizeSession(sessionId)` | Trigger async session summarization |

### What Must Remain Internal

The following are **never exposed**:

- Embedding generation
- pgvector query execution
- Scoring logic
- Hard filter logic
- Cooldown state
- Lineage management
- Graduation state of any memory record
- Redis access of any kind

Consumers receive structured, ordered memory objects suitable for client-side prompt assembly — not prompt text, not raw database records, not internal metadata fields that tempt them to re-score or re-filter.

### What Should Be Stable vs. Flexible in v1

**Stable (committed):**
- Method signatures for `storeMemory` and `retrieveMemories`
- The `(internal_user_id, persona_id)` scoping contract
- The response shape of `retrieveMemories` (typed memory objects with ordering and grouping hints — not prompt strings, not raw rows)
- The `intent_type` input field on `retrieveMemories()` (present from Phase 1; defaults to `conversational` if omitted)

**Flexible (internal, may change without breaking consumers):**
- Scoring weights
- Cooldown durations
- Similarity thresholds per type
- Retrieval candidate count
- Embedding model provider

### Response Stability Rule

The `retrieveMemories()` response shape must be forward-compatible:

- New fields may be added to the response without constituting a breaking change
- Existing fields must not change meaning or structure without an explicit versioning decision
- Consumers must not depend on field absence; they must handle unknown fields gracefully

Versioning is not introduced in v1, but the stability contract must be honored from the first implementation.

### Intent Input Contract

The `retrieveMemories()` input must include an `intent_type` field (task / conversational / emotional) from Phase 1. The memory platform consumes this value for filtering and scoring — it does not classify or infer intent. If the caller omits the field, the platform defaults to `conversational`. Intent classification is never performed inside the memory platform.

---

## 6. Data and State Planning

### 6.1 — Raw Exchanges (`exchanges` table, PostgreSQL)

- Stores conversation turns as captured
- Not retrievable via the memory retrieval system directly
- Source material for ingestion and summarization
- Scoped to `(internal_user_id, persona_id)`
- **Retention policy:** 90 days by default. Retention period is configurable via environment/config. Records older than the retention window must be purged by a scheduled background job.
- **Cascade deletion:** `deleteUserMemory(userId)` must delete all exchange records for the user across all personas, in addition to all derived memory-platform-owned data (`memories` table records, embeddings, Redis state). Deletion must be complete and non-reversible within the platform boundary — partial deletion is not acceptable.
- **No soft delete:** Neither memory records nor exchange records support soft deletion in v1. Deletion is permanent. There is no deferred deletion, tombstone pattern, or recovery path.
- **No retention bypass:** There is no mechanism to retain records beyond the configured retention window for debugging, internal use, or any other purpose. The scheduled purge job applies uniformly to all records. Retention bypass is not a supported operation.

### 6.2 — Distilled Memories (`memories` table, PostgreSQL + pgvector)

The authoritative, long-term memory store.

**Required fields per record:**
- `id`
- `internal_user_id`
- `persona_id`
- `memory_type` (semantic | episodic | self | commitment)
- `content` (text)
- `embedding` (vector, HNSW-indexed)
- `importance` (float, 0–1)
- `confidence` (explicit | inferred)
- `volatility` (factual | subjective)
- `status` (active | superseded | corrected)
- `graduation_status` (observation | candidate | confirmed)
- `strength` (float, usage-reinforced, time-decayed)
- `cooldown_until` (null or timestamp — also tracked in Redis for fast access)
- `inhibited` (boolean)
- `lineage_parent_id` (nullable foreign key → self, for contradiction tracking)
- `created_at`, `last_accessed_at`, `last_reinforced_at`

**Critical query constraint:** All mass retrieval queries must be scoped by `internal_user_id` AND `persona_id` at the SQL level. Global queries are never permitted in the retrieval path.

**Isolation rule:** Memory records are strictly isolated per `(internal_user_id, persona_id)`. No cross-persona access is permitted. No memory belonging to one persona may be retrieved in the context of another, regardless of shared `internal_user_id`. This isolation is absolute in v1 and is not subject to relaxation without an explicit scope change.

### 6.3 — Working Memory Buffer (Redis)

- Key pattern: `working:{internal_user_id}:{persona_id}`
- Stores last 5–10 turns as ordered list
- TTL: session-duration appropriate (e.g., 30 minutes of inactivity)
- Non-authoritative: loss is acceptable
- Must not store embedded memory records

### 6.4 — Cooldown State (Redis)

- Key pattern: `cooldown:{memory_id}`
- Value: expiry timestamp
- Written at time of retrieval when a memory is used
- Also materialized to the `memories` table for durability on warm restart
- TTL: matches the cooldown duration

### 6.5 — Retrieval Cache (Redis)

- Key: hash of `(internal_user_id, persona_id, query_embedding, intent_type)`
- Value: serialized retrieval result
- TTL: 30–120 seconds (configurable per intent type)
- **Must be invalidated** when any memory in scope changes status, strength, or lineage

### 6.6 — Embedding Cache (Redis)

- Key: hash of input text (normalized)
- Value: embedding vector
- TTL: session-scoped (short, e.g., 5–10 minutes)
- Purpose: avoid re-embedding the same input within a turn cycle

### 6.7 — Lineage State (PostgreSQL)

- Stored within the `memories` table via `lineage_parent_id`
- Superseded memories are never deleted; they are marked `status = superseded`
- Correction chains are traversable via lineage pointer
- No separate lineage table is necessary at v1 complexity
- Lineage pointers must remain within the same `(internal_user_id, persona_id)` scope — cross-persona lineage is not permitted

---

## 7. Retrieval Pipeline Planning

### Pipeline Overview (Sequential, Blocking)

The retrieval pipeline is a strict stage sequence. No stage may be skipped. No stage may operate on data from a prior stage that has not been fully processed.

**Stage 1 — Cache Check**
Check Redis retrieval cache for a non-expired result matching the current context hash. If hit: return immediately. This is the only acceptable early exit.

**Stage 2 — Embed Query**
Generate embedding for the current retrieval context. Check embedding cache first. If cache miss, call embedding model and cache result.

**Stage 3 — Candidate Retrieval**
Execute scoped pgvector query:
```
WHERE internal_user_id = ? AND persona_id = ?
ORDER BY embedding <-> ?
LIMIT 20–40
```
The upper limit (20 vs. 40) can be tuned; start with 20 for Phase 1. Filtering must not widen the result set beyond this.

**Stage 4 — Hard Filtering (strictly ordered)**

Apply in sequence. Each filter eliminates records before the next runs:

1. Graduation gate — exclude `observation` status records
2. Inhibition gate — exclude `inhibited = true`
3. Similarity threshold — exclude records below per-type threshold
4. Cooldown gate — exclude records with active cooldown (check Redis first, fallback to `cooldown_until` column)
5. Confidence gate — exclude records below minimum confidence for this intent type
6. Intent alignment — exclude records whose type is misaligned with the caller-supplied intent value

**Stage 5 — Scoring**

Apply scoring formula to remaining candidates:
```
Score = (Similarity × 0.6) + (Recency × 0.2) + (Importance × 0.1) + (Strength × 0.1) + IntentAlignmentBias
```

IntentAlignmentBias is an additive offset (e.g., +0.05 to +0.10) for records whose type is strongly aligned with the caller-supplied intent value. This is not a multiplier; it is a preference signal.

**Stage 6 — Type-Capped Selection**

Select from the scored pool subject to:
- semantic ≤ 2
- episodic ≤ 2
- commitment ≤ 1
- No type is required; the result may contain zero memories

Select greedily by score within each type cap.

**Stage 7 — Post-Selection Bookkeeping**

For each selected memory:
- Update `last_accessed_at`
- Set cooldown (both in Redis and `cooldown_until` column)
- Increment access counter for reinforcement (async — do not block return)

**Stage 8 — Cache Write and Return**

Write result to retrieval cache. Return structured, ordered memory objects to the service layer.

### No-Memory Outcome

If Stage 6 selects zero memories across all types, return an empty result set. Do not retry with relaxed thresholds. Do not inject weak memories. This is the do-nothing protocol and it is a valid, correct outcome.

### Latency Target

Target: under 1.5 seconds for the full synchronous pipeline. The critical path is: cache check → embed → DB query → filter → score → select → return. Each stage should be instrumented independently.

### v1 Simplification Guidance

- Do not implement dynamic threshold tuning in Phase 1
- The memory platform never classifies intent at any phase. Intent is always an inbound parameter supplied by the caller. Default to `conversational` if omitted. This is a permanent design boundary, not a v1 simplification.
- Do not implement IntentAlignmentBias in Phase 1 (set to 0.0 as a constant)
- Do not implement commitment retrieval in Phase 1 (no commitments exist yet)

These simplifications preserve the pipeline structure while deferring complexity. The pipeline shape must be correct from Phase 1 even if many paths return empty.

---

## 8. Ingestion and Lifecycle Planning

### Synchronous Ingestion (Happens on `storeMemory()` Call)

The following must complete synchronously:

1. Validate input
2. Log raw exchange to `exchanges` table
3. Assign `graduation_status = observation`
4. Queue async classification job
5. Return acknowledgment to caller

The caller must not wait for embedding, classification, or promotion. Ingestion acknowledgment means "received and logged" — not "processed and available."

### Asynchronous Ingestion Pipeline

**Async Infrastructure Constraint:** The async ingestion pipeline must use a simple, non-distributed queue in Phase 1 and Phase 2. Acceptable implementations are an in-process queue or a Redis-backed job queue (e.g., BullMQ). Distributed queue systems, multi-service worker orchestration, and complex event buses are not acceptable in early phases. This simplicity is intentional — the pipeline must remain evolvable. Complexity may be re-evaluated in Phase 4 if production load patterns justify it.

**Step 1 — Classification**
Determine whether the turn contains memory-worthy content. Use a lightweight LLM call or rule-based classifier. Output: discard (no memory) or extract (one or more candidate memories with initial type, importance, confidence, and volatility values).

**Step 2 — Embedding**
Generate embeddings for extracted content. Check embedding cache. Store with record.

**Step 3 — Deduplication / Merging Check**
Before writing, compare new candidate against existing confirmed memories. If a highly similar record exists (above merge threshold), evaluate for merge vs. new record.

**Step 4 — Contradiction Detection**
Compare new semantic/self memory against existing active memories for the same user-persona pair. If contradiction detected: mark old memory `status = superseded`, set `lineage_parent_id` on new record, write new record as `confirmed`.

**Step 5 — Promotion**
If the extracted memory passes all checks and has no contradiction, write as `graduation_status = candidate`. Candidates graduate to `confirmed` after a reinforcement signal (e.g., repeated appearance across turns, or manual promotion trigger).

### Commitment Detection (Phase 2)

Commitment detection runs against **persona output** (what the persona said), not user input.

Detection rule: does the persona output contain a future-oriented obligation directed at the user that implies follow-through?

Must be conservative. The cost of a missed commitment is low (no commitment stored). The cost of a false positive is high (behavior distortion). Default should be: not a commitment.

Detected commitments bypass:
- Similarity threshold
- Cooldown
- They do not bypass inhibition or explicit deletion

### Lifecycle Operations (Phase 2–3)

**Decay:** Time-based strength reduction. Run as scheduled background job. Should not affect retrieval until strength falls below a threshold. Do not implement in Phase 1.

**Reinforcement:** Usage-based strength increase. Increment occurs post-retrieval (async). Do not implement in Phase 1 (log access only).

**Pruning:** Remove or archive `superseded` and very-low-strength memories that have not been accessed in a long period. Requires policy definition. Phase 2.

**Merging:** Consolidate near-duplicate candidates or confirmed memories. Triggered by ingestion or scheduled. Phase 2.

### Strict Rule

`exchanges` table is write-only from the service's perspective after ingestion. Retrieval never reads from `exchanges`. The `exchanges` table exists for auditability, re-processing, and summarization triggers — not for retrieval.

---

## 9. Phase-by-Phase Build Plan

### Phase 1 — Core Platform (Working Retrieval and Storage Path)

**Objective:** Prove end-to-end service correctness with semantic memory only. Establish service boundary. Validate latency target.

**Components:**
- `memory/models`: all types and schemas
- `memory/embedding`: embedding generation with session cache
- `memory/cache`: Redis working memory, cooldown, retrieval cache, embedding cache
- `memory/ingestion`: raw logging, observation-level storage
- `memory/retrieval`: full pipeline structure (Stage 1–8), semantic memory only, no intent alignment bias
- `memory/service`: public interface, all six methods (some returning stubs for unimplemented operations)
- `chat/engine`: thin stub connecting to memory service for testing purposes

**Dependencies:**
- PostgreSQL instance with pgvector extension
- Redis instance
- Embedding provider configured via environment/config (OpenRouter or Nano-GPT; provider-adapter pattern enforced in `memory/embedding`)
- Simple async queue (in-process or BullMQ) — interface defined in Phase 1 even if pipeline is stubbed

**Explicitly excluded:**
- Episodic and commitment memory types
- Ingestion classification (async pipeline is stubs)
- Commitment detection
- Governor logic
- IntentAlignmentBias (set to 0.0 constant; `intent_type` field accepted as input from Phase 1)
- Decay and lifecycle

**Validation gates before Phase 2:**
- Scoped query confirmed to not leak across `(user_id, persona_id)` boundaries
- Retrieval pipeline stages execute in correct order
- Hard filtering eliminates records correctly
- Working memory buffer stores and expires correctly
- Cooldown prevents re-retrieval within window
- Retrieval cache returns correct results on cache hit
- End-to-end retrieval latency measured under load; must be below 1.5s
- Public interface signature is stable and agreed on

---

### Phase 2 — Structured Memory and Ingestion Pipeline

**Objective:** Add episodic memory, enable the full ingestion pipeline, implement lineage/contradiction handling, activate commitment classification.

**Components:**
- Episodic memory type (storage, retrieval path, type cap enforcement)
- Ingestion async pipeline (classification, embedding, deduplication, contradiction handling) — using simple queue infrastructure established in Phase 1
- Commitment detection classifier
- Commitment memory type (storage, bypass rules in retrieval)
- Lineage model (superseded status, `lineage_parent_id`)
- Basic pruning and merging (scheduled job)
- Retrieval cache invalidation on lineage change

**Dependencies:** Phase 1 complete and validated

**Explicitly excluded:**
- Governor systems (confidence gating, recall modes, negative feedback)
- Decay
- Reinforcement scoring
- IntentAlignmentBias
- Distributed queue infrastructure

**Validation gates before Phase 3:**
- Episodic memories retrieved under type cap
- Commitments bypass similarity and cooldown, respect inhibition
- Contradiction creates correct superseded chain
- Pruning reduces `superseded` record accumulation
- Commitment classifier tested for false positive rate

---

### Phase 3 — Behavioral Governors

**Objective:** Implement all restraint and behavioral consistency systems.

**Components:**
- Confidence system (confidence field active in scoring and gating)
- Recall modes (implicit / soft explicit / hard explicit — distinction in retrieval path)
- Cooldown system fully operational (tunable duration per type)
- Negative feedback loop (reduce strength/confidence, set inhibition flag)
- Do-nothing protocol formally enforced (not just implicit)
- Intent alignment bias (active, applied using caller-supplied intent value)
- Decay (time-based strength reduction, scheduled job)
- Reinforcement (usage-based strength increase, post-retrieval async job)

**Dependencies:** Phase 2 complete and validated

**Explicitly excluded:**
- HNSW tuning
- Horizontal scaling
- API gateway / external HTTP interface

**Validation gates before Phase 4:**
- Cooldown confirmed to suppress within-window re-retrieval
- Negative feedback measurably reduces retrieval frequency for a flagged memory
- Intent alignment demonstrably affects selection in task vs. conversational context
- Decay reduces strength of unaccessed memories over time
- Governor behavior is measurable via observability metrics

---

### Phase 4 — Optimization and Scale Readiness

**Objective:** Tune performance, harden the caching layer, and prepare the platform for extraction into a standalone service.

**Components:**
- HNSW index tuning (`m`, `ef_construction`, `ef_search` parameters based on observed query patterns)
- Retrieval cache TTL tuning
- Async pipeline batching (group embedding calls)
- Connection pooling review
- Service extraction preparation (confirm no structural dependencies outside `/memory`)
- HTTP API surface over the public service interface (if extraction is imminent)
- Re-evaluate async queue infrastructure based on production load patterns; upgrade only if justified

**Dependencies:** Phase 3 complete, production load patterns available

---

## 10. Testing and Validation Plan

### Unit-Level Priorities (Phase 1)

- **Scoped query enforcement:** every query path must have a test confirming it will not execute without `internal_user_id` and `persona_id` bound
- **Hard filter stages:** each filter stage independently tested with records that should pass and records that should be eliminated
- **Scoring formula:** deterministic input / expected output tests; ensure weight constants produce correct rank order
- **Type cap selection:** test that type caps are observed when more qualifying records exist than the cap allows
- **Cache key generation:** ensure retrieval cache keys are stable and collision-resistant
- **Cooldown write/read:** test that a retrieved memory sets cooldown, and that cooldown excludes the memory from the next retrieval

### Integration-Level Priorities (Phase 1)

- **End-to-end retrieval:** insert known memories, call `retrieveMemories()`, verify correct records returned with correct scores
- **Cache hit behavior:** confirm that a second identical retrieval request returns cached result without hitting pgvector
- **Cache invalidation:** confirm that modifying a memory in scope invalidates the retrieval cache
- **Working memory persistence:** confirm turns are written and retrieved correctly within a session
- **Service boundary test:** confirm no database call is reachable without going through the public service interface (structural test)

### Boundary Enforcement Checks

- Adapter code must not import from `memory/*` directly
- Chat engine must not import from `memory/retrieval`, `memory/ingestion`, `memory/cache`, or `memory/embedding` directly
- These checks should be implemented as import-boundary lint rules (e.g., eslint with import restrictions or a custom boundary checker)

### Performance/Latency Validation

- Instrument each pipeline stage individually with elapsed time
- Measure p50, p95, p99 retrieval latency under synthetic load
- Validate against the 1.5s target
- Identify the bottleneck stage before adding Phase 2 complexity
- Cache hit latency should be under 50ms

### Regression Risks

- Scoring weight changes will silently alter retrieval behavior — protect with golden-set tests (known inputs → expected rank order)
- Threshold changes will alter which memories surface — document thresholds and protect with explicit boundary tests
- Async pipeline failures must not block retrieval path — test that ingestion queue failure returns gracefully from `storeMemory()`

---

## 11. Observability and Operational Planning

### Instrument from Phase 1 (Non-Negotiable)

- **Retrieval latency per stage:** candidate retrieval time, filter time, scoring time, total time
- **Cache hit rate:** retrieval cache and embedding cache separately
- **Zero-memory response rate:** percentage of `retrieveMemories()` calls that return an empty set
- **Hard filter rejection rate per filter type:** how many records each filter eliminates (useful for threshold calibration)
- **Embedding generation call count:** distinct from embedding cache hit rate — track actual model calls

### Add in Phase 2

- **Retrieval rejection rate by type:** how often each memory type is excluded
- **Commitment detection rate:** how often the classifier flags a commitment vs. total turns evaluated
- **Ingestion queue depth / processing lag:** measure how far behind the async pipeline runs
- **Lineage event rate:** how often contradictions are detected and resolved

### Add in Phase 3

- **Negative feedback application rate:** how often memories are inhibited via feedback
- **Recall mode distribution:** what percentage of retrievals are implicit vs. explicit
- **Cooldown suppression rate:** how often cooldown eliminates otherwise-qualifying memories
- **Decay job results:** magnitude of strength reduction per run, number of records below threshold

### Failure Visibility

- Async pipeline failures must emit structured error logs with job type, memory_id, error class, and timestamp
- Embedding model failures must be caught and surfaced with circuit-breaker pattern (do not silently fail retrieval)
- Redis unavailability must degrade gracefully: working memory unavailable, cooldown checks fallback to DB column, cache misses all go to DB

### What Can Wait

- Distributed tracing (Phase 4)
- Dashboarding (Phase 4)
- Alerting rules (Phase 3 end / Phase 4 start)

---

## 12. Risk Areas and Likely Failure Modes

### Risk 1 — Memory Logic Leaks Into the Chat Engine

**Likelihood:** High. This is the most common mistake in systems like this.

**Form it takes:** Chat engine starts checking memory types, applying its own thresholds, or choosing not to inject certain memory records based on its own logic.

**Mitigation:** `retrieveMemories()` must return structured, ordered memory objects suitable for client-side prompt assembly. The response is already filtered and scored. The caller formats the output — it must not re-filter, re-score, or reconstruct memory logic. Import boundary enforcement (§10) enforces this structurally.

---

### Risk 2 — Global Queries in the Retrieval Path

**Likelihood:** Medium. Easy mistake when debugging or prototyping.

**Form it takes:** A developer retrieves all memories globally and applies user/persona filtering in application code, then thinks it works because the result is correct.

**Mitigation:** Scoped query enforcement is a unit test requirement from Phase 1. Any retrieval call without scope bindings must fail or reject, not just return an empty result.

---

### Risk 3 — Building Ingestion Pipeline Before Retrieval Is Proven

**Likelihood:** High, especially for agents or developers who want to see memory being "learned."

**Form it takes:** Commitment detection, classification, and graduation logic gets built in Phase 1 while the retrieval path is incomplete or unvalidated.

**Mitigation:** Phase 1 explicitly excludes the async ingestion pipeline beyond raw logging. The validation gates must be signed off before Phase 2 starts.

---

### Risk 4 — Commitment Classifier False Positive Rate Too High

**Likelihood:** Medium.

**Form it takes:** The classifier is tuned for recall (catch all commitments) rather than precision. This creates spurious commitments that bypass cooldown and distort persona behavior.

**Mitigation:** Scope defines conservative detection explicitly. The Phase 2 validation gate requires false positive rate measurement before Phase 3 begins. Default to: not a commitment.

---

### Risk 5 — Over-Engineering the Module Abstractions Too Early

**Likelihood:** Medium.

**Form it takes:** A generalized pipeline engine, a type-registry, a plugin system for governors, or a complex DI container gets built in Phase 1 because it "feels cleaner."

**Mitigation:** Explicit rule: extract abstractions only after two concrete implementations exist. Phase 1 must be built concretely. Refactoring is acceptable in Phase 2 once patterns are clear.

---

### Risk 6 — Retrieval Cache Invalidation Gaps

**Likelihood:** Medium.

**Form it takes:** A memory's status or strength changes but the retrieval cache is not invalidated. Stale results are returned.

**Mitigation:** All write paths that modify `memories` table entries must also invalidate affected cache keys. The invalidation logic must be tested explicitly (§10).

---

### Risk 7 — Embedding Model Coupling

**Likelihood:** Low to medium.

**Form it takes:** The embedding model provider is hardcoded, making it expensive to swap later when cost or capability changes.

**Mitigation:** The `memory/embedding` module is the sole caller of the embedding provider. No other module calls the provider directly. Provider is injected via configuration, not hardcoded.

---

### Risk 8 — Working Memory Treated as Authoritative

**Likelihood:** Low.

**Form it takes:** Code begins to rely on Redis working memory as if it is guaranteed to exist, creating silent failures when Redis restarts or a session expires.

**Mitigation:** Every working memory read must have a fallback path. Redis is non-authoritative by design. This is stated in the scope and must be enforced in code review.

---

### Risk 9 — Async Pipeline Blocking the Synchronous Path

**Likelihood:** Low, if the async queue is implemented correctly.

**Form it takes:** `storeMemory()` awaits classification or promotion before returning.

**Mitigation:** `storeMemory()` must return after logging. Classification is enqueued. The job system must fail gracefully and not propagate to the calling surface.

---

## 13. Resolved Decisions

### Decision: Embedding Model Provider (OQ-1 — Resolved)

The `memory/embedding` module implements a **provider-adapter pattern**. OpenRouter and Nano-GPT are the two supported configurable gateways. The active provider is selected via environment/config. No code changes are required elsewhere when switching providers — the adapter interface is the only surface the embedding module exposes internally.

The Phase 1 default provider must be selected and set in environment configuration before implementation begins. Either gateway is acceptable; the choice is a deployment-level decision, not an architectural one.

Required configuration keys: `EMBEDDING_PROVIDER` (values: `openrouter` | `nanogpt`) and `EMBEDDING_MODEL` (provider-specific model identifier). Provider credentials are isolated inside the adapter. No multi-provider routing or cost/latency optimization layer is introduced in v1.

---

### Decision: Exchanges Table Retention Policy (OQ-2 — Resolved)

Raw exchange records are retained for **90 days by default**. The retention period is configurable via environment/config. A scheduled background job must purge expired records.

`deleteUserMemory(userId)` must **cascade to all memory-platform-owned data** for the user: exchange records across all personas, all `memories` table records, and all associated Redis state. Deletion is permanent and non-reversible within the platform boundary. Partial deletion is not compliant. The deletion must be complete before the operation is considered successful.

Neither memory records nor exchange records support soft deletion in v1. There is no retention bypass for debugging or internal use. The scheduled purge job applies uniformly to all eligible records.

---

## 14. Recommended Next Document

### Recommended: Technical Architecture Document

After this planning pass, the next document should be a **Technical Architecture Document** authored by the project architect.

**What it should contain:**

- Formal module interface contracts (method signatures, input/output types, error contracts) for the public service layer and all internal module boundaries
- The exact shape of the `retrieveMemories()` response (typed memory objects, ordering hints, grouping structure — confirming no prompt text is returned)
- Database schema definitions (`exchanges`, `memories` tables with all columns, types, and constraints)
- Index design (HNSW parameters, query patterns to be supported)
- Redis key schema and TTL policy
- Async queue selection and interface definition (in-process or BullMQ; Phase 1–2 simplicity constraint formalized)
- Embedding provider selection and integration pattern
- Configuration and environment model (how providers, thresholds, and constants are injected)
- Dependency injection or module wiring strategy
- Deployment topology for Phase 1 (single-process monolith with internal service isolation, or otherwise)

**Why it comes next:**

The planning document defines _what_ must exist, the sequencing, and the constraints. The architecture document translates those decisions into _how_ the TypeScript codebase will be structured: exact interfaces, schemas, and wiring. Without it, implementation agents will make their own structural decisions — likely inconsistently — and the service boundary risks identified in this plan will materialize.

All previously open questions have been resolved. The architecture document should formalize those decisions into concrete interface contracts, schema definitions, and configuration specifications before it is considered complete.

---

*End of planning document. This document is intended for architect review prior to any implementation work.*
