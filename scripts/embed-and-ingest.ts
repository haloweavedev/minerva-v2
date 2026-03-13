/**
 * Multi-file batch ingestion: read reviews-batch-*.json → clean HTML → chunk →
 * embed via Voyage → ingest into Neon pgvector with resume support.
 *
 * Usage:
 *   NEON_DATABASE_URL=... VOYAGE_API_KEY=... npx tsx scripts/embed-and-ingest.ts
 *
 * Features:
 *   - Processes all data/reviews-batch-*.json files in sorted order
 *   - Resume: skips batch files already fully ingested (by source_batch column)
 *   - Batch DB inserts (50 chunks per statement)
 *   - Full ON CONFLICT upsert for all mutable fields
 *   - Comments ingestion with ON CONFLICT DO NOTHING
 *   - HNSW index drop before / rebuild after bulk ingestion
 *   - Per-batch timing, storage measurement, and ETA
 */

import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';
import * as cheerio from 'cheerio';

// --- Voyage AI helpers (inline to avoid TS path alias issues in scripts) ---

const VOYAGE_API_URL = 'https://api.voyageai.com/v1';
const EMBED_MODEL = 'voyage-3.5';
const EMBED_DIMENSION = 512;
const BATCH_SIZE = 128; // Voyage max per request
const EMBED_CONCURRENCY = 5; // Parallel Voyage API calls
const DB_CHUNK_BATCH_SIZE = 200;

function voyageHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
  };
}

async function embedBatch(texts: string[], retries = 5): Promise<number[][]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(`${VOYAGE_API_URL}/embeddings`, {
      method: 'POST',
      headers: voyageHeaders(),
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: texts,
        input_type: 'document',
        output_dimension: EMBED_DIMENSION,
      }),
    });
    if (res.status === 429) {
      const waitSec = 20 * (attempt + 1);
      console.log(`  [Rate limited] Waiting ${waitSec}s before retry ${attempt + 1}/${retries}...`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Voyage embed error ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
  throw new Error('Voyage embed: max retries exceeded');
}

// --- HTML cleaning ---

function cleanHtml(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, iframe, .ad, .advertisement, .wp-caption-text, noscript').remove();
  $('br').replaceWith('\n');
  $('p').each(function () { $(this).replaceWith($(this).text() + '\n\n'); });
  $('h1, h2, h3, h4, h5, h6').each(function () { $(this).replaceWith($(this).text() + '\n\n'); });
  $('li').each(function () { $(this).replaceWith('- ' + $(this).text() + '\n'); });
  $('blockquote').each(function () {
    const text = $(this).text().split('\n').map((l) => `> ${l}`).join('\n');
    $(this).replaceWith(text + '\n\n');
  });
  let text = $.text();
  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

// --- Chunking ---

const TARGET_CHUNK_CHARS = 2400;

interface RawReview {
  postId: number;
  title: string;
  authorName: string;
  grade: string | null;
  sensuality: string | null;
  bookTypes: string[];
  reviewTags: string[];
  publishDate: string | null;
  copyrightYear: string | null;
  publisher: string | null;
  pages: string | null;
  isbn: string | null;
  asin: string | null;
  amazonUrl: string | null;
  timeSetting: string | null;
  localeSetting: string | null;
  series: boolean;
  coverUrl: string | null;
  reviewUrl: string | null;
  postDate: string | null;
  contentHtml: string;
  content?: string;
  coda: string | null;
  comments?: { author: string; content: string; date: string | null }[];
}

function buildMetadataHeader(review: RawReview): string {
  const parts: string[] = [`Title: ${review.title} by ${review.authorName}`];

  const meta: string[] = [];
  if (review.grade) meta.push(`Grade: ${review.grade}`);
  if (review.sensuality) meta.push(`Sensuality: ${review.sensuality}`);
  if (review.bookTypes.length > 0) meta.push(`Type: ${review.bookTypes.join(', ')}`);
  if (meta.length > 0) parts.push(meta.join(' | '));

  if (review.reviewTags.length > 0) {
    parts.push(`Tags: ${review.reviewTags.join(', ')}`);
  }

  return parts.join('\n');
}

function splitIntoSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

function chunkContent(content: string, metadataHeader: string): string[] {
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    if (para.length > TARGET_CHUNK_CHARS) {
      if (currentChunk.trim()) {
        chunks.push(`${metadataHeader}\n\n${currentChunk.trim()}`);
        currentChunk = '';
      }
      const sentences = splitIntoSentences(para);
      let sentenceChunk = '';
      for (const sentence of sentences) {
        if ((sentenceChunk + ' ' + sentence).length > TARGET_CHUNK_CHARS && sentenceChunk) {
          chunks.push(`${metadataHeader}\n\n${sentenceChunk.trim()}`);
          sentenceChunk = sentence;
        } else {
          sentenceChunk += (sentenceChunk ? ' ' : '') + sentence;
        }
      }
      if (sentenceChunk.trim()) {
        currentChunk = sentenceChunk;
      }
      continue;
    }

    const combined = currentChunk + (currentChunk ? '\n\n' : '') + para;
    if (combined.length > TARGET_CHUNK_CHARS && currentChunk.trim()) {
      chunks.push(`${metadataHeader}\n\n${currentChunk.trim()}`);
      currentChunk = para;
    } else {
      currentChunk = combined;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(`${metadataHeader}\n\n${currentChunk.trim()}`);
  }

  return chunks;
}

// --- Batch DB helpers ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlFn = (...args: any[]) => Promise<any>;

async function batchInsertChunks(
  sql: SqlFn,
  chunks: { reviewId: number; chunkIndex: number; content: string; embedding: number[] }[]
): Promise<void> {
  if (chunks.length === 0) return;

  const values: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  for (const chunk of chunks) {
    const vectorStr = `[${chunk.embedding.join(',')}]`;
    values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}::vector)`);
    params.push(chunk.reviewId, chunk.chunkIndex, chunk.content, vectorStr);
    paramIdx += 4;
  }

  const query = `
    INSERT INTO book_review_chunks (review_id, chunk_index, content, embedding)
    VALUES ${values.join(', ')}
  `;
  await (sql as any).query(query, params);
}

async function batchInsertComments(
  sql: SqlFn,
  comments: { reviewId: number; authorName: string; content: string; commentDate: string | null }[]
): Promise<void> {
  if (comments.length === 0) return;

  const values: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  for (const c of comments) {
    values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}::timestamp)`);
    params.push(c.reviewId, c.authorName, c.content, c.commentDate);
    paramIdx += 4;
  }

  const query = `
    INSERT INTO book_review_comments (review_id, author_name, content, comment_date)
    VALUES ${values.join(', ')}
    ON CONFLICT (review_id, author_name, comment_date) DO NOTHING
  `;
  await (sql as any).query(query, params);
}

