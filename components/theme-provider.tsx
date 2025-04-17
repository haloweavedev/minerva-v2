'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ThemeProviderProps } from 'next-themes';
import * as React from "react"; // Import React

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  // Ensure props are passed correctly, especially defaultTheme
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
} 