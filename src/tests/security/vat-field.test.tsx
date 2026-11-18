import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VatField } from '@/components/vat-field';
import { mostVat } from '@/lib/vat';

jest.mock('@/app/settings/taxes/actions', () => ({ vatStatusAction: jest.fn() }));

test('the most VAT allowed is worked out to the kobo, before or inside the amount', () => {
  expect(mostVat('20000.00', '7.5000', false)).toBe('1500.00');
  expect(mostVat('10750.00', '7.5000', true)).toBe('750.00');
  expect(mostVat('1500', '7.5', true)).toBe('104.65');
  expect(mostVat('', '7.5', true)).toBe('0.00');
});

test('the VAT field appears only while the business charges VAT, and offers the standard amount', async () => {
  const change = jest.fn();
  const { rerender } = render(<VatField status={{ charging: false, standard_rate: null }} value="" onChange={change} base="20000" inclusive={false} label="VAT on the bill" />);
  expect(screen.queryByLabelText('VAT on the bill')).not.toBeInTheDocument();
  rerender(<VatField status={null} value="" onChange={change} base="20000" inclusive={false} label="VAT on the bill" />);
  expect(screen.queryByLabelText('VAT on the bill')).not.toBeInTheDocument();
  rerender(<VatField status={{ charging: true, standard_rate: '7.5000' }} value="" onChange={change} base="20000" inclusive={false} label="VAT on the bill" />);
  expect(screen.getByText(/As shown on the supplier/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '7.5%: ₦1500.00' }));
  expect(change).toHaveBeenCalledWith('1500.00');
});
