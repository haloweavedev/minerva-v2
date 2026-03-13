/**
 * Comprehensive RAG quality test suite.
 * Tests diverse query types against the 18k-record dataset with ground-truth validation.
 *
 * Usage:
 *   NEON_DATABASE_URL=... VOYAGE_API_KEY=... npx tsx scripts/test-rag-quality.ts
 */

import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

// --- Inline Voyage helpers (avoids TS path alias issues) ---

const VOYAGE_API_URL = 'https://api.voyageai.com/v1';
const EMBED_MODEL = 'voyage-3.5';
const EMBED_DIMENSION = 512;
const RERANK_MODEL = 'rerank-2.5';

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

// --- Test Infrastructure ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlFn = (...args: any[]) => Promise<any>;

interface TestCase {
  id: string;
  category: string;
  query: string;
  // Validation: at least one of these must match in the top results
  expectTitles?: string[];        // Exact or partial title matches expected in results
  expectAuthors?: string[];       // Expected author names in results
  expectGrades?: string[];        // Expected grade values in results
  expectTags?: string[];          // Expected tags in result metadata
  expectTypes?: string[];         // Expected book_types in results
  minRelevance?: number;          // Minimum top rerank score
  minAboveFloor?: number;         // Minimum results above 0.45 relevance
  expectInContent?: string[];     // Strings expected in chunk content
}

interface TestResult {
  id: string;
  category: string;
  query: string;
  passed: boolean;
  score: number;   // 0-10 score
  pipelineMs: number;
  topRelevance: number;
  aboveFloor: number;
  topResults: { title: string; author: string; grade: string; relevance: number }[];
  failures: string[];
}

async function runRAGPipeline(sql: SqlFn, query: string) {
  const embedding = await embedQuery(query);
  const vectorStr = `[${embedding.join(',')}]`;

  // Set ef_search for better recall
  await sql`SET LOCAL hnsw.ef_search = 100`;

  const chunks = await sql`
    SELECT c.content, c.review_id,
      1 - (c.embedding <=> ${vectorStr}::vector) AS similarity,
      r.title, r.author_name, r.grade, r.sensuality, r.book_types, r.review_tags, r.post_date::text AS post_date
    FROM book_review_chunks c
    JOIN book_reviews r ON r.id = c.review_id
    ORDER BY c.embedding <=> ${vectorStr}::vector
    LIMIT 40
  `;

  // Dedup by review_id
  const seen = new Set<number>();
  const unique = (chunks as Record<string, unknown>[]).filter((c) => {
    const rid = c.review_id as number;
    if (seen.has(rid)) return false;
    seen.add(rid);
    return true;
  });

  // Rerank
  const docs = unique.map((c) => c.content as string);
  const reranked = await rerankDocuments(query, docs, 10);
  const aboveFloor = reranked.filter((r) => r.relevance_score >= 0.45);

  return { chunks, unique, reranked, aboveFloor };
}

