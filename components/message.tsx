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

interface PurePreviewMessageProps {
  message: UIMessage;
  isLoading?: boolean;
}

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

const PurePreviewMessage = ({ message }: PurePreviewMessageProps) => {
  return (
    <AnimatePresence>
      <motion.div
        data-testid={`message-${message.role}`}
        className="w-full mx-auto max-w-3xl px-4 group/message"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3 }}
        data-role={message.role}
      >
        <div
          className={cn(
            'flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl',
            'group-data-[role=user]/message:w-fit',
          )}
        >
          {message.role === 'assistant' && (
            <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border/50 bg-background/80 backdrop-blur-sm">
              <div className="translate-y-px">
                <SparklesIcon size={14} />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 w-full">
            {message.parts?.map((part, index) => {
              const baseKey = `message-${message.id}-part-${index}`;

              if (part.type === 'text') {
                if (part.text.trim().length === 0) return null;
                return (
                  <div key={baseKey} className="flex flex-row gap-2 items-start">
                    <div
                      data-testid="message-content"
                      className={cn(
                        'prose dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 max-w-none',
                        {
                          'bg-primary text-primary-foreground px-3.5 py-2 rounded-2xl': message.role === 'user',
                        },
                        message.role === 'user' && 'min-h-[24px] max-h-[calc(75dvh)] overflow-hidden resize-none !text-base bg-muted dark:border-zinc-700'
                      )}
                    >
                      <Markdown>{part.text}</Markdown>
                    </div>
                  </div>
                );
              }

              if (part.type === 'tool-invocation') {
                const toolPart = part as unknown as ExpectedToolInvocationPart;
                const { toolInvocation } = toolPart;

                if (toolInvocation?.toolName === 'displayBookCards') {
                  try {
                    const books = toolInvocation.result as unknown[];

                    if (Array.isArray(books) && books.length > 0) {
                      const parseResult = BookListSchema.safeParse(books);

                      if (!parseResult.success || parseResult.data.length === 0) {
                        return (
                          <div key={baseKey} className="text-orange-500/80 text-xs italic mt-1">
                            No book recommendations found matching your criteria.
                          </div>
                        );
                      }

                      return (
                        <motion.div
                          key={baseKey}
                          className="mt-3 w-full"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.4, delay: 0.1 }}
                        >
                          <BookGrid books={parseResult.data} />
                        </motion.div>
                      );
                    }
                  } catch (error) {
                    console.error('[UI] Error processing book cards:', error);
                    return (
                      <div key={baseKey} className="text-orange-500/80 text-xs italic mt-1">
                        Error displaying book recommendations.
                      </div>
                    );
                  }
                }
              }

              return null;
            })}

            {/* Legacy message format */}
            {message.content && message.parts == null && (
              <div className="flex flex-row gap-2 items-start">
                <div
                  data-testid="message-content"
                  className={cn(
                    'prose dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 max-w-none',
                    {
                      'bg-primary text-primary-foreground px-3.5 py-2 rounded-2xl': message.role === 'user',
                      'px-3 py-2': message.role === 'assistant'
                    },
                    message.role === 'user' && 'min-h-[24px] max-h-[calc(75dvh)] overflow-hidden resize-none !text-base bg-muted dark:border-zinc-700'
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
        <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border/50 bg-background/80 backdrop-blur-sm">
          <div className="translate-y-px">
            <SparklesIcon size={14} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 py-2">
          <motion.div
            className="size-1.5 rounded-full bg-[#7f85c1]/60"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
          />
          <motion.div
            className="size-1.5 rounded-full bg-[#7f85c1]/60"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
          />
          <motion.div
            className="size-1.5 rounded-full bg-[#7f85c1]/60"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
          />
        </div>
      </div>
    </motion.div>
  );
};
