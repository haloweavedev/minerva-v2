'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';

const SUGGESTED_QUERIES = [
  {
    icon: '\u2694\uFE0F',
    label: 'Best medieval romances',
    query: 'What are the best medieval historical romances with strong heroines?',
  },
  {
    icon: '\uD83D\uDD25',
    label: 'Enemies to lovers',
    query: 'Find me an enemies to lovers romance with a high rating',
  },
  {
    icon: '\uD83E\UDDDB\u200D\u2640\uFE0F',
    label: 'Steamy paranormal',
    query: 'Recommend a steamy paranormal romance',
  },
  {
    icon: '\uD83C\uDFF0',
    label: 'Books like Bridgerton',
    query: 'What Regency romances are similar to Julia Quinn\'s books?',
  },
];

interface GreetingProps {
  onQueryClick?: (query: string) => void;
}

export const Greeting = ({ onQueryClick }: GreetingProps) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 pb-10">
      {/* Logo + Branding */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
        className="flex flex-col items-center gap-4 mb-10"
      >
        <div className="size-[72px] rounded-2xl bg-white/60 dark:bg-white/10 backdrop-blur-md border border-white/40 dark:border-white/10 shadow-xl shadow-[#7f85c1]/15 flex items-center justify-center">
          <Image
            src="/minerva-logo.svg"
            alt="Minerva"
            width={38}
            height={38}
            className="opacity-80"
          />
        </div>
        <div className="text-center">
          <h1 className="font-display text-5xl sm:text-6xl font-semibold tracking-tight bg-gradient-to-r from-[#7F85C1] via-[#9b8ec4] to-[#c77dba] bg-clip-text text-transparent">
            Minerva
          </h1>
          <p className="text-[13px] text-muted-foreground/70 mt-2 tracking-[0.08em] uppercase font-medium">
            18,000+ romance reviews at your fingertips
          </p>
        </div>
      </motion.div>

      {/* Decorative divider */}
      <motion.div
        initial={{ opacity: 0, scaleX: 0 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
        className="w-24 h-px bg-gradient-to-r from-transparent via-[#7f85c1]/30 to-transparent mb-8"
      />

      {/* Suggested Queries */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
        className="grid grid-cols-2 gap-2.5 w-full max-w-[440px]"
      >
        {SUGGESTED_QUERIES.map((item, i) => (
          <motion.button
            key={item.label}
            type="button"
            onClick={() => onQueryClick?.(item.query)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.25 + i * 0.06, ease: [0.23, 1, 0.32, 1] }}
            whileHover={{ y: -2 }}
            className="group relative text-left px-4 py-3.5 rounded-xl
              bg-white/45 dark:bg-white/5 backdrop-blur-sm
              border border-white/40 dark:border-white/10
              hover:bg-white/70 dark:hover:bg-white/10
              hover:border-[#7f85c1]/25 dark:hover:border-[#7f85c1]/25
              hover:shadow-lg hover:shadow-[#7f85c1]/8
              transition-all duration-250 cursor-pointer"
          >
            <span className="block text-base mb-1 leading-none" aria-hidden="true">{item.icon}</span>
            <span className="text-[13px] font-medium text-foreground/75 group-hover:text-foreground transition-colors leading-snug">
              {item.label}
            </span>
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
};
