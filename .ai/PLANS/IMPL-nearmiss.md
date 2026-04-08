# Plan: Instrumentation, Near-Miss Debug, Canonicalization, Safety Valve (v2 — Refined)

## TL;DR

Add 4 additive enhancements to the NexusRecall ingestion/retrieval pipeline: (1) in-memory classification metrics with assistant-specific tracking and a debug endpoint, (2) near-miss diagnostics derived from unified signal evaluation results, (3) a `canonicalizeForEmbedding()` normalization layer including punctuation stripping, and (4) a high-similarity confirmation override with key-term overlap validation. All changes are deterministic, additive, and confined to existing modules. No new services, no external dependencies, no schema migrations.

---

## A. Architectural Placement

### Feature 1: Classification Metrics
- **Location**: New file `src/memory/ingestion/metrics.ts` (module-internal aggregation)
- **Integration**: Called from `handleClassifyTurn()` ONLY — after `classify()` returns and after any safety valve decision. `classify()` remains pure and side-effect-free.
- **Exposure**: New route in `src/api/routes/ingest.ts` (`GET /api/ingest/metrics`)
- **Dependencies**: None external. Purely in-memory counters.

### Feature 2: Near-Miss Debug Mode
- **Location**: Refactored `SignalEvaluationResult` interface + restructured `evaluateAssistantSignals()` function in `src/memory/ingestion/index.ts`
- **Integration**: `evaluateAssistantSignals()` replaces `detectAssistantMemorySignal()` as a single function that returns structured evaluation results for ALL families — both matched and near-missed. `classify()` consumes the `.matched` result. `handleClassifyTurn()` extracts `.nearMiss` from the same result object.
- **Propagation**: `ClassificationResult.nearMiss` → `handleClassifyTurn()` → `IngestionDebugEvent.nearMiss`
- **Dependencies**: Same pattern arrays and helpers. No duplication — single evaluation pass.

### Feature 3: Canonicalization Layer
- **Location**: Extend `src/memory/normalization/index.ts` with new `canonicalizeForEmbedding()` function
- **Integration points**:
  - `src/memory/embedding/index.ts` `embed()` — replace ad-hoc `canonicalText.trim().toLowerCase()` hash normalization with `canonicalizeForEmbedding()`. Provider call continues to receive dialect-canonicalized text (not lowercased).
  - `src/memory/retrieval/index.ts` `execute()` — replace `canonicalizeDialect(query_text)` with `canonicalizeForEmbedding(query_text)` for cache key hash
- **Dependencies**: Existing `canonicalizeDialect()`. New function wraps it with lowercase + trim + whitespace collapse + trailing punctuation removal.

### Feature 4: Safety Valve
- **Location**: New `attemptHighSimilarityOverride()` async function in `src/memory/ingestion/index.ts`
- **Integration**: Called from `handleClassifyTurn()` AFTER `classify()` returns null for assistant messages, BEFORE the early-return rejection path
- **Dependencies**: `embed()`, `fetchCandidates()`, `cosineSimilarity()`, new `hasKeyTermOverlap()` helper, config threshold
- **Config**: New `safetyValveSimilarityThreshold` (default 0.9) and `safetyValveEnabled` (default false) in `src/config/index.ts`

---

## B. Data Model Changes

### New Interfaces

#### `ClassificationMetrics` (in `src/memory/ingestion/metrics.ts`)
- `total`, `accepted`, `rejected`, `acceptanceRate` — global counters
- `assistantTotal`, `assistantAccepted`, `assistantRejected`, `assistantAcceptanceRate` — assistant-specific counters
- `byReason: Record<string, number>` — distribution by reason string
- `overrides: { total: number, bypassed: number }` — safety valve counters
- `since: string` — ISO timestamp of last reset
- Storage: In-memory singleton. Not persisted.

#### `SignalEvaluationResult` (in `src/memory/ingestion/index.ts`)
- `matched: boolean`
- `signal?: AssistantSignalDetection` — present when matched=true
- `nearMiss?: NearMissInfo` — present when matched=false and a partial match was detected

