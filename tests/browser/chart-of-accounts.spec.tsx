import React from 'react';
import { test, expect } from '@playwright/experimental-ct-react';
import ChartOfAccountsPage from '../../src/app/accounting/chart-of-accounts/page';

test('owner sets up standard accounts, retries with the same key, and sees them grouped in plain language on mobile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const component = await mount(<ChartOfAccountsPage />);
  await expect(component.getByText('No accounts yet')).toBeVisible();
  await component.getByRole('button', { name: 'Set up standard accounts' }).click();
  await expect(component.getByRole('alert')).toContainText('Retry to check whether they were added');
  await component.getByRole('button', { name: 'Set up standard accounts' }).click();
  await expect(component.getByText('What the business owns')).toBeVisible();
  await expect(component.getByText('Money coming in')).toBeVisible();
  await expect(component.getByText(/waiting for review by CACU/)).toBeVisible();
  await expect(component.getByText('What customers owe you').filter({ visible: true })).toHaveCount(1);
  const keys = await page.evaluate(() => (window as unknown as { adoptionKeys: string[] }).adoptionKeys);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await expect(component.locator('input, form')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
