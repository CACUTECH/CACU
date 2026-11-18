import { render, screen } from '@testing-library/react';
import Page1 from '@/app/settings/locale/page';
import Page3 from '@/app/settings/customers/page';
import Page12 from '@/app/settings/profile/page';

// TEST-407 regression for the confirmed prototype routes (appointments, jobs, notifications and ageing became real in R2; tax settings, budgets, bank reconciliation and KPIs in R3), not a global
// production-build scan or proof that every route in the application is ready.
test.each([
  { Page: Page1, title: 'Language & Currency' },
  { Page: Page3, title: 'Customer Loyalty' },
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
