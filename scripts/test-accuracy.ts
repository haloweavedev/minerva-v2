/**
 * Minerva Accuracy Test Suite
 *
 * Tests the grade-filtering, sorting, and recommendation pipeline against
 * ground truth from /data. Validates the 4 client-reported bugs are fixed:
 *   1. C-rated books called "standout titles"
 *   2. "Highly rated" requests return C-grade books
 *   3. Lowest graded books shown first
 *   4. Tone too chatty (prompt-level, checked structurally)
 *
 * Logs all results to test-results/ for iterative self-correction.
 *
 * Usage:
 *   NEON_DATABASE_URL=... VOYAGE_API_KEY=... npx tsx scripts/test-accuracy.ts
 */

import dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';

// ─── Inline Voyage helpers (avoids TS path alias issues in scripts) ───

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

// ─── Inline grade utilities (mirrors lib/grades.ts) ───

const GRADE_MAP: Record<string, number> = {
  'A+': 13, 'A': 12, 'A-': 11,
  'B+': 10, 'B': 9, 'B-': 8,
  'C+': 7, 'C': 6, 'C-': 5,
  'D+': 4, 'D': 3, 'D-': 2,
  'F': 1,
};

function gradeToNumeric(grade: string | null | undefined): number {
  if (!grade) return 0;
  return GRADE_MAP[grade.toUpperCase()] ?? 0;
}

function isHighGrade(grade: string | null | undefined): boolean {
  return gradeToNumeric(grade) >= 10;
}

function expandGradeRange(input: string): string[] {
  const key = input.toLowerCase().replace(/\s+/g, '_');
  switch (key) {
    case 'highly_rated': return ['A+', 'A', 'A-', 'B+'];
    case 'a_range': return ['A+', 'A', 'A-'];
    case 'b_range': return ['B+', 'B', 'B-'];
    case 'c_range': return ['C+', 'C', 'C-'];
    case 'd_range': return ['D+', 'D', 'D-'];
    case 'poorly_rated': return ['C-', 'D+', 'D', 'D-', 'F'];
    default: {
      const normalized = input.toUpperCase().trim();
      if (GRADE_MAP[normalized]) return [normalized];
      return [];
    }
  }
}

// ─── Ground truth loader ───

interface GroundTruthReview {
  postId: number;
  title: string;
  authorName: string;
  grade: string | null;
  sensuality: string | null;
  bookTypes: string[] | null;
  reviewTags: string[] | null;
}

function loadGroundTruth(): GroundTruthReview[] {
  const dataDir = path.join(__dirname, '..', 'data');
  const reviews: GroundTruthReview[] = [];
  for (const file of fs.readdirSync(dataDir).sort()) {
    if (!file.startsWith('reviews-batch')) continue;
    const batch = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    for (const r of batch) {
      reviews.push({
        postId: r.postId,
        title: r.title,
        authorName: r.authorName,
        grade: r.grade || null,
        sensuality: r.sensuality || null,
        bookTypes: r.bookTypes || null,
        reviewTags: r.reviewTags || null,
      });
    }
  }
  return reviews;
}

// ─── Test infrastructure ───

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlFn = (...args: any[]) => Promise<any>;

interface ChunkResult {
  chunk_id: number;
  review_id: number;
  content: string;
  similarity: number;
  title: string;
  author_name: string;
  grade: string | null;
  sensuality: string | null;
  book_types: string[] | null;
  review_tags: string[] | null;
  post_date: string | null;
}

interface TestCase {
  id: string;
  category: string;
  query: string;
  description: string;
  // What to test
  gradeFilter?: string;              // e.g. "highly_rated", "A_range", "A+"
  expectGradesOnly?: string[];       // ALL results must have one of these grades
  expectGradesInTop3?: string[];     // At least one of top 3 must have these grades
  expectNoGrades?: string[];         // NONE of the results should have these grades
  expectSortedByGrade?: boolean;     // Results should be grade-descending
  expectTitles?: string[];           // Partial title matches in results
  expectAuthors?: string[];          // Author matches
  expectTypes?: string[];            // Book type matches
  expectTags?: string[];             // Tag matches
  expectMinResults?: number;         // Minimum results returned
  expectMaxResults?: number;         // Maximum results (for empty-is-ok tests)
  minRelevance?: number;             // Minimum top rerank score
}

interface TestResult {
  id: string;
  category: string;
  query: string;
  description: string;
  passed: boolean;
  score: number;
  maxScore: number;
  pipelineMs: number;
  gradeFilter: string | null;
  expandedGrades: string[];
  results: {
    title: string;
    author: string;
    grade: string | null;
    gradeNum: number;
    relevance: number;
  }[];
  checks: { name: string; passed: boolean; detail: string }[];
}

