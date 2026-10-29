import type {Metadata, Viewport} from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import AppLayout from '@/components/app-layout';
import { ThemeProvider } from '@/components/theme-provider';
import { SubscriptionProvider } from '@/components/subscription-guard';
import { BusinessProvider } from '@/components/business-provider';
import { ErrorBoundary } from '@/components/error-boundary';

// Self-hosted at build time so every route gets the fonts without a third-party stylesheet.
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-inter', display: 'swap' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-space-grotesk', display: 'swap' });

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export const metadata: Metadata = {
  title: 'CACU',
  description: 'Business Management Platform',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`} suppressHydrationWarning>
      <body className="font-body antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <SubscriptionProvider>
            <BusinessProvider>
              <ErrorBoundary>
                <AppLayout>
                  {children}
                </AppLayout>
              </ErrorBoundary>
              <Toaster />
            </BusinessProvider>
          </SubscriptionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
