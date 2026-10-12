jest.mock('lucide-react', () => ({ Sparkles: () => null, X: () => null }));
import { fireEvent, render, screen } from '@testing-library/react';
import { AIAssistant } from '@/components/ai-assistant';
import AccountingPoliciesPage from '@/app/accounting/policies/page';
import OnboardingPage from '@/app/hr/onboarding/page';
import DeparturePage from '@/app/hr/termination/page';
import { AI_UNAVAILABLE_MESSAGE } from '@/lib/ai-availability';

test('assistant explains availability without asking for confidential inputs', () => {
  render(<AIAssistant />);
  fireEvent.click(screen.getByRole('button', { name: 'AI assistant availability' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText(AI_UNAVAILABLE_MESSAGE)).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /analyze|send/i })).not.toBeInTheDocument();
});
test.each([
  { Page: AccountingPoliciesPage, title: 'Accounting Policies & Notes' },
  { Page: OnboardingPage, title: 'Employee Onboarding' },
  { Page: DeparturePage, title: 'Employee Departure' },
])('$title does not claim a working save, generation or delivery workflow', ({ Page, title }) => {
  render(<Page />);
  expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  expect(screen.getByText('Not available yet')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /save|generate|send/i })).not.toBeInTheDocument();
});
