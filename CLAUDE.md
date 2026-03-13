# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Minerva is a RAG-powered AI chatbot for romance book reviews from All About Romance (AAR). It combines semantic search via Neon pgvector, Voyage AI embeddings/reranking, LLM-based query routing, and streaming AI responses with visual book card displays.

## Commands

```bash
pnpm install    # Install dependencies
pnpm dev        # Dev server at http://localhost:3000
pnpm build      # Production build
pnpm start      # Production server
pnpm lint       # ESLint
```

No test framework is configured.

## Architecture

**Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, AI SDK v6, Neon pgvector, Voyage AI, Groq/OpenAI/Google, Shadcn/ui

**Request flow:**
1. User input → `useChat` hook (`@ai-sdk/react`) in `components/chat.tsx`
2. POST to `app/api/chat/route.ts` → query analyzed by `lib/ai/query-analyzer.ts`
3. Query type determines prompt selection from `lib/ai/prompts.ts`
4. RAG retrieval via `utils/getContext.ts` (Voyage AI embeddings → pgvector → Voyage reranking)
5. LLM streams response via `streamText`; may invoke `displayBookCards` tool
6. Frontend renders streamed text + book cards via `components/message.tsx`

**Dual-inference pattern:** Query analysis always uses Groq (low-latency, deterministic at temp 0.1) regardless of the main LLM provider configured via `AI_PROVIDER`.

**Query types** (from `query-analyzer.ts`): `recommendation`, `book_info`, `author_info`, `comparison`, `review_analysis`, `follow_up`, `general`

**Query-specific routing in the API route:**
- `recommendation` — tool-driven (no pre-retrieval, `displayBookCards` handles it)
- `book_info` — early return with `stopWhen: stepCountIs(2)` for tool invocation
- `comparison` — RAG context with `comparisonPrompt()`
- `review_analysis` — RAG context with `analysisPrompt()`
- `follow_up` — uses cached context from previous turn (in-memory `Map<chatId, context>`)
- Others — generic `systemPromptWithContext()`

**RAG pipeline** (`utils/getContext.ts`):
- Embedding: Voyage AI `voyage-3.5` (512 dimensions)
- Vector search: Neon pgvector cosine similarity (`<=>` operator) → top 40, `ef_search=100`
- Reranking: Voyage `rerank-2.5` → top 10 (relevance floor 0.45)
- Deduplication by review_id (keeps best similarity per review)
- Context truncation at `RAG_MAX_CONTEXT_CHARS` (default 8000)
- Comparison queries: results organized by title

**Tool system** — single tool `displayBookCards` with two modes:
1. **Specific titles:** Lookup via `findReviewByTitleAuthor()` in pgvector DB, fallback to vector search
2. **Recommendations:** Full filtering pipeline — subgenre normalization, sensuality mapping, grade filtering, Voyage reranking (0.3 relevance floor), returns up to 6 books

**Database layer** (`lib/db.ts`): Neon serverless SQL client with pgvector. Key functions: `searchSimilarChunks()`, `findReviewByTitleAuthor()`, `searchByTitle()`, `getReviewById()`

**Voyage AI integration** (`lib/voyage.ts`): `voyage-3.5` for embeddings (512 dims), `rerank-2.5` for reranking. Batch processing (40 per batch) with performance timing.

**Database schema** — 3 tables:
- `book_reviews` — 18,640 reviews with `source_batch` for ingestion tracking
- `book_review_chunks` — ~46,574 chunks with 512-dim vector embeddings + HNSW index (m=16, ef_construction=100)
- `book_review_comments` — ~24,505 reader comments
- Indexes: pg_trgm GIN on title, B-tree on LOWER(author_name), grade, post_date DESC
- Total DB: ~425 MB (Neon free tier: 512 MB)

## Key Directories

- `app/api/chat/route.ts` — sole API endpoint, orchestrates the full pipeline
- `lib/ai/` — AI config: providers, prompts, schemas (Zod), query analyzer, tools
- `lib/db.ts` — Neon pgvector database client and query functions
- `lib/voyage.ts` — Voyage AI embeddings and reranking
- `utils/getContext.ts` — RAG retrieval with embeddings, reranking, and context formatting
- `components/` — React UI; `chat.tsx` is the main orchestrator, `book-card.tsx`/`book-grid.tsx` for results
- `components/ui/` — Shadcn/ui primitives (button, textarea, tooltip, sonner)
- `scripts/` — utility scripts for data inspection (run with `tsx`)

## Environment

Requires `.env.local` (see `.env.example`). Key variables:
- `AI_PROVIDER` — `groq` (default), `openai`, or `google`
- `GROQ_API_KEY`, `GROQ_MODEL_ID` — Groq provider (default model: `openai/gpt-oss-20b`)
- `OPENAI_API_KEY`, `OPENAI_MODEL_ID` — OpenAI provider (default: `gpt-4-turbo`)
- `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_MODEL_ID` — Google provider (default: `gemini-1.5-pro-latest`)
- `VOYAGE_API_KEY` — required for embeddings + reranking
- `NEON_DATABASE_URL` — required for pgvector
- `RAG_MAX_CONTEXT_CHARS` — context truncation limit (default 8000)
- `AI_MAX_TOKENS`, `AI_TEMPERATURE` — generation parameters (defaults: 2048, 0.4)

## Agent Skills

Always consult the skills in `.agents/skills/` when writing or modifying code. These contain best practices for React, Next.js, frontend design, and web design that must be followed to maintain a pristine codebase.

## Conventions

- Path alias: `@/*` maps to project root
- Shadcn/ui style: `new-york` variant, `slate` base color, CSS variables for theming
- Dark mode: class-based via `next-themes`
- All chat components are client components (`'use client'`)
- Book data schema defined in `lib/ai/schemas.ts` (Zod) — title and author required, all other fields optional
- Remote images allowed only from `allaboutromance.com`
- Groq-specific provider option: `reasoningFormat: 'hidden'` passed when using Groq
- Framer Motion used for message and book grid animations
