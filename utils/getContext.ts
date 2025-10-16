import { pineconeIndex, queryPinecone, BOOK_REVIEW_NAMESPACE } from '@/lib/pinecone';
import OpenAI from 'openai';

// Lightweight stopwords for lexical reranking
const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','else','for','to','of','in','on','at','by','with','from','as','is','are','was','were','be','been','being','it','its','that','this','those','these','about','into','over','under','between','than','so','such'
]);

// Initialize OpenAI client for embeddings
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Constants
export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL_ID || 'text-embedding-3-small';

// Tunables via env with sensible defaults
const TOP_K = Number.parseInt(process.env.RAG_TOP_K || '', 10) || 8;
const MIN_SCORE = Number(process.env.RAG_MIN_SCORE || '0.65');
const ENABLE_HYDE = (process.env.RAG_ENABLE_HYDE ?? 'true').toLowerCase() === 'true';
const HYDE_VARIANTS = Number.parseInt(process.env.RAG_HYDE_VARIANTS || '', 10) || 2;
const MAX_CONTEXT_CHARS = Number.parseInt(process.env.RAG_MAX_CONTEXT_CHARS || '', 10) || 8000;
const MAX_SNIPPET_CHARS = Number.parseInt(process.env.RAG_MAX_SNIPPET_CHARS || '', 10) || 900;
const ENABLE_RERANK = (process.env.RAG_RERANK ?? 'true').toLowerCase() === 'true';
const ONLY_FULL_REVIEW = (process.env.RAG_ONLY_FULL_REVIEW ?? 'true').toLowerCase() === 'true';

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
function buildPineconeFilter(filters: Record<string, unknown>, options?: { excludeTitle?: string }): Record<string, unknown> | undefined {
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

  if (filters.sensuality && typeof filters.sensuality === 'string') {
    const mapped = mapSensuality(filters.sensuality);
    f.sensuality = { $eq: mapped };
  }

  // We no longer use hardcoded subgenre mappings - rely on vector similarity instead

  // Exclude a specific title if requested (e.g., "similar to X" queries)
  if (options?.excludeTitle && typeof options.excludeTitle === 'string') {
    // Build a simple AND filter
    if (Object.keys(f).length > 0) {
      f.$and = [f, { bookTitle: { $ne: options.excludeTitle } }];
    } else {
      f.bookTitle = { $ne: options.excludeTitle };
    }
  }

  if (ONLY_FULL_REVIEW) {
    // Prefer selecting only full_review chunks to keep context clean
    if (Object.keys(f).length > 0) {
      f.$and = [f, { chunkType: { $eq: 'full_review' } }];
    } else {
      f.chunkType = { $eq: 'full_review' };
    }
  }

  // Return undefined if no filters were added
  return Object.keys(f).length > 0 ? f : undefined;
}

/**
 * Retrieves relevant context from Pinecone based on query and filters
 */
