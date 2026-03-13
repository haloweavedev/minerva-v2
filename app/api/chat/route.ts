import { streamText, type UIMessage, type ModelMessage, convertToModelMessages, stepCountIs } from 'ai';
import { languageModel } from '@/lib/ai/providers';
import { baseSystemPrompt, systemPromptWithContext, recommendationPrompt, followUpPrompt, comparisonPrompt, analysisPrompt } from '@/lib/ai/prompts';
import { displayBookCards } from '@/lib/ai/tools/display-book-cards';
import { generateUUID } from '@/lib/utils';
import { analyzeQuery } from '@/lib/ai/query-analyzer';
import { getContext } from '@/utils/getContext';

// Context cache for follow-up questions
const contextCache = new Map<string, { title?: string; context: string }>();

function extractUserText(msg: UIMessage): string {
  if (msg.parts) {
    const textPart = msg.parts.find(p => p.type === 'text');
    if (textPart && 'text' in textPart) return textPart.text;
  }
  return '';
}

/**
 * Build a RAG search query augmented with conversation history.
 * Uses the last 2 previous user messages for context when available.
 */
function buildAugmentedQuery(currentQuery: string, messages: UIMessage[]): string {
  const previousUserTexts = messages
    .filter(m => m.role === 'user')
    .slice(0, -1) // exclude current
    .map(m => extractUserText(m))
    .filter(Boolean)
    .slice(-2); // last 2 previous user messages

  if (previousUserTexts.length === 0) return currentQuery;
  return `${previousUserTexts.join(' ')} ${currentQuery}`;
}

/**
 * RAG search that uses conversation history for multi-turn queries.
 * For first messages, searches with just the current query.
 * For follow-ups, uses the augmented query (history + current) as primary search.
 */
