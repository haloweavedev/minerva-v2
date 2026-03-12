// lib/ai/providers.ts
import { createGroq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const providerName = (process.env.AI_PROVIDER || 'groq').toLowerCase();

const languageModel = (() => {
  if (providerName === 'groq') {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY environment variable is not set.');
    }
    const groq = createGroq({
      apiKey: process.env.GROQ_API_KEY,
    });
    return groq(process.env.GROQ_MODEL_ID || 'openai/gpt-oss-20b');
  }

  if (providerName === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set.');
    }
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    return openai(process.env.OPENAI_MODEL_ID || 'gpt-4-turbo');
  }

  if (providerName === 'google') {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      throw new Error('GOOGLE_GENERATIVE_AI_API_KEY environment variable is not set.');
    }
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });
    return google(process.env.GOOGLE_MODEL_ID || 'gemini-1.5-pro-latest');
  }

  throw new Error(
    "AI_PROVIDER environment variable not set or invalid. Set to 'groq', 'openai', or 'google' in .env.local"
  );
})();

export { languageModel };
