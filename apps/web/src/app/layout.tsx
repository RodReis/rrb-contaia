import type { Metadata } from 'next';
import { Geist, Inter, JetBrains_Mono } from 'next/font/google';
import { ScriptDeTema } from '@/components/layout/script-de-tema';
import './globals.css';

const display = Geist({
  variable: '--fonte-display',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const corpo = Inter({
  variable: '--fonte-corpo',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

const mono = JetBrains_Mono({
  variable: '--fonte-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ContaIA',
  description: 'Plataforma contábil do ContaIA.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      data-theme="light"
      className={`${display.variable} ${corpo.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ScriptDeTema />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