async function getContextWithHistory(
  currentQuery: string,
  filters: Record<string, unknown>,
  messages: UIMessage[],
  queryType: string
): Promise<string> {
  const augmented = buildAugmentedQuery(currentQuery, messages);
  const isMultiTurn = augmented !== currentQuery;

  if (isMultiTurn) {
    // Multi-turn: search with history-augmented query for better context.
    // Clear title/author filters so getContext uses the augmented query
    // for embedding instead of a potentially wrong title extracted from
    // the current message alone.
    console.log(`[API] Multi-turn RAG: "${augmented.substring(0, 120)}"`);
    return await getContext(augmented, {}, undefined, { queryType: 'book_info' });
  }

  return await getContext(currentQuery, filters, undefined, { queryType });
}

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();

    if (!messages || messages.length === 0) {
      return Response.json({ error: 'Missing or empty messages array' }, { status: 400 });
    }

    const messagesWithIds: UIMessage[] = messages.map(msg => ({
      ...msg,
      id: msg.id ?? generateUUID(),
    }));

    const lastUserMessage = messagesWithIds[messagesWithIds.length - 1];
    if (lastUserMessage.role !== 'user') {
      return Response.json({ error: 'Last message must be from user' }, { status: 400 });
    }

    const userQuery = extractUserText(lastUserMessage);

    console.log('[API] Processing query:', userQuery);

    const chatId = lastUserMessage.id.split('-')[0] || generateUUID();

    // Analyze query
    const { type, filters } = await analyzeQuery(userQuery);
    console.log(`[API] Query type: ${type}, Filters:`, filters);

    // Convert UI messages to model messages using SDK helper
    const modelMessages = await convertToModelMessages(messagesWithIds);
    const nonSystemMessages = modelMessages.filter(msg => msg.role !== 'system');

    let promptMessages: ModelMessage[] = [];
    let contextUsed = '';

    if (type === 'recommendation') {
      promptMessages = [
        { role: 'system', content: recommendationPrompt() },
        ...nonSystemMessages,
      ];
      console.log('[API] Using recommendation prompt (tool-driven)');

    } else if (type === 'comparison' && filters.titles && Array.isArray(filters.titles) && filters.titles.length === 2) {
      contextUsed = await getContextWithHistory(userQuery, filters, messagesWithIds, type);
      promptMessages = [
        { role: 'system', content: comparisonPrompt(contextUsed) },
        ...nonSystemMessages,
      ];
      console.log(`[API] Comparing: ${(filters.titles as string[]).join(' vs ')}`);
      contextCache.set(chatId, { title: (filters.titles as string[]).join(', '), context: contextUsed });

    } else if (type === 'follow_up') {
      if (contextCache.has(chatId)) {
        const cached = contextCache.get(chatId)!;
        contextUsed = cached.context;
        promptMessages = [
          { role: 'system', content: followUpPrompt(contextUsed) },
          ...nonSystemMessages,
        ];
        console.log(`[API] Follow-up using cached context for: ${cached.title || 'previous topic'}`);
      } else {
        // No cache (serverless lost it) — use history-augmented RAG
        const augmented = buildAugmentedQuery(userQuery, messagesWithIds);
        console.log(`[API] Follow-up with no cache, searching: "${augmented.substring(0, 120)}"`);
        contextUsed = await getContext(augmented, {}, undefined, { queryType: 'book_info' });
        if (contextUsed) {
          contextCache.set(chatId, { title: filters.title as string | undefined, context: contextUsed });
          promptMessages = [
            { role: 'system', content: followUpPrompt(contextUsed) },
            ...nonSystemMessages,
          ];
        } else {
          promptMessages = [
            { role: 'system', content: baseSystemPrompt },
            ...nonSystemMessages,
          ];
        }
      }

    } else if (type === 'book_info') {
      contextUsed = await getContextWithHistory(userQuery, filters, messagesWithIds, type);
      promptMessages = [
        { role: 'system', content: systemPromptWithContext(contextUsed) },
        ...nonSystemMessages,
      ];
      console.log('[API] Book info query with context');

      // Cache for follow-ups
      if (contextUsed) {
        contextCache.set(chatId, { title: filters.title as string | undefined, context: contextUsed });
      }

      // Early return for book_info to allow tool call + response
      const result = await streamText({
        model: languageModel,
        messages: promptMessages,
        tools: { displayBookCards },
        temperature: Number(process.env.AI_TEMPERATURE ?? '0.4'),
        maxOutputTokens: Number.parseInt(process.env.AI_MAX_TOKENS || '', 10) || 2048,
        stopWhen: stepCountIs(2),
        providerOptions: {
          groq: { reasoningFormat: 'hidden' },
        },
      });
      return result.toUIMessageStreamResponse();

    } else {
      // General, author_info, review_analysis
      contextUsed = await getContextWithHistory(userQuery, filters, messagesWithIds, type);

      if (contextUsed) {
        contextCache.set(chatId, { title: filters.title as string | undefined, context: contextUsed });

        if (type === 'review_analysis') {
          promptMessages = [
            { role: 'system', content: analysisPrompt(contextUsed) },
            ...nonSystemMessages,
          ];
        } else {
          promptMessages = [
            { role: 'system', content: systemPromptWithContext(contextUsed) },
            ...nonSystemMessages,
          ];
        }
        console.log(`[API] Context retrieved: ${contextUsed.length} chars`);
      } else {
        promptMessages = [
          { role: 'system', content: baseSystemPrompt },
          ...nonSystemMessages,
        ];
        console.log('[API] No context found, using base prompt');
      }
    }

    // Stream response
    const result = await streamText({
      model: languageModel,
      messages: promptMessages,
      tools: { displayBookCards },
      temperature: Number(process.env.AI_TEMPERATURE ?? '0.4'),
      maxOutputTokens: Number.parseInt(process.env.AI_MAX_TOKENS || '', 10) || 2048,
      stopWhen: stepCountIs(2),
      providerOptions: {
        groq: { reasoningFormat: 'hidden' },
      },
    });

    return result.toUIMessageStreamResponse();

  } catch (error) {
    console.error('[API POST Error]', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    return Response.json({ error: `Chat processing failed: ${errorMessage}` }, { status: 500 });
  }
}