export async function getContext(
  query: string, 
  filters: Record<string, unknown> = {},
  similarToTitle?: string,
  options?: { queryType?: string }
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
    let pineconeFilter = buildPineconeFilter(filters, { excludeTitle: typeof similarToTitle === 'string' ? similarToTitle : undefined });
    if (pineconeFilter) {
      console.log('[getContext] Using filter:', JSON.stringify(pineconeFilter, null, 2));
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

    // 3b. Optional HYDE/query expansion if results are weak
    const uniqueTitlesInitial = new Set((matches || []).map(m => (m.metadata as any)?.bookTitle).filter(Boolean));
    const lowConfidence = matches.length === 0 || (matches[0]?.score ?? 0) < MIN_SCORE || uniqueTitlesInitial.size < 2;
    if (ENABLE_HYDE && lowConfidence) {
      console.log('[getContext] Low-confidence results detected. Generating query expansions...');
      const expansions = await safeGenerateQueryExpansions(query, HYDE_VARIANTS);
      for (const alt of expansions) {
        try {
          const v = await embedText(alt);
          const r = await queryPinecone({ vector: v, topK: TOP_K, namespace: BOOK_REVIEW_NAMESPACE });
          matches = [...matches, ...(r.matches || [])];
        } catch (e) {
          console.warn('[getContext] Expansion query failed:', e);
        }
      }
    }
    
    if (matches.length === 0) {
      return '';
    }
    
    // 4. Process results with deduplication + (optional) reranking
    const seenBooks = new Set<string>();
    const contextEntries: string[] = [];
    const bookContextMap: Record<string, string[]> = {}; // Group context by book title for comparisons

    // Merge duplicates per title with best score
    const bestByTitle = new Map<string, typeof matches[number]>();
    for (const m of matches) {
      const meta = m.metadata as Record<string, unknown> | undefined;
      const title = meta?.bookTitle as string | undefined;
      if (!title) continue;
      const prev = bestByTitle.get(title);
      if (!prev || ((m.score ?? 0) > (prev.score ?? 0))) {
        bestByTitle.set(title, m);
      }
    }

    let ranked: typeof matches = Array.from(bestByTitle.values());
    if (ENABLE_RERANK) {
      ranked = rerankByHeuristics(query, ranked);
    } else {
      ranked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }
    
    for (const match of ranked) {
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
      let text = meta.text as string | undefined;
      const grade = meta.grade as string | undefined;

      // Skip if missing essential info
      if (!title || !text) continue;

      // Truncate overly long snippets to keep context dense and diverse
      if (text.length > MAX_SNIPPET_CHARS) {
        text = `${text.substring(0, MAX_SNIPPET_CHARS - 3)}...`;
      }
      
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
    
    // 5. Concatenate context with clear separation and respect a soft size cap
    let combined = contextEntries.length > 0
      ? `${generateContextSummary(contextEntries, isComparisonQuery)}\n\n${contextEntries.join('\n\n---\n\n')}`
      : '';

    if (combined.length > MAX_CONTEXT_CHARS) {
      console.log(`[getContext] Trimming context from ${combined.length} to ${MAX_CONTEXT_CHARS} chars`);
      combined = combined.slice(0, MAX_CONTEXT_CHARS);
    }
    
    console.log(`[getContext] Final context includes ${seenBooks.size} unique books, ${combined.length} chars`);
    
    return combined;
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

/**
 * Generate compact query expansions (HYDE-style) to improve recall.
 */
async function safeGenerateQueryExpansions(query: string, n: number): Promise<string[]> {
  try {
    const response = await openaiClient.chat.completions.create({
      model: process.env.OPENAI_MODEL_ID || 'gpt-4-turbo',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'You generate 1-2 short alternative search queries for romance book review retrieval. Keep each under 12 words and vary subgenres/tropes phrasing. Return JSON {"queries": string[]}.',
        },
        { role: 'user', content: `Create ${n} diverse alternatives for: ${query}` },
      ],
      response_format: { type: 'json_object' },
    });
    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return [];
    const parsed = JSON.parse(content) as { queries?: string[] };
    const list = Array.isArray(parsed.queries) ? parsed.queries : [];
    return list.filter((q) => typeof q === 'string' && q.length > 0).slice(0, n);
  } catch (e) {
    console.warn('[getContext] Query expansion generation failed:', e);
    return [];
  }
}

/**
 * Heuristic reranking: combine vector score, lexical overlap, and grade preference.
 */
function rerankByHeuristics(query: string, matches: any[]): any[] {
  const qTokens = tokenize(query);
  const scored = matches.map((m) => {
    const meta = (m.metadata || {}) as Record<string, unknown>;
    const text = String(meta.text || '');
    const reviewTags = Array.isArray(meta.reviewTags) ? (meta.reviewTags as string[]).join(' ') : '';
    const bookTypes = Array.isArray(meta.bookTypes) ? (meta.bookTypes as string[]).join(' ') : '';
    const sensuality = typeof meta.sensuality === 'string' ? String(meta.sensuality) : '';
    const docTokens = tokenize(`${text} ${reviewTags} ${bookTypes} sensuality:${sensuality}`);
    const grade = typeof meta.grade === 'string' ? meta.grade : undefined;
    const lex = lexicalOverlap(qTokens, docTokens);
    const gradeScore = gradeToScore(grade);
    const v = typeof m.score === 'number' ? m.score : 0;
    // Weighted combination; keep vector score primary
    const combined = 0.78 * v + 0.17 * lex + 0.05 * gradeScore;
    return { m, combined };
  });
  scored.sort((a, b) => b.combined - a.combined);
  return scored.map((s) => s.m);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

function lexicalOverlap(qTokens: string[], dTokens: string[]): number {
  if (qTokens.length === 0 || dTokens.length === 0) return 0;
  const dSet = new Set(dTokens);
  let overlap = 0;
  for (const t of qTokens) if (dSet.has(t)) overlap++;
  return overlap / qTokens.length; // 0..1
}

function gradeToScore(grade?: string): number {
  if (!grade) return 0;
  const order = ['A+','A','A-','B+','B','B-','C+','C','C-','D','F'];
  const idx = order.indexOf(grade.toUpperCase());
  if (idx === -1) return 0;
  return (order.length - 1 - idx) / (order.length - 1); // 1 for A+, 0 for F
}

function mapSensuality(val: string): string {
  const v = val.toLowerCase();
  if (/(closed door|fade|no spice|clean|kisses)/.test(v)) return 'Kisses';
  if (/(subtle|low heat|sweet)/.test(v)) return 'Subtle';
  if (/(warm|medium|some spice)/.test(v)) return 'Warm';
  if (/(hot|spicy|steam|steamy|explicit|burning)/.test(v)) return 'Hot';
  return val;
}
