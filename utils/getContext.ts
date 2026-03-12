import { embedQuery, rerankDocuments } from '@/lib/voyage';
import { searchSimilarChunks, type ChunkSearchResult } from '@/lib/db';

const RERANK_TOP_K = 10;
const RERANK_FLOOR = 0.45;
const MAX_CONTEXT_CHARS = Number.parseInt(process.env.RAG_MAX_CONTEXT_CHARS || '', 10) || 8000;

/**
 * Retrieves relevant context from Neon pgvector + Voyage reranker.
 *
 * Pipeline:
 *   1. Embed query via Voyage
 *   2. pgvector cosine search → top 40 chunks
 *   3. Voyage rerank → top 10 (floor 0.45)
 *   4. Format as numbered sources with relevance %
 */
export async function getContext(
  query: string,
  filters: Record<string, unknown> = {},
  _similarToTitle?: string,
  options?: { queryType?: string }
): Promise<string> {
  try {
    console.log(`[getContext] Processing query: "${query}"`);

    const isComparisonQuery = Boolean(
      filters.titles && Array.isArray(filters.titles) && (filters.titles as string[]).length > 0
    );

    // 1. Build embedding input
    let embeddingInput: string;
    if (isComparisonQuery) {
      embeddingInput = (filters.titles as string[]).join(' compared to ');
    } else if (filters.title && filters.author) {
      embeddingInput = `${filters.title} by ${filters.author}`;
    } else if (filters.title) {
      embeddingInput = String(filters.title);
    } else {
      embeddingInput = query;
    }

    console.log(`[getContext] Embedding input: "${embeddingInput}"`);

    // 2. Embed via Voyage
    const embedding = await embedQuery(embeddingInput);

    // 3. pgvector cosine search
    const chunks = await searchSimilarChunks(embedding, 40);
    console.log(`[getContext] pgvector returned ${chunks.length} chunks`);

    if (chunks.length === 0) {
      console.log('[getContext] NO DOCUMENTS RETRIEVED');
      return 'NO DOCUMENTS RETRIEVED — The database returned no results for this query.';
    }

    // 4. Deduplicate by review_id, keeping best similarity per review
    const bestByReview = new Map<number, ChunkSearchResult>();
    for (const chunk of chunks) {
      const prev = bestByReview.get(chunk.review_id);
      if (!prev || chunk.similarity > prev.similarity) {
        bestByReview.set(chunk.review_id, chunk);
      }
    }

    // Collect all unique chunk texts for reranking (use full chunk content)
    const uniqueChunks = Array.from(bestByReview.values());

    // 5. Voyage rerank
    const documents = uniqueChunks.map((c) => c.content);
    const reranked = await rerankDocuments(query, documents, RERANK_TOP_K);

    // 6. Filter by relevance floor and format
    const contextEntries: string[] = [];
    const bookContextMap: Record<string, string[]> = {};
    const seenTitles = new Set<string>();

    for (const result of reranked) {
      if (result.relevance_score < RERANK_FLOOR) {
        console.log(`[getContext] Skipping chunk with relevance ${result.relevance_score.toFixed(3)} (below ${RERANK_FLOOR})`);
        continue;
      }

      const chunk = uniqueChunks[result.index];
      const relevancePct = (result.relevance_score * 100).toFixed(0);

      // Build formatted entry
      let entry = `[Source: "${chunk.title}" by ${chunk.author_name}`;
      if (chunk.grade) entry += ` | Grade: ${chunk.grade}`;
      entry += ` | Relevance: ${relevancePct}%]\n`;
      entry += chunk.content;

      if (isComparisonQuery) {
        if (!bookContextMap[chunk.title]) {
          bookContextMap[chunk.title] = [];
        }
        bookContextMap[chunk.title].push(entry);
      } else {
        if (seenTitles.has(chunk.title)) continue;
        seenTitles.add(chunk.title);
        contextEntries.push(entry);
      }
    }

    // Process comparison results
    if (isComparisonQuery) {
      for (const [title, entries] of Object.entries(bookContextMap)) {
        if (entries.length > 0 && !seenTitles.has(title)) {
          contextEntries.push(entries[0]);
          seenTitles.add(title);
        }
      }
    }

    if (contextEntries.length === 0) {
      // Fallback: use the best chunk even if below floor
      if (uniqueChunks.length > 0) {
        const best = uniqueChunks[0];
        const entry = `[Source: "${best.title}" by ${best.author_name} | Grade: ${best.grade || 'N/A'} | Relevance: ${(best.similarity * 100).toFixed(0)}% (vector)]\n${best.content}`;
        contextEntries.push(entry);
        console.log('[getContext] Using fallback chunk (below rerank floor)');
      } else {
        return 'NO DOCUMENTS RETRIEVED — No relevant results found for this query.';
      }
    }

    // 7. Build summary + numbered context
    const summary = generateContextSummary(contextEntries, isComparisonQuery);
    let combined = `${summary}\n\n${contextEntries.map((e, i) => `--- Source ${i + 1} ---\n${e}`).join('\n\n')}`;

    if (combined.length > MAX_CONTEXT_CHARS) {
      console.log(`[getContext] Trimming context from ${combined.length} to ${MAX_CONTEXT_CHARS} chars`);
      combined = combined.slice(0, MAX_CONTEXT_CHARS);
    }

    console.log(`[getContext] Final context: ${seenTitles.size} unique books, ${combined.length} chars`);
    return combined;
  } catch (error) {
    console.error('[getContext] Error:', error);
    return 'NO DOCUMENTS RETRIEVED — An error occurred during retrieval.';
  }
}

function generateContextSummary(entries: string[], isComparison = false): string {
  if (entries.length === 0) return '';

  // Extract titles from entries
  const titles = entries
    .map((e) => {
      const match = e.match(/\[Source: "([^"]+)"/);
      return match?.[1];
    })
    .filter(Boolean) as string[];

  if (isComparison && titles.length === 2) {
    return `This context includes reviews of "${titles[0]}" and "${titles[1]}" for comparison.`;
  }

  if (titles.length === 1) {
    return `This context includes a review of "${titles[0]}".`;
  }

  return `This context includes reviews of ${titles.length} books: ${titles.map((t) => `"${t}"`).join(', ')}.`;
}
