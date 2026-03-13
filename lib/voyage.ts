const VOYAGE_API_URL = 'https://api.voyageai.com/v1';
const EMBED_MODEL = 'voyage-3.5';
const RERANK_MODEL = 'rerank-2.5';
const EMBED_DIMENSION = 512;
const BATCH_SIZE = 40;

if (!process.env.VOYAGE_API_KEY) {
  throw new Error('VOYAGE_API_KEY environment variable is not set');
}

const apiKey = process.env.VOYAGE_API_KEY;

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

export interface RerankResult {
  index: number;
  relevance_score: number;
  document: string;
}

/**
 * Embed multiple texts in batches with timing instrumentation.
 */
export async function embedTexts(
  texts: string[],
  inputType: 'query' | 'document' = 'document'
): Promise<number[][]> {
  const allEmbeddings: number[][] = [];
  const start = performance.now();

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchStart = performance.now();

    const res = await fetch(`${VOYAGE_API_URL}/embeddings`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: batch,
        input_type: inputType,
        output_dimension: EMBED_DIMENSION,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Voyage embed error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
      data: { embedding: number[]; index: number }[];
    };

    // Sort by index to preserve order
    const sorted = data.data.sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      allEmbeddings.push(item.embedding);
    }

    const batchMs = (performance.now() - batchStart).toFixed(0);
    console.log(
      `[Voyage] Embedded batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(texts.length / BATCH_SIZE)} (${batch.length} texts) in ${batchMs}ms`
    );
  }

  const totalMs = (performance.now() - start).toFixed(0);
  console.log(`[Voyage] Embedded ${texts.length} texts total in ${totalMs}ms`);
  return allEmbeddings;
}

/**
 * Embed a single query text.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const start = performance.now();

  const res = await fetch(`${VOYAGE_API_URL}/embeddings`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: [text],
      input_type: 'query',
      output_dimension: EMBED_DIMENSION,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Voyage embed error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    data: { embedding: number[] }[];
  };

  const ms = (performance.now() - start).toFixed(0);
  console.log(`[Voyage] Embedded query in ${ms}ms`);
  return data.data[0].embedding;
}

/**
 * Rerank documents using Voyage reranker.
 * Returns results sorted by relevance_score descending.
 */
export async function rerankDocuments(
  query: string,
  documents: string[],
  topK = 10
): Promise<RerankResult[]> {
  if (documents.length === 0) return [];

  const start = performance.now();

  const res = await fetch(`${VOYAGE_API_URL}/rerank`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: RERANK_MODEL,
      query,
      documents,
      top_k: Math.min(topK, documents.length),
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Voyage rerank error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    data: { index: number; relevance_score: number }[];
  };

  const results: RerankResult[] = data.data.map((item) => ({
    index: item.index,
    relevance_score: item.relevance_score,
    document: documents[item.index],
  }));

  // Sort by relevance descending
  results.sort((a, b) => b.relevance_score - a.relevance_score);

  const ms = (performance.now() - start).toFixed(0);
  console.log(
    `[Voyage] Reranked ${documents.length} docs → top ${results.length} in ${ms}ms (best: ${results[0]?.relevance_score.toFixed(3)})`
  );

  return results;
}

export { EMBED_MODEL, EMBED_DIMENSION };
