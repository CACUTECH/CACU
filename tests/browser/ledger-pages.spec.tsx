import React from 'react';
import { test, expect } from '@playwright/experimental-ct-react';
import TransactionsPage from '../../src/app/transactions/page';

test('ledger pages clear stale financial rows after failure and retry the selected page', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pages: number[] = [];
  let failed = false;
  await page.route('**/test/ledger?*', route => {
    const requested = Number(new URL(route.request().url()).searchParams.get('page'));
    pages.push(requested);
    if (requested === 1 && !failed) { failed = true; return route.fulfill({ status: 503 }); }
    return route.fulfill({ json: { total: 21, data: [{ id: 'entry-' + requested, description: requested ? 'Second page record' : 'First page record', amount: '100.00', type: 'Income', category: 'Services', date: '2026-10-14' }] } });
  });
  await mount(<TransactionsPage />);
  await expect(page.getByText('First page record', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Ledger records unavailable');
  await expect(page.getByText('First page record', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Retry this page', exact: true }).click();
  await expect(page.getByText('Second page record', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByText('First page record', { exact: true })).toBeVisible();
  expect(pages).toEqual([0, 1, 1, 0]);
});
