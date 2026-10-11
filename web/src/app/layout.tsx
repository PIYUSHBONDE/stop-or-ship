import type { Metadata } from 'next';
import '@/app/globals.css';
import { SessionProvider } from '@/providers/plant-session-provider';
import { PreviewDispatchProvider } from '@/features/operators/lib/preview-dispatch-provider';
import { AppShell } from '@/components/layout/app-shell';
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
            <PreviewDispatchProvider>
              <AppShell>{children}</AppShell>
            </PreviewDispatchProvider>
          </SessionProvider>
        </Suspense>
      </body>
    </html>
  );
}
