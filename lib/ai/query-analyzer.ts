import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';

// Use Groq for query analysis (fast, cheap)
function getAnalyzerModel() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable is not set.');
  }
  const groq = createGroq({ apiKey });
  return groq(process.env.GROQ_MODEL_ID || 'openai/gpt-oss-20b');
}

// Query types
export type QueryType =
  | 'recommendation'
  | 'book_info'
  | 'author_info'
  | 'comparison'
  | 'general'
  | 'follow_up'
  | 'review_analysis';

export interface QueryAnalysisResult {
  type: QueryType;
  filters: Record<string, unknown>;
}

const SYSTEM_PROMPT = `You are a JSON extractor for a romance book chatbot.
Given the user query, analyze it and return a JSON object with the following structure:
{
  "type": one of "recommendation", "book_info", "author_info", "comparison", "general", "follow_up", "review_analysis",
  "filters": {
    "grade": optional letter grade filter like "A+" or "B",
    "subgenre": optional subgenre like "medieval", "regency", "contemporary",
    "similarTo": optional title of a book the user likes,
    "tags": optional array of tropes or themes like ["arranged marriage", "enemies to lovers"],
    "keywords": optional general search terms,
    "sensuality": optional sensuality level like "Kisses", "Subtle", "Warm", "Hot",
    "bookTypes": optional book type(s) like "Regency Romance", "Contemporary Romance",
    "title": optional specific book title,
    "titles": optional array of book titles (for comparison queries),
    "author": optional author name
  }
}

Examples:
1. "Recommend me some medieval romance books" → {"type":"recommendation","filters":{"subgenre":"medieval"}}
2. "Tell me about The Velvet Bond by Catherine Archer" → {"type":"book_info","filters":{"title":"The Velvet Bond","author":"Catherine Archer"}}
3. "Compare Pride and Prejudice with Persuasion" → {"type":"comparison","filters":{"titles":["Pride and Prejudice","Persuasion"]}}
4. "Are there any good enemies to lovers romances?" → {"type":"recommendation","filters":{"tags":["enemies to lovers"]}}
5. "Can you analyze the review for Black Tree Moon?" → {"type":"review_analysis","filters":{"title":"Black Tree Moon"}}

Return ONLY the JSON object, no additional text.`;

/**
 * Analyzes user query using Groq LLM to extract intent and parameters.
 */
export async function analyzeQuery(query: string): Promise<QueryAnalysisResult> {
  try {
    console.log(`[QueryAnalyzer] Analyzing query: "${query}"`);

    const model = getAnalyzerModel();
    const { text } = await generateText({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: query },
      ],
      temperature: 0.1,
      providerOptions: {
        groq: { reasoningFormat: 'hidden' },
      },
    });

    // Extract JSON from response (handle potential markdown wrapping)
    let jsonStr = text.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const result = JSON.parse(jsonStr) as QueryAnalysisResult;
    console.log('[QueryAnalyzer] Result:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('[QueryAnalyzer] Error:', error);
    return { type: 'general', filters: {} };
  }
}
