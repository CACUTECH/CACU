import { lineKobo, receiptText, validDiscount, type SaleReceipt } from '@/lib/checkout';

test('line amounts are worked in kobo and round half up like the server', () => {
  expect(lineKobo('1500', 2, '10')).toEqual({ gross: 300000, discount: 30000, net: 270000 });
  expect(lineKobo('65000', 1, '6')).toEqual({ gross: 6500000, discount: 390000, net: 6110000 });
  expect(lineKobo('0.05', 1, '50').discount).toBe(3);  // 2.5 kobo rounds up
  expect(lineKobo('19.99', 3, '0').net).toBe(5997);
});

test('a discount is valid only within the cap with at most two decimals', () => {
  expect(['5', '5.00', '0', '5.01', '-1', '2.555', 'x'].map(v => validDiscount(v, 5))).toEqual([true, true, true, false, false, false, false]);
});

test('the WhatsApp text names the business, items, total, payment and change, and a waiting transfer', () => {
  const receipt: SaleReceipt = { id: 's', number: 'CS-0001', date: '2026-11-07', status: 'pending_payment', method: 'split', subtotal: '3000.00',
    discount_total: '300.00', total: '2700.00', cash_received: '2000.00', change: '300.00', transfer_amount: '1000.00',
    items: [{ name: 'Beans', quantity: 2, unit_price: '1500.00', discount: '300.00', total: '2700.00' }] };
  expect(receiptText(receipt, 'Ada Provisions')).toBe(['Ada Provisions', 'Receipt CS-0001, 2026-11-07', '2 x Beans: ₦2700.00', 'Discount: ₦300.00',
    'Total: ₦2700.00', 'Transfer awaiting confirmation', 'Change: ₦300.00'].join('\n'));
});
