'use client';

import type { UIMessage } from 'ai';
import { AnimatePresence, motion } from 'framer-motion';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { SparklesIcon } from './icons';
import { Markdown } from './markdown';
import { BookGrid } from './book-grid';
import { BookListSchema } from '@/lib/ai/schemas';
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
              
              // Handle text part
              if (part.type === 'text') {
                // Only render text if it's not empty
                if (part.text.trim().length === 0) {
                  return null;
                }
                return (
                  <div key={baseKey} className="flex flex-row gap-2 items-start">
                    <div
                      data-testid="message-content"
                      className={cn(
                        'prose dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 max-w-none',
                        {
                          'bg-primary text-primary-foreground px-3 py-2 rounded-xl': message.role === 'user',
                          'assistant-message-class': message.role === 'assistant'
                        },
                        message.role === 'user' && 'min-h-[24px] max-h-[calc(75dvh)] overflow-hidden resize-none rounded-2xl !text-base bg-muted pb-5 dark:border-zinc-700'
                      )}
                    >
                      <Markdown>{part.text}</Markdown>
                    </div>
                  </div>
                );
              }

              // Handle tool invocation for book cards
              if (part.type === 'tool-invocation') {
                // Cast to our expected type structure
                const toolPart = part as unknown as ExpectedToolInvocationPart;
                const { toolInvocation } = toolPart;
                
                if (toolInvocation?.toolName === 'displayBookCards') {
                  console.log('[UI Render] Detected displayBookCards tool invocation');
                  
                  try {
                    // For the new tool structure, the result will be the books array directly
                    const books = toolInvocation.result as unknown[];
                    
                    if (Array.isArray(books) && books.length > 0) {
                      // Validate against our schema
                      const parseResult = BookListSchema.safeParse(books);
                      
                      if (!parseResult.success || parseResult.data.length === 0) {
                        console.error('[UI Render] Book card validation failed:', 
                          parseResult.success ? 'Empty data' : parseResult.error);
                        return (
                          <div key={baseKey} className="text-orange-500 text-xs italic mt-2">
                            [No book recommendations found matching your criteria]
                          </div>
                        );
                      }
                      
                      // If we reach here, we have valid books
                      const validBooks = parseResult.data;
                      console.log(`[UI Render] Successfully validated ${validBooks.length} book cards`);
                      
                      // Use the BookGrid component instead of flex container
                      return (
                        <div key={baseKey} className="mt-4 w-full">
                          <BookGrid books={validBooks} />
                        </div>
                      );
                    }
                  } catch (error) {
                    console.error('[UI Render] Error processing book cards:', error);
                    return (
                      <div key={baseKey} className="text-orange-500 text-xs italic mt-2">
                        [Error displaying book recommendations]
                      </div>
                    );
                  }
                }
              }
              
              return null; // Ignore other part types
            })}
            
            {/* Handle older message format without parts */}
            {message.content && message.parts == null && (
              <div className="flex flex-row gap-2 items-start">
                <div
                  data-testid="message-content"
                  className={cn(
                    'prose dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 max-w-none',
                    {
                      'bg-primary text-primary-foreground px-3 py-2 rounded-xl': message.role === 'user',
                      'px-3 py-2': message.role === 'assistant'
                    },
                    message.role === 'user' && 'min-h-[24px] max-h-[calc(75dvh)] overflow-hidden resize-none rounded-2xl !text-base bg-muted pb-10 dark:border-zinc-700'
                  )}
                >
                  <Markdown>{message.content}</Markdown>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

// Memo it to prevent unnecessary re-renders
export const PreviewMessage = memo(PurePreviewMessage);

export const ThinkingMessage = () => {
  return (
    <motion.div
      data-testid="thinking-message"
      className="w-full mx-auto max-w-3xl px-4"
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
    >
      <div className="flex gap-4 px-3 py-2">
        <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-background">
          <div className="translate-y-px">
            <SparklesIcon size={14} />
          </div>
        </div>
        <div className="flex flex-col gap-4 w-full">
          <div className="h-4 bg-border/10 rounded animate-pulse" />
        </div>
      </div>
    </motion.div>
  );
}; 