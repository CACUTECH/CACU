import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BusinessProvider, useBusiness } from '@/components/business-provider';
import { SubscriptionProvider, useSubscription } from '@/components/subscription-guard';
import { getBusinessSelectionAction } from '@/app/business-actions';
let mockPathname = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
jest.mock('@/app/business-actions', () => ({ getBusinessSelectionAction: jest.fn(), selectBusinessAction: jest.fn() }));

function BusinessProbe() {
  const { business, refresh } = useBusiness();
  return <><p>{business?.name ?? 'No business'}</p><button onClick={() => void refresh()}>Refresh business</button></>;
}
function selection(id: string) {
  const active = { business_id: id, role: 'owner', businesses: { id, name: id } };
  return { memberships: [active], active };
}
test('refresh clears previously displayed business data', async () => {
  let first!: (value: unknown) => void;
  let second!: (value: unknown) => void;
  (getBusinessSelectionAction as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { first = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
  const { rerender } = render(<BusinessProvider><BusinessProbe /></BusinessProvider>);
  await act(async () => { first(selection('A')); });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh business' }));
  expect(screen.queryByText('A')).not.toBeInTheDocument();
  await act(async () => { second(selection('B')); });
  expect(screen.getByText('B')).toBeInTheDocument();
  rerender(<BusinessProvider><BusinessProbe /></BusinessProvider>);
});
test('a forged browser tier grants no paid access', async () => {
  localStorage.setItem('subscription-tier', 'Enterprise');
  function Probe() { const { tier, isFeatureAccessible } = useSubscription();
    return <p>{tier === null && !isFeatureAccessible('Enterprise') && !isFeatureAccessible('Growth') ? 'Paid access unavailable' : 'Granted'}</p>; }
  render(<SubscriptionProvider><Probe /></SubscriptionProvider>);
  await waitFor(() => expect(screen.getByText('Paid access unavailable')).toBeInTheDocument());
  localStorage.removeItem('subscription-tier');
});

test('late prior tenant response is discarded when requests overlap', async () => {
  mockPathname = '/setup';
  let first!: (value: unknown) => void;
  let second!: (value: unknown) => void;
  (getBusinessSelectionAction as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { first = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
  render(<BusinessProvider><BusinessProbe /></BusinessProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh business' }));
  await act(async () => { second(selection('B')); });
  await act(async () => { first(selection('A')); });
  expect(screen.getByText('B')).toBeInTheDocument();
  expect(screen.queryByText('A')).not.toBeInTheDocument();
  mockPathname = '/';
});
