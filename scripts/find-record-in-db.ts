import dotenv from 'dotenv';
import path from 'node:path';

// Load environment variables first
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

// Define embedding model locally instead of importing
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL_ID || 'text-embedding-3-small';

async function main() {
  const title = process.argv.slice(2).join(' ');
  if (!title) {
    console.error('Usage: npx tsx scripts/find-record-in-db.ts "Book Title"');
    process.exit(1);
  }

  const apiKey = process.env.PINECONE_API_KEY;
  const indexName = process.env.PINECONE_INDEX_NAME;
  
  if (!apiKey) {
    console.error('Missing PINECONE_API_KEY environment variable.');
    process.exit(1);
  }
  if (!indexName) {
    console.error('Missing PINECONE_INDEX_NAME environment variable.');
    process.exit(1);
  }
  
  const pinecone = new Pinecone({ apiKey });
  const index = pinecone.index(indexName);

  // 1. Create embedding for the title
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const embedRes = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: title,
  });
  const vector = embedRes.data[0].embedding;

  // 2. Query with exact title filter
  console.log(`Searching for exact matches to "${title}"...`);
  const resp = await index.namespace('book-review-full').query({
    vector,
    topK: 5,
    includeMetadata: true,
    filter: { bookTitle: { $eq: title } },
  });

  if (!resp.matches || resp.matches.length === 0) {
    console.log('No records found with exact match.');
  } else {
    console.log(`Found ${resp.matches.length} record(s):`);
    for (const m of resp.matches) {
      console.log(`- ID: ${m.id}, score: ${m.score}`);
      console.log('  Metadata:', m.metadata);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
