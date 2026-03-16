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
    "grade": optional grade filter — use "highly_rated" for best/top/highest rated, "A_range" for A-grade, "B_range" for B-grade, or a specific grade like "A+",
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

IMPORTANT: Only use "follow_up" when the query is truly ambiguous with NO identifiable book title or author (e.g., "tell me more", "what about the second one?", "can you elaborate?"). If the user mentions a book title — even casually or with typos — always extract it and use "book_info" or "review_analysis" instead.

Examples:
1. "Recommend me some medieval romance books" → {"type":"recommendation","filters":{"subgenre":"medieval"}}
2. "Tell me about The Velvet Bond by Catherine Archer" → {"type":"book_info","filters":{"title":"The Velvet Bond","author":"Catherine Archer"}}
3. "Compare Pride and Prejudice with Persuasion" → {"type":"comparison","filters":{"titles":["Pride and Prejudice","Persuasion"]}}
4. "Are there any good enemies to lovers romances?" → {"type":"recommendation","filters":{"tags":["enemies to lovers"]}}
5. "Can you analyze the review for Black Tree Moon?" → {"type":"review_analysis","filters":{"title":"Black Tree Moon"}}
6. "my love my enemy, what did readers think?" → {"type":"review_analysis","filters":{"title":"My Love, My Enemy"}}
7. "what about Devil in Winter?" → {"type":"book_info","filters":{"title":"Devil in Winter"}}
8. "tell me more about it" → {"type":"follow_up","filters":{}}
9. "Show me the highest rated books" → {"type":"recommendation","filters":{"grade":"highly_rated"}}
10. "Best reviewed medieval romances" → {"type":"recommendation","filters":{"grade":"highly_rated","subgenre":"medieval"}}
11. "Top picks for enemies to lovers" → {"type":"recommendation","filters":{"grade":"highly_rated","tags":["enemies to lovers"]}}
12. "Give me A-graded regency romances" → {"type":"recommendation","filters":{"grade":"A_range","subgenre":"regency"}}

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
