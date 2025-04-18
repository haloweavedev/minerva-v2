// app/api/chat/route.ts
import {
  streamText,
  type Message,
  type CoreMessage
} from 'ai';
import { languageModel } from '@/lib/ai/providers';
import { getRagSystemPrompt } from '@/lib/ai/prompts';
import { generateUUID } from '@/lib/utils';
import { pineconeIndex } from '@/lib/pinecone';
import OpenAI from 'openai';
import { displayBookCardsTool } from '@/lib/ai/tools/display-book-cards';

// Remove Edge runtime configuration to use Node.js runtime instead
// export const runtime = 'edge';
// export const preferredRegion = 'home';

const RAG_TOP_K = 5;
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL_ID || 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

// Ensure OpenAI key exists for embeddings
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is required for embeddings.');
}
// Ensure Pinecone keys exist
if (!process.env.PINECONE_API_KEY) {
  throw new Error('PINECONE_API_KEY environment variable is required.');
}
if (!process.env.PINECONE_INDEX_NAME) {
    throw new Error('PINECONE_INDEX_NAME environment variable is required.');
}

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type PineconeFilter = Record<string, unknown>;

async function getContext(query: string, filters?: PineconeFilter): Promise<string> {
  if (!query || query.trim() === '') {
    console.log('[RAG] No query provided for context retrieval.');
    return '';
  }

  // --- Embedding Generation ---
  let queryEmbedding: number[];
  try {
    console.log(`[RAG] Generating embedding for query: "${query}"`);
    const embeddingResponse = await openaiClient.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query.replace(/\n/g, ' '),
      dimensions: EMBEDDING_DIMENSIONS,
    });
    const embedding = embeddingResponse.data[0]?.embedding;
    if (!embedding) {
        // Throw an error instead of just returning empty context
        throw new Error('Failed to generate query embedding. Response did not contain embedding.');
    }
    queryEmbedding = embedding;
    console.log('[RAG] Embedding generated successfully.');
  } catch (error) {
      console.error('[RAG] Error generating embedding:', error);
      // Re-throw the error to be caught by the main POST handler
      // Revert back to template literal as preferred by linter
      throw new Error(`${error instanceof Error ? error.message : 'Unknown embedding error'}`);
  }

  // --- Pinecone Query ---
  const indexName = process.env.PINECONE_INDEX_NAME;
  if (!indexName) {
    // This should technically not happen due to the check at the top, but satisfies TS/linter
    throw new Error('Pinecone index name is missing despite initial check.');
  }
  try {
    const namespace = 'book-review-full'; // Hardcode or make configurable
    console.log(`[RAG] Querying Pinecone index "${indexName}" in namespace "${namespace}"...`);
    
    // Log if filters are being applied
    if (filters) {
      console.log('[RAG] Applying filters:', JSON.stringify(filters, null, 2));
    }

    const results = await pineconeIndex
      .namespace(namespace) // Specify the correct namespace
      .query({
        vector: queryEmbedding,
        topK: RAG_TOP_K,
        includeMetadata: true,
        filter: filters // Apply any metadata filters
      });

    const matches = results.matches || [];
    console.log(`[RAG] Found ${matches.length} matches in Pinecone.`);
    if (matches.length === 0) {
      console.log('[RAG] No relevant context found in Pinecone for the query.');
      return ''; // Return empty string if no matches, this is not an error state
    }

    const contextText = matches
      .map((match, index) => {
        // Ensure metadata is treated as Record<string, unknown> for safety
        const metadata = (match.metadata || {}) as Record<string, unknown>;
        const textContent = (metadata?.text as string) || ''; // Extract text content

        // Log metadata structure for debugging (keep this)
        if (index === 0 && process.env.NODE_ENV === 'development') {
            console.log(`[RAG] Metadata structure of first match (ID: ${match.id}):`, JSON.stringify(metadata, null, 2));
        }

        // Format the chunk with clear delimiters for metadata and text
        return `Context Chunk ${index + 1} (ID: ${match.id}):
--- METADATA START ---
${JSON.stringify(metadata, null, 2)}
--- METADATA END ---

--- REVIEW TEXT START ---
${textContent}
--- REVIEW TEXT END ---`;
      })
      .join('\n\n---\n\n'); // Keep the separator between chunks

    console.log('[RAG] Formatted Context Length:', contextText.length);
    // Log a snippet including the start of the first metadata block
    console.log(`[RAG] Context Snippet:\n${contextText.substring(0, 800)}...`); // Increased snippet length
    return contextText;

  } catch (error) {
    console.error('[RAG] Error querying Pinecone:', error);
    // Re-throw the error to be caught by the main POST handler
    // Keep template literal here as it has preceding text
    throw new Error(`Failed to query Pinecone: ${error instanceof Error ? error.message : 'Unknown Pinecone error'}`);
  }
}

