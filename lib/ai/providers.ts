// lib/ai/providers.ts
import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const providerName = process.env.AI_PROVIDER?.toLowerCase();

// Explicitly type the languageModel
const languageModel: LanguageModelV1 = (() => {
  if (providerName === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set.');
    }
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    // Use environment variable for model or default directly
    return openai(process.env.OPENAI_MODEL_ID || 'gpt-4-turbo'); // Default to gpt-4-turbo
  }

  if (providerName === 'google') {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      throw new Error('GOOGLE_GENERATIVE_AI_API_KEY environment variable is not set.');
    }
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });
     // Use environment variable for model or default directly
    return google(process.env.GOOGLE_MODEL_ID || 'gemini-1.5-pro-latest'); // Default to gemini-1.5-pro
  }

  throw new Error(
    "AI_PROVIDER environment variable not set or invalid. Set to 'openai' or 'google' in .env.local"
  );
})();

// Create embedding model using same provider but different model ID
const embeddingModel = (() => {
  if (providerName === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set.');
    }
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    // Use environment variable for embedding model
    return openai(process.env.OPENAI_EMBEDDING_MODEL_ID || 'text-embedding-3-small');
  }

  // For now, fall back to OpenAI embeddings even when using Google for LLM
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is required for embeddings.');
  }
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  return openai(process.env.OPENAI_EMBEDDING_MODEL_ID || 'text-embedding-3-small');
})();

// Export both models
export { languageModel, embeddingModel }; 