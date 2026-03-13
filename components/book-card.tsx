'use client';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import type { Book } from '@/lib/ai/schemas';
import { cn } from '@/lib/utils';

interface BookCardProps {
  book: Book;
  className?: string;
}

const gradeColor = (grade: string): string => {
  if (grade.startsWith('A')) return 'bg-emerald-500/90 text-white';
  if (grade.startsWith('B')) return 'bg-[#7f85c1]/85 text-white';
  if (grade.startsWith('C')) return 'bg-amber-500/90 text-white';
  return 'bg-rose-500/90 text-white';
};

export function BookCard({ book, className }: BookCardProps) {
  const src = book.featuredImage || book.coverUrl || '/placeholder-cover.jpg';
  const buyLink = book.asin ? `https://www.amazon.com/dp/${book.asin}?tag=allaboutromance` : null;

  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <Link
        href={book.url || '#'}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'group relative flex gap-4 p-3.5 rounded-xl overflow-hidden',
          'bg-white/55 dark:bg-white/5 backdrop-blur-sm',
          'border border-white/40 dark:border-white/10',
          'shadow-sm hover:shadow-lg hover:shadow-[#7f85c1]/10',
          'hover:bg-white/70 dark:hover:bg-white/8',
          'transition-all duration-250',
          className
        )}
      >
        {/* Cover Image */}
        <div className="relative w-[80px] h-[120px] rounded-lg overflow-hidden shadow-md shrink-0 bg-muted/20">
          <Image
            src={src}
            alt={`Cover of ${book.title}`}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="80px"
          />
          {/* Subtle overlay on hover */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        </div>

        {/* Details */}
        <div className="flex flex-col min-w-0 flex-1 justify-between py-0.5">
          <div>
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display text-[14px] font-semibold text-foreground leading-snug line-clamp-2 tracking-tight">
                {book.title}
              </h3>
              {book.grade && (
                <span className={cn(
                  'shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md tracking-wide',
                  gradeColor(book.grade),
                )}>
                  {book.grade}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 tracking-wide">
              {book.author}
            </p>
          </div>

          {/* Tags */}
          {book.tags && book.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {book.tags.slice(0, 3).map(tag => (
                <span
                  key={tag}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-[#7f85c1]/8 text-[#7f85c1] dark:text-[#a5aae0] dark:bg-[#7f85c1]/15 font-medium tracking-wide"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Footer meta */}
          <div className="flex items-center gap-2 mt-auto pt-1.5">
            {book.bookType && (
              <span className="text-[10px] text-muted-foreground/70 truncate tracking-wide uppercase font-medium">
                {book.bookType}
              </span>
            )}
            {buyLink && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(buyLink, '_blank');
                }}
                className="ml-auto shrink-0 text-[11px] font-semibold text-[#7f85c1] hover:text-[#6c72a6] transition-colors tracking-wide"
              >
                Buy &rarr;
              </button>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
