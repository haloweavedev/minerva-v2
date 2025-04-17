import { z } from 'zod';

export const bookCardSchema = z.object({
  title: z.string().describe("The title of the book."),
  author: z.string().describe("The author's name."),
  grade: z.string().nullable().describe("The AAR grade (e.g., A-, B+, D) or null if unavailable."),
  sensuality: z.string().nullable().describe("The AAR sensuality rating (e.g., Hot, Warm) or null if unavailable."),
  bookTypes: z.array(z.string()).optional().nullable().describe("An array of genres or book types (e.g., ['Historical Romance', 'Time Travel Romance']) or null."),
  asin: z.string().nullable().describe("The Amazon Standard Identification Number (ASIN) or null if unavailable."),
  reviewUrl: z.string().url().nullable().describe("The direct URL to the AAR review page (from metadata 'url') or null if unavailable."),
  postId: z.string().nullable().describe("The WordPress post ID for the review or null if unavailable."),
  featuredImage: z.string().url().nullable().describe("The URL for the book's featured image or null if unavailable."),
});

// Schema for an array of book cards
export const bookCardArraySchema = z.array(bookCardSchema); 