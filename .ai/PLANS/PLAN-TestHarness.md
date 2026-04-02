# Plan: Nexus Recall Browser Integration Harness (Revised)

**Revision**: Corrected two architectural issues from original plan. (1) Harness no longer directly imports Nexus Recall internals — Nexus Recall exposes a minimal HTTP API and the harness consumes it as an external client over HTTP. (2) Assistant responses stream to the browser via SSE; ingestion fires after stream completion.

---

## 1. Corrected Architecture Summary

Two separate processes, communicating over HTTP:

```
┌─────────────────────┐       HTTP        ┌──────────────────────┐
│   Nexus Recall API  │◄────────────────  │    Harness Backend   │
│   (new thin server) │                   │    (Express + LLM)   │
│   Port: 3200        │                   │    Port: 3100        │
│                     │                   │         │             │
│   src/api/server.ts │                   │         │ SSE stream  │
│   calls service/    │                   │         ▼             │
│   internally        │                   │   ┌──────────┐       │
└─────────────────────┘                   │   │  Browser  │       │
                                          │   │  (Vite)   │       │
                                          │   └──────────┘       │
                                          └──────────────────────┘
```

**Nexus Recall API** — A thin Express HTTP layer added *inside the Nexus Recall project* (`src/api/`). It wraps the existing `storeMemory()` and `retrieveMemories()` service functions. This is the only new code in the Nexus Recall core repo. It introduces no new logic — just HTTP transport over the existing service layer.

**Harness Backend** — A separate Express server in `harness/`. It calls the Nexus Recall API over HTTP using `fetch()`. It never imports from `src/`. It owns LLM provider calls, prompt assembly, session state, and streaming to the browser.

**Browser** — Vite + React. Talks only to the harness backend. Receives assistant tokens via SSE.

### Boundaries
- Harness does NOT import anything from `src/`
- Harness does NOT share a Node process with Nexus Recall
- Nexus Recall API does NOT know about the harness, LLM providers, personas, or sessions
- All memory logic stays in Nexus Recall; the harness only submits exchanges and reads retrieval results

---

## 2. Project Structure

### New files inside Nexus Recall core (`src/api/`)

```
src/
  api/
    server.ts              - Express app, starts on NEXUS_RECALL_API_PORT
    routes/
      retrieve.ts          - POST /api/retrieve → calls retrieveMemories()
      ingest.ts            - POST /api/ingest → calls storeMemory()
      health.ts            - GET /api/health → basic status check
```

### Harness (separate directory, separate package, separate process)

```
harness/
  package.json
  tsconfig.json
  server/
    index.ts               - Express entry, serves harness API + static client
    config.ts              - Harness-specific .env config loader
    nexus-client.ts        - HTTP client wrapping calls to Nexus Recall API
    routes/
      chat.ts              - POST /api/chat → SSE stream endpoint
      session.ts           - Session CRUD routes
      diagnostics.ts       - GET /api/diagnostics/:sessionId/latest
    llm/
      types.ts             - ChatCompletionProvider interface (stream + non-stream)
      openrouter.ts        - OpenRouter streaming chat completion adapter
      nanogpt.ts           - NanoGPT streaming chat completion adapter
      factory.ts           - Provider factory from config
    prompt/
      assembler.ts         - Build message array from persona + memories + history
    session/
      store.ts             - In-memory session state Map
  client/
    index.html
    vite.config.ts
    tsconfig.json
    src/
      main.tsx
      App.tsx               - Layout: ChatPanel left, DiagnosticsPanel right
      api.ts                - Fetch wrapper + SSE EventSource helper
      types.ts              - Shared frontend types
      components/
        ChatPanel.tsx       - Message list + input; consumes SSE stream for assistant tokens
        PersonaEditor.tsx   - Textarea for system/persona prompt
        IntentSelector.tsx  - Dropdown: conversational / emotional / task
        DiagnosticsPanel.tsx - Retrieved memories, written memories, supersession events
        PromptViewer.tsx    - Expandable view of assembled prompt context
        SessionControls.tsx - New session, clear, preserve/reset persona
        ErrorBanner.tsx     - Surfaces all error types
```

---

## 3. Minimal Nexus Recall HTTP API Additions

Three endpoints only. No auth, no middleware beyond JSON body parsing, no new abstractions.

### `POST /api/retrieve`

