'use client';

import type { UIMessage } from 'ai';
import { AnimatePresence, motion } from 'framer-motion';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { SparklesIcon } from './icons';
import { Markdown } from './markdown';
import { BookCard } from './book-card';
import { bookCardSchema, bookCardArraySchema } from '@/lib/ai/schemas';
import React from 'react';

// Define props interface
interface PurePreviewMessageProps {
  message: UIMessage;
  isLoading?: boolean;
}

// Define a type for the expected structure of the tool invocation part
interface ExpectedToolInvocationPart {
  type: 'tool-invocation';
  toolInvocation: {
    state: string;
    step: number;
    toolCallId: string;
    toolName: string;
    args: unknown;
    result?: unknown;
  };
}

// Simplified version without editing, voting, artifacts, reasoning
const PurePreviewMessage = ({ message }: PurePreviewMessageProps) => {
  // NEW: Process any book card tools directly from message.toolInvocations
  const bookCards = React.useMemo(() => {
    if (!message.toolInvocations) return null;
    
    // Find all displayBookCards tool invocations
    const bookCardInvocations = message.toolInvocations.filter(
      tool => tool.toolName === 'displayBookCards' && 
              tool.args?.books && 
              Array.isArray(tool.args?.books)
    );
    
    console.log(`[UI Render] Found ${bookCardInvocations.length} book card invocations in message.toolInvocations`);
    
    if (bookCardInvocations.length === 0) return null;
    
    // Return a rendering function
    const BookCardRenderer = () => (
      <div className="mt-4 border-t border-gray-200 dark:border-gray-800 pt-4">
        <h3 className="text-sm font-medium mb-2">Book Details</h3>
        <div className="flex flex-wrap gap-4">
          {bookCardInvocations.flatMap((invocation) => {
            const books = invocation.args.books;
            return books.map((book: Record<string, unknown>, bookIndex: number) => {
              const bookId = `direct-${invocation.toolCallId}-${bookIndex}`;
              const validation = bookCardSchema.safeParse(book);
              
              if (!validation.success) {
                console.error('[Direct Render] Invalid book data:', validation.error);
                return (
                  <div key={bookId} className="p-2 border border-red-300 text-red-500 text-xs rounded">
                    Invalid book data
                  </div>
                );
              }
              
              console.log('[Direct Render] Rendering book card:', book.title);
              return <BookCard key={bookId} book={validation.data} />;
            });
          })}
        </div>
      </div>
    );
    
    BookCardRenderer.displayName = 'BookCardRenderer';
    return BookCardRenderer;
  }, [message.toolInvocations]);

  return (
    <AnimatePresence>
      <motion.div
        data-testid={`message-${message.role}`}
        className="w-full mx-auto max-w-3xl px-4 group/message"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role={message.role}
      >
        <div
          className={cn(
            'flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl',
            'group-data-[role=user]/message:w-fit', // Keep user messages contained
          )}
        >
          {message.role === 'assistant' && (
            <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-background">
              <div className="translate-y-px">
                <SparklesIcon size={14} />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4 w-full">
            {message.parts?.map((part, index) => {
              // Using message ID and index for a basic unique key
              const baseKey = `message-${message.id}-part-${index}`;
              console.log(`[UI Render] Message ${message.id}, Part ${index}:`, JSON.stringify(part, null, 2));
              
              // Handle text part
              if (part.type === 'text') {
                // Only render text if it's not empty
                if (part.text.trim().length === 0) {
                  console.log(`[UI Render] Part ${index} is empty text, skipping.`);
                  return null;
                }
                console.log(`[UI Render] Rendering text part ${index}: "${part.text.substring(0, 50)}..."`);
                return (
                  <div key={baseKey} className="flex flex-row gap-2 items-start">
                    <div
                      data-testid="message-content"
                      className={cn(
                        'prose dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 max-w-none', // Base prose styles + always invert in dark mode
                        {
                          'bg-primary text-primary-foreground px-3 py-2 rounded-xl': message.role === 'user',
                          'px-3 py-2': message.role === 'assistant'
                        }
                      )}
                    >
                      <Markdown>{part.text}</Markdown>
                    </div>
                  </div>
                );
              }

              // Handle tool invocation for book cards
              if (part.type === 'tool-invocation') {
                // First convert to unknown, then to our expected type to avoid TS errors
                const tempPart = part as unknown;
                const toolPart = tempPart as ExpectedToolInvocationPart;
                
                // IMPORTANT: We need to log the full structure to debug
                console.log(`[UI Render] Processing tool invocation part ${index}:`);
                console.log('[UI Render] Tool Invocation Part FULL STRUCTURE:', toolPart);
                
                // NEW: Access the inner toolInvocation object
                const { toolInvocation } = toolPart;
                if (!toolInvocation) {
                  console.error('[UI Render] Missing toolInvocation property in part:', toolPart);
                  return null;
                }
                
                // Log the tool name from the correct path
                console.log(`[UI Render] Tool name: ${toolInvocation.toolName}`);

                if (toolInvocation.toolName === 'displayBookCards') {
                  let parsedArgs: unknown;
                  try {
                      // Access the books array from the nested structure
                      // toolInvocation.args.books is the correct path now
                      const argsObj = toolInvocation.args as { books?: unknown };
                      console.log('[UI Render] Tool args object structure:', argsObj);
                      
                      // Extract the books array from the args.books property
                      parsedArgs = argsObj.books;
                      console.log('[UI Render] Tool args.books extracted - TYPE:', typeof parsedArgs, 'IS ARRAY:', Array.isArray(parsedArgs));
                      console.log('[UI Render] Tool args.books EXACT VALUE:', parsedArgs);
                  } catch (e) {
                      console.error("[UI Render] Failed to access/parse tool arguments:", e, "Args:", toolInvocation.args);
                      return <div key={baseKey} className="text-red-500 text-xs italic">Error accessing tool arguments.</div>;
                  }

                  // Validate the parsed args directly as an array of book cards
                  const parseResult = bookCardArraySchema.safeParse(parsedArgs);
                  
                  // Detailed logging of validation results
                  console.log('[UI Render] Tool args validation result:', parseResult.success ? 'SUCCESS' : 'FAILURE');
                  if (!parseResult.success) {
                      console.error('[UI Render] Validation error details:', parseResult.error);
                  }

                  // Check if parsing failed or the array is empty
                  if (!parseResult.success || !parseResult.data || parseResult.data.length === 0) {
                    console.error("[UI Render] Tool args validation failed or no books array:", parseResult.success ? 'No books array or empty' : parseResult.error, "Args:", parsedArgs);
                    return <div key={baseKey} className="text-orange-500 text-xs italic">Could not display book card data (validation failed or no books).</div>;
                  }

                  // If we reach here, parsing was successful and we have books
                  const books = parseResult.data;
                  console.log(`[UI Render] Successfully validated ${books.length} book cards:`, books);
                  return (
                    <div 
                      key={baseKey} 
                      className="flex flex-wrap gap-4 mt-2 p-2 border border-dashed border-gray-300 rounded-md relative"
                      style={{ minHeight: '100px' }} // Force some height even when empty
                    >
                      {/* Add a debug label */}
                      <div className="absolute top-0 right-0 bg-blue-100 text-blue-800 text-xs px-1 rounded">
                        {books.length} Book Card(s)
                      </div>
                      
                      {books.map((book, bookIndex) => {
                        // Generate a more stable key using book data if possible
                        const bookKey = book.asin ?? book.reviewUrl ?? `${baseKey}-book-${bookIndex}`;

                        // Validate each book object individually for robustness
                        const singleBookValidation = bookCardSchema.safeParse(book);

                        // Guard clause for invalid book data
                        if (!singleBookValidation.success) {
                          console.error(`[UI Render] Invalid book data received for book ${bookIndex}:`, singleBookValidation.error);
                          return (
                            <div key={`${bookKey}-invalid`} className="text-red-500 text-xs italic p-2 border border-red-500 rounded">
                              Invalid book data received for card {bookIndex}.
                            </div>
                          );
                        }

                        // If validation succeeded, render the card using the validated data
                        return <BookCard key={bookKey} book={singleBookValidation.data} />;
                      })}
                      
                      {/* Show fallback when no books are rendered but we expected some */}
                      {books.length > 0 && (
                        <div className="w-full text-center text-gray-500 text-sm">
                          {books.length} book card(s) should appear here
                        </div>
                      )}
                    </div>
                  );
                }
                console.log(`[UI Render] Ignoring tool invocation: ${toolInvocation.toolName}`);
                return null;
              }
              
              // Handle tool result (log only)
              // @ts-expect-error - We're deliberately checking for a type that might not be in the type definition
              if (part.type === 'tool-result') {
                console.log('[UI Render] Tool Result Part Received:', JSON.stringify(part, null, 2));
                // We don't render anything for the result itself, the invocation handles the UI
                return null;
              }

              console.log(`[UI Render] Ignoring part type: ${part.type}`);
              return null;
            })}
            
            {/* Handle older message format */}
            {message.content && message.parts == null && (
              <div className="flex flex-row gap-2 items-start">
                <div
                  data-testid="message-content"
                  className={cn(
                    'prose dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 max-w-none', // Base prose styles + always invert in dark mode
                    {
                      'bg-primary text-primary-foreground px-3 py-2 rounded-xl': message.role === 'user',
                      'px-3 py-2': message.role === 'assistant'
                    }
                  )}
                >
                  <Markdown>{message.content}</Markdown>
                </div>
              </div>
            )}
            
            {/* NEW: Render book cards directly from toolInvocations if available */}
            {bookCards && bookCards()}
          </div>
        </div>
        
        {/* Debug panel - only show in development */}
        {process.env.NODE_ENV === 'development' && message.role === 'assistant' && (
          <details className="mt-4 p-2 bg-gray-100 dark:bg-gray-800 text-xs rounded">
            <summary className="cursor-pointer font-mono">Debug Message Data</summary>
            
            {/* Add specific section for tool invocations */}
            {message.toolInvocations && message.toolInvocations.length > 0 && (
              <div className="mt-2">
                <h3 className="font-bold text-green-600 dark:text-green-400">Tool Invocations: {message.toolInvocations.length}</h3>
                <ul className="mt-1 list-disc pl-4">
                  {message.toolInvocations.map((tool, i) => (
                    <li key={`tool-${tool.toolCallId || i}`} className="mb-2">
                      <span className="font-semibold">{tool.toolName}</span>
                      <div className="text-xs mt-1 px-2 py-1 bg-gray-200 dark:bg-gray-900 rounded overflow-auto">
                        <pre>{JSON.stringify(tool.args, null, 2)}</pre>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            <pre className="mt-2 p-2 bg-gray-200 dark:bg-gray-900 rounded overflow-auto max-h-96">
              {JSON.stringify(message, null, 2)}
            </pre>
          </details>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

PurePreviewMessage.displayName = 'PurePreviewMessage';

// Basic memoization based on message content and loading state
export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    return (
      prevProps.message.id === nextProps.message.id &&
      JSON.stringify(prevProps.message.parts) === JSON.stringify(nextProps.message.parts) &&
      prevProps.message.content === nextProps.message.content
    );
  },
);

PreviewMessage.displayName = 'PreviewMessage';

// Simplified Thinking Message
export const ThinkingMessage = () => {
  return (
    <motion.div
      data-testid="message-assistant-loading"
      className="w-full mx-auto max-w-3xl px-4 group/message"
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1, transition: { delay: 0.1 } }}
      data-role="assistant"
    >
      <div className="flex gap-4 w-full">
         <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-background">
           <div className="translate-y-px">
             <SparklesIcon size={14} />
           </div>
         </div>
        <div className="flex items-center bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2 rounded-2xl rounded-tl-sm shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
          <div className="h-2 w-2 animate-pulse rounded-full bg-foreground mr-1" />
          <div className="h-2 w-2 animate-pulse rounded-full bg-foreground mr-1 delay-75" />
          <div className="h-2 w-2 animate-pulse rounded-full bg-foreground delay-150" />
        </div>
      </div>
    </motion.div>
  );
}; 