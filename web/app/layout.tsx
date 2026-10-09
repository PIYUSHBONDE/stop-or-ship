import type { Metadata } from 'next';
import './globals.css';
import { SessionProvider } from '@/components/session-provider';
import { AppShell } from '@/components/app-shell';
import { Suspense } from 'react';
export const metadata: Metadata = {
  title: 'PlantSense · Plant intelligence',
  description: 'Plant reliability, evidence-backed investigation and authorized maintenance.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={<main className="boot">Loading PlantSense…</main>}>
          <SessionProvider>
            <AppShell>{children}</AppShell>
          </SessionProvider>
        </Suspense>
      </body>
    </html>
  );
}