Request body matches `RetrievalContext`:
```
{ internal_user_id, persona_id, query_text, intent_type? }
```
Response body matches `RetrievalResult`:
```
{ memories: MemoryObject[], retrieved_at, cache_hit }
```
Implementation: validates input, calls `retrieveMemories()` from `src/memory/service/index.ts`, returns JSON.

### `POST /api/ingest`

Request body matches `StoreMemoryInput`:
```
{ internal_user_id, persona_id, session_id, role, content, metadata? }
```
Response body matches `StoreMemoryResult`:
```
{ exchange_id, queued }
```
Implementation: validates input, calls `storeMemory()` from `src/memory/service/index.ts`, returns JSON.

### `GET /api/health`

Response: `{ status: "ok", timestamp }`. No args. Used by harness to confirm Nexus Recall is reachable at startup.

### What does NOT belong here
- No session management
- No persona handling
- No LLM calls
- No streaming
- No config exposure
- No diagnostics queries (those come later as needed in Phase B, also as minimal Nexus Recall endpoints)

### Config additions for Nexus Recall core
- `NEXUS_RECALL_API_PORT` (default 3200) added to `src/config/index.ts`
- New npm script: `"api": "tsx src/api/server.ts"`

---

## 4. Harness Backend Responsibilities

The harness backend is the orchestrator. It owns:

- **Nexus Recall HTTP client** (`nexus-client.ts`): thin wrapper around `fetch()` calls to `NEXUS_RECALL_URL` for `/api/retrieve` and `/api/ingest`. Returns typed results. Surfaces HTTP errors cleanly.
- **LLM streaming provider**: calls OpenRouter or NanoGPT with `stream: true`, consumes the response as an async iterable of SSE chunks.
- **Prompt assembly**: builds the full `ChatMessage[]` array from persona, retrieved memories, conversation history, and user message.
- **Session state**: in-memory `Map<sessionId, SessionState>` with history, persona, intent, and per-turn diagnostics.
- **SSE streaming to browser**: the `/api/chat` route is an SSE endpoint. It streams `delta` events as LLM tokens arrive, then sends a `done` event with diagnostics after ingestion completes.
- **Post-stream ingestion**: after the LLM stream finishes and the full assistant response is assembled, the harness sends both the user turn and assistant turn to Nexus Recall's `/api/ingest`.

The harness backend does NOT:
- Import from `src/` in any way
- Run memory classification, embedding, or contradiction logic
- Access PostgreSQL or Redis directly
- Implement any queue or worker system

---

## 5. Streaming Chat Flow Design

### Sequence (single user turn)

```
Browser                  Harness Backend             Nexus Recall API
  │                            │                            │
  │─POST /api/chat────────────►│                            │
  │  { sessionId, message }    │                            │
  │                            │─POST /api/retrieve────────►│
  │                            │  { user_id, persona_id,    │
  │                            │    query_text, intent }    │
  │                            │◄───── RetrievalResult──────│
  │                            │                            │
  │                            │ assemblePrompt(...)        │
  │                            │                            │
  │                            │─POST /chat/completions────►│ LLM Provider
  │                            │  { messages, stream:true } │ (OpenRouter/NanoGPT)
  │                            │◄─── SSE token stream ──────│
  │◄─ SSE event: retrieval ───│  (memories, before tokens) │
  │◄─ SSE event: delta ───────│  (forwards each chunk)     │
  │◄─ SSE event: delta ───────│                            │
  │   ...                      │                            │
  │                            │ [stream complete,          │
  │                            │  full response assembled]  │
  │                            │                            │
  │                            │─POST /api/ingest──────────►│ (user turn)
  │                            │─POST /api/ingest──────────►│ (assistant turn)
  │                            │◄── ingestion acks ─────────│
  │                            │                            │
  │                            │ record diagnostics         │
  │◄─ SSE event: done ────────│                            │
  │   { diagnostics }         │                            │
  │                            │                            │
  │◄─ SSE: close ─────────────│                            │
```

### SSE Event Types

- **`delta`** — `{ content: string }` — partial assistant token(s), appended to message in real time
- **`retrieval`** — `{ memories: MemoryObject[] }` — sent once before streaming begins, so diagnostics panel can show retrieved memories immediately
- **`done`** — `{ fullResponse: string, ingestion: { user: StoreMemoryResult, assistant: StoreMemoryResult }, assembledPrompt: ChatMessage[] }` — sent after ingestion completes
- **`error`** — `{ message: string, stage: string }` — sent if any step fails (retrieval, LLM, ingestion)

