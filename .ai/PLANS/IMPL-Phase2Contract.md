# Nexus Recall — Phase 2 Implementation Contract

**Version:** 1.0
**Date:** April 1, 2026
**Status:** Active — Implementation Control
**Supersedes:** None
**Governed by:** ARCH-SystemArchitecture.md
**Predecessor:** IMPL-ImplementationContract.md (Phase 1 — remains binding)

---

## 1. Document Purpose

This document is the authoritative implementation control surface for Phase 2 of Nexus Recall. It governs slices S04–S07 exclusively. Phase 1 constraints — as defined in `IMPL-ImplementationContract.md` — remain fully binding unless this document explicitly extends a specific rule.

**Relationship to existing documents:**

- `ARCH-SystemArchitecture.md` — system architecture authority. This document does not modify architecture.
- `IMPL-ImplementationContract.md` — Phase 1 control surface. All Phase 1 boundaries, ownership rules, and interface contracts remain in force.
- Phase 1 audit corrections — the correction pass outcomes are part of the stable baseline. Phase 2 must not regress any correction.

**How builders must use this document:**

- Read this document before writing a single line of Phase 2 code
- Confirm Phase 1 gates still pass before starting any Phase 2 slice
- Follow Phase 2 slice order without exception — do not jump ahead
- Treat every "must not" as an architectural hard constraint, not a suggestion
- Treat every validation gate as a blocking requirement — implementation does not advance until the gate passes
- When uncertain whether something is in scope, default to: not in scope unless explicitly listed here
- Do not consult ARCH-SystemArchitecture.md to expand scope beyond what this document authorizes
- Do not re-read the Phase 1 contract to find loopholes — Phase 1 boundaries are stable

This document describes what Phase 2 must prove, what must be built to prove it, and what must stay out until later phases authorize it.

---

## 2. Phase 2 Goal

Phase 2 must prove a single, concrete thing:

**The ingestion pipeline correctly classifies incoming turns into multiple memory types — including episodic, semantic, and commitment — applies contradiction detection with lineage tracking against existing memories, and the retrieval pipeline returns correctly typed, scored results from a heterogeneous memory set containing all four memory types.**

This means:

- Episodic memories are promoted by the ingestion pipeline from qualifying exchange records
- The classifier distinguishes between semantic, episodic, and commitment-worthy content using structured rules — not an LLM
- Commitment memories are detected conservatively from persona (assistant) output only
- When new content contradicts an existing confirmed memory, the old memory is marked `superseded` and the new memory carries a `lineage_parent_id` pointer to it
- The retrieval pipeline handles all four memory types with correct per-type similarity thresholds and type caps
- Intent alignment filtering is upgraded to apply real alignment rules (not just "exclude commitment")
- The `MemoryObject` response shape is unchanged — no internal metadata leaks
- All Phase 1 latency targets, boundary rules, and module ownership rules remain satisfied
- No LLM invocation is introduced
- No lifecycle, governor, or adaptive behavior is introduced

Phase 2 does not need to prove decay, reinforcement, merging, pruning beyond what Phase 1 stubs provide, confidence gating, governor behavior, or any Phase 3 capability.

---

## 3. Phase 2 Scope

The following capabilities are in scope for Phase 2. Everything not on this list is out of scope.

**Classification upgrade:**
- Replace the Phase 1 rule-based stub classifier with a structured, deterministic classifier
- Classifier must decide: memory type (`semantic`, `episodic`, `commitment`), importance estimate, confidence level, volatility level
- Classifier must operate on exchange content and metadata only — no LLM calls, no external services
- Classification logic lives exclusively inside `memory/ingestion`

**Episodic memory enablement:**
- Ingestion pipeline promotes qualifying exchanges to `episodic` type memories
- Episodic memories participate in retrieval with their own similarity threshold (`SIMILARITY_THRESHOLD_EPISODIC`)
- Episodic memories are subject to the same hard filter sequence, scoring, and type-capped selection

**Commitment detection:**
- Ingestion pipeline detects commitment-like content in `assistant` role turns only
- Commitment memories are promoted with `memory_type = 'commitment'`
- Detection is conservative — precision over recall
- Intent alignment filter is updated to pass `commitment` type when `intent_type` is `task`

**Contradiction handling and lineage:**
- During `embed-and-promote`, the worker checks for existing confirmed memories in the same scope that the new content contradicts
- Contradiction check is scoped to same `(internal_user_id, persona_id)` — never cross-persona
- On contradiction: existing memory is marked `status = 'superseded'`, new memory is written with `lineage_parent_id` pointing to the superseded record
- Only `semantic` and `self` memories are eligible for contradiction (episodic memories are not — they describe events, not facts)
- Contradiction detection is content-similarity-based with a high threshold — it is not semantic reasoning

**Intent alignment upgrade:**
- Phase 1 intent alignment passes all records except `commitment` type
- Phase 2 activates real alignment rules per the architecture intent alignment table
- `IntentAlignmentBias` remains 0.0 — the additive offset is still deferred

**Self memory type:**
- `self` type memories may now be promoted by the classifier when content is self-referential to the persona
- Self memories participate in retrieval with `SIMILARITY_THRESHOLD_SELF`

**Modules modified in Phase 2:**
- `memory/ingestion` — classifier upgrade, contradiction handling, multi-type promotion, commitment detection
- `memory/retrieval` — intent alignment filter upgrade (Filter 6 becomes real)
- `memory/models` — new types only if the classifier or contradiction logic requires them (see §7)
- `src/db/queries/memories.ts` — new query functions for contradiction check and supersession
- `db/migrations/` — only if schema changes are required (see §7)

**Modules NOT modified in Phase 2:**
- `memory/service` — no changes. It remains a thin delegator.
- `memory/cache` — no changes unless a new cache purpose is architecturally required (none is expected)
- `memory/embedding` — no changes. Embedding generation is unchanged.
- `src/config/` — new config vars only if the classifier or contradiction logic requires tunable thresholds (see §7)

---

## 4. Phase 2 Exclusions

The following are explicitly **not permitted** in Phase 2 implementation, regardless of what the architecture document describes for later phases.

