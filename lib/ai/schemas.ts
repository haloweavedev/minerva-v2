import { z } from 'zod';

// Schema for a book card recommended by the assistant
export const BookSchema = z.object({
  title: z.string().describe("The title of the book."),
  author: z.string().describe("The author's name."),
  grade: z.string().optional().describe("The AAR grade (e.g., 'A+', 'B')."),
  summary: z.string().optional().describe("A brief summary or key points from the review."),
  tags: z.array(z.string()).optional().describe("Relevant tags associated with the book."),
  bookType: z.string().optional().describe("The primary genre or book type."),
  url: z.string().url().optional().describe("The direct URL to the AAR review page."),
  coverUrl: z.string().url().optional().describe("URL to the book's cover image, if available."),
  asin: z.string().optional().describe("Amazon Standard Identification Number for the book."),
  postId: z.string().optional().describe("The WordPress post ID for the review.")
});

// Schema for an array of book cards
export const BookListSchema = z.array(BookSchema);

// Schema for book card array used by the display-book-cards tool
export const bookCardArraySchema = BookListSchema;

// Schema for detecting recommendation queries
export const RecommendationQuerySchema = z.object({
  grade: z.string().optional().describe("Filter by AAR grade (e.g. 'A+' or 'B')"),
  subgenre: z.string().optional().describe("Filter by subgenre or setting (e.g. 'medieval', 'Regency')"),
  similarTo: z.string().optional().describe("A book title the user liked to find similar recommendations"),
  keywords: z.string().optional().describe("General keywords or criteria for the recommendations"),
  tags: z.array(z.string()).optional().describe("Specific romance tropes or themes to filter by")
});

// Type exports for TypeScript
export type Book = z.infer<typeof BookSchema>;
export type BookList = z.infer<typeof BookListSchema>;
export type RecommendationQuery = z.infer<typeof RecommendationQuerySchema>; 