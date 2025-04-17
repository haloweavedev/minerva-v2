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

async function getContext(query: string): Promise<string> {
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

    const results = await pineconeIndex
      .namespace(namespace) // Specify the correct namespace
      .query({
        vector: queryEmbedding,
        topK: RAG_TOP_K,
        includeMetadata: true,
      });

    const matches = results.matches || [];
    console.log(`[RAG] Found ${matches.length} matches in Pinecone.`);
    if (matches.length === 0) {
      console.log('[RAG] No relevant context found in Pinecone for the query.');
      return ''; // Return empty string if no matches, this is not an error state
    }

    const contextText = matches
      .map((match, index) => {
        const metadata = match.metadata as { text?: string; [key: string]: unknown }; // Type assertion with index signature
        const textContent = metadata?.text || '';
        // Log the metadata structure of the first match for debugging (optional, can be removed later)
        if (index === 0 && process.env.NODE_ENV === 'development') {
            console.log('[RAG] Metadata structure of first match:', JSON.stringify(match.metadata, null, 2));
        }
        return `Context Chunk ${index + 1}:\n${textContent}`;
      })
      .join('\n\n---\n\n');

    console.log('[RAG] Formatted Context Length:', contextText.length);
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
      context = await getContext(userQuery);
      const ragSystemPrompt = getRagSystemPrompt(context);

      const result = await streamText({
        model: languageModel,
        system: ragSystemPrompt,
        messages: messagesWithIds,
        tools: {
          displayBookCards: displayBookCardsTool
        },
      });
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