### Key constraints
- Retrieval happens BEFORE streaming begins (blocking, synchronous with the pre-generation phase)
- LLM streaming begins AFTER retrieval and prompt assembly are done
- Ingestion happens AFTER the full assistant response is assembled (does not block token delivery)
- Diagnostics are sent in the `done` event after ingestion acks return
- If ingestion fails, the `done` event still fires with error info; the stream is not invalidated

### Browser-side SSE consumption
- `ChatPanel` opens an `EventSource` or uses `fetch()` with `getReader()` on the SSE response
- Each `delta` event appends to the in-progress assistant message
- The `retrieval` event populates the diagnostics panel with retrieved memories immediately
- The `done` event finalizes the message, updates diagnostics with ingestion results and prompt context
- The `error` event surfaces in `ErrorBanner`

### LLM Provider Streaming

Both adapters implement:
```
streamComplete(messages: ChatMessage[]): AsyncIterable<string>
```

This consumes the OpenAI-compatible SSE stream from the provider (`data: {"choices":[{"delta":{"content":"token"}}]}`), yielding content strings. Both OpenRouter and NanoGPT use the OpenAI chat completions format (confirmed from the existing embedding adapter pattern using the same `/api/v1` base path).

---

## 6. Frontend Scope

Unchanged from original plan except for SSE consumption in `ChatPanel`:

- **ChatPanel** — displays message list; on send, opens SSE connection to `/api/chat`; renders assistant tokens incrementally as `delta` events arrive; finalizes on `done`
- **PersonaEditor** — textarea for system/persona prompt, session-scoped, editable between turns
- **IntentSelector** — dropdown for `conversational` / `emotional` / `task`
- **DiagnosticsPanel** — right sidebar; populated in two phases: retrieved memories on `retrieval` SSE event, ingestion/supersession events on `done` SSE event
- **PromptViewer** — expandable sections showing assembled prompt (from `done` event data)
- **SessionControls** — new session, clear chat, preserve persona toggle
- **ErrorBanner** — surfaces errors from `error` SSE events and non-SSE API failures

---

## 7. Phased Implementation Plan

### Phase A — Functional Harness (6 steps + 1 parallel)

