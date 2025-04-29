'use client';
import type { Book } from '@/lib/ai/schemas';
import { BookCard } from './book-card';
import { cn } from '@/lib/utils';

interface BookGridProps {
  books: Book[];
  className?: string;
}

export function BookGrid({ books, className }: BookGridProps) {
  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6", className)}>
      {books.map((book) => (
        <BookCard 
          key={`book-${book.title}-${book.author}-${book.postId || Math.random().toString(36).substring(2, 9)}`} 
          book={book} 
        />
      ))}
    </div>
  );
} 