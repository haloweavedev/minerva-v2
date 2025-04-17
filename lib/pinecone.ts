import { Pinecone } from '@pinecone-database/pinecone';

if (!process.env.PINECONE_API_KEY) {
  throw new Error('PINECONE_API_KEY environment variable is not set');
}
if (!process.env.PINECONE_INDEX_NAME) {
  throw new Error('PINECONE_INDEX_NAME environment variable is not set');
}

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

// Set up the Pinecone index
const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);

// No need for special host configuration with the latest Pinecone SDK
// The host is automatically determined by the index name

export { pineconeIndex };

// Note: The ensurePineconeIndex function is primarily for setup/ingestion
// and not strictly required for the chat query flow, so it's omitted here for simplicity.
// You would typically run your vector ingestion process separately. 