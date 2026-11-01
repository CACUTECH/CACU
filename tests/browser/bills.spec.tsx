import React from 'react';
import { test, expect } from '@playwright/experimental-ct-react';
import BillsPage from '../../src/app/accounting/bills/page';

test('owner records a supplier bill and pays an opening bill in part, retrying an unconfirmed payment with the same key', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const component = await mount(<BillsPage />);
  await expect(component.getByText('you owe NGN 150,000.50')).toBeVisible();
  await component.getByLabel('Supplier').selectOption('s2');
  await component.getByLabel('Their bill number').fill('INV-0042');
  await component.getByLabel('Expense account').selectOption('e1');
  await component.getByLabel('Amount (NGN)').fill('120000');
  await component.getByRole('button', { name: 'Record bill' }).click();
  await expect(component.getByRole('status')).toHaveText('Bill recorded.');
  await expect(component.getByRole('row', { name: /Kemi Properties INV-0042/ })).toContainText('Unpaid');
  await expect(component.getByText('you owe NGN 270,000.50')).toBeVisible();

  await component.getByRole('row', { name: /Mills Ltd Opening balance/ }).getByRole('button', { name: 'Pay' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Amount paid (NGN)')).toHaveValue('150000.50');
  await dialog.getByLabel('Amount paid (NGN)').fill('200000');
  await dialog.getByRole('button', { name: 'Record payment' }).click();
  await expect(dialog.getByRole('alert')).toContainText('You owe NGN 150,000.50 on this bill.');
  await dialog.getByLabel('Amount paid (NGN)').fill('50000.50');
  await dialog.getByRole('button', { name: 'Record payment' }).click();
  await expect(dialog.getByRole('alert')).toContainText('503');
  await expect(dialog.getByLabel('Amount paid (NGN)')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Retry payment' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(component.getByRole('row', { name: /Mills Ltd Opening balance/ })).toContainText('Part paid');
  const payments = await page.evaluate(() => (window as unknown as { billPayments: { billId: string; input: { request_key: string; bank_account_id?: string } }[] }).billPayments);
  expect(payments).toHaveLength(2);
  expect(payments[0].input.request_key).toBe(payments[1].input.request_key);
  expect(payments[1]).toMatchObject({ billId: 'open', input: { bank_account_id: 'b1' } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
