/**
 * Read raw-reviews.json → clean HTML → chunk → embed via Voyage → ingest into Neon pgvector.
 *
 * Usage:
 *   NEON_DATABASE_URL=... VOYAGE_API_KEY=... npx tsx scripts/embed-and-ingest.ts
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';
import * as cheerio from 'cheerio';

// --- Voyage AI helpers (inline to avoid TS path alias issues in scripts) ---

const VOYAGE_API_URL = 'https://api.voyageai.com/v1';
const EMBED_MODEL = 'voyage-3';
const EMBED_DIMENSION = 1024;
const BATCH_SIZE = 40;

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
      const waitSec = 20 * (attempt + 1); // 20s, 40s, 60s...
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
  contentHtml: string;  // raw HTML from WP
  content?: string;     // legacy plain text field
  coda: string | null;
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

  const dataPath = path.join(process.cwd(), 'data', 'raw-reviews.json');
  const reviews: RawReview[] = JSON.parse(readFileSync(dataPath, 'utf-8'));
  console.log(`[Ingest] Loaded ${reviews.length} reviews from ${dataPath}\n`);

  const totalStart = performance.now();

  // ── Phase 1: Clean HTML, chunk all reviews, insert metadata ──
  console.log('Phase 1: Clean + chunk + insert metadata...\n');

  interface PreparedReview {
    reviewId: number;
    review: RawReview;
    content: string;
    chunks: string[];
  }
  const prepared: PreparedReview[] = [];
  let dbInsertTimeMs = 0;

  for (let i = 0; i < reviews.length; i++) {
    const review = reviews[i];
    const content = review.contentHtml
      ? cleanHtml(review.contentHtml)
      : (review.content || '');

    if (!content || content.length < 50) {
      console.log(`  [${i + 1}] SKIP "${review.title}" — too short (${content.length} chars)`);
      continue;
    }

    const dbStart = performance.now();
    const insertResult = await sql`
      INSERT INTO book_reviews (
        post_id, title, author_name, grade, sensuality, book_types, review_tags,
        publish_date, copyright_year, publisher, pages, isbn, asin, amazon_url,
        time_setting, locale_setting, series, cover_url, review_url, post_date,
        content, coda
      ) VALUES (
        ${review.postId}, ${review.title}, ${review.authorName}, ${review.grade},
        ${review.sensuality}, ${review.bookTypes}, ${review.reviewTags},
        ${review.publishDate}, ${review.copyrightYear}, ${review.publisher},
        ${review.pages}, ${review.isbn}, ${review.asin}, ${review.amazonUrl},
        ${review.timeSetting}, ${review.localeSetting}, ${review.series},
        ${review.coverUrl}, ${review.reviewUrl}, ${review.postDate},
        ${content}, ${review.coda}
      )
      ON CONFLICT (post_id) DO UPDATE SET
        title = EXCLUDED.title,
        content = EXCLUDED.content
      RETURNING id
    `;
    const reviewId = (insertResult[0] as { id: number }).id;
    dbInsertTimeMs += performance.now() - dbStart;

    const metadataHeader = buildMetadataHeader(review);
    const chunks = chunkContent(content, metadataHeader);
    prepared.push({ reviewId, review, content, chunks });

    console.log(`  [${i + 1}] "${review.title}" — ${content.length} chars → ${chunks.length} chunks`);
  }

  // Flatten all chunks into one array for batch embedding
  const allChunks: string[] = [];
  const chunkMap: { prepIdx: number; chunkIdx: number }[] = [];
  for (let p = 0; p < prepared.length; p++) {
    for (let c = 0; c < prepared[p].chunks.length; c++) {
      chunkMap.push({ prepIdx: p, chunkIdx: c });
      allChunks.push(prepared[p].chunks[c]);
    }
  }

  console.log(`\nPhase 1 done: ${prepared.length} reviews, ${allChunks.length} total chunks\n`);

  // ── Phase 2: Embed ALL chunks in big batches (minimize API calls) ──
  console.log(`Phase 2: Embedding ${allChunks.length} chunks in batches of ${BATCH_SIZE}...\n`);

  const embedStart = performance.now();
  const allEmbeddings: number[][] = [];

  for (let b = 0; b < allChunks.length; b += BATCH_SIZE) {
    const batch = allChunks.slice(b, b + BATCH_SIZE);
    const batchNum = Math.floor(b / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(allChunks.length / BATCH_SIZE);
    console.log(`  Batch ${batchNum}/${totalBatches} (${batch.length} chunks)...`);
    const batchEmbeddings = await embedBatch(batch);
    allEmbeddings.push(...batchEmbeddings);
  }

  const embedTimeMs = performance.now() - embedStart;
  console.log(`\nPhase 2 done: ${allEmbeddings.length} embeddings in ${(embedTimeMs / 1000).toFixed(1)}s\n`);

  // ── Phase 3: Insert chunks with embeddings into DB ──
  console.log('Phase 3: Inserting chunks into Neon...\n');

  const dbStart2 = performance.now();
  for (const p of prepared) {
    await sql`DELETE FROM book_review_chunks WHERE review_id = ${p.reviewId}`;
  }

  for (let i = 0; i < chunkMap.length; i++) {
    const { prepIdx, chunkIdx } = chunkMap[i];
    const p = prepared[prepIdx];
    const vectorStr = `[${allEmbeddings[i].join(',')}]`;
    await sql`
      INSERT INTO book_review_chunks (review_id, chunk_index, content, embedding)
      VALUES (${p.reviewId}, ${chunkIdx}, ${p.chunks[chunkIdx]}, ${vectorStr}::vector)
    `;
  }

  dbInsertTimeMs += performance.now() - dbStart2;
  console.log(`Phase 3 done: ${chunkMap.length} chunks inserted in ${((performance.now() - dbStart2) / 1000).toFixed(1)}s\n`);

  const totalMs = performance.now() - totalStart;
  const perRecord = totalMs / prepared.length;

  const totalChunks = allChunks.length;

  console.log('========== INGESTION REPORT ==========');
  console.log(`Reviews ingested: ${prepared.length}`);
  console.log(`Total chunks: ${totalChunks}`);
  console.log(`Avg chunks/review: ${(totalChunks / prepared.length).toFixed(1)}`);
  console.log(`---`);
  console.log(`Embedding time: ${(embedTimeMs / 1000).toFixed(1)}s`);
  console.log(`DB insert time: ${(dbInsertTimeMs / 1000).toFixed(1)}s`);
  console.log(`Total time: ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`Per-record average: ${(perRecord / 1000).toFixed(2)}s`);
  console.log(`---`);
  console.log(`Projected 18,645 records:`);
  console.log(`  Embedding: ${((embedTimeMs / prepared.length) * 18645 / 60000).toFixed(1)} min`);
  console.log(`  DB insert: ${((dbInsertTimeMs / prepared.length) * 18645 / 60000).toFixed(1)} min`);
  console.log(`  Total: ${((perRecord * 18645) / 60000).toFixed(1)} min`);
  console.log('======================================');
}

main().catch(console.error);