**Step A1: Nexus Recall minimal HTTP API** *(no dependencies)*
- Create `src/api/server.ts` — Express app, JSON body parsing, CORS for local dev, listens on `NEXUS_RECALL_API_PORT`
- Create `src/api/routes/retrieve.ts` — POST handler, validates body against `RetrievalContext` shape, calls `retrieveMemories()`, returns JSON
- Create `src/api/routes/ingest.ts` — POST handler, validates body against `StoreMemoryInput` shape, calls `storeMemory()`, returns JSON
- Create `src/api/routes/health.ts` — GET handler, returns `{ status: "ok" }`
- Add `NEXUS_RECALL_API_PORT` (default 3200) to `src/config/index.ts` config loader
- Add `express`, `cors`, `@types/express`, `@types/cors` to Nexus Recall root `package.json` devDependencies (or dependencies — it's a dev-facing API)
- Add npm script: `"api": "tsx src/api/server.ts"`
- **Files modified**: `src/config/index.ts` (add port config), `package.json` (add deps + script)
- **Files created**: `src/api/server.ts`, `src/api/routes/retrieve.ts`, `src/api/routes/ingest.ts`, `src/api/routes/health.ts`

**Step A2: Harness config and package setup** *(parallel with A1)*
- Create `harness/package.json` — separate package with own deps
- Server deps: `express`, `cors`, `uuid`
- Client deps: `react`, `react-dom`
- Dev deps: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/express`, `@types/cors`, `@types/react`, `@types/react-dom`, `tsx`
- Create `harness/server/config.ts` reading `.env` vars:
  - `NEXUS_RECALL_URL` (default `http://localhost:3200`) — base URL of Nexus Recall API
  - `LLM_PROVIDER` — `openrouter` | `nanogpt`
  - `LLM_OPENROUTER_API_KEY`, `LLM_OPENROUTER_BASE_URL` (default `https://openrouter.ai/api/v1`), `LLM_OPENROUTER_MODEL`
  - `LLM_NANOGPT_API_KEY`, `LLM_NANOGPT_BASE_URL` (default `https://nano-gpt.com/api/v1`), `LLM_NANOGPT_MODEL`
  - `LLM_TEMPERATURE` (default 0.7), `LLM_MAX_TOKENS` (default 1024)
  - `HARNESS_PORT` (default 3100)
  - `DEFAULT_PERSONA_PROMPT` (optional)
  - `HARNESS_DEBUG` (optional)
- Create `harness/tsconfig.json`
- Create `harness/client/vite.config.ts` — proxy `/api` to harness backend
- Create `harness/client/tsconfig.json`
- Update root `.env.example` documenting all new vars for both API and harness
- **Files created**: `harness/package.json`, `harness/tsconfig.json`, `harness/server/config.ts`, `harness/client/vite.config.ts`, `harness/client/tsconfig.json`
- **Files modified**: `.env.example`

**Step A3: Nexus Recall HTTP client + LLM streaming providers** *(depends on A1 + A2)*
- Create `harness/server/nexus-client.ts`:
  - `retrieveMemories(context): Promise<RetrievalResult>` — POST to `${NEXUS_RECALL_URL}/api/retrieve`
  - `ingestExchange(input): Promise<StoreMemoryResult>` — POST to `${NEXUS_RECALL_URL}/api/ingest`
  - `checkHealth(): Promise<boolean>` — GET `${NEXUS_RECALL_URL}/api/health`
  - Uses native `fetch()`. Throws typed errors on non-2xx responses.
  - Types for `RetrievalResult`, `MemoryObject`, `StoreMemoryResult` are defined locally in the harness (mirroring the Nexus Recall response shapes, NOT imported from `src/`)
- Create `harness/server/llm/types.ts`:
  - `ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }`
  - `ChatCompletionProvider` interface with: `streamComplete(messages: ChatMessage[]): AsyncIterable<string>`
- Create `harness/server/llm/openrouter.ts` — implements `streamComplete` by POSTing to `${baseUrl}/chat/completions` with `stream: true`, parsing OpenAI SSE format, yielding content deltas
- Create `harness/server/llm/nanogpt.ts` — same interface, different base URL / API key
- Create `harness/server/llm/factory.ts` — `createLLMProvider(config)` returns the active provider
- **Files created**: `harness/server/nexus-client.ts`, `harness/server/llm/types.ts`, `harness/server/llm/openrouter.ts`, `harness/server/llm/nanogpt.ts`, `harness/server/llm/factory.ts`

**Step A4: Prompt assembler + session store** *(depends on A3 for types; can parallel with A3 implementation)*
- Create `harness/server/prompt/assembler.ts`:
  - `assemblePrompt(persona, memories, history, userMessage) → ChatMessage[]`
  - Message order: system (persona) → system (memory context block, type-labeled) → conversation history turns → user message
- Create `harness/server/session/store.ts`:
  - In-memory `Map<sessionId, SessionState>`
  - `SessionState = { id, internalUserId, personaId, personaPrompt, intentType, history: ChatMessage[], diagnostics: TurnDiagnostics[] }`
  - `TurnDiagnostics = { retrievedMemories, userIngestion, assistantIngestion, assembledPrompt, fullResponse, errors }`
  - Functions: `createSession()`, `getSession()`, `clearSession()`, `updateSession()`, `pushTurn()`, `pushDiagnostics()`
- **Files created**: `harness/server/prompt/assembler.ts`, `harness/server/session/store.ts`

**Step A5: Harness backend API routes (SSE chat flow)** *(depends on A3 + A4)*
- Create `harness/server/routes/chat.ts`:
  - **POST /api/chat** — SSE endpoint. Full flow:
    1. Parse `{ sessionId, message }` from request body
    2. Set response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
    3. Get session state (persona, intent, history)
    4. Call `nexusClient.retrieveMemories()` — on success, send `event: retrieval` with memories
    5. Call `assemblePrompt()` with persona + memories + history + message
    6. Call `llmProvider.streamComplete(assembledMessages)` — iterate async, send each chunk as `event: delta`
    7. After stream completes, accumulate full response
    8. Fire `nexusClient.ingestExchange()` for user turn and assistant turn (parallel, non-blocking of prior stream)
    9. Update session history + diagnostics
    10. Send `event: done` with diagnostics payload
    11. Close SSE stream
    - On error at any stage: send `event: error` with `{ message, stage }`, close stream
- Create `harness/server/routes/session.ts`:
  - POST `/api/session/new` — creates session, returns `{ sessionId, internalUserId, personaId }`
  - POST `/api/session/clear` — `{ sessionId, preservePersona? }` → clear history
  - PATCH `/api/session/:id` — update persona prompt, intent type
  - GET `/api/session/:id` — return session state
- Create `harness/server/routes/diagnostics.ts`:
  - GET `/api/diagnostics/:sessionId/latest` — return latest `TurnDiagnostics`
  - GET `/api/diagnostics/:sessionId/all` — return all diagnostics for session
- Create `harness/server/index.ts`:
  - Express app, mount routes, CORS, JSON parsing
  - On startup: call `nexusClient.checkHealth()` and log result
  - Serve static client build in production mode
  - Listen on `HARNESS_PORT`
  - GET `/api/config/status` — returns `{ provider, model, nexusRecallUrl, nexusRecallReachable }` (no secrets)
- **Files created**: `harness/server/index.ts`, `harness/server/routes/chat.ts`, `harness/server/routes/session.ts`, `harness/server/routes/diagnostics.ts`

**Step A6: React frontend** *(depends on A5)*
- `ChatPanel` — on send: POST to `/api/chat` via `fetch()` with SSE body reading (`response.body.getReader()` to parse SSE events); append tokens from `delta` events; finalize on `done`; show error on `error`
- `PersonaEditor` — textarea, calls PATCH `/api/session/:id` on change
- `IntentSelector` — dropdown, calls PATCH `/api/session/:id` on change
- `DiagnosticsPanel` — right sidebar; shows retrieved memories (from `retrieval` SSE event in real-time), ingestion acks + prompt context (from `done` event)
- `PromptViewer` — collapsible sections for the assembled prompt (from `done` event `assembledPrompt` field)
- `SessionControls` — new session button, clear button with preserve-persona toggle
- `ErrorBanner` — top bar for errors
- `api.ts` — helpers for session CRUD + SSE stream consumption
- **Files created**: All `harness/client/src/` files

**Step A7: Dev scripts and startup** *(parallel, set up early)*
- `harness/package.json` scripts: `"dev:server"`, `"dev:client"`, `"dev"` (concurrent), `"build"`, `"start"`
- Root `package.json` convenience scripts: `"api"` (starts Nexus Recall API), `"harness:dev"` (starts harness), `"harness:all"` (starts both API + harness concurrently)
- Dev startup: run `npm run api` (Nexus Recall API on 3200) + `npm run harness:dev` (harness on 3100 + Vite on 5173)

---

### Phase B — Inspection Improvements (4 steps)

**Step B1: Enhanced memory event diagnostics** *(depends on Phase A)*
- Add a minimal diagnostics endpoint to Nexus Recall API: `GET /api/diagnostics/recent?user_id=X&persona_id=Y&since=ISO` → returns recently written/superseded memories in the time window
- Requires a new query in `src/db/queries/memories.ts`: fetch memories by `(internal_user_id, persona_id)` created or status-changed after a timestamp
- New route: `src/api/routes/diagnostics.ts`
- Harness calls this after ingestion to get richer event data (new writes, supersession events, commitment memories)
- `DiagnosticsPanel` updated to show color-coded memory events
- **Files**: `src/db/queries/memories.ts` (new query), `src/api/routes/diagnostics.ts` (new), `harness/server/nexus-client.ts` (add method), `harness/client/src/components/DiagnosticsPanel.tsx`

**Step B2: Prompt assembly viewer polish** *(depends on Phase A)*
- `PromptViewer` component: expandable/collapsible sections for System/Persona, Memory Context, History, User Turn
- Rough token count estimation per section
- Already wired from `done` SSE event; this step is UI polish only

**Step B3: Intent testing refinement** *(depends on Phase A)*
- Add optional `debug?: boolean` field to the `/api/retrieve` request body
- When debug is true, add `debug` flag to `RetrievalContext`; extend `execute()` in `src/memory/retrieval/index.ts` to return filtered-out candidates with rejection reasons
- Extend `RetrievalResult` with optional `debug_filtered?: { memory_type, content, rejected_at_stage, reason }[]`
- Harness passes `debug: true` on retrieval calls; surfaces filtered candidates in diagnostics
- **Files**: `src/memory/models/index.ts` (add debug field + debug result type), `src/memory/retrieval/index.ts` (opt-in debug output), `src/api/routes/retrieve.ts` (pass through debug flag), `harness/server/nexus-client.ts`, `harness/client/src/components/DiagnosticsPanel.tsx`

**Step B4: Session continuity controls** *(depends on Phase A)*
- Expose `internal_user_id` and `persona_id` as editable fields in an "advanced" section of `SessionControls`
- Allow rotating `session_id` while keeping user/persona stable for cross-session memory testing
- **Files**: `harness/client/src/components/SessionControls.tsx`, `harness/server/routes/session.ts`

---

## 8. Verification Checklist

1. **Two-process startup**: `npm run api` starts Nexus Recall API on port 3200; `npm run harness:dev` starts harness on 3100 + Vite; both processes run independently
2. **Health check**: Harness startup log confirms Nexus Recall API is reachable; `GET /api/config/status` shows `nexusRecallReachable: true`
3. **Streaming chat**: Send message in browser → assistant tokens appear incrementally → message finalizes on stream completion
4. **Retrieval before generation**: `retrieval` SSE event fires before any `delta` events; DiagnosticsPanel shows retrieved memories before assistant starts typing
5. **Ingestion after generation**: `done` SSE event contains ingestion acks; exchanges appear in Nexus Recall DB after turn completes
6. **Persona**: Edit persona → send message → verify persona appears in prompt viewer and affects response character
7. **Provider switching**: Change `LLM_PROVIDER` in .env → restart harness only → new provider active
8. **Intent selection**: Select "task" → commitment memories appear; select "emotional" → commitments excluded
9. **Error visibility**: Invalid LLM key → `error` SSE event with stage "llm"; stop Nexus Recall API → `error` event with stage "retrieval"
10. **Security**: Browser network tab shows zero API keys in any response; `GET /api/config/status` returns only non-secret info; Nexus Recall API keys not exposed to harness frontend
11. **Process isolation**: Stop Nexus Recall API → harness still runs, shows connection error; restart API → harness resumes working; confirms no shared-process dependency

---

## 9. Architectural Confirmations

- **The harness does NOT directly import Nexus Recall internals.** It communicates exclusively via HTTP to the Nexus Recall API. No relative imports from `src/`. No shared Node process.
- **The harness uses Nexus Recall over HTTP.** The Nexus Recall API server (`src/api/server.ts`) exposes three minimal endpoints: `/api/retrieve`, `/api/ingest`, `/api/health`. The harness backend calls these via `fetch()`.
- **Assistant responses stream to the browser.** The harness `/api/chat` endpoint is an SSE stream. LLM tokens flow through the harness to the browser in real time via `delta` events.
- **Ingestion occurs after stream completion.** The user turn and assistant turn are sent to `/api/ingest` only after the full assistant response is assembled. Ingestion does not block token delivery.
- **No unnecessary platform expansion was introduced.** The Nexus Recall API surface is three endpoints. No auth, no new database, no new queue, no plugin system, no generalized orchestration. The harness remains a thin testing client.

---

## Decisions

- **Separate processes**: Nexus Recall API and harness run as independent processes. Developer starts both. This enforces the boundary and mirrors how a real client would integrate.
- **SSE over WebSocket**: SSE is simpler, unidirectional (server→browser), sufficient for streaming tokens + diagnostics events. No need for bidirectional communication.
- **POST for SSE chat endpoint**: The chat endpoint accepts POST (with session/message body) and returns an SSE stream. This is a pragmatic choice — EventSource only supports GET, so the browser uses `fetch()` + `getReader()` to consume the SSE stream from a POST.
- **Types duplicated in harness**: The harness defines its own TypeScript types for Nexus Recall response shapes (matching the JSON contract). This avoids any import dependency on `src/` while maintaining type safety.
- **Nexus Recall API deps added to root package.json**: Express is added as a dependency of the Nexus Recall project itself (since the API server lives in `src/api/`). This is a minimal addition — Express + CORS only.
- **In-memory session store**: No persistence for harness sessions. Ephemeral by design.
- **No auth**: Local/dev usage only.
