// app/api/chat/route.ts
import { streamText, type Message } from 'ai'; // Remove StreamingTextResponse and CoreMessage as they don't exist
import { languageModel } from '@/lib/ai/providers';
import { getRagSystemPrompt } from '@/lib/ai/prompts';
import { generateUUID } from '@/lib/utils';
import { pineconeIndex } from '@/lib/pinecone';
import OpenAI from 'openai';

// Comment out Edge runtime configuration
// export const runtime = 'edge';
// export const preferredRegion = 'home';

const RAG_TOP_K = 5;
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL_ID || 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

// Ensure OpenAI key exists for embeddings, regardless of main provider
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is required for embeddings.');
}

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getContext(query: string): Promise<string> {
  if (!query || query.trim() === '') {
    console.log('No query provided for context retrieval.');
    return '';
  }
  try {
    console.log(`Generating embedding for query: "${query}"`);
    const embeddingResponse = await openaiClient.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query.replace(/\n/g, ' '),
      dimensions: EMBEDDING_DIMENSIONS,
    });
    const queryEmbedding = embeddingResponse.data[0]?.embedding;
    if (!queryEmbedding) {
      console.error('Failed to generate query embedding.');
      return '';
    }
    console.log(`Querying Pinecone index "${process.env.PINECONE_INDEX_NAME}" in namespace "book-review-full"...`);
    const results = await pineconeIndex
      .namespace('book-review-full')
      .query({
        vector: queryEmbedding,
        topK: RAG_TOP_K,
        includeMetadata: true,
      });
    const matches = results.matches || [];
    console.log(`Found ${matches.length} matches in Pinecone.`);
    if (matches.length === 0) return '';

    const contextText = matches
      .map((match, index) => {
        const metadata = match.metadata as { text?: string; source?: string };
        const textContent = metadata?.text || '';
        return `Context Chunk ${index + 1}:\n${textContent}`;
      })
      .join('\n\n---\n\n');
    console.log('Formatted Context Length:', contextText.length);
    return contextText;
  } catch (error) {
    console.error('Error getting context from Pinecone:', error);
    return '';
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
    const messagesWithIds: Message[] = body.messages.map((msg: Message) => ({
      ...msg,
      id: msg.id ?? generateUUID(),
    }));

    // 1. Get the most recent user message content
    const lastMessage = messagesWithIds[messagesWithIds.length - 1];
    const userQuery = typeof lastMessage?.content === 'string' ? lastMessage.content : '';

    // 2. Retrieve context
    const context = await getContext(userQuery);

    // 3. Generate the RAG system prompt
    const ragSystemPrompt = getRagSystemPrompt(context);

    // 5. Call the main chat model - no need for CoreMessage conversion
    const result = await streamText({
      model: languageModel,
      system: ragSystemPrompt,
      messages: messagesWithIds, // Use the messages with IDs directly
    });

    // 6. Respond with the standard AI Stream
    return result.toDataStreamResponse(); // Use toDataStreamResponse as that's what's available

  } catch (error) {
    console.error('[RAG Chat API Error]', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    // Return JSON error
    return Response.json({ error: `An error occurred: ${errorMessage}` }, {
      status: 500,
    });
  }
} 