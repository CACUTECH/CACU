import type { Metadata } from 'next';

// Payslip links are private to the employee they were sent to: never indexed, and the link is not sent on to other sites.
export const metadata: Metadata = {
  title: 'Payslip',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function PayslipLayout({ children }: { children: React.ReactNode }) {
  return children;
}
