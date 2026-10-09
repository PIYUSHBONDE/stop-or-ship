import type { Metadata } from 'next';
import './globals.css';
import { SessionProvider } from '@/components/session-provider';
import { AppShell } from '@/components/app-shell';
import { Suspense } from 'react';
export const metadata: Metadata = {
  title: 'PlantSense · Plant intelligence',
  description: 'Evidence-backed reliability decisions for a simulated manufacturing plant.',
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
