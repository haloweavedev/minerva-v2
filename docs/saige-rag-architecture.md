# What Makes Saige a Great RAG Application

A technical breakdown of the retrieval-augmented generation architecture behind Saige — how the stack is composed, why each layer exists, and how they interlock.

---

## The Stack at a Glance

| Layer | Technology | Role |
|-------|-----------|------|
| Vector storage | PostgreSQL + pgvector (Neon) | Stores and searches 1024-dim embeddings natively |
| Embedding | Voyage AI (`voyage-context-3`) | Encodes documents and queries into the same vector space |
| Reranking | Voyage AI (`rerank-2.5`) | Instruction-following reranker that refines coarse vector results |
| LLM | Groq (`llama-3.3-70b-versatile`) | Streams final answers at inference speed |
| Chunking | Custom paragraph-aware splitter | Preserves semantic boundaries at ~600 tokens per chunk |
| Orchestration | Next.js API route + SSE | Ties retrieval, prompt assembly, and streaming into a single request |

---

## Two-Phase Architecture

Saige splits the RAG problem into two distinct phases with different optimization profiles.

### Phase 1 — Ingestion

```
File upload → Text extraction → Chunking → Embedding → pgvector storage → HNSW reindex
```

Documents (PDF, DOCX, TXT) are extracted, chunked at paragraph boundaries with a 2400-character ceiling (~600 tokens), embedded in batches of 40 via Voyage AI, and stored as `vector(1024)` columns in PostgreSQL. An HNSW index (`saige_chunks_embedding_idx`) is rebuilt once per training batch to keep approximate nearest-neighbor searches fast.

The chunking algorithm is intentionally simple: split on double newlines, accumulate until the buffer exceeds the threshold, fall back to sentence splitting for oversized paragraphs. This keeps semantic units intact without the fragility of recursive or sliding-window approaches.

### Phase 2 — Retrieval & Generation

```
User query → Embed query → Vector search (top 40) → Rerank (top K) → Filter → Prompt assembly → Stream LLM response
```

This is where the layers earn their keep.

---

## Why Two-Stage Retrieval Matters

Vector search alone is a blunt instrument. It finds the 40 nearest neighbors by L2 distance — fast, but noisy. The reranker is the precision layer.

**Stage 1 — Broad recall via pgvector:**

```sql
SELECT dc.content, kd.title, kd.scope::text,
       dc.embedding <=> $1::vector(1024) AS distance
FROM saige_document_chunks dc
INNER JOIN saige_knowledge_docs kd ON dc.doc_id = kd.id
WHERE (kd.organization_id = $2 OR kd.scope = 'global')
  AND kd.status = 'indexed'
ORDER BY distance
LIMIT 40
```

The query is scoped to the user's organization plus global knowledge docs, both in a single pass. The `<=>` operator leverages the HNSW index for sub-linear search time.

**Stage 2 — Precision via Voyage reranker:**

The 40 candidates are re-scored by `rerank-2.5` with an instruction prefix: *"Retrieve information relevant to this question: {query}"*. This instruction-following variant improves accuracy by 8-11% over vanilla reranking. Only chunks scoring above 0.45 relevance survive — a threshold that eliminates off-topic noise without losing edge-relevant content.

The result: high recall from vector search, high precision from reranking. Neither stage alone achieves both.

---

## Embedding Consistency

Both documents and queries are embedded with the same model (`voyage-context-3`) and the same dimensionality (1024). This is non-negotiable — mismatched embedding spaces produce meaningless distance calculations. The only difference is the `input_type` parameter: `"document"` for ingestion, `"query"` for retrieval. Voyage uses this distinction internally to optimize for asymmetric search.

Batch embedding respects a 40-chunk ceiling per API call to stay within the 32K token window (~600 tokens/chunk x 40 = ~24K, leaving headroom for overhead).

---

## Prompt Architecture

Context formatting is scope-aware. Local (organization-specific) chunks are presented as numbered sources with titles and relevance percentages:

```
[Source 1: "Insurance Policies" — relevance: 92%]
{content}
```

