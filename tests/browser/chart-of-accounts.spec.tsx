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
  await expect(component.getByRole('row', { name: /1000 Cash on hand/ })).toContainText('Used by automatic postings');
  await expect(component.getByRole('row', { name: /1000 Cash on hand/ }).getByRole('button', { name: 'Archive' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('owner adds, renames, archives and restores accounts', async ({ mount, page }) => {
  const component = await mount(<ChartOfAccountsPage />);
  for (let attempt = 0; attempt < 2; attempt++) await component.getByRole('button', { name: 'Set up standard accounts' }).click();  // the double fails the first
  await expect(component.getByRole('heading', { name: 'Money going out' })).toBeVisible();
  await component.getByLabel('Name').fill('Generator fuel');
  await component.getByLabel('Kind of account').selectOption('expense');
  await component.getByRole('button', { name: 'Add account' }).click();
  await expect(component.getByRole('row', { name: /6910 Generator fuel/ })).toBeVisible();

  const rent = component.getByRole('row', { name: /6100 Rent/ });
  await rent.getByRole('button', { name: 'Rename' }).click();
  const rename = component.getByRole('dialog', { name: 'Rename Rent' });
  await rename.getByLabel('New name for 6100').fill('generator FUEL');
  await rename.getByRole('button', { name: 'Save name' }).click();
  await expect(component.getByRole('alert')).toHaveText('Another account already has that name.');
  await rename.getByLabel('New name for 6100').fill('Shop rent');
  await rename.getByRole('button', { name: 'Save name' }).click();
  const shopRent = component.getByRole('row', { name: /6100 Shop rent/ });
  await expect(shopRent).toBeVisible();

  page.once('dialog', dialog => void dialog.accept());
  await shopRent.getByRole('button', { name: 'Archive' }).click();
  await expect(shopRent).toContainText('(archived)');
  await shopRent.getByRole('button', { name: 'Restore' }).click();
  await expect(shopRent).not.toContainText('(archived)');
  const changes = await page.evaluate(() => (window as unknown as { accountChanges: { operation: string; booksActive: boolean }[] }).accountChanges);
  expect(changes.map(c => c.operation)).toEqual(['add', 'rename', 'rename', 'archive', 'restore']);
  expect(changes.every(c => c.booksActive === false)).toBe(true);
});