**Functional exclusions:**
- Memory decay (time-based strength reduction) — Phase 3
- Memory reinforcement (usage-based strength increase) — Phase 3
- Memory merging (near-duplicate consolidation) — Phase 3
- Active pruning logic (the `prune-scope` worker handler remains a stub)
- Session summarization logic (the `summarize-session` worker handler remains a stub)
- Confidence gating as an active filter (Filter 5 continues to pass all records)
- Governor logic of any kind
- Negative feedback loop
- Recall mode selection
- Dynamic threshold tuning or adaptive retrieval parameter adjustment
- Any LLM invocation — classifier, contradiction detection, commitment detection are all deterministic
- Prompt construction of any kind
- Token counting
- HTTP API gateway
- Horizontal worker scaling
- ML ranking, neural re-ranking, or any learned scoring
- Personalization or per-user parameter adaptation
- Multi-provider embedding routing
- Soft-delete or tombstone patterns (superseded status is not soft-delete — it is a lineage marker)

**Structural exclusions:**
- `memory/lifecycle` module — must not exist in Phase 2
- `memory/governors` module — must not exist in Phase 2
- No new modules beyond the Phase 1 approved structure
- No new BullMQ queues — all jobs remain on the `memory-ingestion` queue
- No new service methods on `MemoryService`
- No new tables (see §7 for schema rules)

**Behavioral exclusions:**
- Smart orchestration inside `memory/service` — the service must not gain branching logic or multi-module coordination
- Cross-persona memory access — contradiction checks are scoped within `(internal_user_id, persona_id)`
- Candidate set expansion — the retrieval Stage 3 candidate set remains fixed at `RETRIEVAL_TOP_N`
- Scoring formula changes — the four-component formula with fixed weights is unchanged
- `IntentAlignmentBias` activation — remains 0.0
- Working memory participation in retrieval — still excluded from all pipeline stages
- `exchanges` table access in the retrieval pipeline — still prohibited

---

## 5. Build Slice Plan

Slices are strictly ordered. A slice may not begin until the preceding slice's validation gate has passed in full. Partial completion of a gate does not unlock the next slice.

**Prerequisite:** All Phase 1 gates (S01, S02, S03) must still pass. If any Phase 1 gate has regressed, it must be fixed before Phase 2 begins.

---

### S04 — Episodic Memory Enablement

**Objective:** The ingestion pipeline can promote qualifying exchanges to `episodic` type memories. Episodic memories appear in retrieval results alongside semantic memories. The retrieval pipeline correctly handles mixed-type result sets. No classifier upgrade yet — episodic promotion uses a simple, explicit rule.

**Why this is first:** Episodic memories require no new detection logic, no contradiction handling, and no changes to ingestion beyond a second promotion path. This slice validates that the pipeline handles multiple memory types end-to-end before introducing classification complexity.

**Modules/files involved:**
- `src/memory/ingestion/index.ts` — add episodic promotion path in `handleEmbedAndPromote`
- `src/db/queries/memories.ts` — add `insertConfirmedEpisodicMemory` query function
- `src/memory/retrieval/index.ts` — verify intent alignment filter handles episodic type (no code change expected — Phase 1 already passes episodic)

**Must be implemented for real:**
- Episodic promotion rule: user-role turns with `content.length >= 50` characters are promoted as `episodic` type. This is a placeholder rule that will be replaced by the classifier in S05.
- `insertConfirmedEpisodicMemory` in `src/db/queries/memories.ts` — parameterized for `memory_type = 'episodic'`, sets `confidence = 'inferred'`, `volatility = 'subjective'`
- `handleClassifyTurn` must now enqueue `embed-and-promote` jobs with a `memoryType` field indicating whether the target type is `semantic` or `episodic`
- `handleEmbedAndPromote` must read the `memoryType` field and call the appropriate insert function
- Retrieval must return episodic memories in mixed-type result sets with correct per-type similarity threshold and type cap

**What changes in job data shapes:**
- `EmbedAndPromoteData` gains a required field: `memoryType: MemoryType`
- `handleClassifyTurn` determines the type and passes it through the job payload

**May remain stubbed:**
- Nothing new is stubbed in S04

**Explicitly forbidden in this slice:**
- Classifier logic beyond the two simple rules (assistant → semantic, user ≥ 50 chars → episodic)
- Commitment detection
- Contradiction handling
- Lineage pointer writes
- Self-type memory promotion
- Changes to `memory/service`
- Changes to `memory/cache`
- Changes to `memory/embedding`
- Changes to the scoring formula
- New config variables (episodic threshold already exists from Phase 1)
- Schema migration changes

**Validation gate — S04 complete when:**
- [ ] `storeMemory()` with a user-role turn of ≥ 50 characters results in a `confirmed` memory record with `memory_type = 'episodic'` in the `memories` table after async processing
- [ ] `storeMemory()` with an assistant-role turn still produces a `semantic` memory (Phase 1 behavior preserved)
- [ ] `storeMemory()` with a user-role turn of < 50 characters does not produce an episodic memory
- [ ] `retrieveMemories()` returns a mixed result set containing both `semantic` and `episodic` memories when both exist for the same scope
- [ ] Episodic memories in the result set have `memory_type = 'episodic'` in the `MemoryObject`
- [ ] Episodic memories are filtered by `SIMILARITY_THRESHOLD_EPISODIC` (not the semantic threshold)
- [ ] Type cap for episodic (max 2) is enforced — a result set never contains more than 2 episodic memories
- [ ] Type cap for semantic (max 2) is still enforced
- [ ] `EmbedAndPromoteData` job payload includes `memoryType` field
- [ ] No changes exist in `memory/service`, `memory/cache`, or `memory/embedding`
- [ ] All Phase 1 validation gates still pass
- [ ] No commitment or self-type memories are created by any code path

---

### S05 — Ingestion Classification Upgrade

**Objective:** Replace the two simple promotion rules (Phase 1 assistant → semantic, S04 user ≥ 50 chars → episodic) with a structured, deterministic classifier. The classifier decides memory type, importance, confidence, and volatility for each exchange turn. No LLM. No external calls.

**Why this is second:** With S04 proving mixed-type handling works, the classifier can now produce richer type assignments knowing the pipeline will handle them. The classifier must exist before contradiction and commitment detection because those features depend on correctly classified content.

**Modules/files involved:**
- `src/memory/ingestion/index.ts` — replace rule stubs in `handleClassifyTurn` with classifier call; update `handleEmbedAndPromote` to use classifier output for all insert parameters
- `src/db/queries/memories.ts` — generalize insert function to accept any memory type (or add per-type variants)

