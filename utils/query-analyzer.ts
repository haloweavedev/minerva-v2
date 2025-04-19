/**
 * Simple heuristic-based query analyzer
 */

// Types for query analysis
export type QueryType = 'recommendation' | 'specific_book_info' | 'general_query';

export interface QueryAnalysis {
  type: QueryType;
  filters: Record<string, unknown>;
}

// Known tags to look for
const knownTags: string[] = [
  'arranged marriage',
  'DIKlassic',
  'Medieval',
  'Regency',
  'Contemporary Romance',
  'Historical Romance',
  'paranormal',
  'sports',
  'friends to lovers',
  'enemies to lovers',
  'second chance',
  'fake relationship',
];

/**
 * Analyzes a query using simple heuristics rather than LLM
 * @param query The user's query
 * @returns Analysis of query type and filters
 */
export function analyzeQuery(query: string): QueryAnalysis {
  // Convert to lowercase for easier matching
  const lowercaseQuery = query.toLowerCase();
  
  // Default response
  const result: QueryAnalysis = {
    type: 'general_query',
    filters: {}
  };
  
  // Check for recommendation intent
  if (
    lowercaseQuery.includes('recommend') || 
    lowercaseQuery.includes('suggest') || 
    lowercaseQuery.includes('list') ||
    lowercaseQuery.includes('find me') ||
    lowercaseQuery.includes('can you give me') ||
    lowercaseQuery.includes('what are some')
  ) {
    result.type = 'recommendation';
  }
  
  // Check for specific book request
  else if (
    lowercaseQuery.includes('tell me about') ||
    lowercaseQuery.includes('information on') ||
    lowercaseQuery.includes('do you have') ||
    lowercaseQuery.includes('details about') ||
    lowercaseQuery.includes('what is') ||
    lowercaseQuery.includes('know about')
  ) {
    result.type = 'specific_book_info';
    
    // Try to extract book title - look for quoted titles or just use the query
    const titleMatch = lowercaseQuery.match(/"([^"]+)"|'([^']+)'/);
    if (titleMatch) {
      const title = titleMatch[1] || titleMatch[2];
      result.filters.title = title;
    } else {
      // For queries like "tell me about velvet bond"
      // Split the query and extract likely title words (non-common words)
      const commonWords = ['tell', 'me', 'about', 'information', 'on', 'do', 'you', 'have', 'details', 'what', 'is', 'the', 'book', 'novel', 'romance'];
      const words = lowercaseQuery.split(/\s+/);
      const titleWords = words.filter(w => !commonWords.includes(w) && w.length > 2);
      
      if (titleWords.length > 0) {
        // If we have multiple words that might be a title, join them
        // This is simplistic but can work for basic queries
        result.filters.titles = titleWords.map(w => {
          // Capitalize first letter of each word for better matching
          return w.charAt(0).toUpperCase() + w.slice(1);
        });
      }
    }
  }
  
  // Extract grade filters
  const gradeMatch = lowercaseQuery.match(/\b([a-d][+-]?)\b/gi);
  if (gradeMatch) {
    const grades = gradeMatch.map(g => g.toUpperCase());
    result.filters.grade = grades.length === 1 ? grades[0] : { "$in": grades };
  }
  
  // Extract tag filters based on known tags
  const matchedTags = knownTags.filter(tag => 
    lowercaseQuery.includes(tag.toLowerCase())
  );
  
  if (matchedTags.length > 0) {
    result.filters.tags = matchedTags;
  }
  
  console.log('[QueryAnalyzer] Analysis Result:', JSON.stringify(result, null, 2));
  return result;
} 