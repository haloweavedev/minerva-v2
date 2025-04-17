'use client';
import type { HTMLAttributes, ReactNode } from 'react';

interface CodeBlockProps extends HTMLAttributes<HTMLElement> {
  inline: boolean;
  className: string;
  children: ReactNode;
}

export function CodeBlock({
  inline,
  className,
  children,
  ...props
}: CodeBlockProps) {
  if (!inline) {
    return (
      <section className="not-prose flex flex-col" aria-label="Code block">
        <pre
          {...props}
          className={`text-sm w-full overflow-x-auto dark:bg-zinc-900 bg-zinc-100 p-4 border border-input dark:border-zinc-700 rounded-xl dark:text-zinc-50 text-zinc-900 ${className ?? ''}`}
        >
          <code className="whitespace-pre-wrap break-words">{children}</code>
        </pre>
      </section>
    );
  }
  
  return (
    <code
      className={`${className} text-sm bg-zinc-100 dark:bg-zinc-800 py-0.5 px-1 rounded-md font-mono`}
      {...props}
    >
      {children}
    </code>
  );
} 