#### `NearMissInfo` (in `src/memory/ingestion/index.ts`)
- `nearMatch: string` — which signal family almost matched (e.g., 'user_fact', 'confirmation', 'correction', 'summary')
- `pattern: string` — the regex source that partially matched
- `failedCondition: string` — why it failed (e.g., 'distillation_too_short', 'distillation_trailing_ellipsis', 'empty_capture', 'keyword_present_but_pattern_mismatch')
- Storage: On ClassificationResult, propagated to IngestionDebugEvent. Not persisted.

### Modified Interfaces

#### `ClassificationResult`
- Add: `nearMiss?: NearMissInfo`

#### `IngestionDebugEvent` (in `src/memory/models/index.ts`)
- Add: `nearMiss?: { nearMatch: string; pattern: string; failedCondition: string }`
- Add: `overrideApplied?: boolean`
- Add: `overrideReason?: string`
- Add: `overrideSimilarity?: number`

#### Config (in `src/config/index.ts`)
- Add: `safetyValveEnabled: boolean` (default: false, env: `SAFETY_VALVE_ENABLED`)
- Add: `safetyValveSimilarityThreshold: number` (default: 0.9, env: `SAFETY_VALVE_SIMILARITY_THRESHOLD`)
- Add: `safetyValveMinKeyTermOverlap: number` (default: 2, env: `SAFETY_VALVE_MIN_KEY_TERM_OVERLAP`)

### No DB Schema Changes
- `canonicalText` is ephemeral (computed on-the-fly), not persisted.
- No migration required.

---

## C. API / Debug Surface Changes

### New Endpoint: `GET /api/ingest/metrics`
Response shape:
```json
{
  "total": 1847,
  "accepted": 312,
  "rejected": 1535,
  "acceptanceRate": 0.1689,
  "assistant": {
    "total": 1200,
    "accepted": 97,
    "rejected": 1103,
    "acceptanceRate": 0.0808
  },
  "byReason": {
    "rejected_assistant_too_short": 204,
    "rejected_assistant_filler": 387,
    "stored_assistant_semantic_distilled": 42,
    "high_similarity_confirmation_override": 3,
    "stored_user_semantic": 112,
    "stored_user_episodic": 103
  },
  "overrides": { "total": 3, "bypassed": 0 },
  "since": "2026-04-08T12:00:00.000Z"
}
```
Optional param: `?reset=true` to zero counters (returns snapshot before reset).

### Modified Endpoint: `GET /api/ingest/debug`
Each IngestionDebugEvent now optionally includes: `nearMiss`, `overrideApplied`, `overrideReason`, `overrideSimilarity`. All optional — no breaking changes.

---

## D. Execution Flow Changes

### Feature 1: Metrics

**`classify()` — NO CHANGES for metrics.** classify() remains pure. No side effects.

**`handleClassifyTurn()` — sole metrics recording site:**
1. After `classify()` returns, determine the final `reason` string:
   - If classification accepted: `reason = result.reason`
   - If classification rejected but safety valve fires: `reason = 'high_similarity_confirmation_override'`
   - If classification rejected and no override: `reason = result.reason`
2. Call `recordClassification(role, reason, accepted)` where:
   - `role` is `exchange.role` ('user' | 'assistant')
   - `reason` is the final reason string
   - `accepted` is true if memoryType is not null OR safety valve fired
3. `recordClassification()` increments: `total`, `accepted`/`rejected`, `byReason[reason]++`. If `role === 'assistant'`, also increments `assistantTotal`, `assistantAccepted`/`assistantRejected`.

**New route handler:**
- `GET /api/ingest/metrics` calls `getClassificationMetrics()` from the metrics module, returns JSON.
- If `?reset=true`, calls `resetClassificationMetrics()` (returns snapshot before reset).

