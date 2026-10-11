import React from 'react';
import { test, expect } from '@playwright/experimental-ct-react';
import { ReceiptDemo } from './receipt-demo';

test('mobile Transfer receipt preserves selected bank and amount after an interrupted response', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/test/collection-accounts', route => route.fulfill({ json: { native: true, accounts: [{ id: 'bank', name: 'Receiving bank' }] } }));
  const attempts: unknown[] = [];
  await page.route('**/test/receipt', route => { attempts.push(route.request().postDataJSON()); return attempts.length === 1 ? route.abort() : route.fulfill({ json: { success: true } }); });
  await mount(<ReceiptDemo />);
  await page.getByLabel('Payment method').selectOption('Transfer');
  await expect(page.getByRole('button', { name: 'Record payment', exact: true })).toBeDisabled();
  await page.getByLabel('Receiving bank account').selectOption('bank');
  await page.getByLabel('Amount received (NGN)').fill('40.00');
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Payment response unavailable');
  await expect(page.getByLabel('Receiving bank account')).toBeDisabled();
  await expect(page.getByLabel('Amount received (NGN)')).toBeDisabled();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open receipt' }).click();
  await page.getByRole('button', { name: 'Retry payment', exact: true }).click();
  await expect(page.getByText('Receipt saved', { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[0]).toMatchObject({ bankAccountId: 'bank', method: 'Transfer', amount: '40.00' });
});

test('an empty receiving-account list cannot submit a Transfer payment', async ({ mount, page }) => {
  await page.route('**/test/collection-accounts', route => route.fulfill({ json: { native: true, accounts: [] } }));
  let writes = 0; await page.route('**/test/receipt', route => { writes += 1; return route.fulfill({ json: { success: true } }); });
  await mount(<ReceiptDemo />);
  await page.getByLabel('Payment method').selectOption('Transfer');
  await expect(page.getByText(/No receiving bank accounts are available/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record payment', exact: true })).toBeDisabled();
  expect(writes).toBe(0);
});
