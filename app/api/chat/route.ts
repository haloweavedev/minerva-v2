// app/api/chat/route.ts
import { streamText, type Message } from 'ai';
import { languageModel } from '@/lib/ai/providers'; // Import the configured model
import { systemPrompt } from '@/lib/ai/prompts'; // Import the system prompt
import { generateUUID } from '@/lib/utils'; // Import UUID generator

// IMPORTANT! Set the runtime to edge
export const runtime = 'edge';
export const preferredRegion = 'home'; // Optional: Set preferred region

export async function POST(req: Request) {
  try {
    // Basic validation
    if (!req.body) {
      return new Response('Request body is missing.', { status: 400 });
    }

    const body = await req.json();

    // Validate messages structure
    if (!body || !Array.isArray(body.messages)) {
       return new Response('Invalid request body. "messages" array is required.', { status: 400 });
    }
    const messages: Message[] = body.messages;

    // Add IDs to messages if they don't have them
    // This might be handled by useChat already, but good practice
    const messagesWithIds = messages.map((msg) => ({
      ...msg,
      id: msg.id ?? generateUUID(),
    }));

    const result = await streamText({
      model: languageModel,
      system: systemPrompt,
      messages: messagesWithIds,
    });

    // Use AI SDK standard response format
    return result.toDataStreamResponse();

  } catch (error) {
    console.error('[Chat API Error]', error);
    // Provide a more informative error response if possible
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    return new Response(`An error occurred: ${errorMessage}`, {
      status: 500,
    });
  }
} 