**Exact metrics recording flow in handleClassifyTurn():**
```
const result = classify(exchange.role, exchange.content);

if (result.memoryType === null) {
  // Check safety valve for assistant messages
  if (exchange.role === 'assistant') {
    const override = await attemptHighSimilarityOverride(...);
    if (override.override) {
      recordClassification('assistant', 'high_similarity_confirmation_override', true);
      // ... log, enqueue, return
      return;
    }
  }
  // Final rejection — record now
  recordClassification(exchange.role, result.reason ?? 'unknown', false);
  // ... existing rejection debug event
  return;
}

// Accepted — record now
recordClassification(exchange.role, result.reason ?? 'unknown', true);
// ... existing acceptance debug event + enqueue embed-and-promote
```

This ensures metrics reflect FINAL ingestion decisions (post-safety-valve), not raw classify() output.

### Feature 2: Near-Miss (Unified Signal Evaluation)

**Refactor `detectAssistantMemorySignal()` → `evaluateAssistantSignals()`:**

The current function iterates families, runs each regex, checks `isValidDistillation()`, and either returns a match or continues (discarding the near-miss information). The refactored version captures that lost intermediate state.

New `evaluateAssistantSignals(content: string): SignalEvaluationResult`:
1. Iterate families in priority order (user-fact > confirmation > correction > summary) — same order as current.
2. For each family, iterate rules top-to-bottom — same order as current.
3. For each rule, run `content.match(rule.pattern)`:
   - **No match** → continue to next rule.
   - **Match, capture empty** → record as near-miss candidate: `{ nearMatch: family.signalType, pattern: rule.pattern.source, failedCondition: 'empty_capture' }`. Continue.
   - **Match, `isValidDistillation()` passes** → return `{ matched: true, signal: { ...familyFields, distilledText } }`. (Same as current behavior.)
   - **Match, `isValidDistillation()` fails** → record as near-miss candidate: `{ nearMatch: family.signalType, pattern: rule.pattern.source, failedCondition: diagnoseFailed(distilled) }`. Continue.
4. After all families exhausted: if a near-miss candidate was captured, return `{ matched: false, nearMiss: firstNearMissCandidate }`. Otherwise return `{ matched: false }`.

`diagnoseFailed(text)` helper — maps `isValidDistillation()` failure to a specific string:
- `text.trim().length < 8` → `'distillation_too_short'`
- `text.endsWith('...')` → `'distillation_trailing_ellipsis'`
- `/^[,;:\-—–.!?]/.test(text)` → `'distillation_leading_punctuation'`

**Keyword heuristic fallback** (only runs if no near-miss candidate was captured):
- If content contains keywords like 'favorite', 'prefer', 'live in' but no rule matched → `{ nearMatch: 'user_fact', pattern: 'keyword_heuristic', failedCondition: 'keyword_present_but_pattern_mismatch' }`
- If content contains 'summarize', 'key point', 'bottom line' but no rule matched → `{ nearMatch: 'summary', pattern: 'keyword_heuristic', failedCondition: 'keyword_present_but_pattern_mismatch' }`

**In `classify()` assistant path:**
- Replace `const signal = detectAssistantMemorySignal(trimmed)` with `const evalResult = evaluateAssistantSignals(trimmed)`.
- If `evalResult.matched`: return accepted classification using `evalResult.signal` fields (same as current).
- If `!evalResult.matched`: attach `evalResult.nearMiss` (if present) to the `ClassificationResult` returned from the filler/narrative/default rejection paths.

**In `handleClassifyTurn()` rejection path:**
- If `result.nearMiss` exists, include `nearMiss: result.nearMiss` in the `IngestionDebugEvent`.

**Key invariant**: Classification behavior is IDENTICAL. The same regexes run in the same order with the same early-return semantics. The only difference is that intermediate state (regex matched but distillation failed) is captured instead of discarded.

### Feature 3: Canonicalization

**New `canonicalizeForEmbedding(text: string): string`** in `src/memory/normalization/index.ts`:
1. `text = text.trim()`
2. `text = text.toLowerCase()`
3. `text = text.replace(/\s+/g, ' ')` (collapse whitespace)
4. `text = text.replace(/[.,!?;:]+$/, '')` (strip trailing punctuation only)
5. `text = canonicalizeDialect(text)` (existing dialect rules — note: dialect rules use /gi flag so they work on lowercased input)
6. Return result.

