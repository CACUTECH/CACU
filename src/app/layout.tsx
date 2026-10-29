import type {Metadata, Viewport} from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import AppLayout from '@/components/app-layout';
import { ThemeProvider } from '@/components/theme-provider';
import { SubscriptionProvider } from '@/components/subscription-guard';
import { BusinessProvider } from '@/components/business-provider';
import { ErrorBoundary } from '@/components/error-boundary';

// Checked-in assets keep builds independent of Google Fonts responses.
const inter = localFont({ src: './fonts/inter-latin-variable.woff2', weight: '400 700', variable: '--font-inter', display: 'swap' });
const spaceGrotesk = localFont({ src: './fonts/space-grotesk-latin-variable.woff2', weight: '400 700', variable: '--font-space-grotesk', display: 'swap' });

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
