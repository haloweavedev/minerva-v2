import { tool } from 'ai';
import { z } from 'zod';
import { BookListSchema, RecommendationQuerySchema } from '../schemas';
import { queryPinecone, BOOK_REVIEW_NAMESPACE } from '@/lib/pinecone';
import { embedText } from '@/utils/getContext';

// Extend the recommendation schema to support direct book title specification
const DisplayBookCardsSchema = RecommendationQuerySchema.extend({
  specificTitles: z.array(z.string()).optional().describe("List of specific book titles to display (used for comparisons)")
});

export const displayBookCards = tool({
  description: 'Recommend romance novels based on the user\'s request or display specific books for comparison. Use this tool whenever the user asks for book recommendations or similar books, or to compare specific books.',
  parameters: DisplayBookCardsSchema,
  execute: async ({ grade, subgenre, similarTo, keywords, tags, specificTitles }) => {
    console.log('[Tool Execute: displayBookCards] Executing with parameters:', 
      { grade, subgenre, similarTo, keywords, tags, specificTitles });
    
    // Handle specific book title display (for comparisons)
    if (specificTitles && specificTitles.length > 0) {
      console.log(`[Tool Execute: displayBookCards] Displaying specific titles: ${specificTitles.join(', ')}`);
      
      const books = [];
      
      // Get metadata for each specific title
      for (const title of specificTitles) {
        try {
          // Query Pinecone with exact title match filter
          const pineconeResponse = await queryPinecone({
            vector: await embedText(title), // Use title as query for best match
            filter: { bookTitle: { $eq: title } },
            topK: 3, // Get a few matches in case of slight title variations
            namespace: BOOK_REVIEW_NAMESPACE
          });
          
          // Process the first match if found
          const match = pineconeResponse.matches?.[0];
          
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
              const summary = text.length > 300 
                ? `${text.substring(0, 297)}...` 
                : text;
              
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
                postId: meta.postId as string | undefined
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
    // Build a query string for embedding
    let searchQuery = '';
    if (similarTo) {
      searchQuery = `books similar to ${similarTo}`;
    } else if (subgenre) {
      searchQuery = `${subgenre} romance`;
    }
    if (keywords) {
      searchQuery += ` ${keywords}`;
    }
    if (tags && tags.length > 0) {
      searchQuery += ` ${tags.join(' ')}`;
    }
    if (grade && !searchQuery) {
      searchQuery = `top rated ${grade} romance books`;
    }
    if (!searchQuery) {
      searchQuery = 'romance books'; // fallback generic query
    }
    
    console.log(`[Tool Execute: displayBookCards] Search query: "${searchQuery}"`);
    
    try {
      // Get embedding for the search query
      const vector = await embedText(searchQuery);
      
      // Build Pinecone filter
      const filter: Record<string, unknown> = {};
      if (grade) filter.grade = { $eq: grade };

      // Initialize the $or array if needed for multiple conditions
      const orConditions = [];
      
      if (subgenre) {
        // Check in both bookTypes array and reviewTags
        orConditions.push(
          { bookTypes: { $in: [subgenre] } },
          { reviewTags: { $in: [subgenre] } }
        );
      }
      
      // Add tag filtering if provided
      if (tags && tags.length > 0) {
        // Check in reviewTags array for any of the specified tags
        orConditions.push(
          { reviewTags: { $in: tags } }
        );
      }
      
      // If we have OR conditions, add them to the filter
      if (orConditions.length > 0) {
        filter.$or = orConditions;
      }
      
      if (similarTo) {
        // Exclude the reference book from results
        filter.bookTitle = { $ne: similarTo };
      }
      
      // Query Pinecone for recommendations
      const pineconeResponse = await queryPinecone({
        vector,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        topK: 10, // Request more to account for filtering
        namespace: BOOK_REVIEW_NAMESPACE
      });
      
      // Process results into structured book info
      const seenTitles = new Set<string>();
      const recommendations = [];
      
      for (const match of pineconeResponse.matches || []) {
        const meta = match.metadata as Record<string, unknown> | undefined;
        if (!meta || !meta.bookTitle || typeof meta.bookTitle !== 'string') continue;
        
        const title = meta.bookTitle as string;
        
        // Skip duplicates
        if (seenTitles.has(title)) continue;
        seenTitles.add(title);
        
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
        const summary = text.length > 300 
          ? `${text.substring(0, 297)}...` 
          : text;
        
        // Extract additional metadata fields for book cards
        const asin = meta.asin as string | undefined;
        const postId = meta.postId as string | undefined;
        
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
          postId
        });
        
        // Limit to 5 books max
        if (recommendations.length >= 5) break;
      }
      
      console.log(`[Tool Execute: displayBookCards] Found ${recommendations.length} book recommendations`);
      
      // Validate against schema before returning
      return BookListSchema.parse(recommendations);
    } catch (error) {
      console.error('[Tool Execute: displayBookCards] Error:', error);
      // Return empty array on error
      return [];
    }
  }
});

// Export for backwards compatibility with existing code
export const displayBookCardsTool = displayBookCards; 