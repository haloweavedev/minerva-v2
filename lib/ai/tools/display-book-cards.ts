import { tool } from 'ai';
import { z } from 'zod';
import { BookListSchema, RecommendationQuerySchema } from '../schemas';
import type { Book } from '../schemas';
import { queryPinecone, BOOK_REVIEW_NAMESPACE } from '@/lib/pinecone';
import { embedText } from '@/utils/getContext';

// Extend the recommendation schema to support direct book title specification
const DisplayBookCardsSchema = RecommendationQuerySchema.extend({
  specificTitles: z.array(z.string()).optional().describe("List of specific book titles to display (used for comparisons)")
});

export const displayBookCards = tool({
  description: 'Recommend romance novels based on the user\'s request or display specific books for comparison. Use this tool whenever the user asks for book recommendations or similar books, or to compare specific books.',
  parameters: DisplayBookCardsSchema,
  execute: async ({ grade, subgenre, similarTo, keywords, tags, specificTitles, sensuality, bookTypes }) => {
    console.log('[Tool Execute: displayBookCards] Executing with parameters:', 
      { grade, subgenre, similarTo, keywords, tags, specificTitles, sensuality, bookTypes });
    
    // Handle specific book title display (for comparisons)
    if (specificTitles && specificTitles.length > 0) {
      console.log(`[Tool Execute: displayBookCards] Displaying specific titles: ${specificTitles.join(', ')}`);
      
      const books: Book[] = [];
      
      // Get metadata for each specific title
      for (const title of specificTitles) {
        try {
          // First try exact title match filter
          const pineconeResponse = await queryPinecone({
            vector: await embedText(title),
            filter: { bookTitle: { $eq: title } },
            topK: 5,
            namespace: BOOK_REVIEW_NAMESPACE
          });
          
          let match = pineconeResponse.matches?.[0];

          // Fallback: try without filter if exact match not found
          if (!match) {
            console.log(`[Tool Execute: displayBookCards] Exact match not found for "${title}". Trying semantic only.`);
            const semanticOnly = await queryPinecone({
              vector: await embedText(title),
              topK: 5,
              namespace: BOOK_REVIEW_NAMESPACE
            });
            match = semanticOnly.matches?.[0];
          }
          
          if (match) {
            const meta = match.metadata as Record<string, unknown> | undefined;
            if (meta?.bookTitle && typeof meta.bookTitle === 'string') {
              // Extract other metadata
              const author = meta.authorName as string || "Unknown Author";
              const grade = meta.grade as string | undefined;
              const bookType = Array.isArray(meta.bookTypes) && meta.bookTypes.length > 0 
                ? meta.bookTypes[0] as string 
                : undefined;
              
              const tags = Array.isArray(meta.reviewTags) 
                ? meta.reviewTags as string[] 
                : [];
              
              // Generate a summary from the text
              const text = meta.text as string || "";
              const summary = text.length > 360 
                ? `${text.substring(0, 357)}...` 
                : text;
              
              // Extract additional metadata fields
              const _featuredImage = meta.featuredImage as string | undefined;
              const featuredImage = _featuredImage && _featuredImage.length > 0 ? _featuredImage : null;
              const reviewTags = Array.isArray(meta.reviewTags) ? meta.reviewTags as string[] : undefined;
              const sensuality = meta.sensuality as string | undefined;
              const postDate = meta.postDate as string | undefined;
              const publishDate = meta.publishDate as string | undefined;
              
              // Add to results
              books.push({
                title: meta.bookTitle as string,
                author,
                grade,
                summary,
                tags,
                bookType,
                url: meta.url as string | undefined,
                coverUrl: meta.coverUrl as string | undefined,
                asin: meta.asin as string | undefined,
                postId: meta.postId as string | undefined,
                featuredImage,
                reviewTags,
                sensuality,
                postDate,
                publishDate
              });
            }
          }
        } catch (error) {
          console.error(`[Tool Execute: displayBookCards] Error fetching book "${title}":`, error);
        }
      }
      
      console.log(`[Tool Execute: displayBookCards] Found ${books.length} specific books`);
      
      // Return the books even if we didn't find all of them
      return BookListSchema.parse(books);
    }
    
    // Continue with normal recommendation logic
    // Build Pinecone filter
    const filter: Record<string, unknown> = {};
    
    // 1. Grade‐only hard filter
    if (grade) {
      filter.grade = { $eq: grade };
    }

    // 2. Build a semantic search query
    let searchQuery = '';
    if (similarTo) {
      searchQuery = `books similar to ${similarTo}`;
    } else if (subgenre) {
      const normalized = normalizeSubgenre(subgenre);
      searchQuery = `${normalized} romance`;
    }
    if (keywords) {
      searchQuery += ` ${keywords}`;
    }
    if (tags && tags.length > 0) {
      searchQuery += ` ${tags.join(' ')}`;
    }
    if (Array.isArray(bookTypes)) {
      searchQuery += ` ${bookTypes.join(' ')}`;
    } else if (typeof bookTypes === 'string') {
      searchQuery += ` ${bookTypes}`;
    }
    if (sensuality) {
      searchQuery += ` sensuality:${mapSensuality(sensuality)}`;
    }
    if (grade && !searchQuery) {
      searchQuery = `top rated ${grade} romance books`;
    }
    if (!searchQuery) {
      searchQuery = 'romance books';
    }
    
    console.log(`[Tool Execute: displayBookCards] Search query: "${searchQuery}"`);
    
    // 3. Exclude the reference book if needed
    if (similarTo) {
      filter.bookTitle = { $ne: similarTo };
    }
    
    // 4. Embed & query
    const vector = await embedText(searchQuery);
    const pineconeResponse = await queryPinecone({
      vector,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      topK: 15, // Request more to account for filtering and reranking
      namespace: BOOK_REVIEW_NAMESPACE
    });
    
    // Process results into structured book info
    const seenTitles = new Set<string>();
    const seenPosts = new Set<string>();
    type Rec = {
      title: string;
      author?: string;
      grade?: string;
      summary?: string;
      tags?: string[];
      bookType?: string;
      url?: string;
      coverUrl?: string;
      asin?: string;
      postId?: string;
      featuredImage?: string | null;
      reviewTags?: string[];
      sensuality?: string;
      postDate?: string;
      publishDate?: string;
      __score?: number;
    };
    const recommendations: Rec[] = [];
    
    for (const match of pineconeResponse.matches || []) {
      const meta = match.metadata as Record<string, unknown> | undefined;
      if (!meta || !meta.bookTitle || typeof meta.bookTitle !== 'string') continue;
      
      const title = meta.bookTitle as string;
      
      // Skip duplicates
      const postId = (meta.postId as string | undefined) || '';
      if (seenTitles.has(title) || (postId && seenPosts.has(postId))) continue;
      seenTitles.add(title);
      if (postId) seenPosts.add(postId);
      
      // Extract other metadata
      const author = meta.authorName as string || "Unknown Author";
      const grade = meta.grade as string | undefined;
      const bookType = Array.isArray(meta.bookTypes) && meta.bookTypes.length > 0 
        ? meta.bookTypes[0] as string 
        : undefined;
      
      // Extract tags if available
      const tags = Array.isArray(meta.reviewTags) 
        ? meta.reviewTags as string[] 
        : [];
      
      // Generate a summary from the text
      const text = meta.text as string || "";
      const summary = text.length > 360 
        ? `${text.substring(0, 357)}...` 
        : text;
      
      // Extract additional metadata fields for book cards
      const asin = meta.asin as string | undefined;
      // postId already extracted above
      const _featuredImage = meta.featuredImage as string | undefined;
      const featuredImage = _featuredImage && _featuredImage.length > 0 ? _featuredImage : null;
      const reviewTags = Array.isArray(meta.reviewTags) ? meta.reviewTags as string[] : undefined;
      const sensuality = meta.sensuality as string | undefined;
      const postDate = meta.postDate as string | undefined;
      const publishDate = meta.publishDate as string | undefined;
      
      // Create book card
      recommendations.push({
        title,
        author,
        grade,
        summary,
        tags,
        bookType,
        url: meta.url as string | undefined,
        coverUrl: meta.coverUrl as string | undefined,
        asin,
        postId,
        featuredImage,
        reviewTags,
        sensuality,
        postDate,
        publishDate,
        __score: typeof match.score === 'number' ? match.score : 0
      });
      
      // Limit to 5 books max
      if (recommendations.length >= 10) break;
    }
    
    console.log(`[Tool Execute: displayBookCards] Found ${recommendations.length} raw recommendations`);

    // Rerank by vector score + AAR grade + query alignment (tags/subgenre/sensuality)
    const askedTags = (tags || []).map((t) => t.toLowerCase());
    const normalizedSub = subgenre ? normalizeSubgenre(subgenre) : undefined;
    const desiredHeat = sensuality ? mapSensuality(sensuality) : undefined;
    const ranked = recommendations
      .map((r) => {
        const rTags = (r.reviewTags || []).map((t) => t.toLowerCase());
        const tagOverlap = askedTags.length > 0 ? overlapRatio(askedTags, rTags) : 0;
        const subMatch = normalizedSub && r.bookType ? boolToNum(r.bookType.toLowerCase().includes(normalizedSub.toLowerCase())) : 0;
        const heatMatch = desiredHeat && r.sensuality ? boolToNum(r.sensuality.toLowerCase().includes(desiredHeat.toLowerCase())) : 0;
        const align = 0.6 * tagOverlap + 0.25 * subMatch + 0.15 * heatMatch; // 0..1
        const base = 0.78 * (r.__score || 0) + 0.17 * gradeToScore(r.grade) + 0.05 * align;
        return { r, score: base };
      })
      .sort((a, b) => b.score - a.score)
      .map(({ r }) => r);

    // Final slice
    const finalRecs = ranked.slice(0, 6).map((r) => ({
      title: r.title,
      author: r.author,
      grade: r.grade,
      summary: r.summary,
      tags: r.tags,
      bookType: r.bookType,
      url: r.url,
      coverUrl: r.coverUrl,
      asin: r.asin,
      postId: r.postId,
      featuredImage: r.featuredImage,
      reviewTags: r.reviewTags,
      sensuality: r.sensuality,
      postDate: r.postDate,
      publishDate: r.publishDate,
    }));

    // Validate against schema before returning
    return BookListSchema.parse(finalRecs);
  }
});

