Nexus Recall — Phase 1 Follow-Up Compliance Audit
Date: April 1, 2026
Scope: Post-correction verification of DRIFT-01 through DRIFT-11
Authority: IMPL-ImplementationContract.md (primary)

1. Compliance Summary
Category	Previous	Current
Structure	PASS	PASS
Boundaries	FAIL	PASS
Data Flow	FAIL	PASS
Retrieval Pipeline	FAIL	PASS
Cache Discipline	FAIL	PASS (with minor)
Async/Queue	PASS	PASS
Contract Surface	FAIL	PASS
Forbidden Features	PASS	PASS
2. Previous Violation Status
ID	Issue	Status
DRIFT-01	memory/retrieval contained raw SQL and private pg.Pool	RESOLVED — SQL moved to fetchCandidates in memories.ts:83. Pool import removed.
DRIFT-02	memory/embedding had no embedding cache flow	RESOLVED — Full 6-step cache-check-then-generate flow implemented in index.ts:137-162. Imports getEmbedding/setEmbedding from ../cache.
DRIFT-03	memory/retrieval missing stages 1, 7, 8	RESOLVED — All 8 stages now execute inside index.ts:270-342.
DRIFT-04	memory/service directly called db/queries/* and memory/cache	RESOLVED — Service now imports only from ../retrieval, ../ingestion, ../models. Each method delegates to exactly one module.
DRIFT-05	Cooldown filter did not check Redis	RESOLVED — Filter 4 calls isOnCooldown() from memory/cache first, DB cooldown_until as fallback (index.ts:184-190).
DRIFT-06	No structured log entries with elapsed time	RESOLVED — Each stage emits { pipeline, stage, elapsed_ms, timestamp } via logStage().
DRIFT-07	Cache interface used ttlSeconds instead of ttlMs	RESOLVED — setRetrievalCache and setEmbedding now accept ttlMs, convert internally via Math.ceil(ttlMs / 1000).
DRIFT-08	Stage 3 query included AND status = 'active' not in spec	RESOLVED — memories.ts:91-99 query now matches spec: WHERE internal_user_id = $1 AND persona_id = $2 only.
DRIFT-09	deleteAllUserDataFromDb in memories.ts contained exchanges SQL	RESOLVED — Exchanges deletion delegated to deleteExchangesByUserIdTx and getDistinctExchangePersonaIdsTx in exchanges.ts:69-85.
DRIFT-10	Stub log format did not match contract	RESOLVED — Stubs now log { jobType, status: 'stub', scope/sessionId } per §10 table.
DRIFT-11	invalidateRetrievalCache ignored scope parameters	RESOLVED — Uses scope-tracking SET to enable scoped invalidation (index.ts:63-71).
3. New Issues Introduced During Correction
DRIFT-12: Unapproved Redis key pattern rcache-scope:
File: index.ts:29-31
Problem: The scoped invalidation fix introduces a new Redis key pattern rcache-scope:{userId}:{personaId} (a SET used to track which rcache: keys belong to each scope). This pattern is not in the four approved key patterns listed in IMPL §8 / ARCH §3.5.
Contract violation: IMPL §8: "All keys must match the exact patterns specified in architecture §3.5. No variation." and "No ad hoc key naming is permitted."
Severity: Minor. The key is entirely internal to memory/cache, its pattern string does not appear outside that module, and it exists solely to satisfy the scoped invalidation requirement that was otherwise impossible to meet with the approved key schema. The alternative — scanning all rcache:* keys globally — was the prior violation (DRIFT-11).
Required fix: Document this as an approved auxiliary key pattern in the contract or architecture, acknowledging it is necessary to implement the scoped invalidation requirement specified in §8.

4. No Regressions Detected
File structure unchanged: exactly 12 .ts files, no forbidden modules
process.env remains confined to index.ts
Redis key string patterns (working:, cooldown:, rcache:, emb:) remain confined to memory/cache
No SQL appears in any memory/* module
No direct Redis access outside memory/cache
All memories write paths call invalidateRetrievalCache before resolving
BullMQ retry config (3 attempts, exponential, 1000ms base) unchanged
No forbidden features introduced
All contract-defined types and interfaces intact, no shape drift
5. Risk Assessment
Embedding cache not clearable per-user: deleteUserRedisState does not (and cannot) clear embedding cache entries, because emb:{sha256(normalizedText)} keys contain no user identifier. The contract's deleteUserMemory() spec requires clearing "embedding caches" for the user, but the approved key schema makes this impossible. Short TTL (5 min) mitigates practical impact. This is a pre-existing architecture-level tension, not a code defect.
memory/ingestion expanded beyond its stated interface: performUpdate() and performDeleteUserData() are added to memory/ingestion to serve as delegation targets for memory/service. Ingestion's stated responsibility is "Accept raw turns, write exchange records synchronously, queue async classification and promotion work." Update and delete operations are not in that description. In Phase 2, if ingestion grows further with lifecycle responsibilities, the module risks becoming a catch-all. A dedicated module or explicit contract expansion may be needed.
6. Final Verdict
MINOR DRIFT — CORRECTION REQUIRED BEFORE PROCEEDING

All 11 previously identified violations are resolved. One new minor issue (DRIFT-12: unapproved auxiliary Redis key pattern) was introduced as a necessary side effect of fixing scoped cache invalidation.

Required before Phase 2: Formally approve the rcache-scope:{userId}:{personaId} key pattern in the contract as an auxiliary tracking key. No code change is needed — only a contract amendment acknowledging the pattern.