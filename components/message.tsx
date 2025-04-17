'use client';

import type { UIMessage } from 'ai';
import { AnimatePresence, motion } from 'framer-motion';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { SparklesIcon } from './icons';
import { Markdown } from './markdown';

// Simplified version without editing, voting, artifacts, reasoning
const PurePreviewMessage = ({ message }: { message: UIMessage }) => {
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

          <div className="flex flex-col gap-6 w-full">
            {/* Simplified: Only handle text parts */}
            {message.parts?.map((part, index) => {
              const key = `message-${message.id}-part-${index}`;
              if (part.type === 'text') {
                return (
                  <div key={key} className="flex flex-row gap-2 items-start">
                    <div
                      data-testid="message-content"
                      className={cn(
                        'prose prose-p:leading-relaxed prose-pre:p-0 max-w-none transition-colors duration-200', // Base prose styles
                        {
                          // User message styles
                          'dark:prose-invert': message.role === 'user', // Invert only for user messages
                          'bg-gradient-to-br from-primary to-primary/90 text-primary-foreground px-4 py-3 rounded-2xl rounded-br-sm shadow-sm':
                            message.role === 'user',
                          // Assistant message styles
                          'bg-slate-50 text-foreground dark:bg-slate-900 dark:text-foreground border border-slate-200 dark:border-slate-800 px-4 py-3 rounded-2xl rounded-tl-sm shadow-[0_2px_4px_rgba(0,0,0,0.02)]': 
                            message.role === 'assistant'
                        }
                      )}
                    >
                      <Markdown>{part.text}</Markdown>
                    </div>
                  </div>
                );
              }
              // Ignore other part types for now (tool-call, tool-result, reasoning)
              return null;
            })}
             {/* Handle older message format if necessary during transition */}
             {message.content && !message.parts && (
               <div className="flex flex-row gap-2 items-start">
                 <div
                   data-testid="message-content"
                   className={cn(
                     'prose prose-p:leading-relaxed prose-pre:p-0 max-w-none transition-colors duration-200', // Base prose styles
                     {
                       // User message styles
                       'dark:prose-invert': message.role === 'user', // Invert only for user messages
                       'bg-gradient-to-br from-primary to-primary/90 text-primary-foreground px-4 py-3 rounded-2xl rounded-br-sm shadow-sm':
                         message.role === 'user',
                       // Assistant message styles
                       'bg-slate-50 text-foreground dark:bg-slate-900 dark:text-foreground border border-slate-200 dark:border-slate-800 px-4 py-3 rounded-2xl rounded-tl-sm shadow-[0_2px_4px_rgba(0,0,0,0.02)]': 
                         message.role === 'assistant'
                     }
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