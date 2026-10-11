import React from 'react';
import { test, expect } from '@playwright/experimental-ct-react';
import ReportsPage from '../../src/app/reports/page';

test('three report tabs stay accessible when a statement fails, including on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const component = await mount(<ReportsPage />);
  await expect(component.getByRole('tab')).toHaveCount(3);
  await expect(component.getByText('₦25,000.00', { exact: true })).toBeVisible();
  await component.getByRole('tab', { name: 'Balance Sheet', exact: true }).click();
  await expect(component.getByRole('alert')).toHaveText('Balance sheet unavailable for this business.');
  await component.getByRole('tab', { name: 'Cash Flow Statement', exact: true }).click();
  await expect(component.getByRole('button', { name: 'Run report' })).toBeVisible();
  await expect(component.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0);
  await component.getByRole('button', { name: 'Run report' }).click();
  await expect(component.getByText('Reconciled', { exact: true })).toBeVisible();
  await component.getByRole('tab', { name: 'Income Statement', exact: true }).click();
  await expect(component.getByText('₦25,000.00', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
