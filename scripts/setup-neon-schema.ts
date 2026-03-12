/**
 * Set up Neon pgvector schema.
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

  console.log('Creating pgvector extension...');
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;

  console.log('Creating book_reviews table...');
  await sql`
    CREATE TABLE IF NOT EXISTS book_reviews (
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
    )
  `;

  console.log('Creating book_review_chunks table...');
  await sql`
    CREATE TABLE IF NOT EXISTS book_review_chunks (
      id SERIAL PRIMARY KEY,
      review_id INTEGER NOT NULL REFERENCES book_reviews(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding vector(1024)
    )
  `;

  console.log('Creating HNSW index...');
  await sql`
    CREATE INDEX IF NOT EXISTS book_review_chunks_embedding_idx
    ON book_review_chunks USING hnsw (embedding vector_cosine_ops)
  `;

  console.log('Schema setup complete!');
}

main().catch(console.error);
