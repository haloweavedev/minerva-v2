import Link from 'next/link';
import React, { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './code-block';

const components: Partial<Components> = {
  // @ts-expect-error - Type mismatch expected here
  code: CodeBlock,
  pre: ({ children }) => <>{children}</>,
  ol: ({ children, ...props }) => {
    return (
      <ol className="list-decimal list-outside ml-4" {...props}>
        {children}
      </ol>
    );
  },
  li: ({ children, ...props }) => {
    return (
      <li className="py-0.5" {...props}>
        {children}
      </li>
    );
  },
  ul: ({ children, ...props }) => {
    return (
      <ul className="list-disc list-outside ml-4" {...props}>
        {children}
      </ul>
    );
  },
  strong: ({ children, ...props }) => {
    return (
      <span className="font-display font-semibold" {...props}>
        {children}
      </span>
    );
  },
  a: ({ children, ...props }) => {
    return (
      // @ts-expect-error - href might be undefined
      <Link
        className="text-[#7f85c1] hover:text-[#6c72a6] hover:underline underline-offset-2 transition-colors"
        target="_blank"
        rel="noreferrer"
        {...props}
      >
        {children}
      </Link>
    );
  },
  h1: ({ children, ...props }) => {
    return (
      <h1 className="font-display text-2xl font-semibold mt-5 mb-2 tracking-tight" {...props}>
        {children}
      </h1>
    );
  },
  h2: ({ children, ...props }) => {
    return (
      <h2 className="font-display text-xl font-semibold mt-5 mb-2 tracking-tight" {...props}>
        {children}
      </h2>
    );
  },
  h3: ({ children, ...props }) => {
    return (
      <h3 className="font-display text-lg font-semibold mt-4 mb-1.5 tracking-tight" {...props}>
        {children}
      </h3>
    );
  },
  h4: ({ children, ...props }) => {
    return (
      <h4 className="font-display text-base font-semibold mt-4 mb-1.5" {...props}>
        {children}
      </h4>
    );
  },
  h5: ({ children, ...props }) => {
    return (
      <h5 className="font-display text-sm font-semibold mt-4 mb-1" {...props}>
        {children}
      </h5>
    );
  },
  h6: ({ children, ...props }) => {
    return (
      <h6 className="font-display text-sm font-medium mt-4 mb-1 text-muted-foreground" {...props}>
        {children}
      </h6>
    );
  },
  table: ({ children, ...props }) => {
    return (
      <div className="overflow-x-auto my-3 rounded-xl border border-white/30 dark:border-white/10 bg-white/30 dark:bg-white/5 backdrop-blur-sm" {...props}>
        <table className="w-full text-[13px]">
          {children}
        </table>
      </div>
    );
  },
  thead: ({ children, ...props }) => {
    return (
      <thead className="border-b border-[#7f85c1]/15 dark:border-[#7f85c1]/20" {...props}>
        {children}
      </thead>
    );
  },
  th: ({ children, ...props }) => {
    return (
      <th className="px-4 py-2.5 text-left text-[12px] font-semibold text-[#7f85c1] uppercase tracking-wider" {...props}>
        {children}
      </th>
    );
  },
  td: ({ children, ...props }) => {
    return (
      <td className="px-4 py-2.5 text-foreground/80" {...props}>
        {children}
      </td>
    );
  },
  tr: ({ children, ...props }) => {
    return (
      <tr className="border-b border-white/20 dark:border-white/5 last:border-0" {...props}>
        {children}
      </tr>
    );
  },
};

const remarkPlugins = [remarkGfm];

const NonMemoizedMarkdown = ({ children }: { children: string }) => {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {children}
    </ReactMarkdown>
  );
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);
