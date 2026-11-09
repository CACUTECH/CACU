import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExportPage from '@/app/settings/export/page';
import { exportsAction, requestExportAction } from '@/app/settings/export/actions';
import { fileSize, type DataExport } from '@/lib/data-export';

jest.mock('@/app/settings/export/actions', () => ({ exportsAction: jest.fn(), requestExportAction: jest.fn() }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'key-1' });

const made = (over: Partial<DataExport>): DataExport => ({ id: 'e1', status: 'ready', requested_at: '2026-11-09T09:00:00Z', finished_at: '2026-11-09T09:10:00Z',
  expires_at: '2026-11-16T09:10:00Z', file_name: 'cacu-export-2026-11-09-e1.zip', size_bytes: 2_400_000, manifest: { files: 41, rows: 12850 }, error: null, ...over });

beforeEach(() => jest.clearAllMocks());

test('sizes read plainly', () => {
  expect(fileSize(2_400_000)).toBe('2.3 MB');
  expect(fileSize(300)).toBe('1 KB');
  expect(fileSize(null)).toBe('');
});

test('the owner prepares an export, then downloads it from the protected route', async () => {
  (exportsAction as jest.Mock).mockResolvedValueOnce({ success: true, data: [] })
    .mockResolvedValue({ success: true, data: [made({ id: 'e2', status: 'queued', finished_at: null, expires_at: null, size_bytes: null, manifest: null }), made({})] });
  (requestExportAction as jest.Mock).mockResolvedValue({ success: true, data: made({ status: 'queued' }) });
  render(<ExportPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Prepare export' }));
  await waitFor(() => expect(requestExportAction).toHaveBeenCalledWith('key-1'));
  expect(await screen.findByText(/usually ready within the hour/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Export being prepared' })).toBeDisabled();  // one at a time
  expect(screen.getByText('Waiting to be prepared')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/api/exports/e1');
  expect(screen.getByText(/41 files, 12,850 rows/)).toBeInTheDocument();
});

test('limits and failures are said plainly, and old files cannot be downloaded', async () => {
  (exportsAction as jest.Mock).mockResolvedValue({ success: true, data: [made({ status: 'expired', file_name: null }),
    made({ id: 'e3', status: 'failed', error: 'The export stopped part way. Prepare a new one.' })] });
  (requestExportAction as jest.Mock).mockResolvedValue({ success: false, error: 'At most 3 exports a day. Download one of the recent ones, or try again tomorrow.' });
  render(<ExportPage />);
  expect(await screen.findByText('Deleted after 7 days')).toBeInTheDocument();
  expect(screen.getByText('The export stopped part way. Prepare a new one.')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Prepare export' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('At most 3 exports a day');
});

test('someone without the export permission is told so', async () => {
  (exportsAction as jest.Mock).mockResolvedValue({ success: false, error: 'You do not have permission to do this in this business. Ask the business owner.' });
  render(<ExportPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Ask the business owner');
});
