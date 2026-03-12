# Minerva RAG Migration Plan: Pinecone/OpenAI → Voyage AI + Neon Postgres + Groq

## Context

Minerva's current RAG stack (Pinecone + OpenAI `text-embedding-3-small` + gpt-4-turbo) produces excessive hallucinations and poor retrieval quality. We're replacing the entire pipeline:

- **Embeddings**: OpenAI → **Voyage AI `voyage-context-3`** (1024 dims)
- **Reranking**: Custom heuristics → **Voyage `voyage-rerank-2.5`**
- **Vector Store**: Pinecone → **Neon Postgres + pgvector**
- **Generation**: OpenAI gpt-4-turbo → **Groq `gpt-oss-20b`**
- **Query Analysis**: OpenAI → **Groq `gpt-oss-20b`**

WordPress source: 18,645 `book-review` posts on allaboutromance.com (SSH + WP-CLI access)

### Reference Architecture: Saige

Our stack mirrors Saige (see `docs/saige-rag-architecture.md`), a production RAG app using the same Neon + Voyage + Groq stack. Key patterns adopted from Saige are marked with **(Saige)** throughout this plan.

---

## Tuned Thresholds (informed by Saige)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Chunk size | 2400 chars (~600 tokens) | **(Saige)** Large enough for coherent paragraphs, small enough for precise retrieval |
| Embedding dimension | 1024 | Voyage `voyage-context-3` native output |
| Vector search candidates | 40 | **(Saige)** Broad enough for recall, bounded for reranker cost |
| Reranker topK | 10 | **(Saige)** Balances context window budget with coverage |
| Relevance floor | 0.45 | **(Saige)** Below this, chunks hurt more than they help |
| Embedding batch size | 40 chunks | **(Saige)** Stays within Voyage's 32K token window (~600 tokens × 40 = ~24K) |
| Generation temperature | 0.4 | **(Saige)** Faithful to sources but not robotic |
| pgvector index type | HNSW | **(Saige)** Better than IVFFlat — no periodic rebuilds needed, sub-linear search |

---

## Phase 1: Data Extraction from WordPress

**Create:** `scripts/extract-wp-reviews.ts`

SSH into allaboutromance.com via `sshpass` + WP-CLI. Extract in paginated batches of 100 posts:
- Post fields: ID, post_title, post_content, post_date
- Meta fields (wpcf-*): title, author_first_name, author_last_name, book-grade, book-sensuality, bookpublish_date, copyright-year, publisher, pages, isbn, amazon-asin, amazon-url, time-setting, locale-setting, series1, coda, intro
- Taxonomies: book-type, review-tag
- Featured image URL (via _thumbnail_id → attachment guid)

**HTML cleanup:** Strip `<script>`, `<style>`, ad divs. Convert `<p>`/`<br>` to newlines. Strip remaining HTML tags. Collapse whitespace.

**Output:** `data/raw-reviews.json` — array of cleaned review objects

**Dependencies:** `cheerio` (HTML parsing)

---

## Phase 2: Chunking Strategy (learned from Saige)

**(Saige)** Reviews must be chunked before embedding — whole reviews can exceed 5000+ chars, producing poor retrieval granularity.

**Approach:** Paragraph-aware chunking with a 2400-character ceiling (~600 tokens):

1. Split cleaned review text on double newlines (paragraph boundaries)
2. Accumulate paragraphs into a buffer until it exceeds 2400 chars
3. When threshold is exceeded, flush the buffer as a chunk
4. For single paragraphs that exceed the threshold, fall back to sentence splitting
5. Each chunk inherits the parent review's metadata (title, author, grade, etc.)

This keeps semantic units intact without the fragility of recursive or sliding-window approaches.

**Schema change:** We need a `book_review_chunks` table (not just `book_reviews`) to store multiple chunks per review.

---

## Phase 3: Neon Postgres + pgvector Setup

**Create:** `lib/db.ts` — Neon database client

Use `neonctl` to create a database, then set up schema:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Parent table: one row per book review
CREATE TABLE book_reviews (
  id SERIAL PRIMARY KEY,
  post_id INTEGER UNIQUE NOT NULL,
  title TEXT NOT NULL,
  author_name TEXT NOT NULL,
  grade TEXT,
  sensuality TEXT,
  book_types TEXT[],
  review_tags TEXT[],
  publish_date TEXT,
  copyright_year TEXT,
  publisher TEXT,
  pages TEXT,
  isbn TEXT,
  asin TEXT,
  amazon_url TEXT,
  time_setting TEXT,
  locale_setting TEXT,
  series BOOLEAN DEFAULT FALSE,
  cover_url TEXT,
  review_url TEXT,
  post_date TIMESTAMP,
  content TEXT NOT NULL,
  coda TEXT
);

-- Chunks table: multiple chunks per review, each with an embedding
CREATE TABLE book_review_chunks (
  id SERIAL PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES book_reviews(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1024)
);

