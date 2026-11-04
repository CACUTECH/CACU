import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import RegistrationPage from '@/app/settings/registration/page';

jest.mock('lucide-react', () => ({ Circle: () => null }));

const source = (route: string) => readFileSync(join(process.cwd(), 'src/app', route, 'page.tsx'), 'utf8');

// TEST-407 (Doc 19), PRIN-01: nothing claims a registration, tier or figure that CACU does not hold.
test('the registration checklist marks nothing as done and offers no dead links or buttons', () => {
  const { container } = render(<RegistrationPage />);
  expect(screen.getByRole('heading', { level: 1, name: 'Business Registration' })).toBeInTheDocument();
  expect(screen.getByText(/CACU does not check them for you/)).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(container.textContent).not.toMatch(/completed|progress|%|₦/i);
});

test('the customers page shows no made-up tier or developer jargon as figures', () => {
  const page = source('customers');
  expect(page).not.toMatch(/GOLD|Active Tier|RLS Partitioning|Syncing via Supabase|Real-time aggregation/);
});

test('sign-up and password reset require at least 10 characters (SEC-013)', () => {
  expect(source('signup')).toContain('min(10, "Password must be at least 10 characters")');
  expect(source('reset-password')).toContain('min(10, "New password must be at least 10 characters")');
  expect(readFileSync(join(process.cwd(), 'supabase/config.toml'), 'utf8')).toMatch(/^minimum_password_length = 10$/m);
});
