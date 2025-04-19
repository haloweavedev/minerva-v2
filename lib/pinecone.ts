import { Pinecone } from '@pinecone-database/pinecone';

if (!process.env.PINECONE_API_KEY) {
  throw new Error('PINECONE_API_KEY environment variable is not set');
}

if (!process.env.PINECONE_INDEX_NAME) {
  throw new Error('PINECONE_INDEX_NAME environment variable is not set');
}

// Initialize Pinecone client at module load time
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

// Set up the Pinecone index (singleton pattern)
export const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);

// Helper function for querying Pinecone with common settings
export async function queryPinecone({
  vector,
  filter,
  topK = 5,
  namespace = 'book-review-full'
}: {
  vector: number[];
  filter?: Record<string, unknown>;
  topK?: number;
  namespace?: string;
}) {
  try {
    // Create an index with namespace first, then query that
    const namespaceIndex = pineconeIndex.namespace(namespace);
    
    const response = await namespaceIndex.query({
      vector,
      topK,
      includeMetadata: true,
      filter
    });
    
    return response;
  } catch (error) {
    console.error('[Pinecone Query Error]', error);
    throw error;
  }
}

// The namespace will be set by components using this instance
// This ensures consistent namespace usage across the application
export const BOOK_REVIEW_NAMESPACE = 'book-review-full';

// No need for special host configuration with the latest Pinecone SDK
// The host is automatically determined by the index name

// Note: The ensurePineconeIndex function is primarily for setup/ingestion
// and not strictly required for the chat query flow, so it's omitted here for simplicity.
// You would typically run your vector ingestion process separately. 