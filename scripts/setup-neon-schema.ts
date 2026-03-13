/**
 * Set up Neon pgvector schema.
 * Drops and recreates all tables with full indexes.
 * Usage: NEON_DATABASE_URL=... npx tsx scripts/setup-neon-schema.ts
 */

import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

async function main() {
  if (!process.env.NEON_DATABASE_URL) {
    console.error('Set NEON_DATABASE_URL env var');
    process.exit(1);
  }

  const sql = neon(process.env.NEON_DATABASE_URL);

  console.log('Dropping existing tables...');
  await sql`DROP TABLE IF EXISTS book_review_comments CASCADE`;
  await sql`DROP TABLE IF EXISTS book_review_chunks CASCADE`;
  await sql`DROP TABLE IF EXISTS book_reviews CASCADE`;

  console.log('Creating extensions...');
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;

  console.log('Creating book_reviews table...');
  await sql`
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
      coda TEXT,
      source_batch TEXT
    )
  `;

  console.log('Creating book_reviews indexes...');
  await sql`CREATE INDEX idx_reviews_title_trgm ON book_reviews USING gin (title gin_trgm_ops)`;
  await sql`CREATE INDEX idx_reviews_author_lower ON book_reviews (LOWER(author_name))`;
  await sql`CREATE INDEX idx_reviews_grade ON book_reviews (grade)`;
  await sql`CREATE INDEX idx_reviews_post_date ON book_reviews (post_date DESC)`;

  console.log('Creating book_review_chunks table...');
  await sql`
    CREATE TABLE book_review_chunks (
      id SERIAL PRIMARY KEY,
      review_id INTEGER NOT NULL REFERENCES book_reviews(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding vector(512)
    )
  `;

  // NOTE: HNSW index is NOT created here — it will be built after bulk ingestion
  // for much faster index construction. The ingestion script handles this.
  console.log('(Skipping HNSW index — will be built after bulk ingestion)');

  console.log('Creating book_review_comments table...');
  await sql`
    CREATE TABLE book_review_comments (
      id SERIAL PRIMARY KEY,
      review_id INTEGER NOT NULL REFERENCES book_reviews(id) ON DELETE CASCADE,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      comment_date TIMESTAMP,
      UNIQUE(review_id, author_name, comment_date)
    )
  `;
  await sql`CREATE INDEX idx_comments_review_id ON book_review_comments (review_id)`;

  // Report database size
  const sizeResult = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`;
  console.log(`\nDatabase size (empty schema): ${sizeResult[0].size}`);

  console.log('\nSchema setup complete!');
}

main().catch(console.error);
