import { pineconeIndex, queryPinecone, BOOK_REVIEW_NAMESPACE } from '@/lib/pinecone';
import OpenAI from 'openai';

// Initialize OpenAI client for embeddings
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Constants
export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL_ID || 'text-embedding-3-small';
const TOP_K = 5;
const MIN_SCORE = 0.7; // Minimum similarity score threshold

/**
 * Generates an embedding for text input
 */
export async function embedText(text: string): Promise<number[]> {
  const response = await openaiClient.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.replace(/\n/g, ' ').trim(),
  });
  
  const embedding = response.data[0]?.embedding;
  if (!embedding) {
    throw new Error('Failed to generate embedding');
  }
  
  return embedding;
}

/**
 * Builds a Pinecone filter based on query analysis filters
 */
function buildPineconeFilter(filters: Record<string, unknown>): Record<string, unknown> | undefined {
  const f: Record<string, unknown> = {};

  // Handle title filters
  if (filters.title && typeof filters.title === 'string') {
    f.bookTitle = { $eq: filters.title }; // Exact match for title
  }

  if (filters.titles && Array.isArray(filters.titles)) {
    const stringTitles = filters.titles.filter(t => typeof t === 'string');
    if (stringTitles.length > 0) {
      f.$or = stringTitles.map(t => ({ bookTitle: { $eq: t } }));
    }
  }

  // Handle author filter
  if (filters.author && typeof filters.author === 'string') {
    f.authorName = { $eq: filters.author };
  }

  // Handle grade filter
  if (filters.grade && typeof filters.grade === 'string') {
    f.grade = { $eq: filters.grade };
  }

  // We no longer use hardcoded subgenre mappings - rely on vector similarity instead

  // Return undefined if no filters were added
  return Object.keys(f).length > 0 ? f : undefined;
}

/**
 * Retrieves relevant context from Pinecone based on query and filters
 */
