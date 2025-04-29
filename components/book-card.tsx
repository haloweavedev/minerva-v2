'use client';
import Link from 'next/link';
import Image from 'next/image';
import type { Book } from '@/lib/ai/schemas';
import { cn } from '@/lib/utils';

interface BookCardProps {
  book: Book;
  className?: string;
}

export function BookCard({ book, className }: BookCardProps) {
  const src = book.featuredImage || '/placeholder-cover.jpg';
  
  // Generate Amazon buy link if ASIN is available
  const buyLink = book.asin ? `https://www.amazon.com/dp/${book.asin}?tag=allaboutromance` : '#';

  // Stop propagation for Buy button so it doesn't trigger the card link
  const handleBuyClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (buyLink !== '#') {
      window.open(buyLink, '_blank');
    }
  };

  return (
    <Link 
      href={book.url || '#'} 
      className={cn(
        "relative block border rounded-lg overflow-hidden bg-white/60 text-card-foreground shadow-sm w-full transition-all hover:shadow-md hover:bg-white/70", 
        className
      )}
    >
      {/* Top Banner with Grade and Buy Button */}
      <div className="absolute top-0 left-0 right-0 flex justify-between z-10 p-2">
        {book.grade && (
          <div className="bg-[#7f85c1] text-white font-bold px-3 py-1.5 rounded-md text-sm">
            {book.grade}
          </div>
        )}
        
        <button 
          onClick={handleBuyClick}
          type="button"
          className="bg-[#7f85c1] text-white font-bold px-3 py-1.5 rounded-md text-sm hover:bg-[#6c72a6] transition-colors"
        >
          Buy
        </button>
      </div>

      {/* Book Cover */}
      <div className="flex justify-center p-4 pt-12 pb-3">
        <div className="relative w-[150px] h-[230px]">
          <Image 
            src={src} 
            alt={`Cover of ${book.title}`} 
            fill
            className="object-cover rounded shadow-md" 
            priority
          />
        </div>
      </div>

      {/* Book Details */}
      <div className="p-4 pt-0 bg-transparent">
        {/* Title and Author */}
        <h2 className="text-lg font-bold text-center text-gray-800 mb-1">{book.title}</h2>
        <h3 className="text-base text-center text-gray-600 mb-3">by {book.author}</h3>
        
        {/* Tags */}
        <div className="mb-3">
          {book.tags && book.tags.length > 0 && (
            <div className="flex items-center">
              <p className="text-xs font-medium mr-2">Tags:</p>
              <div className="flex flex-wrap gap-1">
                {book.tags.map(tag => (
                  <span key={tag} className="bg-[#7f85c1]/20 text-[#7f85c1] text-xs px-2 py-0.5 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Book Type */}
        {book.bookType && (
          <div className="text-xs mb-1.5">
            <span className="font-medium">Book Type:</span> {book.bookType}
          </div>
        )}
        
        {/* Sensuality Rating */}
        {book.sensuality && (
          <div className="text-xs mb-1.5">
            <span className="font-medium">Sensuality:</span> {book.sensuality}
          </div>
        )}
      </div>
    </Link>
  );
} 