-- (Saige) HNSW index for fast approximate nearest-neighbor search
CREATE INDEX book_review_chunks_embedding_idx
  ON book_review_chunks USING hnsw (embedding vector_cosine_ops);
```

**(Saige)** HNSW over IVFFlat — no periodic rebuilds, sub-linear search, tunable recall/speed tradeoffs. For our ~30-50K chunks this is more than sufficient.

**Client:** Use `@neondatabase/serverless` for the connection (serverless-friendly for Next.js).

**Env vars needed:** `DATABASE_URL` from Neon

---

## Phase 4: Voyage AI Client

**Create:** `lib/voyage.ts`

REST wrapper for Voyage AI API:

```typescript
export async function embedTexts(texts: string[], inputType: 'query' | 'document'): Promise<number[][]>
export async function embedQuery(text: string): Promise<number[]>
export async function rerankDocuments(query: string, documents: string[], topK?: number): Promise<RerankResult[]>
```

- Embedding endpoint: `POST https://api.voyageai.com/v1/embeddings`
  - model: `voyage-context-3`, output_dimension: 1024
  - input_type: `"query"` for queries, `"document"` for review content
- Reranking endpoint: `POST https://api.voyageai.com/v1/rerank`
  - model: `voyage-rerank-2.5`
  - **(Saige)** Use instruction prefix: `"Retrieve information relevant to this question: {query}"` — improves accuracy 8-11% over vanilla reranking

