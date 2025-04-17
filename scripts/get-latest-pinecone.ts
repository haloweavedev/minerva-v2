import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
import path from 'node:path';

// Load environment variables from .env.local at the project root
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const EMBEDDING_DIMENSIONS = 1536; // Match API route

const getPineconeRecord = async () => {
  const apiKey = process.env.PINECONE_API_KEY;
  const indexName = process.env.PINECONE_INDEX_NAME;

  if (!apiKey) {
    throw new Error('PINECONE_API_KEY environment variable is not set');
  }
  if (!indexName) {
    throw new Error('PINECONE_INDEX_NAME environment variable is not set');
  }

  try {
    console.log(`Connecting to Pinecone index: ${indexName}...`);
    const pinecone = new Pinecone({ apiKey });
    const index = pinecone.index(indexName);

    console.log('Fetching stats to confirm connection and dimensions...');
    const stats = await index.describeIndexStats();
    console.log('Index Stats:', stats);

    if (stats.dimension !== EMBEDDING_DIMENSIONS) {
       console.warn(`\n!!! WARNING !!!\nPinecone index dimension (${stats.dimension}) does not match expected embedding dimension (${EMBEDDING_DIMENSIONS}).\nEnsure your index and embedding model match.\n!!! WARNING !!!\n`);
    }

    if (!stats.totalRecordCount || stats.totalRecordCount === 0) {
      console.log('Index is empty. Cannot fetch a record.');
      return;
    }

    const namespaceToQuery = stats.namespaces ? Object.keys(stats.namespaces)[0] : '';
    console.log(`Querying namespace: '${namespaceToQuery || 'default'}' for one record...`);

    // Use the correct dimension for the dummy vector
    const dummyVector = Array(EMBEDDING_DIMENSIONS).fill(0);

    const queryResponse = await index.namespace(namespaceToQuery).query({
      vector: dummyVector,
      topK: 1,
      includeMetadata: true,
      includeValues: false,
    });

    if (queryResponse.matches && queryResponse.matches.length > 0) {
      const record = queryResponse.matches[0];
      console.log('\n--- Fetched Record ---');
      console.log('ID:', record.id);
      console.log('Score:', record.score);
      console.log('Metadata:', record.metadata);
      console.log('--------------------');
    } else {
      console.log('Could not fetch a record using the dummy query.');
    }

  } catch (error) {
    console.error('Error fetching from Pinecone:', error);
    process.exit(1);
  }
};

getPineconeRecord(); 