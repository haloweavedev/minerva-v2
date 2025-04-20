import { streamText, type Message, type CoreMessage } from 'ai';
import { languageModel } from '@/lib/ai/providers';
import { baseSystemPrompt, systemPromptWithContext, recommendationPrompt, followUpPrompt, comparisonPrompt } from '@/lib/ai/prompts';
import { displayBookCards } from '@/lib/ai/tools/display-book-cards';
import { generateUUID } from '@/lib/utils';
import { analyzeQuery } from '@/lib/ai/query-analyzer';
import { getContext } from '@/utils/getContext';

// Used to store context between turns for follow-up questions
// In a production app, consider using a more persistent store
const contextCache = new Map<string, { title?: string, context: string }>();

// Helper to convert UI messages to core messages
function convertToCoreMessages(messages: Message[]): CoreMessage[] {
  return messages.map(msg => {
    if (msg.role === 'user') {
      return { role: 'user', content: msg.content };
    } 
    if (msg.role === 'assistant') {
      return { role: 'assistant', content: msg.content };
    } 
    if (msg.role === 'system') {
      return { role: 'system', content: msg.content };
    }
    // Default case (shouldn't happen with filtered messages)
    return { role: 'user', content: typeof msg.content === 'string' ? msg.content : '' };
  });
}

export async function POST(req: Request) {
  try {
    const { messages }: { messages: Message[] } = await req.json();

    if (!messages || messages.length === 0) {
      return Response.json({ error: 'Missing or empty messages array' }, { status: 400 });
    }

    // Ensure messages have IDs
    const messagesWithIds: Message[] = messages.map(msg => ({
      ...msg,
      id: msg.id ?? generateUUID(),
    }));

    // Get the last user message
    const lastUserMessage = messagesWithIds[messagesWithIds.length - 1];
    if (lastUserMessage.role !== 'user') {
      return Response.json({ error: 'Last message must be from user' }, { status: 400 });
    }
    
    const userQuery = typeof lastUserMessage.content === 'string' 
      ? lastUserMessage.content 
      : '';

    console.log('[API] Processing query:', userQuery);

    // Generate chat ID for context caching (use conversation ID from message or create new one)
    const chatId = lastUserMessage.id.split('-')[0] || generateUUID();

    // Analyze the query to determine type and extract filters
    const { type, filters } = await analyzeQuery(userQuery);
    console.log(`[API] Query Analysis - Type: ${type}, Filters:`, filters);

    // Prepare messages for the model
    let promptMessages: CoreMessage[] = [];
    let contextUsed = '';
    
    // Filter messages to only include user and assistant messages (skip data messages, etc.)
    const validMessages = messagesWithIds.filter(msg => 
      ['user', 'assistant', 'system'].includes(msg.role)
    );
    const coreUserAssistantMessages = convertToCoreMessages(validMessages);
    
    // Handle different query types
    if (type === 'recommendation') {
      // For recommendations, use a recommendation-specific prompt without retrieval
      promptMessages = [
        { role: 'system', content: recommendationPrompt() },
        ...coreUserAssistantMessages.filter(msg => msg.role !== 'system') // Exclude any system messages
      ];
      console.log('[API] Using recommendation prompt without retrieval');
      
    } else if (type === 'comparison' && filters.titles && Array.isArray(filters.titles) && filters.titles.length === 2) {
      contextUsed = await getContext(userQuery, filters);
      promptMessages = [
        { role: 'system', content: comparisonPrompt(contextUsed) },
        ...coreUserAssistantMessages.filter(msg => msg.role !== 'system')
      ];
      console.log(`[API] Comparing: ${(filters.titles as string[]).join(' vs ')}`);

      // Cache context using both titles
      contextCache.set(chatId, {
        title: (filters.titles as string[]).join(', '),
        context: contextUsed
      });
    } else if (type === 'follow_up' && contextCache.has(chatId)) {
      // For follow-up questions, use the cached context from previous turns
      const cachedContext = contextCache.get(chatId);
      if (cachedContext) {
        contextUsed = cachedContext.context;
        promptMessages = [
          { role: 'system', content: followUpPrompt(contextUsed) },
          ...coreUserAssistantMessages.filter(msg => msg.role !== 'system') // Exclude any system messages
        ];
        console.log(`[API] Using cached context for follow-up question about: ${cachedContext.title || 'previous topic'}`);
      }
      
    } else if (type === 'book_info') {
      // 1. Retrieve context
      contextUsed = await getContext(userQuery, filters);

      // 2. Build prompt messages
      promptMessages = [
        { role: 'system', content: systemPromptWithContext(contextUsed) },
        ...coreUserAssistantMessages.filter(m => m.role !== 'system')
      ];
      console.log('[API] For book_info, allowing model to call displayBookCards');

      // 3. Stream the response, letting the model call the tool
      const result = await streamText({
        model: languageModel,
        messages: promptMessages,
        tools: { displayBookCards }, 
        temperature: 0.7,
        maxTokens: 1024,
        maxSteps: 2 // Allow text generation + tool call
      });
      return result.toDataStreamResponse();
    } else {
      // For book info or general queries, retrieve relevant context
      contextUsed = await getContext(userQuery, filters);
      
      // Cache this context for future follow-up questions
      if (contextUsed) {
        contextCache.set(chatId, { 
          title: filters.title as string | undefined, 
          context: contextUsed 
        });
        console.log(`[API] Cached context for: ${filters.title || 'general query'}`);
        
        // Use the context in the prompt
        promptMessages = [
          { role: 'system', content: systemPromptWithContext(contextUsed) },
          ...coreUserAssistantMessages.filter(msg => msg.role !== 'system') // Exclude any system messages
        ];
        console.log(`[API] Retrieved context length: ${contextUsed.length} chars`);
      } else {
        // No context found, use base prompt
        promptMessages = [
          { role: 'system', content: baseSystemPrompt },
          ...coreUserAssistantMessages.filter(msg => msg.role !== 'system') // Exclude any system messages
        ];
        console.log('[API] No relevant context found, using base prompt');
      }
    }

    // Log a snippet of the system prompt for debugging
    if (promptMessages.length > 0 && typeof promptMessages[0].content === 'string') {
      const snippetLength = Math.min(promptMessages[0].content.length, 200);
      console.log(`[API] System Prompt Snippet: ${promptMessages[0].content.substring(0, snippetLength)}...`);
    }

    // Call language model with streaming and tool support
    const result = await streamText({
      model: languageModel,
      messages: promptMessages,
      tools: { displayBookCards },
      temperature: 0.7,
      maxTokens: 1024,
      maxSteps: 2  // Allow the model to call a tool and then respond based on the result
    });

    // Stream the response
    return result.toDataStreamResponse();

  } catch (error) {
    console.error('[API POST Error]', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    return Response.json({ error: `Chat processing failed: ${errorMessage}` }, { status: 500 });
  }
} 