**In `embed()` (`src/memory/embedding/index.ts`):**
- Replace the ad-hoc `canonicalText.trim().toLowerCase()` hash normalization with:
  ```
  const hashText = canonicalizeForEmbedding(text);
  const textHash = createHash('sha256').update(hashText).digest('hex');
  ```
- **Provider call remains unchanged**: `adapter.generate(canonicalText)` still receives dialect-canonicalized text (not lowercased). This preserves current embedding provider input behavior.

**In `execute()` (`src/memory/retrieval/index.ts`):**
- Replace `const canonicalQuery = canonicalizeDialect(context.query_text)` with `const canonicalQuery = canonicalizeForEmbedding(context.query_text)` for cache key hash computation.
- The `embed()` call on the next line already applies canonicalization internally, so no change there.

**Ordering**: canonicalization → embedding → storage. Retrieval: canonicalization → embedding → similarity search.

### Feature 4: Safety Valve

**New `hasKeyTermOverlap(contentA: string, contentB: string, minOverlap: number): boolean`** in `src/memory/ingestion/index.ts`:
1. Tokenize both strings: split on `/\s+/`, lowercase, filter out stop words (short list: 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'it', 'that', 'this', 'to', 'of', 'in', 'for', 'and', 'or', 'but', 'i', 'you', 'my', 'your', 'we').
2. Filter out tokens shorter than 3 characters.
3. Build a Set from each token list.
4. Count intersection size.
5. Return `intersection.size >= minOverlap`.

Deterministic, no NLP library, O(n) where n = token count.

**New `attemptHighSimilarityOverride()`** — with key-term validation:
1. Guard: if `!config.safetyValveEnabled` → return `{ override: false }`.
2. Guard: if `result.reason` is `'rejected_assistant_too_short'`, `'rejected_assistant_question'`, or `'rejected_assistant_greeting'` → return `{ override: false }`.
3. `embed(content)` → embedding vector.
4. `fetchCandidates(userId, personaId, embedding, 5)` → candidates.
5. For each candidate, compute `cosineSimilarity(embedding, parseVector(candidate.embedding))`.
6. Find the best match above `config.safetyValveSimilarityThreshold`.
7. If best match found, validate `hasKeyTermOverlap(content, bestCandidate.content, config.safetyValveMinKeyTermOverlap)`. If overlap fails → return `{ override: false }`.
8. If best match found AND key-term overlap passes AND (content contains `CONFIRMATION_TOKEN` pattern OR similarity > 0.95):
   - Return `{ override: true, similarity: bestSimilarity, matchedMemoryId: bestCandidate.id }`.
9. Otherwise return `{ override: false }`.

**In `handleClassifyTurn()` rejection path (`result.memoryType === null`):**
1. If `exchange.role === 'assistant'`, call `attemptHighSimilarityOverride(data.userId, data.personaId, exchange.content, result)`.
2. If override fires:
   - Call `recordClassification('assistant', 'high_similarity_confirmation_override', true)`.
   - `pushIngestionDebug(...)` with `discarded: false`, `classificationReason: 'high_similarity_confirmation_override'`, `overrideApplied: true`, `overrideReason: 'high_similarity_confirmation_override'`, `overrideSimilarity: override.similarity`.
   - Enqueue `embed-and-promote` as `semantic`/0.5/inferred/subjective.
   - Return.
3. If override does NOT fire:
   - Call `recordClassification(exchange.role, result.reason, false)`.
   - Proceed with existing rejection debug event (unchanged).

---

## E. Performance Considerations

| Feature | Overhead | Mitigation |
|---------|----------|------------|
| Metrics | O(1) per classification in handleClassifyTurn(), bounded memory | None needed; key count bounded by developer-controlled reason strings |
| Near-Miss | Zero additional regex work — captured during the same evaluation pass that classify() already performs | No separate near-miss pass; `evaluateAssistantSignals()` is a single traversal |
| Canonicalization | One lowercase + trim + whitespace-collapse + punctuation-strip per embed call | Negligible; strictly improves cache hit rate |
| Safety Valve key-term overlap | O(n) token split + Set intersection per override candidate | Only runs when similarity > threshold (rare); n is bounded by message length |
| Safety Valve embed + fetch | One embed() + one fetchCandidates(LIMIT 5) per eligible rejected assistant msg | Default OFF; exclusion set for trivial rejections; runs in async BullMQ worker |

