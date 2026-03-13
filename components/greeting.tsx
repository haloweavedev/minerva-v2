'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';

interface GreetingProps {
  onQueryClick?: (query: string) => void;
}

const suggestions = [
  'Best enemies-to-lovers romances',
  'A-graded books from 2025',
  'Recommend me a steamy Regency',
  'What did readers think of Ice Planet Barbarians?',
];

export const Greeting = ({ onQueryClick }: GreetingProps) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
        className="flex flex-col items-center gap-6 w-full max-w-lg"
      >
        {/* Logo */}
        <div className="size-12 flex items-center justify-center">
          <Image
            src="/minerva-logo.svg"
            alt="Minerva"
            width={40}
            height={40}
          />
        </div>

        {/* Title */}
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            What can I help you find?
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Search 18,000+ romance reviews from All About Romance
          </p>
        </div>

        {/* Capabilities — clean list */}
        <div className="w-full text-[14px] text-muted-foreground space-y-1.5">
          <p>I can help you:</p>
          <ul className="space-y-1 ml-4 list-disc marker:text-[#7f85c1]/50">
            <li>Find books by trope, subgenre, grade, or sensuality</li>
            <li>Look up what reviewers thought about a specific title</li>
            <li>Compare books or explore an author&apos;s catalog</li>
          </ul>
        </div>

        {/* Suggestion chips */}
        <div className="flex flex-wrap gap-2 justify-center w-full">
          {suggestions.map((query, i) => (
            <motion.button
              key={query}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.15 + i * 0.05, ease: [0.23, 1, 0.32, 1] }}
              onClick={() => onQueryClick?.(query)}
              className="text-[13px] px-3.5 py-1.5 rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:border-[#7f85c1]/40 hover:bg-[#7f85c1]/5 transition-colors cursor-pointer"
            >
              {query}
            </motion.button>
          ))}
        </div>
      </motion.div>
    </div>
  );
};
