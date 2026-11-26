import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FundingReadinessPage from '@/app/analytics/funding/page';
import { fundingAssessAction, fundingAssessmentAction, fundingOverviewAction } from '@/app/analytics/funding/actions';
import { FUNDING_NOTICE, type Assessment, type FundingOverview } from '@/lib/funding-readiness';

jest.mock('@/app/analytics/funding/actions', () => ({ fundingOverviewAction: jest.fn(), fundingAssessAction: jest.fn(), fundingAssessmentAction: jest.fn() }));

const base: FundingOverview = { available: true, level: 'score', message: null, notice: FUNDING_NOTICE, limitations: ['The score reflects only what is recorded in CACU.'],
  eligibility: { eligible: true, missing: [], earliest_date: null }, latest: null, assessed_today: false, history: null };
const assessment: Assessment = { id: 'a1', kind: 'request', recommendations_included: false, assessed_on: '2026-11-25', created_at: '2026-11-25T10:00:00Z', model_version: 'fra-1', score: 64, band: 'developing',
  band_label: 'Developing', band_text: 'A few areas to improve before approaching a lender.', based_on: 6, notice: FUNDING_NOTICE, limitations: [],
  label: 'From your CACU books, not reviewed', period: { start_date: '2026-04-01', end_date: '2026-10-31', months: 7 },
  information: { stock_turnover: { label: 'Times your stock was sold and replaced over the period (shown, not scored)', value: '4.2' } },
  dimensions: [
    { key: 'D1', label: 'Record completeness and quality', weight: 20, share: '22.2', score: 75, measures: [
      { key: 'days_recorded', label: 'Trading days with something recorded', unit: 'percent', best: '95', worst: '40', value: '81.50', score: 75, note: null }] },
    { key: 'D3', label: 'Revenue trend', weight: 10, share: null, score: null, measures: [
      { key: 'revenue_growth', label: 'Revenue in the last 3 months against the 3 before', unit: 'percent', best: '15', worst: '-30', value: null, score: null, note: 'Not enough in the books to work this out.' }] },
    { key: 'D6', label: 'Debt service capacity', weight: 10, share: '11.1', score: 100, measures: [
      { key: 'debt_cover', label: 'Monthly cash from trading against monthly loan repayments', unit: 'ratio', best: '2.0', worst: '1.0', value: null, score: 100, note: 'No loan repayments recorded, and trading brought cash in.' }] },
  ] };

beforeEach(() => jest.clearAllMocks());