---

## F. Failure Modes & Safeguards

| Feature | Failure | Detection | Prevention |
|---------|---------|-----------|------------|
| Metrics | Missed count | Compare total to debug buffer length | Single recording site in handleClassifyTurn() — every code path hits one recordClassification() call |
| Metrics | byReason key explosion | Monitor key count | Keys are developer-controlled reason strings only |
| Metrics | Assistant counts drift from global | assistantTotal + (total - assistantTotal) should equal total | Tracked via single function call with role parameter |
| Near-Miss | Diverges from classification | Run 41-test validation matrix | Single-pass: classify() and near-miss use the SAME evaluateAssistantSignals() call. No separate logic. |
| Near-Miss | Changes classification behavior | Same test matrix | evaluateAssistantSignals().matched produces identical results to current detectAssistantMemorySignal() !== null |
| Canonicalization | Drift between embed and retrieval paths | Code review | Single canonicalizeForEmbedding() function, no duplication |
| Canonicalization | Punctuation strip changes semantic meaning | Only trailing punctuation stripped | Internal punctuation (apostrophes, hyphens, commas mid-sentence) untouched |
| Canonicalization | Old cached embeddings | Cache miss spike after deploy | TTL-based expiry; keys change, old entries expire naturally |
| Safety Valve | Reinforcing incorrect memory | Key-term overlap check | Override requires ≥2 meaningful shared tokens between message and candidate memory, preventing high-similarity but semantically unrelated matches |
| Safety Valve | Over-triggering | overrides.total in metrics | High threshold (0.9), confirmation token required, key-term overlap required, exclusion set |
| Safety Valve | Bypassing scope | Code review | fetchCandidates() enforces WHERE internal_user_id=$1 AND persona_id=$2 |
| Safety Valve | Silent corruption | Debug log | Every override logged with overrideApplied, overrideSimilarity, overrideReason |

---

## G. Incremental Rollout Plan

### Step 1: Classification Metrics
**Files**: `src/memory/ingestion/metrics.ts` (new), `src/memory/ingestion/index.ts` (add recordClassification calls in handleClassifyTurn), `src/api/routes/ingest.ts` (new route)
**Validation**:
- `npx tsc --noEmit` — clean compile
- `GET /api/ingest/metrics` returns valid JSON with expected shape
- Send 5-10 test messages (mix of user and assistant), verify `total` increments correctly
- Verify `assistant.total` + non-assistant count = `total`
- Verify `byReason` keys match known `classificationReason` strings
- Verify classify() has no side effects (no imports from metrics.ts)
**Gate**: Metrics numbers are sensible and assistant-specific rates are visible before proceeding.

### Step 2: Canonicalization Layer
**Files**: `src/memory/normalization/index.ts`, `src/memory/embedding/index.ts`, `src/memory/retrieval/index.ts`
**Validation**:
- `npx tsc --noEmit` — clean compile
- Unit test: `canonicalizeForEmbedding("  Hello   WORLD  ")` → `"hello world"`
- Unit test: `canonicalizeForEmbedding("My Favourite Colour!")` → `"my favorite color"`
- Unit test: `canonicalizeForEmbedding("test...")` → `"test"` (trailing punctuation stripped)
- Unit test: `canonicalizeForEmbedding("don't stop")` → `"don't stop"` (internal punctuation preserved)
- Integration: embed the same message with different casing/whitespace/trailing punctuation — verify same embedding vector returned (cache hit)
- Verify existing retrieval still works (no regression in similarity scores)
**Gate**: Cache hit rate stable or improved; no retrieval quality degradation.

