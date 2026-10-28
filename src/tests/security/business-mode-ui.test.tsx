import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BusinessModeGuard } from '@/components/business-mode-guard';
import { BusinessModeSelector } from '@/components/business-mode-selector';
import { updateBusinessModeAction } from '@/app/settings/business/actions';
import { BusinessModeService } from '@/services/business-mode-service';
import { useBusiness } from '@/components/business-provider';
jest.mock('@/services/business-mode-service', () => ({ ...jest.requireActual('@/services/business-mode-service'), BusinessModeService: jest.fn() }));
jest.mock('@/app/settings/business/actions', () => ({ updateBusinessModeAction: jest.fn() }));
jest.mock('@/components/business-provider', () => ({ useBusiness: jest.fn() }));
const replace = jest.fn(), routerRefresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh: routerRefresh }), usePathname: () => '/settings/business' }));
const read = jest.fn(), refresh = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (BusinessModeService as jest.Mock).mockImplementation(() => ({ read }));
  refresh.mockResolvedValue(undefined);
});
function business(role = 'owner', mode = 'PRODUCT') {
  (useBusiness as jest.Mock).mockReturnValue({ business: { id: 'active-business', business_type: mode, userRole: role }, refresh });
}

test.each([['/pos', 'PRODUCT'], ['/pos', 'HYBRID'], ['/jobs', 'SERVICE'], ['/appointments', 'HYBRID']])('guard renders %s in %s mode', async (path, mode) => {
  read.mockResolvedValue(mode);
  render(await BusinessModeGuard({ path, children: <p>Module content</p> }));
  expect(screen.getByText('Module content')).toBeInTheDocument();
});
test.each([['/pos', 'SERVICE'], ['/jobs', 'PRODUCT'], ['/appointments', 'PRODUCT']])('guard hides %s in %s mode and links to settings', async (path, mode) => {
  read.mockResolvedValue(mode);
  render(await BusinessModeGuard({ path, children: <p>Module content</p> }));
  expect(screen.queryByText('Module content')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Business mode settings' })).toHaveAttribute('href', '/settings/business');
});
test('guard fails closed without exposing the read error', async () => {
  read.mockRejectedValue(new Error('private auth failure'));
  render(await BusinessModeGuard({ path: '/pos', children: <p>Module content</p> }));
  expect(screen.queryByText('Module content')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).not.toHaveTextContent('private auth failure');
});
test.each(['editor', 'viewer'])('%s sees the saved mode but cannot change it', role => {
  business(role);
  render(<BusinessModeSelector />);
  expect(screen.getByLabelText('Business mode')).toBeDisabled();
  expect(screen.getByText(/Only Owners and Admins/)).toBeInTheDocument();
});
test('owner saves a new mode against the saved value and reloads the workspace', async () => {
  business();
  (updateBusinessModeAction as jest.Mock).mockResolvedValue({ success: true, mode: 'SERVICE' });
  render(<BusinessModeSelector />);
  await userEvent.selectOptions(screen.getByLabelText('Business mode'), 'SERVICE');
  await userEvent.click(screen.getByRole('button', { name: 'Save mode' }));
  expect(updateBusinessModeAction).toHaveBeenCalledWith({ businessId: 'active-business', expectedMode: 'PRODUCT', mode: 'SERVICE' });
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(routerRefresh).toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('a lost response keeps the exact change for retry', async () => {
  business();
  (updateBusinessModeAction as jest.Mock).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ success: true, mode: 'HYBRID' });
  render(<BusinessModeSelector />);
  await userEvent.selectOptions(screen.getByLabelText('Business mode'), 'HYBRID');
  await userEvent.click(screen.getByRole('button', { name: 'Save mode' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save not confirmed');
  expect(screen.getByLabelText('Business mode')).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Retry save' }));
  expect((updateBusinessModeAction as jest.Mock).mock.calls).toEqual([
    [{ businessId: 'active-business', expectedMode: 'PRODUCT', mode: 'HYBRID' }],
    [{ businessId: 'active-business', expectedMode: 'PRODUCT', mode: 'HYBRID' }],
  ]);
});
test('a confirmed save is not reported as uncertain when the workspace reload fails', async () => {
  business();
  (updateBusinessModeAction as jest.Mock).mockResolvedValue({ success: true, mode: 'HYBRID' });
  refresh.mockRejectedValue(new Error('reload failed'));
  render(<BusinessModeSelector />);
  await userEvent.selectOptions(screen.getByLabelText('Business mode'), 'HYBRID');
  await userEvent.click(screen.getByRole('button', { name: 'Save mode' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Mode saved');
  expect(screen.queryByRole('button', { name: 'Retry save' })).not.toBeInTheDocument();
});
test('a definite rejection shows the server message and allows a new choice', async () => {
  business();
  (updateBusinessModeAction as jest.Mock).mockResolvedValue({ success: false, error: 'Business mode changed elsewhere. Refresh before saving again.' });
  render(<BusinessModeSelector />);
  await userEvent.selectOptions(screen.getByLabelText('Business mode'), 'SERVICE');
  await userEvent.click(screen.getByRole('button', { name: 'Save mode' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('changed elsewhere');
  expect(screen.getByLabelText('Business mode')).toBeEnabled();
});
