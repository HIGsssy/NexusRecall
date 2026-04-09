# NexusRecall: Persistent Memory for Conversational AI

## The Problem

Today's AI assistants are amnesiacs. Each conversation starts fresh—without memory of previous interactions, preferences shared, commitments made, or lessons learned. This forces users to repeat themselves, breaks narrative continuity, and prevents AI from genuinely learning from relationships.

## The Solution

NexusRecall is a **memory service that gives conversational AI systems a real memory**—one that's contextual, intelligent, and reliable.

Think of it as an external brain that your AI assistant can consult. When a user asks a question or shares something new, NexusRecall:

- **Remembers** past conversations, preferences, and important details
- **Understands** what's relevant to the current moment (not everything from the past is useful now)
- **Detects conflicts** when new information contradicts old memories, keeping the record straight
- **Retrieves thoughtfully** using smart scoring—balancing relevance, recency, and importance

## Why It Matters

### For Users
- AI remembers you across conversations—no more repetition
- Consistent, coherent interactions that feel natural
- The assistant learns about your preferences, history, and commitments
- Better personalization without constant context-setting

### For Developers
- Drop-in memory service for any conversational AI system
- Works with any LLM (OpenRouter, NanoGPT, others)
- Built-in contradiction detection keeps the knowledge base honest
- Intelligent retrieval prevents information overload (serves only what's relevant)
- Redis-backed caching keeps performance high

## Key Capabilities

**Semantic Understanding** — Automatically classifies memories into facts, experiences, preferences, and commitments

**Temporal Intelligence** — Older memories fade gracefully; recent memories carry more weight

**Contradiction Detection** — When new information conflicts with stored memories, NexusRecall tracks the lineage so you know what replaced what

**Intent-Aware Retrieval** — Serves different memory types depending on context (task-focused queries get commitments; emotional queries get relational memories)

**No Spam** — Cooldowns prevent the same memories from being retrieved repeatedly in the same session

## The Result

Conversational AI that genuinely learns, remembers, and grows with its users.

## Memory Types

NexusRecall ingests and manages four distinct memory types, each serving a different purpose:

| Type | Description | Purpose |
|------|-------------|---------|
| **semantic** | Factual knowledge extracted from assistant responses | Retain facts, analysis, and information provided by the AI; prevents re-explaining the same concepts |
| **episodic** | Experiential memories from user messages (≥50 chars) | Remember user experiences, stories, and context about what they've done or encountered |
| **self** | Self-referential statements from the user | Track user identity, preferences, and how they describe themselves |
| **commitment** | Explicit promises/agreements (detected via pattern matching) | Honor explicit commitments made by either user or assistant; crucial for task-based interactions |

Each type has distinct retrieval rules, confidence thresholds, and caps on how many are returned per query—ensuring the most relevant memory subset is selected for each interaction.

---

## How NexusRecall Compares

### vs. RAG (Retrieval Augmented Generation)

**RAGs** are designed to inject domain knowledge and documents into LLM prompts. They excel at answering questions with external data sources.

**NexusRecall** is different—it's about remembering *people*. Instead of augmenting with documents, it retains and retrieves details about the *user*, their preferences, their history, and their commitments. A RAG helps you answer "what is X?" while NexusRecall helps you answer "what does this person care about?"

You could use both: a RAG for factual knowledge, NexusRecall for relational context.

### vs. Simple Conversation History

**History-only systems** store chat logs verbatim. More data isn't always better—reading through 200 previous messages wastes time and confuses the LLM.

**NexusRecall** intelligently extracts *what matters*. It classifies memories, deduplicates them, ages them out, and detects contradictions. It serves 5 relevant memories instead of 200 irrelevant ones.

### vs. Vector Databases + Similarity Search

**Generic vector DBs** (Pinecone, Weaviate, Milvus) offer raw similarity search: "find vectors close to this query vector."

**NexusRecall** adds layers on top:
- **Memory types** — not all memories are equal. A commitment ("I'll do X") is fundamentally different from a fact ("I'm allergic to peanuts")
- **Intent awareness** — task-focused queries get commitments; emotional queries get relational memories
- **Contradiction detection** — when new info conflicts, old memories are marked `superseded` with lineage
- **Temporal decay** — older memories matter less
- **Spam prevention** — cooldowns stop the same memory from being retrieved repeatedly

### vs. Long-Context Windows

**Long-context LLMs** (100K-200K token windows) let you dump entire histories into prompts.

**Advantages:** Simple, no external service needed

**Disadvantages:** Expensive (tokens cost money), slow (processing long contexts is slower), noisy (the model has to find the signal in all that data), and doesn't scale (10 conversations × 100K tokens each = expensive)

**NexusRecall** is purpose-built to compress, curate, and serve only the essential memories, making every token count.

### Long-Term vs. Short-Term Memory

**Long-context windows** are pure working memory—they only hold what fits in the current prompt. Once that conversation ends, everything is gone.

**NexusRecall** provides *persistent* long-term memory across days, weeks, and months. It remembers:
- What the user cares about
- Commitments they've made (and which ones you've fulfilled)
- Patterns in how they think and work
- What contradicts what they said before
- Emotional context from past conversations

Short-term context (the current conversation) is still important—NexusRecall includes a working memory buffer for recent turns. But the long-term layer gives continuity across time.

### Bidirectional Memory: You + Them

**Most memory systems** only remember the user's side of the conversation.

**NexusRecall** remembers *both*:
- **User memories** — what they said, their preferences, their commitments
- **Assistant memories** — what *you* (the AI) said, facts and analysis *you* provided, positions *you* took

This matters because:
- You can recall explanations you gave before (avoid repeating yourself)
- You can detect if you contradicted yourself (maintain consistency)
- You can track what you promised (honor commitments to the user)
- You build genuine narrative continuity—not just remembering them, but remembering the *conversation* itself
