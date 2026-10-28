import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import HRLayout from '@/app/hr/layout';
import EmployeesPage from '@/app/hr/employees/page';
import { getBusinessSelectionAction } from '@/app/business-actions';
import { HRService } from '@/services/hr-service';
jest.mock('@/app/business-actions', () => ({ getBusinessSelectionAction: jest.fn() }));
jest.mock('@/services/hr-service', () => ({ HRService: jest.fn() }));
const read = jest.fn();
beforeEach(() => { jest.clearAllMocks(); (HRService as jest.Mock).mockImplementation(() => ({ listEmployeeDirectory: read })); });
test.each(['owner','admin'])('HR layout renders authorized %s content', async role => {
  (getBusinessSelectionAction as jest.Mock).mockResolvedValue({ active: { role } });
  render(await HRLayout({ children: <p>Protected directory</p> }));
  expect(screen.getByText('Protected directory')).toBeInTheDocument();
});
test.each(['editor','viewer',null])('HR layout with %s never renders protected children', async role => {
  (getBusinessSelectionAction as jest.Mock).mockResolvedValue({ active: role ? { role } : null });
  render(await HRLayout({ children: <p>Protected directory</p> }));
  expect(screen.queryByText('Protected directory')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeInTheDocument();
});
test('membership transport failure fails closed', async () => {
  (getBusinessSelectionAction as jest.Mock).mockRejectedValue(new Error('private auth failure'));
  render(await HRLayout({ children: <p>Protected directory</p> }));
  expect(screen.queryByText('Protected directory')).not.toBeInTheDocument();
});
test.each(['-1','1.5','100001',['0','1']])('invalid URL page %s never queries HR', async page => {
  render(await EmployeesPage({ searchParams: Promise.resolve({ page }) }));
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid employee page');
  expect(read).not.toHaveBeenCalled();
});
test('failed employee read preserves page in retry and hides private error', async () => {
  read.mockRejectedValue(new Error('private database failure'));
  render(await EmployeesPage({ searchParams: Promise.resolve({ page: '2' }) }));
  expect(screen.getByRole('link', { name: 'Retry' })).toHaveAttribute('href','/hr/employees?page=2');
  expect(screen.queryByText('private database failure')).not.toBeInTheDocument();
});
test('empty directory has no fabricated employees', async () => {
  read.mockResolvedValue({ data: [], total: 0 });
  render(await EmployeesPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText('No employees registered in this business.')).toBeInTheDocument();
});
test('directory presents bounded rows and next-page navigation', async () => {
  read.mockResolvedValue({ data: [{ id: 'saved',full_name: 'Existing employee',job_title:null,department:null,employment_status:'Active' }], total:21 });
  render(await EmployeesPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText('Existing employee')).toBeInTheDocument();
  expect(screen.getByRole('link', { name:'Next' })).toHaveAttribute('href','/hr/employees?page=1');
});
test('last supported page never links to an invalid page', async () => {
  read.mockResolvedValue({ data: [], total: 2000021 });
  render(await EmployeesPage({ searchParams: Promise.resolve({ page: '100000' }) }));
  expect(screen.queryByRole('link', { name: 'Next' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/hr/employees?page=99999');
});