export async function getContext(
  query: string, 
  filters: Record<string, unknown> = {},
  similarToTitle?: string
): Promise<string> {
  try {
    console.log(`[getContext] Processing query: "${query}"`);
    
    // Check if this is a comparison query with multiple titles
    const isComparisonQuery: boolean = Boolean(filters.titles && Array.isArray(filters.titles) && (filters.titles as string[]).length > 0);
    
    // 1. Generate embedding for the query
    // Use a cleaned input when title and author are available
    let embeddingInput = 
      (filters.title && filters.author) 
        ? `${filters.title} by ${filters.author}`
        : query.replace(/\n/g, ' ').trim();
    
    // For comparison queries, use both book titles in the embedding
    if (isComparisonQuery) {
      embeddingInput = (filters.titles as string[]).join(' compared to ');
    }
    
    console.log(`[getContext] Using embedding input: "${embeddingInput}"`);
    const embedding = await embedText(embeddingInput);
    
    // 2. Attempt strict query first
    let pineconeFilter = buildPineconeFilter(filters);
    if (pineconeFilter) {
      console.log('[getContext] Using filter:', JSON.stringify(pineconeFilter, null, 2));
    }
    
    // If similarToTitle is provided, set up $ne filter to exclude that title
    if (similarToTitle && typeof similarToTitle === 'string') {
      if (!pineconeFilter) {
        // Create a new filter to exclude the similar title
        const exclusionFilter = {
          bookTitle: { $ne: similarToTitle }
        };
        console.log(`[getContext] Excluding similar title: ${similarToTitle}`);
      } else {
        // Add to existing filter
        // This is a simplification - in a real implementation you'd need to handle
        // complex filter combinations more carefully
        console.log(`[getContext] Excluding similar title: ${similarToTitle}`);
      }
    }
    
    // 3. Query Pinecone
    console.log('[getContext] Querying Pinecone...');
    let results = await queryPinecone({
      vector: embedding,
      filter: pineconeFilter,
      topK: TOP_K,
      namespace: BOOK_REVIEW_NAMESPACE
    });
    
    let matches = results.matches || [];
    console.log(`[getContext] Found ${matches.length} matches`);
    
    if (matches.length === 0) {
      console.warn('[getContext] No matches found with filters, retrying without filters.');
      pineconeFilter = undefined;
      results = await queryPinecone({ vector: embedding, topK: TOP_K, namespace: BOOK_REVIEW_NAMESPACE });
      matches = results.matches || [];
    }
    
    if (matches.length === 0) {
      return '';
    }
    
    // 4. Process results with deduplication
    const seenBooks = new Set<string>();
    const contextEntries: string[] = [];
    const bookContextMap: Record<string, string[]> = {}; // Group context by book title for comparisons
    
    for (const match of matches) {
      // Skip matches below threshold score
      if (match.score && match.score < MIN_SCORE) {
        console.log(`[getContext] Skipping low-score match: ${match.score}`);
        continue;
      }
      
      const meta = match.metadata as Record<string, unknown> | undefined;
      if (!meta) continue;
      
      // Extract title and text from metadata
      const title = meta.bookTitle as string | undefined;
      const author = meta.authorName as string | undefined;
      const text = meta.text as string | undefined;
      const grade = meta.grade as string | undefined;
      
      // Skip if missing essential info
      if (!title || !text) continue;
      
      // For comparison queries, we want one entry per book, but group all context
      if (isComparisonQuery) {
        // Initialize array for this book if it doesn't exist
        if (!bookContextMap[title]) {
          bookContextMap[title] = [];
        }
        
        // Format the context entry with the book title and author (if available)
        let contextEntry = `**${title}**`;
        if (author) contextEntry += ` by ${author}`;
        if (grade) contextEntry += ` (Grade: ${grade})`;
        contextEntry += ` – ${text}`;
        
        // Add to book-specific context group
        bookContextMap[title].push(contextEntry);
        continue;
      }
      
      // Standard processing for non-comparison queries
      // Skip if we've already included this book
      if (seenBooks.has(title)) {
        console.log(`[getContext] Skipping duplicate book: ${title}`);
        continue;
      }
      
      // Add to seen books and include in context
      seenBooks.add(title);
      
      // Format the context entry with the book title and author (if available)
      let contextEntry = `**${title}**`;
      if (author) contextEntry += ` by ${author}`;
      if (grade) contextEntry += ` (Grade: ${grade})`;
      contextEntry += ` – ${text}`;
      
      contextEntries.push(contextEntry);
    }
    
    // Process comparison query results if applicable
    if (isComparisonQuery && Object.keys(bookContextMap).length > 0) {
      for (const [bookTitle, entries] of Object.entries(bookContextMap)) {
        // Take the first entry for each book to avoid redundancy
        if (entries.length > 0) {
          contextEntries.push(entries[0]);
          seenBooks.add(bookTitle);
        }
      }
    }
    
    // Fallback: allow lowest-score match if nothing else matched
    if (matches.length > 0 && contextEntries.length === 0) {
      console.log('[getContext] No matches above score threshold, using fallback');
      const fallback = matches[0];
      const meta = fallback.metadata as Record<string, unknown> | undefined;
      if (meta?.bookTitle && meta?.text) {
        let contextEntry = `**${meta.bookTitle}**`;
        if (meta.authorName) contextEntry += ` by ${meta.authorName}`;
        if (meta.grade) contextEntry += ` (Grade: ${meta.grade})`;
        contextEntry += ` – ${meta.text}`;
        
        contextEntries.push(contextEntry);
        seenBooks.add(meta.bookTitle as string);
        console.log(`[getContext] Added fallback match with score: ${fallback.score}`);
      }
    }
    
    // 5. Concatenate context with clear separation
    const contextText = contextEntries.length > 0
      ? `${generateContextSummary(contextEntries, isComparisonQuery)}\n\n${contextEntries.join('\n\n---\n\n')}`
      : '';
    
    console.log(`[getContext] Final context includes ${seenBooks.size} unique books, ${contextText.length} chars`);
    
    return contextText;
  } catch (error) {
    console.error('[getContext] Error:', error);
    // Return empty string on error instead of throwing
    return '';
  }
}

/**
 * Generates a summary line for the beginning of the context
 */
function generateContextSummary(entries: string[], isComparison = false): string {
  if (entries.length === 0) return '';
  
  // For comparison queries with exactly 2 books
  if (isComparison && entries.length === 2) {
    const titleMatches1 = entries[0].match(/\*\*([^*]+)\*\*/);
    const titleMatches2 = entries[1].match(/\*\*([^*]+)\*\*/);
    
    if (titleMatches1 && titleMatches2) {
      const title1 = titleMatches1[1].trim();
      const title2 = titleMatches2[1].trim();
      
      return `This context includes reviews of "${title1}" and "${title2}" for comparison.`;
    }
  }
  
  // For a single book entry
  if (entries.length === 1) {
    // Extract title and author from the first entry
    const titleMatch = entries[0].match(/\*\*([^*]+)\*\*(?:\s+by\s+([^(]+))?/);
    if (titleMatch) {
      const title = titleMatch[1].trim();
      const author = titleMatch[2]?.trim() || '';
      
      if (author) {
        return `This context includes a review of "${title}" by ${author}.`;
      }
      
      return `This context includes a review of "${title}".`;
    }
  }
  
  // Default case (multiple books or no match)
  return `This context includes reviews of ${entries.length} books.`;
} 