// --- Main ---

async function main() {
  if (!process.env.NEON_DATABASE_URL) {
    console.error('Set NEON_DATABASE_URL env var');
    process.exit(1);
  }
  if (!process.env.VOYAGE_API_KEY) {
    console.error('Set VOYAGE_API_KEY env var');
    process.exit(1);
  }

  const sql = neon(process.env.NEON_DATABASE_URL);

  // Discover batch files
  const dataDir = path.join(process.cwd(), 'data');
  const batchFiles = readdirSync(dataDir)
    .filter((f) => f.match(/^reviews-batch-\d+\.json$/))
    .sort();

  if (batchFiles.length === 0) {
    console.error('No reviews-batch-*.json files found in data/');
    process.exit(1);
  }

  // Optional --limit N to process only N batch files (for validation runs)
  const limitIdx = process.argv.indexOf('--limit');
  const batchLimit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : batchFiles.length;
  const filesToProcess = batchFiles.slice(0, batchLimit);

  console.log(`[Ingest] Found ${batchFiles.length} batch files, processing ${filesToProcess.length}\n`);

  // Drop HNSW index before bulk ingestion (much faster without it)
  console.log('Dropping HNSW index (if exists) for bulk insert performance...');
  await sql`DROP INDEX IF EXISTS book_review_chunks_embedding_idx`;

  const totalStart = performance.now();
  let totalReviews = 0;
  let totalChunks = 0;
  let totalComments = 0;
  let totalSkippedBatches = 0;
  let totalEmbedMs = 0;
  let totalDbMs = 0;

  for (let batchIdx = 0; batchIdx < filesToProcess.length; batchIdx++) {
    const batchFile = filesToProcess[batchIdx];
    const batchStart = performance.now();

    // Resume check: skip fully ingested batches
    const existingCount = await sql`
      SELECT COUNT(*)::int AS count FROM book_reviews WHERE source_batch = ${batchFile}
    `;
    const batchPath = path.join(dataDir, batchFile);
    const reviews: RawReview[] = JSON.parse(readFileSync(batchPath, 'utf-8'));

    if (existingCount[0].count === reviews.length) {
      console.log(`[${batchIdx + 1}/${batchFiles.length}] ${batchFile} — SKIP (${reviews.length} already ingested)`);
      totalSkippedBatches++;
      totalReviews += reviews.length;
      // Count existing chunks/comments for totals
      const chunkCount = await sql`
        SELECT COUNT(*)::int AS count FROM book_review_chunks c
        JOIN book_reviews r ON r.id = c.review_id WHERE r.source_batch = ${batchFile}
      `;
      totalChunks += chunkCount[0].count as number;
      continue;
    }

    // Partial ingestion detected — clean up and reprocess
    if ((existingCount[0].count as number) > 0) {
      console.log(`[${batchIdx + 1}/${batchFiles.length}] ${batchFile} — partial (${existingCount[0].count}/${reviews.length}), cleaning up...`);
      await sql`
        DELETE FROM book_reviews WHERE source_batch = ${batchFile}
      `;
    }

    console.log(`[${batchIdx + 1}/${batchFiles.length}] ${batchFile} — processing ${reviews.length} reviews...`);

    // Phase A: Clean HTML, chunk locally, then batch-insert reviews via transactions
    interface CleanedReview {
      review: RawReview;
      content: string;
      chunks: string[];
    }
    const cleaned: CleanedReview[] = [];
    let batchDbMs = 0;
    let batchComments = 0;

    for (let i = 0; i < reviews.length; i++) {
      const review = reviews[i];
      const content = review.contentHtml
        ? cleanHtml(review.contentHtml)
        : (review.content || '');

      if (!content || content.length < 50) {
        console.log(`  [${i + 1}] SKIP "${review.title}" — too short (${content.length} chars)`);
        continue;
      }

      const metadataHeader = buildMetadataHeader(review);
      const chunks = chunkContent(content, metadataHeader);
      cleaned.push({ review, content, chunks });
    }

    console.log(`  Cleaned ${cleaned.length} reviews locally, inserting into DB...`);

    // Batch-insert reviews using transactions (50 per transaction = fewer HTTP calls)
    interface PreparedReview {
      reviewId: number;
      review: RawReview;
      content: string;
      chunks: string[];
    }
    const prepared: PreparedReview[] = [];
    const REVIEW_BATCH = 50;

    const dbStart = performance.now();
    for (let ri = 0; ri < cleaned.length; ri += REVIEW_BATCH) {
      const batch = cleaned.slice(ri, ri + REVIEW_BATCH);
      const results = await sql.transaction(
        batch.map(({ review, content }) =>
          sql`
            INSERT INTO book_reviews (
              post_id, title, author_name, grade, sensuality, book_types, review_tags,
              publish_date, copyright_year, publisher, pages, isbn, asin, amazon_url,
              time_setting, locale_setting, series, cover_url, review_url, post_date,
              content, coda, source_batch
            ) VALUES (
              ${review.postId}, ${review.title}, ${review.authorName}, ${review.grade},
              ${review.sensuality}, ${review.bookTypes}, ${review.reviewTags},
              ${review.publishDate}, ${review.copyrightYear}, ${review.publisher},
              ${review.pages}, ${review.isbn}, ${review.asin}, ${review.amazonUrl},
              ${review.timeSetting}, ${review.localeSetting}, ${review.series},
              ${review.coverUrl}, ${review.reviewUrl}, ${review.postDate},
              ${content}, ${review.coda}, ${batchFile}
            )
            ON CONFLICT (post_id) DO UPDATE SET
              title = EXCLUDED.title,
              author_name = EXCLUDED.author_name,
              grade = EXCLUDED.grade,
              sensuality = EXCLUDED.sensuality,
              book_types = EXCLUDED.book_types,
              review_tags = EXCLUDED.review_tags,
              publish_date = EXCLUDED.publish_date,
              copyright_year = EXCLUDED.copyright_year,
              publisher = EXCLUDED.publisher,
              pages = EXCLUDED.pages,
              isbn = EXCLUDED.isbn,
              asin = EXCLUDED.asin,
              amazon_url = EXCLUDED.amazon_url,
              time_setting = EXCLUDED.time_setting,
              locale_setting = EXCLUDED.locale_setting,
              series = EXCLUDED.series,
              cover_url = EXCLUDED.cover_url,
              review_url = EXCLUDED.review_url,
              post_date = EXCLUDED.post_date,
              content = EXCLUDED.content,
              coda = EXCLUDED.coda,
              source_batch = EXCLUDED.source_batch
            RETURNING id
          `
        )
      );

      for (let j = 0; j < batch.length; j++) {
        const reviewId = (results[j] as unknown as { id: number }[])[0].id;
        prepared.push({ reviewId, ...batch[j] });
      }
      process.stdout.write(`  Reviews: ${Math.min(ri + REVIEW_BATCH, cleaned.length)}/${cleaned.length}\r`);
    }
    batchDbMs += performance.now() - dbStart;
    console.log(`  Inserted ${prepared.length} reviews`);

    // Batch-insert comments via transactions
    const commentStart = performance.now();
    const allCommentRows: { reviewId: number; authorName: string; content: string; commentDate: string | null }[] = [];
    for (const p of prepared) {
      if (p.review.comments && p.review.comments.length > 0) {
        for (const c of p.review.comments) {
          allCommentRows.push({
            reviewId: p.reviewId,
            authorName: c.author,
            content: c.content,
            commentDate: c.date || null,
          });
        }
        batchComments += p.review.comments.length;
      }
    }
    for (let ci = 0; ci < allCommentRows.length; ci += 200) {
      await batchInsertComments(sql, allCommentRows.slice(ci, ci + 200));
    }
    batchDbMs += performance.now() - commentStart;
    console.log(`  Inserted ${batchComments} comments`);

    // Flatten chunks for batch embedding
    const allChunks: string[] = [];
    const chunkMap: { prepIdx: number; chunkIdx: number }[] = [];
    for (let p = 0; p < prepared.length; p++) {
      for (let c = 0; c < prepared[p].chunks.length; c++) {
        chunkMap.push({ prepIdx: p, chunkIdx: c });
        allChunks.push(prepared[p].chunks[c]);
      }
    }

    // Phase B: Embed all chunks (concurrent API calls)
    const embedStart = performance.now();
    const totalApiBatches = Math.ceil(allChunks.length / BATCH_SIZE);
    const embeddingSlots: number[][][] = new Array(totalApiBatches);

    // Process embedding batches with concurrency limit
    let completedBatches = 0;
    const batchIndices = Array.from({ length: totalApiBatches }, (_, i) => i);

    async function processEmbedBatch(idx: number) {
      const start = idx * BATCH_SIZE;
      const batch = allChunks.slice(start, start + BATCH_SIZE);
      embeddingSlots[idx] = await embedBatch(batch);
      completedBatches++;
      process.stdout.write(`  Embedding ${completedBatches}/${totalApiBatches}...\r`);
    }

    // Run with concurrency limit
    const pending: Promise<void>[] = [];
    for (const idx of batchIndices) {
      const p = processEmbedBatch(idx);
      pending.push(p);
      if (pending.length >= EMBED_CONCURRENCY) {
        await Promise.race(pending);
        // Remove resolved promises
        for (let i = pending.length - 1; i >= 0; i--) {
          const settled = await Promise.race([pending[i].then(() => true), Promise.resolve(false)]);
          if (settled) pending.splice(i, 1);
        }
      }
    }
    await Promise.all(pending);

    const allEmbeddings: number[][] = embeddingSlots.flat();
    const batchEmbedMs = performance.now() - embedStart;

    // Phase C: Batch insert chunks with embeddings
    const dbStart2 = performance.now();

    // Delete existing chunks for all reviews in this batch (single query)
    const reviewIds = prepared.map((p) => p.reviewId);
    if (reviewIds.length > 0) {
      await sql`DELETE FROM book_review_chunks WHERE review_id = ANY(${reviewIds})`;
    }

    // Batch insert in groups of DB_CHUNK_BATCH_SIZE
    const chunkInserts: { reviewId: number; chunkIndex: number; content: string; embedding: number[] }[] = [];
    for (let i = 0; i < chunkMap.length; i++) {
      const { prepIdx, chunkIdx } = chunkMap[i];
      const p = prepared[prepIdx];
      chunkInserts.push({
        reviewId: p.reviewId,
        chunkIndex: chunkIdx,
        content: p.chunks[chunkIdx],
        embedding: allEmbeddings[i],
      });
    }

    for (let i = 0; i < chunkInserts.length; i += DB_CHUNK_BATCH_SIZE) {
      await batchInsertChunks(sql, chunkInserts.slice(i, i + DB_CHUNK_BATCH_SIZE));
    }

    batchDbMs += performance.now() - dbStart2;
    totalEmbedMs += batchEmbedMs;
    totalDbMs += batchDbMs;
    totalReviews += prepared.length;
    totalChunks += allChunks.length;
    totalComments += batchComments;

    const batchMs = performance.now() - batchStart;
    const elapsed = performance.now() - totalStart;
    const remainingBatches = filesToProcess.length - batchIdx - 1 - totalSkippedBatches;
    const avgBatchMs = elapsed / (batchIdx + 1 - totalSkippedBatches);
    const etaMin = (remainingBatches * avgBatchMs) / 60000;

    console.log(
      `  Done: ${prepared.length} reviews, ${allChunks.length} chunks, ${batchComments} comments ` +
      `(embed: ${(batchEmbedMs / 1000).toFixed(1)}s, db: ${(batchDbMs / 1000).toFixed(1)}s, ` +
      `total: ${(batchMs / 1000).toFixed(1)}s) — ETA: ${etaMin.toFixed(1)} min`
    );

    // Report storage after each batch
    const sizeResult = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`;
    console.log(`  DB size: ${sizeResult[0].size}`);
  }

  // Rebuild HNSW index
  console.log('\nRebuilding HNSW index (m=16, ef_construction=100)...');
  const indexStart = performance.now();
  await sql`
    CREATE INDEX book_review_chunks_embedding_idx
    ON book_review_chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 100)
  `;
  const indexMs = performance.now() - indexStart;
  console.log(`HNSW index built in ${(indexMs / 1000).toFixed(1)}s`);

  const totalMs = performance.now() - totalStart;

  // Final storage measurement
  const finalSize = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`;
  const finalSizeBytes = await sql`SELECT pg_database_size(current_database()) AS bytes`;
  const sizeBytes = finalSizeBytes[0].bytes as number;
  const projectedPerChunk = totalChunks > 0 ? sizeBytes / totalChunks : 0;

  console.log('\n========== INGESTION REPORT ==========');
  console.log(`Batch files: ${filesToProcess.length}/${batchFiles.length} (${totalSkippedBatches} skipped)`);
  console.log(`Reviews ingested: ${totalReviews}`);
  console.log(`Total chunks: ${totalChunks}`);
  console.log(`Total comments: ${totalComments}`);
  console.log(`Avg chunks/review: ${totalReviews > 0 ? (totalChunks / totalReviews).toFixed(1) : 'N/A'}`);
  console.log(`---`);
  console.log(`Embedding time: ${(totalEmbedMs / 1000).toFixed(1)}s`);
  console.log(`DB insert time: ${(totalDbMs / 1000).toFixed(1)}s`);
  console.log(`HNSW index build: ${(indexMs / 1000).toFixed(1)}s`);
  console.log(`Total time: ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`---`);
  console.log(`Database size: ${finalSize[0].size}`);
  console.log(`Per-chunk cost: ${(projectedPerChunk / 1024).toFixed(1)} KB`);
  if (totalChunks < 5000) {
    const projected46k = (projectedPerChunk * 46600) / (1024 * 1024);
    console.log(`Projected at 46,600 chunks: ${projected46k.toFixed(0)} MB`);
    if (projected46k > 480) {
      console.log(`⚠ WARNING: Projected size exceeds 480 MB — consider switching to 512-dim embeddings`);
    }
  }
  console.log('======================================');
}

main().catch(console.error);
