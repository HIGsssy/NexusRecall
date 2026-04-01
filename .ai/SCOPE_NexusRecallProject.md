# Nexus Recall Memory Platform — Project Scope

**Standalone Memory Platform for AI Agents**
**Dual-Layer Architecture + Governors + Performance + Strict Service Boundaries**

---

## Core Product Definition

Nexus Recall is a **standalone memory platform for AI agents and personas**.

It is not a chatbot.

It is not a feature inside a bot.

It is a **memory service** that external clients (Discord bots, web apps, future AI systems) connect to in order to provide:

* Relationship continuity
* Persona-specific recall
* Behavioral consistency
* Context-aware responses

> Bots do not implement memory. Bots consume memory.

---

## Objective

Design and implement a memory platform that enables each persona to:

* Maintain a coherent understanding of the user
* Maintain internal consistency of its own claims and commitments
* Recall past interactions naturally and selectively
* Operate within strict latency constraints
* Behave with social awareness, restraint, and correctness

Memory is strictly scoped to:

> **(internal_user_id, persona_id)**

Future scoping layers (e.g., server/guild) may be introduced, but are explicitly out of scope for v1.

---

## 🚨 Architectural Mandate (NON-NEGOTIABLE)

### 1. Memory Is the Product

The memory system is the **primary system**, not a supporting module.

All architectural decisions must preserve:

* Independence
* Portability
* Service integrity

---

### 2. Strict Service Boundary

The `/memory` system is a **standalone service layer**, even if initially implemented within a single repository.

#### Absolute Rules

* No external code may access:

  * PostgreSQL memory tables
  * Redis cache
  * Retrieval logic
  * Ingestion logic

* All interaction MUST go through the public interface:

  * `memoryService.storeMemory()`
  * `memoryService.retrieveMemories()`
  * (future: API endpoints)

* No shortcuts. No bypassing.

---

### 3. Client Relationship Model

All clients (Discord, Web, future systems):

* Are **consumers of the memory platform**
* Must be treated as external systems
* Must NOT:

  * Perform embeddings
  * Perform scoring
  * Perform filtering
  * Access storage directly

#### Call Flow (MANDATORY)

```
Client (Discord/Web)
        ↓
Chat Engine (client-side orchestration)
        ↓
Memory Service (this system)
```

* Only the chat engine may call the memory service
* Adapters must not call memory directly

---

### 4. Future Extraction Requirement

The system must be designed so that `/memory` can be extracted into a standalone service with minimal or zero refactoring.

Assume this will happen.

---

### 5. Cost & Performance Awareness

* Embedding and retrieval operations must avoid duplication
* Avoid unnecessary embedding generation
* Optimize for real-world cost efficiency, not just correctness

---

## Core Architecture: Mirror-Layer Model

### A. User Layer (External Knowledge)

#### Semantic (Profile)

Stable user traits and facts.

#### Episodic (Interaction)

Summarized meaningful interactions.

#### Metadata

* volatility (factual | subjective)
* confidence (explicit | inferred)
* status (active | superseded | corrected)

---

### B. Persona Layer (Internal Identity)

#### Persona Semantic

Facts the persona has established about itself.

#### Persona Commitments (High Priority)

Explicit promises or obligations made by the persona.

**Rules:**

* Rare and high-confidence only
* Must pass intent alignment
* Conservative detection (false positives are worse than false negatives)
* Bypass similarity threshold
* Never suppressed by cooldown

---

## Memory Types

* semantic
* episodic
* self
* commitment
* temporal (optional)

---

## Storage Architecture

### PostgreSQL + pgvector (HNSW)

#### Tables

**exchanges (raw logs)**
Captured conversation data.

**memories (distilled intelligence)**
Structured, retrievable memory units.

---

### Query Requirement (CRITICAL)

All vector queries MUST be scoped:

```sql
SELECT *
FROM memories
WHERE internal_user_id = ?
  AND persona_id = ?
ORDER BY embedding <-> ?
LIMIT 20;
```

Rules:

* Filtering MUST occur at the database level
* NEVER retrieve globally and filter in application code

---

## Redis Layer (Working Memory)

### Responsibilities

* Working memory buffer (last 5–10 turns)
* Cooldown tracking (memory_id → expiry)
* Short-lived retrieval cache

### Constraints

* Redis is ephemeral
* Redis is non-authoritative
* No long-term memory stored here

---

## Execution Model

### Critical Path (Synchronous — Target <1.5s)