**Batching:** **(Saige)** 40 chunks per batch (~600 tokens/chunk × 40 = ~24K tokens, within Voyage's 32K window)

---

## Phase 5: Embedding + Ingestion Pipeline

**Create:** `scripts/embed-and-ingest.ts`

1. Read `data/raw-reviews.json`
2. Insert each review into `book_reviews` table (metadata only, no embedding)
3. Chunk each review's content using paragraph-aware splitter (Phase 2)
4. For each chunk, prepend review metadata as context header:
   ```
   Title: {title} by {author}
   Grade: {grade} | Sensuality: {sensuality} | Type: {bookTypes.join(', ')}
   Tags: {reviewTags.join(', ')}

   {chunk_content}
   ```
5. Batch embed chunks with Voyage `voyage-context-3` (input_type: "document"), 40 per batch
6. INSERT into `book_review_chunks` with embedding vector
7. Progress logging, resume support via `--start-from` offset
8. `--test` flag: process only first 100 reviews

**Estimated time:** ~18,645 reviews → ~30-50K chunks → ~750-1250 batches × ~1s = ~15-25 minutes

---

## Phase 6: Replace RAG Pipeline (Two-Stage Retrieval from Saige)

### 6a. Rewrite `utils/getContext.ts`

**(Saige)** Two-stage retrieval: broad recall via pgvector, then precision via Voyage reranker.

**Stage 1 — Broad recall (top 40):**
```sql
SELECT
  c.id, c.content, c.chunk_index,
  r.title, r.author_name, r.grade, r.sensuality,
  r.book_types, r.review_tags, r.asin, r.cover_url,
  r.amazon_url, r.post_id, r.review_url, r.post_date, r.publish_date,
  c.embedding <=> $1::vector(1024) AS distance
FROM book_review_chunks c
INNER JOIN book_reviews r ON c.review_id = r.id
ORDER BY distance
LIMIT 40;
```

**Stage 2 — Precision via Voyage reranker:**
- Send 40 candidate chunk texts to `rerank-2.5` with instruction prefix
- Keep top 10 chunks scoring above 0.45 relevance floor
- Deduplicate by review (keep best-scoring chunk per book)

**Stage 3 — Context assembly:**
**(Saige)** Format as numbered sources with relevance scores:
```
[Source 1: "Lord of Scoundrels by Loretta Chase" — relevance: 92%]
{chunk content}
```

- Remove HYDE expansion (Voyage embeddings + reranker make it unnecessary)
- Keep existing context formatting for LLM consumption

### 6b. Rewrite `lib/ai/tools/display-book-cards.ts`
- Remove Pinecone imports → query Neon pgvector instead
- Replace manual reranking with Voyage reranker
- Keep the tool schema and output format (BookCard components unchanged)

### 6c. Delete `lib/pinecone.ts`

### 6d. Remove Pinecone dependencies
- `pnpm remove @pinecone-database/pinecone`
- Remove `PINECONE_*` env vars

---

## Phase 7: Switch to Groq for Generation + Query Analysis

### 7a. Update `lib/ai/providers.ts`
Add Groq provider using OpenAI-compatible base URL:
```typescript
import { createOpenAI } from '@ai-sdk/openai';
const groq = createOpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});
return groq('openai/gpt-oss-20b');
```

### 7b. Update `lib/ai/query-analyzer.ts`
- Replace OpenAI client with Groq (OpenAI-compatible):
  ```typescript
  const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });
  ```
- Model: `openai/gpt-oss-20b`

### 7c. Update `lib/ai/prompts.ts`
- Make prompts more explicit/structured for the smaller model
- **(Saige)** Add explicit `NO DOCUMENTS RETRIEVED` directive — when no chunks pass the relevance floor, force the model to refuse rather than hallucinate
- **(Saige)** Temperature: 0.4 — warm enough to rephrase naturally, cool enough to stay faithful
- Increase `maxTokens` to 2048 (gpt-oss-20b is cheap, 65K max output)

### 7d. Update `app/api/chat/route.ts`
- Set `AI_PROVIDER=groq` as default
- Remove HYDE-related code paths

---

## Phase 8: Observability (learned from Saige)

**(Saige)** Add per-stage timing and token usage logging:

| Operation | Model | What to track |
|-----------|-------|---------------|
| `query_embed` | `voyage-context-3` | Tokens to embed the user's question |
| `vector_search` | pgvector | Query time in ms, candidates returned |
| `rerank` | `rerank-2.5` | Tokens consumed, candidates in/out, relevance scores |
| `generation` | `gpt-oss-20b` | Input/output tokens, streaming latency |

Log to console in dev, structured JSON in production. This makes retrieval quality issues (low relevance scores, few survivors after reranking) visible before they become user-facing.

---

## Phase 9: Cleanup & Config

### Files to delete:
- `lib/pinecone.ts`

### Files to create:
- `lib/db.ts` (Neon client)
- `lib/voyage.ts` (Voyage AI client)
- `scripts/extract-wp-reviews.ts` (WordPress extraction)
- `scripts/embed-and-ingest.ts` (embedding + DB ingestion)

### Files to modify:
- `utils/getContext.ts` (core RAG pipeline)
- `lib/ai/tools/display-book-cards.ts` (book card tool)
- `lib/ai/providers.ts` (add Groq)
- `lib/ai/query-analyzer.ts` (switch to Groq)
- `lib/ai/prompts.ts` (tune for gpt-oss-20b)
- `app/api/chat/route.ts` (provider config)
- `scripts/find-record-in-db.ts` (update to query Neon)
- `scripts/get-latest-pinecone.ts` → rename/rewrite for Neon
- `package.json` (add `@neondatabase/serverless`, `cheerio`; remove `@pinecone-database/pinecone`)
- `.env.example` (update env vars)
- `CLAUDE.md` (update architecture docs)

### New env vars:
```
DATABASE_URL=<neon connection string>
VOYAGE_API_KEY=<already in .env>
GROQ_API_KEY=<already in .env>
AI_PROVIDER=groq
```

### Remove env vars:
```
PINECONE_API_KEY
PINECONE_INDEX_NAME
PINECONE_INDEX_HOST
PINECONE_ENVIRONMENT
```

---

## Phase 10: Dependencies

```bash
pnpm add @neondatabase/serverless cheerio
pnpm remove @pinecone-database/pinecone
```

Keep `openai` package (used as Groq-compatible client for query analysis).

---

## Execution Order

| Step | What | Depends On |
|------|------|------------|
| 1 | Create Neon DB + schema (`lib/db.ts`) | neonctl |
| 2 | Create Voyage client (`lib/voyage.ts`) | VOYAGE_API_KEY |
| 3 | Build extraction script + run it | SSH access |
| 4 | Build embed+ingest script, run with `--test` (100 reviews) | Steps 1-3 |
| 5 | Test queries against Neon pgvector manually | Step 4 |
| 6 | Update RAG pipeline (`getContext.ts`, `display-book-cards.ts`) | Steps 2, 4 |
| 7 | Add Groq provider + update query analyzer | GROQ_API_KEY |
| 8 | Tune prompts for gpt-oss-20b | Step 7 |
| 9 | End-to-end test with 100 reviews | Steps 6-8 |
| 10 | Run full ingestion (18,645 reviews) | Step 9 validated |
| 11 | Delete Pinecone code + cleanup | Step 10 |
| 12 | Add observability logging | Step 9 |
| 13 | Update CLAUDE.md + .env.example | All |

---

## Verification

1. **Extraction:** Confirm `data/raw-reviews.json` has 18,645 entries with clean text
2. **Chunking:** Verify chunks are ~600 tokens, paragraph boundaries preserved
3. **Embedding:** Query known books (e.g., "Lord of Scoundrels") and verify correct results
4. **Two-stage retrieval:** Confirm top-40 vector search → rerank-to-10 → 0.45 floor produces relevant, non-hallucinated context
5. **Generation:** Run 10 test queries through full pipeline, check for hallucination
6. **Observability:** Verify per-stage timing and token usage logs appear
7. **Rollback:** Old Pinecone index remains untouched; can revert by switching env vars back
