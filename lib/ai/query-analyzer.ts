import OpenAI from 'openai';

// Initialize OpenAI client for direct API access
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Query types
export type QueryType = 
  | 'recommendation'   // User wants book recommendations
  | 'book_info'        // User wants info about a specific book
  | 'author_info'      // User wants info about an author
  | 'comparison'       // User wants to compare two books
  | 'general'          // Other general queries
  | 'follow_up';       // Follow-up question to previous query

// Result of query analysis
export interface QueryAnalysisResult {
  type: QueryType;
  filters: Record<string, unknown>;
}

/**
 * Analyzes user query using LLM to extract intent and parameters
 */
export async function analyzeQuery(query: string): Promise<QueryAnalysisResult> {
  try {
    console.log(`[QueryAnalyzer] Analyzing query: "${query}"`);
    
    const response = await openaiClient.chat.completions.create({
      model: process.env.OPENAI_MODEL_ID || 'gpt-4-turbo',
      messages: [
        { 
          role: 'system', 
          content: `You are a JSON extractor for a romance book chatbot. 
Given the user query, analyze it and return a JSON object with the following structure:
{
  "type": one of "recommendation", "book_info", "author_info", "comparison", "general", "follow_up",
  "filters": {
    // For recommendations
    "grade": optional letter grade filter like "A+" or "B",
    "subgenre": optional subgenre like "medieval", "regency", "contemporary",
    "similarTo": optional title of a book the user likes,
    "tags": optional array of tropes or themes like ["arranged marriage", "enemies to lovers"],
    "keywords": optional general search terms,
    
    // For book_info
    "title": optional specific book title,
    "titles": optional array of book titles (for comparison queries),
    
    // For author_info
    "author": optional author name
  }
}

Examples:
1. "Recommend me some medieval romance books" → {"type":"recommendation","filters":{"subgenre":"medieval"}}
2. "Tell me about The Velvet Bond by Catherine Archer" → {"type":"book_info","filters":{"title":"The Velvet Bond","author":"Catherine Archer"}}
3. "Compare Pride and Prejudice with Persuasion" → {"type":"comparison","filters":{"titles":["Pride and Prejudice","Persuasion"]}}
4. "Are there any good enemies to lovers romances?" → {"type":"recommendation","filters":{"tags":["enemies to lovers"]}}` 
        },
        { role: 'user', content: query }
      ],
      temperature: 0.1, // Low temperature for deterministic output
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message.content;
    if (!content) {
      throw new Error("No content in response from language model");
    }

    // Parse the JSON response
    const result = JSON.parse(content) as QueryAnalysisResult;
    console.log('[QueryAnalyzer] Analysis Result:', JSON.stringify(result, null, 2));
    
    return result;
  } catch (error) {
    console.error('[QueryAnalyzer] Error:', error);
    // Return a general query type on error
    return { type: 'general', filters: {} };
  }
} 