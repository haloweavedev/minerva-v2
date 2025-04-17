import { tool } from 'ai';
import { z } from 'zod';
import { bookCardArraySchema } from '../schemas';

export const displayBookCardsTool = tool({
  description: "Display one or more book cards in the UI based on the provided book details found in the context. Use this when the user asks for book details, recommendations, or comparisons where specific books from the context are mentioned.",
  parameters: z.object({
    books: bookCardArraySchema.describe("An array of book card objects to display.")
  }),
  execute: async ({ books }) => {
    // More detailed debugging
    console.log('[Tool Execution] BOOKS ARRAY TYPE:', typeof books, 'Is Array:', Array.isArray(books));
    console.log(`[Tool Execution] AI requested to display ${books.length} book card(s). Data:`, JSON.stringify(books, null, 2));
    
    // Add additional validation/logging
    try {
      // Check each book object for required fields
      books.forEach((book, index) => {
        console.log(`[Tool Execution] Book ${index + 1}:`, 
          `title="${book.title}", ` +
          `author="${book.author}", ` + 
          `grade=${book.grade}, ` +
          `sensuality=${book.sensuality}, ` +
          `types=${book.bookTypes ? JSON.stringify(book.bookTypes) : 'null'}`
        );
      });
    } catch (e) {
      console.error('[Tool Execution] Error inspecting books array:', e);
    }
    
    // Return the books in the same structure expected by parameters
    // This creates a consistent API shape between input and output
    // For streaming compatibility, we still need to keep this structure
    console.log('[Tool Execution] Returning books array wrapped in object');
    return books; // Vercel AI SDK will package this as { books: [...] } based on the parameters schema
  }
}); 