async function runTest(sql: SqlFn, test: TestCase): Promise<TestResult> {
  const start = performance.now();
  const { unique, reranked, aboveFloor } = await runRAGPipeline(sql, test.query);
  const pipelineMs = performance.now() - start;

  const topResults = reranked.slice(0, 5).map((r) => {
    const chunk = unique[r.index];
    return {
      title: chunk.title as string,
      author: chunk.author_name as string,
      grade: (chunk.grade as string) || 'N/A',
      relevance: r.relevance_score,
      types: chunk.book_types as string[] | null,
      tags: chunk.review_tags as string[] | null,
      content: chunk.content as string,
      postDate: chunk.post_date as string,
    };
  });

  const failures: string[] = [];
  let score = 10;

  // Check minimum relevance
  const topRelevance = reranked.length > 0 ? reranked[0].relevance_score : 0;
  const minRelevance = test.minRelevance ?? 0.45;
  if (topRelevance < minRelevance) {
    failures.push(`Top relevance ${topRelevance.toFixed(3)} < ${minRelevance}`);
    score -= 3;
  }

  // Check minimum above floor
  const minAbove = test.minAboveFloor ?? 3;
  if (aboveFloor.length < minAbove) {
    failures.push(`Only ${aboveFloor.length} results above 0.45 (need ${minAbove})`);
    score -= 2;
  }

  // Check expected titles
  if (test.expectTitles) {
    const foundTitles = topResults.map((r) => r.title.toLowerCase());
    const matched = test.expectTitles.filter((t) =>
      foundTitles.some((ft) => ft.includes(t.toLowerCase()))
    );
    if (matched.length === 0) {
      failures.push(`No expected titles found. Expected: [${test.expectTitles.join(', ')}]. Got: [${topResults.map(r => r.title).join(', ')}]`);
      score -= 4;
    } else if (matched.length < test.expectTitles.length) {
      const missing = test.expectTitles.filter((t) =>
        !foundTitles.some((ft) => ft.includes(t.toLowerCase()))
      );
      failures.push(`Missing titles: [${missing.join(', ')}]`);
      score -= 1;
    }
  }

  // Check expected authors
  if (test.expectAuthors) {
    const foundAuthors = topResults.map((r) => r.author.toLowerCase());
    const matched = test.expectAuthors.filter((a) =>
      foundAuthors.some((fa) => fa.includes(a.toLowerCase()))
    );
    if (matched.length === 0) {
      failures.push(`No expected authors found. Expected: [${test.expectAuthors.join(', ')}]. Got: [${topResults.map(r => r.author).join(', ')}]`);
      score -= 3;
    }
  }

  // Check expected grades in results
  if (test.expectGrades) {
    const foundGrades = topResults.map((r) => r.grade);
    const matched = test.expectGrades.filter((g) => foundGrades.includes(g));
    if (matched.length === 0) {
      failures.push(`No expected grades found. Expected: [${test.expectGrades.join(', ')}]. Got: [${foundGrades.join(', ')}]`);
      score -= 2;
    }
  }

  // Check expected types in results
  if (test.expectTypes) {
    const foundTypes = topResults.flatMap((r) => r.types || []);
    const matched = test.expectTypes.filter((t) =>
      foundTypes.some((ft) => ft.toLowerCase().includes(t.toLowerCase()))
    );
    if (matched.length === 0) {
      failures.push(`No expected types found. Expected: [${test.expectTypes.join(', ')}]. Got: [${[...new Set(foundTypes)].join(', ')}]`);
      score -= 2;
    }
  }

  // Check expected tags in results
  if (test.expectTags) {
    const foundTags = topResults.flatMap((r) => r.tags || []).map(t => t.toLowerCase());
    const matched = test.expectTags.filter((t) =>
      foundTags.some((ft) => ft.includes(t.toLowerCase()))
    );
    if (matched.length === 0) {
      failures.push(`No expected tags found. Expected: [${test.expectTags.join(', ')}]. Got subset: [${[...new Set(foundTags)].slice(0, 10).join(', ')}]`);
      score -= 2;
    }
  }

  // Check content matches
  if (test.expectInContent) {
    const allContent = topResults.map((r) => r.content.toLowerCase()).join(' ');
    const matched = test.expectInContent.filter((s) => allContent.includes(s.toLowerCase()));
    if (matched.length === 0) {
      failures.push(`No expected content strings found: [${test.expectInContent.join(', ')}]`);
      score -= 2;
    }
  }

  return {
    id: test.id,
    category: test.category,
    query: test.query,
    passed: failures.length === 0,
    score: Math.max(0, score),
    pipelineMs,
    topRelevance,
    aboveFloor: aboveFloor.length,
    topResults: topResults.map((r) => ({
      title: r.title,
      author: r.author,
      grade: r.grade,
      relevance: r.relevance,
    })),
    failures,
  };
}

// --- Test Cases ---

