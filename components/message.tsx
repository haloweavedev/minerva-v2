'use client';

import type { UIMessage } from 'ai';
import { AnimatePresence, motion } from 'framer-motion';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { Markdown } from './markdown';
import { BookGrid } from './book-grid';
import { BookListSchema } from '@/lib/ai/schemas';
import Image from 'next/image';

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
        transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
        data-role={message.role}
      >
        <div
          className={cn(
            'flex gap-3.5 w-full',
            'group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl',
            'group-data-[role=user]/message:w-fit',
          )}
        >
          {message.role === 'assistant' && (
            <div className="size-7 flex items-center rounded-full justify-center shrink-0 mt-0.5 bg-white/60 dark:bg-white/10 backdrop-blur-sm border border-white/40 dark:border-white/10 shadow-sm">
              <Image
                src="/minerva-logo.svg"
                alt=""
                width={15}
                height={15}
                className="opacity-70"
              />
            </div>
          )}

          <div className="flex flex-col gap-2.5 w-full min-w-0">
            {message.parts?.map((part, index) => {
              const baseKey = `message-${message.id}-part-${index}`;

              if (part.type === 'text') {
                if (part.text.trim().length === 0) return null;
                return (
                  <div key={baseKey}>
                    <div
                      data-testid="message-content"
                      className={cn(
                        'prose dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 max-w-none text-[15px]',
                        message.role === 'user' && 'bg-[#7f85c1] text-white px-4 py-2.5 rounded-2xl rounded-br-sm shadow-sm',
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
                          <div key={baseKey} className="text-muted-foreground text-sm italic mt-1">
                            No book recommendations found matching your criteria.
                          </div>
                        );
                      }

                      return (
                        <motion.div
                          key={baseKey}
                          className="mt-2 w-full"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.4, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
                        >
                          <BookGrid books={parseResult.data} />
                        </motion.div>
                      );
                    }
                  } catch (error) {
                    console.error('[UI] Error processing book cards:', error);
                    return (
                      <div key={baseKey} className="text-muted-foreground text-sm italic mt-1">
                        Error displaying book recommendations.
                      </div>
                    );
                  }
                }
              }

              return null;
            })}
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
      <div className="flex gap-3.5">
        <div className="size-7 flex items-center rounded-full justify-center shrink-0 mt-0.5 bg-white/60 dark:bg-white/10 backdrop-blur-sm border border-white/40 dark:border-white/10 shadow-sm">
          <Image
            src="/minerva-logo.svg"
            alt=""
            width={15}
            height={15}
            className="opacity-70"
          />
        </div>
        <div className="flex items-center gap-1.5 py-2">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="size-1.5 rounded-full bg-[#7f85c1]/40"
              animate={{ opacity: [0.25, 0.9, 0.25] }}
              transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
};
