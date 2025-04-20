'use client';
import React from 'react';
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

  return (
    <div className={cn("border rounded-lg p-4 bg-card text-card-foreground shadow-sm max-w-xs w-full flex flex-col", className)}>
      <div className="flex-grow">
        <div className="mb-3 flex justify-center relative w-[150px] h-[230px] mx-auto">
          <Image 
            src={src} 
            alt={`Cover of ${book.title}`} 
            fill
            className="rounded-md object-cover" 
          />
        </div>
        <h3 className="font-semibold text-base mb-1 truncate" title={book.title}>{book.title}</h3>
        <p className="text-sm text-muted-foreground mb-2 truncate">by {book.author}</p>

        {/* Display Grade */}
        {book.grade && <p className="text-xs mb-1"><span className="font-medium">Grade:</span> {book.grade}</p>}

        {/* Display Book Type */}
        {book.bookType && <p className="text-xs mb-1"><span className="font-medium">Type:</span> {book.bookType}</p>}

        {/* Display Tags */}
        {book.tags && book.tags.length > 0 && (
          <div className="mb-2">
            <p className="text-xs font-medium mb-0.5">Tags:</p>
            <div className="flex flex-wrap gap-1 text-xs">
              {book.tags.slice(0, 3).map(tag => (
                <span key={tag} className="bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded truncate">{tag}</span>
              ))}
              {book.tags.length > 3 && <span className="text-muted-foreground">...</span>}
            </div>
          </div>
        )}

        {/* Display Summary */}
        {book.summary && (
           <p className="text-xs text-muted-foreground mt-2 border-t pt-2 italic line-clamp-3">&ldquo;{book.summary}&rdquo;</p>
        )}
      </div>

      {/* Link to review */}
      <div className="mt-3 pt-2 border-t">
         {book.url && (
            <Link
               href={book.url}
               target="_blank"
               rel="noopener noreferrer"
               className="text-xs text-primary hover:underline block text-center"
            >
               Read Full AAR Review
            </Link>
         )}
      </div>
    </div>
  );
} 