1. Intent Gate (lightweight classification only)
2. Load working memory (Redis)
3. Embed user input (if required)
4. Retrieve candidates (pgvector)
5. Hard filtering (MANDATORY)
6. Score candidates
7. Select memory set (0–4)
8. Inject context
9. Return to client for response generation

---

### Asynchronous Pipeline

* summarization
* classification
* promotion (candidate → confirmed)
* contradiction resolution (lineage)
* merging / pruning
* decay calculation
* emotional trend updates
* topic clustering

---

### Eventual Consistency

Memory updates are not required to appear in the immediate next response.

---

## Ingestion Pipeline

### Graduation Model

* Observation → not retrievable
* Candidate → low-weight retrieval
* Confirmed → behavior-influencing

---

### Commitment Detection (Classifier-Based)

Each persona output must be evaluated:

> Does this create a future obligation?

Criteria:

* future-oriented
* directed at user
* implies follow-through

If TRUE:

* store as commitment (high importance, high confidence)

If FALSE:

* store as self-memory

---

### Contradiction Handling (Lineage)

* New memory supersedes old
* Old marked `superseded`
* Linked via lineage pointer
* No deletion on overwrite

---

## Retrieval System (STRICT PIPELINE)

### Stage 1 — Candidate Retrieval

Top 20–40 results (scoped query)

---

### Stage 2 — Hard Filtering (BEFORE SCORING)

* similarity threshold (per type)
* inhibition status
* cooldown
* intent alignment
* confidence gating

---

### Stage 3 — Scoring

```
Score = (Similarity * 0.6)
      + (Recency * 0.2)
      + (Importance * 0.1)
      + (Strength * 0.1)
      + (IntentAlignmentBias)
```

---

### Selection Rules

* semantic ≤ 2
* episodic ≤ 2
* commitment ≤ 1
* zero allowed

---

## Retrieval Discipline

* Silence > weak relevance
* No forced recall
* Memory must compete with present context

---

## Intent Alignment

Used for:

* filtering eligibility
* scoring bias

### Behavioral Mapping

* Task → prioritize commitments + working memory
* Conversational → allow semantic + episodic
* Emotional → prioritize episodic + emotional trends

---

## Governors (MANDATORY)

### Confidence System

Separates certainty from importance

### Recall Modes

* implicit
* soft explicit
* hard explicit

### Cooldown System

Prevents repetition (Redis-backed)

### Negative Feedback Loop

Reduces strength and confidence, may inhibit memory

### Do-Nothing Protocol

No valid memory → inject none

---

## Cache Strategy

### Retrieval Cache

* TTL: 30–120 seconds
* Must invalidate on memory updates or lineage changes

### Embedding Cache

* Cache recent embeddings per session

---

## Memory Lifecycle (Async)

* merging
* reinforcement (usage-based)
* decay (time-based)
* correction (lineage)
* pruning

---

## Prompt Construction

### Sections

* working memory
* semantic
* episodic
* self-memory
* commitments

### Instruction

> Memory is optional. Use only if helpful. Prefer silence over weak recall.

---

## Observability

Track:

* latency (critical path)
* % zero-memory responses
* retrieval rejection rate
* memory regret signals
* cache hit rate
* async queue health

---

## Public Service Interface

Core API surface:

* `storeMemory(input)`
* `retrieveMemories(context)`
* `updateMemory(id)`
* `pruneMemory(scope)`
* `deleteUserMemory(userId)`
* `summarizeSession(sessionId)`

All consumers must use this interface only.

---

## Repository Structure (ENFORCED)

```
/memory
  /service
  /retrieval
  /ingestion
  /models
  /cache

/chat
  /engine

/adapters
  /discord
  /web
```

Rules:

* `/memory` is isolated
* `/chat` orchestrates interaction
* `/adapters` are thin clients
* No cross-layer leakage

---

## Implementation Roadmap

### Phase 1 — Core Platform

* Postgres + pgvector
* Redis working memory
* semantic memory only
* strict service boundary enforcement

---

### Phase 2 — Structured Memory

* episodic memory
* ingestion pipeline
* lineage system
* commitment classifier

---

### Phase 3 — Behavioral Governors

* confidence system
* recall modes
* cooldown system
* negative feedback loop

---

### Phase 4 — Optimization & Scale

* HNSW tuning
* caching improvements
* retrieval optimization
* async batching

---

## Final Outcome

A platform that:

* Acts as a **memory layer for AI systems**
* Maintains persona-specific relationships
* Preserves internal consistency
* Recalls selectively and correctly
* Avoids repetition and contradiction
* Scales across multiple clients

---

## Final Principle

> The system does not aim to remember everything.
> It aims to remember correctly — and speak with intent.
