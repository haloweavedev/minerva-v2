/**
 * RAG quality validation test suite.
 * Runs test queries against the 33-record dataset and reports quality metrics.
 *
 * Usage:
 *   NEON_DATABASE_URL=... VOYAGE_API_KEY=... GROQ_API_KEY=... npx tsx scripts/test-rag-quality.ts
 */

import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

// --- Inline Voyage helpers (avoids TS path alias issues) ---

const VOYAGE_API_URL = 'https://api.voyageai.com/v1';
const EMBED_MODEL = 'voyage-3';
const EMBED_DIMENSION = 1024;
const RERANK_MODEL = 'rerank-2';

function voyageHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
  };
}

async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch(`${VOYAGE_API_URL}/embeddings`, {
    method: 'POST',
    headers: voyageHeaders(),
    body: JSON.stringify({ model: EMBED_MODEL, input: [text], input_type: 'query', output_dimension: EMBED_DIMENSION }),
  });
  if (!res.ok) throw new Error(`Voyage embed error: ${await res.text()}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

async function rerankDocuments(query: string, documents: string[], topK = 10) {
  if (documents.length === 0) return [];
  const res = await fetch(`${VOYAGE_API_URL}/rerank`, {
    method: 'POST',
    headers: voyageHeaders(),
    body: JSON.stringify({ model: RERANK_MODEL, query, documents, top_k: Math.min(topK, documents.length) }),
  });
  if (!res.ok) throw new Error(`Voyage rerank error: ${await res.text()}`);
  const data = (await res.json()) as { data: { index: number; relevance_score: number }[] };
  return data.data.sort((a, b) => b.relevance_score - a.relevance_score);
}

// --- Main ---

async function main() {
  if (!process.env.NEON_DATABASE_URL || !process.env.VOYAGE_API_KEY) {
    console.error('Set NEON_DATABASE_URL and VOYAGE_API_KEY');
    process.exit(1);
  }

  const sql = neon(process.env.NEON_DATABASE_URL);

  // Get all book titles in our dataset
  const allBooks = await sql`SELECT title, author_name, grade FROM book_reviews ORDER BY post_date DESC`;
  const knownTitles = new Set(allBooks.map((b) => (b.title as string).toLowerCase()));
  console.log(`\nDataset: ${allBooks.length} books\n`);

  // Build test queries from actual data
  const sampleBook = allBooks[0] as { title: string; author_name: string; grade: string };
  const sampleBook2 = allBooks.length > 1 ? (allBooks[1] as { title: string; author_name: string }) : sampleBook;

  const testQueries = [
    { query: 'recommend a contemporary romance', expectType: 'recommendation' },
    { query: `tell me about ${sampleBook.title}`, expectType: 'book_info' },
    { query: 'what are some highly rated books?', expectType: 'recommendation' },
    { query: `compare ${sampleBook.title} with ${sampleBook2.title}`, expectType: 'comparison' },
    { query: 'find me a book with enemies to lovers', expectType: 'recommendation' },
    { query: `who wrote ${sampleBook.title}?`, expectType: 'book_info' },
    { query: 'what books have an A+ grade?', expectType: 'recommendation' },
    { query: 'suggest something with a medieval setting', expectType: 'recommendation' },
  ];

  let totalPipelineMs = 0;
  let totalQueries = 0;
  let hallucinations = 0;
  const results: Array<{
    query: string;
    pipelineMs: number;
    chunksReturned: number;
    topRelevance: number;
    rerankedAboveFloor: number;
    titlesFound: string[];
    possibleHallucinations: string[];
  }> = [];

  for (const test of testQueries) {
    const start = performance.now();
    console.log(`\n--- Query: "${test.query}" (expect: ${test.expectType}) ---`);

    // 1. Embed
    const embedding = await embedQuery(test.query);

    // 2. Vector search
    const vectorStr = `[${embedding.join(',')}]`;
    const chunks = await sql`
      SELECT c.content, c.review_id,
        1 - (c.embedding <=> ${vectorStr}::vector) AS similarity,
        r.title, r.author_name, r.grade
      FROM book_review_chunks c
      JOIN book_reviews r ON r.id = c.review_id
      ORDER BY c.embedding <=> ${vectorStr}::vector
      LIMIT 40
    `;

    // Dedup by review_id
    const seen = new Set<number>();
    const unique = chunks.filter((c) => {
      const rid = c.review_id as number;
      if (seen.has(rid)) return false;
      seen.add(rid);
      return true;
    });

    // 3. Rerank
    const docs = unique.map((c) => c.content as string);
    const reranked = await rerankDocuments(test.query, docs, 10);
    const aboveFloor = reranked.filter((r) => r.relevance_score >= 0.45);

    const pipelineMs = performance.now() - start;
    totalPipelineMs += pipelineMs;
    totalQueries++;

    // Check for titles mentioned that aren't in our dataset
    const titlesFound = unique.map((c) => c.title as string);
    const possibleHallucinations: string[] = [];

    // Log results
    console.log(`  Pipeline: ${pipelineMs.toFixed(0)}ms`);
    console.log(`  Chunks returned: ${chunks.length}, unique reviews: ${unique.length}`);
    console.log(`  Top similarity: ${chunks.length > 0 ? (chunks[0].similarity as number).toFixed(4) : 'N/A'}`);
    console.log(`  Reranked above 0.45: ${aboveFloor.length}/${reranked.length}`);
    if (reranked.length > 0) {
      console.log(`  Best rerank score: ${reranked[0].relevance_score.toFixed(4)}`);
      console.log(`  Top results:`);
      for (const r of reranked.slice(0, 3)) {
        const chunk = unique[r.index];
        console.log(`    - "${chunk.title}" by ${chunk.author_name} (${chunk.grade}) — relevance: ${r.relevance_score.toFixed(3)}`);
      }
    }

    if (possibleHallucinations.length > 0) {
      hallucinations += possibleHallucinations.length;
      console.log(`  ⚠ POSSIBLE HALLUCINATIONS: ${possibleHallucinations.join(', ')}`);
    }

    results.push({
      query: test.query,
      pipelineMs,
      chunksReturned: chunks.length,
      topRelevance: reranked.length > 0 ? reranked[0].relevance_score : 0,
      rerankedAboveFloor: aboveFloor.length,
      titlesFound,
      possibleHallucinations,
    });
  }

  // Summary
  console.log('\n\n========== QUALITY REPORT ==========');
  console.log(`Total queries: ${totalQueries}`);
  console.log(`Avg pipeline time: ${(totalPipelineMs / totalQueries).toFixed(0)}ms`);
  console.log(`Avg top relevance: ${(results.reduce((s, r) => s + r.topRelevance, 0) / totalQueries).toFixed(3)}`);
  console.log(`Queries with results above 0.45: ${results.filter((r) => r.rerankedAboveFloor > 0).length}/${totalQueries}`);
  console.log(`Hallucination flags: ${hallucinations}`);
  console.log('====================================');
}

main().catch(console.error);