Global chunks are anonymized. A multi-pass sanitization pipeline strips attribution phrases, honorifics, person-name + speech-verb patterns, quoted text, parenthetical citations, URLs, and source lines. The LLM sees the information without knowing where it came from — preventing hallucinated citations and maintaining content neutrality.

The system prompt enforces retrieval-only behavior: the LLM must answer exclusively from provided documents. When no documents are retrieved, an explicit `NO DOCUMENTS RETRIEVED` directive forces the model to refuse rather than guess.

---

## Why Groq for Generation

Groq runs `llama-3.3-70b-versatile` on custom LPU hardware. The practical effect: streaming responses begin in milliseconds, not seconds. For a chat interface where perceived latency matters, this is the difference between "fast" and "instant."

Temperature is set to 0.4 — warm enough to rephrase retrieved content naturally, cool enough to stay faithful to sources. Token usage is tracked per-request via Groq's `stream_options: { include_usage: true }` for cost observability.

---

## Why pgvector Instead of a Dedicated Vector Database

Saige stores vectors in the same PostgreSQL instance (Neon) that holds conversations, documents, and usage logs. This is a deliberate architectural choice:

1. **No network hop** — vector search joins directly against document metadata (`scope`, `status`, `organization_id`) in the same query. A separate vector DB would require a round-trip to fetch IDs, then another query to filter.

2. **Transactional consistency** — chunk insertion and document status updates happen in the same database. No distributed coordination needed.

3. **HNSW indexing** — pgvector's HNSW implementation provides approximate nearest-neighbor search with tunable recall/speed tradeoffs. For the candidate pool sizes Saige operates at (thousands to tens of thousands of chunks per org), this is more than sufficient.

4. **Operational simplicity** — one database to back up, monitor, and scale. Neon handles connection pooling and compute scaling.

---

## Observability Built In

Every retrieval logs:
- Per-stage timing (embed, search, rerank, total)
- Candidate pool composition (local vs global count)
- Per-chunk distance scores and reranker pass/fail
- Unique documents hit with chunk counts

Every generation logs token usage across three models to `SaigeAIUsageLog`:

| Operation | Model | What it tracks |
|-----------|-------|----------------|
| `query_embed` | `voyage-context-3` | Tokens to embed the user's question |
| `rerank` | `rerank-2.5` | Tokens consumed by the reranker |
| `generation` | `llama-3.3-70b-versatile` | Tokens for the LLM response |

This makes cost attribution per-organization trivial and lets you spot retrieval quality issues (low relevance scores, high candidate counts with few survivors) before they become user-facing problems.

---

## Key Thresholds

| Parameter | Value | Why |
|-----------|-------|-----|
| Chunk size | 2400 chars (~600 tokens) | Large enough for coherent paragraphs, small enough for precise retrieval |
| Embedding dimension | 1024 | Voyage-context-3 native output |
| Vector search candidates | 40 | Broad enough for recall, bounded for reranker cost |
| Reranker topK | 10 | Balances context window budget with coverage |
| Relevance floor | 0.45 | Empirically tuned — below this, chunks hurt more than they help |
| Embedding batch size | 40 chunks | Stays within Voyage's 32K token window |
| Conversation history | 10 messages | Enough for multi-turn coherence without flooding the context |
| Generation temperature | 0.4 | Faithful to sources but not robotic |

---

## How It All Connects

A single `/api/ask` request orchestrates the full pipeline:

1. Create or resume a conversation, persist the user message
2. Load the last 10 messages for multi-turn context
3. Embed the query, vector-search for 40 candidates, rerank to 10, filter by relevance
4. Build a scope-aware prompt with sanitized global context and attributed local context
5. Stream the response from Groq token-by-token via SSE
6. Persist the assistant message, update the conversation timestamp, log all token usage

No queue. No background workers for retrieval. The entire round-trip — from question to first streamed token — completes in the time it takes the vector search and reranker to run (typically under 500ms combined), with generation tokens following immediately.

That's what makes it fast. The two-stage retrieval is what makes it accurate. And the scope-aware prompt architecture is what keeps it safe.