export async function POST(req: Request) {
  try {
    if (!req.body) {
      return Response.json({ error: 'Request body is missing.' }, { status: 400 });
    }
    const body = await req.json();
    if (!body || !Array.isArray(body.messages)) {
       return Response.json({ error: 'Invalid request body. "messages" array is required.' }, { status: 400 });
    }

    // Ensure messages have IDs *before* processing
    const messagesWithIds: CoreMessage[] = body.messages.map((msg: Message) => ({
      ...msg,
      id: msg.id ?? generateUUID(),
    }));

    // 1. Get the most recent user message content
    const lastMessage = messagesWithIds[messagesWithIds.length - 1];
    const userQuery = typeof lastMessage?.content === 'string' ? lastMessage.content : '';

    // 2. Retrieve context (wrapped in try/catch below)
    // const context = await getContext(userQuery); // Moved inside try block

    // 3. Generate the RAG system prompt (moved inside try block)
    // const ragSystemPrompt = getRagSystemPrompt(context);

    console.log('[API] Calling streamText with RAG prompt and tool...');
    // Wrap context retrieval and streamText call in a try-catch
    let context = ''; // Define context outside try block to use in catch
    try {
      // Parse potential filters from the query
      let filters: PineconeFilter | undefined = undefined;

      // Simple Grade Parsing (Example: "A grade", "B+ rating")
      const gradeMatch = userQuery.match(/([A-DF][+-]?) (grade|rating)/i);
      if (gradeMatch?.[1]) {
        filters = { ...(filters || {}), grade: gradeMatch[1].toUpperCase() };
      }

      // Simple Genre Parsing 
      const knownGenres = [
        'Historical Romance', 'Contemporary Romance', 'Sci-Fi Romance', 
        'Medieval Romance', 'Paranormal Romance', 'Time Travel Romance',
        'DIKlassic'
      ];
      
      for (const genre of knownGenres) {
        if (userQuery.toLowerCase().includes(genre.toLowerCase())) {
          // Pinecone filter for array contains: { "bookTypes": { "$in": ["value"] } }
          filters = { ...(filters || {}), bookTypes: { "$in": [genre] } };
          break; // Stop after first match for simplicity
        }
      }
      
      // Simple Tag Parsing
      const knownTags = ['arranged marriage', 'grumpy sunshine', 'enemies to lovers', 'matchmaking'];
      for (const tag of knownTags) {
        if (userQuery.toLowerCase().includes(tag.toLowerCase())) {
          filters = { ...(filters || {}), reviewTags: { "$in": [tag] } };
          break;
        }
      }

      if (filters) {
        console.log('[API] Detected Filters:', JSON.stringify(filters, null, 2));
      }
      
      // Pass filters to getContext
      context = await getContext(userQuery, filters);
      const ragSystemPrompt = getRagSystemPrompt(context);
      
      // Enhanced logging
      console.log('[API] Using System Prompt:', ragSystemPrompt);
      console.log('[API] Sending Messages:', JSON.stringify(messagesWithIds, null, 2));

      const result = await streamText({
        model: languageModel,
        system: ragSystemPrompt,
        messages: messagesWithIds,
        tools: {
          displayBookCards: displayBookCardsTool
        },
      });
      
      // Log that we're returning the response
      console.log('[API] Streaming response to client...');
      
      // Use toDataStreamResponse, which is compatible with useChat for tools
      return result.toDataStreamResponse();

    } catch (error) {
        // This will now catch errors from getContext (embeddings, Pinecone query) and streamText
        console.error('[API POST Error]', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred during processing.';
        // Return JSON error
        return Response.json({ error: `An error occurred: ${errorMessage}` }, {
          status: 500,
        });
    }
  } catch (error) {
    console.error('[RAG Chat API Error]', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    // Return JSON error
    return Response.json({ error: `An error occurred: ${errorMessage}` }, {
      status: 500,
    });
  }
} 