const TEST_CASES: TestCase[] = [
  // ── SPECIFIC BOOK LOOKUP ──
  {
    id: 'book-1',
    category: 'Book Lookup',
    query: 'Tell me about Winter Cowboy by Kaje Harper',
    expectTitles: ['Winter Cowboy'],
    expectAuthors: ['Kaje Harper'],
    minRelevance: 0.6,
    minAboveFloor: 1, // Specific book queries naturally have few high-relevance results
  },
  {
    id: 'book-2',
    category: 'Book Lookup',
    query: 'What did the reviewer think of The Duke and I by Julia Quinn?',
    expectTitles: ['Duke and I'],
    expectAuthors: ['Julia Quinn'],
    minRelevance: 0.5,
  },
  {
    id: 'book-3',
    category: 'Book Lookup',
    query: 'Review of Venetia by Georgette Heyer',
    expectTitles: ['Venetia'],
    expectAuthors: ['Georgette Heyer'],
    minRelevance: 0.5,
  },

  // ── AUTHOR QUERIES ──
  {
    id: 'author-1',
    category: 'Author',
    query: 'What books by Georgette Heyer have been reviewed?',
    expectAuthors: ['Georgette Heyer'],
    minRelevance: 0.4,
    minAboveFloor: 2,
  },
  {
    id: 'author-2',
    category: 'Author',
    query: 'Show me Cat Sebastian books',
    expectAuthors: ['Cat Sebastian'],
    minRelevance: 0.4,
  },

  // ── TEMPORAL QUERIES ──
  {
    id: 'temporal-1',
    category: 'Temporal',
    query: 'What romance books were reviewed in December 2025?',
    // NOTE: RAG retrieves by semantic similarity, not dates. Temporal filtering
    // requires SQL WHERE clauses, handled by query routing in the API layer.
    // We just verify the pipeline returns romance results (not garbage).
    minRelevance: 0.4,
    minAboveFloor: 3,
  },
  {
    id: 'temporal-2',
    category: 'Temporal',
    query: 'Recent book reviews from late 2025',
    minRelevance: 0.3,
    minAboveFloor: 1,
  },

  // ── GRADE-SPECIFIC ──
  {
    id: 'grade-1',
    category: 'Grade',
    query: 'What are the best rated romance books? I want A+ grades only',
    expectGrades: ['A+', 'A'],
    minRelevance: 0.4,
  },
  {
    id: 'grade-2',
    category: 'Grade',
    query: 'What are the worst rated books on the site?',
    expectGrades: ['F', 'D', 'D-'],
    minRelevance: 0.3,
    minAboveFloor: 1,
  },

  // ── GENRE/TYPE QUERIES ──
  {
    id: 'genre-1',
    category: 'Genre',
    query: 'Recommend a paranormal romance',
    expectTypes: ['Paranormal Romance'],
    minRelevance: 0.5,
  },
  {
    id: 'genre-2',
    category: 'Genre',
    query: 'I want to read a medieval historical romance',
    expectTypes: ['Medieval Romance', 'Historical Romance'],
    minRelevance: 0.5,
  },
  {
    id: 'genre-3',
    category: 'Genre',
    query: 'Any good romantic suspense novels?',
    expectTypes: ['Romantic Suspense'],
    minRelevance: 0.5,
  },
  {
    id: 'genre-4',
    category: 'Genre',
    query: 'Fantasy romance with witches or magic',
    expectTypes: ['Fantasy Romance'],
    minRelevance: 0.5,
  },

  // ── TROPE/TAG QUERIES ──
  {
    id: 'trope-1',
    category: 'Trope',
    query: 'Find me an enemies to lovers romance',
    expectTags: ['enemies to lovers'],
    minRelevance: 0.5,
  },
  {
    id: 'trope-2',
    category: 'Trope',
    query: 'I love cowboy romances, what do you have?',
    expectTags: ['cowboy'],
    minRelevance: 0.5,
  },
  {
    id: 'trope-3',
    category: 'Trope',
    query: 'Recommend a queer romance or M/M love story',
    expectTags: ['Queer romance', 'Male/Male romance'],
    minRelevance: 0.5,
  },
  {
    id: 'trope-4',
    category: 'Trope',
    query: 'Books with a workplace romance theme',
    expectTags: ['workplace romance'],
    minRelevance: 0.4,
  },

  // ── SETTING QUERIES ──
  {
    id: 'setting-1',
    category: 'Setting',
    query: 'Romance set in medieval times with knights',
    expectInContent: ['medieval', 'knight'],
    minRelevance: 0.5,
  },
  {
    id: 'setting-2',
    category: 'Setting',
    query: 'Regency era romance novels',
    expectTypes: ['Regency Romance', 'European Historical Romance'],
    minRelevance: 0.5,
  },

  // ── SENSUALITY QUERIES ──
  {
    id: 'sensuality-1',
    category: 'Sensuality',
    query: 'Really steamy hot romance books',
    expectInContent: ['burning', 'hot', 'steamy'],
    minRelevance: 0.4,
  },
  {
    id: 'sensuality-2',
    category: 'Sensuality',
    query: 'Clean romance with just kisses, nothing explicit',
    expectInContent: ['kisses', 'subtle', 'clean'],
    minRelevance: 0.3,
    minAboveFloor: 1,
  },

  // ── COMPARISON QUERIES ──
  {
    id: 'compare-1',
    category: 'Comparison',
    query: 'Compare In Your Dreams by Sarah Adams with Winter Cowboy by Kaje Harper',
    // Comparison of two specific titles is hard for a single embedding vector.
    // The API route handles this by doing separate lookups. We verify at least one is found.
    expectTitles: ['Winter Cowboy'],
    minRelevance: 0.3,
    minAboveFloor: 1,
  },

  // ── READER OPINION / COMMENT QUERIES ──
  {
    id: 'opinion-1',
    category: 'Reader Opinion',
    query: 'What do readers think about The Duke and I by Julia Quinn? Is it controversial?',
    expectTitles: ['Duke and I'],
    expectAuthors: ['Julia Quinn'],
    minRelevance: 0.4,
  },
  {
    id: 'opinion-2',
    category: 'Reader Opinion',
    query: 'What is the most discussed or controversial book on the site?',
    minRelevance: 0.3,
    minAboveFloor: 1,
  },

  // ── COMPLEX / MULTI-CRITERIA ──
  {
    id: 'complex-1',
    category: 'Complex',
    query: 'I want a highly rated contemporary romance with an A grade, something fun and light',
    expectTypes: ['Contemporary Romance'],
    expectGrades: ['A', 'A-', 'A+'],
    minRelevance: 0.5,
  },
  {
    id: 'complex-2',
    category: 'Complex',
    query: 'Christmas themed holiday romance books',
    expectTags: ['Christmas romance', 'Holiday romance'],
    minRelevance: 0.5,
  },
  {
    id: 'complex-3',
    category: 'Complex',
    query: 'Historical romance set in the 1800s with a strong heroine',
    expectTypes: ['Historical Romance', 'European Historical Romance'],
    minRelevance: 0.4,
  },

  // ── EDGE CASES ──
  {
    id: 'edge-1',
    category: 'Edge Case',
    query: 'Books about grief and loss in fiction',
    minRelevance: 0.3,
    minAboveFloor: 1,
  },
  {
    id: 'edge-2',
    category: 'Edge Case',
    query: 'Audiobook romance recommendations',
    expectTypes: ['Audiobook'],
    minRelevance: 0.3,
  },
];

