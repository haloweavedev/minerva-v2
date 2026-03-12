# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Minerva is a RAG-powered AI chatbot for romance book reviews from All About Romance (AAR). It combines semantic search via Pinecone, LLM-based query routing, and streaming AI responses with visual book card displays.

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

**Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, Vercel AI SDK, Pinecone, Shadcn/ui

**Request flow:**
1. User input → `useChat` hook (`@ai-sdk/react`) in `components/chat.tsx`
2. POST to `app/api/chat/route.ts` → query analyzed by `lib/ai/query-analyzer.ts`
3. Query type determines prompt selection from `lib/ai/prompts.ts`
4. RAG retrieval via `utils/getContext.ts` (OpenAI embeddings → Pinecone → reranking)
5. LLM streams response; may invoke `displayBookCards` tool (`lib/ai/tools/display-book-cards.ts`)
6. Frontend renders streamed text + book cards via `components/message.tsx`

**Query types** (from `query-analyzer.ts`): `recommendation`, `book_info`, `author_info`, `comparison`, `review_analysis`, `follow_up`, `general`

**RAG pipeline** (`utils/getContext.ts`):
- Embedding: OpenAI `text-embedding-3-small`
- Vector search: Pinecone with metadata filters
- HYDE query expansion on weak recall (configurable)
- Heuristic reranking: vector score (78%) + AAR grade preference (17%) + lexical overlap (5%)
- Context caching per chat for follow-up questions (Map in API route)

**Tool system:** Single tool `displayBookCards` — takes recommendation filters, queries Pinecone, reranks results, returns structured Book objects rendered as `BookCard` components.

## Key Directories

- `app/api/chat/route.ts` — sole API endpoint, orchestrates the full pipeline
- `lib/ai/` — AI config: providers, prompts, schemas (Zod), query analyzer, tools
- `utils/getContext.ts` — RAG retrieval with embeddings, HYDE expansion, and reranking
- `components/` — React UI; `chat.tsx` is the main orchestrator, `book-card.tsx`/`book-grid.tsx` for results
- `components/ui/` — Shadcn/ui primitives (button, textarea, tooltip, sonner)
- `scripts/` — utility scripts for Pinecone data inspection (run with `tsx`)

## Environment

Requires `.env.local` (see `.env.example`). Key variables:
- `AI_PROVIDER` — `openai` or `google` (switches LLM provider)
- `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` — provider keys
- `PINECONE_API_KEY`, `PINECONE_INDEX_NAME` — vector DB
- `RAG_*` — tuning knobs for retrieval (top_k, min_score, HYDE, reranking, context size)
- `AI_MAX_TOKENS`, `AI_TEMPERATURE` — generation parameters

## Agent Skills

Always consult the skills in `.claude/skills/` when writing or modifying code. These contain best practices for React, Next.js, frontend design, and web design that must be followed to maintain a pristine codebase.

## Conventions

- Path alias: `@/*` maps to project root
- Shadcn/ui style: `new-york` variant, `slate` base color, CSS variables for theming
- Dark mode: class-based via `next-themes`
- All chat components are client components (`'use client'`)
- Book data schema defined in `lib/ai/schemas.ts` (Zod) — title and author required, all other fields optional
- Remote images allowed only from `allaboutromance.com`
