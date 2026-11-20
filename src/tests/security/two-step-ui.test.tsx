import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VerifyPage from '@/app/login/verify/page';
import SecurityPage from '@/app/settings/security/page';
import { BusinessProvider } from '@/components/business-provider';
import { getBusinessSelectionAction, getTwoStepStatusAction } from '@/app/business-actions';
import { gateFor, recoveryFile, type TwoStepStatus } from '@/lib/two-step';

const push = jest.fn(), refresh = jest.fn();
let search = new URLSearchParams();
let pathname = '/';
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }), useSearchParams: () => search, usePathname: () => pathname }));
jest.mock('@/app/business-actions', () => ({ getTwoStepStatusAction: jest.fn(), getBusinessSelectionAction: jest.fn(), selectBusinessAction: jest.fn() }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
const mfa = { listFactors: jest.fn(), challengeAndVerify: jest.fn(), enroll: jest.fn(), unenroll: jest.fn() };
const client = { auth: { mfa, refreshSession: jest.fn(), signOut: jest.fn() }, rpc: jest.fn() };
jest.mock('@/lib/supabase/client', () => ({ createClient: () => client }));
jest.setTimeout(20000);

const status = (over: Partial<TwoStepStatus>): TwoStepStatus => ({ enrolled: false, required: false, level: 'aal1', satisfied: true, recovery_codes_left: 0, ...over });
const codes = Array.from({ length: 10 }, (_, i) => `ABCD${i}-1234${i}`);

beforeEach(() => {
  jest.clearAllMocks(); search = new URLSearchParams(); pathname = '/';
  mfa.listFactors.mockResolvedValue({ data: { all: [{ id: 'f1', factor_type: 'totp', status: 'verified' }], totp: [{ id: 'f1' }] }, error: null });
  mfa.challengeAndVerify.mockResolvedValue({ error: null });
  mfa.unenroll.mockResolvedValue({ error: null });
});

test('the gate says what to do: enter the code, or set it up when the plan requires it', () => {
  expect(gateFor(status({}))).toBeNull();
  expect(gateFor(status({ enrolled: true, satisfied: false }))?.href).toBe('/login/verify');
  expect(gateFor(status({ required: true, satisfied: false }))?.href).toBe('/settings/security');
  expect(gateFor(status({ enrolled: true, level: 'aal2', satisfied: true }))).toBeNull();
  expect(recoveryFile(['A-1'])).toContain('Each code works once');
});

test('the second step takes the 6-digit code from the app', async () => {
  mfa.challengeAndVerify.mockResolvedValueOnce({ error: { message: 'Invalid TOTP code' } });
  render(<VerifyPage />);
  await userEvent.type(screen.getByLabelText('Code'), '12345');
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter the 6-digit code');
  await userEvent.type(screen.getByLabelText('Code'), '6');
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work');
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
  expect(mfa.challengeAndVerify).toHaveBeenLastCalledWith({ factorId: 'f1', code: '123456' });
});

test('a recovery code removes a lost authenticator; wrong and rate-limited codes say so', async () => {
  client.rpc.mockResolvedValueOnce({ data: false, error: null })
    .mockResolvedValueOnce({ data: null, error: { message: 'TOO_MANY_ATTEMPTS' } })
    .mockResolvedValueOnce({ data: true, error: null });
  render(<VerifyPage />);
  await userEvent.click(screen.getByRole('button', { name: /Use a recovery code/ }));
  await userEvent.type(screen.getByLabelText('Recovery code'), 'ABCDE-12345');
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('did not work, or it was already used');
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries');
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/settings/security?recovered=1'));
  expect(client.rpc).toHaveBeenLastCalledWith('use_recovery_code', { p_code: 'ABCDE-12345' });
  expect(client.auth.refreshSession).toHaveBeenCalled();
});

test('setting it up: scan, confirm with a code, and keep the recovery codes shown once', async () => {
  (getTwoStepStatusAction as jest.Mock).mockResolvedValueOnce(status({})).mockResolvedValue(status({ enrolled: true, level: 'aal2', recovery_codes_left: 10 }));
  mfa.listFactors.mockResolvedValue({ data: { all: [{ id: 'old', factor_type: 'totp', status: 'unverified' }], totp: [] }, error: null });
  mfa.enroll.mockResolvedValue({ data: { id: 'f2', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'JBSWY3DPEHPK3PXP' } }, error: null });
  client.rpc.mockResolvedValue({ data: codes, error: null });
  render(<SecurityPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Set up two-step sign-in' }));
  expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'old' });  // an unfinished earlier setup
  expect(await screen.findByLabelText('Setup key')).toHaveTextContent('JBSWY3DPEHPK3PXP');
  expect(screen.getByAltText(/QR code/)).toHaveAttribute('src', 'data:image/svg+xml;utf-8,<svg/>');
  await userEvent.type(screen.getByLabelText(/Enter the 6-digit code/), '654321');
  await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
  expect(await screen.findByText('ABCD0-12340')).toBeInTheDocument();
  expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f2', code: '654321' });
  expect(client.rpc).toHaveBeenCalledWith('new_recovery_codes');
  expect(screen.getByText(/Two-step sign-in is on/)).toBeInTheDocument();
  expect(screen.getByText('On. Recovery codes left: 10')).toBeInTheDocument();
});

test('the Chairman plan does not let an Owner or Admin turn it off; anyone else can', async () => {
  (getTwoStepStatusAction as jest.Mock).mockResolvedValue(status({ enrolled: true, required: true, level: 'aal2', recovery_codes_left: 3 }));
  const { unmount } = render(<SecurityPage />);
  expect(await screen.findByText(/cannot be turned off/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();
  unmount();
  (getTwoStepStatusAction as jest.Mock).mockResolvedValueOnce(status({ enrolled: true, level: 'aal2' })).mockResolvedValue(status({}));
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  render(<SecurityPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
  expect(await screen.findByText('Two-step sign-in is off.')).toBeInTheDocument();
  expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f1' });
});

test('until the code is entered the app shows the gate, not the business', async () => {
  (getBusinessSelectionAction as jest.Mock).mockResolvedValue({ memberships: [{ business_id: 'b1', role: 'owner', businesses: null }],
    active: { business_id: 'b1', role: 'owner', businesses: null }, twoStep: status({ enrolled: true, satisfied: false }) });
  render(<BusinessProvider><p>Sales today</p></BusinessProvider>);
  expect(await screen.findByRole('heading', { name: 'Enter your sign-in code' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Enter code' })).toHaveAttribute('href', '/login/verify');
  expect(screen.queryByText('Sales today')).not.toBeInTheDocument();
});
