import { neon } from '@neondatabase/serverless';

if (!process.env.NEON_DATABASE_URL) {
  throw new Error('NEON_DATABASE_URL environment variable is not set');
}

const sql = neon(process.env.NEON_DATABASE_URL);

export interface BookReview {
  id: number;
  post_id: number;
  title: string;
  author_name: string;
  grade: string | null;
  sensuality: string | null;
  book_types: string[] | null;
  review_tags: string[] | null;
  publish_date: string | null;
  copyright_year: string | null;
  publisher: string | null;
  pages: string | null;
  isbn: string | null;
  asin: string | null;
  amazon_url: string | null;
  time_setting: string | null;
  locale_setting: string | null;
  series: boolean;
  cover_url: string | null;
  review_url: string | null;
  post_date: string | null;
  content: string;
  coda: string | null;
}

export interface ChunkSearchResult {
  chunk_id: number;
  review_id: number;
  chunk_index: number;
  content: string;
  similarity: number;
  // Joined review metadata
  title: string;
  author_name: string;
  grade: string | null;
  sensuality: string | null;
  book_types: string[] | null;
  review_tags: string[] | null;
  cover_url: string | null;
  review_url: string | null;
  asin: string | null;
  post_id: number;
  post_date: string | null;
  publish_date: string | null;
}

/**
 * Search for similar chunks using pgvector cosine similarity.
 * Returns top N chunks joined with their review metadata.
 */
export async function searchSimilarChunks(
  embedding: number[],
  limit = 40
): Promise<ChunkSearchResult[]> {
  const vectorStr = `[${embedding.join(',')}]`;

  const rows = await sql`
    SELECT
      c.id AS chunk_id,
      c.review_id,
      c.chunk_index,
      c.content,
      1 - (c.embedding <=> ${vectorStr}::vector) AS similarity,
      r.title,
      r.author_name,
      r.grade,
      r.sensuality,
      r.book_types,
      r.review_tags,
      r.cover_url,
      r.review_url,
      r.asin,
      r.post_id,
      r.post_date,
      r.publish_date
    FROM book_review_chunks c
    JOIN book_reviews r ON r.id = c.review_id
    ORDER BY c.embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `;

  return rows as unknown as ChunkSearchResult[];
}

/**
 * Get a full book review by its database ID.
 */
export async function getReviewById(id: number): Promise<BookReview | null> {
  const rows = await sql`
    SELECT * FROM book_reviews WHERE id = ${id}
  `;
  return (rows[0] as unknown as BookReview) ?? null;
}

/**
 * Search reviews by title (case-insensitive partial match).
 */
export async function searchByTitle(title: string): Promise<BookReview[]> {
  const rows = await sql`
    SELECT * FROM book_reviews
    WHERE LOWER(title) LIKE ${'%' + title.toLowerCase() + '%'}
    ORDER BY post_date DESC
  `;
  return rows as unknown as BookReview[];
}

/**
 * Search reviews by title and optionally author (for exact-ish matching in tool calls).
 */
export async function findReviewByTitleAuthor(
  title: string,
  author?: string
): Promise<BookReview | null> {
  if (author) {
    const rows = await sql`
      SELECT * FROM book_reviews
      WHERE LOWER(title) = ${title.toLowerCase()}
        AND LOWER(author_name) = ${author.toLowerCase()}
      LIMIT 1
    `;
    if (rows.length > 0) return rows[0] as unknown as BookReview;
  }

  // Fallback: partial title match
  const rows = await sql`
    SELECT * FROM book_reviews
    WHERE LOWER(title) LIKE ${'%' + title.toLowerCase() + '%'}
    ORDER BY post_date DESC
    LIMIT 1
  `;
  return (rows[0] as unknown as BookReview) ?? null;
}

/**
 * Insert a book review and return its ID.
 */
export async function insertReview(review: Omit<BookReview, 'id'>): Promise<number> {
  const rows = await sql`
    INSERT INTO book_reviews (
      post_id, title, author_name, grade, sensuality, book_types, review_tags,
      publish_date, copyright_year, publisher, pages, isbn, asin, amazon_url,
      time_setting, locale_setting, series, cover_url, review_url, post_date,
      content, coda
    ) VALUES (
      ${review.post_id}, ${review.title}, ${review.author_name}, ${review.grade},
      ${review.sensuality}, ${review.book_types}, ${review.review_tags},
      ${review.publish_date}, ${review.copyright_year}, ${review.publisher},
      ${review.pages}, ${review.isbn}, ${review.asin}, ${review.amazon_url},
      ${review.time_setting}, ${review.locale_setting}, ${review.series},
      ${review.cover_url}, ${review.review_url}, ${review.post_date},
      ${review.content}, ${review.coda}
    )
    ON CONFLICT (post_id) DO UPDATE SET
      title = EXCLUDED.title,
      content = EXCLUDED.content
    RETURNING id
  `;
  return (rows[0] as unknown as { id: number }).id;
}

/**
 * Insert a chunk with its embedding vector.
 */
export async function insertChunk(
  reviewId: number,
  chunkIndex: number,
  content: string,
  embedding: number[]
): Promise<void> {
  const vectorStr = `[${embedding.join(',')}]`;
  await sql`
    INSERT INTO book_review_chunks (review_id, chunk_index, content, embedding)
    VALUES (${reviewId}, ${chunkIndex}, ${content}, ${vectorStr}::vector)
  `;
}

export { sql };