**Must be implemented for real:**
- A `classify` function inside `memory/ingestion` (not a separate module — classification is ingestion's responsibility)
- The classifier accepts an exchange record and returns a classification result:
  ```
  { memoryType: MemoryType | null, importance: number, confidence: ConfidenceLevel, volatility: VolatilityLevel }
  ```
- `memoryType = null` means the turn is not promotable — discard, done
- Classification rules (deterministic, no LLM):
  - **Semantic:** Assistant-role turns containing declarative, factual, or instructional content. Heuristic: assistant turns that are not questions, not greetings, not meta-conversational, and exceed a minimum content length (configurable, default 20 chars). `confidence = 'inferred'`, `volatility` = `'factual'` if content contains definitive language, `'subjective'` otherwise. `importance` = 0.5 default, boosted to 0.7 if content appears instructional.
  - **Episodic:** User-role turns describing events, experiences, or personal narrative. Heuristic: user turns exceeding minimum length (configurable, default 50 chars) that are not simple questions or commands. `confidence = 'inferred'`, `volatility = 'subjective'`. `importance` = 0.4 default.
  - **Self:** Assistant-role turns where the persona references itself, its capabilities, preferences, or identity. Heuristic: assistant turns containing first-person self-referential patterns ("I am", "I prefer", "I can", "my purpose", etc.). `confidence = 'inferred'`, `volatility = 'subjective'`. `importance` = 0.6 default.
  - **Commitment** is NOT classified here — it is deferred to S07.
  - Turns that match no category return `null` — they are not promoted.
- `handleEmbedAndPromote` uses the full classification output: `memoryType`, `importance`, `confidence`, `volatility`
- `EmbedAndPromoteData` job payload is extended to carry the full classification output
- Insert function(s) in `src/db/queries/memories.ts` must accept the classified parameters rather than using hardcoded defaults

**New config variables (optional with defaults):**
- `CLASSIFIER_MIN_SEMANTIC_LENGTH` — default: 20. Must be a positive integer.
- `CLASSIFIER_MIN_EPISODIC_LENGTH` — default: 50. Must be a positive integer.

**May remain stubbed:**
- Commitment classification — returns `null` for any content that would be a commitment. S07 activates this.

**Explicitly forbidden in this slice:**
- LLM calls from the classifier
- External API calls from the classifier
- NLP library dependencies (the classifier uses string patterns and heuristics only)
- Commitment memory promotion — the classifier must not produce `memoryType = 'commitment'` in S05
- Contradiction handling — no supersession logic
- Lineage pointer writes
- Changes to `memory/service`
- Changes to `memory/cache`
- Changes to `memory/embedding`
- Changes to the retrieval pipeline (retrieval already handles all four types)
- A separate `memory/classification` module — classification lives inside `memory/ingestion`
- Regex-heavy or "NLP-lite" pattern matching that tries to do semantic understanding — keep heuristics simple and conservative
- Classifier returning `memoryType` for content it is not confident about — when in doubt, return `null`

**Validation gate — S05 complete when:**
- [ ] Assistant turn with declarative content (e.g., "The capital of France is Paris") produces a `semantic` memory with `confidence = 'inferred'`, `volatility = 'factual'`
- [ ] Assistant turn with subjective content (e.g., "I think the movie was good") produces a `semantic` memory with `volatility = 'subjective'`
- [ ] User turn with personal narrative (e.g., "Yesterday I went to the park with my family and we had a picnic") produces an `episodic` memory
- [ ] User turn that is a short question (e.g., "What time is it?") produces no memory
- [ ] Assistant turn containing self-referential content (e.g., "I am designed to help with coding tasks") produces a `self` memory with `importance = 0.6`
- [ ] Short assistant turn (e.g., "Ok") produces no memory
- [ ] No turn produces a `commitment` type memory — classifier returns `null` for commitment-like content
- [ ] Classified `importance`, `confidence`, and `volatility` values are written to the `memories` table correctly (not hardcoded defaults)
- [ ] `CLASSIFIER_MIN_SEMANTIC_LENGTH` and `CLASSIFIER_MIN_EPISODIC_LENGTH` are read from config
- [ ] No LLM calls, no external API calls in the classification path
- [ ] No changes exist in `memory/service`, `memory/cache`, `memory/embedding`, or `memory/retrieval`
- [ ] All Phase 1 and S04 validation gates still pass
- [ ] Classifier function is defined and called exclusively within `src/memory/ingestion/`

---

### S06 — Contradiction Handling and Lineage

**Objective:** When the ingestion pipeline promotes a new memory that contradicts an existing confirmed memory in the same scope, the old memory is marked `superseded` and the new memory carries a `lineage_parent_id` pointer. The retrieval pipeline already excludes non-confirmed memories via the graduation gate; superseded memories are additionally excluded because their `status` is no longer `active`. No new retrieval logic is required.

**Why this is third:** Contradiction detection requires the classifier (S05) to produce correctly typed memories, and it requires episodic handling (S04) to be stable. Self-type memories — which are contradiction-eligible — are also being produced by S05.

**Modules/files involved:**
- `src/memory/ingestion/index.ts` — add contradiction check in `handleEmbedAndPromote`, before or after memory insert
- `src/db/queries/memories.ts` — add query functions: `findContradictionCandidates`, `markSuperseded`
- `src/memory/retrieval/index.ts` — Filter 1 (graduation gate) must be extended to also exclude `status != 'active'`. This is a single additional predicate on the existing filter — not a new stage, not a new filter, not a restructuring. No other retrieval changes are permitted in S06.

**Must be implemented for real:**
- Contradiction detection in `handleEmbedAndPromote`:
  1. After embedding the new content, query for existing `confirmed` memories in the same `(internal_user_id, persona_id)` scope with the same `memory_type`
  2. Only `semantic` and `self` types are contradiction-eligible. Episodic and commitment memories are not.
  3. Compute cosine similarity between the new embedding and each candidate's embedding
  4. If similarity exceeds a contradiction threshold (configurable, default 0.92), the existing memory is a contradiction candidate
  5. Among contradiction candidates, select the one with the highest similarity
  6. Mark the selected existing memory `status = 'superseded'`
  7. Insert the new memory with `lineage_parent_id` pointing to the superseded record's `id`
  8. If no contradiction candidate is found, insert the new memory without a lineage pointer (existing behavior)
- `findContradictionCandidates` SQL function in `src/db/queries/memories.ts`:
  - Query: select `id`, `embedding` from `memories` where `internal_user_id = $1 AND persona_id = $2 AND memory_type = $3 AND status = 'active' AND graduation_status = 'confirmed'`
  - This query must include the scope predicate — no global queries
- `markSuperseded` SQL function: `UPDATE memories SET status = 'superseded' WHERE id = $1 AND internal_user_id = $2 AND persona_id = $3 RETURNING id`
  - Must include scope predicate — a memory cannot be superseded cross-scope
- Retrieval cache invalidation must be called after any supersession write (already required by Phase 1 rules)
- Insert function must accept `lineage_parent_id` as an optional parameter

**New config variables:**
- `CONTRADICTION_SIMILARITY_THRESHOLD` — default: 0.92. Must be a float in (0, 1). Controls how similar two memories must be to be considered contradictory.

**May remain stubbed:**
- Nothing is stubbed in S06

**Explicitly forbidden in this slice:**
- Contradiction detection for `episodic` or `commitment` type memories
- Cross-persona contradiction checks — scope `(internal_user_id, persona_id)` is mandatory on every query
- LLM-based contradiction detection — similarity threshold only
- Semantic reasoning about whether content "means the opposite" — this is purely an embedding similarity check above a threshold
- Merging logic — a contradiction supersedes; it does not merge
- Deleting the superseded record — it remains in the database with `status = 'superseded'`
- Chains of supersession in a single job — one `embed-and-promote` job supersedes at most one existing memory
- Changes to `memory/service`
- Changes to `memory/cache`
- Changes to `memory/embedding`
- Changes to the scoring formula or retrieval Stage 3 query
- New pipeline stages, new hard filters, or reordering of existing filters — the only retrieval change permitted in S06 is extending Filter 1 with a `status = 'active'` predicate
- Hard-delete of superseded records (that is pruning — Phase 3)
- Any "undo supersession" or recovery path

**Validation gate — S06 complete when:**
- [ ] A new `semantic` memory with embedding similarity > 0.92 to an existing confirmed `semantic` memory in the same scope causes the existing memory to be marked `status = 'superseded'`
- [ ] The new memory has `lineage_parent_id` pointing to the superseded memory's `id`
- [ ] A new `self` memory that contradicts an existing confirmed `self` memory follows the same supersession behavior
- [ ] A new `episodic` memory with high similarity to an existing episodic memory does NOT trigger supersession — episodic is not contradiction-eligible
- [ ] A new semantic memory with similarity 0.90 to an existing semantic memory (below threshold) does NOT trigger supersession
- [ ] Superseded memories do not appear in retrieval results (verified via `retrieveMemories()`)
- [ ] The lineage pointer in the new memory references a valid `id` in the same scope
- [ ] `findContradictionCandidates` query includes `internal_user_id` and `persona_id` predicates
- [ ] `markSuperseded` query includes `internal_user_id` and `persona_id` predicates
- [ ] Retrieval cache is invalidated after any supersession write
- [ ] `CONTRADICTION_SIMILARITY_THRESHOLD` is read from config, not hardcoded
- [ ] No changes exist in `memory/service`, `memory/cache`, or `memory/embedding`
- [ ] Only change in `memory/retrieval` is the addition of `status = 'active'` predicate to Filter 1 — no other retrieval modifications
- [ ] All Phase 1, S04, and S05 validation gates still pass
- [ ] No cross-persona scope access in any contradiction query

---

### S07 — Commitment Detection

**Objective:** The classifier detects commitment-like content in assistant-role turns and promotes them as `commitment` type memories. Intent alignment in the retrieval pipeline is upgraded to apply real alignment rules. Commitments are retrievable when intent matches.

**Why this is last:** Commitment detection depends on the classifier (S05) being stable and on contradiction handling (S06) being in place — because commitments are not contradiction-eligible, the system must already know how to distinguish eligible from ineligible types.

**Modules/files involved:**
- `src/memory/ingestion/index.ts` — activate commitment classification branch in classifier; update `handleEmbedAndPromote` to handle commitment type
- `src/db/queries/memories.ts` — ensure insert function handles `memory_type = 'commitment'`
- `src/memory/retrieval/index.ts` — upgrade Filter 6 (intent alignment) to real alignment rules

**Must be implemented for real:**
- Commitment classification rule in the classifier:
  - Only applies to `assistant` role turns
  - Heuristic: content containing explicit promise/commitment language ("I will", "I'll make sure", "I promise", "I'll remember", "I won't forget", "let me make sure to", "I'll follow up")
  - Pattern list must be configurable or at minimum defined as a constant array in the classifier — not scattered inline
  - `confidence = 'explicit'` (commitments are by definition explicit statements)
  - `volatility = 'factual'` (a commitment is a stated fact about future behavior)
  - `importance = 0.8` (commitments are high-importance by default)
  - If content matches both semantic and commitment patterns, commitment takes precedence
- Commitment memories are NOT contradiction-eligible (already enforced by S06 — `commitment` is excluded from contradiction check)
- Intent alignment upgrade in `memory/retrieval` Filter 6:
  - Phase 1 behavior: exclude `commitment` type unconditionally
  - Phase 2 behavior:
    - `intent_type = 'task'`: pass all types including `commitment`
    - `intent_type = 'conversational'`: pass `semantic`, `episodic`, `self`; exclude `commitment`
    - `intent_type = 'emotional'`: pass `semantic`, `episodic`, `self`; exclude `commitment`
  - This is the full intent alignment table. `IntentAlignmentBias` remains 0.0.
- Type cap for commitment (max 1) is already defined and enforced — no change needed

**May remain stubbed:**
- Nothing is stubbed in S07

**Explicitly forbidden in this slice:**
- LLM-based commitment detection
- Commitment detection on `user` role turns — commitments are persona output only
- Permissive pattern matching that flags casual language as commitments (e.g., "I'll try" should NOT match — it is hedged, not a commitment)
- `IntentAlignmentBias` activation — remains 0.0
- Confidence gating activation — Filter 5 still passes all records
- Governor logic of any kind
- Changes to `memory/service`
- Changes to `memory/cache`
- Changes to `memory/embedding`
- Changes to the scoring formula
- Commitment contradiction detection — commitments are not contradiction-eligible

**Validation gate — S07 complete when:**
- [ ] Assistant turn containing "I will send you the report tomorrow" produces a `commitment` memory with `confidence = 'explicit'`, `volatility = 'factual'`, `importance = 0.8`
- [ ] Assistant turn containing "I think that might work" does NOT produce a commitment memory
- [ ] User turn containing "I will do this later" does NOT produce a commitment memory (wrong role)
- [ ] Assistant turn containing "I'll try to look into it" does NOT produce a commitment memory (hedged language)
- [ ] `retrieveMemories()` with `intent_type = 'task'` returns commitment memories when they match the query
- [ ] `retrieveMemories()` with `intent_type = 'conversational'` does NOT return commitment memories
- [ ] `retrieveMemories()` with `intent_type = 'emotional'` does NOT return commitment memories
- [ ] Type cap for commitment (max 1) is enforced in result sets
- [ ] Commitment memories are NOT subject to contradiction detection (high-similarity commitment does not supersede anything)
- [ ] A turn that matches both semantic and commitment patterns produces a commitment memory (commitment precedence)
- [ ] Intent alignment filter in retrieval correctly applies all three intent-type rules
- [ ] `IntentAlignmentBias` is still 0.0 — not activated
- [ ] No changes exist in `memory/service`, `memory/cache`, or `memory/embedding`
- [ ] All Phase 1, S04, S05, and S06 validation gates still pass

---

## 6. Module/Ownership Rules for Phase 2

Phase 2 does not change module ownership. All Phase 1 ownership rules remain binding. This section clarifies where Phase 2 capabilities must live.

**Classification logic** — lives exclusively inside `src/memory/ingestion/index.ts`. There is no `memory/classification` module. The classifier is a function within ingestion, called by `handleClassifyTurn`. It does not have its own module, its own file outside ingestion, or its own interface exposed to other modules.

**Episodic memory handling** — the promotion path lives in `memory/ingestion` (embed-and-promote handler). The insert SQL lives in `src/db/queries/memories.ts`. The retrieval pipeline handles episodic memories the same way it handles semantic — no special episodic logic in `memory/retrieval` beyond what the existing per-type thresholds and caps already provide.

**Contradiction handling** — lives in `memory/ingestion` within the `handleEmbedAndPromote` handler. Contradiction candidate queries live in `src/db/queries/memories.ts`. Supersession writes live in `src/db/queries/memories.ts`. No contradiction logic exists in any other module.

**Commitment detection** — lives in the classifier function inside `memory/ingestion`. There is no separate commitment detection module. The retrieval pipeline's intent alignment filter (Filter 6 in `memory/retrieval`) is updated to apply real alignment rules, but the detection itself is ingestion-only.

**Ingestion module structural constraint** — `memory/ingestion` absorbs multiple responsibilities in Phase 2 (classification, contradiction, commitment detection, episodic/self promotion). This is acceptable because these are sequential steps in a single-pass processing flow, not independent sub-systems. The ingestion module must not evolve into a generalized orchestration layer. Its internal structure must remain: classify → embed → detect contradiction → promote. No internal pipeline abstraction, no dynamic dispatch, no nested sub-system architecture. See §11 rule 11 for the full constraint.

**Modules that must NOT absorb new responsibilities:**

| Module | Phase 2 change allowed |
|---|---|
| `memory/service` | None. Zero logic changes. |
| `memory/cache` | None expected. |
| `memory/embedding` | None. |
| `memory/models` | New types only if required by classifier output or contradiction flow. |
| `memory/retrieval` | Filter 1 status predicate extension (S06) and Filter 6 intent alignment upgrade (S07) only. No other changes. |
| `src/config/` | New config vars with defaults only. |
| `src/queue/` | No changes. Worker routes to `memory/ingestion.processJob()` — unchanged. |

---

## 7. Data/Schema Contract for Phase 2

### Schema changes

**No new tables are permitted in Phase 2.**

The existing `memories` and `exchanges` tables are sufficient for all Phase 2 capabilities.

**No new columns are permitted on the `memories` table.** Phase 2 uses existing columns:
- `memory_type` — already supports all four types via check constraint
- `status` — `'superseded'` is already a valid value via check constraint
- `lineage_parent_id` — already exists as a nullable UUID foreign key
- `importance`, `confidence`, `volatility` — already exist; S05 writes non-default values

**No new columns are permitted on the `exchanges` table.**

**No schema migration files are expected for Phase 2.** If a migration is genuinely required (which it should not be), it must be justified against this section, reviewed, and numbered `002_*.sql`.

### Query changes

New SQL functions are permitted in `src/db/queries/memories.ts`:
- `insertConfirmedEpisodicMemory` (or a generalized `insertConfirmedMemory` that accepts type)
- `findContradictionCandidates`
- `markSuperseded`

These must follow the same rules as Phase 1 queries:
- Include scope predicates (`internal_user_id`, `persona_id`) in every query
- Live exclusively in `src/db/queries/`
- No SQL strings outside `src/db/queries/`
- Return typed results, not raw row objects

### Config changes

New config variables permitted in Phase 2:

| Variable | Default | Validation | Slice |
|---|---|---|---|
| `CONTRADICTION_SIMILARITY_THRESHOLD` | `0.92` | Float in (0, 1) | S06 |
| `CLASSIFIER_MIN_SEMANTIC_LENGTH` | `20` | Positive integer | S05 |
| `CLASSIFIER_MIN_EPISODIC_LENGTH` | `50` | Positive integer | S05 |

All are optional with defaults. None are required. They must be added to the `Config` singleton with startup validation of type and range.

---

## 8. Classification Rules

### What classification must decide

For each exchange turn processed by `classify-turn`, the classifier must produce one of:
- A classification result: `{ memoryType, importance, confidence, volatility }`
- `null` — meaning the turn is not promotable

### What is acceptable classification for Phase 2

- **Deterministic heuristics only.** The classifier uses string length checks, keyword/phrase pattern matching, and role-based rules.
- **Conservative by default.** When uncertain, classify as `null` (do not promote). False negatives are acceptable; false positives create bad memories.
- **No learning, no adaptation.** The classifier produces the same output for the same input every time.
- **No external dependencies.** The classifier must not call APIs, read files, query the database (beyond the exchange record passed to it), or invoke any external service.
- **Flat decision tree.** The classifier is a function with conditional branches — not a pipeline, not a framework, not a pluggable system.

### What must NOT happen in classification

- **No LLM calls.** Not even "just for this one type." If it calls an LLM, it is a Phase 3+ classifier.
- **No NLP library imports.** No tokenizers, no POS taggers, no named entity recognition. String methods and regex only.
- **No vague extraction.** The classifier does not "extract topics," "identify themes," or "determine sentiment." It classifies a turn into a type or rejects it.
- **No multi-memory extraction.** One exchange turn produces at most one memory. The classifier does not split turns into multiple memories.
- **No training data, configuration files, or JSON rule definitions.** Rules are code.
- **No abstraction frameworks.** No `ClassifierStrategy`, no `ClassifierPlugin`, no registration pattern. One function. Branches. Return value.
- **No import of the classifier from outside `memory/ingestion`.** The classifier is not a shared utility.

---

## 9. Contradiction/Lineage Rules

### Scope isolation

Contradiction detection is strictly scoped to `(internal_user_id, persona_id)`. A memory in scope A cannot contradict or supersede a memory in scope B. Every query involved in contradiction detection must include both scope fields.

### What contradiction detection does

1. After embedding new content, query for existing confirmed memories in the same scope and same type
2. Compute cosine similarity between new embedding and each candidate embedding
3. If any candidate exceeds `CONTRADICTION_SIMILARITY_THRESHOLD` (default 0.92), select the highest-similarity candidate
4. Mark the selected candidate `status = 'superseded'`
5. Insert the new memory with `lineage_parent_id = superseded.id`

### Eligible memory types

- **Semantic:** Contradiction-eligible. A new semantic fact can supersede an old one.
- **Self:** Contradiction-eligible. A new self-description can supersede an old one.
- **Episodic:** NOT eligible. Events happened — they are not "corrected" by new events.
- **Commitment:** NOT eligible. A new commitment does not supersede an old one.

### Superseded status handling

- `status = 'superseded'` means the memory has been replaced by a newer version
- Superseded memories remain in the database — they are not deleted
- Superseded memories are excluded from retrieval by the hard filter pipeline
- The retrieval pipeline's Stage 3 candidate query does not currently filter by status — superseded records may appear in the candidate set
- The existing graduation gate (Filter 1: `graduation_status = 'confirmed'`) will not exclude superseded records because superseded records can have `graduation_status = 'confirmed'`. **Filter 1 must be extended to also exclude `status != 'active'`.** This is implemented by adding an `AND status = 'active'` condition to the existing Filter 1 check — not by creating a new filter stage, not by inserting a stage before Filter 1, and not by reordering filters. The eight-stage pipeline structure and the six hard filters in their defined order are unchanged. The graduation gate gains one additional predicate. That is the full extent of the permitted retrieval change in S06.

### Lineage pointer rules

- `lineage_parent_id` points from the new (active) memory to the old (superseded) memory
- The pointer is within the same `(internal_user_id, persona_id)` scope — this is enforced by the foreign key and by query-level scope predicates
- One memory has at most one `lineage_parent_id` — no multi-parent lineage
- Lineage chains are permitted (A supersedes B, later C supersedes A) but are not actively traversed in Phase 2
- Lineage is informational in Phase 2 — no behavior depends on traversing the chain

### What is NOT allowed

- Cross-persona supersession
- Superseding records with different `memory_type` (semantic cannot supersede self, or vice versa)
- Deleting superseded records (that is pruning — Phase 3)
- "Undo" or recovery of superseded status
- Semantic reasoning about contradiction — this is similarity-only
- Multiple supersessions per embed-and-promote job — at most one
- Lineage traversal for retrieval scoring or filtering

---

## 10. Commitment Detection Rules

### Detection scope

Commitment detection applies exclusively to **assistant-role** turns. The persona makes commitments. The user does not (from the memory system's perspective — user statements are event-like, not commitment-like).

### Detection precision

**Precision is more important than recall.** A missed commitment is acceptable — it may be caught on a future turn. A false positive creates a commitment memory the persona does not intend to honor, which damages trust. When in doubt, do not classify as commitment.

### Detection approach

Pattern matching against explicit commitment language:
- "I will [verb]" — but NOT "I will try" or "I will see"
- "I'll make sure to [verb]"
- "I promise"
- "I'll remember"
- "I won't forget"
- "Let me make sure to [verb]"
- "I'll follow up on"

**Exclusion patterns** (must NOT trigger commitment detection):
- "I'll try" — hedged
- "I might" — uncertain
- "I could" — conditional
- "I think I'll" — speculative
- "If possible, I'll" — conditional
- Any content in a question form

### Commitment memory properties

| Field | Value |
|---|---|
| `memory_type` | `'commitment'` |
| `confidence` | `'explicit'` |
| `volatility` | `'factual'` |
| `importance` | `0.8` |

### Precedence

If a turn matches both semantic and commitment patterns, commitment takes precedence. Commitment is a more specific classification.

### What is NOT allowed

- Commitment detection on user-role turns
- LLM-based detection
- Fuzzy or "maybe" classifications — the pattern either matches definitively or it does not
- Detecting implied commitments from context ("The assistant seemed to agree" — no)
- Self-referential turn-pair analysis (looking at what the user asked and inferring the assistant committed to it) — commitment must be explicit in the assistant turn alone
- Commitment contradiction detection — commitments do not supersede each other

---

## 11. Boundary Enforcement Rules

All Phase 1 boundary enforcement rules (§11 of `IMPL-ImplementationContract.md`) remain in full force. The following are additional Phase 2 boundary emphasis points.

### Reinforced boundaries

1. **`memory/service` must not change in Phase 2.** No new logic, no new branching, no new helper methods. If a builder finds themselves editing `memory/service` during Phase 2, the capability belongs in the owning module. This is the single most important boundary in Phase 2.

2. **Classification logic must not leak out of `memory/ingestion`.** The classifier is a function inside ingestion. It does not have its own module. It is not imported by retrieval, service, embedding, or cache. No module calls the classifier except `handleClassifyTurn` inside `memory/ingestion`.

3. **Contradiction queries must live in `src/db/queries/memories.ts`.** Ingestion calls query functions — it does not contain SQL. This is the same rule as Phase 1, applied to new queries.

4. **Retrieval pipeline changes are limited to two localized filter modifications: extending Filter 1 with a status predicate (S06) and upgrading Filter 6 intent alignment rules (S07).** No new pipeline stages may be introduced. No existing stages may be reordered, removed, or restructured. No new hard filters may be added to the six-filter sequence. The scoring formula is unchanged. The candidate query is unchanged. The type caps are unchanged. The eight-stage pipeline structure is frozen.

5. **No new modules.** Phase 2 does not create `memory/classification/`, `memory/contradiction/`, `memory/commitment/`, `memory/lifecycle/`, `memory/governors/`, or any other new module directory. All new behavior lives inside existing modules per their ownership.

6. **No new BullMQ queues or job types.** The existing `memory-ingestion` queue handles all jobs. The existing job types (`classify-turn`, `embed-and-promote`, `bookkeeping`, `prune-scope`, `summarize-session`) remain unchanged. No new job types are added. The `embed-and-promote` job carries richer data, but it is the same job type.

7. **`memory/cache` does not gain contradiction or classification responsibilities.** No new cache purposes are added for contradiction candidates or classification results. These are transient computations — they do not need caching.

8. **`memory/embedding` does not change.** It generates embeddings. Phase 2 logic calls `embed()` the same way Phase 1 does. No additional methods, no additional behavior.

9. **SQL isolation is absolute.** New queries for contradiction detection and supersession live in `src/db/queries/memories.ts`. No SQL strings appear in `memory/ingestion` or any other module file.

10. **Scope predicates are mandatory on all new queries.** Every new query in Phase 2 must include `WHERE internal_user_id = $1 AND persona_id = $2`. A query without scope predicates is a boundary violation.

11. **`memory/ingestion` must remain a single-pass pipeline.** Phase 2 adds classification, contradiction detection, and commitment detection to ingestion. These are sequential steps within the existing job handlers — they are not sub-systems. The ingestion flow is strictly: classify → embed → detect contradiction (if eligible type) → promote. Each step is a function call within the handler, not a nested pipeline, not a sub-orchestrator, not a dynamic dispatch system. Specifically:
    - No internal pipeline framework or stage abstraction within ingestion
    - No dynamic handler registration or strategy-pattern dispatch
    - No internal event system or pub/sub within the module
    - No branching architecture where different memory types follow fundamentally different processing paths — the linear flow applies to all types, with type-specific logic expressed as conditional branches within each step
    - No nested job enqueueing from within `embed-and-promote` (contradiction detection and memory insertion happen inline in the handler, not as separate jobs)
    - `handleClassifyTurn` and `handleEmbedAndPromote` remain the two primary handlers; they grow in capability but do not spawn sub-handlers or delegate to internal orchestration layers
    - If `memory/ingestion/index.ts` grows beyond maintainability, extraction of pure helper functions (e.g., `classify`, `detectContradiction`) within the same file is acceptable. Extraction into separate files within `memory/ingestion/` is acceptable only if those files are private implementation details that are not imported by any module outside `memory/ingestion/`. Extraction into a new top-level module is never acceptable.

---

## 12. Validation Gates

### Consolidated gates for Phase 2

All gates from previous slices must still pass when a later slice is validated. Phase 2 does not replace Phase 1 gates.

### S04 Gate — Episodic Memory Enablement

- [ ] User-role turn ≥ 50 chars → `episodic` memory created after async processing
- [ ] Assistant-role turn → `semantic` memory created (Phase 1 behavior preserved)
- [ ] User-role turn < 50 chars → no episodic memory created
- [ ] `retrieveMemories()` returns mixed `semantic` + `episodic` result set
- [ ] Episodic memories filtered by `SIMILARITY_THRESHOLD_EPISODIC`
- [ ] Type cap enforcement: max 2 episodic, max 2 semantic
- [ ] `EmbedAndPromoteData` includes `memoryType` field
- [ ] No changes in `memory/service`, `memory/cache`, `memory/embedding`
- [ ] No commitment or self-type memories created
- [ ] All Phase 1 gates pass

### S05 Gate — Classification Upgrade

- [ ] Declarative assistant turn → `semantic` with `volatility = 'factual'`
- [ ] Subjective assistant turn → `semantic` with `volatility = 'subjective'`
- [ ] User narrative turn → `episodic`
- [ ] Short question → no memory
- [ ] Self-referential assistant turn → `self` with `importance = 0.6`
- [ ] Short assistant turn → no memory
- [ ] No commitment memories produced
- [ ] `importance`, `confidence`, `volatility` values written correctly from classifier output
- [ ] `CLASSIFIER_MIN_SEMANTIC_LENGTH` and `CLASSIFIER_MIN_EPISODIC_LENGTH` sourced from config
- [ ] No LLM or external API calls in classification
- [ ] Classifier defined and called exclusively within `memory/ingestion`
- [ ] No changes in `memory/service`, `memory/cache`, `memory/embedding`, `memory/retrieval`
- [ ] All Phase 1 and S04 gates pass

### S06 Gate — Contradiction Handling and Lineage

- [ ] High-similarity semantic memory supersedes existing → `status = 'superseded'`, `lineage_parent_id` set
- [ ] High-similarity self memory supersedes existing → same behavior
- [ ] High-similarity episodic memory does NOT supersede
- [ ] Below-threshold similarity does NOT supersede
- [ ] Superseded memories excluded from retrieval results
- [ ] Lineage pointer references valid `id` in same scope
- [ ] `findContradictionCandidates` includes scope predicates
- [ ] `markSuperseded` includes scope predicates
- [ ] Retrieval cache invalidated after supersession
- [ ] `CONTRADICTION_SIMILARITY_THRESHOLD` from config
- [ ] No changes in `memory/service`, `memory/cache`, `memory/embedding`
- [ ] Retrieval pipeline change limited to extending Filter 1 with `status = 'active'` predicate — no new stages, no new filters, no pipeline restructuring
- [ ] All Phase 1, S04, S05 gates pass

### S07 Gate — Commitment Detection

- [ ] Explicit commitment assistant turn → `commitment` memory with `confidence = 'explicit'`, `importance = 0.8`
- [ ] Hedged language ("I'll try") → no commitment memory
- [ ] User-role commitment language → no commitment memory
- [ ] `intent_type = 'task'` retrieval returns commitment memories
- [ ] `intent_type = 'conversational'` retrieval excludes commitment memories
- [ ] `intent_type = 'emotional'` retrieval excludes commitment memories
- [ ] Type cap for commitment (max 1) enforced
- [ ] Commitment not subject to contradiction detection
- [ ] Semantic/commitment precedence: dual-match → commitment wins
- [ ] Intent alignment filter applies all three intent-type rules
- [ ] `IntentAlignmentBias` = 0.0 (not activated)
- [ ] No changes in `memory/service`, `memory/cache`, `memory/embedding`
- [ ] All Phase 1, S04, S05, S06 gates pass

---

## 13. Builder Warnings / Common Failure Modes

These are the most likely ways Phase 2 will go wrong. Address them preemptively.

---

**1. Classifier overreach.**
The builder will want the classifier to be "smart." They will add sentiment analysis, topic extraction, keyword weighting, or a scoring system. The Phase 2 classifier is a flat function with conditional branches. It checks role, length, and pattern presence. It returns a type or null. If the classifier function exceeds ~100 lines, it is overbuilt. If it has more than one level of abstraction, it is overbuilt. If it requires its own test suite with edge case matrices, it is overbuilt.

**2. Creating a `memory/classification` module.**
Classification belongs inside `memory/ingestion`. A builder will want to "separate concerns" and create a classification module. Do not do this. The architecture does not define this module. The ingestion module owns turn classification. Extracting it creates a module that only one caller uses, adds an unnecessary import boundary, and invites future scope expansion.

**3. Contradiction detection becoming semantic reasoning.**
A builder will look at the 0.92 similarity threshold and think "that's too simple — what if two memories say opposite things but use different words?" This is Phase 3 concern territory. Phase 2 contradiction detection is embedding-similarity-only. If the embeddings are not similar enough, there is no contradiction. The threshold handles the "same topic, updated fact" case. It does not handle the "semantically opposite" case. That is intentional.

**4. Commitment detection being too permissive.**
The builder will want to "catch more commitments." They will lower the bar to include "I'll try," "I might," "I should." These are not commitments — they are hedged language. A false positive commitment creates a memory the persona "promised" something it did not. Precision over recall. If the pattern list is longer than ~10 explicit patterns, it is probably too permissive.

**5. Adding logic to `memory/service`.**
"Just a small check." "Just a type guard." "Just a default." No. `memory/service` does not change in Phase 2. If the builder is typing in `memory/service/index.ts`, they are in the wrong file. Redirect to the owning module.

**6. Superseded handling in retrieval becoming complex.**
A builder may add a "superseded" filter stage, a lineage-aware scorer, or a "latest version" resolver to the retrieval pipeline. Do not do this. The eight-stage pipeline structure is frozen. The six hard filters remain exactly six. The only permitted changes are: (a) extending Filter 1's existing predicate to also check `status = 'active'`, and (b) upgrading Filter 6 intent alignment rules in S07. No new stages, no new filters, no reordering. A builder who creates a new function called `filterSuperseded` or inserts a "Stage 4.5" has violated the pipeline structure.

**7. Broadening contradiction eligibility.**
"Episodic memories should be contradiction-eligible because a user might correct a past event description." No. Episodic memories describe events. A correction to "I went to the park yesterday" is a new episodic memory — it does not supersede the old one. Contradiction is for factual/declarative content (`semantic`, `self`) only.

**8. Job type proliferation.**
A builder will want to add `contradiction-check` or `classify-memory` as new job types. No. The existing `classify-turn` and `embed-and-promote` job types are sufficient. Classification happens inside `classify-turn`. Contradiction detection happens inside `embed-and-promote`. No new job types.

**9. Config variable proliferation.**
Phase 2 introduces at most three new config variables. A builder will want to add `COMMITMENT_IMPORTANCE_DEFAULT`, `EPISODIC_IMPORTANCE_DEFAULT`, `SELF_IMPORTANCE_DEFAULT`, `MAX_CONTRADICTION_CANDIDATES`, etc. These are not configurable — they are implementation constants. Only values that a deployer would reasonably need to tune are config variables.

**10. Sneaking Phase 3 behavior into Phase 2.**
Decay, reinforcement, merging, active pruning, confidence gating, governors — all Phase 3. A builder implementing contradiction handling will think "while I'm here, I should also handle merging for near-duplicates below the contradiction threshold." No. If the similarity is below the contradiction threshold, nothing happens. The record is inserted without lineage.

**11. Modifying the scoring formula.**
"Commitment memories should score higher." "Episodic memories need a recency boost." No. The scoring formula is:
`Score = (Similarity × 0.6) + (Recency × 0.2) + (Importance × 0.1) + (Strength × 0.1)`
with `IntentAlignmentBias = 0.0`. This formula does not change in Phase 2. If commitment memories need to rank higher, they should have higher `importance` (which they do: 0.8). The formula handles this.

**12. Using the `exchanges` table in contradiction detection.**
Contradiction detection operates on the `memories` table only. A builder may want to look at recent exchanges to "understand context." The `exchanges` table is not accessed during embed-and-promote beyond the initial exchange record fetch. Contradiction candidates come from `memories`.

**13. Ingestion becoming an internal framework.**
As classification, contradiction detection, and commitment handling are added to `memory/ingestion`, a builder will be tempted to introduce "clean architecture" inside the module: a `ClassificationStage`, a `ContradictionStage`, a `PromotionStage`, a pipeline runner that chains them. Do not do this. The ingestion module is a set of job handlers with sequential function calls inside them. Classification is a function call. Contradiction detection is a function call. Promotion is a function call. They execute in order inside `handleClassifyTurn` and `handleEmbedAndPromote`. There is no internal pipeline framework, no stage abstraction, no registration pattern, no dynamic dispatch. If the builder creates an `IngestionPipeline` class, a `Stage` interface, or a `handlers/` subdirectory with independently dispatchable units, the module has become an internal framework and must be simplified.

---

## 14. Recommended Next Prompt

The next builder prompt should target **S04 only**. It must not reference S05, S06, S07, or any behavior beyond what S04 requires.

The prompt should instruct the builder to:

1. Read this document (`IMPL-Phase2Contract.md`) and confirm the S04 objective
2. Add an `insertConfirmedEpisodicMemory` function (or generalize the existing insert) in `src/db/queries/memories.ts`
3. Extend `EmbedAndPromoteData` in `src/memory/ingestion/index.ts` to include a `memoryType` field
4. Update `handleClassifyTurn` to determine memory type: assistant turns → `semantic`, user turns ≥ 50 chars → `episodic`, user turns < 50 chars → discard
5. Update `handleEmbedAndPromote` to use the `memoryType` from the job payload when inserting
6. Verify the S04 validation gate in §12 of this document, item by item
7. Verify all Phase 1 gates still pass
8. Stop at the S04 gate — do not begin S05 work

The prompt must explicitly reference this document and the Phase 1 contract as authoritative sources. It must direct the builder not to implement classification logic, contradiction handling, or commitment detection.

---

*End of Phase 2 Implementation Contract Document. No Phase 2 implementation begins until this document has been reviewed and accepted.*