// --- Main ---

async function main() {
  if (!process.env.NEON_DATABASE_URL || !process.env.VOYAGE_API_KEY) {
    console.error('Set NEON_DATABASE_URL and VOYAGE_API_KEY');
    process.exit(1);
  }

  const sql = neon(process.env.NEON_DATABASE_URL);

  // Verify dataset
  const countResult = await sql`SELECT COUNT(*)::int AS c FROM book_reviews`;
  console.log(`\nDataset: ${countResult[0].c} reviews\n`);
  console.log(`Running ${TEST_CASES.length} test cases...\n`);
  console.log('='.repeat(80));

  const results: TestResult[] = [];

  for (const test of TEST_CASES) {
    const result = await runTest(sql, test);
    results.push(result);

    const status = result.passed ? 'PASS' : 'FAIL';
    const statusIcon = result.passed ? '✓' : '✗';
    console.log(`\n${statusIcon} [${test.category}] ${test.id}: "${test.query}"`);
    console.log(`  Score: ${result.score}/10 | Relevance: ${result.topRelevance.toFixed(3)} | Above 0.45: ${result.aboveFloor} | Time: ${result.pipelineMs.toFixed(0)}ms`);

    if (result.topResults.length > 0) {
      console.log(`  Top 3:`);
      for (const r of result.topResults.slice(0, 3)) {
        console.log(`    - "${r.title}" by ${r.author} (${r.grade}) — ${r.relevance.toFixed(3)}`);
      }
    }

    if (result.failures.length > 0) {
      for (const f of result.failures) {
        console.log(`  ✗ ${f}`);
      }
    }
  }

  // === SUMMARY ===
  console.log('\n' + '='.repeat(80));
  console.log('QUALITY REPORT');
  console.log('='.repeat(80));

  const passed = results.filter((r) => r.passed).length;
  const totalScore = results.reduce((s, r) => s + r.score, 0);
  const maxScore = results.length * 10;
  const avgRelevance = results.reduce((s, r) => s + r.topRelevance, 0) / results.length;
  const avgPipeline = results.reduce((s, r) => s + r.pipelineMs, 0) / results.length;

  // Category breakdown
  const categories = [...new Set(results.map((r) => r.category))];
  console.log('\nBy Category:');
  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    const catPassed = catResults.filter((r) => r.passed).length;
    const catScore = catResults.reduce((s, r) => s + r.score, 0);
    const catMax = catResults.length * 10;
    const catAvgRel = catResults.reduce((s, r) => s + r.topRelevance, 0) / catResults.length;
    console.log(`  ${cat}: ${catPassed}/${catResults.length} passed | ${catScore}/${catMax} pts | avg relevance: ${catAvgRel.toFixed(3)}`);
  }

  // Failed tests
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.log(`\nFailed Tests (${failed.length}):`);
    for (const f of failed) {
      console.log(`  ${f.id}: ${f.failures.join('; ')}`);
    }
  }

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Tests: ${passed}/${results.length} passed`);
  console.log(`Score: ${totalScore}/${maxScore} (${((totalScore / maxScore) * 10).toFixed(1)}/10)`);
  console.log(`Avg top relevance: ${avgRelevance.toFixed(3)}`);
  console.log(`Avg pipeline time: ${avgPipeline.toFixed(0)}ms`);
  console.log(`${'─'.repeat(40)}`);

  // Exit with error if score is bad
  const overallScore = (totalScore / maxScore) * 10;
  if (overallScore < 7) {
    console.log('\n⚠ BELOW QUALITY THRESHOLD (7/10)');
    process.exit(1);
  } else if (overallScore >= 9) {
    console.log('\n★ EXCELLENT QUALITY');
  } else {
    console.log('\n● GOOD QUALITY');
  }
}

main().catch(console.error);
