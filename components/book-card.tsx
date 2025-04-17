'use client';
import React from 'react';
import Link from 'next/link';
import type { z } from 'zod';
import type { bookCardSchema } from '@/lib/ai/schemas';
import { cn } from '@/lib/utils';

// Infer the type from the Zod schema
type BookCardData = z.infer<typeof bookCardSchema>;

interface BookCardProps {
  book: BookCardData;
  className?: string;
}

export function BookCard({ book, className }: BookCardProps) {
  // Basic card structure - customize heavily with Tailwind
  return (
    <div className={cn("border rounded-lg p-4 bg-card text-card-foreground shadow-sm max-w-xs w-full", className)}> {/* Adjusted max-width */}
      {book.featuredImage?.startsWith('http') ? ( // Basic URL check, using optional chaining
         // eslint-disable-next-line @next/next/no-img-element
         <img src={book.featuredImage} alt={`Cover for ${book.title}`} className="w-full h-32 object-contain rounded-t-lg mb-3 bg-muted" /> // Use object-contain
      ) : (
         <div className="w-full h-32 bg-muted rounded-t-lg mb-3 flex items-center justify-center text-muted-foreground text-sm">No Image</div> // Placeholder
      )}
      <h3 className="font-semibold text-base mb-1 truncate">{book.title}</h3> {/* Adjusted size, added truncate */}
      <p className="text-sm text-muted-foreground mb-2 truncate">by {book.author}</p>
      <div className="flex flex-wrap gap-1 text-xs mb-3"> {/* Reduced gap */}
        {book.grade && <span className="bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">Grade: {book.grade}</span>}
        {book.sensuality && <span className="bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">Sensuality: {book.sensuality}</span>}
        {/* Limit displayed book types */}
        {book.bookTypes?.slice(0, 2)?.map(type => (
          <span key={type} className="bg-muted text-muted-foreground px-1.5 py-0.5 rounded truncate">{type}</span>
        ))}
        {book.bookTypes && book.bookTypes.length > 2 && <span className="text-muted-foreground">...</span>}
      </div>
      <div className="flex flex-col sm:flex-row sm:justify-between gap-2 items-start mt-2"> {/* Flex col on small screens */}
         {book.asin && (
            <Link
               href={`https://www.amazon.com/dp/${book.asin}/?tag=allaboutromance`} // Example affiliate tag
               target="_blank"
               rel="noopener noreferrer"
               className="text-xs text-primary hover:underline"
            >
               View on Amazon
            </Link>
         )}
         {book.reviewUrl && (
            <Link
               href={book.reviewUrl}
               target="_blank"
               rel="noopener noreferrer"
               className="text-xs text-primary hover:underline"
            >
               Read AAR Review
            </Link>
         )}
      </div>
    </div>
  );
} 