// ─── Pipeline: mirrors display-book-cards.ts recommendation flow ───

async function runGradeFilteredPipeline(
  sql: SqlFn,
  query: string,
  gradeFilter?: string,
): Promise<{ results: ChunkResult[]; reranked: { index: number; relevance_score: number }[]; ms: number }> {
  const start = performance.now();
  const expandedGrades = gradeFilter ? expandGradeRange(gradeFilter) : [];
  const hasGradeFilter = expandedGrades.length > 0;

  const embedding = await embedQuery(query);
  const vectorStr = `[${embedding.join(',')}]`;

  await sql`SET LOCAL hnsw.ef_search = 100`;

  let chunks: Record<string, unknown>[];

  if (hasGradeFilter) {
    chunks = await sql`
      SELECT c.id AS chunk_id, c.review_id, c.content,
        1 - (c.embedding <=> ${vectorStr}::vector) AS similarity,
        r.title, r.author_name, r.grade, r.sensuality, r.book_types, r.review_tags, r.post_date::text AS post_date
      FROM book_review_chunks c
      JOIN book_reviews r ON r.id = c.review_id
      WHERE r.grade = ANY(${expandedGrades}::text[])
      ORDER BY c.embedding <=> ${vectorStr}::vector
      LIMIT 40
    `;
  } else {
    chunks = await sql`
      SELECT c.id AS chunk_id, c.review_id, c.content,
        1 - (c.embedding <=> ${vectorStr}::vector) AS similarity,
        r.title, r.author_name, r.grade, r.sensuality, r.book_types, r.review_tags, r.post_date::text AS post_date
      FROM book_review_chunks c
      JOIN book_reviews r ON r.id = c.review_id
      ORDER BY c.embedding <=> ${vectorStr}::vector
      LIMIT 30
    `;
  }

  // Dedup by review_id
  const seen = new Set<number>();
  const unique = chunks.filter(c => {
    const rid = c.review_id as number;
    if (seen.has(rid)) return false;
    seen.add(rid);
    return true;
  }) as unknown as ChunkResult[];

  // Rerank
  const docs = unique.map(c => c.content);
  const reranked = await rerankDocuments(query, docs, 8);

  // Build sorted candidates (grade desc, then relevance desc) — mirrors the fix
  const candidates = reranked
    .filter(r => r.relevance_score >= 0.3)
    .map(r => ({ ...r, chunk: unique[r.index] }));

  candidates.sort((a, b) => {
    const gradeA = gradeToNumeric(a.chunk.grade);
    const gradeB = gradeToNumeric(b.chunk.grade);
    return gradeB - gradeA || b.relevance_score - a.relevance_score;
  });

  const finalResults = candidates.slice(0, 6).map(c => c.chunk);
  const finalReranked = candidates.slice(0, 6).map(c => ({
    index: reranked.findIndex(r => r.index === unique.indexOf(c.chunk)),
    relevance_score: c.relevance_score,
  }));

  return { results: finalResults, reranked: finalReranked, ms: performance.now() - start };
}

// ─── Test runner ───

