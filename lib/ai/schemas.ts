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
  postId: z.string().optional().describe("The WordPress post ID for the review."),
  featuredImage: z.string().url().optional().nullable().or(z.literal('')).transform(v => v || null)
    .describe("URL to a featured image for the book (empty or null if unavailable)."),
  reviewTags: z.array(z.string()).optional().describe("Tags from the review content."),
  sensuality: z.string().optional().describe("Sensuality rating from the review."),
  postDate: z.coerce.string().optional().describe("Date when the review was posted."),
  publishDate: z.coerce.string().optional().describe("Date when the book was published.")
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
  tags: z.array(z.string()).optional().describe("Specific romance tropes or themes to filter by"),
  sensuality: z.string().optional().describe("Desired sensuality level, e.g., 'Kisses', 'Subtle', 'Warm', 'Hot'"),
  bookTypes: z.union([z.string(), z.array(z.string())]).optional().describe("Desired book type(s), e.g., 'Regency Romance', 'Contemporary Romance'"),
  reviewedAfter: z.string().optional().describe("ISO date string — only include reviews posted on or after this date (e.g., '2025-12-01' for December 2025)"),
  reviewedBefore: z.string().optional().describe("ISO date string — only include reviews posted before this date (e.g., '2026-01-01' for up to end of December 2025)")
});

// Type exports for TypeScript
export type Book = z.infer<typeof BookSchema>;
export type BookList = z.infer<typeof BookListSchema>;
export type RecommendationQuery = z.infer<typeof RecommendationQuerySchema>; 
