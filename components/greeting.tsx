'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';

interface GreetingProps {
  onQueryClick?: (query: string) => void;
}

export const Greeting = ({}: GreetingProps) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 pb-10">
      {/* Logo + Branding */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
        className="flex flex-col items-center gap-4 mb-10"
      >
        <div className="size-[72px] rounded-2xl flex items-center justify-center">
          <Image
            src="/minerva-logo.svg"
            alt="Minerva"
            width={52}
            height={52}
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

      {/* What is Minerva card */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
        className="w-full max-w-[480px]"
      >
        <div className="px-6 py-5 rounded-2xl bg-white/45 dark:bg-white/5 backdrop-blur-sm border border-white/40 dark:border-white/10">
          <h2 className="font-display text-base font-semibold text-foreground/90 mb-3">
            What can Minerva do?
          </h2>
          <ul className="space-y-2 text-[13px] text-muted-foreground leading-relaxed">
            <li className="flex items-start gap-2">
              <span className="text-[#7f85c1] mt-0.5 shrink-0">&bull;</span>
              <span>Search and explore 18,000+ romance book reviews from All About Romance</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#7f85c1] mt-0.5 shrink-0">&bull;</span>
              <span>Get personalized recommendations by trope, subgenre, grade, or sensuality level</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#7f85c1] mt-0.5 shrink-0">&bull;</span>
              <span>Read what reviewers and readers thought about specific books</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#7f85c1] mt-0.5 shrink-0">&bull;</span>
              <span>Compare two books side-by-side or explore an author&apos;s catalog</span>
            </li>
          </ul>
        </div>
      </motion.div>
    </div>
  );
};
