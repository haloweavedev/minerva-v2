import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import FloatingGradientBackground from "@/components/floating-gradient-background";
import "./globals.css";

export const metadata: Metadata = {
  title: "Minerva Chat",
  description: "A minimal AI Chatbot",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <FloatingGradientBackground blurStrength={180} numberOfBlobs={9} />
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