### Step 3: Near-Miss Debug Mode
**Files**: `src/memory/ingestion/index.ts` (refactor detectAssistantMemorySignal → evaluateAssistantSignals, update classify()), `src/memory/models/index.ts` (add nearMiss to IngestionDebugEvent)
**Validation**:
- `npx tsc --noEmit` — clean compile
- Run existing 41-test assistant gate validation matrix — **all must still pass** (classification behavior identical)
- Send message designed to almost-match user-fact rule (e.g., "Your favorite..." with missing second clause) — verify nearMiss appears in debug output with appropriate failedCondition
- Send clearly unrelated message — verify nearMiss is absent
- Send message that matches a signal — verify nearMiss is absent (matched=true path)
**Gate**: Zero classification behavior changes confirmed by test matrix.

### Step 4: Safety Valve (depends on Steps 1 + 2)
**Files**: `src/memory/ingestion/index.ts` (attemptHighSimilarityOverride, hasKeyTermOverlap), `src/config/index.ts` (new config fields), `src/memory/models/index.ts` (override fields on IngestionDebugEvent)
**Validation**:
- `npx tsc --noEmit` — clean compile
- Deploy with `SAFETY_VALVE_ENABLED=false` (default) — verify zero overhead, zero overrides in metrics
- Enable with `SAFETY_VALVE_ENABLED=true`:
  - Store a memory "User's favorite color is blue"
  - Send assistant message "Your favorite color is blue, right?" (rejected by classifier)
  - Verify override fires: debug log shows `overrideApplied: true`, `overrideSimilarity > 0.9`, `overrideReason: 'high_similarity_confirmation_override'`
  - Verify metrics show `high_similarity_confirmation_override: 1`
  - Send assistant message "Your favorite food is pizza" with no matching existing memory — verify NOT overridden (high similarity threshold not met)
  - Send assistant message with high embedding similarity but no key-term overlap (e.g., semantically similar but different vocabulary) — verify NOT overridden (key-term guard blocks)
- Verify scoping: override never matches memories from a different userId/personaId
**Gate**: Override rate < 5% of rejections; all overrides have key-term overlap confirmed.

---

## H. Explicit Non-Goals

1. No ML-based classification changes — all detection remains regex/pattern-based and deterministic
2. No external observability systems (no Prometheus, Grafana, APM)
3. No changes to retrieval scoring logic (composite formula, type caps, hard filters untouched)
4. No database schema migration
5. No new memory types (safety valve stores as `semantic`)
6. No LLM calls
7. No user-side classifier changes
8. No re-embedding of existing memories
9. No changes to BullMQ job types or queue topology
10. No breaking API changes
11. No aggressive internal punctuation stripping — only trailing punctuation removed in canonicalization

---

## Decisions

- **Metrics recorded in handleClassifyTurn() only** — classify() remains pure; metrics reflect final ingestion decisions post-safety-valve
- **Assistant-specific counters tracked alongside global** — separate acceptance rate visibility without separate storage
- **Single-pass signal evaluation** — evaluateAssistantSignals() captures both match and near-miss in one traversal; no duplicate regex execution
- **Near-miss is a byproduct, not a separate system** — extracted from the same code path classify() uses
- **canonicalizeForEmbedding() includes trailing punctuation removal** — "blue." and "blue" produce identical cache keys and embeddings
- **canonicalizeForEmbedding() wraps canonicalizeDialect()** — single source of truth
- **Provider input unchanged** — embed() still passes dialect-canonicalized (not lowercased) text to the embedding provider; only the hash key uses full canonicalization
- **Safety valve requires key-term overlap** — prevents reinforcing semantically unrelated memories that happen to have high cosine similarity
- **Key-term overlap uses simple token intersection** — deterministic, no NLP, O(n)
- **Safety valve default OFF** — explicit opt-in via env var; zero risk to existing deployments
- **Safety valve exclusion set**: `too_short`, `question`, `greeting` never rescuable
- **Safety valve stores as `semantic` with importance 0.5** — conservative; tunable via feedback mechanism
- **Rollout: metrics → canonicalization → near-miss → safety valve** — canonicalization stabilizes inputs before diagnostic tuning
- **No user-path reason strings added in this phase** — candidate for follow-up
