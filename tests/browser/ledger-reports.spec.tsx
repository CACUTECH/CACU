import React from 'react';
import { test, expect } from '@playwright/experimental-ct-react';
import TrialBalancePage from '../../src/app/accounting/trial-balance/page';
import GeneralLedgerPage from '../../src/app/accounting/general-ledger/page';

test('trial balance shows the labels and a reconciliation exception before the figures, and links to entries', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const component = await mount(<TrialBalancePage />);
  await component.getByLabel('As of date').fill('2026-10-30');
  await component.getByRole('button', { name: 'Run report' }).click();
  await expect(component.getByText(/Management statements, not reviewed · Accrual basis · NGN · as of 2026-10-30/)).toBeVisible();
  const alert = component.getByRole('alert');
  await expect(alert).toContainText('These figures do not reconcile');
  await expect(alert).toContainText('Customer balances on open invoices (60000.00) differ from the ledger (65000.00)');
  const receivables = component.getByRole('row', { name: /1100 Trade receivables/ });
  await expect(receivables).toContainText('65,000');
  await expect(component.getByRole('row', { name: /^Total/ })).toContainText('65,000');
  await expect(receivables.getByRole('link', { name: 'Entries' })).toHaveAttribute('href', '/accounting/general-ledger?account=ar&start=2026-01-01&end=2026-10-30');
  const alertBox = await alert.boundingBox(), tableBox = await component.locator('table').boundingBox();
  expect(alertBox!.y).toBeLessThan(tableBox!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('general ledger shows opening, running and closing balances and pages the same report', async ({ mount, page }) => {
  const component = await mount(<GeneralLedgerPage />);
  await component.getByLabel('Account').selectOption('cash');
  await component.getByLabel('From').fill('2026-10-01');
  await component.getByLabel('To').fill('2026-10-30');
  await component.getByRole('button', { name: 'Show entries' }).click();
  await expect(component.getByRole('heading', { name: '1000 Cash on hand' })).toBeVisible();
  await expect(component.getByRole('row', { name: /^Opening balance(?!s)/ })).toContainText('0.00');
  await expect(component.getByRole('row', { name: /Diesel for the generator/ })).toContainText('24,000');
  await expect(component.getByRole('row', { name: /closing balance/ })).toContainText('22,000');
  await expect(component.getByText('Page 1 of 2')).toBeVisible();
  await component.getByLabel('From').fill('2026-01-01');  // edited but not run: paging keeps the report on screen
  await component.getByRole('button', { name: 'Next' }).click();
  await expect(component.getByRole('row', { name: /Rent/ })).toContainText('22,000');
  const calls = await page.evaluate(() => (window as unknown as { ledgerCalls: unknown[][] }).ledgerCalls);
  expect(calls).toEqual([['gl', 'cash', '2026-10-01', '2026-10-30', 0], ['gl', 'cash', '2026-10-01', '2026-10-30', 1]]);
});
