import type { RecommendationQuery } from "./schemas";

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
 * Detects if a query is asking for book recommendations
 */
function isRecommendationQuery(query: string): boolean {
  const lower = query.toLowerCase();
  
  // Check for explicit recommendation phrases
  if (
    /recommend|suggest|suggest.+book|recommendation|suggestions/i.test(lower) ||
    /looking for|any (good|great)/i.test(lower) ||
    /what are some/i.test(lower) ||
    /similar to|like/i.test(lower) ||
    /if i liked/i.test(lower) ||
    /can you (find|list)/i.test(lower)
  ) {
    return true;
  }
  
  // Check for genre/rating requests that imply recommendations
  if (
    (/[A-F][\+\-]?/.test(lower) || /grade/.test(lower)) && 
    (/romance\b/.test(lower) || /best|good|top|great/.test(lower))
  ) {
    return true;
  }
  
  // Check for multiple book requests
  if (
    /books about|books with|books that/i.test(lower) ||
    /list of|books\s+for/i.test(lower)
  ) {
    return true;
  }
  
  return false;
}

/**
 * Detects if query is about a specific book
 */
function isBookInfoQuery(query: string): boolean {
  const lower = query.toLowerCase();
  
  // Check for title/author patterns
  if (
    lower.includes(' by ') || // e.g. "Velvet Bond by Catherine Archer"
    /^(what|who|when|tell me about)/i.test(lower) ||
    /information about|summary of|review of|plot of/i.test(lower)
  ) {
    return true;
  }
  
  // Check if the query seems to be a specific title (capitalized words)
  if (
    /^[A-Z][\w\s\']+$/.test(query) && // Title-like format
    !/recommend|suggest/.test(lower) // Not asking for recommendation
  ) {
    return true;
  }
  
  return false;
}

/**
 * Detects if query is asking to compare books
 */
function isComparisonQuery(query: string): boolean {
  return /\b(compare|difference|better than|versus|vs\.?)\b/i.test(query);
}

/**
 * Extracts book title from query where possible
 */
function extractBookTitle(query: string): string | undefined {
  // First clean up common filler phrases
  const cleaned = query.replace(/(can you tell me|what is|about|please|who is)/gi, ' ')
    .replace(/(the book|novel|story|titled|called)\s+/gi, ' ')
    .trim();

  // Look for "Title by Author" pattern from anywhere in the string
  const byMatch = cleaned.match(/["']?([^"']+?)["']?\s+by\s+([^\?\.]+)/i);
  if (byMatch?.[1]) {
    return byMatch[1].trim();
  }
  
  // Look for "info about Title" pattern
  const aboutMatch = query.match(/(?:about|on|for)\s+["']?([^"'?]+)["']?/i);
  if (aboutMatch?.[1]) {
    // Clean up the "the book" phrase from this match as well
    return aboutMatch[1].replace(/(the book|novel|story|titled|called)\s+/gi, '').trim();
  }
  
  return undefined;
}

/**
 * Extracts author from query where possible
 */
function extractAuthor(query: string): string | undefined {
  const cleaned = query.replace(/(can you tell me|what is|about|please|who is)/gi, '').trim();

  // Look for "Title by Author" pattern from anywhere in the string
  const byMatch = cleaned.match(/["']?(.+?)["']?\s+by\s+([^\?\.]+)/i);
  if (byMatch?.[2]) {
    return byMatch[2].trim();
  }
  
  return undefined;
}

/**
 * Extracts grade from query where possible
 */
function extractGrade(query: string): string | undefined {
  // Look for letter grades like "A+", "B-"
  const gradeMatch = query.match(/\b([A-F][\+\-]?)\b/i);
  if (gradeMatch?.[1]) {
    return gradeMatch[1].toUpperCase();
  }
  
  return undefined;
}

/**
 * Extracts subgenre or setting from query
 */
function extractSubgenre(query: string): string | undefined {
  const lower = query.toLowerCase();
  
  // Common romance subgenres and settings to check for
  const subgenres = [
    'medieval', 'regency', 'victorian', 'contemporary', 
    'historical', 'paranormal', 'suspense', 'western',
    'fantasy', 'gothic', 'erotic', 'inspirational'
  ];
  
  for (const subgenre of subgenres) {
    if (lower.includes(subgenre)) {
      return subgenre;
    }
  }
  
  return undefined;
}

// Extracts tags (heuristically)
function extractTags(query: string): string[] {
  const knownTags = [
    "arranged marriage", 
    "grumpy sunshine", 
    "friends to lovers", 
    "alpha hero", 
    "age gap", 
    "marriage of convenience",
    "secret baby",
    "enemies to lovers",
    "forbidden romance",
    "second chance",
    "slow burn",
    "fake relationship",
    "workplace romance",
    "forced proximity",
    "small town",
    "royal romance",
    "bodyguard",
    "soul mates",
    "opposites attract",
    "fated mates"
  ];
  const lower = query.toLowerCase();
  return knownTags.filter(tag => lower.includes(tag));
}

/**
 * Extracts recommendation parameters from query
 */
function extractRecommendationParams(query: string): RecommendationQuery {
  const params: RecommendationQuery = {};
  
  // Extract similar book title (for "books like X" queries)
  const similarMatches = query.match(/(?:like|similar to)\s+["']?([^"'?\.]+)["']?/i);
  if (similarMatches?.[1]) {
    params.similarTo = similarMatches[1].trim();
  }
  
  // Extract grade
  const grade = extractGrade(query);
  if (grade) {
    params.grade = grade;
  }
  
  // Extract subgenre
  const subgenre = extractSubgenre(query);
  if (subgenre) {
    params.subgenre = subgenre;
  }
  
  // Extract review tags if possible
  const tags = extractTags(query);
  if (tags.length > 0) {
    params.tags = tags;
  }
  
  // Extract general keywords (anything that might be criteria)
  // For simplicity, we're just taking the whole query after removing specific params
  let keywords = query;
  if (params.similarTo) {
    keywords = keywords.replace(/(?:like|similar to)\s+["']?([^"'?\.]+)["']?/i, '');
  }
  if (params.grade) {
    keywords = keywords.replace(/\b([A-F][\+\-]?)\b/i, '');
  }
  if (params.subgenre) {
    keywords = keywords.replace(new RegExp(`\\b${params.subgenre}\\b`, 'i'), '');
  }
  
  // Only add keywords if there's meaningful content left
  keywords = keywords.trim().replace(/\s+/g, ' ');
  if (keywords.length > 5 && !keywords.match(/^(recommend|suggest|find|get|tell me|what are).+$/i)) {
    params.keywords = keywords;
  }
  
  return params;
}

/**
 * Analyzes user query and returns query type and filters
 */
export function analyzeQuery(query: string): QueryAnalysisResult {
  const filters: Record<string, unknown> = {};
  
  // Step 1: Determine query type
  let type: QueryType = 'general';
  
  if (isRecommendationQuery(query)) {
    type = 'recommendation';
    
    // For recommendation queries, extract structured parameters
    const params = extractRecommendationParams(query);
    if (params.grade) filters.grade = params.grade;
    if (params.subgenre) filters.subgenre = params.subgenre;
    if (params.similarTo) filters.title = params.similarTo;
    if (params.keywords) filters.keywords = params.keywords;
    if (params.tags) filters.tags = params.tags;
    
  } else if (isComparisonQuery(query)) {
    type = 'comparison';
    const titleMatches = query.match(/"([^"]+)"|'([^']+)'|'([^']+)'|"([^"]+)"|([A-Z][\w\s]+)\s+(vs\.?|versus|compared to|and)\s+([A-Z][\w\s]+)/i);
    if (titleMatches) {
      filters.titles = [titleMatches[1] || titleMatches[5], titleMatches[7]].filter(Boolean);
    }
  } else if (isBookInfoQuery(query)) {
    type = 'book_info';
    
    // For book info queries, extract title and author
    const title = extractBookTitle(query);
    if (title) filters.title = title;
    
    const author = extractAuthor(query);
    if (author) filters.author = author;
  } else {
    // Could be follow-up or general query
    if (query.length < 20 && /\b(it|this|that|they|them|those|he|she|the book)\b/i.test(query)) {
      type = 'follow_up';
    }
  }
  
  return { type, filters };
} 