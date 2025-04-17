# Minerva - Romance Book Review Chatbot

A RAG-powered chatbot for [All About Romance](https://allaboutromance.com/) website that provides intelligent, context-based responses about romance book reviews. Minerva uses Pinecone for vector storage, OpenAI Embeddings, and a fully customizable UI with Book Card components.

## Features

- **RAG Integration**: Retrieves relevant context from Pinecone vector database based on user queries
- **Book Cards**: Displays formatted book recommendations with metadata (grade, sensuality, cover image, etc.)
- **Multi-Provider Support**: Works with both OpenAI and Google Generative AI
- **Responsive Design**: Fully mobile-responsive chat interface

## Environment Setup

Create a `.env.local` file with the following variables:

```bash
# Chat Provider ('openai' or 'google')
AI_PROVIDER=openai # Or google

# Keys for Chat Provider
OPENAI_API_KEY=sk-...
GOOGLE_GENERATIVE_AI_API_KEY=AIza...

# Key for Embeddings (ALWAYS OpenAI for this setup)
# OPENAI_API_KEY=sk-... # Already listed above

# Pinecone Credentials
PINECONE_API_KEY=YOUR_PINECONE_API_KEY
PINECONE_INDEX_NAME=YOUR_PINECONE_INDEX_NAME # e.g., minerva
# PINECONE_INDEX_HOST=YOUR_PINECONE_INDEX_HOST # If using host URL
# PINECONE_ENVIRONMENT=YOUR_PINECONE_ENVIRONMENT # If using environment name

# Models
OPENAI_EMBEDDING_MODEL_ID=text-embedding-3-small
# Optional: Override default chat models
# OPENAI_MODEL_ID=gpt-4-turbo
# GOOGLE_MODEL_ID=gemini-1.5-pro-latest
```

## Getting Started

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Run the development server:
   ```bash
   pnpm dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) in your browser

## How It Works

1. **RAG Process**:
   - User query is converted to an embedding using OpenAI's `text-embedding-3-small`
   - Pinecone searches for semantically similar content in the book reviews
   - Relevant context is retrieved and sent to the LLM along with the user query

2. **Book Card Display**:
   - When the AI mentions specific books from the context, it calls the `displayBookCardsTool`
   - The tool passes structured book metadata to the frontend
   - Custom `<BookCard>` components render with book details, cover images, and links

## Customization

- **System Prompt**: Edit `lib/ai/prompts.ts` to modify AI behavior
- **Book Card Schema**: Update `lib/ai/schemas.ts` to change the metadata structure
- **UI Components**: Modify files in `/components` to customize the appearance

## Note on Vector Database

This project assumes you already have a Pinecone index populated with romance book review content. The vector database should contain:
- Book review text
- Book metadata (title, author, grade, sensuality, etc.)
- Review URLs and image links

## License

This project is licensed under the MIT License - see the LICENSE file for details.