async function runTest(sql: SqlFn, test: TestCase): Promise<TestResult> {
  const { results, reranked, ms } = await runGradeFilteredPipeline(sql, test.query, test.gradeFilter);

  const expandedGrades = test.gradeFilter ? expandGradeRange(test.gradeFilter) : [];

  const mappedResults = results.map((r, i) => ({
    title: r.title,
    author: r.author_name,
    grade: r.grade,
    gradeNum: gradeToNumeric(r.grade),
    relevance: reranked[i]?.relevance_score ?? 0,
  }));

  const checks: { name: string; passed: boolean; detail: string }[] = [];
  let score = 0;
  let maxScore = 0;

  // Check: grade filter respected (ALL results match allowed grades)
  if (test.expectGradesOnly) {
    maxScore += 3;
    const allowed = new Set(test.expectGradesOnly);
    const violations = mappedResults.filter(r => r.grade && !allowed.has(r.grade));
    const passed = violations.length === 0;
    if (passed) score += 3;
    checks.push({
      name: 'grade_filter_respected',
      passed,
      detail: passed
        ? `All ${mappedResults.length} results have allowed grades`
        : `${violations.length} violations: ${violations.map(v => `${v.title} (${v.grade})`).join(', ')}`,
    });
  }

  // Check: expected grades appear in top 3
  if (test.expectGradesInTop3) {
    maxScore += 2;
    const top3Grades = mappedResults.slice(0, 3).map(r => r.grade).filter(Boolean) as string[];
    const found = test.expectGradesInTop3.some(g => top3Grades.includes(g));
    if (found) score += 2;
    checks.push({
      name: 'grade_in_top3',
      passed: found,
      detail: found
        ? `Top 3 grades: ${top3Grades.join(', ')}`
        : `Expected one of [${test.expectGradesInTop3.join(',')}] in top 3, got [${top3Grades.join(',')}]`,
    });
  }

  // Check: no forbidden grades
  if (test.expectNoGrades) {
    maxScore += 3;
    const forbidden = new Set(test.expectNoGrades);
    const violations = mappedResults.filter(r => r.grade && forbidden.has(r.grade));
    const passed = violations.length === 0;
    if (passed) score += 3;
    checks.push({
      name: 'no_forbidden_grades',
      passed,
      detail: passed
        ? `No forbidden grades found`
        : `Found ${violations.length} forbidden: ${violations.map(v => `${v.title} (${v.grade})`).join(', ')}`,
    });
  }

  // Check: sorted by grade descending
  if (test.expectSortedByGrade) {
    maxScore += 2;
    let sorted = true;
    for (let i = 1; i < mappedResults.length; i++) {
      if (mappedResults[i].gradeNum > mappedResults[i - 1].gradeNum) {
        sorted = false;
        break;
      }
    }
    if (sorted) score += 2;
    checks.push({
      name: 'grade_sort_order',
      passed: sorted,
      detail: sorted
        ? `Results sorted: ${mappedResults.map(r => r.grade).join(' >= ')}`
        : `Sort broken: ${mappedResults.map(r => `${r.grade}(${r.gradeNum})`).join(', ')}`,
    });
  }

  // Check: expected titles found
  if (test.expectTitles) {
    maxScore += 2;
    const foundTitles = mappedResults.map(r => r.title.toLowerCase());
    const matched = test.expectTitles.filter(t => foundTitles.some(ft => ft.includes(t.toLowerCase())));
    const passed = matched.length > 0;
    if (passed) score += 2;
    checks.push({
      name: 'expected_titles',
      passed,
      detail: passed
        ? `Found: ${matched.join(', ')}`
        : `None of [${test.expectTitles.join(', ')}] found in [${mappedResults.map(r => r.title).join(', ')}]`,
    });
  }

  // Check: expected authors
  if (test.expectAuthors) {
    maxScore += 2;
    const foundAuthors = mappedResults.map(r => r.author.toLowerCase());
    const matched = test.expectAuthors.filter(a => foundAuthors.some(fa => fa.includes(a.toLowerCase())));
    const passed = matched.length > 0;
    if (passed) score += 2;
    checks.push({
      name: 'expected_authors',
      passed,
      detail: passed
        ? `Found: ${matched.join(', ')}`
        : `None of [${test.expectAuthors.join(', ')}] in [${mappedResults.map(r => r.author).join(', ')}]`,
    });
  }

  // Check: expected book types
  if (test.expectTypes) {
    maxScore += 2;
    const foundTypes = results.flatMap(r => r.book_types || []);
    const matched = test.expectTypes.filter(t => foundTypes.some(ft => ft.toLowerCase().includes(t.toLowerCase())));
    const passed = matched.length > 0;
    if (passed) score += 2;
    checks.push({
      name: 'expected_types',
      passed,
      detail: passed
        ? `Found types: ${matched.join(', ')}`
        : `None of [${test.expectTypes.join(', ')}] in [${[...new Set(foundTypes)].join(', ')}]`,
    });
  }

  // Check: expected tags
  if (test.expectTags) {
    maxScore += 2;
    const foundTags = results.flatMap(r => r.review_tags || []).map(t => t.toLowerCase());
    const matched = test.expectTags.filter(t => foundTags.some(ft => ft.includes(t.toLowerCase())));
    const passed = matched.length > 0;
    if (passed) score += 2;
    checks.push({
      name: 'expected_tags',
      passed,
      detail: passed
        ? `Found tags: ${matched.join(', ')}`
        : `None of [${test.expectTags.join(', ')}] in [${[...new Set(foundTags)].slice(0, 15).join(', ')}]`,
    });
  }

  // Check: minimum results
  if (test.expectMinResults !== undefined) {
    maxScore += 1;
    const passed = mappedResults.length >= test.expectMinResults;
    if (passed) score += 1;
    checks.push({
      name: 'min_results',
      passed,
      detail: `Got ${mappedResults.length}, need >= ${test.expectMinResults}`,
    });
  }

  // Check: maximum results (for "should be empty" tests)
  if (test.expectMaxResults !== undefined) {
    maxScore += 1;
    const passed = mappedResults.length <= test.expectMaxResults;
    if (passed) score += 1;
    checks.push({
      name: 'max_results',
      passed,
      detail: `Got ${mappedResults.length}, need <= ${test.expectMaxResults}`,
    });
  }

  // Check: minimum relevance
  if (test.minRelevance) {
    maxScore += 1;
    const topRel = reranked.length > 0 ? reranked[0].relevance_score : 0;
    const passed = topRel >= test.minRelevance;
    if (passed) score += 1;
    checks.push({
      name: 'min_relevance',
      passed,
      detail: `Top relevance: ${topRel.toFixed(3)}, need >= ${test.minRelevance}`,
    });
  }

  const allPassed = checks.every(c => c.passed);

  return {
    id: test.id,
    category: test.category,
    query: test.query,
    description: test.description,
    passed: allPassed,
    score,
    maxScore,
    pipelineMs: ms,
    gradeFilter: test.gradeFilter || null,
    expandedGrades,
    results: mappedResults,
    checks,
  };
}

