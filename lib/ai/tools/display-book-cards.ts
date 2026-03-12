import { tool } from 'ai';
import { z } from 'zod';
import { BookListSchema, RecommendationQuerySchema } from '../schemas';
import type { Book } from '../schemas';
import { embedQuery, rerankDocuments } from '@/lib/voyage';
import { searchSimilarChunks, findReviewByTitleAuthor } from '@/lib/db';

const DisplayBookCardsSchema = RecommendationQuerySchema.extend({
  specificTitles: z.array(z.string()).optional().describe("List of specific book titles to display (used for comparisons)")
});

export const displayBookCards = tool({
  description: 'Recommend romance novels based on the user\'s request or display specific books for comparison. Use this tool whenever the user asks for book recommendations or similar books, or to compare specific books.',
  inputSchema: DisplayBookCardsSchema,
  execute: async ({ grade, subgenre, similarTo, keywords, tags, specificTitles, sensuality, bookTypes }) => {
    console.log('[Tool: displayBookCards] Params:', { grade, subgenre, similarTo, keywords, tags, specificTitles, sensuality, bookTypes });

    // --- Handle specific book title display ---
    if (specificTitles && specificTitles.length > 0) {
      console.log(`[Tool: displayBookCards] Fetching specific titles: ${specificTitles.join(', ')}`);
      const books: Book[] = [];

      for (const title of specificTitles) {
        try {
          const review = await findReviewByTitleAuthor(title);
          if (review) {
            books.push(reviewToBook(review));
          } else {
            // Fallback: try vector search
            const embedding = await embedQuery(title);
            const chunks = await searchSimilarChunks(embedding, 5);
            if (chunks.length > 0) {
              const best = chunks[0];
              books.push(chunkToBook(best));
            }
          }
        } catch (error) {
          console.error(`[Tool: displayBookCards] Error fetching "${title}":`, error);
        }
      }

      console.log(`[Tool: displayBookCards] Found ${books.length} specific books`);
      return BookListSchema.parse(books);
    }

    // --- Recommendation flow ---
    // Build semantic search query
    let searchQuery = '';
    if (similarTo) {
      searchQuery = `books similar to ${similarTo}`;
    } else if (subgenre) {
      searchQuery = `${normalizeSubgenre(subgenre)} romance`;
    }
    if (keywords) searchQuery += ` ${keywords}`;
    if (tags && tags.length > 0) searchQuery += ` ${tags.join(' ')}`;
    if (Array.isArray(bookTypes)) {
      searchQuery += ` ${bookTypes.join(' ')}`;
    } else if (typeof bookTypes === 'string') {
      searchQuery += ` ${bookTypes}`;
    }
    if (sensuality) searchQuery += ` sensuality:${mapSensuality(sensuality)}`;
    if (grade && !searchQuery) searchQuery = `top rated ${grade} romance books`;
    if (!searchQuery) searchQuery = 'romance books';

    console.log(`[Tool: displayBookCards] Search query: "${searchQuery}"`);

    // Embed & search pgvector
    const embedding = await embedQuery(searchQuery.trim());
    const chunks = await searchSimilarChunks(embedding, 30);

    if (chunks.length === 0) {
      console.log('[Tool: displayBookCards] No results found');
      return BookListSchema.parse([]);
    }

    // Deduplicate by review_id
    const seenReviews = new Set<number>();
    const uniqueChunks = chunks.filter((c) => {
      if (seenReviews.has(c.review_id)) return false;
      seenReviews.add(c.review_id);
      return true;
    });

    // Apply grade filter if specified
    let filtered = uniqueChunks;
    if (grade) {
      filtered = uniqueChunks.filter((c) => c.grade?.toUpperCase() === grade.toUpperCase());
      if (filtered.length === 0) filtered = uniqueChunks; // Fallback to all if no grade match
    }

    // Exclude reference book for "similar to" queries
    if (similarTo) {
      filtered = filtered.filter(
        (c) => !c.title.toLowerCase().includes(similarTo.toLowerCase())
      );
    }

    // Rerank with Voyage
    const documents = filtered.map((c) => c.content);
    const reranked = await rerankDocuments(searchQuery, documents, 8);

    // Build book results from reranked
    const books: Book[] = [];
    for (const result of reranked) {
      if (result.relevance_score < 0.3) continue;
      const chunk = filtered[result.index];
      books.push(chunkToBook(chunk));
      if (books.length >= 6) break;
    }

    console.log(`[Tool: displayBookCards] Returning ${books.length} books`);
    return BookListSchema.parse(books);
  }
});

export const displayBookCardsTool = displayBookCards;

// --- Helpers ---

function reviewToBook(review: import('@/lib/db').BookReview): Book {
  const summary = review.content.length > 360
    ? `${review.content.substring(0, 357)}...`
    : review.content;

  return {
    title: review.title,
    author: review.author_name,
    grade: review.grade ?? undefined,
    summary,
    tags: review.review_tags ?? [],
    bookType: review.book_types?.[0] ?? undefined,
    url: review.review_url ?? undefined,
    coverUrl: review.cover_url ?? undefined,
    asin: review.asin ?? undefined,
    postId: String(review.post_id),
    featuredImage: review.cover_url ?? null,
    reviewTags: review.review_tags ?? undefined,
    sensuality: review.sensuality ?? undefined,
    postDate: review.post_date ?? undefined,
    publishDate: review.publish_date ?? undefined,
  };
}

function chunkToBook(chunk: import('@/lib/db').ChunkSearchResult): Book {
  const summary = chunk.content.length > 360
    ? `${chunk.content.substring(0, 357)}...`
    : chunk.content;

  return {
    title: chunk.title,
    author: chunk.author_name,
    grade: chunk.grade ?? undefined,
    summary,
    tags: chunk.review_tags ?? [],
    bookType: chunk.book_types?.[0] ?? undefined,
    url: chunk.review_url ?? undefined,
    coverUrl: chunk.cover_url ?? undefined,
    asin: chunk.asin ?? undefined,
    postId: String(chunk.post_id),
    featuredImage: chunk.cover_url ?? null,
    reviewTags: chunk.review_tags ?? undefined,
    sensuality: chunk.sensuality ?? undefined,
    postDate: chunk.post_date ?? undefined,
    publishDate: chunk.publish_date ?? undefined,
  };
}

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
