import { render, screen } from '@testing-library/react';
import Page0 from '@/app/settings/taxes/page';
import Page1 from '@/app/settings/locale/page';
import Page2 from '@/app/settings/notifications/page';
import Page3 from '@/app/settings/customers/page';
import Page4 from '@/app/analytics/kpi/page';
import Page5 from '@/app/analytics/planning/page';
import Page6 from '@/app/analytics/budget-vs-actual/page';
import Page7 from '@/app/analytics/aging-reports/page';
import Page8 from '@/app/analytics/reconciliation/page';
import Page9 from '@/app/appointments/page';
import Page10 from '@/app/jobs/page';
import Page11 from '@/app/accounting/chart-of-accounts/page';
import Page12 from '@/app/settings/profile/page';

// TEST-407 regression for the thirteen confirmed prototype routes, not a global
// production-build scan or proof that every route in the application is ready.
test.each([
  { Page: Page0, title: 'Tax Settings' },
  { Page: Page1, title: 'Language & Currency' },
  { Page: Page2, title: 'Notification Preferences' },
  { Page: Page3, title: 'Customer Loyalty' },
  { Page: Page4, title: 'Key Performance Indicators' },
  { Page: Page5, title: 'Planning & Budgeting' },
  { Page: Page6, title: 'Budget vs. Actual' },
  { Page: Page7, title: 'Receivables & Payables Aging' },
  { Page: Page8, title: 'Bank Reconciliation' },
  { Page: Page9, title: 'Appointments' },
  { Page: Page10, title: 'Work Orders & Jobs' },
  { Page: Page11, title: 'Chart of Accounts' },
  { Page: Page12, title: 'Personal Profile' }
])('$title explains unavailability without editable controls or sample figures', ({ Page, title }) => {
  const { container } = render(<Page />);
  expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  expect(screen.getByText('Not available yet')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(container.querySelector('form, input, canvas, svg')).toBeNull();
  expect(container.textContent).not.toMatch(/₦|settings saved|preferences saved|rules updated|auto-match complete|transaction matched/i);
});