// ─── Unit tests (no API needed) ───

function runUnitTests(): { passed: number; failed: number; details: string[] } {
  const details: string[] = [];
  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, detail?: string) {
    if (condition) {
      passed++;
      details.push(`  ✓ ${name}`);
    } else {
      failed++;
      details.push(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
  }

  // gradeToNumeric
  assert('gradeToNumeric A+', gradeToNumeric('A+') === 13);
  assert('gradeToNumeric A', gradeToNumeric('A') === 12);
  assert('gradeToNumeric B+', gradeToNumeric('B+') === 10);
  assert('gradeToNumeric C', gradeToNumeric('C') === 6);
  assert('gradeToNumeric F', gradeToNumeric('F') === 1);
  assert('gradeToNumeric null', gradeToNumeric(null) === 0);
  assert('gradeToNumeric empty', gradeToNumeric('') === 0);
  assert('gradeToNumeric junk', gradeToNumeric('X') === 0);

  // isHighGrade
  assert('isHighGrade A+', isHighGrade('A+') === true);
  assert('isHighGrade B+', isHighGrade('B+') === true);
  assert('isHighGrade B', isHighGrade('B') === false);
  assert('isHighGrade C', isHighGrade('C') === false);
  assert('isHighGrade null', isHighGrade(null) === false);

  // expandGradeRange
  const hr = expandGradeRange('highly_rated');
  assert('expandGradeRange highly_rated length', hr.length === 4, `got ${hr.length}`);
  assert('expandGradeRange highly_rated includes A+', hr.includes('A+'));
  assert('expandGradeRange highly_rated includes B+', hr.includes('B+'));
  assert('expandGradeRange highly_rated no B', !hr.includes('B'));

  const ar = expandGradeRange('A_range');
  assert('expandGradeRange A_range length', ar.length === 3, `got ${ar.length}`);
  assert('expandGradeRange A_range includes A+', ar.includes('A+'));
  assert('expandGradeRange A_range no B+', !ar.includes('B+'));

  const br = expandGradeRange('B_range');
  assert('expandGradeRange B_range', br.length === 3 && br.includes('B+') && br.includes('B-'));

  const single = expandGradeRange('A+');
  assert('expandGradeRange single A+', single.length === 1 && single[0] === 'A+');

  const poorly = expandGradeRange('poorly_rated');
  assert('expandGradeRange poorly_rated includes F', poorly.includes('F'));
  assert('expandGradeRange poorly_rated no A', !poorly.includes('A'));

  const junk = expandGradeRange('banana');
  assert('expandGradeRange junk returns empty', junk.length === 0, `got ${junk.length}`);

  // Grade sort order
  const grades = ['C', 'A+', 'B', 'A-', 'F'];
  const sorted = [...grades].sort((a, b) => gradeToNumeric(b) - gradeToNumeric(a));
  assert('grade sort order', sorted[0] === 'A+' && sorted[1] === 'A-' && sorted[4] === 'F',
    `got ${sorted.join(',')}`);

  return { passed, failed, details };
}

// ─── Ground truth validation ───

function validateGroundTruth(groundTruth: GroundTruthReview[]) {
  const details: string[] = [];
  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, detail?: string) {
    if (condition) { passed++; details.push(`  ✓ ${name}`); }
    else { failed++; details.push(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
  }

  // Count grades in ground truth
  const gradeCounts: Record<string, number> = {};
  for (const r of groundTruth) {
    const g = r.grade || 'null';
    gradeCounts[g] = (gradeCounts[g] || 0) + 1;
  }

  assert('ground truth has A+ books', (gradeCounts['A+'] || 0) > 50, `got ${gradeCounts['A+']}`);
  assert('ground truth has C books', (gradeCounts['C'] || 0) > 1000, `got ${gradeCounts['C']}`);
  assert('ground truth has F books', (gradeCounts['F'] || 0) > 100, `got ${gradeCounts['F']}`);

  // Verify highly_rated expansion matches real data
  const highlyRated = expandGradeRange('highly_rated');
  const highlyRatedCount = groundTruth.filter(r => r.grade && highlyRated.includes(r.grade)).length;
  assert('highly_rated covers substantial portion', highlyRatedCount > 5000, `got ${highlyRatedCount}`);

  // Verify A_range is much smaller
  const aRange = expandGradeRange('A_range');
  const aRangeCount = groundTruth.filter(r => r.grade && aRange.includes(r.grade)).length;
  assert('A_range is subset of highly_rated', aRangeCount < highlyRatedCount);

  // Verify there are medieval A-range books (for our test case)
  const medievalA = groundTruth.filter(r =>
    r.grade && aRange.includes(r.grade) &&
    r.bookTypes?.some(t => t.toLowerCase().includes('medieval'))
  );
  assert('medieval A-range books exist', medievalA.length >= 3, `got ${medievalA.length}`);

  return { passed, failed, details };
}

// ─── Prompt validation (structural, no API needed) ───

function validatePrompts(): { passed: number; failed: number; details: string[] } {
  const details: string[] = [];
  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, detail?: string) {
    if (condition) { passed++; details.push(`  ✓ ${name}`); }
    else { failed++; details.push(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
  }

  // Read prompt file
  const promptPath = path.join(__dirname, '..', 'lib', 'ai', 'prompts.ts');
  const promptContent = fs.readFileSync(promptPath, 'utf8');

  // Tone: should NOT have gushy language in base prompt
  assert('no "warm but professional" in base prompt',
    !promptContent.includes('Sound like a knowledgeable romance reader. Keep it warm but professional'),
    'Old gushy tone instruction still present');

  // Should have reference librarian tone
  assert('has reference librarian tone',
    promptContent.includes('reference librarian'),
    'Missing reference librarian tone instruction');

  // Should have grade interpretation rules
  assert('has grade interpretation section',
    promptContent.includes('Grade interpretation (CRITICAL)'),
    'Missing grade interpretation section');

  // Should have C-grade guardrail
  assert('has C-grade guardrail',
    promptContent.includes('NEVER describe a C-graded book as'),
    'Missing C-grade guardrail');

  // Should require stating grades explicitly
  assert('requires stating grades explicitly',
    promptContent.includes('Always state each book\'s grade explicitly'),
    'Missing grade-stating requirement');

  // Should have enthusiasm matching
  assert('has enthusiasm matching rule',
    promptContent.includes('Match your enthusiasm to the grade'),
    'Missing enthusiasm matching rule');

  // Recommendation prompt should also have grade guardrails
  assert('recommendation prompt has grade guardrails',
    promptContent.includes('NEVER describe a C-graded book') &&
    promptContent.includes('recommendationPrompt'),
    'Recommendation prompt missing grade guardrails');

  // Check tool schema
  const schemaPath = path.join(__dirname, '..', 'lib', 'ai', 'schemas.ts');
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  assert('schema has grade range descriptions',
    schemaContent.includes('highly_rated') && schemaContent.includes('A_range'),
    'Schema missing grade range keywords');

  // Check query analyzer
  const analyzerPath = path.join(__dirname, '..', 'lib', 'ai', 'query-analyzer.ts');
  const analyzerContent = fs.readFileSync(analyzerPath, 'utf8');
  assert('analyzer has highly_rated example',
    analyzerContent.includes('highly_rated'),
    'Analyzer missing highly_rated example');
  assert('analyzer has A_range example',
    analyzerContent.includes('A_range'),
    'Analyzer missing A_range example');

  // Check tool file
  const toolPath = path.join(__dirname, '..', 'lib', 'ai', 'tools', 'display-book-cards.ts');
  const toolContent = fs.readFileSync(toolPath, 'utf8');
  assert('tool imports expandGradeRange',
    toolContent.includes('expandGradeRange'),
    'Tool missing expandGradeRange import');
  assert('tool imports gradeToNumeric',
    toolContent.includes('gradeToNumeric'),
    'Tool missing gradeToNumeric import');
  assert('tool has no silent fallback',
    !toolContent.includes('if (filtered.length === 0) filtered = uniqueChunks'),
    'Silent fallback still present in tool');
  assert('tool sorts by grade',
    toolContent.includes('gradeNum') && toolContent.includes('.sort('),
    'Tool missing grade-based sort');

  return { passed, failed, details };
}

// ─── Integration test cases ───

const TEST_CASES: TestCase[] = [
  // ═══ CLIENT BUG #1 & #2: "Highly rated" must NOT return C-grade books ═══
  {
    id: 'bug-fix-1',
    category: 'Client Bug Fix',
    query: 'Recommend highly rated medieval romances',
    description: 'BUG #2: "Highly rated" should only return A+/A/A-/B+ books, never C-grade',
    gradeFilter: 'highly_rated',
    expectGradesOnly: ['A+', 'A', 'A-', 'B+'],
    expectNoGrades: ['C+', 'C', 'C-', 'D+', 'D', 'D-', 'F', 'B', 'B-'],
    expectTypes: ['Medieval Romance'],
    expectMinResults: 1,
    minRelevance: 0.3,
  },
  {
    id: 'bug-fix-2',
    category: 'Client Bug Fix',
    query: 'Show me the best romance books',
    description: 'BUG #2: "Best" should map to highly_rated, no C-grade',
    gradeFilter: 'highly_rated',
    expectGradesOnly: ['A+', 'A', 'A-', 'B+'],
    expectNoGrades: ['C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'],
    expectMinResults: 3,
  },

  // ═══ CLIENT BUG #3: Lowest graded books shown first ═══
  {
    id: 'bug-fix-3',
    category: 'Client Bug Fix',
    query: 'Top rated contemporary romance',
    description: 'BUG #3: Results must be sorted grade-descending (A+ first, not C first)',
    gradeFilter: 'highly_rated',
    expectGradesOnly: ['A+', 'A', 'A-', 'B+'],
    expectSortedByGrade: true,
    expectTypes: ['Contemporary Romance'],
    expectMinResults: 3,
  },
  {
    id: 'bug-fix-4',
    category: 'Client Bug Fix',
    query: 'Best historical romances',
    description: 'BUG #3: Grade sort — A+ before A before A-',
    gradeFilter: 'highly_rated',
    expectSortedByGrade: true,
    expectTypes: ['Historical Romance'],
    expectMinResults: 3,
  },

  // ═══ GRADE FILTERING: Specific ranges ═══
  {
    id: 'grade-a-plus',
    category: 'Grade Filter',
    query: 'Give me A+ regency romances',
    description: 'Single grade A+ filter should return ONLY A+ books',
    gradeFilter: 'A+',
    expectGradesOnly: ['A+'],
    expectNoGrades: ['A', 'A-', 'B+', 'B', 'C'],
    // A+ Regency is very rare, may return few results — that's correct behavior
  },
  {
    id: 'grade-a-range',
    category: 'Grade Filter',
    query: 'A-graded paranormal romance',
    description: 'A_range filter should return A+/A/A- only',
    gradeFilter: 'A_range',
    expectGradesOnly: ['A+', 'A', 'A-'],
    expectNoGrades: ['B+', 'B', 'C', 'D', 'F'],
    expectTypes: ['Paranormal Romance'],
    expectMinResults: 1,
  },
  {
    id: 'grade-b-range',
    category: 'Grade Filter',
    query: 'B-graded fantasy romance',
    description: 'B_range should return B+/B/B- only',
    gradeFilter: 'B_range',
    expectGradesOnly: ['B+', 'B', 'B-'],
    expectNoGrades: ['A+', 'A', 'C', 'D', 'F'],
    expectTypes: ['Fantasy Romance'],
    expectMinResults: 1,
  },

  // ═══ NO SILENT FALLBACK: Empty results for impossible filters ═══
  {
    id: 'no-fallback-1',
    category: 'No Silent Fallback',
    query: 'A+ audiobook time travel vampire western',
    description: 'Extremely narrow filter should return few/no results, NOT silently fall back to all',
    gradeFilter: 'A+',
    expectGradesOnly: ['A+'],
    // If any results come back, they must be A+ — no silent fallback
  },

  // ═══ SEMANTIC + GRADE COMBINED ═══
  {
    id: 'combined-1',
    category: 'Combined Filter',
    query: 'Enemies to lovers romance',
    description: 'Highly rated enemies-to-lovers',
    gradeFilter: 'highly_rated',
    expectGradesOnly: ['A+', 'A', 'A-', 'B+'],
    expectMinResults: 1,
    minRelevance: 0.3,
  },
  {
    id: 'combined-2',
    category: 'Combined Filter',
    query: 'Christmas holiday romance',
    description: 'Highly rated holiday romance',
    gradeFilter: 'highly_rated',
    expectGradesOnly: ['A+', 'A', 'A-', 'B+'],
    expectMinResults: 1,
    minRelevance: 0.3,
  },
  {
    id: 'combined-3',
    category: 'Combined Filter',
    query: 'Steamy contemporary romance',
    description: 'Highly rated steamy contemporary — grade + type match',
    gradeFilter: 'highly_rated',
    expectGradesOnly: ['A+', 'A', 'A-', 'B+'],
    expectTypes: ['Contemporary Romance'],
    expectMinResults: 1,
  },

  // ═══ UNFILTERED (no grade filter) — baseline ═══
  {
    id: 'baseline-1',
    category: 'Baseline',
    query: 'Tell me about Venetia by Georgette Heyer',
    description: 'Specific book lookup — no grade filter needed',
    expectTitles: ['Venetia'],
    expectAuthors: ['Georgette Heyer'],
    minRelevance: 0.5,
    expectMinResults: 1,
  },
  {
    id: 'baseline-2',
    category: 'Baseline',
    query: 'Romantic suspense novels',
    description: 'Genre query without grade filter',
    expectTypes: ['Romantic Suspense'],
    expectMinResults: 3,
    minRelevance: 0.4,
  },

  // ═══ GROUND TRUTH SPOT CHECKS ═══
  {
    id: 'truth-1',
    category: 'Ground Truth',
    query: 'By Arrangement by Madeline Hunter medieval romance',
    description: 'Known A- medieval book should appear',
    expectTitles: ['By Arrangement'],
    expectAuthors: ['Madeline Hunter'],
    expectGradesInTop3: ['A-'],
    minRelevance: 0.5,
  },
  {
    id: 'truth-2',
    category: 'Ground Truth',
    query: 'Star Shipped by Cat Sebastian enemies to lovers',
    description: 'Known A-graded enemies-to-lovers book',
    expectTitles: ['Star Shipped'],
    expectAuthors: ['Cat Sebastian'],
    expectGradesInTop3: ['A'],
    minRelevance: 0.5,
  },
  {
    id: 'truth-3',
    category: 'Ground Truth',
    query: 'Devil\'s Bride by Stephanie Laurens',
    description: 'Known A-graded hot regency',
    expectTitles: ['Devil\'s Bride'],
    expectAuthors: ['Stephanie Laurens'],
    minRelevance: 0.5,
  },
];

// ─── Main ───

async function main() {
  if (!process.env.NEON_DATABASE_URL || !process.env.VOYAGE_API_KEY) {
    console.error('❌ Set NEON_DATABASE_URL and VOYAGE_API_KEY in .env.local');
    process.exit(1);
  }

  const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = path.join(__dirname, '..', 'test-results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  const sql = neon(process.env.NEON_DATABASE_URL);

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           MINERVA ACCURACY TEST SUITE                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ── Phase 1: Unit tests ──
  console.log('━━━ Phase 1: Unit Tests (grade utilities) ━━━');
  const unitResults = runUnitTests();
  for (const d of unitResults.details) console.log(d);
  console.log(`\n  Unit: ${unitResults.passed}/${unitResults.passed + unitResults.failed} passed\n`);

  // ── Phase 2: Prompt validation ──
  console.log('━━━ Phase 2: Prompt & Code Validation ━━━');
  const promptResults = validatePrompts();
  for (const d of promptResults.details) console.log(d);
  console.log(`\n  Prompts: ${promptResults.passed}/${promptResults.passed + promptResults.failed} passed\n`);

  // ── Phase 3: Ground truth validation ──
  console.log('━━━ Phase 3: Ground Truth Validation ━━━');
  const groundTruth = loadGroundTruth();
  console.log(`  Loaded ${groundTruth.length} reviews from /data`);
  const gtResults = validateGroundTruth(groundTruth);
  for (const d of gtResults.details) console.log(d);
  console.log(`\n  Ground Truth: ${gtResults.passed}/${gtResults.passed + gtResults.failed} passed\n`);

  // ── Phase 4: Integration tests (DB + Voyage) ──
  console.log('━━━ Phase 4: Integration Tests (DB + Voyage API) ━━━');
  const countResult = await sql`SELECT COUNT(*)::int AS c FROM book_reviews`;
  console.log(`  Database: ${countResult[0].c} reviews indexed\n`);

  const integrationResults: TestResult[] = [];

  for (const test of TEST_CASES) {
    try {
      const result = await runTest(sql, test);
      integrationResults.push(result);

      const icon = result.passed ? '✓' : '✗';
      console.log(`\n${icon} [${result.category}] ${result.id}: "${result.query}"`);
      console.log(`  ${result.description}`);
      console.log(`  Score: ${result.score}/${result.maxScore} | Time: ${result.pipelineMs.toFixed(0)}ms | Results: ${result.results.length}`);

      if (result.gradeFilter) {
        console.log(`  Grade filter: ${result.gradeFilter} → [${result.expandedGrades.join(', ')}]`);
      }

      if (result.results.length > 0) {
        console.log(`  Top results:`);
        for (const r of result.results.slice(0, 4)) {
          console.log(`    "${r.title}" by ${r.author} — grade: ${r.grade ?? 'N/A'} (${r.gradeNum}) — rel: ${r.relevance.toFixed(3)}`);
        }
      }

      for (const c of result.checks) {
        const ci = c.passed ? '  ✓' : '  ✗';
        console.log(`${ci} ${c.name}: ${c.detail}`);
      }
    } catch (err) {
      console.error(`\n✗ [${test.category}] ${test.id}: ERROR — ${err}`);
      integrationResults.push({
        id: test.id,
        category: test.category,
        query: test.query,
        description: test.description,
        passed: false,
        score: 0,
        maxScore: 10,
        pipelineMs: 0,
        gradeFilter: test.gradeFilter || null,
        expandedGrades: [],
        results: [],
        checks: [{ name: 'error', passed: false, detail: String(err) }],
      });
    }
  }

  // ═══ SUMMARY ═══
  console.log('\n' + '═'.repeat(70));
  console.log('  ACCURACY REPORT');
  console.log('═'.repeat(70));

  const totalUnit = unitResults.passed + unitResults.failed;
  const totalPrompt = promptResults.passed + promptResults.failed;
  const totalGT = gtResults.passed + gtResults.failed;
  const intPassed = integrationResults.filter(r => r.passed).length;
  const intTotal = integrationResults.length;
  const intScore = integrationResults.reduce((s, r) => s + r.score, 0);
  const intMaxScore = integrationResults.reduce((s, r) => s + r.maxScore, 0);

  console.log(`\n  Unit Tests:        ${unitResults.passed}/${totalUnit} passed`);
  console.log(`  Prompt Validation: ${promptResults.passed}/${totalPrompt} passed`);
  console.log(`  Ground Truth:      ${gtResults.passed}/${totalGT} passed`);
  console.log(`  Integration:       ${intPassed}/${intTotal} passed (${intScore}/${intMaxScore} points)`);

  // Category breakdown
  const categories = [...new Set(integrationResults.map(r => r.category))];
  console.log('\n  By Category:');
  for (const cat of categories) {
    const catResults = integrationResults.filter(r => r.category === cat);
    const catPassed = catResults.filter(r => r.passed).length;
    const catScore = catResults.reduce((s, r) => s + r.score, 0);
    const catMax = catResults.reduce((s, r) => s + r.maxScore, 0);
    console.log(`    ${cat}: ${catPassed}/${catResults.length} passed | ${catScore}/${catMax} pts`);
  }

  // Failed tests
  const failed = integrationResults.filter(r => !r.passed);
  if (failed.length > 0) {
    console.log(`\n  Failed Tests (${failed.length}):`);
    for (const f of failed) {
      const failedChecks = f.checks.filter(c => !c.passed);
      console.log(`    ${f.id}: ${failedChecks.map(c => c.name).join(', ')}`);
    }
  }

  // Overall score
  const allPassed = unitResults.passed + promptResults.passed + gtResults.passed + intScore;
  const allMax = totalUnit + totalPrompt + totalGT + intMaxScore;
  const overallPct = (allPassed / allMax) * 100;

  console.log(`\n  ┌─────────────────────────────────┐`);
  console.log(`  │ OVERALL: ${allPassed}/${allMax} (${overallPct.toFixed(1)}%)${overallPct >= 90 ? ' ★' : overallPct >= 70 ? ' ●' : ' ⚠'}  │`);
  console.log(`  └─────────────────────────────────┘`);

  // ── Write results to JSON ──
  const logData = {
    timestamp: new Date().toISOString(),
    summary: {
      unit: { passed: unitResults.passed, total: totalUnit },
      prompt: { passed: promptResults.passed, total: totalPrompt },
      groundTruth: { passed: gtResults.passed, total: totalGT },
      integration: { passed: intPassed, total: intTotal, score: intScore, maxScore: intMaxScore },
      overall: { score: allPassed, maxScore: allMax, pct: overallPct },
    },
    integrationTests: integrationResults,
  };

  const logFile = path.join(resultsDir, `accuracy-${runTimestamp}.json`);
  fs.writeFileSync(logFile, JSON.stringify(logData, null, 2));
  console.log(`\n  Results logged to: ${logFile}`);

  // Also write latest symlink-style file
  const latestFile = path.join(resultsDir, 'accuracy-latest.json');
  fs.writeFileSync(latestFile, JSON.stringify(logData, null, 2));
  console.log(`  Latest results:   ${latestFile}`);

  // Exit code
  if (overallPct < 70) {
    console.log('\n⚠ BELOW QUALITY THRESHOLD (70%)');
    process.exit(1);
  } else if (overallPct >= 90) {
    console.log('\n★ EXCELLENT ACCURACY');
  } else {
    console.log('\n● GOOD ACCURACY');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
