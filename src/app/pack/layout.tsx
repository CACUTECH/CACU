import type { Metadata } from 'next';

// Lender pack links are private to whoever holds them: never indexed, and the link is not sent on to other sites.
export const metadata: Metadata = {
  title: 'Funding readiness pack',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function PackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
