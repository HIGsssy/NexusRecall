Nexus Recall — Phase 1 Compliance Audit Report
Auditor: Librarian/Reviewer Agent
Date: April 1, 2026
Scope: S01–S03, all Phase 1 deliverables
Authority: IMPL-ImplementationContract.md (primary)

1. Compliance Summary
Category	Verdict
Structure	PASS
Boundaries	FAIL
Data Flow	FAIL
Retrieval Pipeline	FAIL
Cache Discipline	FAIL
Async/Queue	PASS (with note)
Contract Surface	FAIL
Forbidden Features	PASS
2. Drift Report (CRITICAL)
DRIFT-01: memory/retrieval contains raw SQL and its own database pool
File: index.ts:22-28
Problem: Imports Pool from pg, creates a private connection pool, and executes a raw SQL SELECT query (lines 156–168).
Contract violation: IMPL §6: "Query logic must live in queries — SQL must not appear in module files." IMPL §11/S03 gate: "No module other than db executes raw SQL."
Required fix: Extract the candidate fetch query to memories.ts. Import pool from client.ts. Remove all pg imports and SQL from memory/retrieval.

DRIFT-02: memory/embedding does not use the embedding cache
File: index.ts:132-140
Problem: The embed() function calls adapter.generate(text) directly every time. It does not normalize text for hashing, does not check memory/cache.getEmbedding(textHash), does not write results via memory/cache.setEmbedding(). The entire cache-check-then-generate flow specified in ARCH §6 and required by IMPL §S02 is absent.
Contract violation: IMPL S02: "full cache-check-then-generate flow" is required as a real implementation, not a stub. S02 validation gate: "EmbeddingModule.embed() returns a cached vector on second call with identical text (no provider call made)."
Required fix: Import getEmbedding, setEmbedding from ../cache. Implement the six-step flow: normalize → hash → cache check → generate on miss → cache write → return.

DRIFT-03: memory/retrieval is missing 3 of the 8 required pipeline stages
File: index.ts:244-272
Problem: The execute() function implements stages 2–6 and mapping only. Three stages required by IMPL §S03 / ARCH §7 are absent from this module:

