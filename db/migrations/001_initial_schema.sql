-- ============================================================
-- Nexus Recall — Phase 1 Initial Schema Migration
-- 001_initial_schema.sql
-- ============================================================

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- memories table
-- ============================================================

CREATE TABLE IF NOT EXISTS memories (
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

-- Scoped vector search (HNSW)
CREATE INDEX IF NOT EXISTS memories_embedding_hnsw_idx
  ON memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Scoped retrieval queries
CREATE INDEX IF NOT EXISTS memories_scope_idx
  ON memories (internal_user_id, persona_id, status, graduation_status);

-- Cooldown fast lookup
CREATE INDEX IF NOT EXISTS memories_cooldown_idx
  ON memories (id, cooldown_until)
  WHERE cooldown_until IS NOT NULL;

-- ============================================================
-- exchanges table
-- ============================================================

CREATE TABLE IF NOT EXISTS exchanges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_user_id  TEXT NOT NULL,
  persona_id        TEXT NOT NULL,
  session_id        TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content           TEXT NOT NULL,
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Scope index
CREATE INDEX IF NOT EXISTS exchanges_scope_idx
  ON exchanges (internal_user_id, persona_id, created_at DESC);

-- Session index
CREATE INDEX IF NOT EXISTS exchanges_session_idx
  ON exchanges (session_id, created_at DESC);

-- Purge index
CREATE INDEX IF NOT EXISTS exchanges_purge_idx
  ON exchanges (created_at);
