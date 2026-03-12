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

export function BookCard({ book, className }: BookCardProps) {
  const src = book.featuredImage || book.coverUrl || '/placeholder-cover.jpg';

  const buyLink = book.asin ? `https://www.amazon.com/dp/${book.asin}?tag=allaboutromance` : '#';

  const handleBuyClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (buyLink !== '#') {
      window.open(buyLink, '_blank');
    }
  };

  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      <Link
        href={book.url || '#'}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'relative block border border-white/20 rounded-xl overflow-hidden',
          'bg-white/50 dark:bg-white/5 backdrop-blur-sm',
          'text-card-foreground shadow-sm w-full',
          'transition-shadow duration-300',
          'hover:shadow-lg hover:shadow-[#7f85c1]/15',
          className
        )}
      >
        {/* Top Banner: Grade + Buy */}
        <div className="absolute top-0 left-0 right-0 flex justify-between z-10 p-2.5">
          {book.grade && (
            <div className="bg-[#7f85c1]/90 backdrop-blur-sm text-white font-bold px-3 py-1.5 rounded-lg text-sm shadow-sm">
              {book.grade}
            </div>
          )}
          <button
            onClick={handleBuyClick}
            type="button"
            className="bg-[#7f85c1]/90 backdrop-blur-sm text-white font-semibold px-3 py-1.5 rounded-lg text-sm shadow-sm transition-colors hover:bg-[#6c72a6]"
          >
            Buy
          </button>
        </div>

        {/* Cover Image */}
        <div className="flex justify-center px-5 pt-14 pb-4">
          <div className="relative w-[140px] h-[210px] rounded-lg overflow-hidden shadow-md">
            <Image
              src={src}
              alt={`Cover of ${book.title}`}
              fill
              className="object-cover"
              sizes="140px"
              priority
            />
          </div>
        </div>

        {/* Details */}
        <div className="px-5 pb-5 space-y-2.5">
          <div className="text-center">
            <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 leading-tight">{book.title}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">by {book.author}</p>
          </div>

          {/* Tags */}
          {book.tags && book.tags.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {book.tags.slice(0, 4).map(tag => (
                <span
                  key={tag}
                  className="bg-[#7f85c1]/10 text-[#7f85c1] dark:text-[#a5aae0] text-xs px-2.5 py-0.5 rounded-full font-medium"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Meta row */}
          <div className="flex items-center justify-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            {book.bookType && (
              <span className="truncate max-w-[140px]">{book.bookType}</span>
            )}
            {book.bookType && book.sensuality && (
              <span className="text-gray-300 dark:text-gray-600">|</span>
            )}
            {book.sensuality && (
              <span>{book.sensuality}</span>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