test('FRA-009: the notice is on the screen even when funding readiness is off, and nothing can be run', async () => {
  (fundingOverviewAction as jest.Mock).mockResolvedValue({ success: true, data: { ...base, available: false, message: 'Funding readiness is not available yet.', eligibility: null } });
  render(<FundingReadinessPage />);
  expect(await screen.findByText('Funding readiness is not available yet.')).toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent('not a credit rating, credit report or offer of finance');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('FR-180: a business that does not qualify sees what is missing and the earliest date', async () => {
  (fundingOverviewAction as jest.Mock).mockResolvedValue({ success: true, data: { ...base,
    eligibility: { eligible: false, missing: [{ key: 'history', message: 'Your books need 6 full months in CACU; they have 2 so far.' }], earliest_date: '2027-03-01' } } });
  render(<FundingReadinessPage />);
  expect(await screen.findByText(/they have 2 so far/)).toBeInTheDocument();
  expect(screen.getByText(/earliest your books can qualify is 1 March 2027/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /score|assess/i })).not.toBeInTheDocument();
});

test('FRA-001/003: the score shows its band, period, version and every measure with its thresholds; once a day', async () => {
  (fundingOverviewAction as jest.Mock).mockResolvedValue({ success: true, data: base });
  (fundingAssessAction as jest.Mock).mockResolvedValue({ success: true, data: assessment });
  render(<FundingReadinessPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Work out my score' }));
  expect(await screen.findByText('64')).toBeInTheDocument();
  expect(screen.getByText('Developing')).toBeInTheDocument();
  expect(screen.getByText(/based on 6 of 7 dimensions\. Scoring model fra-1/)).toBeInTheDocument();
  const days = screen.getByText('Trading days with something recorded').nextElementSibling!;
  expect(days).toHaveTextContent('81.5% (100 at 95%, 0 at 40%)75 / 100');
  expect(screen.getByText('Not scored')).toBeInTheDocument();
  const debt = screen.getByText('Monthly cash from trading against monthly loan repayments').nextElementSibling!;
  expect(debt).toHaveTextContent('No loan repayments recorded, and trading brought cash in.100 / 100');
  expect(screen.getByText(/shown, not scored\): 4\.2/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Assess again' })).toBeDisabled());
  expect(screen.getByText('Assessed today. You can assess again tomorrow.')).toBeInTheDocument();
  expect(screen.queryByText(/loan offer|approved|you qualify for/i)).not.toBeInTheDocument();
});

test('a refused assessment shows the reason and keeps the page', async () => {
  (fundingOverviewAction as jest.Mock).mockResolvedValue({ success: true, data: base });
  (fundingAssessAction as jest.Mock).mockResolvedValue({ success: false, error: 'Confirm or clear the 1 transfer waiting more than 30 days.' });
  render(<FundingReadinessPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Work out my score' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Confirm or clear the 1 transfer');
  expect(screen.getByRole('button', { name: 'Work out my score' })).toBeEnabled();
});

test('General: no recommendations or history, and the screen says which plans include them', async () => {
  (fundingOverviewAction as jest.Mock).mockResolvedValue({ success: true, data: { ...base, latest: assessment } });
  render(<FundingReadinessPage />);
  expect(await screen.findByText(/come with the Oga and Chairman plans/)).toBeInTheDocument();
  expect(screen.queryByText('What to do next')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Past assessments' })).not.toBeInTheDocument();
});

test('FRA-002/003: Oga sees what to do next for a weak area, and past assessments with the change in score', async () => {
  const weak: Assessment = { ...assessment, id: 'a2', kind: 'monthly', assessed_on: '2026-12-01', score: 70, recommendations_included: true,
    dimensions: assessment.dimensions.map(d => d.key === 'D1'
      ? { ...d, score: 45, recommendations: ['Confirm or clear the 14 pending transfers older than 7 days.'] } : { ...d, recommendations: [] }) };
  const history = [
    { id: 'a2', kind: 'monthly', assessed_on: '2026-12-01', score: 70, band: 'developing', band_label: 'Developing', model_version: 'fra-1', period: weak.period },
    { id: 'a1', kind: 'request', assessed_on: '2026-11-25', score: 64, band: 'developing', band_label: 'Developing', model_version: 'fra-1', period: assessment.period },
  ];
  (fundingOverviewAction as jest.Mock).mockResolvedValue({ success: true, data: { ...base, level: 'improvement_plan', latest: weak, history } });
  (fundingAssessmentAction as jest.Mock).mockResolvedValue({ success: true, data: { ...assessment, recommendations_included: true } });
  render(<FundingReadinessPage />);
  expect(await screen.findByText('Confirm or clear the 14 pending transfers older than 7 days.')).toBeInTheDocument();
  expect(screen.getAllByText('What to do next')).toHaveLength(1);
  const rows = screen.getAllByRole('row');
  expect(rows[1]).toHaveTextContent('1 December 2026Monthly70+6DevelopingShowing');
  expect(rows[2]).toHaveTextContent('25 November 2026You asked64Developing');
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  expect(await screen.findByText(/looking at a past assessment, from 25 November 2026/)).toBeInTheDocument();
  expect(fundingAssessmentAction).toHaveBeenCalledWith('a1');
  expect(screen.getByText('64', { selector: 'p' })).toBeInTheDocument();  // the big score, not the table
  fireEvent.click(screen.getByRole('button', { name: 'Back to the latest' }));
  expect(await screen.findByText('70', { selector: 'p' })).toBeInTheDocument();
});