// Export for backwards compatibility with existing code
export const displayBookCardsTool = displayBookCards;

function gradeToScore(grade?: string): number {
  if (!grade) return 0;
  const order = ['A+','A','A-','B+','B','B-','C+','C','C-','D','F'];
  const idx = order.indexOf(grade.toUpperCase());
  if (idx === -1) return 0;
  return (order.length - 1 - idx) / (order.length - 1);
}

function overlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  let count = 0;
  for (const t of a) if (bSet.has(t)) count++;
  return count / a.length;
}

function boolToNum(v: boolean): number { return v ? 1 : 0; }

function normalizeSubgenre(sub: string): string {
  const s = sub.toLowerCase();
  const map: Record<string, string> = {
    regency: 'Regency Romance',
    medieval: 'Medieval Romance',
    victorian: 'Victorian Romance',
    edwardian: 'Edwardian Romance',
    contemporary: 'Contemporary Romance',
    historical: 'Historical Romance',
    western: 'Western Romance',
    gothic: 'Gothic Romance',
    paranorm: 'Paranormal Romance',
    paranormal: 'Paranormal Romance',
    fantasy: 'Fantasy Romance',
    romcom: 'Romantic Comedy',
    'rom-com': 'Romantic Comedy',
    suspense: 'Romantic Suspense',
    mystery: 'Romantic Suspense',
    time: 'Time Travel Romance',
    'time travel': 'Time Travel Romance',
  };
  for (const k of Object.keys(map)) {
    if (s.includes(k)) return map[k];
  }
  return sub;
}

function mapSensuality(val: string): string {
  const v = val.toLowerCase();
  if (/(closed door|fade|no spice|clean|kisses)/.test(v)) return 'Kisses';
  if (/(subtle|low heat|sweet)/.test(v)) return 'Subtle';
  if (/(warm|medium|some spice)/.test(v)) return 'Warm';
  if (/(hot|spicy|steam|steamy|explicit|burning)/.test(v)) return 'Hot';
  return val;
}
