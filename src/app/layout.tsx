import type {Metadata, Viewport} from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import AppLayout from '@/components/app-layout';
import { ThemeProvider } from '@/components/theme-provider';
import { SubscriptionProvider } from '@/components/subscription-guard';
import { BusinessProvider } from '@/components/business-provider';
import { ErrorBoundary } from '@/components/error-boundary';

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
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