Stage 1 (Cache Check) — implemented in memory/service instead
Stage 7 (Post-Selection Bookkeeping enqueue) — implemented in memory/service instead
Stage 8 (Cache Write + Return) — implemented in memory/service instead
Contract violation: IMPL §7: memory/retrieval.execute() "Must execute all eight stages in order." IMPL S03: Service must NOT contain "Any retrieval logic of any kind."
Required fix: Move cache check, bookkeeping enqueue, and cache write into memory/retrieval.execute(). memory/service.retrieveMemories() should delegate entirely to execute() and return its result unchanged.
DRIFT-04: memory/service directly calls db/queries/* and memory/cache
File: index.ts:6-24
Problem: The service imports and directly calls:

updateMemoryByScope and deleteAllUserDataFromDb from db/queries/memories
getRetrievalCache, setRetrievalCache, invalidateRetrievalCache, deleteUserRedisState from memory/cache
Contract violation: IMPL §7: memory/service explicitly "must NOT" make "Any SQL query or database interaction" or "Any Redis interaction." Each method must delegate to "exactly one owning internal module." updateMemory() coordinates across db/queries and memory/cache. deleteUserMemory() coordinates across db/queries and memory/cache. retrieveMemories() coordinates across memory/cache, memory/retrieval, and memory/ingestion.
Required fix:
updateMemory() logic must move to an owning module (e.g., a function in memory/ingestion or a dedicated path in the appropriate module) that handles both the DB write and cache invalidation internally.
deleteUserMemory() orchestration must move behind a single module call.
retrieveMemories() must delegate entirely to memory/retrieval.execute().
DRIFT-05: memory/retrieval cooldown filter does not check Redis
File: index.ts:198-202
Problem: Filter 4 (Cooldown gate) only checks the cooldown_until database column timestamp. It does not call memory/cache.isOnCooldown().
Contract violation: ARCH §7 Stage 4, Filter 4: "Exclude records with active cooldown (Redis first, fallback to cooldown_until)." IMPL S02 interface: memory/retrieval is listed as a caller of memory/cache for cooldown checks.
Required fix: Import isOnCooldown from memory/cache. Check Redis first for each candidate; fall back to cooldown_until column only on Redis miss.

DRIFT-06: Retrieval pipeline emits no structured log entries with elapsed time
File: index.ts:244-272
Problem: No logging exists anywhere in the retrieval pipeline. Not a single stage emits a structured log with elapsed time.
Contract violation: IMPL S03: "Each pipeline stage must emit a structured log entry with elapsed time in milliseconds." S03 validation gate: "Each pipeline stage emits a structured log entry with elapsed time."
Required fix: Wrap each stage in timing instrumentation. Emit a structured JSON log entry per stage with stage name and elapsed_ms.

DRIFT-07: memory/cache interface uses ttlSeconds where contract specifies ttlMs
File: index.ts:44-49 and index.ts:122-128
Problem: setRetrievalCache() parameter is ttlSeconds: number. setEmbedding() parameter is ttlSeconds: number. The contract interface (IMPL §7) specifies both as ttlMs: number.
Contract violation: IMPL §7 cache interface: setRetrievalCache(key, result, ttlMs) and setEmbedding(textHash, vector, ttlMs). The parameter semantics differ (seconds vs. milliseconds).
Required fix: Rename parameters to ttlMs and convert to seconds internally (Math.ceil(ttlMs / 1000)) before passing to Redis SETEX. Update all call sites to pass milliseconds.

DRIFT-08: memory/retrieval candidate query adds AND status = 'active' not in spec
File: index.ts:158-165
Problem: The Stage 3 SQL query includes AND status = 'active' which is not present in the query specified in ARCH §7 Stage 3.
Contract violation: IMPL S03: "Stage 3 SQL query exactly as specified." The specified query has only WHERE internal_user_id = $1 AND persona_id = $2. Status filtering is a hard filter in Stage 4, not a SQL predicate.
Required fix: Remove AND status = 'active' from the SQL query. Status-based exclusion, if needed, should occur in the hard filter pipeline.

DRIFT-09: deleteAllUserDataFromDb in memories.ts also deletes from exchanges table
File: memories.ts:85-116
Problem: The function deleteAllUserDataFromDb executes DELETE FROM exchanges WHERE internal_user_id = $1 inside db/queries/memories.ts.
Contract violation: IMPL §6: exchanges.ts is "All SQL for exchanges table." Exchange deletion SQL belongs in db/queries/exchanges.ts.
Required fix: Move the exchanges deletion into a function in db/queries/exchanges.ts and call it from the transaction orchestration point.

DRIFT-10: Stub log format does not match contract specification
File: index.ts:84-101
Problem: prune-scope stub logs { level, event, data, timestamp }. Contract requires { jobType: 'prune-scope', status: 'stub', scope }. Same for summarize-session: logs { level, event, data, timestamp } instead of { jobType: 'summarize-session', status: 'stub', sessionId }.
Contract violation: IMPL §10 Stubbing Rules: the log format is explicitly specified per stub.
Required fix: Update log objects to include jobType and status: 'stub' fields matching the contract table.

DRIFT-11: memory/cache invalidateRetrievalCache ignores scope parameters
File: index.ts:54-72
Problem: The function voids userId and personaId and scans ALL rcache:* keys globally. While the hashed key design makes exact scope matching infeasible, the parameters are explicitly discarded.
Contract violation: IMPL §8: "invalidateRetrievalCache(userId, personaId) must delete all keys matching rcache:* for that scope." The current implementation deletes keys for ALL scopes, not just the targeted one.
Required fix: This is a design-level issue rooted in the key hashing strategy. To support scoped invalidation, either maintain a secondary Redis SET tracking rcache keys per (userId, personaId) scope, or accept over-invalidation and document the deviation. The current silent discard of parameters is not acceptable.

3. Risk Assessment
Dual database pools: memory/retrieval creates its own Pool separate from client.ts. If not fixed, Phase 2 modules will face connection pool exhaustion and inconsistent pool configuration.
No embedding cache path: Every embed call hits the external provider. Under retrieval load this will blow through rate limits and latency budgets well before Phase 2 adds more embedding-dependent features.
Service as orchestrator anti-pattern is entrenched: With cache check, bookkeeping, cache write, DB calls, and Redis calls all inside memory/service, adding Phase 2 features (decay, reinforcement) will further bloat the service layer and make boundary enforcement progressively harder.
Broad cache invalidation: Deleting all rcache:* keys on every write is tolerable at low scale but will cause cache thrashing in Phase 2 multi-persona scenarios.
4. Final Verdict
MAJOR DRIFT — DO NOT PROCEED

5 of 8 audit categories failed. The drift is structural, not cosmetic:

The 8-stage retrieval pipeline is fractured across two modules (memory/service + memory/retrieval) rather than encapsulated in memory/retrieval as the contract mandates.
memory/service has absorbed business logic, database calls, and cache operations in violation of its orchestration-only contract.
The embedding cache flow — a core S02 deliverable — is entirely absent.
memory/retrieval owns a private database pool and contains raw SQL, violating the query isolation boundary.
These are not incremental fixes. They require re-routing the retrieval pipeline, embedding cache flow, and service delegation model to match the contracted module boundaries before any Phase 2 work begins.